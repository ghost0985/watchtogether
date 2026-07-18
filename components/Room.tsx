"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import usePartySocket from "partysocket/react";
import type { PartySocket } from "partysocket";
import {
  Check,
  Loader2,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  Minimize2,
  Pause,
  Play,
  Share2,
  X,
} from "lucide-react";
import {
  PARTYKIT_HOST,
  getDisplayName,
  getLanguagePref,
  getUserId,
  normalizeRoomCode,
  setDisplayName,
  setLanguagePref,
} from "@/lib/room";
import { parseYouTubeId } from "@/lib/youtube";
import { INITIAL_ROOM_STATE, type ClientMessage, type FeedItem, type RoomState, type RtcSignal, type ServerMessage } from "@/lib/types";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useVoice } from "@/lib/useVoice";
import YouTubePlayer, { type PlayerHandle } from "./YouTubePlayer";
import NamePrompt from "./NamePrompt";
import ChatSheet, { ChatComposer, ChatMessageList } from "./ChatSheet";
import Presence from "./Presence";
import VideoBrowser from "./VideoBrowser";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function Room({ code }: { code: string }) {
  const roomId = useMemo(() => normalizeRoomCode(code), [code]);
  const [userId] = useState(() => getUserId());
  // myName/myLanguage start at the same "nothing cached yet" values the
  // server renders (it has no localStorage to read), then pick up the real
  // cached values in an effect below — reading localStorage directly in the
  // initializer caused a hydration mismatch for any returning visitor (their
  // name/language differs from the server's blank guess), which momentarily
  // remounted the whole room on every reload.
  const [myName, setMyName] = useState("");
  const [myLanguage, setMyLanguage] = useState("en");

  useEffect(() => {
    // Must run in an effect, not during render: localStorage is only safe to
    // read after mount, which is the whole point (see the comment above).
    /* eslint-disable react-hooks/set-state-in-effect */
    const cachedName = getDisplayName();
    if (cachedName) setMyName(cachedName);
    setMyLanguage(getLanguagePref());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const [serverState, setServerState] = useState<RoomState>(INITIAL_ROOM_STATE);
  const [clockOffset, setClockOffset] = useState(0);
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(false);

  const [feed, setFeed] = useState<FeedItem[]>([]);
  // On mobile this drives a Watch/Chat tab switch (see the header's Chat
  // button + ChatSheet) instead of the old always-peeking sheet — chat is
  // fully hidden until this is true. Desktop ignores it: chat there is a
  // permanent sidebar (see ChatSheet's lg: styles), always considered visible
  // unless fullscreen.
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [lastSeenChatCount, setLastSeenChatCount] = useState(0);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // Control-bar UI state (driven by the player's progress callback).
  const [displayTime, setDisplayTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  const [videoInput, setVideoInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<"search" | "paste">("search");
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const playerRef = useRef<PlayerHandle>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<PartySocket | null>(null);
  const serverStateRef = useRef(serverState);
  serverStateRef.current = serverState;
  const myNameRef = useRef(myName);
  myNameRef.current = myName;
  const myLanguageRef = useRef(myLanguage);
  myLanguageRef.current = myLanguage;
  // Assigned once `voice` exists further down. Safe to read from the socket's
  // onMessage callback despite the later assignment: a WebSocket message can
  // only arrive after this render has finished running (same trick used by
  // the refs above).
  const voiceHandleSignalRef = useRef<(from: string, signal: RtcSignal) => void>(() => {});

  const cacheKey = `wt-state-${roomId}`;

  const socket = usePartySocket({
    host: PARTYKIT_HOST,
    room: roomId,
    query: { userId },
    onOpen: () => {
      setConnected(true);
      // Reconnects (and returning users) skip the name prompt — announce silently.
      if (myNameRef.current) {
        socketRef.current?.send(
          JSON.stringify({ type: "setName", name: myNameRef.current } satisfies ClientMessage)
        );
      }
      socketRef.current?.send(
        JSON.stringify({ type: "setLanguage", language: myLanguageRef.current } satisfies ClientMessage)
      );
    },
    onClose: () => setConnected(false),
    onMessage: (event: MessageEvent) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }

      if (message.type === "feedHistory") {
        setFeed(message.items);
        return;
      }
      if (message.type === "feedItem") {
        setFeed((prev) => [...prev, message.item]);
        return;
      }
      if (message.type === "rtc-signal") {
        voiceHandleSignalRef.current(message.from, message.signal);
        return;
      }

      // message.type === "state"
      setServerState(message.state);
      setClockOffset(message.serverTime - Date.now());

      if (message.state.videoId) {
        // Keep a warm copy so a host can re-seed after a server cold start.
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(message.state));
        } catch {
          /* storage may be unavailable */
        }
      } else if (message.state.hostId === userId) {
        // Empty room + we're host: likely a cold start. Re-seed the last video.
        try {
          const cached = sessionStorage.getItem(cacheKey);
          if (cached) {
            const prev = JSON.parse(cached) as RoomState;
            if (prev.videoId) {
              socketRef.current?.send(
                JSON.stringify({ type: "loadVideo", videoId: prev.videoId } satisfies ClientMessage)
              );
            }
          }
        } catch {
          /* ignore */
        }
      }
    },
  });
  socketRef.current = socket;

  const send = useCallback((message: ClientMessage) => {
    socketRef.current?.send(JSON.stringify(message));
  }, []);

  const voice = useVoice({ userId, participants: serverState.participants, send });
  useEffect(() => {
    voiceHandleSignalRef.current = voice.handleSignal;
  }, [voice.handleSignal]);

  const isHost = serverState.hostId != null && serverState.hostId === userId;
  const hasVideo = serverState.videoId != null;
  const sliderValue = dragging ? dragValue : displayTime;

  const namedParticipants = serverState.participants.filter((p) => p.name);
  const synced =
    namedParticipants.length > 0 &&
    namedParticipants.every((p) => p.connected) &&
    serverState.isPlaying;

  const handleProgress = useCallback(
    (currentTime: number, dur: number, _isPlaying: boolean) => {
      if (dur && Number.isFinite(dur)) setDuration(dur);
      setDisplayTime((prev) => (dragging ? prev : currentTime));
    },
    [dragging]
  );

  const togglePlayPause = useCallback(() => {
    const player = playerRef.current;
    if (!player || !serverStateRef.current.videoId) return;
    const position = player.getCurrentTime();
    if (serverStateRef.current.isPlaying) {
      player.pause();
      send({ type: "pause", positionSeconds: position });
    } else {
      player.play();
      send({ type: "play", positionSeconds: position });
    }
  }, [send]);

  const commitSeek = useCallback(
    (value: number) => {
      playerRef.current?.seekTo(value);
      send({ type: "seek", positionSeconds: value });
      setDragging(false);
    },
    [send]
  );

  const submitVideo = useCallback(
    (id: string) => {
      setInputError(null);
      setVideoInput("");
      send({ type: "loadVideo", videoId: id });
    },
    [send]
  );

  const handleLoadVideo = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseYouTubeId(videoInput);
    if (!id) {
      setInputError("That doesn't look like a YouTube link.");
      return;
    }
    submitVideo(id);
  };

  const handleJoinPlayback = () => {
    setActive(true);
    // Prime playback inside the user gesture so autoplay is allowed afterwards.
    if (serverStateRef.current.isPlaying) playerRef.current?.play();
  };

  // Fullscreen can also be exited via Escape or the browser's own UI, not
  // just our button, so track the real state via the browser's own event
  // rather than just flipping a boolean on click.
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      videoContainerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Fullscreen-only auto-hiding controls (play/pause, seek, chat, exit): show
  // on entry/interaction, fade out after a few seconds idle — same pattern as
  // real video players, so the video itself isn't permanently covered.
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
    hideControlsTimeoutRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  useEffect(() => {
    if (isFullscreen) {
      // Entering fullscreen is exactly the kind of external event this
      // effect exists to synchronize with (see the fullscreenchange
      // listener above), same reasoning as the myName/myLanguage effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      revealControls();
    } else if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
      hideControlsTimeoutRef.current = null;
    }
  }, [isFullscreen, revealControls]);

  // Chat is "visible" (so new messages count as seen, no badge/toast needed)
  // when: desktop's permanent sidebar is showing (not fullscreen), mobile's
  // Chat tab is selected, or the fullscreen chat overlay is open.
  const [fullscreenChatOpen, setFullscreenChatOpen] = useState(false);
  const chatMessageCount = feed.filter((item) => item.kind === "chat").length;
  const chatIsVisible = fullscreenChatOpen || (!isFullscreen && (isDesktop || sheetExpanded));
  // Catch lastSeenChatCount up to the current total whenever chat is visible
  // (both the moment it becomes visible, and continuously while it stays
  // visible and new messages arrive) — adjusting state during render like
  // this, rather than in an effect, avoids an extra cascading render.
  if (chatIsVisible && lastSeenChatCount !== chatMessageCount) {
    setLastSeenChatCount(chatMessageCount);
  }
  const unreadChatCount = chatIsVisible ? 0 : Math.max(0, chatMessageCount - lastSeenChatCount);

  // Exiting fullscreen closes the overlay too, so it doesn't linger open
  // (unexpectedly) if they go fullscreen again later. Adjusting state during
  // render like this, rather than in an effect, avoids an extra cascading
  // render (same reasoning as the lastSeenChatCount adjustment above).
  if (!isFullscreen && fullscreenChatOpen) {
    setFullscreenChatOpen(false);
  }

  // A brief on-video toast for new messages while fullscreen and the chat
  // overlay isn't already open (no need to announce what's already visible).
  const [fullscreenToast, setFullscreenToast] = useState<{ id: string; name: string; text: string } | null>(null);
  const lastToastedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isFullscreen || fullscreenChatOpen) return;
    const lastChat = [...feed].reverse().find((item) => item.kind === "chat");
    if (!lastChat || lastChat.id === lastToastedIdRef.current) return;
    lastToastedIdRef.current = lastChat.id;
    setFullscreenToast({ id: lastChat.id, name: lastChat.name, text: lastChat.text });
    const timeout = setTimeout(() => setFullscreenToast(null), 4000);
    return () => clearTimeout(timeout);
  }, [feed, isFullscreen, fullscreenChatOpen]);

  const handleNameSubmit = (name: string) => {
    setMyName(name);
    setDisplayName(name);
    send({ type: "setName", name });
  };

  const handleLanguageChange = (code: string) => {
    setMyLanguage(code);
    setLanguagePref(code);
    send({ type: "setLanguage", language: code });
  };

  const handleSendChat = async (text: string) => {
    // Translate for whoever else is in the room and reading in a different
    // language. No API call at all for an all-English (or same-language) room.
    const targetLanguages = Array.from(
      new Set(
        serverState.participants
          .filter((p) => p.name && p.connected && p.userId !== userId && p.language !== myLanguage)
          .map((p) => p.language)
      )
    );

    let translations: Record<string, string> | undefined;
    if (targetLanguages.length > 0) {
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, targetLanguages }),
        });
        const data = await res.json();
        if (data?.translations && typeof data.translations === "object") {
          translations = data.translations;
        }
      } catch {
        /* translation unavailable; send without it */
      }
    }

    send({ type: "chat", text, translations });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; ignore */
    }
  };

  return (
    <>
      {/* `fixed`-positioned overlays (NamePrompt) must live outside the
          animated column below: its entrance animation leaves a lingering
          `transform` (animation-fill-mode "both"), and any transformed
          ancestor becomes the containing block for `position: fixed`
          descendants — nesting them in here would position them relative to
          this div, not the viewport. ChatSheet is fixed on mobile too, for
          the same reason, but on desktop (lg:) it switches to a normal flex
          sidebar sitting beside this column, YouTube-Live-chat style.

          Deliberately NOT height-constrained with its own inner scroll on
          desktop: an earlier version boxed this into a fixed-height row with
          a separate scrolling region, which made the category rows below
          the fold feel broken/missing (scrolling the page didn't reveal
          them — you had to find the *inner* scrollbar). A real webpage just
          scrolls the whole page; only the chat sidebar stays pinned (via
          `sticky` in ChatSheet) while that happens. */}
      <div className="flex flex-1 flex-col lg:flex-row lg:items-start lg:gap-4 lg:py-4">
        <div className="flex min-h-full flex-1 flex-col animate-room-enter lg:rounded-2xl lg:border lg:border-white/6">
          {/* Header: room code + presence + connection status */}
          <header className="flex items-center justify-between gap-3 border-b border-white/6 px-4 py-4">
            <div className="flex items-center gap-2">
              <span className="rounded-2xl border border-white/6 bg-surface px-3 py-1.5 font-mono text-base tracking-[0.2em] text-text">
                {roomId}
              </span>
              {isHost && (
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-dim">
                  Host
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Presence participants={serverState.participants} synced={synced} />
              <button
                onClick={voice.toggleMic}
                aria-label={voice.myMicOn === null ? "Turn on mic" : voice.myMicOn ? "Mute mic" : "Unmute mic"}
                title={voice.myMicOn === null ? "Turn on mic" : voice.myMicOn ? "Mute mic" : "Unmute mic"}
                className={`flex h-11 w-11 items-center justify-center rounded-full transition duration-150 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  voice.myMicOn ? "bg-accent text-white" : "bg-surface-2 text-text-dim"
                }`}
              >
                {voice.myMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </button>
              <button
                onClick={copyLink}
                aria-label={copied ? "Copied" : "Copy link"}
                title={copied ? "Copied" : "Copy link"}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-text transition duration-150 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              </button>
              {/* Watch/Chat tab switch — mobile only. Desktop always shows
                  chat in its permanent sidebar, so this control is pointless
                  there. */}
              <button
                onClick={() => setSheetExpanded((prev) => !prev)}
                aria-label={sheetExpanded ? "Back to video" : "Open chat"}
                title={sheetExpanded ? "Back to video" : "Open chat"}
                className={`relative flex h-11 w-11 items-center justify-center rounded-full transition duration-150 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:hidden ${
                  sheetExpanded ? "bg-accent text-white" : "bg-surface-2 text-text"
                }`}
              >
                <MessageCircle className="h-4 w-4" />
                {unreadChatCount > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-bg" />
                )}
              </button>
            </div>
          </header>

          {connected === false && (
            <div className="mx-4 mb-2 flex items-center gap-2 rounded-2xl border border-white/6 bg-surface px-4 py-3 text-sm text-text-dim">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              Lost connection — reconnecting…
            </div>
          )}

          {voice.micError && (
            <div className="mx-4 mb-2 rounded-2xl border border-white/6 bg-surface px-4 py-3 text-sm text-text-dim">
              {voice.micError}
            </div>
          )}

          {/* Video: full-bleed on mobile. Shrinks to a pinned mini-bar while
              the (mobile-only) chat sheet is expanded — on desktop (lg:) it
              always stays full-size since chat is a sidebar, not an overlay.
              Fullscreen (via our own button, not YouTube's — see
              YouTubePlayer's fs:0) overrides both, since this exact div is
              what gets handed to the Fullscreen API. */}
          <div
            ref={videoContainerRef}
            className={`relative w-full bg-bg ${isFullscreen ? "h-screen" : sheetExpanded ? "h-20 lg:aspect-video" : "aspect-video"}`}
          >
            {hasVideo ? (
              <YouTubePlayer
                ref={playerRef}
                target={serverState}
                clockOffset={clockOffset}
                active={active}
                onProgress={handleProgress}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                <p className="max-w-[240px] text-[15px] leading-relaxed text-text-dim">
                  {isHost
                    ? "Search for a video to start the show."
                    : "Waiting for the host to press play."}
                </p>
              </div>
            )}

            {/* Tap-to-join gate (unlocks mobile autoplay with one gesture). */}
            {hasVideo && !active && (
              <button
                onClick={handleJoinPlayback}
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg/70 backdrop-blur-sm focus-visible:outline-none"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white">
                  <Play className="h-7 w-7" fill="currentColor" strokeWidth={0} />
                </span>
                <span className="text-sm font-medium text-text">Tap to join playback</span>
              </button>
            )}

            {/* Transparent tap layer: keeps all control in our hands (blocks YouTube's
                own gestures). Normally a tap toggles play/pause directly; in
                fullscreen a tap instead just reveals the auto-hiding controls
                below (a real play/pause button lives there) — so checking
                how much time is left never accidentally pauses the video. */}
            {hasVideo && active && (
              <button
                aria-label={isFullscreen ? "Show controls" : "Toggle play/pause"}
                onClick={isFullscreen ? revealControls : togglePlayPause}
                className="absolute inset-0 z-10 cursor-pointer"
              />
            )}

            {/* Enter fullscreen. Once inside, the unified controls bar below
                has its own "Exit fullscreen" button instead. */}
            {hasVideo && !isFullscreen && (
              <button
                onClick={toggleFullscreen}
                aria-label="Fullscreen"
                title="Fullscreen"
                className="absolute bottom-3 right-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-bg/60 text-text backdrop-blur-sm transition duration-150 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}

            {/* Brief on-video toast for a new message while fullscreen and
                the chat overlay isn't already open. Independent of the
                auto-hiding controls below — it's a notification, not a control. */}
            {fullscreenToast && (
              <div className="absolute right-3 top-3 z-30 max-w-[70%] rounded-2xl border border-white/6 bg-surface/90 px-3.5 py-2.5 backdrop-blur-sm">
                <p className="text-xs font-medium text-text-dim">{fullscreenToast.name}</p>
                <p className="line-clamp-2 text-sm text-text">{fullscreenToast.text}</p>
              </div>
            )}

            {/* Fullscreen-only controls: play/pause, seek, chat, exit — all
                fade out together after a few seconds idle, and back in on
                any tap/interaction. Everything outside this container is
                hidden by the browser during real fullscreen, so this is also
                the only way to reach chat while fullscreen. */}
            {isFullscreen && (
              <div
                className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-3 pt-10 transition-opacity duration-300 ${
                  controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      togglePlayPause();
                      revealControls();
                    }}
                    disabled={!hasVideo}
                    aria-label={serverState.isPlaying ? "Pause" : "Play"}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition duration-150 ease-out active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {serverState.isPlaying ? (
                      <Pause className="h-5 w-5" fill="currentColor" strokeWidth={0} />
                    ) : (
                      <Play className="h-5 w-5" fill="currentColor" strokeWidth={0} />
                    )}
                  </button>

                  <span className="w-10 shrink-0 text-right font-mono text-xs text-white/80">
                    {formatTime(sliderValue)}
                  </span>

                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.5}
                    value={Math.min(sliderValue, duration || 0)}
                    disabled={!hasVideo || !duration}
                    onChange={(e) => {
                      setDragging(true);
                      setDragValue(Number(e.target.value));
                      revealControls();
                    }}
                    onPointerUp={() => dragging && commitSeek(dragValue)}
                    onKeyUp={() => dragging && commitSeek(dragValue)}
                    className="h-1.5 w-full min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-accent disabled:opacity-40"
                  />

                  <span className="w-10 shrink-0 font-mono text-xs text-white/80">{formatTime(duration)}</span>

                  <button
                    onClick={() => {
                      setFullscreenChatOpen((prev) => !prev);
                      revealControls();
                    }}
                    aria-label={fullscreenChatOpen ? "Close fullscreen chat" : "Open fullscreen chat"}
                    title={fullscreenChatOpen ? "Close fullscreen chat" : "Open fullscreen chat"}
                    className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition duration-150 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      fullscreenChatOpen ? "bg-accent text-white" : "bg-white/10 text-white"
                    }`}
                  >
                    <MessageCircle className="h-4 w-4" />
                    {unreadChatCount > 0 && !fullscreenChatOpen && (
                      <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-1 ring-bg" />
                    )}
                  </button>

                  <button
                    onClick={() => {
                      toggleFullscreen();
                    }}
                    aria-label="Exit fullscreen"
                    title="Exit fullscreen"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition duration-150 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Minimize2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* The actual fullscreen chat overlay, opened via the button
                above. Translucent (not a solid panel) and fades with the
                controls above so it never permanently sits over the video —
                tapping the video brings both back without pausing playback. */}
            {isFullscreen && fullscreenChatOpen && (
              <div
                onClick={revealControls}
                className={`absolute inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-white/6 bg-surface/50 backdrop-blur-md transition-opacity duration-300 ${
                  controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
              >
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/6 px-4">
                  <span className="text-sm font-semibold text-text">Chat</span>
                  <button
                    onClick={() => setFullscreenChatOpen(false)}
                    aria-label="Close fullscreen chat"
                    className="text-text-dim"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <ChatMessageList feed={feed} myUserId={userId} myLanguage={myLanguage} />
                <ChatComposer onSend={handleSendChat} />
              </div>
            )}
          </div>

          {/* Control bar + picker: hidden on mobile while the chat sheet is
              expanded (it covers this area), but always shown on desktop
              (lg:) since chat is a sidebar there, never covering the video. */}
          <div className={`${sheetExpanded ? "hidden" : "flex"} flex-col lg:flex`}>
            {/* Control bar */}
            <div className="flex items-center gap-3 border-t border-white/6 px-4 py-3">
              <button
                onClick={togglePlayPause}
                disabled={!hasVideo}
                aria-label={serverState.isPlaying ? "Pause" : "Play"}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-white transition duration-150 ease-out active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                {serverState.isPlaying ? (
                  <Pause className="h-5 w-5" fill="currentColor" strokeWidth={0} />
                ) : (
                  <Play className="h-5 w-5" fill="currentColor" strokeWidth={0} />
                )}
              </button>

              <span className="w-12 shrink-0 text-right font-mono text-xs text-text-dim">
                {formatTime(sliderValue)}
              </span>

              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.5}
                value={Math.min(sliderValue, duration || 0)}
                disabled={!hasVideo || !duration}
                onChange={(e) => {
                  setDragging(true);
                  setDragValue(Number(e.target.value));
                }}
                onPointerUp={() => dragging && commitSeek(dragValue)}
                onKeyUp={() => dragging && commitSeek(dragValue)}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-accent disabled:opacity-40"
              />

              <span className="w-12 shrink-0 font-mono text-xs text-text-dim">
                {formatTime(duration)}
              </span>
            </div>

            {/* Host-only video picker: browse trending videos or search is
                primary (YouTube's search quota is small, so this isn't
                debounced/live — see VideoBrowser), with paste-a-link as a
                fallback toggle. */}
            {isHost && (
              <div className="flex flex-col gap-2 border-t border-white/6 bg-surface px-4 py-4">
                {pickerMode === "search" ? (
                  <>
                    <VideoBrowser onSelect={submitVideo} />
                    <button
                      type="button"
                      onClick={() => setPickerMode("paste")}
                      className="self-start text-xs text-text-dim underline-offset-2 hover:underline"
                    >
                      Or paste a link instead
                    </button>
                  </>
                ) : (
                  <>
                    <form onSubmit={handleLoadVideo} className="flex gap-2">
                      <input
                        type="text"
                        inputMode="url"
                        value={videoInput}
                        onChange={(e) => setVideoInput(e.target.value)}
                        placeholder="Paste a YouTube link"
                        className="min-w-0 flex-1 rounded-2xl border border-white/6 bg-surface-2 px-4 py-3 text-sm text-text placeholder:text-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                      <button
                        type="submit"
                        className="shrink-0 rounded-2xl bg-surface-2 px-4 py-3 text-sm font-semibold text-text transition duration-150 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        Load video
                      </button>
                    </form>
                    {inputError && <p className="text-xs text-text-dim">{inputError}</p>}
                    <button
                      type="button"
                      onClick={() => setPickerMode("search")}
                      className="self-start text-xs text-text-dim underline-offset-2 hover:underline"
                    >
                      Or search instead
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <ChatSheet
          feed={feed}
          myUserId={userId}
          myLanguage={myLanguage}
          onLanguageChange={handleLanguageChange}
          expanded={sheetExpanded}
          onExpandedChange={setSheetExpanded}
          onSend={handleSendChat}
        />
      </div>

      {!myName && <NamePrompt onSubmit={handleNameSubmit} />}

      {Array.from(voice.remoteStreams.entries()).map(([id, stream]) => (
        <audio
          key={id}
          autoPlay
          playsInline
          ref={(el) => {
            if (!el) return;
            if (el.srcObject !== stream) el.srcObject = stream;
            // Autoplay can still be blocked even after an earlier mic-button
            // gesture (iOS Safari in particular) — retry play() explicitly
            // rather than leaving the remote party silently inaudible.
            el.play().catch(() => {});
          }}
        />
      ))}
    </>
  );
}

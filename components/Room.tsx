"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import usePartySocket from "partysocket/react";
import type { PartySocket } from "partysocket";
import {
  Check,
  LogOut,
  Loader2,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  Minimize2,
  Play,
  Share2,
} from "lucide-react";
import {
  addRecentRoom,
  getDisplayName,
  getLanguagePref,
  getRealtimeHost,
  getUserId,
  normalizeRoomCode,
  setDisplayName,
  setLanguagePref,
} from "@/lib/room";
import { parseYouTubeId } from "@/lib/youtube";
import { INITIAL_ROOM_STATE, type ClientMessage, type FeedItem, type RoomState, type RtcSignal, type ServerMessage } from "@/lib/types";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useVoice } from "@/lib/useVoice";
import YouTubePlayer, { type PlayerHandle, type UserAction } from "./YouTubePlayer";
import NamePrompt from "./NamePrompt";
import ChatSheet, { ChatComposer, ChatMessageList } from "./ChatSheet";
import Presence from "./Presence";
import VideoBrowser from "./VideoBrowser";

// How long the fullscreen chat overlay stays visible after activity before
// fading out, mirroring a real player's auto-hiding controls.
const CHAT_FADE_MS = 8000;

export default function Room({ code }: { code: string }) {
  const router = useRouter();
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

  // Recorded regardless of naming status -- even a quick visit is worth
  // remembering, since the landing page's "recent rooms" list is mainly for
  // getting back into a room from the home-screen icon, where there's no
  // browser back button to fall back on.
  useEffect(() => {
    addRecentRoom(roomId);
  }, [roomId]);

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

  const [videoInput, setVideoInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<"search" | "paste">("search");
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // The one-time room-entrance animation (animate-room-enter, see
  // globals.css) uses animation-fill-mode: both, so its final-frame
  // `transform: translateY(0)` lingers on this div forever after the 400ms
  // animation finishes -- even though it's a visual no-op, ANY non-none
  // transform makes that div the CSS containing block for `position: fixed`
  // descendants, which broke the fullscreen video container (it was being
  // sized relative to this column instead of the real viewport, so it
  // wasn't actually clipped to the screen). Stripping the class once the
  // animation is done removes the transform for good; visually seamless
  // since the animation's resting frame already matches the un-animated
  // default. A plain timeout, not onAnimationEnd: that event depends on the
  // browser actually firing it, which isn't guaranteed on every device/OS
  // combination, and never fires at all when prefers-reduced-motion turns
  // the animation off entirely (animation: none) -- a fixed delay works
  // unconditionally either way, with a little headroom past 400ms.
  const [roomEnterDone, setRoomEnterDone] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setRoomEnterDone(true), 500);
    return () => clearTimeout(timeout);
  }, []);

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
    host: getRealtimeHost(),
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

  const namedParticipants = serverState.participants.filter((p) => p.name);
  const synced =
    namedParticipants.length > 0 &&
    namedParticipants.every((p) => p.connected) &&
    serverState.isPlaying;

  // The viewer used YouTube's own native controls (play, pause, or scrubbed
  // the seek bar) — see YouTubePlayer's checkForUserAction for how this is
  // detected without an echo loop back from our own server-driven reconcile.
  const handleUserAction = useCallback(
    (action: UserAction) => {
      send({ type: action.type, positionSeconds: action.positionSeconds });
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
    if (isFullscreen) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        // We're in the CSS-only fallback below (no real fullscreenElement
        // to exit, since requestFullscreen either isn't supported or
        // rejected) -- just clear our own state directly.
        setIsFullscreen(false);
      }
      return;
    }

    // iOS Safari doesn't support the Fullscreen API for arbitrary elements
    // (only <video> tags, via a separate non-standard webkit-only API) --
    // requestFullscreen is either missing or silently rejects there. Either
    // way, fall back to a plain CSS "take over the screen" mode instead of
    // a dead button: the fullscreenchange listener above only ever fires
    // for a REAL transition, so it won't interfere with this fallback.
    const supportsFullscreen = document.fullscreenEnabled && !!videoContainerRef.current?.requestFullscreen;
    if (!supportsFullscreen) {
      setIsFullscreen(true);
      return;
    }
    videoContainerRef.current!.requestFullscreen().catch(() => setIsFullscreen(true));
  }, [isFullscreen]);

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

  // Our own leftover fullscreen UI (the chat-toggle/exit-fullscreen corner
  // buttons, and the chat panel when open) fully disappears after a few
  // seconds of no activity WHILE THE VIDEO IS PLAYING, and comes back the
  // moment either side pauses -- pausing is the one video-state signal we
  // actually have (via the synced `serverState.isPlaying`), unlike a bare
  // "tap the video" gesture, which happens inside YouTube's cross-origin
  // iframe and can never reach our code at all (confirmed: iframe content
  // is a separate document, its clicks don't bubble to the parent page).
  // So "reappear on pause" is the real, reliable equivalent of "tap to see
  // the controls" here. While paused, it just stays visible indefinitely
  // (no countdown) -- resuming playback restarts the fade-out clock.
  const [chatFadeVisible, setChatFadeVisible] = useState(true);
  const chatFadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealChatOverlay = useCallback(() => {
    setChatFadeVisible(true);
    if (chatFadeTimeoutRef.current) clearTimeout(chatFadeTimeoutRef.current);
    chatFadeTimeoutRef.current = setTimeout(() => setChatFadeVisible(false), CHAT_FADE_MS);
  }, []);
  useEffect(() => {
    if (!isFullscreen) return;
    // Synchronizing with external state/timers (playback state, setTimeout),
    // not deriving state from props -- entering fullscreen, pausing,
    // resuming, opening the panel, or a new message arriving are all
    // external events that should affect the fade-out clock.
    if (!serverState.isPlaying) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChatFadeVisible(true);
      if (chatFadeTimeoutRef.current) clearTimeout(chatFadeTimeoutRef.current);
      return;
    }
    revealChatOverlay();
    return () => {
      if (chatFadeTimeoutRef.current) clearTimeout(chatFadeTimeoutRef.current);
    };
    // chatMessageCount is intentionally included: a new message while the
    // panel is open should reset the fade timer too, same as any other
    // activity.
  }, [isFullscreen, serverState.isPlaying, fullscreenChatOpen, chatMessageCount, revealChatOverlay]);

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
  }, [feed, isFullscreen, fullscreenChatOpen]);
  // Auto-hide the toast on its own timer, independent of the effect above --
  // that one re-runs on every `feed` change, including unrelated system
  // notices (someone reconnecting, a mic toggle), and if its cleanup ran
  // without also scheduling a fresh timeout, the toast would get "stuck"
  // permanently visible the moment any such notice arrived mid-countdown.
  useEffect(() => {
    if (!fullscreenToast) return;
    const timeout = setTimeout(() => setFullscreenToast(null), 4000);
    return () => clearTimeout(timeout);
  }, [fullscreenToast]);

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
        // A few prior messages, oldest-first, so the model can resolve things
        // like an ambiguous "it" or a callback to what was just said instead
        // of translating this message in total isolation.
        const context = feed
          .filter((item) => item.kind === "chat")
          .slice(-4)
          .map((item) => ({ name: item.name, text: item.text }));
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, targetLanguages, context }),
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

  const handleLeaveRoom = () => {
    // Closing the socket (component unmount, via usePartySocket's own
    // cleanup) is all "leaving" needs -- the worker already marks the
    // participant disconnected and posts "X left the room" on close, and
    // the room code still works to rejoin later since nothing here is
    // destructive.
    router.push("/");
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
        <div
          className={`flex min-h-full flex-1 flex-col lg:rounded-2xl lg:border lg:border-white/6 ${roomEnterDone ? "" : "animate-room-enter"}`}
        >
          {/* Header: room code + presence + connection status */}
          <header className="flex items-center justify-between gap-2 border-b border-white/6 px-3 py-4">
            <div className="flex items-center gap-1.5">
              {/* Leave room: anyone can step out. Just navigates home --
                  closing the socket already makes the worker mark the
                  participant disconnected and post its own "left the room"
                  system message, and the room code still works to rejoin
                  later. Not accent-colored on purpose -- accent is reserved
                  for playing/synced/presence state, not routine navigation. */}
              <button
                onClick={handleLeaveRoom}
                aria-label="Leave room"
                title="Leave room"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-text-dim transition duration-150 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <LogOut className="h-4 w-4" />
              </button>
              <span className="flex items-center gap-1.5 rounded-2xl border border-white/6 bg-surface py-1.5 pl-2.5 pr-1.5 font-mono text-base tracking-[0.15em] text-text">
                {roomId}
                {/* Nested inside the room-code chip rather than its own
                    separate pill -- with the leave button added to this
                    side too, a standalone badge (own border/padding/gap)
                    pushed the header past 390px and clipped the chat
                    toggle off the right edge entirely. */}
                {isHost && (
                  <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-sans text-[10px] font-medium tracking-normal text-text-dim">
                    HOST
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
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
              what gets handed to the Fullscreen API.

              The `fixed inset-0` fullscreen styling applies whether we got
              a real OS-level fullscreen element or fell back to the
              CSS-only mode (see toggleFullscreen) -- when it IS a real
              fullscreen element, the browser already isolates it from the
              rest of the page, so `fixed` just fills that isolated
              viewport; when it's the fallback, `fixed` is what makes it
              actually cover the screen at all, since nothing else does.

              Play/pause/seek use YouTube's own native controls (no custom
              overlay competing with them for space) — see YouTubePlayer's
              checkForUserAction for how those still stay in sync across
              both people's screens despite not going through our own button
              handlers anymore. */}
          <div
            ref={videoContainerRef}
            className={
              isFullscreen
                ? "fixed inset-0 z-50 h-screen w-screen bg-bg"
                : `relative w-full bg-bg ${sheetExpanded ? "h-20 lg:aspect-video" : "aspect-video"}`
            }
          >
            {hasVideo ? (
              <YouTubePlayer
                ref={playerRef}
                target={serverState}
                clockOffset={clockOffset}
                active={active}
                onUserAction={handleUserAction}
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

            {/* Our own fullscreen toggle: fs:0 disables YouTube's native one
                on purpose (their fullscreen would target the bare iframe, not
                our container, breaking the chat overlay below). Small and
                always visible — YouTube's own controls already have their
                own auto-hide behavior, so this doesn't need to match it. */}
            {hasVideo && !isFullscreen && (
              <button
                onClick={toggleFullscreen}
                aria-label="Fullscreen"
                title="Fullscreen"
                className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-bg/60 text-text backdrop-blur-sm transition duration-150 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}

            {/* Brief on-video toast for a new message while fullscreen and
                the chat overlay isn't already open. Left side, so it never
                overlaps the fullscreen/chat buttons on the right. Dropped
                down below YouTube's own top-right icon row (see the buttons
                below for why top-3 doesn't clear it). */}
            {fullscreenToast && (
              <div className="absolute left-3 top-12 z-30 max-w-[70%] rounded-2xl border border-white/6 bg-surface/90 px-3.5 py-2.5 backdrop-blur-sm">
                <p className="text-xs font-medium text-text-dim">{fullscreenToast.name}</p>
                <p className="line-clamp-2 text-sm text-text">{fullscreenToast.text}</p>
              </div>
            )}

            {/* Lets ANY tap or mouse move anywhere on the fullscreen video
                wake the chat/exit icons back up, not just a specific spot
                near them -- only rendered while they're faded, and gone the
                instant they're revealed (pointer-events only matter while
                this div exists at all, so there's nothing left to block
                real interaction with the video/YouTube's own controls the
                rest of the time). Sits below the icons and the open chat
                panel (z-10 vs their z-40/z-50) so it never intercepts taps
                meant for those once visible.

                The wake-up tap is fully consumed here rather than also
                reaching YouTube underneath (cross-origin iframe -- we can't
                see or forward the event even if we wanted to). That
                matches how every real hidden-chrome video player already
                works: a first tap just brings the controls back, a second,
                deliberate tap actually operates one. */}
            {isFullscreen && !chatFadeVisible && (
              <div onClick={revealChatOverlay} onMouseMove={revealChatOverlay} className="absolute inset-0 z-10" />
            )}

            {/* Fullscreen hides everything outside this container, including
                the chat sidebar/tab — these two buttons are the only way to
                reach chat or exit fullscreen while fullscreen. Sat at top-3
                originally, but that overlaps YouTube's OWN clickable
                volume/CC/settings icon row up around y=10-40 during active
                playback (confirmed via screenshot) -- top-12 sits just below
                that row, close without covering (or blocking taps meant
                for) those icons. It CAN still overlap YouTube's separate
                title/channel text overlay in the rare case of a two-line
                title (up to ~90px tall) -- accepted as a minor, occasional
                cosmetic overlap, since that text isn't interactive the way
                the icon row is. Reveal duty lives entirely in the
                full-screen catcher above now, so this wrapper doesn't need
                its own hover/click handling -- it just needs to get out of
                that catcher's way while faded (pointer-events-none),
                otherwise its own footprint (even a supposedly-invisible
                one) would swallow the wake-up tap before it reaches the
                catcher underneath. */}
            {isFullscreen && (
              <div
                className={`absolute right-3 top-12 z-50 flex items-start gap-3 ${chatFadeVisible ? "" : "pointer-events-none"}`}
              >
                <button
                  // No onPointerDown reveal here on purpose -- this button's
                  // own onClick already decides reveal-vs-open-vs-close by
                  // reading chatFadeVisible, and pointerdown fires before
                  // click. Flipping chatFadeVisible to true on pointerdown
                  // would make the click handler think it's already fully
                  // visible and close it instead of revealing it. (Hovering
                  // via the wrapper above doesn't have this problem: a real
                  // mouse always hovers the button before clicking it, so
                  // chatFadeVisible is already true well before the click.)
                  onClick={() => {
                    if (!fullscreenChatOpen) {
                      setFullscreenChatOpen(true);
                    } else if (!chatFadeVisible) {
                      // Overlay is open but faded out -- bring it back
                      // instead of closing it, same as tapping a real
                      // player's controls back into view.
                      revealChatOverlay();
                    } else {
                      setFullscreenChatOpen(false);
                    }
                  }}
                  aria-label={fullscreenChatOpen ? "Close fullscreen chat" : "Open fullscreen chat"}
                  title={fullscreenChatOpen ? "Close fullscreen chat" : "Open fullscreen chat"}
                  className={`relative flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-sm transition-[opacity,background-color] duration-200 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    fullscreenChatOpen ? "bg-accent text-white" : "bg-bg/60 text-text"
                  } ${chatFadeVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
                >
                  <MessageCircle className="h-4 w-4" />
                  {unreadChatCount > 0 && !fullscreenChatOpen && (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-1 ring-bg" />
                  )}
                </button>

                <button
                  onPointerDown={revealChatOverlay}
                  onClick={toggleFullscreen}
                  aria-label="Exit fullscreen"
                  title="Exit fullscreen"
                  className={`flex h-11 w-11 items-center justify-center rounded-full bg-bg/60 text-text backdrop-blur-sm transition-opacity duration-200 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    chatFadeVisible ? "opacity-100" : "pointer-events-none opacity-0"
                  }`}
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* The actual fullscreen chat overlay, opened via the button
                above. Translucent (not a solid panel) so it never fully
                blocks the video. Fades out after CHAT_FADE_MS of no
                activity (like a real player's controls) and stays
                logically "open" while faded -- the toggle button reveals
                it again on tap rather than closing it. pointer-events-none
                while faded so a tap passes through to the video/YouTube's
                own controls underneath instead of hitting invisible chat
                controls. */}
            {isFullscreen && fullscreenChatOpen && (
              <div
                onPointerDown={revealChatOverlay}
                onKeyDown={revealChatOverlay}
                onMouseMove={revealChatOverlay}
                className={`absolute inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-white/6 bg-surface/50 backdrop-blur-md transition-opacity duration-200 ease-out ${
                  chatFadeVisible ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
              >
                {/* No close button here on purpose -- it would sit in the
                    same top-right corner as the always-on-top chat-toggle
                    and exit-fullscreen buttons (z-50) and get visually
                    covered by them. Those two already open/close this
                    overlay, so this header is just a label. */}
                <div className="flex h-11 shrink-0 items-center border-b border-white/6 px-4">
                  <span className="text-sm font-semibold text-text">Chat</span>
                </div>
                <ChatMessageList feed={feed} myUserId={userId} myLanguage={myLanguage} />
                <ChatComposer onSend={handleSendChat} />
              </div>
            )}
          </div>

          {/* Picker: hidden on mobile while the chat sheet is expanded (it
              covers this area), but always shown on desktop (lg:) since chat
              is a sidebar there, never covering the video. */}
          <div className={`${sheetExpanded ? "hidden" : "flex"} flex-col lg:flex`}>
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
                        className="min-w-0 flex-1 rounded-2xl border border-white/6 bg-surface-2 px-4 py-3 text-base text-text placeholder:text-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

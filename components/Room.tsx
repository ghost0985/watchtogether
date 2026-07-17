"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import usePartySocket from "partysocket/react";
import type { PartySocket } from "partysocket";
import { Check, Loader2, Mic, MicOff, Pause, Play, Share2 } from "lucide-react";
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
import { useVoice } from "@/lib/useVoice";
import YouTubePlayer, { type PlayerHandle } from "./YouTubePlayer";
import NamePrompt from "./NamePrompt";
import ChatSheet from "./ChatSheet";
import Presence from "./Presence";

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
  const [myName, setMyName] = useState(() => getDisplayName());
  const [myLanguage, setMyLanguage] = useState(() => getLanguagePref());

  const [serverState, setServerState] = useState<RoomState>(INITIAL_ROOM_STATE);
  const [clockOffset, setClockOffset] = useState(0);
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(false);

  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  // Control-bar UI state (driven by the player's progress callback).
  const [displayTime, setDisplayTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  const [videoInput, setVideoInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const playerRef = useRef<PlayerHandle>(null);
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

  const handleLoadVideo = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseYouTubeId(videoInput);
    if (!id) {
      setInputError("That doesn't look like a YouTube link.");
      return;
    }
    setInputError(null);
    setVideoInput("");
    send({ type: "loadVideo", videoId: id });
  };

  const handleJoinPlayback = () => {
    setActive(true);
    // Prime playback inside the user gesture so autoplay is allowed afterwards.
    if (serverStateRef.current.isPlaying) playerRef.current?.play();
  };

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
      {/* `fixed`-positioned overlays (NamePrompt, ChatSheet) must live outside
          this div: its entrance animation leaves a lingering `transform`
          (animation-fill-mode "both"), and any transformed ancestor becomes
          the containing block for `position: fixed` descendants — nesting
          them in here would position them relative to this div, not the
          viewport. */}
      <div className={`flex min-h-full flex-col animate-room-enter ${sheetExpanded ? "" : "pb-[32vh]"}`}>
        {/* Header: room code + presence + connection status */}
        <header className="flex items-center justify-between gap-3 px-4 py-4">
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

        {/* Video: always full-bleed, nothing sits beside it. Shrinks to a pinned
            mini-bar while the chat sheet is expanded (it keeps playing). */}
        <div className={`relative w-full bg-bg ${sheetExpanded ? "h-20" : "aspect-video"}`}>
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
                  ? "Paste a YouTube link to start the show."
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
                <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" strokeWidth={0} />
              </span>
              <span className="text-sm font-medium text-text">Tap to join playback</span>
            </button>
          )}

          {/* Transparent tap layer: keeps all control in our hands (blocks YouTube's
              own gestures) and lets a tap toggle play/pause. */}
          {hasVideo && active && (
            <button
              aria-label="Toggle play/pause"
              onClick={togglePlayPause}
              className="absolute inset-0 z-10 cursor-pointer"
            />
          )}
        </div>

        {!sheetExpanded && (
          <>
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
                  <Play className="h-5 w-5 translate-x-0.5" fill="currentColor" strokeWidth={0} />
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

            {/* Host-only video picker */}
            {isHost && (
              <form
                onSubmit={handleLoadVideo}
                className="flex flex-col gap-2 border-t border-white/6 bg-surface px-4 py-4"
              >
                <div className="flex gap-2">
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
                </div>
                {inputError && <p className="text-xs text-text-dim">{inputError}</p>}
              </form>
            )}
          </>
        )}
      </div>

      {!myName && <NamePrompt onSubmit={handleNameSubmit} />}

      <ChatSheet
        feed={feed}
        myUserId={userId}
        myLanguage={myLanguage}
        onLanguageChange={handleLanguageChange}
        expanded={sheetExpanded}
        onExpandedChange={setSheetExpanded}
        onSend={handleSendChat}
      />

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

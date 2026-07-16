"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import usePartySocket from "partysocket/react";
import type { PartySocket } from "partysocket";
import { PARTYKIT_HOST, getUserId, normalizeRoomCode } from "@/lib/room";
import { parseYouTubeId } from "@/lib/youtube";
import { INITIAL_ROOM_STATE, type ClientMessage, type RoomState, type ServerMessage } from "@/lib/types";
import YouTubePlayer, { type PlayerHandle } from "./YouTubePlayer";
import { error } from "console";

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

  const [serverState, setServerState] = useState<RoomState>(INITIAL_ROOM_STATE);
  const [clockOffset, setClockOffset] = useState(0);
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(false);

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

  const cacheKey = `wt-state-${roomId}`;

  const socket = usePartySocket({
    host: PARTYKIT_HOST,
    room: roomId,
    query: { userId },
    onOpen: () => setConnected(true),
    onClose: () => setConnected(false),
    onMessage: (event: MessageEvent) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (message.type !== "state") return;

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
        } catch (error) {
          console.log(error)
        }
      }
    },
  });
  socketRef.current = socket;

  const send = useCallback((message: ClientMessage) => {
    socketRef.current?.send(JSON.stringify(message));
  }, []);

  const isHost = serverState.hostId != null && serverState.hostId === userId;
  const hasVideo = serverState.videoId != null;
  const sliderValue = dragging ? dragValue : displayTime;

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
      setInputError("Enter a valid YouTube link or video ID.");
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
    <div className="flex min-h-full flex-col bg-neutral-950 text-neutral-100">
      {/* Header: room code + connection status */}
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-400">Room</span>
          <span className="font-mono text-lg font-semibold tracking-widest">
            {roomId}
          </span>
          {isHost && (
            <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs font-medium text-indigo-300">
              Host
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={copyLink}
            className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 active:bg-neutral-700"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              connected ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
            }`}
            title={connected ? "Connected" : "Reconnecting…"}
          />
        </div>
      </header>

      {/* Video */}
      <div className="relative w-full aspect-video bg-black">
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
            <p className="text-neutral-500">
              {isHost
                ? "Paste a YouTube link below to start the party."
                : "Waiting for the host to pick a video…"}
            </p>
          </div>
        )}

        {/* Tap-to-join gate (unlocks mobile autoplay with one gesture). */}
        {hasVideo && !active && (
          <button
            onClick={handleJoinPlayback}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/60 backdrop-blur-sm"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-black">
              <PlayIcon className="h-8 w-8 translate-x-0.5" />
            </span>
            <span className="text-sm font-medium text-white">Tap to join playback</span>
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

      {/* Control bar */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={togglePlayPause}
          disabled={!hasVideo}
          aria-label={serverState.isPlaying ? "Pause" : "Play"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black disabled:opacity-40 active:scale-95"
        >
          {serverState.isPlaying ? (
            <PauseIcon className="h-5 w-5" />
          ) : (
            <PlayIcon className="h-5 w-5 translate-x-0.5" />
          )}
        </button>

        <span className="w-12 shrink-0 text-right font-mono text-xs text-neutral-400">
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
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-neutral-700 accent-indigo-500 disabled:opacity-40"
        />

        <span className="w-12 shrink-0 font-mono text-xs text-neutral-400">
          {formatTime(duration)}
        </span>
      </div>

      {/* Host-only video picker */}
      {isHost && (
        <form onSubmit={handleLoadVideo} className="flex flex-col gap-2 px-4 py-3">
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="url"
              value={videoInput}
              onChange={(e) => setVideoInput(e.target.value)}
              placeholder="Paste a YouTube link or video ID"
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white active:bg-indigo-600"
            >
              Load
            </button>
          </div>
          {inputError && <p className="text-xs text-red-400">{inputError}</p>}
        </form>
      )}
    </div>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}

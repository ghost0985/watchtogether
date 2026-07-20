"use client";

import { useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { loadYouTubeAPI, YT_STATE, type YTPlayer } from "@/lib/youtube";
import type { RoomState } from "@/lib/types";

/** Imperative controls the parent calls when the local user acts. */
export type PlayerHandle = {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
};

/** A play/pause/seek that happened via YouTube's own native controls, to be broadcast to the room. */
export type UserAction = { type: "play" | "pause"; positionSeconds: number };

type Props = {
  /** Authoritative state from the server. */
  target: RoomState;
  /** serverTime - Date.now(), so we can compute the server clock locally. */
  clockOffset: number;
  /** True once the user has tapped to join playback (unlocks autoplay). */
  active: boolean;
  /** Fires ~2x/sec + on transitions to drive the control bar UI. */
  onProgress?: (currentTime: number, duration: number, isPlaying: boolean) => void;
  /** Fires when the *local* viewer used YouTube's own controls (play, pause, or scrubbed the seek bar) — the parent broadcasts it to the room. */
  onUserAction?: (action: UserAction) => void;
  ref?: React.Ref<PlayerHandle>;
};

// Snap to server position on a fresh update if we're off by more than this.
const FRESH_SNAP_THRESHOLD = 0.4;
// Only correct passive drift (the periodic check) beyond this, to avoid jitter.
const DRIFT_THRESHOLD = 1.5;
// A local position jump bigger than this (while not mid-reconcile) is assumed
// to be the viewer scrubbing YouTube's own seek bar, not just drift — must
// be well above DRIFT_THRESHOLD so normal buffering/lag never gets mistaken
// for an intentional seek.
const SEEK_JUMP_THRESHOLD = 3;
const DRIFT_INTERVAL_MS = 5000;
const PROGRESS_INTERVAL_MS = 500;
// How long after we issue a programmatic play/pause/seek to keep ignoring
// the state changes/position jumps it causes, so we don't mistake our own
// server-driven reconciliation for the viewer using the native controls.
const SUPPRESS_WINDOW_MS = 700;

/** Live server-relative position of the video, in seconds. */
function expectedPosition(state: RoomState, clockOffset: number): number {
  if (!state.isPlaying) return Math.max(0, state.positionSeconds);
  const serverNow = Date.now() + clockOffset;
  const elapsed = (serverNow - state.lastUpdateTimestamp) / 1000;
  return Math.max(0, state.positionSeconds + elapsed);
}

export default function YouTubePlayer({
  target,
  clockOffset,
  active,
  onProgress,
  onUserAction,
  ref,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const loadedVideoRef = useRef<string | null>(null);

  // Mirror props into refs so the intervals below always see current values
  // without needing to be torn down and recreated.
  const targetRef = useRef(target);
  const offsetRef = useRef(clockOffset);
  const activeRef = useRef(active);
  const onProgressRef = useRef(onProgress);
  const onUserActionRef = useRef(onUserAction);
  targetRef.current = target;
  offsetRef.current = clockOffset;
  activeRef.current = active;
  onProgressRef.current = onProgress;
  onUserActionRef.current = onUserAction;

  // Whether the *last known* playing state came from us (server reconcile)
  // rather than the viewer, and until when to ignore state changes/position
  // jumps as our own programmatic doing rather than the viewer's.
  const lastKnownPlayingRef = useRef<boolean | null>(null);
  const suppressUntilRef = useRef(0);

  useImperativeHandle(
    ref,
    () => ({
      play: () => playerRef.current?.playVideo(),
      pause: () => playerRef.current?.pauseVideo(),
      seekTo: (seconds: number) => playerRef.current?.seekTo(seconds, true),
      getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
      getDuration: () => playerRef.current?.getDuration() ?? 0,
    }),
    []
  );

  /**
   * Reconcile the local player to the authoritative server state. This only
   * ever issues programmatic calls; it never sends intents itself. Every
   * programmatic call opens a brief suppression window so the resulting
   * onStateChange/position-jump isn't mistaken for the viewer using
   * YouTube's own native controls (which would otherwise re-broadcast the
   * same change straight back at the server in an echo loop).
   */
  const reconcile = useCallback((snapThreshold: number) => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    const state = targetRef.current;

    if (!state.videoId) return;

    // Load a newly-chosen video, starting at the correct position.
    if (state.videoId !== loadedVideoRef.current) {
      loadedVideoRef.current = state.videoId;
      const start = expectedPosition(state, offsetRef.current);
      suppressUntilRef.current = Date.now() + SUPPRESS_WINDOW_MS;
      if (state.isPlaying && activeRef.current) {
        player.loadVideoById(state.videoId, start);
      } else {
        player.cueVideoById(state.videoId, start);
      }
      lastKnownPlayingRef.current = state.isPlaying && activeRef.current;
      return;
    }

    const expected = expectedPosition(state, offsetRef.current);
    if (Math.abs(player.getCurrentTime() - expected) > snapThreshold) {
      suppressUntilRef.current = Date.now() + SUPPRESS_WINDOW_MS;
      player.seekTo(expected, true);
    }

    const playerState = player.getPlayerState();
    if (
      state.isPlaying &&
      activeRef.current &&
      playerState !== YT_STATE.PLAYING &&
      playerState !== YT_STATE.BUFFERING
    ) {
      suppressUntilRef.current = Date.now() + SUPPRESS_WINDOW_MS;
      player.playVideo();
    } else if (!state.isPlaying && playerState === YT_STATE.PLAYING) {
      suppressUntilRef.current = Date.now() + SUPPRESS_WINDOW_MS;
      player.pauseVideo();
    }
    lastKnownPlayingRef.current = state.isPlaying && activeRef.current;
  }, []);

  /** Checks for a local play/pause toggle or seek-bar scrub that didn't come
   * from us, and reports it upward to be broadcast. Shared by onStateChange
   * (catches play/pause toggles reliably) and the periodic poll (catches
   * seeks, which YouTube doesn't expose a dedicated event for). */
  const checkForUserAction = useCallback(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    if (Date.now() < suppressUntilRef.current) return; // still absorbing our own programmatic call

    const state = targetRef.current;
    if (!state.videoId) return;

    const playerState = player.getPlayerState();
    const isPlayingNow = playerState === YT_STATE.PLAYING;
    const isPausedNow = playerState === YT_STATE.PAUSED;
    if (!isPlayingNow && !isPausedNow) return; // ignore transient BUFFERING/UNSTARTED/ENDED

    const currentTime = player.getCurrentTime();
    const jumped = Math.abs(currentTime - expectedPosition(state, offsetRef.current)) > SEEK_JUMP_THRESHOLD;
    const toggled = lastKnownPlayingRef.current !== null && lastKnownPlayingRef.current !== isPlayingNow;

    if (toggled || jumped) {
      lastKnownPlayingRef.current = isPlayingNow;
      onUserActionRef.current?.({ type: isPlayingNow ? "play" : "pause", positionSeconds: currentTime });
    }
  }, []);

  // Create the player once the API and container are ready.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeAPI()
      .then((YT) => {
        if (cancelled || !containerRef.current || playerRef.current) return;
        playerRef.current = new YT.Player(containerRef.current, {
          width: "100%",
          height: "100%",
          videoId: targetRef.current.videoId ?? undefined,
          playerVars: {
            // Use YouTube's own controls instead of a custom overlay — see
            // checkForUserAction()/onStateChange below for how their
            // play/pause/seek stay in sync despite not going through our
            // own button handlers anymore.
            controls: 1,
            disablekb: 1,
            playsinline: 1,
            rel: 0,
            // Native fullscreen stays off: our own fullscreen button targets
            // our wrapping container (not the bare iframe), which is what
            // lets the fullscreen chat overlay exist at all.
            fs: 0,
            modestbranding: 1,
            iv_load_policy: 3,
            // Without this, captions default to whatever that viewer last
            // had on youtube.com itself — and since we're not building our
            // own CC toggle, there'd be no way to turn them back off once on.
            cc_load_policy: 0,
          },
          events: {
            onReady: () => {
              readyRef.current = true;
              loadedVideoRef.current = targetRef.current.videoId;
              reconcile(FRESH_SNAP_THRESHOLD);
            },
            onStateChange: () => {
              const player = playerRef.current;
              if (!player) return;
              onProgressRef.current?.(
                player.getCurrentTime(),
                player.getDuration(),
                player.getPlayerState() === YT_STATE.PLAYING
              );
              checkForUserAction();
            },
          },
        });
      })
      .catch(() => {
        /* API unavailable (e.g. SSR); nothing to do */
      });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      readyRef.current = false;
    };
  }, [reconcile, checkForUserAction]);

  // Apply every fresh server update immediately.
  useEffect(() => {
    reconcile(FRESH_SNAP_THRESHOLD);
  }, [target, clockOffset, active, reconcile]);

  // Passive drift correction + progress polling + seek-scrub detection (see
  // checkForUserAction's doc comment for why this needs polling, not just
  // onStateChange).
  useEffect(() => {
    const drift = setInterval(() => reconcile(DRIFT_THRESHOLD), DRIFT_INTERVAL_MS);
    const progress = setInterval(() => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      onProgressRef.current?.(
        player.getCurrentTime(),
        player.getDuration(),
        player.getPlayerState() === YT_STATE.PLAYING
      );
      checkForUserAction();
    }, PROGRESS_INTERVAL_MS);
    return () => {
      clearInterval(drift);
      clearInterval(progress);
    };
  }, [reconcile, checkForUserAction]);

  return (
    <div className="absolute inset-0 h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

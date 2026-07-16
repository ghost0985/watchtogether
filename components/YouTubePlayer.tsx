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

type Props = {
  /** Authoritative state from the server. */
  target: RoomState;
  /** serverTime - Date.now(), so we can compute the server clock locally. */
  clockOffset: number;
  /** True once the user has tapped to join playback (unlocks autoplay). */
  active: boolean;
  /** Fires ~2x/sec + on transitions to drive the control bar UI. */
  onProgress?: (currentTime: number, duration: number, isPlaying: boolean) => void;
  ref?: React.Ref<PlayerHandle>;
};

// Snap to server position on a fresh update if we're off by more than this.
const FRESH_SNAP_THRESHOLD = 0.4;
// Only correct passive drift (the periodic check) beyond this, to avoid jitter.
const DRIFT_THRESHOLD = 1.5;
const DRIFT_INTERVAL_MS = 5000;
const PROGRESS_INTERVAL_MS = 500;

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
  targetRef.current = target;
  offsetRef.current = clockOffset;
  activeRef.current = active;
  onProgressRef.current = onProgress;

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
   * ever issues programmatic calls; it never sends intents, so there is no echo
   * loop back to the server. `snapThreshold` is small for fresh updates and
   * large for the passive drift check.
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
      if (state.isPlaying && activeRef.current) {
        player.loadVideoById(state.videoId, start);
      } else {
        player.cueVideoById(state.videoId, start);
      }
      return;
    }

    const expected = expectedPosition(state, offsetRef.current);
    if (Math.abs(player.getCurrentTime() - expected) > snapThreshold) {
      player.seekTo(expected, true);
    }

    const playerState = player.getPlayerState();
    if (
      state.isPlaying &&
      activeRef.current &&
      playerState !== YT_STATE.PLAYING &&
      playerState !== YT_STATE.BUFFERING
    ) {
      player.playVideo();
    } else if (!state.isPlaying && playerState === YT_STATE.PLAYING) {
      player.pauseVideo();
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
            controls: 0,
            disablekb: 1,
            playsinline: 1,
            rel: 0,
            fs: 0,
            modestbranding: 1,
            iv_load_policy: 3,
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
  }, [reconcile]);

  // Apply every fresh server update immediately.
  useEffect(() => {
    reconcile(FRESH_SNAP_THRESHOLD);
  }, [target, clockOffset, active, reconcile]);

  // Passive drift correction + progress polling.
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
    }, PROGRESS_INTERVAL_MS);
    return () => {
      clearInterval(drift);
      clearInterval(progress);
    };
  }, [reconcile]);

  return (
    <div className="absolute inset-0 h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, Participant, RtcSignal } from "./types";

// Public STUN only (free tier, no account) — resolves each peer's public
// address for NAT traversal. No TURN relay is configured, so a connection
// between two clients both behind symmetric/carrier-grade NAT (some cellular
// networks) can still fail; add a TURN server here if real-phone testing
// over cellular shows drops.
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type PeerEntry = {
  pc: RTCPeerConnection;
  pendingCandidates: RTCIceCandidateInit[];
};

type UseVoiceOptions = {
  userId: string;
  participants: Participant[];
  send: (message: ClientMessage) => void;
};

/**
 * Audio-only WebRTC mesh, signaled entirely over the existing PartyKit
 * connection (see lib/types.ts's RtcSignal / "rtc-signal" message — no
 * external signaling service). A peer connection between two people is only
 * created once BOTH have tapped the mic button at least once this session
 * (participant.micOn !== null on both sides); after that, muting just flips
 * `track.enabled` so it never needs to renegotiate.
 */
export function useVoice({ userId, participants, send }: UseVoiceOptions) {
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [micError, setMicError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const myParticipant = participants.find((p) => p.userId === userId);
  const myMicOn = myParticipant?.micOn ?? null;

  const closePeer = useCallback((remoteUserId: string) => {
    const entry = peersRef.current.get(remoteUserId);
    if (!entry) return;
    entry.pc.close();
    peersRef.current.delete(remoteUserId);
    setRemoteStreams((prev) => {
      if (!prev.has(remoteUserId)) return prev;
      const next = new Map(prev);
      next.delete(remoteUserId);
      return next;
    });
  }, []);

  const createPeer = useCallback(
    (remoteUserId: string, initiator: boolean): PeerEntry => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const entry: PeerEntry = { pc, pendingCandidates: [] };
      peersRef.current.set(remoteUserId, entry);

      const stream = localStreamRef.current;
      if (stream) {
        for (const track of stream.getTracks()) pc.addTrack(track, stream);
      } else {
        // We haven't joined voice ourselves but can still receive their audio.
        pc.addTransceiver("audio", { direction: "recvonly" });
      }

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        setRemoteStreams((prev) => new Map(prev).set(remoteUserId, remoteStream));
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        sendRef.current({
          type: "rtc-signal",
          to: remoteUserId,
          signal: { kind: "ice", candidate: event.candidate.toJSON() },
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(remoteUserId);
          setRetryTick((t) => t + 1); // nudge the roster effect to retry
        }
      };

      if (initiator) {
        pc.onnegotiationneeded = async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendRef.current({
              type: "rtc-signal",
              to: remoteUserId,
              signal: { kind: "offer", sdp: pc.localDescription!.sdp },
            });
          } catch {
            /* negotiation race — a subsequent negotiationneeded will retry */
          }
        };
      }

      return entry;
    },
    [closePeer]
  );

  const handleSignal = useCallback(
    async (from: string, signal: RtcSignal) => {
      let entry = peersRef.current.get(from);
      if (!entry) {
        if (signal.kind !== "offer") return; // nothing to attach a stray answer/ice to
        entry = createPeer(from, false);
      }
      const { pc } = entry;

      try {
        if (signal.kind === "offer") {
          await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
          for (const candidate of entry.pendingCandidates) await pc.addIceCandidate(candidate);
          entry.pendingCandidates = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendRef.current({
            type: "rtc-signal",
            to: from,
            signal: { kind: "answer", sdp: pc.localDescription!.sdp },
          });
        } else if (signal.kind === "answer") {
          await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
          for (const candidate of entry.pendingCandidates) await pc.addIceCandidate(candidate);
          entry.pendingCandidates = [];
        } else if (signal.kind === "ice") {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(signal.candidate);
          } else {
            entry.pendingCandidates.push(signal.candidate);
          }
        }
      } catch {
        /* stale/out-of-order signal for a connection that's already moved on */
      }
    },
    [createPeer]
  );

  // Establish/tear down peer connections as the "who's joined voice" roster
  // changes. Only runs once I've joined voice myself (myMicOn !== null).
  useEffect(() => {
    if (myMicOn === null) return;

    const others = participants.filter(
      (p) => p.name && p.connected && p.userId !== userId && p.micOn !== null
    );
    const wantedIds = new Set(others.map((p) => p.userId));

    for (const p of others) {
      if (peersRef.current.has(p.userId)) continue;
      // Deterministic initiator so both sides don't offer simultaneously.
      if (userId < p.userId) createPeer(p.userId, true);
    }
    for (const existingId of Array.from(peersRef.current.keys())) {
      if (!wantedIds.has(existingId)) closePeer(existingId);
    }
  }, [participants, userId, myMicOn, createPeer, closePeer, retryTick]);

  // Full teardown on unmount (leaving the room / navigating away). Reads
  // `.current` fresh at cleanup time on purpose — localStreamRef is only
  // populated later, by toggleMic, well after this effect's setup runs.
  useEffect(() => {
    return () => {
      for (const id of Array.from(peersRef.current.keys())) closePeer(id);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, [closePeer]);

  const toggleMic = useCallback(async () => {
    if (!localStreamRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        setMicError(null);
        sendRef.current({ type: "setMic", on: true });
      } catch {
        setMicError("Couldn't access your microphone — check your browser permissions.");
      }
      return;
    }
    const nextOn = myMicOn !== true;
    for (const track of localStreamRef.current.getTracks()) track.enabled = nextOn;
    sendRef.current({ type: "setMic", on: nextOn });
  }, [myMicOn]);

  return { myMicOn, remoteStreams, micError, toggleMic, handleSignal };
}

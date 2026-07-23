// Shared message + state shapes. Imported by BOTH the client and the PartyKit
// server so the wire format can never drift between them.

/**
 * Authoritative room state held in PartyKit room memory. Position is stored as
 * the value at `lastUpdateTimestamp` (server clock, epoch ms). To compute the
 * live position while playing: positionSeconds + (serverNow - lastUpdateTimestamp)/1000.
 */
export type RoomState = {
  videoId: string | null;
  isPlaying: boolean;
  positionSeconds: number;
  lastUpdateTimestamp: number;
  hostId: string | null;
  participants: Participant[];
};

/** A person who has named themselves in this room (no auth — name IS the identity). */
export type Participant = {
  userId: string;
  name: string;
  connected: boolean;
  /** ISO 639-1 code, e.g. "en". Defaults to English until they set otherwise. */
  language: string;
  /**
   * Voice state: `null` = hasn't joined voice this session (never tapped the
   * mic button); `true`/`false` = joined and currently un/muted. Once joined,
   * a peer connection persists across mute toggles — only tearing down on
   * disconnect — so muting never has to redo microphone permission or ICE.
   */
  micOn: boolean | null;
};

/** Same shape as the DOM's `RTCIceCandidateInit`, defined explicitly rather
 * than referencing that global: this file is shared with the Cloudflare
 * Worker, a non-DOM runtime where that type doesn't exist. A real
 * `RTCIceCandidateInit` value is structurally assignable here regardless. */
export type IceCandidateInit = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

/** An offer/answer/ICE-candidate signal relayed peer-to-peer through the
 * real-time server (no external signaling service — see CLAUDE.md's voice
 * architecture note). */
export type RtcSignal =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: IceCandidateInit };

/**
 * A chat bubble or a system notice ("X joined the room"), in one ordered feed.
 * `translations` (chat only) maps a language code -> translated text, filled in
 * client-side before sending by calling /api/translate. The server never calls
 * Gemini itself — it just relays whatever the sender already translated.
 */
export type FeedItem =
  | {
      kind: "chat";
      id: string;
      userId: string;
      name: string;
      text: string;
      timestamp: number;
      translations?: Record<string, string>;
    }
  | { kind: "system"; id: string; text: string; timestamp: number };

/** Intents sent client -> server. loadVideo is host-only (enforced server-side). */
export type ClientMessage =
  | { type: "loadVideo"; videoId: string }
  | { type: "play"; positionSeconds: number }
  | { type: "pause"; positionSeconds: number }
  | { type: "seek"; positionSeconds: number }
  | { type: "setName"; name: string }
  | { type: "setLanguage"; language: string }
  | { type: "chat"; text: string; translations?: Record<string, string> }
  | { type: "setMic"; on: boolean }
  /** Targeted WebRTC signaling relay — the server forwards this to `to` only,
   * it never inspects or broadcasts it. */
  | { type: "rtc-signal"; to: string; signal: RtcSignal };

/** Broadcasts server -> client. */
export type ServerMessage =
  /** Playback + roster snapshot. `serverTime` lets clients sync their clock. */
  | { type: "state"; state: RoomState; serverTime: number }
  /** Sent once, right after connecting: full chat/system history so far. */
  | { type: "feedHistory"; items: FeedItem[] }
  /** A single new chat message or system notice, broadcast as it happens. */
  | { type: "feedItem"; item: FeedItem }
  /** Relayed 1:1 from another participant's "rtc-signal" client message. */
  | { type: "rtc-signal"; from: string; signal: RtcSignal }
  /** Sent (then the socket is closed) when a brand-new person tries to join
   * a room that already has MAX_PARTICIPANTS distinct people in it. */
  | { type: "roomFull" };

export const INITIAL_ROOM_STATE: RoomState = {
  videoId: null,
  isPlaying: false,
  positionSeconds: 0,
  lastUpdateTimestamp: 0,
  hostId: null,
  participants: [],
};

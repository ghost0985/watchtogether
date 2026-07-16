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
};

/** Intents sent client -> server. loadVideo is host-only (enforced server-side). */
export type ClientMessage =
  | { type: "loadVideo"; videoId: string }
  | { type: "play"; positionSeconds: number }
  | { type: "pause"; positionSeconds: number }
  | { type: "seek"; positionSeconds: number };

/** Broadcasts server -> client. `serverTime` lets clients sync their clock. */
export type ServerMessage = {
  type: "state";
  state: RoomState;
  serverTime: number;
};

export const INITIAL_ROOM_STATE: RoomState = {
  videoId: null,
  isPlaying: false,
  positionSeconds: 0,
  lastUpdateTimestamp: 0,
  hostId: null,
};

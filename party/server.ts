import type * as Party from "partykit/server";
import type { ClientMessage, ServerMessage, RoomState } from "../lib/types";
import { INITIAL_ROOM_STATE } from "../lib/types";

type ConnState = { userId: string };

/**
 * Authoritative watch-party room. Holds playback state in memory and broadcasts
 * it on every change. Clients send intents (play/pause/seek/loadVideo); the
 * server is the single source of truth and clients reconcile to it.
 *
 * State is intentionally ephemeral — on a cold start it resets, and the first
 * rejoining host re-seeds it from its sessionStorage cache.
 */
export default class WatchRoom implements Party.Server {
  state: RoomState = { ...INITIAL_ROOM_STATE };

  constructor(readonly room: Party.Room) {}

  private snapshot(): string {
    const message: ServerMessage = {
      type: "state",
      state: this.state,
      serverTime: Date.now(),
    };
    return JSON.stringify(message);
  }

  private userId(conn: Party.Connection): string {
    return (conn.state as ConnState | null)?.userId ?? conn.id;
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const userId =
      new URL(ctx.request.url).searchParams.get("userId") ?? conn.id;
    conn.setState({ userId } satisfies ConnState);

    // First person into the room becomes host (persists across their reconnects
    // because the id is stable in their localStorage).
    if (!this.state.hostId) {
      this.state.hostId = userId;
    }

    // Give the newcomer the current snapshot so they can seek into position.
    conn.send(this.snapshot());
  }

  onMessage(raw: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection) {
    if (typeof raw !== "string") return;

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    const now = Date.now();

    switch (message.type) {
      case "loadVideo": {
        // Only the host may change the video.
        if (this.state.hostId && this.userId(sender) !== this.state.hostId) {
          return;
        }
        this.state.videoId = message.videoId;
        this.state.positionSeconds = 0;
        this.state.isPlaying = false;
        this.state.lastUpdateTimestamp = now;
        break;
      }
      case "play":
        this.state.isPlaying = true;
        this.state.positionSeconds = message.positionSeconds;
        this.state.lastUpdateTimestamp = now;
        break;
      case "pause":
        this.state.isPlaying = false;
        this.state.positionSeconds = message.positionSeconds;
        this.state.lastUpdateTimestamp = now;
        break;
      case "seek":
        this.state.positionSeconds = message.positionSeconds;
        this.state.lastUpdateTimestamp = now;
        break;
      default:
        return;
    }

    this.room.broadcast(this.snapshot());
  }
}

WatchRoom satisfies Party.Worker;

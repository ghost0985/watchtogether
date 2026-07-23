import { DurableObject } from "cloudflare:workers";
import type { ClientMessage, FeedItem, Participant, ServerMessage, RoomState } from "../lib/types";
import { INITIAL_ROOM_STATE } from "../lib/types";
import { LANGUAGES } from "../lib/languages";

export interface Env {
  WATCH_ROOM: DurableObjectNamespace<WatchRoom>;
}

const MAX_FEED_ITEMS = 200;
const MAX_NAME_LENGTH = 24;
const MAX_MESSAGE_LENGTH = 500;
const VALID_LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));
// This app is built and tested for exactly two people (see CLAUDE.md) --
// enforced here so a stray link never lets a third person wander into
// someone else's room. Based on distinct userIds ever seen in this room
// (this.participants), not live socket count: a room is "claimed" by
// whichever two people first joined it, for as long as this Durable Object
// instance stays warm, even if one of them is currently disconnected --
// each room code is generated fresh per watch session (see lib/room.ts's
// generateRoomCode), never meant to be reused by a different pair.
const MAX_PARTICIPANTS = 2;
// A dropped socket doesn't always mean someone actually left -- iOS Safari
// kills sockets on backgrounding, and cellular connections blip, both of
// which reconnect within a few seconds. Without this grace period, every
// brief drop announced a "left the room" immediately followed by a "joined
// the room" the moment usePartySocket reconnected, which read as someone
// repeatedly leaving and rejoining even though they never really left.
const LEAVE_GRACE_MS = 10_000;

/**
 * Authoritative watch-party room. Holds playback state, the participant
 * roster, and the chat/system feed in memory, broadcasting on every change.
 * Clients send intents; the server is the single source of truth and clients
 * reconcile to it.
 *
 * State is intentionally ephemeral — on a cold start it resets, and the first
 * rejoining host re-seeds playback from its sessionStorage cache. Chat history
 * resets on cold start too; there's no database in v1.
 *
 * Plain (non-hibernating) WebSocketPair, not the Hibernation API: this app is
 * two people with near-zero traffic, nowhere near the point where hibernation's
 * idle-cost savings would matter, and this shape is the closest structural
 * match to the room-object model this was ported from.
 */
export class WatchRoom extends DurableObject<Env> {
  state: RoomState = { ...INITIAL_ROOM_STATE, participants: [] };
  participants = new Map<string, Participant>();
  feed: FeedItem[] = [];
  /** For targeted WebRTC signaling relay (not broadcast). Keyed by userId so a
   * reconnect naturally replaces the stale entry. */
  connectionsByUserId = new Map<string, WebSocket>();
  /** Reverse lookup: a socket doesn't carry its own userId, unlike PartyKit's
   * `Connection.setState()`. */
  userIdBySocket = new Map<WebSocket, string>();

  private snapshot(): string {
    const message: ServerMessage = {
      type: "state",
      state: { ...this.state, participants: Array.from(this.participants.values()) },
      serverTime: Date.now(),
    };
    return JSON.stringify(message);
  }

  private getOrCreateParticipant(userId: string): Participant {
    let participant = this.participants.get(userId);
    if (!participant) {
      participant = { userId, name: "", connected: false, language: "en", micOn: null };
      this.participants.set(userId, participant);
    }
    return participant;
  }

  private broadcast(json: string) {
    for (const ws of this.userIdBySocket.keys()) {
      try {
        ws.send(json);
      } catch {
        // A dead socket here means its close/error event just hasn't fired
        // yet -- handleClose will clean it up momentarily.
      }
    }
  }

  private pushFeedItem(item: FeedItem) {
    this.feed.push(item);
    if (this.feed.length > MAX_FEED_ITEMS) this.feed = this.feed.slice(-MAX_FEED_ITEMS);
    const message: ServerMessage = { type: "feedItem", item };
    this.broadcast(JSON.stringify(message));
  }

  private async broadcastState() {
    await Promise.resolve();
    this.broadcast(this.snapshot());
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade request", { status: 426 });
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") ?? crypto.randomUUID();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    // A brand-new person, but the room's two seats are already taken --
    // still complete the WebSocket handshake (a plain rejected upgrade gives
    // client-side JS no way to read *why* it failed, so usePartySocket would
    // just retry forever showing "reconnecting..."), then tell them plainly
    // and close. An existing participant reconnecting is always let back in
    // regardless of this check.
    if (!this.participants.has(userId) && this.participants.size >= MAX_PARTICIPANTS) {
      server.send(JSON.stringify({ type: "roomFull" } satisfies ServerMessage));
      server.close(1000, "Room is full");
      return new Response(null, { status: 101, webSocket: client });
    }

    this.userIdBySocket.set(server, userId);
    this.connectionsByUserId.set(userId, server);

    // First person into the room becomes host (persists across their reconnects
    // because the id is stable in their localStorage).
    if (!this.state.hostId) {
      this.state.hostId = userId;
    }

    // Ensure a roster entry exists, but don't mark them "joined" (and don't
    // announce it) until they've picked a name — the socket may be open purely
    // to keep video sync going before the name prompt is answered.
    this.getOrCreateParticipant(userId);

    server.send(this.snapshot());
    server.send(JSON.stringify({ type: "feedHistory", items: this.feed } satisfies ServerMessage));

    server.addEventListener("message", (event) => {
      void this.handleMessage(server, event.data);
    });
    server.addEventListener("close", () => {
      void this.handleClose(server);
    });
    server.addEventListener("error", () => {
      void this.handleClose(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleClose(ws: WebSocket) {
    const userId = this.userIdBySocket.get(ws);
    this.userIdBySocket.delete(ws);
    if (!userId) return;

    // Only clear the registry entry if a later reconnect hasn't already
    // replaced it (avoids a stale close handler deleting a fresh connection).
    if (this.connectionsByUserId.get(userId) === ws) {
      this.connectionsByUserId.delete(userId);
    }

    const participant = this.participants.get(userId);
    if (!participant?.connected) return;

    // Don't mark them disconnected (or announce it) right away -- give a
    // brief grace period for a quick reconnect (see LEAVE_GRACE_MS) to
    // happen invisibly first. If they're back before this fires, `setName`
    // on the new connection sees `connected` still true and skips its own
    // "joined the room" announcement too, so a quick blip produces neither
    // message.
    setTimeout(() => {
      void this.finalizeDisconnect(userId);
    }, LEAVE_GRACE_MS);
  }

  private async finalizeDisconnect(userId: string) {
    // A reconnect during the grace period already replaced this entry with
    // a live connection -- nothing to do.
    if (this.connectionsByUserId.has(userId)) return;

    const participant = this.participants.get(userId);
    if (!participant?.connected) return;

    participant.connected = false;
    // Voice is session-scoped: a rejoin should start from "not in voice"
    // rather than resume a peer connection that's already gone.
    participant.micOn = null;
    this.pushFeedItem({
      kind: "system",
      id: crypto.randomUUID(),
      text: `${participant.name} left the room`,
      timestamp: Date.now(),
    });

    if (this.state.hostId === userId) this.migrateHost(userId);

    await this.broadcastState();
  }

  /**
   * Hands host duties (the only one allowed to load a new video, see
   * "loadVideo" below) to whoever else is actually still here, so a guest
   * isn't permanently stuck watching whatever's already loaded just because
   * the original host's phone died or they never came back. Only runs once
   * the departing host's grace period has genuinely expired (see
   * finalizeDisconnect) -- a brief network blip never triggers this.
   *
   * Clears hostId to null if nobody else is currently connected either (both
   * gone) rather than leaving it pointing at the departed host forever --
   * whoever reconnects first, either of the original two, then becomes host
   * the normal way (see the `fetch` handler).
   */
  private migrateHost(departingUserId: string) {
    const successor = Array.from(this.participants.values()).find(
      (p) => p.userId !== departingUserId && p.connected
    );
    this.state.hostId = successor?.userId ?? null;
    if (successor) {
      this.pushFeedItem({
        kind: "system",
        id: crypto.randomUUID(),
        text: `${successor.name} is now the host`,
        timestamp: Date.now(),
      });
    }
  }

  private async handleMessage(sender: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    const now = Date.now();
    const senderId = this.userIdBySocket.get(sender);
    if (!senderId) return;

    switch (message.type) {
      case "loadVideo": {
        // Only the host may change the video.
        if (this.state.hostId && senderId !== this.state.hostId) return;
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
      case "setName": {
        const name = message.name.trim().slice(0, MAX_NAME_LENGTH);
        if (!name) return;
        const participant = this.getOrCreateParticipant(senderId);
        const wasConnected = participant.connected;
        participant.name = name;
        participant.connected = true;
        if (!wasConnected) {
          this.pushFeedItem({
            kind: "system",
            id: crypto.randomUUID(),
            text: `${name} joined the room`,
            timestamp: now,
          });
        }
        break;
      }
      case "setLanguage": {
        if (!VALID_LANGUAGE_CODES.has(message.language)) return;
        const participant = this.getOrCreateParticipant(senderId);
        participant.language = message.language;
        break;
      }
      case "chat": {
        const participant = this.participants.get(senderId);
        if (!participant?.connected) return;
        const text = message.text.trim().slice(0, MAX_MESSAGE_LENGTH);
        if (!text) return;

        // Translations are produced client-side (see /api/translate) and just
        // relayed here — sanitize to known language codes and non-empty strings.
        let translations: Record<string, string> | undefined;
        if (message.translations) {
          for (const [code, value] of Object.entries(message.translations)) {
            if (VALID_LANGUAGE_CODES.has(code) && typeof value === "string" && value.trim()) {
              translations ??= {};
              translations[code] = value.trim();
            }
          }
        }

        this.pushFeedItem({
          kind: "chat",
          id: crypto.randomUUID(),
          userId: senderId,
          name: participant.name,
          text,
          timestamp: now,
          translations,
        });
        return; // chat doesn't touch playback state; no state broadcast needed
      }
      case "setMic": {
        const participant = this.participants.get(senderId);
        if (!participant?.connected) return;
        participant.micOn = message.on;
        break;
      }
      case "rtc-signal": {
        // Direct relay only — never broadcast, never inspected/stored here.
        const target = this.connectionsByUserId.get(message.to);
        target?.send(
          JSON.stringify({ type: "rtc-signal", from: senderId, signal: message.signal } satisfies ServerMessage)
        );
        return;
      }
      default:
        return;
    }

    await this.broadcastState();
  }
}

/**
 * Top-level Worker: routes to a Durable Object per room. Matches the exact
 * URL shape the `partysocket` client library builds by default
 * (`/parties/main/:room`) so the frontend needs zero changes.
 */
const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/parties\/main\/([^/]+)$/);
    if (!match) {
      return new Response("Not found", { status: 404 });
    }
    const roomId = match[1];
    const id = env.WATCH_ROOM.idFromName(roomId);
    const stub = env.WATCH_ROOM.get(id);
    return stub.fetch(request);
  },
};

export default worker;

import type * as Party from "partykit/server";
import type { ClientMessage, FeedItem, Participant, ServerMessage, RoomState } from "../lib/types";
import { INITIAL_ROOM_STATE } from "../lib/types";
import { LANGUAGES } from "../lib/languages";

type ConnState = { userId: string };

const MAX_FEED_ITEMS = 200;
const MAX_NAME_LENGTH = 24;
const MAX_MESSAGE_LENGTH = 500;
const VALID_LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

/**
 * Authoritative watch-party room. Holds playback state, the participant
 * roster, and the chat/system feed in memory, broadcasting on every change.
 * Clients send intents; the server is the single source of truth and clients
 * reconcile to it.
 *
 * State is intentionally ephemeral — on a cold start it resets, and the first
 * rejoining host re-seeds playback from its sessionStorage cache. Chat history
 * resets on cold start too; there's no database in v1.
 */
export default class WatchRoom implements Party.Server {
  state: RoomState = { ...INITIAL_ROOM_STATE, participants: [] };
  participants = new Map<string, Participant>();
  feed: FeedItem[] = [];

  constructor(readonly room: Party.Room) {}

  private snapshot(): string {
    const message: ServerMessage = {
      type: "state",
      state: { ...this.state, participants: Array.from(this.participants.values()) },
      serverTime: Date.now(),
    };
    return JSON.stringify(message);
  }

  private userId(conn: Party.Connection): string {
    return (conn.state as ConnState | null)?.userId ?? conn.id;
  }

  private getOrCreateParticipant(userId: string): Participant {
    let participant = this.participants.get(userId);
    if (!participant) {
      participant = { userId, name: "", connected: false, language: "en" };
      this.participants.set(userId, participant);
    }
    return participant;
  }

  private pushFeedItem(item: FeedItem) {
    this.feed.push(item);
    if (this.feed.length > MAX_FEED_ITEMS) this.feed = this.feed.slice(-MAX_FEED_ITEMS);
    const message: ServerMessage = { type: "feedItem", item };
    this.room.broadcast(JSON.stringify(message));
  }

  /**
   * A second `room.broadcast()` call in the same handler tick throws in
   * PartyKit's local dev runtime (a dev-only quirk). Yielding a tick avoids it —
   * but the yield must be *awaited* by the caller, not fire-and-forgotten, or
   * the runtime tears down the handler's execution context before the deferred
   * broadcast ever runs.
   */
  private async broadcastState() {
    await Promise.resolve();
    this.room.broadcast(this.snapshot());
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

    // Ensure a roster entry exists, but don't mark them "joined" (and don't
    // announce it) until they've picked a name — the socket may be open purely
    // to keep video sync going before the name prompt is answered.
    this.getOrCreateParticipant(userId);

    conn.send(this.snapshot());
    conn.send(JSON.stringify({ type: "feedHistory", items: this.feed } satisfies ServerMessage));
  }

  async onClose(conn: Party.Connection) {
    const userId = this.userId(conn);
    const participant = this.participants.get(userId);
    if (!participant?.connected) return;

    participant.connected = false;
    this.pushFeedItem({
      kind: "system",
      id: crypto.randomUUID(),
      text: `${participant.name} left the room`,
      timestamp: Date.now(),
    });
    await this.broadcastState();
  }

  async onMessage(raw: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection) {
    if (typeof raw !== "string") return;

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    const now = Date.now();
    const senderId = this.userId(sender);

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
      default:
        return;
    }

    await this.broadcastState();
  }
}

WatchRoom satisfies Party.Worker;

// Room-code + identity helpers (client-side).

// Unambiguous charset: no 0/O, 1/I/L to avoid transcription errors.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/** Generates a random 6-char room code from an unambiguous alphabet. */
export function generateRoomCode(): string {
  const bytes = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

/** Uppercases and strips anything outside the code alphabet, capped at 6 chars. */
export function normalizeRoomCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);
}

const USER_ID_KEY = "wt-user-id";

/**
 * Stable per-browser id used to identify the host across reconnects. Persisted
 * in localStorage. Returns "" during SSR (no window).
 */
export function getUserId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

/** PartyKit host. Defaults to the local dev server; override for production. */
export const PARTYKIT_HOST =
  process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";

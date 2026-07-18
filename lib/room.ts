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
 * `crypto.randomUUID()` only works in "secure contexts" (HTTPS, or literally
 * "localhost") — it throws on a plain http:// LAN IP, which is exactly how a
 * phone reaches a dev machine for local testing. `crypto.getRandomValues`
 * has no such restriction, so build an equivalent v4 UUID from that instead.
 */
function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Stable per-browser id used to identify the host across reconnects. Persisted
 * in localStorage. Returns "" during SSR (no window).
 */
export function getUserId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

/** PartyKit host. Defaults to the local dev server; override for production. */
export const PARTYKIT_HOST =
  process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";

const DISPLAY_NAME_KEY = "wt-display-name";

/** Cached display name, reused across rooms so returning users skip the prompt. */
export function getDisplayName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(DISPLAY_NAME_KEY) ?? "";
}

export function setDisplayName(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DISPLAY_NAME_KEY, name);
}

/** First 1-2 characters for a compact presence avatar, e.g. "Maria" -> "M". */
export function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

const LANGUAGE_KEY = "wt-language";

/** Cached display-language preference, reused across rooms. Defaults to English. */
export function getLanguagePref(): string {
  if (typeof window === "undefined") return "en";
  return localStorage.getItem(LANGUAGE_KEY) ?? "en";
}

export function setLanguagePref(code: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LANGUAGE_KEY, code);
}

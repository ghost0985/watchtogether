import "server-only";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

export const GOOGLE_AUTH_COOKIE = "wt-google-auth";
export const GOOGLE_STATE_COOKIE = "wt-google-oauth-state";

export type GoogleTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in the environment`);
  return value;
}

/** Where Google should send the browser back after sign-in. */
export function getRedirectUri(requestUrl: string): string {
  return new URL("/api/auth/google/callback", requestUrl).toString();
}

/** Builds the URL that starts Google's sign-in flow. */
export function buildAuthUrl(requestUrl: string, state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", requireEnv("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", getRedirectUri(requestUrl));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline"); // so we get a refresh token
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

/** Exchanges a one-time authorization code (from the OAuth redirect) for tokens. */
export async function exchangeCodeForTokens(code: string, requestUrl: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri(requestUrl),
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string") {
    throw new Error("Google token exchange response missing tokens");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/** Gets a fresh access token using the stored refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  if (typeof data.access_token !== "string") throw new Error("Google token refresh response missing access_token");
  return {
    accessToken: data.access_token,
    refreshToken, // refresh tokens are long-lived; Google doesn't rotate it here
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/** Returns a valid access token, refreshing first if the stored one has expired. */
export async function ensureFreshTokens(tokens: GoogleTokens): Promise<GoogleTokens> {
  const EXPIRY_SAFETY_MARGIN_MS = 60_000;
  if (Date.now() < tokens.expiresAt - EXPIRY_SAFETY_MARGIN_MS) return tokens;
  return refreshAccessToken(tokens.refreshToken);
}

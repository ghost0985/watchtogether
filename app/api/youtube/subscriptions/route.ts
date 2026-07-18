import { cookies } from "next/headers";
import { ensureFreshTokens, GOOGLE_AUTH_COOKIE, type GoogleTokens } from "@/lib/googleAuth";
import { getSubscriptionFeed } from "@/lib/youtubeSearch";

const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function GET() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(GOOGLE_AUTH_COOKIE)?.value;
  if (!raw) return Response.json({ signedIn: false, results: [] });

  let tokens: GoogleTokens;
  try {
    tokens = JSON.parse(raw);
  } catch {
    return Response.json({ signedIn: false, results: [] });
  }

  try {
    const fresh = await ensureFreshTokens(tokens);
    if (fresh.accessToken !== tokens.accessToken) {
      cookieStore.set(GOOGLE_AUTH_COOKIE, JSON.stringify(fresh), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: AUTH_COOKIE_MAX_AGE,
      });
    }
    const results = await getSubscriptionFeed(fresh.accessToken);
    return Response.json({ signedIn: true, results });
  } catch (err) {
    console.error("Subscriptions feed failed:", err);
    return Response.json({ signedIn: true, results: [] });
  }
}

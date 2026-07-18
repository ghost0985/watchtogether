import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, GOOGLE_AUTH_COOKIE, GOOGLE_STATE_COOKIE } from "@/lib/googleAuth";

const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days; the refresh token keeps it usable

/** Handles Google's redirect back after sign-in: verify state, exchange the code, store tokens. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(GOOGLE_STATE_COOKIE)?.value;
  cookieStore.delete(GOOGLE_STATE_COOKIE);

  let returnTo = "/";
  let stateOk = false;
  try {
    const parsed = stateCookie ? (JSON.parse(stateCookie) as { state?: string; returnTo?: string }) : null;
    if (parsed?.returnTo) returnTo = parsed.returnTo;
    stateOk = !!code && !!returnedState && parsed?.state === returnedState;
  } catch {
    stateOk = false;
  }

  if (!stateOk || !code) {
    return NextResponse.redirect(new URL(returnTo, request.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code, request.url);
    cookieStore.set(GOOGLE_AUTH_COOKIE, JSON.stringify(tokens), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_COOKIE_MAX_AGE,
    });
  } catch (err) {
    console.error("Google OAuth callback failed:", err);
  }

  return NextResponse.redirect(new URL(returnTo, request.url));
}

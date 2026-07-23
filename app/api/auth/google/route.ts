import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, GOOGLE_STATE_COOKIE, isGoogleAuthConfigured, sanitizeReturnTo } from "@/lib/googleAuth";

/** Starts Google sign-in: stash a CSRF state + where to return, then redirect to Google. */
export async function GET(request: NextRequest) {
  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get("returnTo"));

  if (!isGoogleAuthConfigured()) {
    const url = new URL(returnTo, request.url);
    url.searchParams.set("googleAuthError", "1");
    return NextResponse.redirect(url);
  }

  const state = crypto.randomUUID();

  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_STATE_COOKIE, JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes to complete sign-in
  });

  return NextResponse.redirect(buildAuthUrl(request.url, state));
}

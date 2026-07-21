# WatchTogether

A private, two-person watch party for YouTube. Join a room, load a video, and stay perfectly in sync — play, pause, and seek all mirror instantly between both people — with live chat (auto-translated if you speak different languages) and voice chat over WebRTC.

Built as a mobile-first PWA: no install, no account, just a room code.

## Stack

- **Next.js** (App Router) + TypeScript + Tailwind CSS, hosted on Vercel
- **Cloudflare Workers + Durable Objects** for the real-time room server (authoritative playback state, chat, presence, WebRTC signaling) — deployed under our own Cloudflare account so it isn't dependent on a third-party host's shared capacity
- **YouTube IFrame Player API** for video playback
- **Gemini API** for live chat translation
- **WebRTC** (peer-to-peer, no SFU) for voice chat, signaled through the same Cloudflare room

## Running it locally

Two dev servers, run side by side:

```bash
npm install
npm run dev     # Next.js, http://localhost:3000
npm run party   # the real-time room server (Wrangler), port 1999
```

You'll need a few API keys in `.env.local` (see the comments in that file for where to get each one): `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` if you want the optional "Sign in with Google" subscriptions feed. The app works without any of them — those features just gracefully show as unavailable instead.

## A note on "Sign in with Google"

This is a small personal project, not a published/verified Google app, so signing in shows Google's standard "unverified app" warning (one extra click through "Advanced → Go to WatchTogether (unsafe)"). That's expected, not a bug — going through Google's full verification process is built for apps with real public userbases, which this deliberately isn't. It's made for exactly two people to use together, and the Google sign-in is an optional extra (browsing trending videos and pasting links both work without it).

## Deploying

- **Frontend**: push to `master`, Vercel auto-deploys.
- **Real-time server**: `npm run party:deploy` (Wrangler), then make sure `NEXT_PUBLIC_REALTIME_HOST` in Vercel's environment variables points at the deployed Worker's URL.

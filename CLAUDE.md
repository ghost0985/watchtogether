# WatchTogether — Synced YouTube Watch Party App

## What this is
A private two-person (expandable) watch party app. Users join a room via link/code, watch YouTube videos in perfect sync, chat with live AI translation, and talk over voice. Mobile-first PWA — girlfriend uses it entirely from her phone browser, no install, no account.

## Who's building it
Solo dev (Logan), building in Claude Code. Portfolio-quality project: real-time sync, WebRTC, AI integration, PWA. Prioritize shipping working phases over perfection.

## Stack (do not deviate without discussion)
- **Framework:** Next.js (App Router) + TypeScript + Tailwind CSS
- **Hosting:** Vercel
- **Real-time sync:** PartyKit (free tier) — WebSocket rooms. Vercel serverless can't hold persistent connections, so all real-time state lives in the PartyKit server, NOT in Next.js API routes.
- **Video:** YouTube IFrame Player API (loaded via script tag, controlled with JS)
- **Chat translation:** Gemini API free tier via plain fetch (same pattern as chat-with-PDF project — REST, no SDK), called from a Next.js API route so the key stays server-side
- **Voice:** WebRTC peer-to-peer via PeerJS (2 users = simple mesh, no SFU needed). PartyKit doubles as the signaling channel.
- **No database for v1.** Rooms are ephemeral, state lives in PartyKit room memory. Add persistence later only if needed.
- **No auth for v1.** Room code IS the access control. Host role = first person in the room (store a host token in localStorage).

## Architecture overview
```
[Phone A: host]  ⇄  PartyKit room (authoritative state)  ⇄  [Phone B: guest]
      │                                                          │
      └── YouTube IFrame player ──── (each device plays its own stream)
      └── PeerJS voice (P2P audio, signaled through PartyKit)
      └── Chat msg → Next.js API route → Gemini translate → broadcast
```

**Sync model:** The PartyKit room holds authoritative state: `{ videoId, isPlaying, positionSeconds, lastUpdateTimestamp, hostId }`. Clients send intents (play/pause/seek/loadVideo); server updates state and broadcasts; clients reconcile their player to server state. On join, new client gets full state snapshot and seeks to `position + (now - lastUpdateTimestamp)` if playing.

**Drift correction:** Every 5s, clients compare local player time to computed server time. If drift > 1.5s, seek to correct. Suppress the echo (a programmatic seek must not rebroadcast as a user seek — use a flag).

## Build phases (each phase = deployed and working before the next)

### Phase 1 — Rooms + synced player (the core)
- Landing page: "Create room" → generates 6-char room code, routes to `/room/[code]`
- Join by entering code or opening the link directly
- YouTube URL/ID input (host only) loads video for everyone
- Play/pause/seek sync via PartyKit
- Mobile-first layout: video top, controls below, works one-handed portrait
- **Done when:** two phones stay in sync through play/pause/seek/refresh/rejoin

### Phase 2 — Chat
- Chat panel below player (mobile) with name picker on join (no auth)
- Messages broadcast through the same PartyKit room
- Presence: show who's in the room, join/leave notices
- **Done when:** chat works while video plays, survives reconnect

### Phase 3 — Live translation
- Per-user language setting (default: English)
- Message flow: sender → API route → Gemini translates to each recipient's language → broadcast original + translation, display translation with "show original" tap
- Cache translations per message; batch if rate limits bite
- **Done when:** she sets Spanish (or whatever), your English messages show translated on her side and vice versa

### Phase 4 — Voice
- Mic toggle button. WebRTC audio-only P2P via PeerJS, signaling over PartyKit
- Mute state shown in presence UI
- Test on real phones early — iOS Safari WebRTC has quirks (needs user gesture to start audio, check autoplay policies)
- **Done when:** voice works phone-to-phone over cellular, not just wifi

### Phase 5 — Polish + PWA
- manifest.json + icons + service worker → "Add to Home Screen" feels native
- Design pass: dark theme, modern look (see frontend-design skill), smooth transitions
- Empty states, connection-lost banner with auto-reconnect, host-migration if host leaves
- README with screenshots + architecture diagram → portfolio-ready

## Known gotchas (learn from these, don't rediscover them)
- **YouTube player fires state events for programmatic changes too.** Always distinguish user-initiated vs sync-initiated actions or you'll build an infinite echo loop between clients.
- **Mobile browsers block autoplay with sound.** New joiners must tap once ("Tap to join playback") before the player can start — design for this, don't fight it.
- **iOS Safari kills timers/sockets when backgrounded.** Reconnect + full state resync on `visibilitychange` is mandatory.
- **YouTube IFrame API loads async.** Gate all player calls behind the `onYouTubeIframeAPIReady` callback.
- **Ads:** ads are per-viewer-session, not per-app. Premium on the viewing device's Google session = no ads. Nothing in code can change this — do not attempt workarounds.
- **PartyKit rooms are memoryless on cold start.** If the room hibernates, first rejoiner's client should be able to re-seed state (keep last-known state in sessionStorage as fallback).

## Non-goals for v1
- No Netflix or other DRM platforms (webview injection = fragile, unauthorized; revisit never)
- No accounts/auth, no database, no video upload, no >2-person voice, no screen sharing

## Conventions
- Components in `components/`, PartyKit server in `party/`, shared types in `lib/types.ts` (import into both client and party server so message shapes never drift)
- All PartyKit messages are discriminated unions: `{ type: "play" | "pause" | "seek" | "loadVideo" | "chat" | "presence" | ... , ... }`
- Commit at the end of every working session; deploy every phase

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

## Design system — WatchTogether

The app is a private cinema for two people. Every design decision should serve that: intimate, dark, video-first, zero clutter. If a screen would look at home in a SaaS dashboard, it's wrong.

### Vibe
Late-night movie theater for two. The video is the stage; everything else is the dark room around it. References: Apple TV's player (controls that get out of the way), Letterboxd (dark, filmic, personal), Spotify Jam (playful togetherness without noise). Anti-references: Discord (too busy), generic SaaS landing pages, anything with purple-blue gradients.

### Color tokens (define in Tailwind config, never use raw hex in components)
- `bg`        #0B0B0F — near-black with a hint of blue, the "dark theater" base
- `surface`   #15151C — cards, sheets, input fields
- `surface-2` #1E1E27 — hover states, elevated elements
- `text`      #F4F4F6 — primary text
- `text-dim`  #8B8B98 — timestamps, labels, secondary info
- `accent`    #FF4E45 — warm signal red. ONE accent. Used only for: live/playing indicators, primary action button, her presence dot. Never for decoration, never in gradients.
- `ok`        #3DDC97 — connected/synced states only

Rule: any screen should be ~90% bg/surface tones, ~8% text, ~2% accent. If accent appears more than 3 times on a screen, cut some.

### Typography
- Display/UI: **Inter** — weights 400, 600, 700 only. Tight tracking (-0.02em) on headings.
- Room codes and timestamps: **JetBrains Mono** — the room code is a ticket stub; monospace makes it feel like an object worth sharing.
- No third font. No font weights outside the three listed.
- Body text 15–16px on mobile, line-height 1.5. Headings rarely exceed 24px — this is a companion app, not a marketing site.

### Layout & spacing
- 4px spacing grid. Common values: 8, 12, 16, 24.
- Mobile portrait is the ONLY first-class layout. Design at 390px wide; desktop just gets a centered column (max-w-md) — do not build separate desktop layouts in v1.
- Video is always full-bleed edge-to-edge at the top. Nothing ever sits beside the video.
- Chat lives in a bottom sheet: peeks ~30% by default, drags up over the video (video keeps playing, shrinks to a pinned mini-bar when sheet is full).
- Corners: rounded-2xl on sheets and cards, rounded-full on pills/buttons. Borders (1px, white at 6% opacity) instead of shadows — shadows don't read on near-black.

### Signature element
The **sync pulse**: a thin accent-colored ring around both users' presence avatars that pulses softly in unison when playback is synced, and breaks/dims when someone drifts or disconnects. It's the one piece of ornament in the app, and it communicates the app's entire reason to exist: "we're watching this together, right now."

### Motion
- One orchestrated moment: joining a room — dark screen, room title fades in, video surface rises, presence dots pop in. ~600ms total, then never seen again.
- Everything else: 150–200ms ease-out on state changes. No scroll animations, no floating blobs, no parallax.
- Respect `prefers-reduced-motion`: disable the pulse and join sequence, keep instant transitions.

### Copy voice
- Warm, plain, second person. "Waiting for Maria to join" not "1 participant pending."
- Buttons say what they do: "Start watching," "Share room," "Turn on mic."
- Errors say what happened and what to do: "Lost connection — reconnecting…" with a spinner, not "Something went wrong."
- Empty room state is an invitation: "Paste a YouTube link to start the show."
- No exclamation points in UI. No emoji in UI (fine in chat messages, obviously).

### Quality floor (non-negotiable, applies to every screen)
- Tap targets ≥ 44px. One-handed reachability: primary actions in the bottom half of the screen.
- Visible focus states (accent ring) for keyboard users.
- Test every screen on a real phone before calling it done — screenshot it and critique it.

### Never
- Gradients of any kind
- More than one accent color
- Emoji as UI icons (use lucide-react)
- Centered hero sections with big headline + subtitle + two buttons (SaaS template smell)
- Light mode (v1 is dark only — it's a movie app)

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

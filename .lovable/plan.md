## 3D Multiplayer FPS Arena — Build Plan

A browser-based 3D arena shooter with authentication, saved progress, real-time multiplayer, text chat, and voice chat.

### Stack
- **3D engine:** Three.js via `@react-three/fiber` + `@react-three/drei` + `@react-three/rapier` (physics)
- **Auth + DB + Realtime:** Lovable Cloud (email/password + Google)
- **Multiplayer sync:** Lovable Cloud Realtime (broadcast channels per room for positions/shots, presence for player list)
- **Text chat:** Lovable Cloud Realtime broadcast
- **Voice chat:** LiveKit (you'll need to create a free LiveKit Cloud account and provide API key + secret + WS URL)

### Game design (MVP arena shooter)
- Pointer-lock FPS controls (WASD + mouse, space to jump, click to shoot)
- One arena map: floor, walls, crates as cover, skybox
- Hitscan raycast gun, 100 HP, respawn after death
- Scoreboard (kills/deaths), match runs continuously
- Up to ~8 players per room

### Routes
```text
/                 Landing — title, "Play" CTA, sign in/up
/auth             Email/password + Google sign-in
/play             Room lobby (create/join room code)
/_authenticated/game/$roomId   The 3D game + chat + voice
```

### Data model (Lovable Cloud)
- `profiles` — id, username, avatar_url, created_at
- `player_stats` — user_id (PK), kills, deaths, matches_played, playtime_seconds, updated_at
- `match_history` — id, user_id, room_id, kills, deaths, ended_at

RLS: users read/update only their own rows; profiles are publicly readable for usernames on scoreboard.

### Realtime architecture
- **Game state:** Supabase broadcast channel `room:{roomId}` — clients send position/rotation at ~20Hz, shots as events, hits validated client-side then broadcast as damage events. Presence tracks who's in the room.
- **Chat:** broadcast event `chat` on the same channel.
- **Voice:** LiveKit room name = `roomId`. Server function mints an access token signed with LiveKit API secret.

### Server functions
- `getOrCreateProfile` — on first sign-in
- `recordMatchResult` — updates `player_stats` after a match
- `getLeaderboard` — top players by K/D
- `getLiveKitToken` — issues LiveKit JWT for the current user + room (requires `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`)

### What you'll need to provide
1. **LiveKit credentials** (free at livekit.io → Cloud → create project):
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
   - `LIVEKIT_URL` (wss://...)
2. **Google OAuth** is auto-configured by Lovable Cloud.

### Build order (multiple turns — this is a large app)
1. **Turn 1 (this one):** Enable Lovable Cloud, scaffold design system, build landing + auth + lobby routes, set up profile/stats tables. No 3D yet.
2. **Turn 2:** Build the 3D arena, FPS controls, shooting, single-player movement working.
3. **Turn 3:** Wire Supabase Realtime — multiplayer positions, shots, damage, scoreboard, text chat.
4. **Turn 4:** Add LiveKit voice chat (after you provide keys) + match result saving + leaderboard polish.

### Trade-offs / things to know
- Multiplayer authority is client-side for simplicity (no cheat protection). A true authoritative server would need a dedicated game server (out of scope for this stack).
- Mobile FPS controls are awkward; this is desktop-first.
- Voice requires mic permission and a LiveKit account.

Approve and I'll start with Turn 1.
# BlazeNXT Bot

A WhatsApp multi-device group management and AI companion bot, developed by **BlazeNXT**.

🌐 Website: [www.blazenxt.in](https://www.blazenxt.in)
🧠 AI Platform: [ai.blazenxt.in](https://ai.blazenxt.in)
🎥 YouTube Platform: [testweb3.cstsc.in/yt](https://testweb3.cstsc.in/yt)

---

## Features

- **150+ commands** — 44 public, 53 member, 26 admin, 27 owner
- **Blaze AI chatbot** — group-aware AI powered by the BlazeNXT Devil AI API
- **Group management** — welcome, warn, block, anti-link, member counting, tags and more
- **Media tools** — stickers, audio/video downloads through the self-hosted Premium Tube API (no cookies, no yt-dlp)
- **Web dashboard** — public status page with pairing-code login, plus a React admin panel (commands, members, groups, activity)
- **Self-contained** — embedded JSON file database (`jsondb/`), no external MongoDB required. Set `MONGODB_KEY` if you prefer a real MongoDB/Atlas backend
- Templates, reminders, sticky messages and schedulers

## Requirements

- Node.js ≥ 22 (Bun optional)
- A WhatsApp account to link (QR or pairing code)

## Quick Start

```bash
git clone https://github.com/blazenxt/WhatsAppBot-BlazeNXT.git
cd WhatsAppBot-BlazeNXT
cp .env.example .env   # fill in your values
npm install
node index.js
```

Then open the web dashboard, enter the bot's phone number, and link it with the 8-character pairing code.

## Configuration (.env)

| Variable | Description |
|---|---|
| `PREFIX` | Command prefix (default `.`) |
| `MY_NUMBER` | Owner WhatsApp number(s), digits only, no `+` |
| `BOT_NUMBER` | Bot's own number |
| `MODERATORS` | Comma-separated moderator numbers |
| `PORT` | Web server port (default 8000) |
| `ADMIN_PASSWORD` | Admin dashboard password |
| `SESSION_SECRET` | Random secret for dashboard sessions |
| `MONGODB_KEY` | Optional — MongoDB connection string. Leave empty for the built-in JSON database |
| `DEVIL_API_KEY` | BlazeNXT Devil AI key (`devil_blazenxt_…`) |
| `DEVIL_MODEL` | `devil-flash` / `devil-pro` / `devil-ultra` |
| `CST_YT_BASE` | Premium Tube API base (`https://testweb3.cstsc.in/yt`) |
| `GOOGLE_API_KEY`, `SEARCH_ENGINE_KEY`, etc. | Optional third-party APIs |

## Web Dashboard

- `/` — public status page (connection state, pairing code, QR)
- `/admin` — admin panel (login with `ADMIN_PASSWORD`): overview, commands, members, groups, activity log, settings
- `/api/status` — public JSON: `{ connected, registered }`

## Command Categories

- **Public** — alive, ping, dev, help, sticker, tts, weather, wiki, calculator, reminders, search, translate…
- **Members** — song/play (Premium Tube audio), yt/yta/vs video, lyrics, memes, jokes, images, quotes, dictionary…
- **Admins** — warn, block, add, remove, mute, anti-link, welcome settings, command blocking…
- **Owner** — broadcast, chat-memory management, global command toggles, block/unblock users…

Use `.help` inside WhatsApp for the full list.

## Tech Stack

- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web API (multi-device)
- Express + EJS + React (Vite) — dashboard
- Embedded JSON database (MongoDB-driver-compatible API) — zero external dependencies by default

## Credits

**Developed by BlazeNXT (www.blazenxt.in)**

Original upstream architecture inspired by open-source WhatsApp-MD systems.

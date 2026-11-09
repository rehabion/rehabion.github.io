# Danisa's server (Cloudflare Worker)

The website is static (GitHub Pages). Everything that needs a secret or has to stay online runs in this worker:
`https://rehabion-ai.rehabion.workers.dev`.

| File | What it does |
|---|---|
| `worker.js` | Router, text chat (Gemini), voice passes for Gemini Live, text-to-speech, `/health`, daily cron |
| `guard.js` | Turnstile → 2-hour pass, per-IP and daily limits, usage counters |
| `health.js` | Picks working models from Google's live list each day, alerts on Telegram, daily summary |
| `handoff.js` | "Talk to the founder": rooms, ringing, WebRTC signalling, consented notes, the report |
| `push.js` | Our own phone alerts (Web Push/VAPID), Telegram, the founder inbox and stats |

## How a founder call works
1. The visitor asks Danisa for the founder, by voice or with the button. Danisa asks whether she may take notes.
2. `POST /handoff` creates a private room (it lives 24 h) and rings the founder: push notification, Telegram and email.
3. The founder opens the link. Danisa (a locked Gemini Live session) tells him who is waiting and asks if he's free.
   He can also tap **Skip Danisa — connect me**.
4. If he's free, the two browsers connect directly over WebRTC, and Danisa introduces them.
   If the visitor agreed, two transcribers write down each side, and the lines go to the room every 4 seconds.
5. When the call ends, the report is written once and sent to Telegram, and Danisa offers a spoken debrief.
   If the founder's tab died, the room writes the report itself 25 seconds after the call ends.

## Secrets (`npx wrangler secret put NAME`)
| Name | Needed | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | https://aistudio.google.com/apikey |
| `FOUNDER_PIN` | yes | unlocks the founder app on a phone, plus stats; 8 wrong tries lock it for 1 hour |
| `VAPID_PRIVATE_JWK` | yes | phone alerts (the public key is in `wrangler.toml`) |
| `TELEGRAM_BOT_TOKEN` | optional | alerts and reports; link the chat from the founder app |
| `TURNSTILE_SECRET` | optional | bot check; the site key is in `assistant.js` |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | recommended | Cloudflare TURN relay, so calls connect on strict mobile networks |

Optional vars: `GEMINI_MODEL`, `LIVE_MODEL`, `TRANSCRIBE_MODEL`, `TTS_MODEL` pin a model and switch off the automatic choice.
Also `FOUNDER_NAME`, `SITE_URL`, `ALLOWED_ORIGINS`, `FORMSPREE_FORM` (`off` disables email).

## Limits (guard.js)
Per IP per hour, with a Turnstile pass / without one:

| Action | With a pass | Without |
|---|---|---|
| Chat | 120 | 20 |
| Text-to-speech | 60 | 10 |
| Voice calls | 30 | 4 |
| Founder requests | 4 | 2 |

Daily caps for everyone: 600 voice calls, 60 founder requests. Email copies stop at 45 a month (Formspree's free plan allows 50).

## Develop and test
```sh
cd ai-worker && npm install
# .dev.vars (git-ignored), e.g.:
#   FOUNDER_PIN="1234"
#   TURNSTILE_SECRET="1x0000000000000000000000000000000AA"   (Cloudflare's always-pass test key)
#   HANDOFF_DEBUG="1"                                         (returns the founder link, skips email)
#   GEMINI_API_KEY="…"                                        (only for real AI answers)
npm run dev
BASE=http://127.0.0.1:8788 npm test           # API + static tests, also run by GitHub Actions on every push
node ../tests/e2e/secretary.mjs v.wav f.wav   # full two-browser rehearsal with real voices (needs puppeteer-core)
```
Deploy: `npx wrangler deploy`. `.github/workflows/monitor.yml` checks `/health` every 6 hours.

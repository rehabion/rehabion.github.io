# Danisa's server (Cloudflare Worker)

The website is static (GitHub Pages). Everything that needs a secret or has to stay online runs in this worker:
`https://rehabion-ai.rehabion.workers.dev`.

| File | What it does |
|---|---|
| `worker.js` | Router, text chat (Gemini), voice passes for Gemini Live, text-to-speech, `/health`, daily cron |
| `guard.js` | Turnstile → 2-hour pass, per-IP and daily limits, usage counters |
| `health.js` | Picks working models from Google's live list each day, alerts on Telegram, daily summary |
| `handoff.js` | "Talk to the founder": rooms, ringing, WebRTC signalling, consented notes, the report |
| `push.js` | Our own phone alerts (Web Push/VAPID), Telegram, the founder inbox and stats, 👍/👎 buttons on reports |
| `clinic.js` | Danisa for clinics: receptionist (booking, red flags, call-backs), SOAP scribe, home-exercise coach |
| `triage.js` | Fixed red-flag rules under the AI (also used by `bench/`) |
| `report.js` | The call-report prompt (also used by `bench/`) |

## How a founder call works
1. The visitor asks Danisa for the founder, by voice or with the button. Danisa asks whether she may take notes.
2. `POST /handoff` creates a private room (it lives 24 h) and rings the founder: push notification, Telegram and email.
3. The founder opens the link. Danisa (a locked Gemini Live session) tells him who is waiting and asks if he's free.
   He can also tap **Skip Danisa — connect me**.
4. If he's free, the two browsers connect directly over WebRTC, and Danisa introduces them.
   If the visitor agreed, two transcribers write down each side, and the lines go to the room every 4 seconds.
5. When the call ends, the report is written once and sent to Telegram, and Danisa offers a spoken debrief.
   If the founder's tab died, the room writes the report itself 25 seconds after the call ends.

## Danisa for clinics (pilot)
| Page | Who | What |
|---|---|---|
| `clinic.html?c=<id>` | patients | Talk or type in any language. Danisa answers from the clinic's settings, asks one safety question, books into free slots (a 6-letter code), cancels, or takes a call-back. Red flags → "call 1122" and an alert to the clinic. |
| `clinic-admin.html?c=<id>` | staff (PIN) | Today's appointments (came / no-show), call-backs, red flags · patients and their exercise plans · SOAP notes from a recorded session (consent required, audio not stored) · settings, Telegram, PIN · 30-day numbers |
| `coach/#c=&p=&k=` | one patient | A voice coach that follows the therapist's plan and the patient's measured range of motion ("92° yesterday, let's try 95°"), a daily reminder on their phone, alerts the clinic on pain ≥ 7 or red flags |

- **New clinic:** `clinic-admin.html?new=1` with the founder PIN. This gives the clinic its id and a staff PIN. Until the clinic links its own Telegram, its messages go to the founder's, tagged with the clinic name.
- **Next goal:** the best of the last three readings plus the therapist's step (default 3°), capped at their target. The AI never chooses the number.
- **RBN game → coach:** the game POSTs each result to `/coach/data?c=<clinic>&p=<patient>&k=<key>` (the patient's view in the staff app shows the URL):
  ```json
  {"exercise":"shoulder_abduction","value":92,"reps":10,"source":"RBN-001"}      // or {"readings":[…]} — up to 50
  ```
  Exercise ids: `shoulder_abduction`, `shoulder_flexion`, `elbow_extension` (RBN-001), `knee_flexion`, `step_symmetry`, `cadence` (RBN-002), or any `snake_case` id.
- **Kept:** bookings until 30 days after the appointment, call-backs 14 days, red flags 30 days; patients and saved notes until the clinic deletes them. Cron: every hour sends reminders; at 3 am clinic time it cleans up.

## Gemini quota: read this before a pilot
On the **free tier** each text model allows about **20 requests a day** per project, and popular models often answer `503 high demand`. The worker spreads requests over a chain of models and skips any that are failing (`health.js` `PREFER`). That keeps the site up, but answers get slow (20–100 s) once the good models are used up. The daily health check reports it on Telegram. **For a clinic pilot, turn on billing** for the key in AI Studio. Flash-class models cost a few cents per thousand messages.

## Secrets (`npx wrangler secret put NAME`)
| Name | Needed | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | https://aistudio.google.com/apikey |
| `FOUNDER_PIN` | yes | unlocks the founder app on a phone, plus stats; 8 wrong tries lock it for 1 hour |
| `VAPID_PRIVATE_JWK` | yes | phone alerts (the public key is in `wrangler.toml`) |
| `TELEGRAM_BOT_TOKEN` | optional | alerts and reports; link the chat from the founder app |
| `TURNSTILE_SECRET` | optional | bot check; the site key is in `assistant.js` |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | recommended | Cloudflare TURN relay, so calls connect on strict mobile networks |
| `LINK_SECRET` | optional | signs report-rating links and clinic staff logins (defaults to a hash of the other secrets) |

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
| Clinic: receptionist tools / bookings | 200 / 6 | 40 / 3 |
| Clinic: SOAP notes · game readings | 40 · 600 | 40 · 600 |

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
BASE=http://127.0.0.1:8788 npm test           # static + API + clinic tests, also run by GitHub Actions on every push
GEMINI_API_KEY=… npm run bench                # the Urdu/English/Punjabi benchmark (see bench/README.md)
node ../tests/e2e/secretary.mjs v.wav f.wav   # full two-browser rehearsal with real voices (needs puppeteer-core)
```
Deploy: `npx wrangler deploy`. `.github/workflows/monitor.yml` checks `/health` every 6 hours.

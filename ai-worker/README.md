# Noor's AI brain (Gemini + Google Search)

The website works without this: Noor answers questions about REHABION from built-in notes.
Connecting this worker lets her answer **anything**, in English and Urdu, using Google Gemini with live Google Search.

The API key must stay secret, so it lives in a free Cloudflare Worker, not in the public website.

## Setup (about 10 minutes, free)

1. **Get a Gemini API key:** go to https://aistudio.google.com/apikey, sign in with Google, and click **Create API key**.
2. **Create the worker:** go to https://dash.cloudflare.com, create a free account, then open **Workers & Pages → Create → Create Worker**. Name it `rehabion-ai` and click **Deploy**.
3. Click **Edit code**, delete everything, paste in the contents of [`worker.js`](worker.js), and click **Deploy**.
4. In the worker, open **Settings → Variables and Secrets → Add**:
   - Type **Secret**, name `GEMINI_API_KEY`, value = your key.
   - Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`).
5. Copy the worker URL, e.g. `https://rehabion-ai.yourname.workers.dev`.
6. In `assistant.js` on the website, set:
   ```js
   const AI_ENDPOINT = window.REHABION_AI_ENDPOINT || 'https://rehabion-ai.yourname.workers.dev';
   ```
   Then commit and push.

## Voice notes
- Voice chat uses the browser's built-in speech engine: Chrome, Edge or Safari, and it needs microphone permission.
- Urdu speech recognition (`ur-PK`) works in Chrome and Edge.
- The quality of the Urdu *speaking* voice depends on the device. Microsoft Edge has natural Urdu voices (Uzma, Asad). If no Urdu voice is installed, Noor still shows her reply as text.

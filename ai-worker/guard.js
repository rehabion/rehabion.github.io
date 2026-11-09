/* ── Abuse protection + usage counters ──
   Every visitor gets a "pass" once: the page solves an invisible Cloudflare Turnstile
   check, POST /pass swaps that for a signed pass (2 h, tied to their IP). Requests
   with a pass get normal limits; without one (Turnstile blocked, old page) they still
   work, just with tight limits — the site never breaks, bots just can't farm it.

   Secrets: TURNSTILE_SECRET (if unset, everyone counts as having a pass)
*/
const enc = s => new TextEncoder().encode(s);
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const PASS_HOURS = 2;

/* per IP, per hour — [with pass, without] */
export const LIMITS = {
  chat: [120, 20], tts: [60, 10], live: [30, 4], handoff: [4, 2]
};
export const GLOBAL_PER_DAY = { live: 600, handoff: 60 };   // keeps the free Gemini quota and the founder's phone safe

export const ipOf = request => request.headers.get('CF-Connecting-IP') || '0.0.0.0';

let passKey = null;
async function key(env) {
  if (!passKey) passKey = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc('danisa-pass:' + env.TURNSTILE_SECRET)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return passKey;
}
async function sign(env, text) { return b64url(await crypto.subtle.sign('HMAC', await key(env), enc(text))); }

/* Turnstile token → pass */
export async function issuePass(env, request, token) {
  if (!env.TURNSTILE_SECRET) return { pass: 'open' };
  const ip = ipOf(request);
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET); form.append('response', String(token || '').slice(0, 2048)); form.append('remoteip', ip);
  /* if Cloudflare can't be reached, no pass — the visitor just keeps the tighter limits */
  const d = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form, signal: AbortSignal.timeout(5000) })
    .then(r => r.json()).catch(() => ({}));
  if (!d.success) return { error: 'check failed' };
  const exp = Date.now() + PASS_HOURS * 3600e3, body = `${exp}.${ip}`;
  return { pass: `${exp}.${await sign(env, body)}`, expires: exp };
}

export async function hasPass(env, request) {
  if (!env.TURNSTILE_SECRET) return true;
  const p = request.headers.get('X-Danisa-Pass') || '';
  const [exp, sig] = p.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sig === await sign(env, `${exp}.${ipOf(request)}`);
}

/* returns null when allowed, or a reason when not */
export async function limit(env, request, bucket) {
  const ip = ipOf(request), pass = await hasPass(env, request);
  const max = LIMITS[bucket][pass ? 0 : 1];
  const mine = env.LIMITS.get(env.LIMITS.idFromName(`${bucket}:${ip}`));
  if (!(await mine.hit(max, 3600))) return pass ? 'slow down' : 'verify';
  if (GLOBAL_PER_DAY[bucket]) {
    const all = env.LIMITS.get(env.LIMITS.idFromName(`${bucket}:all`));
    if (!(await all.hit(GLOBAL_PER_DAY[bucket], 86400))) return 'busy';
  }
  return null;
}

/* fire-and-forget usage counters (shown in the founder app, summarised on Telegram) */
export function count(env, ctx, ...events) {
  const job = env.INBOX.get(env.INBOX.idFromName('founder')).count(events).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(job); else return job;
}

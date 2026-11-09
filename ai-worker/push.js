/* ── Founder alerts we run ourselves ──
   1. Web Push: the founder's phone gets a ringing notification from our own
      server — no WhatsApp/Telegram/accounts. Pushes carry no data (so nothing
      needs encrypting); the phone wakes, asks /push/pending and shows who's calling.
   2. Telegram: sent straight to Telegram's official Bot API (no middleman).

   Secrets: FOUNDER_PIN (unlocks setting up a phone), VAPID_PRIVATE_JWK
   Vars:    VAPID_PUBLIC (base64url, 65-byte P-256 public key), VAPID_SUBJECT
   Optional secret: TELEGRAM_BOT_TOKEN (the chat is linked via /push/telegram-link) */
import { DurableObject } from 'cloudflare:workers';

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = s => new TextEncoder().encode(s);
const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

let signingKey = null;
async function vapidHeader(env, endpoint) {
  if (!signingKey) signingKey = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64url(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(enc(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:muhammadrmzn84@gmail.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, enc(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

/* ring every registered phone; drop subscriptions the browser has thrown away */
export async function pushAll(env) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return false;
  const inbox = env.INBOX.get(env.INBOX.idFromName('founder'));
  const subs = await inbox.subscriptions();
  let any = false;
  await Promise.all(subs.map(async ({ device, endpoint }) => {
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: await vapidHeader(env, endpoint), TTL: '120', Urgency: 'high', 'Content-Length': '0' } });
      if (r.status === 404 || r.status === 410) await inbox.forget(device);
      else if (r.ok) any = true;
    } catch (e) {}
  }));
  return any;
}

export async function telegram(env, text, link) {
  if (!env.TELEGRAM_BOT_TOKEN) return false;
  const chat = env.TELEGRAM_CHAT_ID || await env.INBOX.get(env.INBOX.idFromName('founder')).telegramChat();
  if (!chat) return false;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '📞 Answer now', url: link }]] } })
  });
  return r.ok;
}

export async function telegramText(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN) return false;
  const chat = env.TELEGRAM_CHAT_ID || await env.INBOX.get(env.INBOX.idFromName('founder')).telegramChat();
  if (!chat) return false;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true })
  });
  return r.ok;
}

/* Routes: GET /push/vapid · POST /push/subscribe · GET /push/pending · POST /push/test */
export async function handlePush(request, env, headers, path) {
  const inbox = env.INBOX.get(env.INBOX.idFromName('founder'));
  const url = new URL(request.url);
  if (path === '/push/vapid') return json({ key: env.VAPID_PUBLIC || null }, 200, headers);

  if (path === '/push/subscribe' && request.method === 'POST') {
    let b; try { b = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, headers); }
    const sub = b.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) return json({ error: 'Bad subscription' }, 400, headers);
    const res = await inbox.subscribe(String(b.pin || ''), env.FOUNDER_PIN || '', sub.endpoint, String(b.label || '').slice(0, 40));
    return json(res, res.error ? 403 : 200, headers);
  }

  /* link Telegram: the founder messages his bot, then this finds his chat (PIN-protected) */
  if (path === '/push/telegram-link' && request.method === 'POST') {
    let b; try { b = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, headers); }
    if (!env.FOUNDER_PIN || String(b.pin || '') !== env.FOUNDER_PIN) return json({ error: 'Wrong PIN.' }, 403, headers);
    if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'Bot token not set.' }, 400, headers);
    const d = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`)).json();
    const msgs = (d.result || []).map(u => u.message || u.edited_message).filter(m => m && m.chat && m.chat.type === 'private');
    if (!msgs.length) return json({ error: 'No message found — send "hi" to your bot in Telegram, then try again.' }, 404, headers);
    const chat = msgs[msgs.length - 1].chat;
    await inbox.setTelegramChat(String(chat.id));
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat.id, text: '✅ REHABION call alerts are on. When a website visitor asks for you, you’ll get a message here with an Answer button.' }) });
    return json({ linked: true, name: chat.first_name || chat.username || '' }, 200, headers);
  }

  const device = url.searchParams.get('d') || '';
  if (!/^[0-9a-f]{32}$/.test(device)) return json({ error: 'Bad device' }, 400, headers);
  if (path === '/push/pending') {
    const list = await inbox.pending(device);
    return list ? json({ requests: list }, 200, headers) : json({ error: 'Unknown device' }, 403, headers);
  }
  if (path === '/push/test' && request.method === 'POST') {
    if (!(await inbox.known(device))) return json({ error: 'Unknown device' }, 403, headers);
    await inbox.add({ id: 'test', name: 'Test call', reason: 'This is what an incoming request looks like.', contact: '', link: '', createdAt: Date.now(), test: true });
    return json({ sent: await pushAll(env) }, 200, headers);
  }
  return json({ error: 'Not found' }, 404, headers);
}

/* The founder's private inbox: registered phones + the last day's requests. */
export class Inbox extends DurableObject {
  async subscribe(pin, realPin, endpoint, label) {
    const fails = (await this.ctx.storage.get('fails')) || { hour: 0, n: 0 };
    const hour = Math.floor(Date.now() / 3600e3);
    if (fails.hour !== hour) { fails.hour = hour; fails.n = 0; }
    if (fails.n >= 8) return { error: 'Too many wrong PINs — try again in an hour.' };
    if (!realPin || pin !== realPin) { fails.n++; await this.ctx.storage.put('fails', fails); return { error: 'Wrong PIN.' }; }
    const subs = (await this.ctx.storage.get('subs')) || {};
    for (const [d, s] of Object.entries(subs)) if (s.endpoint === endpoint) delete subs[d];
    const device = hex(16);
    subs[device] = { endpoint, label, created: Date.now() };
    await this.ctx.storage.put('subs', subs);
    return { device };
  }
  async subscriptions() {
    const subs = (await this.ctx.storage.get('subs')) || {};
    return Object.entries(subs).map(([device, s]) => ({ device, endpoint: s.endpoint }));
  }
  async telegramChat() { return (await this.ctx.storage.get('telegramChat')) || ''; }
  async setTelegramChat(id) { await this.ctx.storage.put('telegramChat', id); }
  async known(device) { return !!((await this.ctx.storage.get('subs')) || {})[device]; }
  async forget(device) {
    const subs = (await this.ctx.storage.get('subs')) || {};
    delete subs[device]; await this.ctx.storage.put('subs', subs);
  }
  async add(req) {
    const day = Date.now() - 24 * 3600e3;
    const list = ((await this.ctx.storage.get('requests')) || []).filter(r => r.createdAt > day && !(req.test && r.test));
    list.unshift(req);
    await this.ctx.storage.put('requests', list.slice(0, 30));
  }
  async pending(device) {
    if (!(await this.known(device))) return null;
    const day = Date.now() - 24 * 3600e3;
    return ((await this.ctx.storage.get('requests')) || []).filter(r => r.createdAt > day);
  }
}

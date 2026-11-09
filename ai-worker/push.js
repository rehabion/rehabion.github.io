/* ── Founder alerts we run ourselves ──
   1. Web Push: the founder's phone gets a ringing notification from our own
      server — no WhatsApp/Telegram/accounts. Pushes carry no data (so nothing
      needs encrypting); the phone wakes, asks /push/pending and shows who's calling.
   2. Telegram: sent straight to Telegram's official Bot API (no middleman).

   Secrets: FOUNDER_PIN (unlocks setting up a phone), VAPID_PRIVATE_JWK
   Vars:    VAPID_PUBLIC (base64url, 65-byte P-256 public key), VAPID_SUBJECT
   Optional secret: TELEGRAM_BOT_TOKEN (the chat is linked via /push/telegram-link) */
import { DurableObject } from 'cloudflare:workers';
import { hmac } from './guard.js';

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

/* one phone (a patient's exercise reminder) — returns the push service's HTTP status */
export async function pushOne(env, endpoint) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return 0;
  try {
    const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: await vapidHeader(env, endpoint), TTL: '3600', Urgency: 'normal', 'Content-Length': '0' } });
    return r.status;
  } catch (e) { return 0; }
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

/* buttons: optional rows of { text, url }; chat: send somewhere other than the founder (a clinic) */
export async function telegramText(env, text, buttons, chat) {
  if (!env.TELEGRAM_BOT_TOKEN) return false;
  chat = chat || env.TELEGRAM_CHAT_ID || await env.INBOX.get(env.INBOX.idFromName('founder')).telegramChat();
  if (!chat) return false;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true, ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) })
  });
  return r.ok;
}

/* 👍 / 👎 / "became a demo" under each call report — signed links back to this worker */
const WORKER = env => env.WORKER_URL || 'https://rehabion-ai.rehabion.workers.dev';
export async function rateLinks(env, id) {
  const url = async v => `${WORKER(env)}/rate?r=${id}&v=${v}&s=${await hmac(env, 'rate', id + v)}`;
  return [[{ text: '👍 Useful', url: await url('up') }, { text: '👎 Not useful', url: await url('down') }], [{ text: '🗓 Became a demo / deal', url: await url('demo') }]];
}
export async function handleRate(request, env) {
  const u = new URL(request.url), id = u.searchParams.get('r') || '', v = u.searchParams.get('v') || '';
  const page = (msg, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>REHABION</title><body style="font:18px system-ui;background:#F5EFE4;color:#1E1B18;display:grid;place-items:center;min-height:90vh;text-align:center"><p>${msg}</p>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (!/^[0-9a-f]{24}$/.test(id) || !['up', 'down', 'demo'].includes(v) || u.searchParams.get('s') !== await hmac(env, 'rate', id + v)) return page('This link is not valid.', 400);
  await env.INBOX.get(env.INBOX.idFromName('founder')).rate(id, v);
  return page(v === 'demo' ? '🗓 Counted as a demo / deal. Nice work!' : v === 'up' ? '👍 Thanks — noted that the report was useful.' : '👎 Thanks — noted. Danisa will learn from it.');
}

/* Routes: GET /push/vapid · POST /push/subscribe · POST /push/telegram-link · POST /push/stats
           GET /push/pending · POST /push/test */
export async function handlePush(request, env, headers, path) {
  const inbox = env.INBOX.get(env.INBOX.idFromName('founder'));
  const url = new URL(request.url);
  if (path === '/push/vapid') return json({ key: env.VAPID_PUBLIC || null }, 200, headers);

  if (path === '/push/subscribe' && request.method === 'POST') {
    let b; try { b = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, headers); }
    const sub = b.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) return json({ error: 'Bad subscription' }, 400, headers);
    const res = await inbox.subscribe(String(b.pin || ''), env.FOUNDER_PIN || '', sub.endpoint, String(b.label || '').slice(0, 40).replace(/[<>]/g, ''));
    return json(res, res.error ? 403 : 200, headers);
  }

  /* link Telegram: the founder messages his bot, then this finds his chat (PIN-protected) */
  if (path === '/push/telegram-link' && request.method === 'POST') {
    let b; try { b = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, headers); }
    const bad = await inbox.checkPin(String(b.pin || ''), env.FOUNDER_PIN || '');
    if (bad) return json({ error: bad }, 403, headers);
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

  /* the last 30 days of usage, for the founder app (PIN or a registered phone) */
  if (path === '/push/stats' && request.method === 'POST') {
    let b; try { b = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, headers); }
    const ok = (/^[0-9a-f]{32}$/.test(String(b.device || '')) && await inbox.known(String(b.device))) || !(await inbox.checkPin(String(b.pin || ''), env.FOUNDER_PIN || ''));
    if (!ok) return json({ error: 'Not allowed' }, 403, headers);
    return json({ stats: await inbox.stats(30), health: await inbox.getConfig('health') }, 200, headers);
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
  /* one PIN check for everything, with a lock-out: null = OK, otherwise the reason */
  async checkPin(pin, realPin) {
    const fails = (await this.ctx.storage.get('fails')) || { hour: 0, n: 0 };
    const hour = Math.floor(Date.now() / 3600e3);
    if (fails.hour !== hour) { fails.hour = hour; fails.n = 0; }
    if (fails.n >= 8) return 'Too many wrong PINs — try again in an hour.';
    if (!realPin || pin !== realPin) { fails.n++; await this.ctx.storage.put('fails', fails); return 'Wrong PIN.'; }
    return null;
  }
  async subscribe(pin, realPin, endpoint, label) {
    const bad = await this.checkPin(pin, realPin);
    if (bad) return { error: bad };
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
  /* usage counters, one bucket per day, 35 days kept */
  async count(events) {
    const day = new Date().toISOString().slice(0, 10);
    const all = (await this.ctx.storage.get('stats')) || {};
    const d = all[day] || (all[day] = {});
    for (const e of events) d[e] = (d[e] || 0) + 1;
    const keep = Object.keys(all).sort().slice(-35);
    await this.ctx.storage.put('stats', Object.fromEntries(keep.map(k => [k, all[k]])));
  }
  /* sums (seconds to connect, etc.) — shown as averages next to the counts */
  async addSums(values) {
    const day = new Date().toISOString().slice(0, 10);
    const all = (await this.ctx.storage.get('stats')) || {};
    const d = all[day] || (all[day] = {});
    for (const [k, v] of Object.entries(values)) { d[k] = (d[k] || 0) + (Number(v) || 0); d[k + 'N'] = (d[k + 'N'] || 0) + 1; }
    await this.ctx.storage.put('stats', all);
  }
  /* one rating per report (changing your mind moves the count); a demo is counted once */
  async rate(id, v) {
    const r = (await this.ctx.storage.get('ratings')) || {};
    const was = r[id] || {}, events = [];
    if (v === 'demo') { if (!was.demo) events.push('demo'); was.demo = true; }
    else if (was.vote !== v) { events.push('rate_' + v); if (was.vote) events.push('unrate_' + was.vote); was.vote = v; }
    r[id] = { ...was, at: Date.now() };
    const keep = Object.entries(r).sort((a, b) => b[1].at - a[1].at).slice(0, 300);
    await this.ctx.storage.put('ratings', Object.fromEntries(keep));
    if (events.length) await this.count(events);
  }
  /* clinics the cron should visit */
  async clinics() { return (await this.ctx.storage.get('clinics')) || []; }
  async addClinic(slug) { const l = await this.clinics(); if (!l.includes(slug)) { l.push(slug); await this.ctx.storage.put('clinics', l); } }
  async stats(days) {
    const all = (await this.ctx.storage.get('stats')) || {};
    return Object.fromEntries(Object.keys(all).sort().slice(-days).map(k => [k, all[k]]));
  }
  /* Formspree's free plan allows 50 e-mails a month — stop before it silently fails */
  async allowEmail(max) {
    const month = new Date().toISOString().slice(0, 7);
    const e = (await this.ctx.storage.get('email')) || { month, n: 0 };
    if (e.month !== month) { e.month = month; e.n = 0; }
    if (e.n >= max) return false;
    e.n++; await this.ctx.storage.put('email', e);
    return true;
  }
  async getConfig(k) { return (await this.ctx.storage.get('cfg:' + k)) || null; }
  async setConfig(k, v) { await this.ctx.storage.put('cfg:' + k, v); }

  async pending(device) {
    if (!(await this.known(device))) return null;
    const day = Date.now() - 24 * 3600e3;
    return ((await this.ctx.storage.get('requests')) || []).filter(r => r.createdAt > day);
  }
}

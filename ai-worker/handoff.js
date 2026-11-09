/* ── "Talk to the founder" hand-off ──
   A visitor asks Danisa to reach the founder → we create a private room, ping the
   founder on WhatsApp / Telegram with a one-time link, and if he taps "Answer" the
   two browsers are connected with a WebRTC voice call. The founder's phone number
   lives only in Worker secrets — it is never sent to a visitor.

   Alerts (see push.js): our own phone notifications (Web Push), Telegram's
   official Bot API, and an e-mail copy through the site's contact form.
   Optional secrets:
     TURN_KEY_ID, TURN_KEY_API_TOKEN    Cloudflare Realtime TURN (helps calls through strict networks)
     FOUNDER_NAME                       defaults to "Muhammad Ramzan"
     SITE_URL                           defaults to https://rehabion.github.io
*/
import { DurableObject } from 'cloudflare:workers';
import { pushAll, telegram } from './push.js';

const RING_SECONDS = 120;          // how long a visitor waits for an answer
const KEEP_HOURS = 24;             // request details are wiped after this
const MAX_PER_HOUR = 12;           // protects the founder's phone from spam

const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const clean = (s, n) => typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n) : '';
const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

async function notifyFounder(env, req, link, id) {
  const text = `📞 REHABION website — ${req.name} wants to talk to you now.
` +
    `About: ${req.reason || '—'}
` + (req.contact ? `Their contact: ${req.contact}
` : '') +
    `
Answer in your browser (rings for ${RING_SECONDS / 60} min):
${link}`;
  /* our own inbox + phone ring first, then Telegram, then e-mail as a safety net */
  await env.INBOX.get(env.INBOX.idFromName('founder')).add({ id, name: req.name, reason: req.reason, contact: req.contact, link, createdAt: Date.now() });
  const jobs = [pushAll(env), telegram(env, text, link)];
  const form = env.FORMSPREE_FORM || 'mzdlbqel';
  if (form !== 'off' && env.HANDOFF_DEBUG !== '1') {
    jobs.push(fetch(`https://formspree.io/f/${form}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ _subject: `📞 ${req.name} wants to talk to you (REHABION website)`, name: req.name,
        inquiry_type: 'founder-call', message: text, contact: req.contact || '' })
    }).then(r => r.ok));
  }
  if (env.HANDOFF_DEBUG === '1') console.log('founder link:', link);
  const results = await Promise.allSettled(jobs);
  return results.some(r => r.status === 'fulfilled' && r.value);
}

async function iceServers(env) {
  const list = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST', headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 3600 })
      });
      if (r.ok) { const d = await r.json(); const s = d.iceServers; list.push(...(Array.isArray(s) ? s : [s])); }
    } catch (e) {}
  }
  return list;
}

/* Routes: POST /handoff · GET /handoff/info · GET /handoff/ws (WebSocket) */
export async function handleHandoff(request, env, headers, path) {
  const url = new URL(request.url);

  if (path === '/handoff' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, headers); }
    const req = { name: clean(body.name, 60) || 'A visitor', reason: clean(body.reason, 300), contact: clean(body.contact, 80), lang: clean(body.lang, 8) };
    const limit = await env.LIMITS.get(env.LIMITS.idFromName('global')).hit(MAX_PER_HOUR);
    if (!limit) return json({ error: 'busy', message: 'Too many requests right now — please try again later.' }, 429, headers);
    const id = hex(12), founderKey = hex(16), visitorKey = hex(16);
    const room = env.ROOMS.get(env.ROOMS.idFromName(id));
    await room.init({ ...req, id, founderKey, visitorKey, createdAt: Date.now() }, RING_SECONDS);
    const site = env.SITE_URL || 'https://rehabion.github.io';
    const link = `${site}/founder.html#r=${id}&k=${founderKey}`;
    const notified = await notifyFounder(env, req, link, id);
    return json({ id, visitorKey, notified, ringSeconds: RING_SECONDS, founder: env.FOUNDER_NAME || 'Muhammad Ramzan', ...(env.HANDOFF_DEBUG === '1' ? { founderLink: link } : {}) }, 200, headers);
  }

  const id = url.searchParams.get('r') || '', key = url.searchParams.get('k') || '';
  if (!/^[0-9a-f]{24}$/.test(id) || !/^[0-9a-f]{32}$/.test(key)) return json({ error: 'Bad link' }, 400, headers);
  const room = env.ROOMS.get(env.ROOMS.idFromName(id));

  if (path === '/handoff/info') {
    const info = await room.info(key);
    if (!info) return json({ error: 'This request has expired.' }, 404, headers);
    return json({ ...info, iceServers: await iceServers(env) }, 200, headers);
  }

  if (path === '/handoff/ws') {
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'WebSocket only' }, 426, headers);
    return room.fetch(request);
  }
  return json({ error: 'Not found' }, 404, headers);
}

/* One room per request. Holds the details, rings, relays the call set-up between the two browsers. */
export class HandoffRoom extends DurableObject {
  async init(req, ringSeconds) {
    await this.ctx.storage.put({ req, status: 'ringing' });
    await this.ctx.storage.setAlarm(Date.now() + ringSeconds * 1000);
  }

  async roleFor(key) {
    const req = await this.ctx.storage.get('req');
    if (!req) return null;
    if (key === req.founderKey) return 'founder';
    if (key === req.visitorKey) return 'visitor';
    return null;
  }

  async info(key) {
    const role = await this.roleFor(key);
    if (!role) return null;
    const req = await this.ctx.storage.get('req'), status = await this.ctx.storage.get('status');
    return role === 'founder'
      ? { role, status, name: req.name, reason: req.reason, contact: req.contact, createdAt: req.createdAt }
      : { role, status };
  }

  async fetch(request) {
    const key = new URL(request.url).searchParams.get('k');
    const role = await this.roleFor(key);
    if (!role) return new Response('Expired', { status: 404 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [role]);
    const status = await this.ctx.storage.get('status');
    pair[1].send(JSON.stringify({ t: 'status', status }));
    if (role === 'founder') this.broadcast('visitor', { t: 'founder-opened' });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  broadcast(role, msg) {
    for (const ws of this.ctx.getWebSockets(role)) { try { ws.send(JSON.stringify(msg)); } catch (e) {} }
  }
  async setStatus(status, extra = {}) {
    await this.ctx.storage.put('status', status);
    const msg = { t: 'status', status, ...extra };
    this.broadcast('founder', msg); this.broadcast('visitor', msg);
  }

  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const role = this.ctx.getTags(ws)[0], other = role === 'founder' ? 'visitor' : 'founder';
    const status = await this.ctx.storage.get('status');
    if (m.t === 'accept' && role === 'founder' && status === 'ringing') return this.setStatus('accepted');
    if (m.t === 'busy' && role === 'founder' && (status === 'ringing' || status === 'accepted')) return this.setStatus('busy', { note: clean(m.note, 200) });
    if (m.t === 'cancel' && role === 'visitor' && status === 'ringing') return this.setStatus('cancelled');
    if (m.t === 'hangup') return this.setStatus('ended');
    if (m.t === 'connected' && status === 'accepted') return this.setStatus('in-call');
    if (['offer', 'answer', 'ice'].includes(m.t)) this.broadcast(other, m);   // WebRTC set-up passes straight through
  }

  async webSocketClose(ws) {
    const role = this.ctx.getTags(ws)[0], status = await this.ctx.storage.get('status');
    if (role === 'visitor' && status === 'ringing' && this.ctx.getWebSockets('visitor').length <= 1) await this.setStatus('left');
    if (status === 'in-call' || status === 'accepted') {
      const still = this.ctx.getWebSockets(role).filter(w => w !== ws && w.readyState === 1);
      if (!still.length) await this.setStatus('ended');
    }
  }

  async alarm() {
    const req = await this.ctx.storage.get('req');
    if (!req) return;
    if ((await this.ctx.storage.get('status')) === 'ringing') await this.setStatus('missed');
    const wipeAt = req.createdAt + KEEP_HOURS * 3600e3;
    if (Date.now() < wipeAt) return this.ctx.storage.setAlarm(wipeAt);
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, 'expired'); } catch (e) {} }
    await this.ctx.storage.deleteAll();
  }
}

/* Simple hourly counter so nobody can flood the founder's WhatsApp. */
export class RateLimit extends DurableObject {
  async hit(max) {
    const hour = Math.floor(Date.now() / 3600e3);
    const s = (await this.ctx.storage.get('s')) || { hour, n: 0 };
    if (s.hour !== hour) { s.hour = hour; s.n = 0; }
    if (s.n >= max) return false;
    s.n++; await this.ctx.storage.put('s', s);
    return true;
  }
}

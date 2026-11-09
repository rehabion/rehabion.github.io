/* API tests for the Danisa worker — run against `wrangler dev`:
     cd ai-worker && npx wrangler dev --port 8788 --var HANDOFF_DEBUG:1 --var FOUNDER_PIN:1234 \
       --var TURNSTILE_SECRET:1x0000000000000000000000000000000AA
     BASE=http://127.0.0.1:8788 node --test tests/
   No Gemini key needed: the call report falls back to a plain summary without one.
   (The always-pass TURNSTILE_SECRET above is Cloudflare's official test key.) */
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const WS = BASE.replace(/^http/, 'ws');
const post = (path, body, headers = {}) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const ip = () => `10.${Math.random() * 255 | 0}.${Math.random() * 255 | 0}.${Math.random() * 255 | 0}`;   // fresh "visitor" per test
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getPass(fromIp) {
  const r = await post('/pass', { token: 'XXXX.DUMMY.TOKEN.XXXX' }, { 'CF-Connecting-IP': fromIp });
  assert.equal(r.status, 200);
  return (await r.json()).pass;
}
function socket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url), inbox = [];
    ws.onmessage = e => inbox.push(JSON.parse(e.data));
    ws.onopen = () => resolve({
      ws, inbox, send: m => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
      async next(pred, ms = 4000) {
        for (const end = Date.now() + ms; Date.now() < end; await sleep(40)) {
          const i = inbox.findIndex(pred); if (i >= 0) return inbox.splice(i, 1)[0];
        }
        throw new Error('timed out waiting for message; got ' + JSON.stringify(inbox));
      }
    });
    ws.onerror = reject;
  });
}
async function newRequest(fromIp, extra = {}) {
  const pass = await getPass(fromIp);
  const r = await post('/handoff', { name: 'Test Visitor', reason: 'Automated test', notes: true, ...extra }, { 'CF-Connecting-IP': fromIp, 'X-Danisa-Pass': pass });
  assert.equal(r.status, 200, await r.clone().text());
  const d = await r.json();
  assert.ok(d.founderLink, 'run wrangler dev with HANDOFF_DEBUG=1');
  const h = new URLSearchParams(d.founderLink.split('#')[1]);
  return { ...d, r: h.get('r'), fk: h.get('k') };
}

test('health route reports models', async () => {
  const d = await (await fetch(BASE + '/health')).json();
  assert.ok(d.models && d.models.live && d.models.text);
});

test('a pass is bound to the IP that earned it', async () => {
  const a = ip(), pass = await getPass(a);
  assert.match(pass, /^\d+\.[\w-]+$/);
  // the same pass from another IP counts as no pass → tight limit (2/h for founder requests)
  const b = ip();
  for (let i = 0; i < 2; i++) assert.equal((await post('/handoff', { name: 'x', reason: 'y' }, { 'CF-Connecting-IP': b, 'X-Danisa-Pass': pass })).status, 200);
  assert.equal((await post('/handoff', { name: 'x', reason: 'y' }, { 'CF-Connecting-IP': b, 'X-Danisa-Pass': pass })).status, 429);
});

test('visitor key cannot use founder-only routes', async () => {
  const q = await newRequest(ip());
  for (const path of ['/handoff/live?purpose=secretary', '/handoff/notes', '/handoff/report']) {
    const r = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}r=${q.id}&k=${q.visitorKey}`, { method: path.endsWith('secretary') ? 'GET' : 'POST', body: path.endsWith('secretary') ? undefined : '{}' });
    assert.equal(r.status, 404, path);
  }
  const info = await (await fetch(`${BASE}/handoff/info?r=${q.id}&k=${q.visitorKey}`)).json();
  assert.deepEqual(Object.keys(info).sort(), ['iceServers', 'role', 'status']);   // no name/contact/reason leak
});

test('full call: signalling relay, notes kept on the server, report written once', async () => {
  const q = await newRequest(ip());
  const f = await socket(`${WS}/handoff/ws?r=${q.r}&k=${q.fk}`);
  const v = await socket(`${WS}/handoff/ws?r=${q.id}&k=${q.visitorKey}`);
  await v.next(m => m.t === 'status' && m.status === 'ringing');

  f.send({ t: 'offer', sdp: 'too-early' });                    // nothing relayed before he accepts
  f.send({ t: 'accept' });
  await v.next(m => m.status === 'accepted');
  v.send({ t: 'offer', sdp: 'v=0 fake', extra: 'dropped' });
  const offer = await f.next(m => m.t === 'offer');
  assert.equal(offer.sdp, 'v=0 fake'); assert.equal(offer.extra, undefined);
  v.send({ t: 'ice', c: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0' } });
  const ice = await f.next(m => m.t === 'ice');
  assert.equal(ice.c.sdpMid, '0');                               // the candidate itself must survive the relay
  v.send('x'.repeat(20000));                                    // oversize: ignored, socket stays up
  v.send({ t: 'connected' });
  await f.next(m => m.status === 'in-call');
  assert.ok(!v.inbox.some(m => m.t === 'offer' && m.sdp === 'too-early'));

  const notes = await post(`/handoff/notes?r=${q.r}&k=${q.fk}`, { lines: [{ who: 'visitor', text: 'We have 12 therapists in Lahore', at: 1000 }, { who: 'founder', text: 'Great, demo on Tuesday', at: 3000 }] });
  assert.deepEqual(await notes.json(), { kept: 2 });

  f.send({ t: 'hangup' });
  await v.next(m => m.status === 'ended');
  const [a, b] = await Promise.all([post(`/handoff/report?r=${q.r}&k=${q.fk}`, {}), post(`/handoff/report?r=${q.r}&k=${q.fk}`, {})]);
  const ra = await a.json(), rb = await b.json();
  assert.match(ra.report, /Call report — Test Visitor/);
  assert.equal(ra.report, rb.report);                            // one report, however many ask
  f.ws.close(); v.ws.close();
});

test('founder tab dies mid-call → the server still writes the report', { timeout: 60000 }, async () => {
  const q = await newRequest(ip());
  const f = await socket(`${WS}/handoff/ws?r=${q.r}&k=${q.fk}`);
  const v = await socket(`${WS}/handoff/ws?r=${q.id}&k=${q.visitorKey}`);
  f.send({ t: 'accept' }); await v.next(m => m.status === 'accepted');
  v.send({ t: 'connected' }); await v.next(m => m.status === 'in-call');
  await post(`/handoff/notes?r=${q.r}&k=${q.fk}`, { lines: [{ who: 'visitor', text: 'Budget is two lakh', at: 500 }] });
  f.ws.close();                                                  // battery died
  await v.next(m => m.status === 'ended');
  let info;
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    info = await (await fetch(`${BASE}/handoff/info?r=${q.r}&k=${q.fk}`)).json();
    if (info.report) break;
  }
  assert.match(info.report || '', /Call report/);
  v.ws.close();
});

test('no notes when the visitor said no', async () => {
  const q = await newRequest(ip(), { notes: false });
  const info = await (await fetch(`${BASE}/handoff/info?r=${q.r}&k=${q.fk}`)).json();
  assert.equal(info.notes, false);
  assert.equal((await post(`/handoff/notes?r=${q.r}&k=${q.fk}`, { lines: [{ who: 'visitor', text: 'hi', at: 0 }] })).status, 403);
  assert.equal((await fetch(`${BASE}/handoff/live?purpose=notes&r=${q.r}&k=${q.fk}`)).status, 403);
});

test('founder stats need the PIN or a registered phone', async () => {
  assert.equal((await post('/push/stats', { pin: 'nope' })).status, 403);
  const r = await post('/push/stats', { pin: process.env.PIN || '1234' });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).stats);
});

test('bad links are rejected', async () => {
  assert.equal((await fetch(`${BASE}/handoff/info?r=zz&k=zz`)).status, 400);
  assert.equal((await fetch(`${BASE}/handoff/info?r=${'a'.repeat(24)}&k=${'b'.repeat(32)}`)).status, 404);
});

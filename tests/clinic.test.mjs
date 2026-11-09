/* API tests for Danisa for clinics — same set-up as worker.test.mjs (wrangler dev with ai-worker/.dev.vars).
   No Gemini key needed: these drive the receptionist's tools directly, the way a voice call does. */
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const PIN = process.env.PIN || '1234';
const ip = `10.${Math.random() * 255 | 0}.${Math.random() * 255 | 0}.${Math.random() * 255 | 0}`;
let pass = '';
async function post(path, body, headers = {}) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(pass ? { 'X-Danisa-Pass': pass } : {}), ...headers }, body: JSON.stringify(body) });
  return { status: r.status, d: await r.json().catch(() => ({})) };
}
const slug = 'ci-' + Date.now().toString(36);
let staffPin, token, coach;
const staff = (action, b = {}) => post('/clinic/staff', { c: slug, action, ...b }, { 'X-Clinic-Token': token });
const tool = (name, args) => post('/clinic/tool', { c: slug, name, args });

test('set up: founder creates a clinic, staff log in', async () => {
  pass = (await post('/pass', { token: 'XXXX.DUMMY.TOKEN.XXXX' })).d.pass;
  assert.equal((await post('/clinic/create', { pin: 'wrong', c: slug, name: 'CI Clinic' })).status, 403);
  const c = await post('/clinic/create', { pin: PIN, c: slug, name: 'CI Clinic' });
  assert.equal(c.status, 200, JSON.stringify(c.d));
  assert.match(c.d.pin, /^\d{6}$/);
  staffPin = c.d.pin;
  assert.equal((await post('/clinic/create', { pin: PIN, c: slug, name: 'again' })).status, 409);
  assert.equal((await post('/clinic/login', { c: slug, pin: '000000' })).status, 403);
  const l = await post('/clinic/login', { c: slug, pin: staffPin });
  assert.equal(l.status, 200); token = l.d.token;
  const cfg = await staff('config', { cfg: { therapists: [{ name: 'Dr. A' }, { name: 'Dr. B' }], hours: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(d => [d, [8, 20]])), break: null } });
  assert.equal(cfg.status, 200);
});

test('public info shows the clinic but nothing private', async () => {
  const d = await (await fetch(`${BASE}/clinic/info?c=${slug}`)).json();
  assert.equal(d.name, 'CI Clinic');
  for (const k of ['pinHash', 'telegramChat', 'slug', 'faq']) assert.equal(d[k], undefined, k);
  assert.equal((await fetch(`${BASE}/clinic/info?c=nope-not-here`)).status, 404);
});

test('booking: free slot → booked once; double booking and red flags are refused; cancel needs the number', async () => {
  const s = await tool('find_slots', {});
  assert.ok(s.d.slots.length >= 2, JSON.stringify(s.d));
  const [a, b] = s.d.slots;
  const ok = await tool('book_appointment', { slot_id: a.slot_id, name: 'Sara Test', phone: '0300 1112222', complaint: 'knee pain after running', pain_score: 4, red_flags_checked: true });
  assert.equal(ok.d.booked, true, JSON.stringify(ok.d)); assert.match(ok.d.code, /^[A-Z2-9]{6}$/);
  assert.equal((await tool('book_appointment', { slot_id: a.slot_id, name: 'Other', phone: '03009998888', complaint: 'neck' })).d.booked, false);
  const em = await tool('book_appointment', { slot_id: b.slot_id, name: 'Y', phone: '03009998887', complaint: 'back pain and I lost bladder control since yesterday' });
  assert.equal(em.d.booked, false); assert.equal(em.d.emergency, true);
  assert.equal((await tool('book_appointment', { slot_id: 'tzzz@123', name: 'Z', phone: '03001231234', complaint: 'x' })).d.booked, false);
  assert.equal((await tool('cancel_appointment', { code: ok.d.code, phone: '03000000000' })).d.cancelled, false);
  assert.equal((await tool('cancel_appointment', { code: ok.d.code, phone: '0300-111-2222' })).d.cancelled, true);
  assert.equal((await tool('nope', {})).status, 400);
});

test('staff area needs a token, and sees bookings, flags and call-backs', async () => {
  assert.equal((await post('/clinic/staff', { c: slug, action: 'get' })).status, 401);
  assert.equal((await post('/clinic/staff', { c: slug, action: 'get' }, { 'X-Clinic-Token': '9999999999999.forged' })).status, 401);
  await tool('request_callback', { name: 'Ali', phone: '03004445555', reason: 'price question' });
  const g = await staff('get');
  assert.equal(g.status, 200);
  assert.ok(g.d.bookings.some(b => b.status === 'cancelled'));
  assert.ok(g.d.flags.length >= 1); assert.equal(g.d.callbacks[0].name, 'Ali');
  const today = Object.values(g.d.stats).pop();
  assert.ok(today.booking >= 1 && today.emergency >= 1 && today.cancel >= 1 && today.callback >= 1, JSON.stringify(today));
});

test('coach: game readings → next goal from the therapist\'s plan; high pain alerts the clinic', async () => {
  const g = await staff('get');
  const p = await staff('patient-save', { patient: { name: 'Nasreen', condition: 'stroke', therapistId: g.d.cfg.therapists[0].id, reminderHour: 18,
    plan: [{ exercise: 'shoulder_abduction', reps: 10, sets: 2, perDay: 2, targetDeg: 120, stepDeg: 3 }] } });
  assert.equal(p.status, 200); coach = p.d.gameKey;
  const q = `?c=${coach.c}&p=${coach.p}&k=${coach.k}`;
  const day = 86400e3;
  const r = await post('/coach/data' + q, { readings: [{ exercise: 'shoulder_abduction', value: 84, at: Date.now() - 3 * day }, { exercise: 'shoulder_abduction', value: 92, at: Date.now() - day }, { exercise: 'BAD NAME', value: 5 }, { exercise: 'shoulder_abduction', value: 9999 }] });
  assert.equal(r.d.kept, 2);
  const info = await (await fetch(BASE + '/coach/info' + q)).json();
  assert.equal(info.plan[0].goal, 95);                         // best 92 + 3° step, capped at the 120° target
  assert.deepEqual(info.plan[0].readings.map(x => x.value), [84, 92]);
  const log = await post('/coach/log' + q, { done: true, pain_before: 3, pain_after: 8 });
  assert.equal(log.d.saved, true); assert.equal(log.d.week, 1);
  const pv = await staff('patient', { id: coach.p });
  assert.match(pv.d.patient.sessions.pop().concern, /pain 8\/10/);
  assert.equal((await fetch(`${BASE}/coach/info?c=${coach.c}&p=${coach.p}&k=${'0'.repeat(32)}`)).status, 404);
});

test('SOAP scribe refuses without the patient\'s consent', async () => {
  assert.equal((await post('/clinic/scribe', { c: slug, transcript: 'Therapist: hello' }, { 'X-Clinic-Token': token })).status, 400);
  assert.equal((await post('/clinic/scribe', { c: slug, consent: true, transcript: 'x' })).status, 401);
});

test('changing the staff PIN logs everyone out', async () => {
  assert.equal((await staff('pin', { newPin: '12' })).status, 400);
  assert.equal((await staff('pin', { newPin: '24681357' })).status, 200);
  assert.equal((await staff('get')).status, 401);
  assert.equal((await post('/clinic/login', { c: slug, pin: '24681357' })).status, 200);
});

test('report rating links must be signed', async () => {
  assert.equal((await fetch(`${BASE}/rate?r=${'a'.repeat(24)}&v=up&s=forged`)).status, 400);
});

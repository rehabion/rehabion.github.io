/* Full rehearsal with real voices (needs Chrome, a Gemini key on the local worker, and two WAV files):
     npm i puppeteer-core
     node tests/e2e/secretary.mjs <visitor.wav> <founder.wav>
   Two browsers with recorded audio as their microphones: a visitor asks for the founder,
   the founder answers Danisa, says he's free, they talk, he hangs up → report + debrief.
   Env: API (default http://127.0.0.1:8788), SITE (default http://127.0.0.1:8081), CHROME. */
import puppeteer from 'puppeteer-core';

const [visitorWav, founderWav] = process.argv.slice(2);
if (!visitorWav || !founderWav) { console.error('usage: node tests/e2e/secretary.mjs visitor.wav founder.wav'); process.exit(2); }
const API = process.env.API || 'http://127.0.0.1:8788', SITE = process.env.SITE || 'http://127.0.0.1:8081';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const launch = wav => puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
async function page(b, w, h) {
  const p = await b.newPage(); await p.setViewport({ width: w, height: h }); await p.setBypassCSP(true);
  await p.evaluateOnNewDocument(api => { window.REHABION_AI_ENDPOINT = api; window.REHABION_TURNSTILE_SITEKEY = '1x00000000000000000000AA'; }, API);
  p.on('pageerror', e => errs.push(e.message)); return p;
}
let failed = false;
const check = (ok, what) => { console.log((ok ? '✓ ' : '✗ ') + what); if (!ok) failed = true; };

const bv = await launch(visitorWav), bf = await launch(founderWav);
try {
  const v = await page(bv, 1280, 820);
  let link = null, passed = false;
  v.on('request', r => { if (r.url().endsWith('/handoff') && r.headers()['x-danisa-pass']) passed = true; });
  v.on('response', async r => { if (r.url().endsWith('/handoff') && r.request().method() === 'POST') { try { link = (await r.json()).founderLink; } catch (e) {} } });
  await v.goto(SITE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
  await v.evaluate(() => localStorage.setItem('danisa-memory', JSON.stringify({ name: 'Ayesha', turns: [
    { role: 'user', content: 'Do you have a stroke rehab game for clinics?' }, { role: 'assistant', content: 'Yes — RBN-001, our upper-limb stroke game, is live.' }] })));
  await v.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500);
  await v.click('a.way[data-noor="founder"]'); await sleep(400);
  await v.type('.noor-ho [name=r]', 'Demo of the stroke game for my clinic');
  await v.type('.noor-ho [name=c]', '0300-1234567');
  await v.click('.noor-ho [name=ok]');
  await v.click('.noor-ho button[type=submit]');
  for (let i = 0; i < 40 && !link; i++) await sleep(250);
  check(!!link, 'visitor rang the founder');
  check(passed, 'request carried a Turnstile pass');

  const f = await page(bf, 420, 860);
  await f.goto(link, { waitUntil: 'domcontentloaded' }); await sleep(1500); await sleep(600);
  await f.click('#answer');
  let st = '';
  for (let i = 0; i < 80; i++) { await sleep(500); st = await f.$eval('body', e => e.dataset.s); if (st === 'in-call' || st === 'busy') break; }
  check(st === 'in-call', 'founder told Danisa he is free → in call (got ' + st + ')');
  if (st === 'in-call') {
    await sleep(30000);
    await f.click('#end');
    for (let i = 0; i < 60; i++) { await sleep(1000); st = await f.$eval('body', e => e.dataset.s); if (['debrief', 'done', 'saved'].includes(st)) break; }
    const report = await f.$eval('#report', e => e.textContent);
    console.log('---- REPORT ----\n' + report + '\n----------------');
    check(/Call report/.test(report) && !/couldn't hear/.test(report), 'report written from the notes');
    check(st === 'debrief', 'Danisa offers a spoken debrief');
    await sleep(6000);
    if (await f.$('#skip:not(.hidden)')) await f.click('#skip');
  }
  check(!errs.length, 'no page errors ' + (errs.length ? JSON.stringify(errs.slice(0, 4)) : ''));
} finally { await bv.close(); await bf.close(); }
process.exit(failed ? 1 : 0);

/* Danisa benchmark — Urdu / English / Punjabi medical conversations.
     GEMINI_API_KEY=… node bench/run.mjs [triage] [reports] [asr]      (default: all three)
   Writes bench/results/<date>.json and .md. Uses the same rules and prompts as the live worker,
   so a change to ai-worker/triage.js or report.js can be measured before it ships. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { screen, TRIAGE_PROMPT } from '../ai-worker/triage.js';
import { reportSystem, reportInput } from '../ai-worker/report.js';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }
const TEXT = process.env.TEXT_MODEL || 'gemini-3-flash-preview';
const TTS = process.env.TTS_MODEL || 'gemini-3.8-flash-tts';
const LIVE_ASR = process.env.TRANSCRIBE_MODEL || 'gemini-3.5-transcribe-live';
const API = 'https://generativelanguage.googleapis.com';
const DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const load = f => readFileSync(DIR + 'data/' + f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const tasks = process.argv.slice(2).length ? process.argv.slice(2) : ['triage', 'reports', 'asr'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* free-tier keys get ~20 requests/day per model — move to the next model instead of waiting a day */
const FALLBACK = (process.env.FALLBACK_MODELS || 'gemini-3.5-flash,gemini-3.1-flash-lite').split(',');
const spent = new Set(), used = {};
async function gen(body, model = TEXT, tries = 4) {
  const chain = model === TEXT ? [TEXT, ...FALLBACK] : [model];
  for (const m of chain) {
    if (spent.has(m)) continue;
    for (let i = 0; i < tries; i++) {
      const r = await fetch(`${API}/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) }).catch(() => null);
      if (r && r.ok) { used[m] = (used[m] || 0) + 1; return r.json(); }
      const t = r ? await r.text() : 'timeout';
      if (r && r.status === 429 && /PerDay/.test(t)) { spent.add(m); console.log(`
[${m}: daily quota used up — falling back]`); break; }
      if (!r || r.status >= 500) { if (i >= 1) { spent.add(m); console.log(`
[${m}: unavailable — falling back]`); break; } await sleep(3000); continue; }
      if (r.status === 429) { await sleep(4000 * (i + 1)); continue; }
      throw new Error(m + ' HTTP ' + r.status + ' ' + t.slice(0, 200));
    }
  }
  throw new Error('no model available');
}
const textOf = d => (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
const asJson = s => JSON.parse(s.replace(/^```(json)?|```$/g, '').trim());
const pct = (a, b) => b ? Math.round(1000 * a / b) / 10 : null;

/* ── 1. emergency detection ── */
async function triage(file = 'triage.jsonl') {
  const cases = load(file), rows = [];
  for (const c of cases) {
    const rule = screen(c.text).level;
    let model = 'error';
    try { model = asJson(textOf(await gen({ systemInstruction: { parts: [{ text: TRIAGE_PROMPT }] }, contents: [{ role: 'user', parts: [{ text: c.text }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }))).level; } catch (e) {}
    /* what Danisa actually does: the rules are a floor under the model */
    const order = ['routine', 'urgent', 'emergency'];
    const combined = order[Math.max(order.indexOf(rule), order.indexOf(model))] || rule;
    rows.push({ id: c.id, lang: c.lang, truth: c.level, rule, model, combined });
    process.stdout.write('.');
  }
  const score = key => {
    const em = rows.filter(r => r.truth === 'emergency'), notEm = rows.filter(r => r.truth !== 'emergency');
    const risky = rows.filter(r => r.truth !== 'routine'), routine = rows.filter(r => r.truth === 'routine');
    return {
      accuracy: pct(rows.filter(r => r[key] === r.truth).length, rows.length),
      emergency_sensitivity: pct(em.filter(r => r[key] === 'emergency').length, em.length),
      emergency_specificity: pct(notEm.filter(r => r[key] !== 'emergency').length, notEm.length),
      any_flag_sensitivity: pct(risky.filter(r => r[key] !== 'routine').length, risky.length),
      routine_false_alarm: pct(routine.filter(r => r[key] !== 'routine').length, routine.length),
      missed_emergencies: em.filter(r => r[key] !== 'emergency').map(r => r.id)
    };
  };
  const byLang = {};
  for (const l of [...new Set(rows.map(r => r.lang))]) {
    const sub = rows.filter(r => r.lang === l), em = sub.filter(r => r.truth === 'emergency');
    byLang[l] = { n: sub.length, combined_accuracy: pct(sub.filter(r => r.combined === r.truth).length, sub.length), combined_emergency_sensitivity: pct(em.filter(r => r.combined === 'emergency').length, em.length) };
  }
  return { n: rows.length, rules: score('rule'), model: score('model'), combined: score('combined'), byLang, rows };
}

/* ── 2. report faithfulness ── */
const JUDGE = `You check a call report against the facts of the call. For each FACT say if the report states it (yes/no). For each TRAP say if the report claims it (yes/no) — traps were never said, so claiming one is a hallucination. Also list any other claims in the report that the transcript does not support.
Reply only JSON: {"facts":[true/false,…],"traps":[true/false,…],"unsupported":["…"]}`;
async function reports() {
  const out = [];
  for (const c of load('reports.jsonl')) {
    const input = reportInput('Muhammad Ramzan', c.req, c.lines, 2);
    const report = textOf(await gen({ systemInstruction: { parts: [{ text: reportSystem('Muhammad Ramzan') }] }, contents: [{ role: 'user', parts: [{ text: input }] }], generationConfig: { temperature: 0.3 } }));
    let j = { facts: [], traps: [], unsupported: [] };
    try {
      j = asJson(textOf(await gen({ systemInstruction: { parts: [{ text: JUDGE }] }, generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        contents: [{ role: 'user', parts: [{ text: `TRANSCRIPT:\n${input}\n\nREPORT:\n${report}\n\nFACTS:\n${c.facts.map((f, i) => i + 1 + '. ' + f).join('\n')}\n\nTRAPS:\n${c.traps.map((f, i) => i + 1 + '. ' + f).join('\n')}` }] }] })));
    } catch (e) {}
    out.push({ id: c.id, lang: c.lang, fact_recall: pct(j.facts.filter(Boolean).length, c.facts.length), traps_claimed: j.traps.filter(Boolean).length, unsupported: j.unsupported || [], report });
    process.stdout.write('.');
  }
  const mean = k => Math.round(10 * out.reduce((a, r) => a + (r[k] || 0), 0) / out.length) / 10;
  return { n: out.length, mean_fact_recall: mean('fact_recall'), total_traps_claimed: out.reduce((a, r) => a + r.traps_claimed, 0), total_unsupported_claims: out.reduce((a, r) => a + r.unsupported.length, 0), rows: out };
}

/* ── 3. transcription (synthetic TTS audio until real recordings are collected) ── */
const norm = s => s.toLowerCase().normalize('NFC').replace(/[ً-ٰٟ]/g, '').replace(/[ي]/g, 'ی').replace(/[ك]/g, 'ک').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
function edit(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
  return d[b.length];
}
/* which writing system a transcript came out in — Urdu speech written in Hindi (Devanagari) is a failure even if every word is right */
const SCRIPTS = { arabic: /[؀-ۿ]/g, devanagari: /[ऀ-ॿ]/g, gurmukhi: /[਀-੿]/g, latin: /[A-Za-z]/g };
const scriptOf = s => Object.entries(SCRIPTS).map(([k, re]) => [k, (s.match(re) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
const cer = (ref, hyp) => { const r = [...norm(ref).replace(/ /g, '')], h = [...norm(hyp).replace(/ /g, '')]; return r.length ? Math.round(1000 * edit(r, h) / r.length) / 10 : null; };
const wer = (ref, hyp) => { const r = norm(ref).split(' '), h = norm(hyp).split(' ').filter(Boolean); return Math.round(1000 * edit(r, h) / r.length) / 10; };

function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
async function audioFor(c) {
  mkdirSync(DIR + 'audio', { recursive: true });
  const f = DIR + 'audio/' + c.id + '.wav';
  if (existsSync(f)) return readFileSync(f);
  const d = await gen({ contents: [{ parts: [{ text: c.text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: c.voice || 'Kore' } } } } }, TTS);
  const p = d.candidates[0].content.parts.find(x => x.inlineData).inlineData;
  let raw = Buffer.from(p.data, 'base64');
  if (raw.subarray(0, 4).toString() === 'RIFF') raw = raw.subarray(44);
  const rate = Number((p.mimeType.match(/rate=(\d+)/) || [])[1]) || 24000;
  writeFileSync(f, wav(raw, rate));
  return readFileSync(f);
}
function to16k(file) {
  const rate = file.readUInt32LE(24), s = file.subarray(44), n = s.length >> 1, m = Math.floor(n * 16000 / rate), out = Buffer.alloc(m * 2);
  for (let i = 0; i < m; i++) { const x = i * rate / 16000, j = Math.floor(x), f = x - j; const a = s.readInt16LE(2 * Math.min(j, n - 1)), b = s.readInt16LE(2 * Math.min(j + 1, n - 1)); out.writeInt16LE(Math.round(a + (b - a) * f), 2 * i); }
  return out;
}
/* the path the call notes use: Gemini Live transcription, streamed like a microphone */
function liveTranscribe(pcm16) {
  return new Promise(resolve => {
    const ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${KEY}`);
    let text = '', idle = null;
    const done = () => { clearTimeout(idle); try { ws.close(); } catch (e) {} resolve(text.trim()); };
    const bump = () => { clearTimeout(idle); idle = setTimeout(done, 5000); };
    ws.onopen = () => ws.send(JSON.stringify({ setup: { model: 'models/' + LIVE_ASR, inputAudioTranscription: {} } }));
    ws.onmessage = async e => {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : await e.data.text());
      if (m.setupComplete) {
        const pad = Buffer.concat([pcm16, Buffer.alloc(32000 * 2)]);    // 2 s of silence so the last words are flushed
        for (let i = 0; i < pad.length; i += 3200) { ws.send(JSON.stringify({ realtimeInput: { audio: { data: pad.subarray(i, i + 3200).toString('base64'), mimeType: 'audio/pcm;rate=16000' } } })); await sleep(25); }
        ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); bump();
      }
      const t = m.serverContent?.inputTranscription?.text;
      if (t) { text += t; bump(); }
    };
    ws.onerror = () => done(); ws.onclose = () => done();
    setTimeout(done, 60000);
  });
}
async function asr() {
  const out = [];
  for (const c of load('asr.jsonl')) {
    const file = await audioFor(c);
    const batch = textOf(await gen({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: file.toString('base64') } },
      { text: 'Transcribe this audio exactly, in the script the speaker would write it (Urdu and Punjabi in Urdu/Shahmukhi script, Roman/English words as spoken). Output only the transcript.' }] }], generationConfig: { temperature: 0 } }));
    const live = await liveTranscribe(to16k(file));
    const want = scriptOf(c.text);
    out.push({ id: c.id, lang: c.lang, ref: c.text, script: want, batch, live, batch_script: scriptOf(batch), live_script: scriptOf(live),
      batch_cer: cer(c.text, batch), live_cer: cer(c.text, live), batch_wer: wer(c.text, batch), live_wer: wer(c.text, live) });
    process.stdout.write('.');
  }
  const mean = k => { const v = out.map(r => r[k]).filter(x => x !== null); return Math.round(10 * v.reduce((a, b) => a + b, 0) / v.length) / 10; };
  /* error rates only where the script is right, so "wrong script" and "wrong words" are reported separately */
  const meanOk = (k, s) => { const v = out.filter(r => r[s] === r.script).map(r => r[k]); return v.length ? Math.round(10 * v.reduce((a, b) => a + b, 0) / v.length) / 10 : null; };
  const nastaliq = out.filter(r => r.script === 'arabic');
  return { n: out.length, audio: 'synthetic (Gemini TTS) — replace with consented real recordings', batch_model: Object.keys(used).filter(m => !/tts/.test(m)).join(' / ') || TEXT, live_model: LIVE_ASR,
    wrong_script: { urdu_punjabi_clips: nastaliq.length, batch: nastaliq.filter(r => r.batch_script !== 'arabic').length, live: nastaliq.filter(r => r.live_script !== 'arabic').length },
    mean: { batch_cer: mean('batch_cer'), live_cer: mean('live_cer'), batch_wer: mean('batch_wer'), live_wer: mean('live_wer'),
      batch_cer_right_script: meanOk('batch_cer', 'batch_script'), live_cer_right_script: meanOk('live_cer', 'live_script') }, rows: out };
}

const results = { date: new Date().toISOString(), models: { text: TEXT, tts: TTS, live_asr: LIVE_ASR } };
for (const t of tasks) {
  console.log('\n' + t);
  if (t === 'triage') { results.triage = await triage('triage.jsonl'); results.triage_holdout = await triage('triage-holdout.jsonl'); }
  else results[t] = await { reports, asr }[t]();
}
const day = results.date.slice(0, 10);
results.calls_per_model = used;
/* tasks run separately on the same day end up in one report */
if (existsSync(`${DIR}results/${day}.json`)) {
  const old = JSON.parse(readFileSync(`${DIR}results/${day}.json`, 'utf8'));
  for (const k of ['triage', 'triage_holdout', 'reports', 'asr']) if (!results[k] && old[k]) results[k] = old[k];
  for (const [m, n] of Object.entries(old.calls_per_model || {})) used[m] = (used[m] || 0) + n;
}
writeFileSync(`${DIR}results/${day}.json`, JSON.stringify(results, null, 2));

const md = [`# Danisa benchmark — ${day}`, '', `Models: text \`${TEXT}\` (calls actually answered: ${Object.entries(used).map(([m, n]) => m + ' ' + n).join(', ')}), live transcription \`${LIVE_ASR}\`, TTS \`${TTS}\`.`, ''];
for (const [key, title] of [['triage', 'development set — the rules were tuned on these'], ['triage_holdout', 'held-out set — never used for tuning']]) if (results[key]) {
  const T = results[key], r = k => [T[k].accuracy, T[k].emergency_sensitivity, T[k].emergency_specificity, T[k].any_flag_sensitivity, T[k].routine_false_alarm, T[k].missed_emergencies.join(' ') || '—'];
  md.push(`## Emergency detection, ${title} (${T.n} messages)`, '', '| | Accuracy % | Emergency sensitivity % | Emergency specificity % | Any-flag sensitivity % | Routine false alarms % | Missed emergencies |', '|---|---|---|---|---|---|---|',
    `| Rules only | ${r('rules').join(' | ')} |`, `| Model only | ${r('model').join(' | ')} |`, `| **Rules + model (live system)** | ${r('combined').join(' | ')} |`, '',
    '| Language | n | Accuracy % | Emergency sensitivity % |', '|---|---|---|---|', ...Object.entries(T.byLang).map(([l, v]) => `| ${l} | ${v.n} | ${v.combined_accuracy} | ${v.combined_emergency_sensitivity ?? '—'} |`), '');
}
if (results.reports) {
  const R = results.reports;
  md.push(`## Call-report faithfulness (${R.n} calls)`, '', `Mean fact recall **${R.mean_fact_recall}%** · trap facts claimed **${R.total_traps_claimed}** · other unsupported claims **${R.total_unsupported_claims}** (LLM judge).`, '',
    '| Call | Language | Fact recall % | Traps claimed | Unsupported |', '|---|---|---|---|---|', ...R.rows.map(x => `| ${x.id} | ${x.lang} | ${x.fact_recall} | ${x.traps_claimed} | ${x.unsupported.length} |`), '');
}
if (results.asr) {
  const A = results.asr;
  md.push(`## Transcription (${A.n} clips, ${A.audio})`, '',
    `**Wrong script:** of ${A.wrong_script.urdu_punjabi_clips} clips spoken in Urdu or Punjabi, the batch model wrote ${A.wrong_script.batch} and the live model wrote ${A.wrong_script.live} in Devanagari (Hindi) or Gurmukhi script instead of Urdu/Shahmukhi.`, '',
    '| | CER % (all) | CER % (right script only) | WER % |', '|---|---|---|---|',
    `| Batch (\`${A.batch_model}\`) | ${A.mean.batch_cer} | ${A.mean.batch_cer_right_script ?? '—'} | ${A.mean.batch_wer} |`, `| Live (\`${A.live_model}\`, used for call notes) | ${A.mean.live_cer} | ${A.mean.live_cer_right_script ?? '—'} | ${A.mean.live_wer} |`, '',
    '| Clip | Language | Batch script | Batch CER | Live script | Live CER |', '|---|---|---|---|---|---|', ...A.rows.map(x => `| ${x.id} | ${x.lang} | ${x.batch_script} | ${x.batch_cer} | ${x.live_script} | ${x.live_cer} |`), '');
}
writeFileSync(`${DIR}results/${day}.md`, md.join('\n'));
console.log('\n\n' + md.join('\n'));

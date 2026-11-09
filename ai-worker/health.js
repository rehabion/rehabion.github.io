/* ── Self-healing model choice + daily health check ──
   Google retires preview models without warning. Once a day (cron) we read Google's
   model list, pick the first working model for each job from these lists, test the
   key and the voice-token service, and tell the founder on Telegram if anything
   changed or broke. Every route asks models(env) instead of hard-coding names.
   A daily one-line usage summary goes to Telegram too (only if anything happened). */
import { telegramText } from './push.js';

const API = 'https://generativelanguage.googleapis.com';
const PREFER = {
  text: ['gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'],
  live: ['gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest'],
  transcribe: ['gemini-3.5-transcribe-live'],
  tts: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts']
};
const NEEDS = { text: 'generateContent', live: 'bidiGenerateContent', transcribe: 'bidiGenerateContent', tts: 'generateContent' };

const inbox = env => env.INBOX.get(env.INBOX.idFromName('founder'));
let cache = null, cachedAt = 0;

/* the models in use right now (env vars win, then the last health check, then defaults) */
export async function models(env) {
  if (!cache || Date.now() - cachedAt > 300e3) {
    cache = (await inbox(env).getConfig('models').catch(() => null)) || {};
    cachedAt = Date.now();
  }
  return {
    text: env.GEMINI_MODEL || cache.text || PREFER.text[0],
    live: env.LIVE_MODEL || cache.live || PREFER.live[0],
    transcribe: env.TRANSCRIBE_MODEL || cache.transcribe || PREFER.transcribe[0],
    tts: env.TTS_MODEL || cache.tts || PREFER.tts[0]
  };
}
/* the text/tts fallback chains, current choice first */
export async function chain(env, job) {
  const m = await models(env);
  return [m[job], ...PREFER[job]].filter((x, i, a) => x && a.indexOf(x) === i);
}

export async function healthCheck(env) {
  const problems = [], picked = {};
  let list = [];
  try {
    const r = await fetch(`${API}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
    if (!r.ok) throw new Error('model list HTTP ' + r.status);
    list = ((await r.json()).models || []).map(m => ({ id: m.name.replace(/^models\//, ''), can: m.supportedGenerationMethods || [] }));
  } catch (e) { problems.push('Gemini key / model list: ' + e.message); }

  if (list.length) {
    for (const job of Object.keys(PREFER)) {
      const ok = id => list.some(m => m.id === id && m.can.includes(NEEDS[job]));
      const want = [env[{ text: 'GEMINI_MODEL', live: 'LIVE_MODEL', transcribe: 'TRANSCRIBE_MODEL', tts: 'TTS_MODEL' }[job]], ...PREFER[job]].filter(Boolean);
      let id = want.find(ok);
      /* nothing on our list left? take any model that can do the job */
      if (!id && job === 'live') id = (list.find(m => m.can.includes('bidiGenerateContent') && /live/.test(m.id) && !/transcribe|translate|thinking/.test(m.id)) || {}).id;
      if (!id && job === 'transcribe') id = picked.live;   // a normal live model can transcribe too
      if (!id && job === 'tts') id = (list.find(m => /tts/.test(m.id) && m.can.includes('generateContent')) || {}).id;
      if (!id) problems.push(`no working ${job} model`);
      else { picked[job] = id; if (id !== want[0]) problems.push(`${job}: ${want[0]} is gone — switched to ${id}`); }
    }
  }
  /* can we still hand out voice passes? */
  try {
    const t = await fetch(`${API}/v1alpha/auth_tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ uses: 1, expireTime: new Date(Date.now() + 120e3).toISOString(), newSessionExpireTime: new Date(Date.now() + 60e3).toISOString() }) });
    if (!t.ok) problems.push('voice tokens: HTTP ' + t.status);
  } catch (e) { problems.push('voice tokens: ' + e.message); }

  const before = (await inbox(env).getConfig('models')) || {};
  const state = { ok: !problems.length, problems, models: picked, checkedAt: Date.now() };
  if (Object.keys(picked).length) await inbox(env).setConfig('models', picked);
  await inbox(env).setConfig('health', state);
  cache = null;
  const changed = Object.keys(picked).some(k => before[k] && before[k] !== picked[k]);
  if (problems.length || changed) await telegramText(env, '⚠️ Danisa health check\n\n' + (problems.length ? problems.map(p => '• ' + p).join('\n') : '• models updated') + '\n\nNow using: ' + Object.entries(picked).map(([k, v]) => `${k} ${v}`).join(', '));
  return state;
}

/* yesterday in one message */
export async function dailySummary(env) {
  const day = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
  const s = ((await inbox(env).stats(2)) || {})[day];
  if (!s || !Object.keys(s).length) return;
  const n = k => s[k] || 0;
  const lines = [
    `💬 ${n('chat')} chat messages · 🎙 ${n('live')} voice calls`,
    n('handoff') ? `📞 ${n('handoff')} asked for you → ${n('answered')} talked, ${n('busy')} busy, ${n('missed')} missed, ${n('left') + n('cancelled')} gave up` : '📞 nobody asked for you',
    n('report') ? `📋 ${n('report')} call reports written` : '',
    n('blocked') ? `🛡 ${n('blocked')} requests blocked (limits / bots)` : '',
    n('error') ? `⚠️ ${n('error')} AI errors` : ''
  ].filter(Boolean);
  await telegramText(env, `📊 REHABION website — ${day}\n\n` + lines.join('\n'));
}

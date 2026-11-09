/* REHABION AI — Cloudflare Worker (Danisa's brain)
   Keeps the Gemini API key secret (GitHub Pages is public).

   Routes (POST, JSON unless noted):
     /        text chat           → { reply, sources }
     /live    real-time voice     → { token, model }        (one-use voice pass, locked to Danisa's setup)
     /tts     speak a message     → { audio, mime }         (Gemini TTS — real Urdu voice)
     /pass    Turnstile → pass    → { pass, expires }       (normal limits instead of tight ones)
     GET /health                  → { ok, models, checkedAt }
     /handoff*  talk to the founder (handoff.js)   /push*  founder alerts (push.js)
   Cron (daily): model health check + usage summary to Telegram (health.js).

   Secrets / vars (Cloudflare → Worker → Settings → Variables):
     GEMINI_API_KEY   (secret, required)
     GEMINI_MODEL     (optional) text model, default gemini-3-flash-preview
     LIVE_MODEL       (optional) voice model, default gemini-3.8-live
     TTS_MODEL        (optional) default gemini-3.8-flash-tts
     GEMINI_SEARCH    (optional) 'off' to skip Google Search grounding
     ALLOWED_ORIGINS  (optional) comma list, defaults to the live site
     TURNSTILE_SECRET (secret, optional) bot check — see guard.js
*/

import { handleHandoff, HandoffRoom, RateLimit } from './handoff.js';
import { handlePush, Inbox } from './push.js';
import { issuePass, limit, count } from './guard.js';
import { models, chain, healthCheck, dailySummary } from './health.js';
import { voiceToken } from './handoff.js';
export { HandoffRoom, RateLimit, Inbox };

const DEFAULT_ORIGINS = ['https://rehabion.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080', 'http://127.0.0.1:8081'];
const API = 'https://generativelanguage.googleapis.com';
const MAX_TURNS = 24;
const MAX_CHARS = 4000;

const LANGS = {
  en: 'English', ur: 'Urdu (اردو, Nastaliq script — never Hindi/Devanagari)', pa: 'Punjabi in Shahmukhi script (پنجابی)',
  ps: 'Pashto (پښتو)', sd: 'Sindhi (سنڌي)', ar: 'Arabic (العربية)', hi: 'Hindi (हिन्दी)', bn: 'Bengali (বাংলা)',
  tr: 'Turkish (Türkçe)', fa: 'Persian (فارسی)', zh: 'Chinese (中文)', ja: 'Japanese (日本語)', fr: 'French', es: 'Spanish', de: 'German'
};

const ABOUT_REHABION = `
REHABION — Pakistan's first rehabilitation technology company, based in Islamabad / Rawalpindi. Founded Q1 2025.
Team: Muhammad Ramzan (Founder · Lead Engineer, biomedical engineer & developer, building the game-based rehab platform and RehabLLM).
Dr. Faisal Amin (Technical Supervisor · Chief Science Officer; rehabilitation engineering, neurorehabilitation, signal processing, clinical research).
Solutions: Game-Based Rehab Systems (live; stroke, ortho, neuro, paediatric games mapped to clinical exercises with real-time motion tracking);
Physiotherapy assistant tools (in development; RehabLLM clinical assistant, automated SOAP notes, exercise prescription, Urdu/English patient chat);
BioSense Wearables (prototype; EMG, IMU sensors at Pakistan-accessible cost); TherapistOS Dashboard (live; ROM tracking, analytics, recovery prediction, session notes);
Hospital Integration (live; EHR/PIMS integration, DRAP compliance pathway); Research Collaboration (IRB-approved studies, co-authorship).
Projects: RBN-001 Upper-limb stroke game (Unity, motion capture; shoulder abduction & elbow extension; live). RBN-002 Phone-camera gait analyser (post-surgical knee; step symmetry, cadence, posture; live). RBN-003+ in pipeline.
Milestones: Q2 2025 research programme with Dr. Faisal Amin, first prototypes, site launch. Q3 2025 Phase-1 IRB pilot with 20 stroke patients in Islamabad. Q4 2025 RehabLLM beta. 2026 pre-seed funding round.
Market: Pakistan ~220M people, ~0.5 physiotherapists per 10,000 vs WHO-recommended 5; global rehab tech market $8.1B by 2033, 13.4% CAGR.
Resources: free Stroke Rehab Exercise Protocol (12 weeks, ask the team); Game-Based Rehab Design Guide $9; RehabLLM Prompt Library $19; Pakistan Rehab Market Report $29 (Gumroad).
Contact: email muhammadrmzn84@gmail.com · free 15-min demo: https://calendly.com/muhammadrmzn84/rehabion · site https://rehabion.github.io
Never give out any phone or WhatsApp number — you don't have one to share. To reach the founder directly, use the connect-to-founder option.
`.trim();

function clean(s, n) { return typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : ''; }

function systemPrompt({ lang, voice, name, memory }) {
  const L = LANGS[lang];
  return `You are Danisa (دانیسا), the warm, down-to-earth assistant of REHABION. You talk like a kind, knowledgeable friend from Pakistan — natural, never robotic, never salesy.
You can help with ANY topic (health, science, tech, study, business, daily life, Pakistan, the world). If you are unsure, say so honestly; never invent facts, numbers or links.
Only claim to remember things that actually appear in this conversation or in the memory notes below — never pretend to recall something you weren't told.
When people ask about REHABION, use these facts:
${ABOUT_REHABION}

Talking to the founder: if someone wants to speak with the founder (Muhammad Ramzan) or a real person, offer to connect them right now. ${voice
    ? 'Ask for their name (if you do not know it) and briefly what it is about, optionally a phone or email for a call-back. Then ask, in one short sentence, whether they are OK with you quietly taking notes of the call for him (they can say no — the call still happens). Then call the connect_to_founder tool with notes_ok set to their answer and tell them you are checking if he is free.'
    : 'Tell them to tap the "Talk to the founder" button below the chat and it will ring him straight away.'} Never share his phone number.

Health safety: you are not a doctor. Give general, evidence-based information and suggest a qualified physiotherapist or doctor for personal treatment. For emergencies (chest pain, stroke signs like face droop / arm weakness / slurred speech, severe bleeding, breathing trouble) tell them to call 1122 (Pakistan) or local emergency services immediately.

Language: ${L ? `the person prefers ${L}, but ` : ''}always answer in the language the person is speaking right now — Urdu, English, Punjabi, Pashto, Sindhi, Arabic, Hindi, Japanese, anything. When they switch, even mid-sentence, switch with them instantly and keep all context. If they mix Urdu and English, mix the same way. Never mention or comment on the language, never translate or add transliterations unless they ask. Urdu is always real Pakistani Urdu, written in Urdu script in text — never Hindi or Devanagari. You are a woman: in Urdu and Punjabi always use feminine forms for yourself (karti hoon, rahi hoon, sakti hoon — never karta hoon).${L ? '' : ' If you cannot tell yet, use the warm Urdu–English mix Pakistanis speak.'}
${name ? `The person's name is ${name}. Use it naturally now and then (not every sentence).` : ''}
${memory ? `What you remember from earlier with this person (keep continuity, don't repeat yourself):\n${memory}` : ''}
${voice
    ? `This is a live VOICE call. Speak in short, natural sentences (1–3 at a time), like a phone call. No lists, no URLs, no emojis, no markdown.
${name ? '' : 'Start by greeting them warmly with "Assalam o Alaikum", introduce yourself as Danisa, and ask their name. As soon as they tell you, call the remember_name tool, then use their name.'}`
    : 'Keep answers concise and scannable; short paragraphs or bullet points, **bold** for key points when helpful.'}`;
}

function cors(origin, env) {
  const allowed = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : DEFAULT_ORIGINS;
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Danisa-Pass',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

async function chat(body, env, headers, ctx) {
  const lang = LANGS[body.lang] ? body.lang : 'auto';
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content.slice(0, MAX_CHARS) }] }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ error: 'No question' }, 400, headers);

  const sys = systemPrompt({ lang, voice: !!body.voice, name: clean(body.name, 60), memory: clean(body.memory, 1500) });
  /* Best model first; fall back if one is retired or rate-limited. Google Search grounding
     needs billing — on 429 the same model answers from its own knowledge instead. */
  let res, detail = '';
  outer: for (const model of await chain(env, 'text')) {
    for (const search of env.GEMINI_SEARCH === 'off' ? [false] : [true, false]) {
      res = await fetch(`${API}/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: messages,
          ...(search ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: { temperature: 0.7, maxOutputTokens: body.voice ? 2048 : 4096 }
        })
      });
      if (res.ok) break outer;
      detail = await res.text();
      if (res.status !== 429 && res.status !== 404 && res.status !== 503) break outer;
    }
  }
  if (!res.ok) { count(env, ctx, 'error'); return json({ error: 'AI service error', status: res.status, detail: detail.slice(0, 300) }, 502, headers); }

  const data = await res.json();
  const cand = data.candidates && data.candidates[0];
  const reply = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('').trim() : '';
  const chunks = (cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  const sources = chunks.filter(c => c.web && c.web.uri).slice(0, 4).map(c => ({ title: c.web.title || 'Source', uri: c.web.uri }));
  return json({ reply: reply || "Sorry, I couldn't form an answer just now — please try again.", sources }, 200, headers);
}

/* Danisa's tools on a voice call */
const LIVE_TOOLS = [{ functionDeclarations: [
  { name: 'remember_name', description: "Save the user's name as soon as they say it.",
    parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: 'The name, as the user said it' } }, required: ['name'] } },
  { name: 'connect_to_founder', description: 'Ring the founder, Muhammad Ramzan, so the user can talk to him live through the website. Use when the user wants to speak to the founder or a real person.',
    parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: "The user's name" }, reason: { type: 'STRING', description: 'What they want to talk about, in a short sentence' },
      contact: { type: 'STRING', description: 'Optional phone or email for a call-back' }, notes_ok: { type: 'BOOLEAN', description: 'Whether they agreed to Danisa taking notes of the call' } }, required: ['reason', 'notes_ok'] } }
] }];

async function live(body, env, headers) {
  const lang = LANGS[body.lang] ? body.lang : 'auto';
  const m = await models(env);
  /* the instructions, voice and tools are locked into the pass by Google — the browser can't swap them */
  const token = await voiceToken(env, {
    model: 'models/' + m.live,
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
    systemInstruction: { parts: [{ text: systemPrompt({ lang, voice: true, name: clean(body.name, 60), memory: clean(body.memory, 1500) }) }] },
    inputAudioTranscription: {}, outputAudioTranscription: {},
    tools: LIVE_TOOLS
  }, 1, 30);
  if (!token) return json({ error: 'Could not start voice session' }, 502, headers);
  return json({ token, model: m.live }, 200, headers);
}

async function tts(body, env, headers) {
  const text = clean(body.text, 1500);
  if (!text) return json({ error: 'No text' }, 400, headers);
  for (const model of await chain(env, 'tts')) {
    const res = await fetch(`${API}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } }
      })
    });
    if (!res.ok) continue;
    const d = await res.json();
    const p = d.candidates && d.candidates[0] && d.candidates[0].content.parts.find(x => x.inlineData);
    if (p) return json({ audio: p.inlineData.data, mime: p.inlineData.mimeType }, 200, headers);
  }
  return json({ error: 'Speech service unavailable' }, 502, headers);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    const route = new URL(request.url).pathname.replace(/\/+$/, '');
    if (route === '/health') {
      const h = await env.INBOX.get(env.INBOX.idFromName('founder')).getConfig('health');
      return json({ ok: !!env.GEMINI_API_KEY && (!h || h.ok), models: await models(env), checkedAt: h ? h.checkedAt : null, problems: h ? h.problems : [] }, 200, headers);
    }
    if (route.startsWith('/handoff')) return handleHandoff(request, env, headers, route, ctx);
    if (route.startsWith('/push')) return handlePush(request, env, headers, route);
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, headers);
    if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY is not set on the worker' }, 500, headers);
    if (Number(request.headers.get('Content-Length')) > 200000) return json({ error: 'Too big' }, 413, headers);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, headers); }
    if (route === '/pass') { const p = await issuePass(env, request, body.token); return json(p, p.error ? 403 : 200, headers); }
    const bucket = route === '/live' ? 'live' : route === '/tts' ? 'tts' : 'chat';
    const why = await limit(env, request, bucket);
    if (why) { count(env, ctx, 'blocked'); return json({ error: 'busy', why }, 429, headers); }
    count(env, ctx, bucket);
    if (route === '/live') return live(body, env, headers);
    if (route === '/tts') return tts(body, env, headers);
    return chat(body, env, headers, ctx);
  },

  /* daily at 03:00 UTC (8 am in Pakistan) */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => { await healthCheck(env); await dailySummary(env); })());
  }
};

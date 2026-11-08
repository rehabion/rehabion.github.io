/* REHABION AI — Cloudflare Worker
   Keeps the Gemini API key secret (GitHub Pages is public) and gives Noor
   live Google Search grounding so she can answer about almost anything.

   Secrets / vars (set in Cloudflare dashboard → Worker → Settings → Variables):
     GEMINI_API_KEY   (secret, required)  — from https://aistudio.google.com/apikey
     GEMINI_MODEL     (optional)          — defaults to gemini-2.5-flash
     ALLOWED_ORIGINS  (optional)          — comma list, defaults to the live site
*/

const DEFAULT_ORIGINS = ['https://rehabion.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080'];
const MAX_TURNS = 16;
const MAX_CHARS = 4000;

const ABOUT_REHABION = `
REHABION — Pakistan's first rehabilitation technology company, based in Islamabad / Rawalpindi. Founded Q1 2025.
Team: Muhammad Ramzan (Founder · Lead Engineer, biomedical engineer & AI developer, building the game-based rehab platform and RehabLLM).
Dr. Faisal Amin (Technical Supervisor · Chief Science Officer; rehabilitation engineering, neurorehabilitation, signal processing, clinical research).
Solutions: Game-Based Rehab Systems (live; stroke, ortho, neuro, paediatric games mapped to clinical exercises with real-time biomechanical tracking);
AI Physiotherapy Tools (in development; RehabLLM clinical assistant, automated SOAP notes, AI exercise prescription, Urdu/English patient chatbots);
BioSense Wearables (prototype; EMG, IMU sensors at Pakistan-accessible cost); TherapistOS Dashboard (live; ROM tracking, analytics, recovery prediction, session management);
Hospital Integration (live; EHR/PIMS integration, DRAP compliance pathway); Research Collaboration (IRB-approved studies, co-authorship).
Projects: RBN-001 Upper Limb Stroke Game (Unity, motion capture; shoulder abduction & elbow extension; live). RBN-002 CV-Based Gait Analyser (smartphone camera, post-surgical knee; step symmetry, cadence, posture; live). RBN-003 more in pipeline.
Milestones: Q2 2025 research programme with Dr. Faisal Amin, first prototypes, site launch. Q3 2025 Phase-1 IRB pilot with 20 stroke patients in Islamabad. Q4 2025 RehabLLM beta. 2026 pre-seed funding round.
Market: Pakistan ~220M people, ~0.5 physiotherapists per 10,000 vs recommended 5; global rehab tech market $8.1B by 2033, 13.4% CAGR.
Resources: free Stroke Rehab Exercise Protocol (12 weeks); Game-Based Rehab Design Guide $9; RehabLLM Prompt Library $19; Pakistan Rehab Market Report $29 (Gumroad).
Contact: WhatsApp +92 349 8228037 · email muhammadrmzn84@gmail.com · free 15-min demo: https://calendly.com/muhammadrmzn84/rehabion · site https://rehabion.github.io
`.trim();

function systemPrompt(lang, voice) {
  return `You are Noor, the warm, down-to-earth assistant on REHABION's website. You talk like a kind, knowledgeable friend — never robotic, never salesy.
You can help with ANY topic (science, health, tech, study, business, daily life, Pakistan, the world). Use Google Search whenever facts may be recent or you are unsure, and never invent facts, numbers or links.
When people ask about REHABION, use these facts:
${ABOUT_REHABION}

Health safety: you are not a doctor. Give general, evidence-based information, suggest seeing a qualified physiotherapist or doctor for personal treatment, and for emergencies (chest pain, stroke signs like face droop / arm weakness / slurred speech, severe bleeding, breathing trouble) tell them to call 1122 (Pakistan) or local emergency services immediately.

Language: ${lang === 'ur'
    ? 'Reply in natural, everyday Urdu written in Urdu script (اردو). Keep technical terms in English where Pakistanis normally do.'
    : 'Reply in clear, friendly English. If the user writes in Urdu or Roman Urdu, reply in that same style.'}
${voice
    ? 'This is a VOICE conversation: answer in 1–3 short spoken sentences, no markdown, no lists, no URLs, no emojis. Sound natural, like talking on the phone.'
    : 'Keep answers concise and scannable; use short paragraphs or bullet points and **bold** for key points when helpful.'}`;
}

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : DEFAULT_ORIGINS);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, headers);
    if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY is not set on the worker' }, 500, headers);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, headers); }
    const lang = body.lang === 'ur' ? 'ur' : 'en';
    const voice = !!body.voice;
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter(m => m && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_TURNS)
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content.slice(0, MAX_CHARS) }] }));
    if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ error: 'No question' }, 400, headers);

    const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(lang, voice) }] },
        contents: messages,
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.7, maxOutputTokens: voice ? 300 : 1200 }
      })
    });

    if (!res.ok) {
      const detail = await res.text();
      return json({ error: 'AI service error', status: res.status, detail: detail.slice(0, 300) }, 502, headers);
    }
    const data = await res.json();
    const cand = data.candidates && data.candidates[0];
    const reply = cand && cand.content && cand.content.parts
      ? cand.content.parts.map(p => p.text || '').join('').trim()
      : '';
    const chunks = (cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
    const sources = chunks.filter(c => c.web && c.web.uri).slice(0, 4).map(c => ({ title: c.web.title || 'Source', uri: c.web.uri }));
    return json({ reply: reply || (lang === 'ur' ? 'معاف کیجیے، ابھی جواب نہیں بن سکا۔ دوبارہ کوشش کریں۔' : "Sorry, I couldn't form an answer just now — please try again."), sources }, 200, headers);
  }
};

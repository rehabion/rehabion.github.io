/* ── Danisa (دانیسا) · REHABION's bilingual (English / اردو) chat + voice assistant ──
   Brain: the Cloudflare Worker in /ai-worker (Gemini + Google Search).
   Until AI_ENDPOINT is set, Danisa answers REHABION questions from the
   built-in notes below and points visitors to a human for anything else. */
(function(){
  const AI_ENDPOINT = window.REHABION_AI_ENDPOINT || ''; // e.g. 'https://rehabion-ai.<you>.workers.dev'

  const T = {
    en:{
      name:'Danisa', role:'REHABION assistant · here to help',
      launch:'Ask Danisa', launchHint:'chat or talk',
      hello:"Hi, I'm **Danisa** 👋 Ask me anything — about REHABION, rehab and recovery, or any topic at all. You can type, or tap the phone icon to talk with me.",
      placeholder:'Type your question…', send:'Send',
      chips:['What does REHABION do?','Stroke recovery tips','Book a free demo','How can I invest?'],
      foot:'Danisa can make mistakes. Not medical advice — for emergencies call 1122.',
      listening:'Listening…', thinking:'Thinking…', speaking:'Speaking…', paused:'Paused',
      tapHint:'Speak naturally — tap the circle to interrupt me.',
      end:'End call', mute:'Pause', unmute:'Resume', listen:'Listen',
      noVoice:"Voice chat needs Chrome, Edge or Safari. You can still type to me!",
      micDenied:'I need microphone permission to hear you. Please allow it in your browser and try again.',
      offline:"I'm not connected to my full AI brain right now, so I can only answer questions about REHABION. For anything else, message the team on [WhatsApp](https://wa.me/923498228037) — a real person will reply.",
      error:"Sorry, I couldn't reach my brain just now. Please try again in a moment, or message us on [WhatsApp](https://wa.me/923498228037).",
      sources:'Sources', recog:'en-US', voiceLang:'en'
    },
    ur:{
      name:'دانیسا', role:'ریہابیون اسسٹنٹ · آپ کی خدمت میں',
      launch:'دانیسا سے پوچھیں', launchHint:'لکھیں یا بات کریں',
      hello:'السلام علیکم، میں **دانیسا** ہوں 👋 مجھ سے کچھ بھی پوچھیں — ریہابیون، فزیوتھراپی اور صحت یابی، یا کوئی بھی موضوع۔ آپ لکھ سکتے ہیں یا فون کے نشان پر کلک کر کے مجھ سے بات کر سکتے ہیں۔',
      placeholder:'اپنا سوال لکھیں…', send:'بھیجیں',
      chips:['ریہابیون کیا کرتا ہے؟','فالج کے بعد ورزشیں','مفت ڈیمو بک کریں','سرمایہ کاری کیسے کریں؟'],
      foot:'دانیسا سے غلطی ہو سکتی ہے۔ یہ طبی مشورہ نہیں — ایمرجنسی میں 1122 پر کال کریں۔',
      listening:'سن رہی ہوں…', thinking:'سوچ رہی ہوں…', speaking:'بول رہی ہوں…', paused:'رکا ہوا',
      tapHint:'آرام سے بولیں — مجھے روکنے کے لیے دائرے پر ٹیپ کریں۔',
      end:'کال ختم', mute:'روکیں', unmute:'جاری رکھیں', listen:'سنیں',
      noVoice:'وائس چیٹ کے لیے Chrome، Edge یا Safari استعمال کریں۔ آپ لکھ کر بات کر سکتے ہیں!',
      micDenied:'آپ کی آواز سننے کے لیے مائیکروفون کی اجازت چاہیے۔ براؤزر میں اجازت دے کر دوبارہ کوشش کریں۔',
      offline:'ابھی میں اپنے مکمل AI سے منسلک نہیں ہوں، اس لیے صرف ریہابیون کے بارے میں بتا سکتی ہوں۔ باقی سوالات کے لیے ٹیم کو [واٹس ایپ](https://wa.me/923498228037) کریں — ایک انسان جواب دے گا۔',
      error:'معاف کیجیے، ابھی رابطہ نہیں ہو سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں یا [واٹس ایپ](https://wa.me/923498228037) کریں۔',
      sources:'ذرائع', recog:'ur-PK', voiceLang:'ur'
    }
  };

  /* Built-in notes — used when the AI brain isn't connected (or is unreachable). */
  const NOTES = [
    {k:['rehabion','company','about','services','ریہابیون','کمپنی','کرتا','بارے','karta'],
     en:"REHABION is Pakistan's first rehabilitation technology company, based in Islamabad / Rawalpindi. We build **game-based therapy systems**, **AI physiotherapy tools** (RehabLLM), **BioSense wearables** and the **TherapistOS dashboard** — built by biomedical engineers and validated with clinicians.",
     ur:'ریہابیون پاکستان کی پہلی ری ہیبیلیٹیشن ٹیکنالوجی کمپنی ہے، جو اسلام آباد / راولپنڈی میں ہے۔ ہم **گیم پر مبنی تھراپی سسٹمز**، **AI فزیوتھراپی ٹولز** (RehabLLM)، **BioSense ویئرایبلز** اور **TherapistOS ڈیش بورڈ** بناتے ہیں۔'},
    {k:['demo','book','call','meeting','ڈیمو','بک','کال','ملاقات'],
     en:'Happy to set that up! Book a free 15-minute demo here: [calendly.com/muhammadrmzn84/rehabion](https://calendly.com/muhammadrmzn84/rehabion) — or just [WhatsApp us](https://wa.me/923498228037).',
     ur:'ضرور! یہاں مفت 15 منٹ کا ڈیمو بک کریں: [Calendly](https://calendly.com/muhammadrmzn84/rehabion) — یا ہمیں [واٹس ایپ](https://wa.me/923498228037) کریں۔'},
    {k:['invest','investor','funding','seed','raise','سرمایہ','انویسٹ','فنڈنگ'],
     en:"We're at **pre-seed** stage, raising in 2026 to fund clinical validation, BioSense hardware production and our first hospital contracts. The global rehab-tech market reaches **$8.1B by 2033** (13.4% CAGR) and Pakistan has no domestic competitor. [Schedule an investor call](https://calendly.com/muhammadrmzn84/rehabion) or email muhammadrmzn84@gmail.com for the deck.",
     ur:'ہم **پری سیڈ** مرحلے پر ہیں اور 2026 میں فنڈنگ اکٹھی کر رہے ہیں — کلینیکل ویلیڈیشن، BioSense ہارڈویئر اور پہلے ہسپتال معاہدوں کے لیے۔ [انویسٹر کال بک کریں](https://calendly.com/muhammadrmzn84/rehabion) یا ڈیک کے لیے muhammadrmzn84@gmail.com پر ای میل کریں۔'},
    {k:['stroke','exercise','arm','shoulder','فالج','ورزش','بازو','falij','warzish'],
     en:"After a stroke, gentle, **frequent, repetitive practice** helps most — e.g. shoulder raises, elbow bend-and-straighten, reaching for objects, and squeezing a soft ball, a little every day. Our **RBN-001 stroke game** turns these into play. Please follow a physiotherapist's plan for your own case. ⚠️ Sudden face droop, arm weakness or slurred speech = call **1122** immediately.\n\nWe also have a free **12-week Stroke Rehab Exercise Protocol** in the Resources section.",
     ur:'فالج کے بعد **ہلکی، بار بار اور روزانہ** ورزش سب سے زیادہ فائدہ دیتی ہے — جیسے کندھا اٹھانا، کہنی موڑنا اور سیدھی کرنا، چیزوں تک ہاتھ بڑھانا، نرم گیند دبانا۔ ہمارا **RBN-001 گیم** انہی ورزشوں کو کھیل بنا دیتا ہے۔ اپنے کیس کے لیے فزیوتھراپسٹ کی ہدایت پر عمل کریں۔ ⚠️ اچانک چہرہ ٹیڑھا ہونا، بازو کمزور ہونا یا بولنے میں دقت — فوراً **1122** پر کال کریں۔'},
    {k:['team','founder','ramzan','faisal','ٹیم','بانی','رمضان','فیصل'],
     en:'REHABION was founded by **Muhammad Ramzan** (Founder · Lead Engineer, biomedical engineer and AI developer). **Dr. Faisal Amin** is our Technical Supervisor and Chief Science Officer, leading clinical validation and research.',
     ur:'ریہابیون کے بانی **محمد رمضان** ہیں (بایومیڈیکل انجینئر اور AI ڈویلپر)۔ **ڈاکٹر فیصل امین** ہمارے ٹیکنیکل سپروائزر اور چیف سائنس آفیسر ہیں۔'},
    {k:['project','game','gait','knee','rbn','پروجیکٹ','گیم','گھٹنا'],
     en:'Our live projects: **RBN-001 Upper Limb Stroke Game** (Unity + motion capture, tracks shoulder and elbow range of motion) and **RBN-002 CV Gait Analyser** (smartphone camera gait analysis for post-surgery knee patients — step symmetry, cadence, posture). More are in the pipeline.',
     ur:'ہمارے فعال پروجیکٹس: **RBN-001** فالج کے مریضوں کے لیے بازو کی ورزش کا گیم، اور **RBN-002** موبائل کیمرے سے چال (gait) کا تجزیہ — گھٹنے کے آپریشن کے بعد کے مریضوں کے لیے۔'},
    {k:['contact','whatsapp','email','phone','number','رابطہ','واٹس','نمبر','ای میل'],
     en:'You can reach a real person on **WhatsApp: +92 349 8228037** ([open chat](https://wa.me/923498228037)) or email **muhammadrmzn84@gmail.com**. We usually reply within 48 hours.',
     ur:'ہم سے **واٹس ایپ: +92 349 8228037** ([چیٹ کھولیں](https://wa.me/923498228037)) یا ای میل **muhammadrmzn84@gmail.com** پر رابطہ کریں۔'},
    {k:['price','cost','resource','guide','protocol','report','قیمت','گائیڈ','رپورٹ'],
     en:'Our resources: free **Stroke Rehab Exercise Protocol**, **Game-Based Rehab Design Guide** ($9), **RehabLLM Prompt Library** ($19) and **Pakistan Rehab Market Report** ($29) — see the Resources section. For custom systems, [book a demo](https://calendly.com/muhammadrmzn84/rehabion) and we will quote for your clinic.',
     ur:'ہمارے وسائل: مفت **اسٹروک ایکسرسائز پروٹوکول**، **گیم ڈیزائن گائیڈ** ($9)، **RehabLLM پرامپٹ لائبریری** ($19) اور **پاکستان ریہاب مارکیٹ رپورٹ** ($29)۔'},
    {k:['hi','hello','salam','assalam','hey','سلام','ہیلو'],
     en:'Hello! 😊 How can I help you today?', ur:'وعلیکم السلام! 😊 میں آپ کی کیا مدد کر سکتی ہوں؟'}
  ];

  let lang = 'en', busy = false, history = [];
  try { lang = localStorage.getItem('noor-lang') === 'ur' ? 'ur' : 'en'; } catch(e){}
  try { history = JSON.parse(sessionStorage.getItem('noor-history') || '[]'); } catch(e){ history = []; }
  const saveHistory = () => { try { sessionStorage.setItem('noor-history', JSON.stringify(history.slice(-20))); } catch(e){} };

  /* ── tiny, safe markdown ── */
  const esc = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function md(text){
    const inline = s => esc(s)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    const out = []; let list = null;
    text.split('\n').forEach(line => {
      const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
      if (m) { if (!list) { list = []; } list.push('<li>' + inline(m[1]) + '</li>'); return; }
      if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; }
      if (line.trim()) out.push('<p>' + inline(line) + '</p>');
    });
    if (list) out.push('<ul>' + list.join('') + '</ul>');
    return out.join('');
  }
  const plain = s => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[*_#>`]/g, '').replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, '').trim();

  /* ── DOM ── */
  const icon = {
    phone:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/></svg>',
    close:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    mic:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0M12 17v5"/></svg>',
    send:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>'
  };
  const root = document.createElement('div');
  root.innerHTML = `
    <button class="noor-launch" type="button" aria-label="Open Danisa assistant"><span class="noor-face" aria-hidden="true"></span><span><span data-t="launch"></span><small data-t="launchHint"></small></span></button>
    <div class="noor-panel" role="dialog" aria-modal="false" aria-label="Danisa assistant">
      <div class="noor-head">
        <span class="noor-face" aria-hidden="true"></span>
        <div class="noor-title"><strong data-t="name"></strong><span data-t="role"></span></div>
        <div class="noor-lang" role="group" aria-label="Language"><button type="button" data-lang="en">EN</button><button type="button" class="ur" data-lang="ur">اردو</button></div>
        <button class="noor-icon-btn noor-call" type="button" aria-label="Voice call">${icon.phone}</button>
        <button class="noor-icon-btn noor-close" type="button" aria-label="Close">${icon.close}</button>
      </div>
      <div class="noor-msgs" aria-live="polite"></div>
      <div class="noor-chips"></div>
      <form class="noor-input">
        <button class="noor-icon-btn noor-mic" type="button" aria-label="Dictate">${icon.mic}</button>
        <textarea rows="1" maxlength="2000" aria-label="Message"></textarea>
        <button class="noor-send" type="submit" aria-label="Send">${icon.send}</button>
      </form>
      <div class="noor-foot" data-t="foot"></div>
    </div>
    <div class="noor-voice" role="dialog" aria-label="Voice call with Danisa" data-state="idle">
      <div class="noor-orb" role="button" tabindex="0" aria-label="Interrupt"><span></span><span></span><span></span></div>
      <div class="noor-voice-status"></div>
      <div class="noor-voice-text"></div>
      <div class="noor-voice-actions"><button type="button" class="noor-mute"></button><button type="button" class="noor-end" data-t="end"></button></div>
    </div>`;
  document.body.appendChild(root);
  const $ = s => root.querySelector(s);
  const launch=$('.noor-launch'), panel=$('.noor-panel'), msgs=$('.noor-msgs'), chips=$('.noor-chips'),
        form=$('.noor-input'), ta=$('textarea'), sendBtn=$('.noor-send'), micBtn=$('.noor-mic'),
        voice=$('.noor-voice'), vStatus=$('.noor-voice-status'), vText=$('.noor-voice-text'), muteBtn=$('.noor-mute'), orb=$('.noor-orb');

  function applyLang(){
    const t=T[lang];
    root.querySelectorAll('[data-t]').forEach(el=>{el.textContent=t[el.dataset.t];});
    root.querySelectorAll('.noor-lang button').forEach(b=>b.setAttribute('aria-pressed', b.dataset.lang===lang));
    panel.dataset.lang=lang; voice.dataset.lang=lang;
    ta.placeholder=t.placeholder;
    chips.innerHTML='';
    t.chips.forEach(c=>{const b=document.createElement('button');b.type='button';b.textContent=c;b.onclick=()=>send(c);chips.appendChild(b);});
    chips.style.display=history.length?'none':'flex';
  }

  function addMsg(role, text, sources){
    const div=document.createElement('div');
    div.className='noor-msg '+(role==='user'?'user':'bot');
    div.innerHTML=role==='user'?esc(text).replace(/\n/g,'<br>'):md(text);
    if(sources&&sources.length){
      const s=document.createElement('div');s.className='noor-src';
      sources.forEach(x=>{const a=document.createElement('a');a.href=x.uri;a.target='_blank';a.rel='noopener noreferrer';a.textContent=x.title;s.appendChild(a);});
      div.appendChild(s);
    }
    if(role!=='user'&&window.speechSynthesis){
      const b=document.createElement('button');b.type='button';b.className='noor-speak';b.textContent='🔊 '+T[lang].listen;
      b.onclick=()=>speak(text);div.appendChild(b);
    }
    msgs.appendChild(div);msgs.scrollTop=msgs.scrollHeight;
  }
  function renderAll(){
    msgs.innerHTML='';
    addMsg('assistant',T[lang].hello);
    history.forEach(m=>addMsg(m.role,m.content,m.sources));
  }

  /* ── thinking ── */
  function localAnswer(q){
    const words=q.toLowerCase().split(/[\s،,.?!؟]+/).filter(Boolean);
    let best=null,score=0;
    NOTES.forEach(n=>{
      const s=n.k.reduce((a,k)=>a+(words.some(w=>w===k||(k.length>3&&w.startsWith(k)))?1:0),0);
      if(s>score){score=s;best=n;}
    });
    return score>0?best[lang]:T[lang].offline;
  }

  async function think(q, isVoice){
    history.push({role:'user',content:q});saveHistory();
    if(!AI_ENDPOINT) return {reply:localAnswer(q)};
    try{
      const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),30000);
      const r=await fetch(AI_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},signal:ctrl.signal,
        body:JSON.stringify({lang,voice:!!isVoice,messages:history.map(m=>({role:m.role,content:m.content}))})});
      clearTimeout(timer);
      const d=await r.json();
      if(!r.ok||!d.reply)throw new Error(d.error||'bad response');
      return d;
    }catch(e){
      const local=localAnswer(q);
      return {reply:local===T[lang].offline?T[lang].error:local};
    }
  }

  async function send(text){
    text=(text||'').trim();
    if(!text||busy)return;
    busy=true;sendBtn.disabled=true;chips.style.display='none';
    addMsg('user',text);ta.value='';ta.style.height='';
    const typing=document.createElement('div');typing.className='noor-msg bot noor-typing';typing.innerHTML='<i></i><i></i><i></i>';
    msgs.appendChild(typing);msgs.scrollTop=msgs.scrollHeight;
    const d=await think(text,false);
    typing.remove();
    history.push({role:'assistant',content:d.reply,sources:d.sources});saveHistory();
    addMsg('assistant',d.reply,d.sources);
    busy=false;sendBtn.disabled=false;
  }

  /* ── speaking (pick the most human-sounding voice available) ── */
  let voices=[];
  function loadVoices(){voices=window.speechSynthesis?speechSynthesis.getVoices():[];}
  if(window.speechSynthesis){loadVoices();speechSynthesis.onvoiceschanged=loadVoices;}
  function pickVoice(){
    const want=T[lang].voiceLang;
    const pool=voices.filter(v=>v.lang&&v.lang.toLowerCase().startsWith(want));
    const rank=v=>(/natural|neural|online/i.test(v.name)?4:0)+(/google/i.test(v.name)?2:0)+(/female|uzma|aria|jenny|samantha|zira/i.test(v.name)?1:0)+(/PK|IN/i.test(v.lang)?1:0);
    return pool.sort((a,b)=>rank(b)-rank(a))[0]||null;
  }
  function speak(text, onDone){
    if(!window.speechSynthesis){onDone&&onDone();return;}
    speechSynthesis.cancel();
    const v=pickVoice();
    const parts=(plain(text).match(/[^.!?۔؟\n]+[.!?۔؟]?/g)||[]).map(s=>s.trim()).filter(Boolean);
    if(!parts.length){onDone&&onDone();return;}
    parts.forEach((p,i)=>{
      const u=new SpeechSynthesisUtterance(p);
      u.lang=v?v.lang:(lang==='ur'?'ur-PK':'en-US');if(v)u.voice=v;
      u.rate=lang==='ur'?.95:1.02;u.pitch=1.05;
      if(i===parts.length-1){u.onend=()=>onDone&&onDone();u.onerror=()=>onDone&&onDone();}
      speechSynthesis.speak(u);
    });
  }

  /* ── listening ── */
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  function makeRecognizer(interim){
    const r=new SR();r.lang=T[lang].recog;r.interimResults=interim;r.continuous=false;r.maxAlternatives=1;return r;
  }

  /* dictation into the text box */
  let dictating=null;
  micBtn.onclick=()=>{
    if(!SR){addMsg('assistant',T[lang].noVoice);return;}
    if(dictating){dictating.stop();return;}
    dictating=makeRecognizer(true);micBtn.classList.add('rec');
    const base=ta.value?ta.value+' ':'';
    dictating.onresult=e=>{ta.value=base+Array.from(e.results).map(x=>x[0].transcript).join('');};
    dictating.onerror=e=>{if(e.error==='not-allowed')addMsg('assistant',T[lang].micDenied);};
    dictating.onend=()=>{micBtn.classList.remove('rec');dictating=null;ta.focus();};
    dictating.start();
  };

  /* full voice call: listen → think → speak → listen … */
  let call={on:false,paused:false,rec:null};
  function setState(s,line){
    voice.dataset.state=s;
    vStatus.textContent=s==='idle'?'':T[lang][s]||'';
    if(line!==undefined)vText.innerHTML=line;
  }
  function listen(){
    if(!call.on||call.paused)return;
    setState('listening','<em>'+esc(T[lang].tapHint)+'</em>');
    const r=makeRecognizer(true);call.rec=r;let finalText='';
    r.onresult=e=>{
      const txt=Array.from(e.results).map(x=>x[0].transcript).join('');
      if(e.results[e.results.length-1].isFinal)finalText=txt;
      vText.textContent=txt;
    };
    r.onerror=e=>{if(e.error==='not-allowed'||e.error==='service-not-allowed'){call.on=false;setState('idle',esc(T[lang].micDenied));}};
    r.onend=async()=>{
      call.rec=null;
      if(!call.on||call.paused)return;
      if(!finalText.trim()){listen();return;}
      setState('thinking','<em>'+esc(finalText)+'</em>');
      addMsg('user',finalText);
      const d=await think(finalText,true);
      history.push({role:'assistant',content:d.reply,sources:d.sources});saveHistory();
      addMsg('assistant',d.reply,d.sources);
      if(!call.on)return;
      setState('speaking',esc(plain(d.reply)));
      speak(d.reply,()=>{if(call.on&&voice.dataset.state==='speaking')listen();});
    };
    try{r.start();}catch(e){}
  }
  function startCall(){
    if(!SR){openPanel();addMsg('assistant',T[lang].noVoice);return;}
    call={on:true,paused:false,rec:null};
    muteBtn.textContent=T[lang].mute;
    voice.classList.add('open');
    const greet=lang==='ur'?'جی، میں سن رہی ہوں۔ بتائیں میں کیا مدد کروں؟':"Hi, I'm Danisa. I'm listening — what can I help with?";
    setState('speaking',esc(greet));
    speak(greet,()=>listen());
  }
  function endCall(){
    call.on=false;
    if(call.rec)try{call.rec.abort();}catch(e){}
    if(window.speechSynthesis)speechSynthesis.cancel();
    voice.classList.remove('open');setState('idle','');
  }
  muteBtn.onclick=()=>{
    call.paused=!call.paused;
    muteBtn.textContent=call.paused?T[lang].unmute:T[lang].mute;
    if(call.paused){if(call.rec)try{call.rec.abort();}catch(e){}speechSynthesis.cancel();setState('paused','');}
    else listen();
  };
  const interrupt=()=>{if(voice.dataset.state==='speaking'){speechSynthesis.cancel();listen();}};
  orb.onclick=interrupt;orb.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();interrupt();}};
  $('.noor-end').onclick=endCall;

  /* ── wiring ── */
  function openPanel(){panel.classList.add('open');launch.style.display='none';setTimeout(()=>ta.focus(),50);}
  function closePanel(){panel.classList.remove('open');launch.style.display='';}
  launch.onclick=openPanel;
  $('.noor-close').onclick=closePanel;
  $('.noor-call').onclick=startCall;
  root.querySelectorAll('.noor-lang button').forEach(b=>b.onclick=()=>{
    lang=b.dataset.lang;try{localStorage.setItem('noor-lang',lang);}catch(e){}
    applyLang();renderAll();
  });
  form.onsubmit=e=>{e.preventDefault();send(ta.value);};
  ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(ta.value);}});
  ta.addEventListener('input',()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(voice.classList.contains('open'))endCall();else if(panel.classList.contains('open'))closePanel();}});
  document.querySelectorAll('[data-noor]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();el.dataset.noor==='voice'?startCall():openPanel();}));

  applyLang();renderAll();
  window.Danisa=window.Noor={open:openPanel,call:startCall};
})();

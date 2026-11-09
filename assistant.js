/* ── Danisa · REHABION's voice-first assistant ──
   Voice call → worker "/live" (one-use token) → Gemini Live over WebSocket:
                real-time speech, follows whatever language you speak (even
                mid-sentence), barge-in. No language menu, no on-screen transcript.
   Text chat  → worker "/"      (same auto-language behaviour)
   Listen 🔊  → worker "/tts"   (Gemini TTS — real Urdu voice, not a browser voice)
   Memory: name + recent conversation are kept in this browser only, so Danisa
   picks up where you left off — in chat and in voice. */
(function(){
  const AI_ENDPOINT = window.REHABION_AI_ENDPOINT || 'https://rehabion-ai.rehabion.workers.dev';
  const LIVE_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

  /* interface words only — Danisa herself answers in whatever language you use */
  const T = {
    en:{
      role:'REHABION assistant · always here', launch:'Talk to Danisa', launchHint:'voice or chat',
      hello:"Hi, I'm **Danisa** 👋\nAsk me anything — in any language you like. Tap the phone to just talk.",
      askName:'First — what should I call you?', namePh:'Your name', nameGo:'Start', skip:'skip',
      nice:n=>`Lovely to meet you, **${n}**! What's on your mind?`, welcomeBack:n=>`Welcome back, **${n}** 😊`,
      placeholder:'Type your message…', chips:['What does REHABION do?','Stroke recovery tips','Book a free demo','How can I invest?'],
      foot:'Danisa can make mistakes. Not medical advice — emergencies: 1122.', forget:'Forget me',
      connecting:'Connecting…', listening:'Listening', speaking:'Speaking', paused:'Muted',
      end:'End', mute:'Mute', unmute:'Unmute', listen:'Listen',
      micDenied:'I need microphone permission to hear you. Please allow it in your browser and try again.',
      noMic:'Your browser can’t use a microphone here. Please try Chrome, Edge, Firefox or Safari.',
      voiceErr:"The call dropped. Please try again in a moment.",
      offline:"I'm having trouble connecting right now. Please try again, or tap **Talk to the founder** below.",
      founderBtn:'Talk to the founder', founder:'Muhammad Ramzan',
      hoIntro:"I'll ring **Muhammad Ramzan**, our founder, right now. He answers in his browser — no phone numbers needed.",
      hoReason:'What would you like to talk about?', hoContact:'Phone or email for a call-back (optional)', hoGo:'Ring him',
      hoRinging:'Ringing…', hoWaitText:"He's been notified. If he's free he'll pick up in a moment.", hoOpened:'He’s looking at your message…',
      hoConnecting:'Picking up…', hoConnected:'Connected',
      hoBusy:"He can't talk right now.", hoMissed:"He couldn't pick up just now.",
      hoSaved:c=>c?"He has your message and your contact — he'll get back to you soon.":"He has your message. Leave a contact next time so he can call you back.",
      hoFail:'The call could not connect. He still has your message.', hoLimit:'Lots of requests right now — please try again a little later.',
      hoMicNeeded:'To talk to him I need your microphone. Please allow it and try again.',
      cancel:'Cancel', close:'Close'
    },
    ur:{
      role:'ریہابیون اسسٹنٹ · ہمیشہ حاضر', launch:'دانیسا سے بات کریں', launchHint:'آواز یا چیٹ',
      hello:'السلام علیکم، میں **دانیسا** ہوں 👋\nجس زبان میں چاہیں بات کریں۔ بولنے کے لیے فون پر ٹیپ کریں۔',
      askName:'پہلے یہ بتائیں — آپ کا نام کیا ہے؟', namePh:'آپ کا نام', nameGo:'شروع کریں', skip:'رہنے دیں',
      nice:n=>`آپ سے مل کر بہت خوشی ہوئی، **${n}**! بتائیں میں کیا مدد کروں؟`, welcomeBack:n=>`خوش آمدید، **${n}** 😊`,
      placeholder:'اپنا پیغام لکھیں…', chips:['ریہابیون کیا کرتا ہے؟','فالج کے بعد ورزشیں','مفت ڈیمو بک کریں','سرمایہ کاری کیسے کریں؟'],
      foot:'دانیسا سے غلطی ہو سکتی ہے۔ یہ طبی مشورہ نہیں — ایمرجنسی میں 1122۔', forget:'مجھے بھول جائیں',
      connecting:'جڑ رہی ہوں…', listening:'سن رہی ہوں', speaking:'بول رہی ہوں', paused:'خاموش',
      end:'ختم', mute:'خاموش', unmute:'آواز کھولیں', listen:'سنیں',
      micDenied:'آپ کی آواز سننے کے لیے مائیکروفون کی اجازت چاہیے۔ براؤزر میں اجازت دے کر دوبارہ کوشش کریں۔',
      noMic:'یہ براؤزر مائیکروفون استعمال نہیں کر سکتا۔ Chrome، Edge، Firefox یا Safari آزمائیں۔',
      voiceErr:'کال کٹ گئی۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔',
      offline:'ابھی رابطے میں مسئلہ ہے۔ دوبارہ کوشش کریں یا نیچے **بانی سے بات کریں** پر ٹیپ کریں۔',
      founderBtn:'بانی سے بات کریں', founder:'محمد رمضان',
      hoIntro:'میں ابھی ہمارے بانی **محمد رمضان** کو کال ملاتی ہوں۔ وہ اپنے براؤزر سے جواب دیتے ہیں — کسی فون نمبر کی ضرورت نہیں۔',
      hoReason:'آپ کس بارے میں بات کرنا چاہتے ہیں؟', hoContact:'واپسی کال کے لیے فون یا ای میل (اختیاری)', hoGo:'کال ملائیں',
      hoRinging:'گھنٹی جا رہی ہے…', hoWaitText:'انہیں اطلاع دے دی گئی ہے۔ اگر وہ فارغ ہیں تو ابھی جواب دیں گے۔', hoOpened:'وہ آپ کا پیغام دیکھ رہے ہیں…',
      hoConnecting:'جڑ رہے ہیں…', hoConnected:'جڑ گئے',
      hoBusy:'وہ ابھی بات نہیں کر سکتے۔', hoMissed:'وہ ابھی کال نہیں اٹھا سکے۔',
      hoSaved:c=>c?'آپ کا پیغام اور رابطہ ان تک پہنچ گیا ہے — وہ جلد آپ سے رابطہ کریں گے۔':'آپ کا پیغام ان تک پہنچ گیا ہے۔ اگلی بار رابطہ بھی دیں تاکہ وہ واپس کال کر سکیں۔',
      hoFail:'کال نہیں جڑ سکی۔ آپ کا پیغام ان تک پہنچ چکا ہے۔', hoLimit:'ابھی بہت درخواستیں ہیں — تھوڑی دیر بعد کوشش کریں۔',
      hoMicNeeded:'بات کرنے کے لیے مائیکروفون کی اجازت چاہیے۔ اجازت دے کر دوبارہ کوشش کریں۔',
      cancel:'منسوخ', close:'بند کریں'
    }
  };
  const t = T[(navigator.language||'').toLowerCase().startsWith('ur') ? 'ur' : 'en'];

  /* ── memory (this browser only) ── */
  const KEY='danisa-memory';
  let mem={name:'',turns:[]};
  try{ mem=Object.assign(mem,JSON.parse(localStorage.getItem(KEY)||'{}')); }catch(e){}
  if(!Array.isArray(mem.turns))mem.turns=[];
  const save=()=>{ mem.turns=mem.turns.slice(-40); try{localStorage.setItem(KEY,JSON.stringify(mem));}catch(e){} };
  const knownName=()=>(mem.name||'').trim();
  const memorySummary=()=>mem.turns.slice(-14).map(m=>(m.role==='user'?'User':'Danisa')+': '+m.content.replace(/\s+/g,' ').slice(0,220)).join('\n').slice(-1500);

  /* ── tiny, safe markdown ── */
  const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function md(text){
    const inline=s=>esc(s)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    const out=[];let list=null;
    text.split('\n').forEach(line=>{
      const m=line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
      if(m){(list=list||[]).push('<li>'+inline(m[1])+'</li>');return;}
      if(list){out.push('<ul>'+list.join('')+'</ul>');list=null;}
      if(line.trim())out.push('<p>'+inline(line)+'</p>');
    });
    if(list)out.push('<ul>'+list.join('')+'</ul>');
    return out.join('');
  }
  const plain=s=>s.replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/https?:\/\/\S+/g,'').replace(/[*_#>`]/g,'').replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu,'').trim();
  const arabicScript=s=>/[؀-ۿ]/.test(s);

  /* ── DOM ── */
  const I={
    phone:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/></svg>',
    close:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    mic:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0M12 17v5"/></svg>',
    send:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>'
  };
  const root=document.createElement('div');
  root.innerHTML=`
    <button class="noor-launch" type="button" aria-label="Open Danisa assistant"><span class="noor-face" aria-hidden="true"></span><span><span data-t="launch"></span><small data-t="launchHint"></small></span></button>
    <div class="noor-panel" role="dialog" aria-modal="false" aria-label="Danisa assistant">
      <div class="noor-head">
        <span class="noor-face" aria-hidden="true"></span>
        <div class="noor-title"><strong>Danisa</strong><span data-t="role"></span></div>
        <button class="noor-icon-btn noor-call" type="button" aria-label="Voice call">${I.phone}</button>
        <button class="noor-icon-btn noor-close" type="button" aria-label="Close">${I.close}</button>
      </div>
      <div class="noor-msgs" aria-live="polite"></div>
      <div class="noor-chips"></div>
      <button type="button" class="noor-founder"><span aria-hidden="true">📞</span> <span data-t="founderBtn"></span></button>
      <form class="noor-input">
        <button class="noor-icon-btn noor-mic" type="button" aria-label="Talk instead">${I.mic}</button>
        <textarea rows="1" maxlength="2000" dir="auto" aria-label="Message"></textarea>
        <button class="noor-send" type="submit" aria-label="Send">${I.send}</button>
      </form>
      <div class="noor-foot"><span data-t="foot"></span> · <button type="button" class="noor-forget" data-t="forget"></button></div>
    </div>
    <div class="noor-voice" role="dialog" aria-label="Voice call with Danisa" data-state="idle">
      <div class="noor-orb" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="noor-voice-name">Danisa</div>
      <div class="noor-voice-status"></div>
      <div class="noor-voice-time" aria-hidden="true">00:00</div>
      <div class="noor-voice-text" role="status"></div>
      <div class="noor-voice-actions"><button type="button" class="noor-mute"></button><button type="button" class="noor-end"></button></div>
    </div>`;
  document.body.appendChild(root);
  const $=s=>root.querySelector(s);
  const launch=$('.noor-launch'),panel=$('.noor-panel'),msgs=$('.noor-msgs'),chips=$('.noor-chips'),form=$('.noor-input'),
        ta=$('textarea'),sendBtn=$('.noor-send'),voice=$('.noor-voice'),vStatus=$('.noor-voice-status'),
        vTime=$('.noor-voice-time'),vText=$('.noor-voice-text'),muteBtn=$('.noor-mute'),endBtn=$('.noor-end'),vName=$('.noor-voice-name'),orb=$('.noor-orb');

  root.querySelectorAll('[data-t]').forEach(el=>{el.textContent=t[el.dataset.t];});
  ta.placeholder=t.placeholder;
  t.chips.forEach(c=>{const b=document.createElement('button');b.type='button';b.textContent=c;b.dir='auto';b.onclick=()=>send(c);chips.appendChild(b);});
  const showChips=()=>{chips.style.display=(mem.turns.some(m=>!m.voice)||!mem.name)?'none':'flex';};

  function bubble(role,html,raw){
    const div=document.createElement('div');
    div.className='noor-msg '+(role==='user'?'user':'bot')+(arabicScript(raw||'')?' nas':'');
    div.dir='auto';div.innerHTML=html;msgs.appendChild(div);msgs.scrollTop=msgs.scrollHeight;return div;
  }
  function addMsg(role,text,sources){
    const div=bubble(role,role==='user'?esc(text).replace(/\n/g,'<br>'):md(text),text);
    if(sources&&sources.length){
      const s=document.createElement('div');s.className='noor-src';
      sources.forEach(x=>{const a=document.createElement('a');a.href=x.uri;a.target='_blank';a.rel='noopener noreferrer';a.textContent=x.title;s.appendChild(a);});
      div.appendChild(s);
    }
    if(role!=='user'){
      const b=document.createElement('button');b.type='button';b.className='noor-speak';b.textContent='🔊 '+t.listen;
      b.onclick=()=>speak(text,b);div.appendChild(b);
    }
    return div;
  }
  function askNameBubble(){
    const d=bubble('bot','<p>'+esc(t.askName)+'</p>',t.askName);
    const f=document.createElement('form');f.className='noor-name';
    f.innerHTML=`<input maxlength="40" dir="auto" autocomplete="given-name" placeholder="${esc(t.namePh)}" aria-label="${esc(t.namePh)}"><button type="submit">${esc(t.nameGo)}</button><button type="button" class="skip">${esc(t.skip)}</button>`;
    d.appendChild(f);
    const inp=f.querySelector('input');
    f.onsubmit=e=>{e.preventDefault();const n=inp.value.trim().replace(/[<>]/g,'').slice(0,40);if(!n)return;mem.name=n;save();d.remove();bubble('bot',md(t.nice(n)),n);showChips();};
    f.querySelector('.skip').onclick=()=>{mem.name=' ';save();d.remove();showChips();ta.focus();};
  }
  let greeted=false;
  function renderAll(){
    msgs.innerHTML='';
    bubble('bot',md(t.hello),t.hello);
    mem.turns.filter(m=>!m.voice).forEach(m=>addMsg(m.role,m.content,m.sources));
    if(!mem.name)askNameBubble();
    else if(mem.turns.length&&knownName()&&!greeted){greeted=true;bubble('bot',md(t.welcomeBack(knownName())));}
    showChips();
  }

  /* ── text chat ── */
  let busy=false;
  async function api(path,body){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),40000);
    try{
      const r=await fetch(AI_ENDPOINT+path,{method:'POST',headers:{'Content-Type':'application/json'},signal:ctrl.signal,body:JSON.stringify(body)});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'bad response');return d;
    }finally{clearTimeout(timer);}
  }
  async function send(text){
    text=(text||'').trim();if(!text||busy)return;
    busy=true;sendBtn.disabled=true;chips.style.display='none';
    addMsg('user',text);ta.value='';ta.style.height='';
    mem.turns.push({role:'user',content:text});save();
    const typing=bubble('bot','<i></i><i></i><i></i>');typing.classList.add('noor-typing');
    let d;
    try{d=await api('/',{lang:'auto',name:knownName(),messages:mem.turns.map(m=>({role:m.role,content:m.content}))});}
    catch(e){d={reply:t.offline};}
    typing.remove();
    mem.turns.push({role:'assistant',content:d.reply,sources:d.sources});save();
    addMsg('assistant',d.reply,d.sources);
    busy=false;sendBtn.disabled=false;
  }

  /* ── 🔊 listen: Gemini TTS, so Urdu sounds like Urdu ── */
  let player=null;
  async function speak(text,btn){
    if(player){player.pause();player=null;}
    btn.disabled=true;
    try{
      const d=await api('/tts',{text:plain(text).slice(0,1500)});
      player=new Audio('data:'+(d.mime||'audio/wav')+';base64,'+d.audio);await player.play();
    }catch(e){}finally{btn.disabled=false;}
  }

  /* ── live voice call (Gemini Live) ── */
  const call={on:false,muted:false,ws:null,inCtx:null,outCtx:null,stream:null,node:null,src:null,
              sources:new Set(),playEnd:0,handle:null,userLine:'',botLine:'',raf:0,level:0,t0:0,clock:0};
  const b64=buf=>{let s='';const u=new Uint8Array(buf);for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s);};
  function setState(s){voice.dataset.state=s;vStatus.textContent=t[s]||'';}
  function tick(){
    if(!call.t0)return;
    const s=Math.floor((Date.now()-call.t0)/1000);
    vTime.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
  }
  /* transcripts are kept quietly as memory — never shown on screen */
  function commitTurn(){
    const u=call.userLine.trim(),b=call.botLine.trim();
    if(u)mem.turns.push({role:'user',content:u,voice:true});
    if(b)mem.turns.push({role:'assistant',content:b,voice:true});
    if(u||b)save();
    call.userLine='';call.botLine='';
  }
  function playPCM(b64data){
    const raw=atob(b64data),n=raw.length>>1,f=new Float32Array(n);
    for(let i=0;i<n;i++){let v=raw.charCodeAt(2*i)|(raw.charCodeAt(2*i+1)<<8);if(v>=0x8000)v-=0x10000;f[i]=v/0x8000;}
    const ctx=call.outCtx,buf=ctx.createBuffer(1,n,24000);buf.copyToChannel(f,0);
    const s=ctx.createBufferSource();s.buffer=buf;s.connect(ctx.destination);
    const at=Math.max(call.playEnd,ctx.currentTime+0.04);s.start(at);call.playEnd=at+buf.duration;
    call.sources.add(s);s.onended=()=>{call.sources.delete(s);if(!call.sources.size&&call.on){setState(call.muted?'paused':'listening');maybeHandoff();}};
    setState('speaking');
  }
  function stopPlayback(){call.sources.forEach(s=>{try{s.stop();}catch(e){}});call.sources.clear();call.playEnd=0;}
  function animateOrb(){
    if(!call.on)return;
    const lvl=voice.dataset.state==='speaking'?0.35+Math.random()*0.25:Math.min(1,call.level*3);
    orb.style.setProperty('--lvl',lvl.toFixed(3));
    call.raf=requestAnimationFrame(animateOrb);
  }

  async function openSocket(){
    const d=await api('/live',{lang:'auto',name:knownName(),memory:memorySummary()});
    const ws=new WebSocket(LIVE_WS+'?access_token='+encodeURIComponent(d.token));call.ws=ws;
    ws.onopen=()=>ws.send(JSON.stringify({setup:{
      model:'models/'+d.model,
      generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Kore'}}}},
      systemInstruction:{parts:[{text:d.instructions}]},
      inputAudioTranscription:{},outputAudioTranscription:{},
      contextWindowCompression:{slidingWindow:{}},             /* long calls don't run out of context */
      sessionResumption:call.handle?{handle:call.handle}:{},   /* reconnects keep the same conversation */
      tools:[{functionDeclarations:[{name:'remember_name',description:"Save the user's name as soon as they say it.",
        parameters:{type:'OBJECT',properties:{name:{type:'STRING',description:'The name, as the user said it'}},required:['name']}},
        {name:'connect_to_founder',description:'Ring the founder, Muhammad Ramzan, so the user can talk to him live through the website. Use when the user wants to speak to the founder or a real person.',
        parameters:{type:'OBJECT',properties:{name:{type:'STRING',description:"The user's name"},reason:{type:'STRING',description:'What they want to talk about, in a short sentence'},
          contact:{type:'STRING',description:'Optional phone or email for a call-back'}},required:['reason']}}]}]
    }}));
    ws.onmessage=async e=>{
      const m=JSON.parse(typeof e.data==='string'?e.data:await e.data.text());
      if(m.setupComplete){
        setState('listening');
        if(!call.started){call.started=true;call.t0=Date.now();
          ws.send(JSON.stringify({realtimeInput:{text:knownName()
            ?`(The call just started. Greet ${knownName()} warmly by name and carry on naturally.)`
            :'(The call just started. Greet me with Assalam o Alaikum, introduce yourself as Danisa and ask my name.)'}}));}
        return;
      }
      if(m.sessionResumptionUpdate&&m.sessionResumptionUpdate.newHandle)call.handle=m.sessionResumptionUpdate.newHandle;
      if(m.goAway){reconnect();return;}
      if(m.toolCall){
        const responses=(m.toolCall.functionCalls||[]).map(fc=>{
          if(fc.name==='remember_name'&&fc.args&&fc.args.name){mem.name=String(fc.args.name).slice(0,40);save();}
          if(fc.name==='connect_to_founder'){
            call.handoff=Object.assign({name:knownName()},fc.args||{});call.handoffAt=Date.now();
            setTimeout(maybeHandoff,9000);   /* don't wait forever for her to finish speaking */
            return {id:fc.id,name:fc.name,response:{result:'Ringing him now. Tell the user in one short sentence that you are checking if he is free and to stay on the line.'}};
          }
          return {id:fc.id,name:fc.name,response:{result:'saved'}};
        });
        ws.send(JSON.stringify({toolResponse:{functionResponses:responses}}));
        return;
      }
      const sc=m.serverContent;if(!sc)return;
      if(sc.interrupted){stopPlayback();setState('listening');}
      if(sc.inputTranscription&&sc.inputTranscription.text)call.userLine+=sc.inputTranscription.text;
      if(sc.outputTranscription&&sc.outputTranscription.text)call.botLine+=sc.outputTranscription.text;
      (sc.modelTurn&&sc.modelTurn.parts||[]).forEach(p=>{if(p.inlineData&&p.inlineData.data)playPCM(p.inlineData.data);});
      if(sc.turnComplete){commitTurn();if(call.handoff){call.handoffTurnDone=true;maybeHandoff();}}
    };
    ws.onclose=ev=>{if(call.on&&call.ws===ws&&!call.reconnecting){if(ev.code===1000||ev.code===1005)endCall();else{vText.textContent=t.voiceErr;setTimeout(endCall,2500);}}};
  }
  async function reconnect(){
    if(call.reconnecting)return;call.reconnecting=true;
    const old=call.ws;try{old&&old.close();}catch(e){}
    try{await openSocket();}catch(e){vText.textContent=t.voiceErr;}
    call.reconnecting=false;
  }

  async function startCall(){
    if(call.on)return;
    if(!navigator.mediaDevices||!window.AudioWorkletNode){openPanel();bubble('bot',esc(t.noMic));return;}
    if(ho.active)return;
    Object.assign(call,{on:true,muted:false,started:false,handle:null,userLine:'',botLine:'',level:0,t0:0,handoff:null,handoffTurnDone:false});
    vName.textContent='Danisa';endBtn.textContent=t.end;muteBtn.hidden=false;voice.dataset.mode='ai';
    /* audio contexts must be created inside the click */
    call.outCtx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:24000});
    call.inCtx=new (window.AudioContext||window.webkitAudioContext)();
    muteBtn.textContent=t.mute;voice.classList.add('open');setState('connecting');vText.textContent='';vTime.textContent='00:00';
    call.clock=setInterval(tick,500);animateOrb();
    try{
      call.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
    }catch(e){vText.textContent=t.micDenied;setTimeout(endCall,3500);return;}
    try{
      await call.inCtx.audioWorklet.addModule('mic-worklet.js');
      call.src=call.inCtx.createMediaStreamSource(call.stream);
      call.node=new AudioWorkletNode(call.inCtx,'mic-pcm');
      call.node.port.onmessage=e=>{
        call.level=e.data.level;
        if(!call.muted&&call.ws&&call.ws.readyState===1)
          call.ws.send(JSON.stringify({realtimeInput:{audio:{data:b64(e.data.pcm),mimeType:'audio/pcm;rate=16000'}}}));
      };
      call.src.connect(call.node);
      await openSocket();
    }catch(e){vText.textContent=t.voiceErr;setTimeout(endCall,3000);}
  }
  function endCall(){
    if(!call.on)return;
    call.on=false;cancelAnimationFrame(call.raf);clearInterval(call.clock);
    commitTurn();stopPlayback();
    try{call.ws&&call.ws.close();}catch(e){}
    try{call.stream&&call.stream.getTracks().forEach(tr=>tr.stop());}catch(e){}
    try{call.inCtx&&call.inCtx.close();call.outCtx&&call.outCtx.close();}catch(e){}
    call.ws=call.stream=call.node=call.src=null;
    voice.classList.remove('open');setState('idle');
    if(panel.classList.contains('open'))renderAll();   /* a name learned on the call shows up in chat */
  }
  muteBtn.onclick=()=>{
    if(ho.active){ho.muted=!ho.muted;ho.call&&ho.call.mute(ho.muted);muteBtn.textContent=ho.muted?t.unmute:t.mute;return;}
    call.muted=!call.muted;muteBtn.textContent=call.muted?t.unmute:t.mute;if(voice.dataset.state!=='speaking')setState(call.muted?'paused':'listening');};
  endBtn.onclick=()=>{ho.active?endHandoff():endCall();};

  /* ── talk to the founder: ring him, then a direct browser-to-browser call ── */
  function maybeHandoff(){
    if(!call.on||!call.handoff)return;
    const late=Date.now()-call.handoffAt>8500;
    if(!late&&(!call.handoffTurnDone||call.sources.size))return;
    const req=call.handoff;call.handoff=null;
    endCall();startHandoff(req);
  }
  const ho={active:false,call:null,stream:null,ring:null,clock:0,t0:0,muted:false,req:null,result:''};
  function ringTone(on){
    if(!on){if(ho.ring){try{ho.ring.close();}catch(e){}ho.ring=null;}return;}
    try{
      const ctx=new (window.AudioContext||window.webkitAudioContext)(),g=ctx.createGain();g.gain.value=0;g.connect(ctx.destination);
      [425,450].forEach(f=>{const o=ctx.createOscillator();o.frequency.value=f;o.connect(g);o.start();});
      for(let i=0;i<40;i++){const at=ctx.currentTime+i*3;g.gain.setValueAtTime(0.05,at);g.gain.setValueAtTime(0,at+1);}   /* soft "brr… brr…" */
      ho.ring=ctx;
    }catch(e){}
  }
  function hoState(state,status,text){voice.dataset.state=state;vStatus.textContent=status;if(text!==undefined)vText.innerHTML=text?md(text):'';}
  function hoTick(){const s=Math.floor((Date.now()-ho.t0)/1000);vTime.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
  async function startHandoff(req){
    if(ho.active||call.on)return;
    Object.assign(ho,{active:true,call:null,muted:false,req,result:''});
    voice.dataset.mode='human';vName.textContent=t.founder;vTime.textContent='';
    muteBtn.hidden=true;muteBtn.textContent=t.mute;endBtn.textContent=t.cancel;
    voice.classList.add('open');hoState('connecting',t.hoRinging,t.hoWaitText);
    try{ho.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});}
    catch(e){ho.result='mic';hoState('idle','',t.hoMicNeeded);endBtn.textContent=t.close;return;}
    ringTone(true);
    let d,info;
    try{
      d=await api('/handoff',{name:req.name||knownName()||'',reason:req.reason||'',contact:req.contact||''});
      info=await (await fetch(AI_ENDPOINT+'/handoff/info?r='+d.id+'&k='+d.visitorKey)).json();
    }catch(e){ringTone(false);ho.result='failed';hoState('idle','',/busy/.test(String(e.message))?t.hoLimit:t.hoFail);endBtn.textContent=t.close;return;}
    if(!ho.active){ringTone(false);return;}
    ho.call=RehabCall.start({
      wsUrl:AI_ENDPOINT.replace(/^http/,'ws')+'/handoff/ws?r='+d.id+'&k='+d.visitorKey,
      iceServers:info.iceServers,role:'visitor',stream:ho.stream,
      onMessage:m=>{if(m.t==='founder-opened')vStatus.textContent=t.hoOpened;},
      onStatus:(st,m)=>{
        if(st==='accepted'){ringTone(false);hoState('connecting',t.hoConnecting,'');}
        if(st==='busy'){ho.result='busy';hoState('idle',t.hoBusy,(m.note?'“'+m.note+'”\n\n':'')+t.hoSaved(req.contact));}
        if(st==='missed'){ho.result='missed';hoState('idle',t.hoMissed,t.hoSaved(req.contact));}
      },
      onConnected:()=>{ringTone(false);ho.result='talked';hoState('speaking',t.hoConnected,'');muteBtn.hidden=false;endBtn.textContent=t.end;
        ho.t0=Date.now();ho.clock=setInterval(hoTick,500);hoTick();},
      onEnded:why=>{
        ringTone(false);clearInterval(ho.clock);
        if(ho.stream)ho.stream.getTracks().forEach(tr=>tr.stop());
        if(ho.result==='talked'){finishHandoff();return;}
        if(!ho.result){ho.result='failed';hoState('idle','',t.hoFail);}
        endBtn.textContent=t.close;muteBtn.hidden=true;
      }
    });
  }
  function finishHandoff(){
    if(!ho.active)return;
    const r=ho.result,req=ho.req||{};
    ringTone(false);clearInterval(ho.clock);
    if(ho.stream)ho.stream.getTracks().forEach(tr=>tr.stop());
    ho.active=false;ho.call=null;voice.classList.remove('open');voice.dataset.mode='ai';setState('idle');
    const note=r==='busy'?t.hoBusy+' '+t.hoSaved(req.contact):r==='missed'?t.hoMissed+' '+t.hoSaved(req.contact):r==='failed'?t.hoFail:'';
    if(note){mem.turns.push({role:'assistant',content:'📞 '+note});save();if(panel.classList.contains('open'))renderAll();}
  }
  function endHandoff(){
    const c=ho.call;
    if(c&&!ho.result)c.cancel();
    else if(c&&ho.result==='talked')c.hangup();
    finishHandoff();
  }
  function founderForm(){
    openPanel();chips.style.display='none';
    const d=bubble('bot',md(t.hoIntro),t.hoIntro);
    const f=document.createElement('form');f.className='noor-name noor-ho';
    f.innerHTML=`<input name="n" maxlength="60" dir="auto" autocomplete="name" placeholder="${esc(t.namePh)}" value="${esc(knownName())}" required>
      <input name="r" maxlength="300" dir="auto" placeholder="${esc(t.hoReason)}" required>
      <input name="c" maxlength="80" dir="auto" autocomplete="tel" placeholder="${esc(t.hoContact)}">
      <button type="submit">📞 ${esc(t.hoGo)}</button>`;
    d.appendChild(f);setTimeout(()=>f.querySelector(knownName()?'[name=r]':'[name=n]').focus(),80);
    f.onsubmit=e=>{e.preventDefault();
      const name=f.n.value.trim().slice(0,60),reason=f.r.value.trim().slice(0,300),contact=f.c.value.trim().slice(0,80);
      if(!name||!reason)return;
      if(!knownName()){mem.name=name;save();}
      d.remove();startHandoff({name,reason,contact});};
  }
  $('.noor-founder').onclick=founderForm;

  /* ── wiring ── */
  function openPanel(){panel.classList.add('open');launch.style.display='none';setTimeout(()=>{const n=panel.querySelector('.noor-name input');(n||ta).focus();},60);}
  function closePanel(){panel.classList.remove('open');launch.style.display='';}
  launch.onclick=openPanel;
  $('.noor-close').onclick=closePanel;
  $('.noor-call').onclick=startCall;
  $('.noor-mic').onclick=startCall;
  $('.noor-forget').onclick=()=>{mem={name:'',turns:[]};save();greeted=false;renderAll();};
  form.onsubmit=e=>{e.preventDefault();send(ta.value);};
  ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(ta.value);}});
  ta.addEventListener('input',()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';ta.classList.toggle('nas',arabicScript(ta.value));});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(ho.active)endHandoff();else if(voice.classList.contains('open'))endCall();else if(panel.classList.contains('open'))closePanel();}});
  document.querySelectorAll('[data-noor]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();el.dataset.noor==='voice'?startCall():el.dataset.noor==='founder'?founderForm():openPanel();}));

  renderAll();
  window.Danisa=window.Noor={open:openPanel,call:startCall,end:endCall,founder:founderForm};
})();

/* Founder side of "talk to the founder".
   founder.html#r=…&k=…  → answer one request (opened from the alert)
   founder.html           → the founder app: set up call alerts on this phone + recent requests */
(function(){
  const API=window.REHABION_AI_ENDPOINT||'https://rehabion-ai.rehabion.workers.dev';
  const $=id=>document.getElementById(id);
  const show=(id,on)=>$(id).classList.toggle('hidden',!on);
  addEventListener('hashchange',()=>location.reload());   /* a new alert tapped while the app is open */

  /* tiny IndexedDB store, shared with sw.js (the service worker can't read localStorage) */
  function idb(op,key,val){
    return new Promise((res,rej)=>{
      const open=indexedDB.open('rehabion-founder',1);
      open.onupgradeneeded=()=>open.result.createObjectStore('kv');
      open.onerror=()=>rej(open.error);
      open.onsuccess=()=>{const st=open.result.transaction('kv',op==='get'?'readonly':'readwrite').objectStore('kv');
        const r=op==='get'?st.get(key):st.put(val,key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);};
    });
  }
  const swReady=('serviceWorker' in navigator)?navigator.serviceWorker.register('sw.js'):Promise.reject(new Error('no sw'));
  swReady.catch(()=>{});

  const h=new URLSearchParams(location.hash.slice(1)),r=h.get('r'),k=h.get('k');
  if(r&&k)answerScreen();else appScreen();

  /* ── the founder app ── */
  async function appScreen(){
    show('app',true);document.body.dataset.s='app';
    const device=await idb('get','device').catch(()=>null);
    if(device&&window.Notification&&Notification.permission==='granted')return inbox(device);
    show('setup',true);
    const ios=/iphone|ipad|ipod/i.test(navigator.userAgent),standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
    if(ios&&!standalone)show('iosHint',true);
    $('enable').onclick=enable;
    $('pin').onkeydown=e=>{if(e.key==='Enter')enable();};
  }
  const b64=s=>{const p='='.repeat((4-s.length%4)%4),raw=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));};
  async function enable(){
    const err=$('err');err.textContent='';
    const pin=$('pin').value.trim();if(!pin){err.textContent='Enter your PIN.';return;}
    try{
      if(!('PushManager' in window))throw new Error('This browser can’t receive alerts. On iPhone, add REHABION to your Home Screen first; on Android use Chrome.');
      const perm=await Notification.requestPermission();
      if(perm!=='granted')throw new Error('Please allow notifications — that’s how your phone rings.');
      const reg=await swReady;await navigator.serviceWorker.ready;
      const {key}=await (await fetch(API+'/push/vapid')).json();
      let sub=await reg.pushManager.getSubscription();
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(key)});
      const res=await fetch(API+'/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({pin,subscription:sub.toJSON(),label:navigator.userAgent.slice(0,40)})});
      const d=await res.json();if(!res.ok)throw new Error(d.error||'Could not turn on alerts.');
      await idb('put','device',d.device);await idb('put','api',API);
      show('setup',false);inbox(d.device);
    }catch(e){err.textContent=e.message;}
  }
  async function inbox(device){
    show('inbox',true);
    const list=$('list');
    async function load(){
      try{
        const d=await (await fetch(API+'/push/pending?d='+device,{cache:'no-store'})).json();
        if(d.error){await idb('put','device','');location.reload();return;}
        const reqs=(d.requests||[]).filter(x=>!x.test);
        list.innerHTML=reqs.length?'':'<p class="empty">No requests in the last 24 hours.</p>';
        reqs.forEach(x=>{
          const row=document.createElement('div');row.className='req';
          const mins=Math.round((Date.now()-x.createdAt)/60000);
          row.innerHTML='<span class="av"></span><div><b></b><span></span></div>';
          row.querySelector('.av').textContent=(x.name||'?').charAt(0).toUpperCase();
          row.querySelector('b').textContent=x.name;
          row.querySelector('div span').textContent=(mins<1?'just now':mins<60?mins+' min ago':Math.round(mins/60)+' h ago')+' · '+(x.reason||'')+(x.contact?' · '+x.contact:'');
          if(x.link){const a=document.createElement('a');a.href=x.link;a.textContent='Open';row.appendChild(a);}
          list.appendChild(row);
        });
      }catch(e){list.innerHTML='<p class="empty">Offline — will refresh.</p>';}
    }
    load();setInterval(load,15000);
    $('test').onclick=async()=>{
      $('testMsg').textContent='Sending…';
      try{const d=await (await fetch(API+'/push/test?d='+device,{method:'POST'})).json();
        $('testMsg').textContent=d.sent?'Sent — your phone should ring now (lock the screen to see it).':'Could not reach this phone — try turning alerts on again.';}
      catch(e){$('testMsg').textContent='Network problem.';}
    };
  }

  /* ── answering one request ──
     Danisa calls you → you tell her if you're free → she introduces you to the visitor,
     takes notes while you talk → report to Telegram + an optional spoken debrief. */
  function answerScreen(){
    show('callCard',true);
    const say=(s,txt)=>{document.body.dataset.s=s;$('status').textContent=txt;};
    let info=null,call=null,stream=null,ctx=null,live=null,danisa=null,player=null,notes=[],transcript=[];
    let t0=0,clock=0,muted=false,poll=0,decision=null,talked=false;
    const TEXT={
      ringing:'They are waiting on the website.',danisa:'Danisa is on the line…',
      accepted:'Connecting you…','in-call':'',
      busy:'Done — they’ve been told you’ll get back to them.',
      missed:'Missed — they waited but the call wasn’t answered.',
      cancelled:'They hung up before you answered.',left:'They left the website before you answered.',
      ended:'Call ended.',failed:'The connection failed — their network may be blocking calls.',disconnected:'Disconnected.',
      writing:'Danisa is writing up her notes…',debrief:'Danisa is debriefing you…',done:'All done — the report is on your Telegram.'
    };
    function render(status){
      say(status,TEXT[status]||status);
      show('ringingBtns',status==='ringing');show('note',status==='ringing');
      show('callBtns',status==='accepted'||status==='in-call');
      show('notes',status==='in-call');
      show('debriefBtns',status==='debrief');
      if(['missed','cancelled','left'].includes(status)&&info&&info.contact)$('status').textContent+=' You can reach them yourself at the contact above.';
    }
    function tick(){const s=Math.floor((Date.now()-t0)/1000);$('status').innerHTML='<span class="timer">'+String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')+'</span>';}
    function showReport(text){$('report').textContent=text;show('report',!!text);}

    async function load(){
      try{const res=await fetch(API+'/handoff/info?r='+r+'&k='+k);info=await res.json();if(!res.ok)throw new Error(info.error);}
      catch(e){$('who').textContent='This request has expired.';say('error','');show('ringingBtns',false);return;}
      $('who').textContent=info.name;$('initial').textContent=(info.name||'?').trim().charAt(0).toUpperCase();
      if(info.reason||info.contact){show('about',true);$('reason').textContent=info.reason||'—';}
      if(info.contact){show('contactLbl',true);show('contact',true);$('contact').textContent=info.contact;}
      if(info.status!=='ringing'){$('kicker').textContent='asked '+Math.round((Date.now()-info.createdAt)/60000)+' min ago';}
      render(info.status);showReport(info.report);
      if(info.status==='ringing')poll=setInterval(refresh,3000);
    }
    /* while ringing, just watch the status */
    async function refresh(){
      if(call||danisa)return clearInterval(poll);
      try{const d=await (await fetch(API+'/handoff/info?r='+r+'&k='+k)).json();if(d.status&&d.status!=='ringing'){clearInterval(poll);render(d.status);}}catch(e){}
    }
    function connect(outStream,onOpen){
      call=RehabCall.start({wsUrl:API.replace(/^http/,'ws')+'/handoff/ws?r='+r+'&k='+k,iceServers:info.iceServers,role:'founder',stream:outStream,onOpen,
        onRemote:rs=>takeNotes('visitor',rs),
        onStatus:s=>{if(!['in-call','accepted','ended','ringing'].includes(s))render(s);},
        onConnected:()=>{talked=true;render('in-call');t0=Date.now();clock=setInterval(tick,500);tick();introduce();takeNotes('founder',stream);},
        onEnded:why=>{clearInterval(clock);notes.forEach(n=>n.close());notes=[];if(talked)afterCall();else{render(why);cleanup();}}
      });
    }
    function cleanup(){try{danisa&&danisa.close();}catch(e){}if(stream)stream.getTracks().forEach(t=>t.stop());}

    /* 1 — Danisa calls you */
    $('answer').onclick=async()=>{
      clearInterval(poll);
      try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});}
      catch(e){$('status').textContent='Please allow the microphone to answer.';return;}
      ctx=new (window.AudioContext||window.webkitAudioContext)();player=new RehabLive.Player(ctx);
      render('danisa');show('ringingBtns',false);
      try{
        live=await (await fetch(API+'/handoff/live?r='+r+'&k='+k)).json();
        if(!live.token)throw new Error(live.error||'no token');
        danisa=await RehabLive.open({token:live.token,ctx,stream,
          setup:{model:'models/'+live.model,
            generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Kore'}}}},
            systemInstruction:{parts:[{text:live.instructions}]},
            tools:[{functionDeclarations:[{name:'founder_decision',description:'Record whether the founder is free to talk to the visitor now.',
              parameters:{type:'OBJECT',properties:{free:{type:'BOOLEAN'},note:{type:'STRING',description:'Message for the visitor if he is not free'}},required:['free']}}]}]},
          onMessage:onDanisa});
        danisa.send({realtimeInput:{text:'(He has just picked up. Start.)'}});
      }catch(e){
        /* no voice? fall back to joining straight away */
        $('status').textContent='Danisa couldn’t connect — joining you directly.';join();
      }
    };
    function onDanisa(m){
      if(m.toolCall){
        const fc=(m.toolCall.functionCalls||[])[0];
        if(fc&&fc.name==='founder_decision'){decision={free:!!(fc.args&&fc.args.free),note:(fc.args&&fc.args.note)||''};setTimeout(act,7000);}
        danisa.send({toolResponse:{functionResponses:(m.toolCall.functionCalls||[]).map(f=>({id:f.id,name:f.name,response:{result:'ok'}}))}});
        return;
      }
      const sc=m.serverContent;if(!sc)return;
      if(sc.interrupted)player.stop();
      (sc.modelTurn&&sc.modelTurn.parts||[]).forEach(p=>{if(p.inlineData&&p.inlineData.data)player.play(p.inlineData.data);});
      if(sc.turnComplete&&decision){player.onIdle=act;if(!player.busy)act();}
    }
    function act(){
      if(!decision||!danisa)return;
      const d=decision;decision=null;player.onIdle=null;
      danisa.close();danisa=null;
      d.free?join():busy(d.note);
    }
    function busy(note){
      render('busy');stream.getTracks().forEach(t=>t.stop());
      connect(new MediaStream(),()=>call.send({t:'busy',note}));
    }

    /* 2 — you're free: join the visitor, Danisa introduces and takes notes */
    function join(){
      render('accepted');
      const out=ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(stream).connect(out);
      ctx.out=out;
      connect(out.stream,()=>call.send({t:'accept'}));
    }
    async function introduce(){
      try{
        const d=await (await fetch(API+'/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:live.intro})})).json();
        const bytes=Uint8Array.from(atob(d.audio),c=>c.charCodeAt(0)).buffer;
        const buf=await ctx.decodeAudioData(bytes);
        const s=ctx.createBufferSource();s.buffer=buf;s.connect(ctx.out);s.connect(ctx.destination);s.start();
      }catch(e){}
    }
    async function takeNotes(who,s){
      if(!live||!live.token||!s)return;
      try{
        const n=await RehabLive.open({token:live.token,ctx,stream:s,
          setup:{model:'models/'+live.transcribeModel,inputAudioTranscription:{}},
          onMessage:m=>{const tx=m.serverContent&&m.serverContent.inputTranscription;if(tx&&tx.text&&tx.text.trim())transcript.push({who,text:tx.text.trim(),at:Date.now()-t0});},
          onClose:()=>{if(call&&talked&&document.body.dataset.s==='in-call')setTimeout(()=>takeNotes(who,s),500);}});
        notes.push(n);
      }catch(e){}
    }

    /* 3 — after the call: report to Telegram, then offer a spoken debrief */
    async function afterCall(){
      render('writing');
      let rep='';
      try{
        transcript.sort((a,b)=>a.at-b.at);
        const d=await (await fetch(API+'/handoff/report?r='+r+'&k='+k,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({transcript,seconds:Math.round((Date.now()-t0)/1000)})})).json();
        rep=d.report||'';
      }catch(e){}
      showReport(rep);
      if(!rep||!live||!live.token){render('done');cleanup();return;}
      render('debrief');
      try{
        danisa=await RehabLive.open({token:live.token,ctx,stream,
          setup:{model:'models/'+live.model,
            generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Kore'}}}},
            systemInstruction:{parts:[{text:'You are Danisa, the founder’s assistant at REHABION. His call with '+info.name+' just ended and you took notes. Here is your report:\n\n'+rep+
              '\n\nSpeak in a natural Pakistani Urdu–English mix unless he uses another language. First ask, in one short sentence, if he wants you to run through the main points (the full report is already on his Telegram). If yes, go through them briefly in spoken sentences — no emojis, no lists read out symbol by symbol — then answer any questions. If he says no or thanks, say goodbye warmly in one sentence and call end_debrief.'}]},
            tools:[{functionDeclarations:[{name:'end_debrief',description:'Finish the debrief when he is done or does not want it.',parameters:{type:'OBJECT',properties:{}}}]}]},
          onMessage:m=>{
            if(m.toolCall){danisa.send({toolResponse:{functionResponses:m.toolCall.functionCalls.map(f=>({id:f.id,name:f.name,response:{result:'ok'}}))}});
              player.onIdle=finish;setTimeout(finish,6000);return;}
            const sc=m.serverContent;if(!sc)return;
            if(sc.interrupted)player.stop();
            (sc.modelTurn&&sc.modelTurn.parts||[]).forEach(p=>{if(p.inlineData&&p.inlineData.data)player.play(p.inlineData.data);});
          }});
        danisa.send({realtimeInput:{text:'(The call just ended. Start.)'}});
      }catch(e){render('done');cleanup();}
    }
    function finish(){player&&player.stop();if(player)player.onIdle=null;render('done');cleanup();danisa=null;}

    $('busy').onclick=()=>{clearInterval(poll);const note=$('note').value.trim();stream=new MediaStream();connect(stream,()=>call.send({t:'busy',note}));};
    $('skip').onclick=finish;
    $('end').onclick=()=>{call&&call.hangup();};
    $('mute').onclick=()=>{muted=!muted;stream&&stream.getAudioTracks().forEach(t=>t.enabled=!muted);$('mute').textContent=muted?'Unmute':'Mute';};
    load();
  }
})();

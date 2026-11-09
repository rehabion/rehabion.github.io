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

  /* ── answering one request ── */
  function answerScreen(){
    show('callCard',true);
    const say=(s,txt)=>{document.body.dataset.s=s;$('status').textContent=txt;};
    let info=null,call=null,stream=null,t0=0,clock=0,muted=false,poll=0;
    const TEXT={
      ringing:'Ringing — they are waiting on the website.',
      accepted:'Connecting…','in-call':'',
      busy:'You said you’re busy — they’ve been told you’ll get back to them.',
      missed:'Missed — they waited but the call wasn’t answered.',
      cancelled:'They hung up before you answered.',left:'They left the website before you answered.',
      ended:'Call ended.',failed:'The connection failed — their network may be blocking calls.',disconnected:'Disconnected.'
    };
    function render(status){
      say(status,TEXT[status]||status);
      show('ringingBtns',status==='ringing');show('note',status==='ringing');
      show('callBtns',status==='accepted'||status==='in-call');
      if(['missed','cancelled','left'].includes(status)&&info&&info.contact)$('status').textContent+=' You can reach them yourself at the contact above.';
    }
    function tick(){const s=Math.floor((Date.now()-t0)/1000);$('status').innerHTML='<span class="timer">'+String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')+'</span>';}
    async function load(){
      try{const res=await fetch(API+'/handoff/info?r='+r+'&k='+k);info=await res.json();if(!res.ok)throw new Error(info.error);}
      catch(e){$('who').textContent='This request has expired.';say('error','');show('ringingBtns',false);return;}
      $('who').textContent=info.name;$('initial').textContent=(info.name||'?').trim().charAt(0).toUpperCase();
      if(info.reason||info.contact){show('about',true);$('reason').textContent=info.reason||'—';}
      if(info.contact){show('contactLbl',true);show('contact',true);$('contact').textContent=info.contact;}
      const mins=Math.round((Date.now()-info.createdAt)/60000);
      $('kicker').textContent=mins<1?'someone wants to talk to you':'asked '+mins+' min ago';
      render(info.status);
      if(info.status==='ringing')poll=setInterval(refresh,3000);
    }
    /* while ringing, just watch the status; connect only when answering */
    async function refresh(){
      if(call)return clearInterval(poll);
      try{const d=await (await fetch(API+'/handoff/info?r='+r+'&k='+k)).json();if(d.status&&d.status!=='ringing'){clearInterval(poll);render(d.status);}}catch(e){}
    }
    function connect(onOpen){
      call=RehabCall.start({wsUrl:API.replace(/^http/,'ws')+'/handoff/ws?r='+r+'&k='+k,iceServers:info.iceServers,role:'founder',stream,onOpen,
        onStatus:s=>{if(s!=='in-call'&&s!=='accepted')render(s);},
        onConnected:()=>{render('in-call');t0=Date.now();clock=setInterval(tick,500);tick();},
        onEnded:why=>{clearInterval(clock);if(stream)stream.getTracks().forEach(t=>t.stop());render(why);}
      });
    }
    $('answer').onclick=async()=>{
      try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});}
      catch(e){$('status').textContent='Please allow the microphone to answer.';return;}
      clearInterval(poll);render('accepted');
      connect(()=>call.send({t:'accept'}));
    };
    $('busy').onclick=()=>{clearInterval(poll);const note=$('note').value.trim();stream=new MediaStream();connect(()=>call.send({t:'busy',note}));};
    $('end').onclick=()=>{call&&call.hangup();};
    $('mute').onclick=()=>{muted=!muted;call&&call.mute(muted);$('mute').textContent=muted?'Unmute':'Mute';};
    load();
  }
})();

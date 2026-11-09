/* Founder side of "talk to the founder": opened from the WhatsApp / Telegram link. */
(function(){
  const API=window.REHABION_AI_ENDPOINT||'https://rehabion-ai.rehabion.workers.dev';
  const h=new URLSearchParams(location.hash.slice(1)),r=h.get('r'),k=h.get('k');
  const $=id=>document.getElementById(id);
  const say=(s,txt)=>{document.body.dataset.s=s;$('status').textContent=txt;};
  const show=(id,on)=>$(id).classList.toggle('hidden',!on);
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
    show('ringingBtns',status==='ringing');
    show('note',status==='ringing');
    show('callBtns',status==='accepted'||status==='in-call');
    if(['missed','cancelled','left'].includes(status)&&info&&info.contact)
      $('status').textContent+=' You can reach them yourself at the contact above.';
  }
  function tick(){const s=Math.floor((Date.now()-t0)/1000);$('status').innerHTML='<span class="timer">'+String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')+'</span>';}

  async function load(){
    if(!r||!k){$('who').textContent='This link is incomplete.';say('error','');show('ringingBtns',false);return;}
    try{
      const res=await fetch(API+'/handoff/info?r='+r+'&k='+k);
      info=await res.json();if(!res.ok)throw new Error(info.error);
    }catch(e){$('who').textContent='This request has expired.';say('error','');show('ringingBtns',false);return;}
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

  function wsUrl(){return API.replace(/^http/,'ws')+'/handoff/ws?r='+r+'&k='+k;}
  function connect(onOpen){
    call=RehabCall.start({wsUrl:wsUrl(),iceServers:info.iceServers,role:'founder',stream,onOpen,
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
  $('busy').onclick=()=>{
    clearInterval(poll);
    const note=$('note').value.trim();
    stream=new MediaStream();
    connect(()=>{call.send({t:'busy',note});});
  };
  $('end').onclick=()=>{call&&call.hangup();};
  $('mute').onclick=()=>{muted=!muted;call&&call.mute(muted);$('mute').textContent=muted?'Unmute':'Mute';};

  load();
})();

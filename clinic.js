/* Patient side of Danisa the clinic receptionist — clinic.html?c=<clinic id>
   Voice (Gemini Live, locked pass) or text; bookings and red flags are handled by the worker. */
(function(){
  if(top!==self){try{top.location=self.location;}catch(e){}return;}
  const $=id=>document.getElementById(id);
  const slug=(new URLSearchParams(location.search).get('c')||'').toLowerCase();
  const API=RehabPass.API;
  let cfg=null,call=null,history=[],busy=false;

  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const md=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
  function add(who,text){const d=document.createElement('div');d.className='msg '+who;d.innerHTML=md(text);$('log').appendChild(d);$('log').scrollTop=1e9;return d;}

  async function load(){
    if(!slug){$('name').textContent='Clinic not found';$('where').textContent='This link is missing the clinic id.';return;}
    try{
      const r=await fetch(API+'/clinic/info?c='+encodeURIComponent(slug));cfg=await r.json();
      if(!r.ok)throw new Error(cfg.error);
    }catch(e){$('name').textContent='Clinic not found';$('where').textContent='Please check the link with your clinic.';$('form').classList.add('hidden');$('orb').classList.add('hidden');return;}
    document.title=cfg.name+' · Danisa';
    $('name').textContent=cfg.name;
    $('where').textContent=[cfg.address,cfg.city].filter(Boolean).join(', ')+(cfg.phone?' · '+cfg.phone:'');
    $('hours').textContent=todayHours();
    $('demo').classList.toggle('hidden',!cfg.demo);
    $('services').innerHTML=(cfg.services||[]).map(s=>'<span class="tag">'+esc(s)+'</span>').join('');
    $('therapists').innerHTML=(cfg.therapists||[]).map(t=>'<span class="tag"><b>'+esc(t.name)+'</b>'+(t.specialty?' · '+esc(t.specialty):'')+'</span>').join('');
    $('fees').textContent=cfg.fees||'';
    add('her',"Assalam o Alaikum! I'm **Danisa**, "+cfg.name+"'s receptionist. I can book, change or cancel an appointment, or answer questions about the clinic. Tap the circle to talk, or type below.");
    RehabPass.get();
  }
  function todayHours(){
    const d=['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()],h=cfg.hours&&cfg.hours[d];
    const f=x=>{const hh=Math.floor(x),mm=Math.round((x-hh)*60);return ((hh+11)%12+1)+(mm?':'+String(mm).padStart(2,'0'):'')+(hh<12?' am':' pm');};
    return h?'Open today '+f(h[0])+'–'+f(h[1]):'Closed today';
  }

  function showBooking(b){
    $('bkWhen').textContent=b.when;$('bkWith').textContent='with '+b.therapist;$('bkCode').textContent=b.code;
    $('bkWhere').textContent=b.address||'';$('booked').classList.remove('hidden');
    if(b.advice)add('her','⚠️ '+b.advice);
  }
  function showEmergency(advice){
    if(advice)$('emText').textContent=advice;
    $('emergency').classList.remove('hidden');$('emergency').scrollIntoView({behavior:'smooth',block:'center'});
  }

  /* text */
  $('form').onsubmit=async e=>{
    e.preventDefault();
    const text=$('text').value.trim();if(!text||busy||!cfg)return;
    busy=true;$('sendBtn').disabled=true;$('text').value='';
    add('me',text);history.push({role:'user',content:text});
    const typing=add('her','…');typing.classList.add('typing');
    try{
      const d=await RehabPass.post('/clinic/chat',{c:slug,messages:history});
      typing.remove();add('her',d.reply);history.push({role:'assistant',content:d.reply});
      if(d.booking)showBooking(d.booking);
      if(d.emergency)showEmergency();
    }catch(err){typing.remove();add('her',err.status===429?'Lots of people are talking to me right now — please try again in a minute.':'Sorry, I couldn’t connect. Please try again.');history.pop();}
    busy=false;$('sendBtn').disabled=false;$('text').focus();
  };

  /* voice — Danisa's tools run on the worker, the page only passes them through */
  let lineMe=null,lineHer=null;
  async function startCall(){
    if(call||!cfg)return;
    if(!navigator.mediaDevices||!window.AudioWorkletNode){$('status').textContent='This browser can’t use the microphone here — please type instead.';return;}
    call=await RehabVoice.start({path:'/clinic/live',body:{c:slug},
      kickoff:history.length?'(The caller has been typing to you already — continue from that: '+history.slice(-4).map(m=>m.role+': '+m.content).join(' | ').slice(0,800)+')':undefined,
      onTool:async(name,args)=>{
        const out=await RehabPass.post('/clinic/tool',{c:slug,name,args});
        if(out.booked)showBooking(out);
        if(out.emergency)showEmergency(out.advice);
        return out;
      },
      onText:(who,text,done)=>{
        if(who==='me'){if(!lineMe)lineMe=add('me','');lineMe.textContent=text.trim();if(done){history.push({role:'user',content:text.trim()});lineMe=null;}}
        else{if(!lineHer)lineHer=add('her','');lineHer.textContent=text.trim();if(done){history.push({role:'assistant',content:text.trim()});lineHer=null;}}
        $('log').scrollTop=1e9;
      },
      onState:(s,why)=>{
        document.body.dataset.v=s==='connecting'?'connecting':s==='live'?'live':'idle';
        $('callBtns').classList.toggle('hidden',s!=='live');
        $('status').textContent=s==='connecting'?'Connecting…':s==='live'?'Listening — just talk.':s==='error'?
          (why==='mic'?'Please allow the microphone, then tap again.':why==='busy'?'Lots of calls right now — please type, or try again shortly.':'The call couldn’t start — please type instead, or try again.'):'Call ended. Tap to talk again.';
        if(s==='ended'||s==='error'){call=null;lineMe=lineHer=null;$('orb').innerHTML='Talk to<br>Danisa';}
        if(s==='live')$('orb').innerHTML='Listening…';
      }});
  }
  $('orb').onclick=()=>{if(call)call.end();else startCall();};
  $('orb').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('orb').click();}};
  $('end').onclick=()=>call&&call.end();
  $('mute').onclick=()=>{if(call)$('mute').textContent=call.mute()?'Unmute':'Mute';};
  load();
})();

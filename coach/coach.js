/* Patient's home-exercise coach — coach/#c=<clinic>&p=<patient>&k=<key>
   Danisa coaches by voice using the therapist's plan and the patient's measured range of motion. */
(function(){
  if(top!==self){try{top.location=self.location;}catch(e){}return;}
  const $=id=>document.getElementById(id);
  const API=RehabPass.API;
  const h=new URLSearchParams(location.hash.slice(1)),c=h.get('c'),p=h.get('p'),k=h.get('k');
  const qs='?c='+encodeURIComponent(c||'')+'&p='+encodeURIComponent(p||'')+'&k='+encodeURIComponent(k||'');
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]));
  let info=null,call=null,logged=false;

  function idb(op,key,val){
    return new Promise((res,rej)=>{
      const open=indexedDB.open('rehabion-coach',1);
      open.onupgradeneeded=()=>open.result.createObjectStore('kv');
      open.onerror=()=>rej(open.error);
      open.onsuccess=()=>{const st=open.result.transaction('kv',op==='get'?'readonly':'readwrite').objectStore('kv');
        const r=op==='get'?st.get(key):st.put(val,key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);};
    });
  }
  const swReady=('serviceWorker' in navigator)?navigator.serviceWorker.register('sw.js'):Promise.reject(new Error('no sw'));
  swReady.catch(()=>{});

  async function load(){
    try{const r=await fetch(API+'/coach/info'+qs);info=await r.json();if(!r.ok)throw new Error(info.error);}
    catch(e){$('bad').classList.remove('hidden');if(e.message)$('badMsg').textContent=e.message;return;}
    $('app').classList.remove('hidden');
    $('clinic').textContent=info.clinic;
    $('hello').textContent='Assalam o Alaikum, '+info.name;
    idb('put','link',location.href).catch(()=>{});idb('put','name',info.name).catch(()=>{});
    renderWeek();renderPlan();
    $('hour').innerHTML=Array.from({length:17},(_,i)=>i+6).map(x=>'<option value="'+x+'"'+(x===(info.reminderHour??18)?' selected':'')+'>'+((x+11)%12+1)+(x<12?' am':' pm')+'</option>').join('');
    $('remindMsg').textContent=info.reminders?'✓ On — this phone reminds you every day at that time (unless you’ve already done it).':'Get a gentle reminder on this phone every day.';
    if(info.doneToday){$('saved').classList.remove('hidden');$('status').textContent='You’ve done today’s session — well done! You can do another one any time.';}
    RehabPass.get();
  }
  function renderWeek(){
    $('week').innerHTML=Array.from({length:7},(_,i)=>'<span class="'+(i<info.week?'on':'')+'">'+(i<info.week?'✓':'')+'</span>').join('');
    $('weekText').textContent=info.week+' of 7 days this week'+(info.week>=5?' — brilliant!':info.week>=3?' — keep going!':'');
  }
  function renderPlan(){
    $('plan').innerHTML=info.plan.map(x=>{
      const r=x.readings,last=r.length?r[r.length-1]:null,first=r.length?r[0]:null;
      return '<div class="ex"><b>'+esc(x.label)+'</b><p class="muted">'+x.reps+' reps × '+x.sets+' sets, '+x.perDay+'× a day</p>'+
        (last?'<p>Last measured: <b>'+last.value+x.unit+'</b>'+(first&&first!==last?' (started at '+first.value+x.unit+')':'')+'</p>':'')+
        (x.goal?'<p class="muted">Today’s goal</p><p class="goal">'+x.goal+x.unit+'</p>':'')+
        (x.targetDeg?'<p class="muted">Your physiotherapist’s target: '+x.targetDeg+x.unit+'</p>':'')+'</div>';
    }).join('')||'<p class="muted">Your physiotherapist hasn’t added exercises yet.</p>';
  }

  let lineMe=null,lineHer=null;
  const add=(who,text)=>{const d=document.createElement('div');d.className='msg '+who;d.textContent=text;$('log').appendChild(d);$('log').scrollTop=1e9;return d;};
  async function startCall(){
    if(call||!info)return;
    call=await RehabVoice.start({path:'/coach/live'+qs,body:{},kickoff:'(The patient just tapped start. Greet them by name.)',
      onTool:async(name,args)=>{
        if(name!=='log_session')return {error:'unknown'};
        const res=await fetch(API+'/coach/log'+qs,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
        const d=await res.json();
        if(d.saved){logged=true;info.week=d.week;renderWeek();$('saved').classList.remove('hidden');}
        return d;
      },
      onText:(who,text,done)=>{
        if(who==='me'){if(!lineMe)lineMe=add('me','');lineMe.textContent=text.trim();if(done)lineMe=null;}
        else{if(!lineHer)lineHer=add('her','');lineHer.textContent=text.trim();if(done)lineHer=null;}
      },
      onState:(s,why)=>{
        document.body.dataset.v=s==='connecting'?'connecting':s==='live'?'live':'idle';
        $('callBtns').classList.toggle('hidden',s!=='live');
        $('status').textContent=s==='connecting'?'Connecting…':s==='live'?'Danisa is with you — just talk.':s==='error'?
          (why==='mic'?'Please allow the microphone, then tap again.':why==='busy'?'Danisa is busy right now — please try again in a few minutes.':'Couldn’t connect — please check your internet and try again.'):
          (logged?'Session saved. See you tomorrow!':'Ended. Tap to start again.');
        $('orb').innerHTML=s==='live'?'Listening…':'Start with<br>Danisa';
        if(s==='ended'||s==='error'){call=null;lineMe=lineHer=null;}
      }});
  }
  $('orb').onclick=()=>{if(call)call.end();else startCall();};
  $('orb').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('orb').click();}};
  $('end').onclick=()=>call&&call.end();
  $('mute').onclick=()=>{if(call)$('mute').textContent=call.mute()?'Unmute':'Mute';};

  /* daily reminder: our own Web Push, no app or account */
  const b64=s=>{const pad='='.repeat((4-s.length%4)%4),raw=atob((s+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,ch=>ch.charCodeAt(0));};
  $('remindBtn').onclick=async()=>{
    const msg=$('remindMsg');
    try{
      if(!('PushManager' in window))throw new Error(/iphone|ipad/i.test(navigator.userAgent)?'On iPhone: tap Share → Add to Home Screen, open it from there, then tap Remind me.':'This browser can’t show reminders — try Chrome.');
      if(await Notification.requestPermission()!=='granted')throw new Error('Please allow notifications to get reminders.');
      const reg=await swReady;await navigator.serviceWorker.ready;
      const {key}=await (await fetch(API+'/push/vapid')).json();
      let sub=await reg.pushManager.getSubscription();
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(key)});
      const d=await (await fetch(API+'/coach/push'+qs,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub.toJSON(),hour:Number($('hour').value)})})).json();
      if(!d.saved)throw new Error(d.error||'Could not save.');
      msg.textContent='✓ On — this phone will remind you every day at '+$('hour').selectedOptions[0].textContent+'.';
    }catch(e){msg.textContent=e.message;}
  };
  load();
})();

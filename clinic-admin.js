/* Clinic staff app — clinic-admin.html?c=<clinic id>
   Today (bookings, call-backs, red flags) · Patients & home-exercise coach · SOAP scribe · Settings · Numbers */
(function(){
  if(top!==self){try{top.location=self.location;}catch(e){}return;}
  const API=window.REHABION_AI_ENDPOINT||'https://rehabion-ai.rehabion.workers.dev';
  const SITE=location.origin+location.pathname.replace(/[^/]*$/,'');
  const $=id=>document.getElementById(id);
  const show=(id,on)=>$(id).classList.toggle('hidden',!on);
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const store={get:k=>{try{return sessionStorage.getItem(k);}catch(e){return null;}},set:(k,v)=>{try{v===null?sessionStorage.removeItem(k):sessionStorage.setItem(k,v);}catch(e){}}};
  const q=new URLSearchParams(location.search);
  let slug=(q.get('c')||store.get('clinic')||'').toLowerCase(),token=slug&&store.get('tok:'+slug),data=null,current=null;

  async function call(path,body){
    const res=await fetch(API+path,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},token?{'X-Clinic-Token':token}:{}),body:JSON.stringify(Object.assign({c:slug},body))});
    let d={};try{d=await res.json();}catch(e){}
    if(res.status===401){logout();throw new Error('Please log in again.');}
    if(!res.ok)throw new Error(d.error||('HTTP '+res.status));
    return d;
  }
  const staff=(action,body)=>call('/clinic/staff',Object.assign({action},body));

  /* ── login / create ── */
  function loginScreen(){
    show('main',false);show('logout',false);show('create',false);show('login',true);
    $('lgClinic').value=slug||'';
    if(q.get('new')==='1'){show('login',false);show('create',true);}
  }
  $('toCreate').onclick=()=>{show('login',false);show('create',true);};
  $('toLogin').onclick=()=>{show('create',false);show('login',true);};
  $('lgGo').onclick=async()=>{
    $('lgErr').textContent='';slug=$('lgClinic').value.trim().toLowerCase();
    try{
      const d=await call('/clinic/login',{pin:$('lgPin').value.trim(),founder:$('lgFounder').checked});
      token=d.token;store.set('clinic',slug);store.set('tok:'+slug,token);$('lgPin').value='';
      history.replaceState(null,'','?c='+encodeURIComponent(slug));start();
    }catch(e){$('lgErr').textContent=e.message;}
  };
  $('lgPin').onkeydown=e=>{if(e.key==='Enter')$('lgGo').click();};
  $('crGo').onclick=async()=>{
    $('crErr').textContent='';show('crDone',false);
    try{
      const s=$('crSlug').value.trim().toLowerCase();
      const res=await fetch(API+'/clinic/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:$('crPin').value.trim(),c:s,name:$('crName').value.trim(),demo:$('crDemo').checked})});
      const d=await res.json();if(!res.ok)throw new Error(d.error);
      $('crDone').innerHTML='Created ✓<br>Staff PIN: <b>'+esc(d.pin)+'</b> (write it down — it isn’t shown again)<br>Patients: <code>'+esc(SITE+'clinic.html?c='+d.slug)+'</code><br>Staff: <code>'+esc(SITE+'clinic-admin.html?c='+d.slug)+'</code>';
      show('crDone',true);slug=d.slug;$('lgClinic').value=d.slug;
    }catch(e){$('crErr').textContent=e.message;}
  };
  function logout(){token=null;store.set('tok:'+slug,null);loginScreen();}
  $('logout').onclick=logout;

  /* ── main ── */
  async function start(){
    show('login',false);show('create',false);show('main',true);show('logout',true);
    await refresh();setInterval(()=>{if(!document.hidden&&tab==='today')refresh();},30000);
  }
  async function refresh(){
    try{data=await staff('get');}catch(e){return;}
    $('cName').textContent=data.cfg.name;
    const link=SITE+'clinic.html?c='+slug;
    $('cLink').innerHTML='Patients talk to Danisa at <a href="'+esc(link)+'" target="_blank" rel="noopener">'+esc(link.replace(/^https?:\/\//,''))+'</a> · <button class="link" id="copyLink">copy link</button>';
    $('copyLink').onclick=()=>copy(link,$('copyLink'));
    renderToday();renderPatients();renderSettings();renderNumbers();fillPatientSelect();
  }
  function copy(text,btn){navigator.clipboard&&navigator.clipboard.writeText(text).then(()=>{const o=btn.textContent;btn.textContent='copied ✓';setTimeout(()=>btn.textContent=o,1500);});}

  let tab='today';
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{
    tab=b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-selected',x===b));
    document.querySelectorAll('[data-pane]').forEach(p=>p.classList.toggle('hidden',p.dataset.pane!==tab));
  });

  const ago=t=>{const m=Math.round((Date.now()-t)/60000);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago';};
  const tel=p=>p?'<a href="tel:'+esc(p)+'">'+esc(p)+'</a>':'';

  function renderToday(){
    const f=data.flags.filter(x=>x.at>Date.now()-7*864e5);
    $('flags').innerHTML=f.length?f.map(x=>'<div class="item"><span class="pill red">🚨</span><div><b>'+esc(x.summary)+'</b><span class="sub">'+ago(x.at)+(x.phone?' · '+tel(x.phone):'')+' · '+esc(x.source)+'</span></div></div>').join(''):'<p class="muted">None this week.</p>';
    const cb=data.callbacks.filter(x=>!x.done);
    $('callbacks').innerHTML=cb.length?'':'<p class="muted">Nothing waiting.</p>';
    cb.forEach(x=>{
      const el=document.createElement('div');el.className='item';
      el.innerHTML='<div><b>'+esc(x.name||'Patient')+' · '+tel(x.phone)+'</b><span class="sub">'+esc(x.reason)+' · '+ago(x.at)+'</span></div><button class="small">Done</button>';
      el.querySelector('button').onclick=async()=>{await staff('callback-done',{id:x.id});refresh();};
      $('callbacks').appendChild(el);
    });
    const list=data.bookings.slice().sort((a,b)=>a.start-b.start),now=Date.now();
    const up=list.filter(b=>b.start>now-3*3600e3),past=list.filter(b=>b.start<=now-3*3600e3).reverse();
    $('bookings').innerHTML=up.length||past.length?'':'<p class="muted">No appointments yet. Share the patient link above — Danisa books into your hours.</p>';
    const add=(b,head)=>{
      if(head){const h=document.createElement('h3');h.textContent=head;$('bookings').appendChild(h);}
      const el=document.createElement('div');el.className='item';
      const tri=b.triage==='urgent'?'<span class="pill amber">see doctor first</span>':b.checked?'<span class="pill green">screened</span>':'<span class="pill">not screened</span>';
      const st={booked:'',attended:'<span class="pill green">attended</span>','no-show':'<span class="pill red">no-show</span>',cancelled:'<span class="pill">cancelled</span>'}[b.status];
      el.innerHTML='<div><b>'+esc(b.when)+' · '+esc(b.name)+'</b><span class="sub">'+esc(b.therapist)+' · '+tel(b.phone)+' · code '+esc(b.code)+'</span>'+
        '<span class="sub">🩺 '+esc(b.complaint)+(b.pain!=null?' · pain '+b.pain+'/10':'')+'</span><span class="sub">'+tri+' '+(st||'')+'</span></div>'+
        (b.status==='booked'?'<div class="row" style="flex:0 0 auto"><button class="small" data-s="attended">Came</button><button class="small" data-s="no-show">No-show</button><button class="small" data-s="cancelled">Cancel</button></div>':'');
      el.querySelectorAll('[data-s]').forEach(x=>x.onclick=async()=>{await staff('booking',{id:b.id,status:x.dataset.s});refresh();});
      $('bookings').appendChild(el);
    };
    let last='';
    up.forEach(b=>{const d=b.when.split(',')[0];add(b,d!==last?d:'');last=d;});
    if(past.length){past.forEach((b,i)=>add(b,i?'':'Earlier this week'));}
  }

  /* ── patients & coach ── */
  const exName=id=>(data.exercises[id]||{label:id.replace(/_/g,' ')}).label;
  const exUnit=id=>(data.exercises[id]||{unit:''}).unit;
  function renderPatients(){
    const box=$('patients');
    box.innerHTML=data.patients.length?'':'<p class="muted" style="margin-top:10px">No patients yet.</p>';
    data.patients.forEach(p=>{
      const el=document.createElement('div');el.className='item';
      const last=p.last?(p.last.source==='coach'?'home session '+ago(p.last.at):exName(p.last.exercise)+' '+p.last.value+exUnit(p.last.exercise)+' · '+ago(p.last.at)):'no data yet';
      el.innerHTML='<div><b>'+esc(p.name)+'</b><span class="sub">'+esc(p.condition||'')+'</span><span class="sub">'+'●'.repeat(p.adherence)+'○'.repeat(7-p.adherence)+' '+p.adherence+'/7 days · '+esc(last)+'</span></div>'+
        (p.alerts?'<span class="pill red">'+p.alerts+' alert'+(p.alerts>1?'s':'')+'</span>':'')+'<button class="small">Open</button>';
      el.querySelector('button').onclick=()=>openPatient(p.id);
      box.appendChild(el);
    });
  }
  function hourOptions(sel){
    $('pfHour').innerHTML='<option value="">No reminder</option>'+Array.from({length:17},(_,i)=>i+6).map(h=>'<option value="'+h+'"'+(h===sel?' selected':'')+'>'+((h+11)%12+1)+(h<12?' am':' pm')+'</option>').join('');
  }
  function planRow(e){
    e=e||{exercise:'shoulder_abduction',reps:10,sets:2,perDay:1,targetDeg:'',stepDeg:3};
    const el=document.createElement('div');el.className='plan-row';
    const opts=Object.entries(data.exercises).map(([k,v])=>'<option value="'+k+'"'+(k===e.exercise?' selected':'')+'>'+esc(v.label)+' ('+v.source+')</option>').join('');
    el.innerHTML='<div><label>Exercise</label><select data-k="exercise">'+opts+'</select></div>'+
      '<div><label>Reps</label><input data-k="reps" inputmode="numeric" value="'+esc(e.reps)+'"></div><div><label>Sets</label><input data-k="sets" inputmode="numeric" value="'+esc(e.sets)+'"></div>'+
      '<div><label>Per day</label><input data-k="perDay" inputmode="numeric" value="'+esc(e.perDay)+'"></div><div><label>Target</label><input data-k="targetDeg" inputmode="numeric" value="'+esc(e.targetDeg||'')+'" placeholder="120"></div>'+
      '<div><label>Step / day</label><input data-k="stepDeg" inputmode="numeric" value="'+esc(e.stepDeg||3)+'"></div><button class="small x" title="Remove">✕</button>';
    if(!data.exercises[e.exercise]){const o=document.createElement('option');o.value=e.exercise;o.textContent=e.exercise;o.selected=true;el.querySelector('select').appendChild(o);}
    el.querySelector('.x').onclick=()=>el.remove();
    $('pfPlan').appendChild(el);
  }
  function patientForm(p){
    current=p||null;
    $('pfTitle').textContent=p?'Edit '+p.name:'Add patient';
    $('pfName').value=p?p.name:'';$('pfPhone').value=p?p.phone||'':'';$('pfCond').value=p?p.condition||'':'';
    $('pfTher').innerHTML=data.cfg.therapists.map(t=>'<option value="'+t.id+'"'+(p&&p.therapistId===t.id?' selected':'')+'>'+esc(t.name)+'</option>').join('');
    hourOptions(p?p.reminderHour:18);
    $('pfPlan').innerHTML='';(p&&p.plan.length?p.plan:[null]).forEach(planRow);
    show('pList',false);show('pView',false);show('pForm',true);$('pfErr').textContent='';
  }
  $('pAdd').onclick=()=>patientForm(null);
  $('pfAddEx').onclick=()=>planRow();
  $('pfCancel').onclick=()=>{show('pForm',false);show(current?'pView':'pList',true);};
  $('pfSave').onclick=async()=>{
    const plan=[...$('pfPlan').children].map(r=>{const o={};r.querySelectorAll('[data-k]').forEach(i=>o[i.dataset.k]=i.value);return o;});
    try{
      const d=await staff('patient-save',{patient:{id:current&&current.id,name:$('pfName').value,phone:$('pfPhone').value,condition:$('pfCond').value,therapistId:$('pfTher').value,
        reminderHour:$('pfHour').value===''?null:Number($('pfHour').value),plan}});
      show('pForm',false);await refresh();openPatient(d.id);
    }catch(e){$('pfErr').textContent=e.message;}
  };

  function spark(readings,goal,target,unit){
    if(!readings.length)return '<p class="muted">No measurements yet.</p>';
    const W=600,H=70,vals=readings.map(r=>r.value).concat(goal?[goal]:[]),lo=Math.min(...vals)-5,hi=Math.max(...vals,target||0)+5;
    const x=i=>readings.length<2?W/2:8+i*(W-16)/(readings.length-1),y=v=>H-6-(v-lo)/(hi-lo||1)*(H-12);
    const pts=readings.map((r,i)=>x(i).toFixed(1)+','+y(r.value).toFixed(1)).join(' ');
    return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="progress">'+
      (target?'<line x1="0" x2="'+W+'" y1="'+y(target)+'" y2="'+y(target)+'" stroke="#2E5946" stroke-dasharray="4 4" stroke-width="1"/>':'')+
      '<polyline points="'+pts+'" fill="none" stroke="#C2522F" stroke-width="2.5" vector-effect="non-scaling-stroke"/>'+
      readings.map((r,i)=>'<circle cx="'+x(i)+'" cy="'+y(r.value)+'" r="3.5" fill="#C2522F"><title>'+r.value+unit+' · '+new Date(r.at).toLocaleDateString()+'</title></circle>').join('')+'</svg>'+
      '<p class="muted">Latest '+readings[readings.length-1].value+unit+(goal?' · next goal '+goal+unit:'')+(target?' · target '+target+unit+' (dashed)':'')+'</p>';
  }
  async function openPatient(id){
    let d;try{d=await staff('patient',{id});}catch(e){return;}
    const p=d.patient;current=p;
    show('pList',false);show('pForm',false);show('pView',true);
    const th=data.cfg.therapists.find(t=>t.id===p.therapistId);
    const game=API+'/coach/data?c='+slug+'&p='+p.id+'&k='+p.key;
    const coachSessions=p.sessions.filter(s=>s.source==='coach').slice(-10).reverse();
    $('pView').innerHTML='<button class="link" id="pvBack">← All patients</button><h2>'+esc(p.name)+'</h2>'+
      '<p class="muted">'+esc(p.condition||'')+(th?' · '+esc(th.name):'')+(p.phone?' · '+tel(p.phone):'')+' · reminder '+(p.reminderHour==null?'off':((p.reminderHour+11)%12+1)+(p.reminderHour<12?' am':' pm'))+(p.push?' (on their phone ✓)':' (not set up on their phone yet)')+'</p>'+
      '<div class="soft"><b>Coach link for '+esc(p.name)+'</b><p class="muted">Send this to the patient. It opens Danisa, their plan and their progress.</p><code id="pvLink">'+esc(d.link)+'</code>'+
      '<div class="row" style="margin-top:8px"><button class="small" id="pvCopy">Copy</button><a class="btn small" style="padding:6px 12px;min-height:34px;font-size:13.5px" target="_blank" rel="noopener" href="https://wa.me/'+(p.phone||'').replace(/\D/g,'').replace(/^0/,'92')+'?text='+encodeURIComponent('Assalam o Alaikum '+p.name+'! Your home exercises with Danisa from '+data.cfg.name+': '+d.link)+'">Send on WhatsApp</a></div></div>'+
      p.plan.map(x=>{const r=p.sessions.filter(s=>s.exercise===x.exercise&&typeof s.value==='number').slice(-20);
        return '<h3>'+esc(exName(x.exercise))+' — '+x.reps+' × '+x.sets+', '+x.perDay+'×/day</h3>'+spark(r,p.goals[x.exercise],x.targetDeg,exUnit(x.exercise));}).join('')+
      '<div class="row" style="margin-top:10px"><select id="pvEx" style="flex:1;min-width:150px">'+p.plan.map(x=>'<option value="'+x.exercise+'">'+esc(exName(x.exercise))+'</option>').join('')+'</select><input id="pvVal" inputmode="decimal" placeholder="value" style="width:100px"><button class="small" id="pvAddR">Add measurement</button></div>'+
      '<h3>Home sessions with Danisa</h3>'+(coachSessions.length?coachSessions.map(s=>'<div class="item"><span class="pill '+(s.concern?'red':s.done?'green':'')+'">'+(s.concern?'alert':s.done?'done':'skipped')+'</span><div><b>'+new Date(s.at).toLocaleString()+'</b><span class="sub">'+esc([s.exercises,s.painBefore!=null?'pain '+s.painBefore+'→'+(s.painAfter??'?'):'',s.concern,s.note].filter(Boolean).join(' · '))+'</span></div></div>').join(''):'<p class="muted">None yet.</p>')+
      '<h3>Saved session notes</h3>'+((p.notes||[]).length?p.notes.map(n=>'<details><summary>'+new Date(n.at).toLocaleString()+'</summary><pre class="note">'+esc(soapText(n.soap))+'</pre></details>').join(''):'<p class="muted">None yet — use “Session notes”.</p>')+
      '<details><summary>Connect the RBN-001 game</summary><p class="muted" style="margin-top:6px">The game sends each result here (POST, JSON):</p><code>'+esc(game)+'</code><pre class="note" style="margin-top:6px">{"exercise":"shoulder_abduction","value":92,"reps":10,"source":"RBN-001"}</pre></details>'+
      '<div class="row" style="margin-top:16px"><button id="pvEdit">Edit plan</button><button class="link" id="pvDel" style="color:var(--red)">Delete patient</button></div>';
    $('pvBack').onclick=()=>{show('pView',false);show('pList',true);current=null;};
    $('pvCopy').onclick=()=>copy(d.link,$('pvCopy'));
    $('pvEdit').onclick=()=>patientForm(p);
    $('pvAddR').onclick=async()=>{const v=Number($('pvVal').value);if(!v)return;await staff('reading',{id:p.id,exercise:$('pvEx').value,value:v});openPatient(p.id);refresh();};
    $('pvDel').onclick=async()=>{if(!confirm('Delete '+p.name+' and all their data?'))return;await staff('patient-delete',{id:p.id});show('pView',false);show('pList',true);current=null;refresh();};
  }

  /* ── SOAP scribe ── */
  const F=['subjective','objective','assessment','plan','home_exercises','follow_up'];
  function soapText(s){
    const L={subjective:'S — Subjective',objective:'O — Objective',assessment:'A — Assessment',plan:'P — Plan',home_exercises:'Home exercises',follow_up:'Follow-up',red_flags:'Red flags'};
    return Object.keys(L).filter(k=>s[k]&&(!Array.isArray(s[k])||s[k].length)).map(k=>L[k]+'\n'+(Array.isArray(s[k])?s[k].map(x=>'• '+x).join('\n'):s[k])).join('\n\n');
  }
  function fillPatientSelect(){
    const cur=$('sPatient').value;
    $('sPatient').innerHTML='<option value="">— none —</option>'+data.patients.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');
    $('sPatient').value=cur;
  }
  let rec=null,chunks=[],recStart=0,recTimer=0,audio=null,lastFlags=[];
  $('sRec').onclick=async()=>{
    $('sErr').textContent='';
    if(rec){rec.stop();return;}
    if(!$('sConsent').checked){$('sErr').textContent='Please confirm the patient agreed first.';return;}
    let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});}catch(e){$('sErr').textContent='Please allow the microphone.';return;}
    const type=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t))||'';
    rec=new MediaRecorder(stream,type?{mimeType:type,audioBitsPerSecond:32000}:{});chunks=[];audio=null;
    rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    rec.onstop=()=>{stream.getTracks().forEach(t=>t.stop());clearInterval(recTimer);audio=new Blob(chunks,{type:rec.mimeType});rec=null;$('sRec').textContent='● Record again';$('sRec').classList.add('go');$('sRec').classList.remove('stop');
      $('sTime').textContent+=' recorded ✓';};
    rec.start(1000);recStart=Date.now();show('sTime',true);
    $('sRec').textContent='■ Stop';$('sRec').classList.remove('go');$('sRec').classList.add('stop');
    recTimer=setInterval(()=>{const s=Math.floor((Date.now()-recStart)/1000);$('sTime').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');if(s>=45*60)rec&&rec.stop();},500);
  };
  const b64=blob=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(String(f.result).split(',')[1]);f.readAsDataURL(blob);});
  $('sGo').onclick=async()=>{
    $('sErr').textContent='';
    if(rec){$('sErr').textContent='Stop the recording first.';return;}
    if(!$('sConsent').checked){$('sErr').textContent='Please confirm the patient agreed first.';return;}
    const text=$('sText').value.trim();
    if(!audio&&!text){$('sErr').textContent='Record the session or paste some notes first.';return;}
    if(audio&&audio.size>14e6){$('sErr').textContent='That recording is too long — please split it.';return;}
    const pid=$('sPatient').value,p=data.patients.find(x=>x.id===pid);
    let device='',patient='';
    if(pid){try{const d=await staff('patient',{id:pid});const pp=d.patient;patient=pp.name+(pp.condition?' — '+pp.condition:'');
      device=pp.plan.map(x=>{const r=pp.sessions.filter(s=>s.exercise===x.exercise&&typeof s.value==='number').slice(-3);return r.length?exName(x.exercise)+': '+r.map(s=>s.value+exUnit(x.exercise)+' ('+new Date(s.at).toLocaleDateString()+', '+s.source+')').join(', '):'';}).filter(Boolean).join('; ');}catch(e){}}
    $('sGo').disabled=true;$('sGo').textContent='Danisa is writing…';
    try{
      const d=await call('/clinic/scribe',{consent:true,transcript:text||undefined,audio:audio?await b64(audio):undefined,mime:audio?audio.type:undefined,patient,device});
      const s=d.soap;lastFlags=s.red_flags||[];
      F.forEach(k=>$('s_'+k).value=Array.isArray(s[k])?s[k].join('\n'):(s[k]||''));
      $('sTranscript').textContent=s.transcript||'(no audio)';
      $('sHead').textContent='SOAP note'+(p?' — '+p.name:'')+' · '+new Date().toLocaleDateString();
      $('sFlags').innerHTML=(s.red_flags||[]).length?'🚨 Red flags mentioned: '+s.red_flags.map(esc).join(' · '):'';show('sFlags',(s.red_flags||[]).length>0);
      $('sMissing').textContent=(s.not_documented||[]).length?'Not documented: '+s.not_documented.join(' · '):'';
      show('sOut',true);show('sSave',!!pid);$('sMsg').textContent='';$('sOut').scrollIntoView({behavior:'smooth'});
    }catch(e){$('sErr').textContent=e.message;}
    $('sGo').disabled=false;$('sGo').textContent='Write SOAP note';
  };
  const current_soap=()=>{const o={};F.forEach(k=>o[k]=k==='home_exercises'?$('s_'+k).value.split('\n').map(x=>x.trim()).filter(Boolean):$('s_'+k).value);o.red_flags=lastFlags;return o;};
  $('sCopy').onclick=()=>copy($('sHead').textContent+'\n\n'+soapText(current_soap()),$('sCopy'));
  $('sPrint').onclick=()=>print();
  $('sSave').onclick=async()=>{try{await staff('note-save',{id:$('sPatient').value,soap:current_soap()});$('sMsg').textContent='Saved to the patient ✓';}catch(e){$('sMsg').textContent=e.message;}};

  /* ── settings ── */
  const toTime=h=>h==null?'':String(Math.floor(h)).padStart(2,'0')+':'+String(Math.round((h%1)*60)).padStart(2,'0');
  const fromTime=s=>{if(!s)return null;const [h,m]=s.split(':').map(Number);return h+m/60;};
  const DAYS=[['mon','Mon'],['tue','Tue'],['wed','Wed'],['thu','Thu'],['fri','Fri'],['sat','Sat'],['sun','Sun']];
  function therRow(t){
    const el=document.createElement('div');el.className='th-row';el.dataset.id=t&&t.id||'';
    el.innerHTML='<input data-k="name" placeholder="Dr. Ayesha Khan (DPT)" value="'+esc(t&&t.name)+'"><input data-k="specialty" placeholder="stroke & neuro rehab" value="'+esc(t&&t.specialty)+'"><button class="small">✕</button>';
    el.querySelector('button').onclick=()=>el.remove();$('gTher').appendChild(el);
  }
  function renderSettings(){
    if(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('[data-pane="settings"]'))return;   // don't wipe what they're typing
    const c=data.cfg;
    $('gName').value=c.name;$('gCity').value=c.city||'';$('gAddr').value=c.address||'';$('gPhone').value=c.phone||'';$('gFees').value=c.fees||'';
    $('gServices').value=(c.services||[]).join(', ');$('gFaq').value=c.faq||'';$('gSlot').value=String(c.slotMinutes);
    $('gHours').innerHTML=DAYS.map(([k,l])=>{const h=c.hours[k];return '<div class="hours-row"><b>'+l+'</b><label class="check" style="margin:0"><input type="checkbox" data-d="'+k+'"'+(h?' checked':'')+'> open</label><input type="time" data-o="'+k+'" value="'+toTime(h?h[0]:9)+'"><input type="time" data-c="'+k+'" value="'+toTime(h?h[1]:17)+'"></div>';}).join('');
    $('gBreak1').value=c.break?toTime(c.break[0]):'';$('gBreak2').value=c.break?toTime(c.break[1]):'';
    $('gTher').innerHTML='';c.therapists.forEach(therRow);
    $('tgState').textContent=c.telegram?'✓ Linked — bookings, call-backs, red flags and patient alerts go to your team’s Telegram.':'Not linked yet — messages go to REHABION during the pilot. Link your own Telegram (a person or a group) here.';
  }
  $('gAddTher').onclick=()=>therRow(null);
  $('gSave').onclick=async()=>{
    const hours={};DAYS.forEach(([k])=>{hours[k]=document.querySelector('[data-d="'+k+'"]').checked?[fromTime(document.querySelector('[data-o="'+k+'"]').value),fromTime(document.querySelector('[data-c="'+k+'"]').value)]:null;});
    const b1=fromTime($('gBreak1').value),b2=fromTime($('gBreak2').value);
    const therapists=[...$('gTher').children].map(r=>({id:r.dataset.id||undefined,name:r.querySelector('[data-k=name]').value,specialty:r.querySelector('[data-k=specialty]').value})).filter(t=>t.name.trim());
    try{
      await staff('config',{cfg:{name:$('gName').value,city:$('gCity').value,address:$('gAddr').value,phone:$('gPhone').value,fees:$('gFees').value,faq:$('gFaq').value,
        services:$('gServices').value.split(','),slotMinutes:Number($('gSlot').value),hours,break:b1!=null&&b2!=null?[b1,b2]:null,therapists}});
      $('gMsg').style.color='var(--forest)';$('gMsg').textContent='Saved ✓ — Danisa uses this from the next conversation.';document.activeElement.blur();refresh();
    }catch(e){$('gMsg').style.color='';$('gMsg').textContent=e.message;}
  };
  $('tgLink').onclick=async()=>{try{const d=await staff('telegram-code');$('tgMsg').style.color='var(--muted)';
    $('tgMsg').innerHTML='<a class="btn small go" target="_blank" rel="noopener" href="'+esc(d.link)+'">Open Telegram</a> — press <b>Start</b> there, then tap “check”. (For a team group, add the bot to the group and send <code>/start '+esc(d.link.split('=')[1])+'</code>.)';}catch(e){$('tgMsg').textContent=e.message;}};
  $('tgCheck').onclick=async()=>{try{await staff('telegram-check');$('tgMsg').textContent='';refresh();}catch(e){$('tgMsg').textContent=e.message;}};
  $('pinSave').onclick=async()=>{try{await staff('pin',{newPin:$('newPin').value.trim()});$('newPin').value='';$('pinMsg').style.color='var(--forest)';$('pinMsg').textContent='Changed ✓ — other devices are logged out.';setTimeout(logout,1500);}catch(e){$('pinMsg').style.color='';$('pinMsg').textContent=e.message;}};

  /* ── numbers ── */
  function renderNumbers(){
    const days=Object.keys(data.stats).sort().reverse(),n=(d,k)=>(data.stats[d]&&data.stats[d][k])||0;
    const cols=[['talks','Patient chats/calls'],['booking','Booked'],['attended','Came'],['noshow','No-show'],['emergency','Red flags'],['callback','Call-backs'],['coach_session','Home sessions'],['coach_alert','Alerts'],['scribe','SOAP notes']];
    const val=(d,k)=>k==='talks'?n(d,'chat')+n(d,'voice'):n(d,k);
    const tot=k=>days.reduce((a,d)=>a+val(d,k),0);
    $('stats').innerHTML='<tr><th>Day</th>'+cols.map(c=>'<th class="n">'+c[1]+'</th>').join('')+'</tr>'+
      '<tr><td><b>Total</b></td>'+cols.map(c=>'<td class="n"><b>'+tot(c[0])+'</b></td>').join('')+'</tr>'+
      days.map(d=>'<tr><td>'+d.slice(5)+'</td>'+cols.map(c=>'<td class="n">'+val(d,c[0])+'</td>').join('')+'</tr>').join('');
    const pct=(a,b)=>b?Math.round(100*a/b)+'%':'—';
    $('funnel').innerHTML=['<span class="tag">Conversations → booking: <b>'+pct(tot('booking'),tot('talks'))+'</b></span>','<span class="tag">Show-up rate: <b>'+pct(tot('attended'),tot('attended')+tot('noshow'))+'</b></span>',
      '<span class="tag">Home sessions: <b>'+tot('coach_session')+'</b></span>','<span class="tag">Measurements: <b>'+tot('reading')+'</b></span>'].join('');
  }

  if(slug&&token)start();else loginScreen();
})();

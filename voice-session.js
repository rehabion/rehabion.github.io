/* ── Shared helpers for the clinic pages ──
   RehabPass.get()      invisible Cloudflare Turnstile check → 2-hour pass (normal limits instead of tight ones)
   RehabPass.post()     POST JSON to the worker with the pass attached
   RehabVoice.start()   one Danisa voice call: locked pass from the worker → Gemini Live,
                        her tool calls are run by the page (onTool) and the answer goes back to her.
   Needs live-client.js (RehabLive) for the mic and the player. */
(function(){
  const API=window.REHABION_AI_ENDPOINT||'https://rehabion-ai.rehabion.workers.dev';
  const SITEKEY=window.REHABION_TURNSTILE_SITEKEY||'0x4AAAAAAF52bwC6PRfUhZ32';
  let pass='',passExp=0,job=null;

  function get(){
    if(pass&&Date.now()<passExp-60e3)return Promise.resolve(pass);
    if(!job)job=new Promise(done=>{
      const give=async tok=>{
        try{const d=await (await fetch(API+'/pass',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:tok})})).json();
          if(d.pass){pass=d.pass;passExp=d.expires||Date.now()+3600e3;}}catch(e){}
        job=null;done(pass);
      };
      const run=()=>{try{
        let box=document.getElementById('danisa-check');
        if(!box){box=document.createElement('div');box.id='danisa-check';box.style.cssText='position:fixed;left:-9999px;bottom:0;width:1px;height:1px;overflow:hidden';document.body.appendChild(box);}
        if(box.dataset.w)window.turnstile.reset(box.dataset.w);
        else box.dataset.w=window.turnstile.render(box,{sitekey:SITEKEY,callback:give,'error-callback':()=>{job=null;done('');}});
      }catch(e){job=null;done('');}};
      if(window.turnstile)run();
      else{const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.onload=run;s.onerror=()=>{job=null;done('');};document.head.appendChild(s);}
      setTimeout(()=>{if(job){job=null;done('');}},9000);
    });
    return job;
  }
  async function post(path,body,headers){
    const p=await Promise.race([get(),new Promise(r=>setTimeout(()=>r(''),4000))]);
    const res=await fetch(API+path,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},p?{'X-Danisa-Pass':p}:{},headers||{}),body:JSON.stringify(body||{})});
    let d={};try{d=await res.json();}catch(e){}
    if(!res.ok){const e=new Error(d.error||('HTTP '+res.status));e.status=res.status;e.data=d;throw e;}
    return d;
  }

  /* onText(who:'me'|'her', text, done) streams the live transcript; onState('connecting'|'live'|'ended'|'error', detail) */
  async function start({path,body,onTool,onText,onState,kickoff}){
    onState&&onState('connecting');
    let stream,ctx,session,player,ended=false,me='',her='';
    const finish=(why,detail)=>{if(ended)return;ended=true;try{session&&session.close();}catch(e){}player&&player.stop();
      stream&&stream.getTracks().forEach(t=>t.stop());try{ctx&&ctx.close();}catch(e){}onState&&onState(why,detail);};
    try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});}
    catch(e){finish('error','mic');return null;}
    ctx=new (window.AudioContext||window.webkitAudioContext)();player=new RehabLive.Player(ctx);
    let t;
    try{t=await post(path,body);}catch(e){finish('error',e.status===429?'busy':'server');return null;}
    try{
      session=await RehabLive.open({token:t.token,ctx,stream,setup:{model:'models/'+t.model,contextWindowCompression:{slidingWindow:{}}},
        onClose:()=>finish('ended'),
        onMessage:async m=>{
          if(m.toolCall){
            const calls=m.toolCall.functionCalls||[];
            const responses=await Promise.all(calls.map(async f=>{
              let out;try{out=await onTool(f.name,f.args||{});}catch(e){out={error:'The system could not do that just now — offer a call-back.'};}
              return {id:f.id,name:f.name,response:out};
            }));
            session.send({toolResponse:{functionResponses:responses}});
            return;
          }
          const sc=m.serverContent;if(!sc)return;
          if(sc.interrupted)player.stop();
          (sc.modelTurn&&sc.modelTurn.parts||[]).forEach(p=>{if(p.inlineData&&p.inlineData.data)player.play(p.inlineData.data);});
          if(sc.inputTranscription&&sc.inputTranscription.text){if(her){onText&&onText('her',her,true);her='';}me+=sc.inputTranscription.text;onText&&onText('me',me,false);}
          if(sc.outputTranscription&&sc.outputTranscription.text){if(me){onText&&onText('me',me,true);me='';}her+=sc.outputTranscription.text;onText&&onText('her',her,false);}
          if(sc.turnComplete){if(me){onText&&onText('me',me,true);me='';}if(her){onText&&onText('her',her,true);her='';}}
        }});
    }catch(e){finish('error','connect');return null;}
    onState&&onState('live');
    session.send({realtimeInput:{text:kickoff||'(The call just started. Greet them.)'}});
    let muted=false;
    return {end:()=>finish('ended'),mute:()=>{muted=!muted;session.mute(muted);return muted;}};
  }
  window.RehabPass={get,post,API};
  window.RehabVoice={start};
})();

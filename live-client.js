/* ── Small Gemini Live helper for the founder page ──
   open()      one live session (Danisa talking, or a silent transcriber) fed from a MediaStream
   Player      plays Danisa's 24 kHz voice, can be interrupted
   The same mic-worklet.js as the website's voice assistant does the 16 kHz conversion. */
(function(){
  const WS='wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=';
  const loaded=new WeakSet();
  const WORKLET=new URL('mic-worklet.js',document.currentScript&&document.currentScript.src||location.href).href;   /* works from sub-folders too (coach/) */
  const b64=buf=>{let s='';const u=new Uint8Array(buf);for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s);};

  async function micPipe(ctx,stream,onPCM){
    if(!loaded.has(ctx)){await ctx.audioWorklet.addModule(WORKLET);loaded.add(ctx);}
    const src=ctx.createMediaStreamSource(stream),node=new AudioWorkletNode(ctx,'mic-pcm');
    node.port.onmessage=e=>onPCM(e.data.pcm,e.data.level);
    src.connect(node);
    return ()=>{try{src.disconnect();node.disconnect();}catch(e){}};
  }

  /* resolves once the session is ready; onMessage gets every server message */
  function open({token,setup,ctx,stream,onMessage,onClose}){
    return new Promise((resolve,reject)=>{
      const ws=new WebSocket(WS+encodeURIComponent(token));
      let stopMic=null,muted=false,ready=false;
      const slow=setTimeout(()=>{if(!ready){reject(new Error('voice connection timed out'));try{ws.close();}catch(e){}}},12000);   /* bad network: fail fast, don't hang */
      const send=m=>{if(ws.readyState===1)ws.send(JSON.stringify(m));};
      ws.onopen=()=>send({setup});
      ws.onerror=()=>{if(!ready)reject(new Error('voice connection failed'));};
      ws.onclose=e=>{stopMic&&stopMic();if(!ready)reject(new Error('voice connection closed '+e.code));else onClose&&onClose(e);};
      ws.onmessage=async e=>{
        const m=JSON.parse(typeof e.data==='string'?e.data:await e.data.text());
        if(m.setupComplete&&!ready){
          ready=true;clearTimeout(slow);
          if(stream)stopMic=await micPipe(ctx,stream,pcm=>{if(!muted)send({realtimeInput:{audio:{data:b64(pcm),mimeType:'audio/pcm;rate=16000'}}});});
          resolve({send,mute:on=>{muted=on;},close:()=>{stopMic&&stopMic();try{ws.close();}catch(err){}}});
          return;
        }
        onMessage&&onMessage(m);
      };
    });
  }

  class Player{
    constructor(ctx,dest){this.ctx=ctx;this.dest=dest||ctx.destination;this.end=0;this.src=new Set();}
    play(data){
      const raw=atob(data),n=raw.length>>1,f=new Float32Array(n);
      for(let i=0;i<n;i++){let v=raw.charCodeAt(2*i)|(raw.charCodeAt(2*i+1)<<8);if(v>=0x8000)v-=0x10000;f[i]=v/0x8000;}
      const buf=this.ctx.createBuffer(1,n,24000);buf.copyToChannel(f,0);
      const s=this.ctx.createBufferSource();s.buffer=buf;s.connect(this.dest);
      const at=Math.max(this.end,this.ctx.currentTime+0.04);s.start(at);this.end=at+buf.duration;
      this.src.add(s);s.onended=()=>{this.src.delete(s);if(!this.src.size&&this.onIdle)this.onIdle();};
    }
    stop(){this.src.forEach(s=>{try{s.stop();}catch(e){}});this.src.clear();this.end=0;}
    get busy(){return this.src.size>0;}
  }
  window.RehabLive={open,Player,micPipe};
})();

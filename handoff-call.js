/* ── Browser-to-browser voice call (WebRTC) used for "talk to the founder" ──
   Shared by the website (visitor) and founder.html (founder). The worker only
   relays the set-up messages; the voice itself flows directly between the two
   browsers, so nobody's phone number is involved. */
(function(){
  function start({wsUrl, iceServers, role, stream, onOpen, onStatus, onConnected, onEnded, onMessage}){
    const ws=new WebSocket(wsUrl);
    const pc=new RTCPeerConnection({iceServers});
    const audio=new Audio();audio.autoplay=true;
    const pending=[];let remoteSet=false,closed=false,offered=false;
    const send=m=>{if(ws.readyState===1)ws.send(JSON.stringify(m));};

    stream.getTracks().forEach(tr=>pc.addTrack(tr,stream));
    pc.ontrack=e=>{audio.srcObject=e.streams[0];audio.play().catch(()=>{});};
    pc.onicecandidate=e=>{if(e.candidate)send({t:'ice',c:e.candidate});};
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState==='connected'){send({t:'connected'});onConnected&&onConnected();}
      if(['failed','closed'].includes(pc.connectionState))finish('failed');
    };
    async function offer(){
      if(offered)return;offered=true;
      const o=await pc.createOffer();await pc.setLocalDescription(o);send({t:'offer',sdp:o});
    }
    async function remote(desc){
      await pc.setRemoteDescription(desc);remoteSet=true;
      while(pending.length)await pc.addIceCandidate(pending.shift()).catch(()=>{});
    }
    ws.onopen=()=>onOpen&&onOpen();
    ws.onmessage=async e=>{
      const m=JSON.parse(e.data);
      if(m.t==='status'){
        onStatus&&onStatus(m.status,m);
        if(m.status==='accepted'&&role==='visitor')offer();
        if(['ended','busy','missed','cancelled','left'].includes(m.status))finish(m.status);
      }else if(m.t==='offer'&&role==='founder'){
        await remote(m.sdp);const a=await pc.createAnswer();await pc.setLocalDescription(a);send({t:'answer',sdp:a});
      }else if(m.t==='answer'&&role==='visitor'){await remote(m.sdp);}
      else if(m.t==='ice'){remoteSet?pc.addIceCandidate(m.c).catch(()=>{}):pending.push(m.c);}
      else onMessage&&onMessage(m);
    };
    ws.onclose=()=>{if(!closed)finish('disconnected');};
    function finish(why){
      if(closed)return;closed=true;
      try{pc.close();}catch(e){}
      try{audio.srcObject=null;}catch(e){}
      setTimeout(()=>{try{ws.close();}catch(e){}},300);
      onEnded&&onEnded(why);
    }
    return {
      send,
      hangup(){send({t:'hangup'});finish('ended');},
      cancel(){send({t:'cancel'});finish('cancelled');},
      mute(on){stream.getAudioTracks().forEach(tr=>tr.enabled=!on);}
    };
  }
  window.RehabCall={start};
})();

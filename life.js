/* ── REHABION living background ──
   Hand-drawn feel: drifting watercolour washes + wobbly ink strokes that
   breathe slowly and lean toward the visitor's pointer. No grids, no neon. */
(function(){
  const canvas=document.getElementById('life-canvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const reduce=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  let W=0,H=0,dpr=1,t=0,last=0,mouse={x:.5,y:.4,tx:.5,ty:.4},scrollY=0,running=true;

  /* smooth 1D value noise — gives strokes a human, imperfect wobble */
  const P=[];for(let i=0;i<512;i++)P.push(Math.random());
  function noise(x){const i=Math.floor(x),f=x-i,u=f*f*(3-2*f);return P[i&511]*(1-u)+P[(i+1)&511]*u;}

  const washes=[
    {c:[194,82,47],  r:.42,ax:.18,ay:.12,sx:.00011,sy:.00015,ox:.18,oy:.22,ph:0},
    {c:[221,160,50], r:.34,ax:.22,ay:.16,sx:.00009,sy:.00012,ox:.82,oy:.30,ph:2},
    {c:[46,89,70],   r:.38,ax:.16,ay:.20,sx:.00013,sy:.00008,ox:.65,oy:.78,ph:4},
    {c:[169,203,218],r:.30,ax:.20,ay:.14,sx:.00010,sy:.00014,ox:.25,oy:.85,ph:1},
    {c:[242,205,184],r:.22,ax:.25,ay:.18,sx:.00007,sy:.00011,ox:.50,oy:.50,ph:3}
  ];
  const strokes=Array.from({length:7},(_,i)=>({
    y:.12+i*.13, amp:18+Math.random()*34, freq:.0016+Math.random()*.0018,
    speed:.00022+Math.random()*.00025, seed:Math.random()*200,
    w:.7+Math.random()*1.2, a:.05+Math.random()*.06,
    c:i%3===0?'194,82,47':i%3===1?'46,89,70':'30,27,24'
  }));

  function resize(){
    dpr=Math.min(window.devicePixelRatio||1,1.5);
    W=window.innerWidth;H=window.innerHeight;
    canvas.width=W*dpr;canvas.height=H*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  function drawWash(w){
    const lean=.04;
    const cx=(w.ox+Math.sin(t*w.sx+w.ph)*w.ax+(mouse.x-.5)*lean)*W;
    const cy=(w.oy+Math.cos(t*w.sy+w.ph)*w.ay+(mouse.y-.5)*lean)*H-scrollY*.04;
    const R=w.r*Math.max(W,H);
    /* irregular, slowly morphing outline like pigment bleeding on paper */
    ctx.beginPath();
    const n=28;
    for(let k=0;k<=n;k++){
      const ang=k/n*Math.PI*2;
      const rr=R*(.78+.32*noise(w.ph*40+Math.cos(ang)*1.6+Math.sin(ang)*1.6+t*.00018));
      const x=cx+Math.cos(ang)*rr,y=cy+Math.sin(ang)*rr*.8;
      k?ctx.lineTo(x,y):ctx.moveTo(x,y);
    }
    const g=ctx.createRadialGradient(cx,cy,0,cx,cy,R);
    const [r,gg,b]=w.c;
    g.addColorStop(0,`rgba(${r},${gg},${b},.10)`);
    g.addColorStop(.55,`rgba(${r},${gg},${b},.04)`);
    g.addColorStop(1,`rgba(${r},${gg},${b},0)`);
    ctx.fillStyle=g;ctx.fill();
  }

  function drawStroke(s){
    const baseY=s.y*H-((scrollY*.06)%H);
    const mx=mouse.x*W,my=mouse.y*H;
    ctx.beginPath();
    for(let x=-20;x<=W+20;x+=8){
      let y=baseY+Math.sin(x*s.freq+t*s.speed+s.seed)*s.amp
             +(noise(s.seed+x*.004+t*.00012)-.5)*s.amp*1.4;
      /* gentle ripple where the visitor's hand is */
      const d=Math.hypot(x-mx,y-my);
      if(d<220)y+=Math.sin(d*.05-t*.004)*(1-d/220)*10;
      /* tiny jitter = pen pressure */
      y+=(noise(s.seed*3+x*.09)-.5)*1.6;
      x<=-20?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }
    ctx.strokeStyle=`rgba(${s.c},${s.a})`;
    ctx.lineWidth=s.w;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.stroke();
  }

  function frame(now){
    if(!running)return;
    requestAnimationFrame(frame);
    if(now-last<33)return; /* ~30fps is plenty for slow motion and kind to batteries */
    t+=now-last||16;last=now;
    mouse.x+=(mouse.tx-mouse.x)*.04;mouse.y+=(mouse.ty-mouse.y)*.04;
    ctx.clearRect(0,0,W,H);
    ctx.globalCompositeOperation='multiply'; /* pigment on paper */
    washes.forEach(drawWash);
    ctx.globalCompositeOperation='source-over';
    strokes.forEach(drawStroke);
  }

  resize();
  window.addEventListener('resize',resize);
  window.addEventListener('pointermove',e=>{mouse.tx=e.clientX/W;mouse.ty=e.clientY/H;},{passive:true});
  window.addEventListener('scroll',()=>{scrollY=window.scrollY;},{passive:true});
  document.addEventListener('visibilitychange',()=>{
    running=!document.hidden;
    if(running&&!reduce){last=performance.now();requestAnimationFrame(frame);}
  });
  if(reduce){t=4000;last=1;frame(40);running=false;}
  else requestAnimationFrame(frame);
})();

/* ====================================================================
   mimic.js — SVG process-mimic library (FactoryTalk-View style)
   --------------------------------------------------------------------
   Equipment symbols (drags, augers, bucket elevators, silos, roll
   stands, sifters, purifiers, fans, pumps) + animated material flow.
   Builds four diagrams: silos, temper, mill, and the whole-plant view.
   Each builder returns { node, refresh }. refresh() updates live state
   (levels, run/stop/fault colours, readouts) without rebuilding the SVG,
   so animations stay smooth.
   ==================================================================== */
const MIMIC = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  let uid = 0;

  function E(tag, attrs = {}, ...kids){
    const n = document.createElementNS(NS, tag);
    for (const k in attrs){ const v = attrs[k]; if (v != null && v !== false) n.setAttribute(k, v); }
    for (const c of kids.flat()){ if (c == null || c === false) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return n;
  }
  function txt(x, y, s, cls, extra = {}){ const t = E('text', { x, y, class: cls, ...extra }); t.appendChild(document.createTextNode(s)); return t; }
  function mstate(tag){ return PLC.read(tag+'_FAULT') ? 'fault' : PLC.read(tag+'_RUN') ? 'run' : 'stop'; }

  /* ---- canvas / builder ----------------------------------------- */
  function build(w, h){
    const defs = E('defs');
    const grid = E('g', { class:'mimic-grid' });
    for (let x=0; x<=w; x+=40) grid.appendChild(E('line',{x1:x,y1:0,x2:x,y2:h}));
    for (let y=0; y<=h; y+=40) grid.appendChild(E('line',{x1:0,y1:y,x2:w,y2:y}));
    const S = E('g');
    const svg = E('svg', { viewBox:`0 0 ${w} ${h}`, preserveAspectRatio:'xMidYMid meet' }, defs, grid, S);
    return { svg, S, defs, reg: [], w, h };
  }
  function wrap(ctx, legend){
    const div = UI.el('div', { class:'mimic-wrap' });
    div.appendChild(ctx.svg);
    if (legend !== false){
      const items = legend || [['var(--run)','Running'],['var(--stop)','Stopped'],['var(--alarm)','Fault'],['var(--grain)','Grain flow'],['var(--water)','Water']];
      const lg = UI.el('div', { class:'mimic-legend' });
      items.forEach(([c,l]) => lg.appendChild(UI.el('span',{class:'li'}, UI.el('span',{class:'dot',style:`background:${c}`}), l)));
      div.appendChild(lg);
    }
    return { node: div, refresh: () => ctx.reg.forEach(f => { try{f();}catch(e){console.error(e);} }) };
  }

  /* ================================================================
     SYMBOLS  (each appends to ctx.S and registers a live updater)
     ================================================================ */
  function motor(ctx, cx, cy, tag, opts = {}){
    const r = opts.r || 13;
    const g = E('g', { class:'mim-motor', 'data-m':tag });
    g.appendChild(E('title'));
    g.appendChild(E('circle', { class:'mb-c', cx, cy, r }));
    const rot = E('g', { class:'mb-rot' });
    for (let i=0;i<3;i++){ const a=i*120*Math.PI/180; rot.appendChild(E('line',{x1:cx,y1:cy,x2:cx+(r-4)*Math.cos(a),y2:cy+(r-4)*Math.sin(a),stroke:'#fff','stroke-width':1.5,'stroke-opacity':.45})); }
    g.appendChild(rot);
    g.appendChild(txt(cx, cy, 'M', 'mb-t'));
    g.addEventListener('click', (e)=>{ e.stopPropagation(); UI.faceplate(tag); });
    ctx.S.appendChild(g);
    ctx.reg.push(()=>{ const st=mstate(tag); g.setAttribute('class','mim-motor '+st);
      const run=PLC.read(tag+'_RUN'); g.firstChild.textContent = `${tag} · ${PLC.motorMeta(tag).desc} — ${st.toUpperCase()}${run?` · ${Math.round(PLC.read(tag+'_CURRENT'))}A · ${Math.round(PLC.read(tag+'_SPEED'))}%`:''}`; });
    return g;
  }

  function silo(ctx, x, y, w, h, tag, opts = {}){
    const cone = opts.cone !== false;
    const coneH = cone ? Math.min(h*0.22, 26) : 6;
    const bodyH = h - coneH;
    const id = 'clip'+(uid++);
    const path = `M${x},${y+8} q0,-8 ${w/2},-8 q${w/2},0 ${w/2},8 L${x+w},${y+bodyH} L${x+w/2},${y+h} L${x},${y+bodyH} Z`;
    ctx.defs.appendChild(E('clipPath', { id }, E('path', { d:path })));
    ctx.S.appendChild(E('path', { class:'eq-body', d:path }));
    const fill = E('rect', { class:'eq-grain', x, y, width:w, height:0, 'clip-path':`url(#${id})` });
    ctx.S.appendChild(fill);
    ctx.S.appendChild(E('path', { class:'eq-line', d:path, fill:'none' }));
    const pct = txt(x+w/2, y+bodyH*0.55, '', 'eq-label', { 'text-anchor':'middle' }); pct.style.fill='#fff';
    ctx.S.appendChild(pct);
    if (opts.label) ctx.S.appendChild(txt(x+w/2, y+h+14, opts.label, 'eq-tag', { 'text-anchor':'middle' }));
    const gl = txt(x+w/2, y+h+(opts.label?26:14), '', 'eq-sub', { 'text-anchor':'middle' });
    ctx.S.appendChild(gl);
    ctx.reg.push(()=>{ const lvl=PLC.read(tag+'_LEVEL'); const fh=h*lvl/100;
      fill.setAttribute('y', y+h-fh); fill.setAttribute('height', fh);
      pct.textContent=Math.round(lvl)+'%'; gl.textContent=PLC.GRAIN_TYPES[PLC.read(tag+'_GRAIN')]||''; });
  }

  function elevator(ctx, x, y, w, h, tag, opts = {}){
    const g = E('g', { class:'eq-state' });
    g.appendChild(E('rect', { class:'eq-housing', x, y, width:w, height:h, rx:4 }));
    g.appendChild(E('circle', { class:'eq-roll', cx:x+w/2, cy:y+11, r:7 }));
    g.appendChild(E('circle', { class:'eq-roll', cx:x+w/2, cy:y+h-11, r:7 }));
    g.appendChild(E('line', { class:'mim-belt', x1:x+w/2-5, y1:y+11, x2:x+w/2-5, y2:y+h-11 }));
    g.appendChild(E('line', { class:'mim-belt', x1:x+w/2+5, y1:y+11, x2:x+w/2+5, y2:y+h-11 }));
    if (opts.label) g.appendChild(txt(x+w/2, y-7, opts.label, 'eq-tag', { 'text-anchor':'middle' }));
    ctx.S.appendChild(g);
    motor(ctx, x+w+13, y+h-13, tag, { r:11 });
    ctx.reg.push(()=>g.setAttribute('class','eq-state '+mstate(tag)));
  }

  function drag(ctx, x, y, len, tag, opts = {}){
    const hgt=22; const g=E('g',{class:'eq-state'});
    g.appendChild(E('rect',{class:'eq-housing',x,y,width:len,height:hgt,rx:4}));
    g.appendChild(E('circle',{class:'eq-roll',cx:x+11,cy:y+hgt/2,r:7}));
    g.appendChild(E('circle',{class:'eq-roll',cx:x+len-11,cy:y+hgt/2,r:7}));
    g.appendChild(E('line',{class:'mim-belt',x1:x+11,y1:y+6,x2:x+len-11,y2:y+6}));
    g.appendChild(E('line',{class:'mim-belt',x1:x+11,y1:y+hgt-6,x2:x+len-11,y2:y+hgt-6}));
    if (opts.label) g.appendChild(txt(x+len/2,y-7,opts.label,'eq-tag',{'text-anchor':'middle'}));
    ctx.S.appendChild(g);
    motor(ctx, opts.motorEnd==='left'?x+11:x+len-11, y+hgt+18, tag, { r:11 });
    ctx.reg.push(()=>g.setAttribute('class','eq-state '+mstate(tag)));
  }

  function auger(ctx, x, y, len, tag, opts = {}){
    const hgt=20; const g=E('g',{class:'eq-state'});
    g.appendChild(E('rect',{class:'eq-housing',x,y,width:len,height:hgt,rx:hgt/2}));
    // helical screw flight
    let d=`M${x+5},${y+hgt/2}`; for (let sx=x+5; sx<x+len-5; sx+=12){ d+=` q6,-${hgt/2-3} 12,0 q6,${hgt/2-3} 12,0`; }
    g.appendChild(E('path',{class:'mim-screw',d}));
    if (opts.label) g.appendChild(txt(x+len/2,y-7,opts.label,'eq-tag',{'text-anchor':'middle'}));
    ctx.S.appendChild(g);
    motor(ctx, opts.motorEnd==='left'?x+9:x+len-9, y+hgt+18, tag, { r:11 });
    ctx.reg.push(()=>g.setAttribute('class','eq-state '+mstate(tag)));
  }

  function rollStand(ctx, x, y, tag, opts = {}){
    const w=80, h=66; const g=E('g',{class:'eq-state'});
    g.appendChild(E('path',{class:'eq-body',d:`M${x+16},${y} L${x+w-16},${y} L${x+w-30},${y+18} L${x+30},${y+18} Z`})); // feed hopper
    g.appendChild(E('rect',{class:'eq-body',x:x+10,y:y+18,width:w-20,height:h-18,rx:5}));
    const r=12;
    const mkRoll=(ox)=>{ const rg=E('g'); rg.appendChild(E('circle',{class:'eq-roll',cx:x+w/2+ox,cy:y+40,r}));
      rg.appendChild(E('line',{x1:x+w/2+ox,y1:y+40-r,x2:x+w/2+ox,y2:y+40+r,stroke:'var(--mim-eq-stroke)','stroke-width':1.5})); return rg; };
    const rl=mkRoll(-11), rr=mkRoll(11); g.appendChild(rl); g.appendChild(rr);
    g.appendChild(E('path',{class:'eq-line',d:`M${x+30},${y+h} L${x+w/2},${y+h+14} L${x+w-30},${y+h}`}));
    if (opts.label) g.appendChild(txt(x+w/2,y-7,opts.label,'eq-tag',{'text-anchor':'middle'}));
    ctx.S.appendChild(g);
    motor(ctx, x+w+2, y+34, tag, { r:11 });
    ctx.reg.push(()=>{ const st=mstate(tag); g.setAttribute('class','eq-state '+st);
      rl.setAttribute('class', st==='run'?'mim-spin':''); rr.setAttribute('class', st==='run'?'mim-spin':''); });
    return { w, h };
  }

  function sifter(ctx, x, y, w, h, tag, opts = {}){
    const g=E('g',{class:'eq-state'});
    g.appendChild(E('rect',{class:'eq-housing',x,y,width:w,height:h,rx:6}));
    const n=Math.max(3,Math.round(h/18));
    for (let i=1;i<n;i++) g.appendChild(E('line',{class:'eq-line',x1:x+8,y1:y+i*h/n,x2:x+w-8,y2:y+i*h/n}));
    const gy=E('g'); gy.appendChild(E('circle',{class:'eq-roll',cx:x+w/2,cy:y+h/2,r:8}));
    gy.appendChild(E('circle',{cx:x+w/2+4,cy:y+h/2,r:2.5,fill:'var(--mim-eq-stroke)'}));
    g.appendChild(gy);
    if (opts.label) g.appendChild(txt(x+w/2,y-7,opts.label,'eq-tag',{'text-anchor':'middle'}));
    ctx.S.appendChild(g);
    motor(ctx, x+w+13, y+14, tag, { r:11 });
    ctx.reg.push(()=>{ const st=mstate(tag); g.setAttribute('class','eq-state '+st); gy.setAttribute('class', st==='run'?'mim-spin':''); });
  }

  function purifier(ctx, x, y, w, h, tag, opts = {}){
    const g=E('g',{class:'eq-state'});
    g.appendChild(E('rect',{class:'eq-housing',x,y,width:w,height:h,rx:5,transform:`rotate(-4 ${x+w/2} ${y+h/2})`}));
    for (let i=1;i<=3;i++) g.appendChild(E('line',{class:'eq-line',x1:x+6,y1:y+i*h/4,x2:x+w-6,y2:y+i*h/4}));
    if (opts.label) g.appendChild(txt(x+w/2,y-7,opts.label,'eq-tag',{'text-anchor':'middle'}));
    ctx.S.appendChild(g);
    motor(ctx, x+w+12, y+12, tag, { r:11 });
    ctx.reg.push(()=>g.setAttribute('class','eq-state '+mstate(tag)));
  }

  function fan(ctx, cx, cy, tag, opts = {}){
    const r=opts.r||22; const g=E('g',{class:'eq-state'});
    g.appendChild(E('circle',{class:'eq-housing',cx,cy,r}));
    g.appendChild(E('rect',{class:'eq-housing',x:cx+r-3,y:cy-9,width:14,height:18,rx:2}));
    const imp=E('g'); for (let i=0;i<6;i++){ const a=i*60*Math.PI/180; imp.appendChild(E('line',{x1:cx,y1:cy,x2:cx+(r-5)*Math.cos(a),y2:cy+(r-5)*Math.sin(a),stroke:'var(--mim-eq-stroke)','stroke-width':2})); }
    imp.appendChild(E('circle',{cx,cy,r:4,class:'eq-roll'})); g.appendChild(imp);
    if (opts.label) g.appendChild(txt(cx,cy-r-7,opts.label,'eq-tag',{'text-anchor':'middle'}));
    ctx.S.appendChild(g);
    motor(ctx, cx, cy+r+15, tag, { r:11 });
    ctx.reg.push(()=>{ const st=mstate(tag); g.setAttribute('class','eq-state '+st); imp.setAttribute('class', st==='run'?'mim-spin':''); });
  }

  function pump(ctx, cx, cy, tag, opts = {}){
    const r=14; const g=E('g',{class:'eq-state'});
    g.appendChild(E('circle',{class:'eq-housing',cx,cy,r}));
    const imp=E('path',{d:`M${cx},${cy} L${cx+r-3},${cy-6} L${cx+r-3},${cy+6} Z`,fill:'var(--mim-eq-stroke)'});
    g.appendChild(imp);
    if (opts.label) g.appendChild(txt(cx,cy-r-5,opts.label,'eq-tag',{'text-anchor':'middle'}));
    ctx.S.appendChild(g);
    motor(ctx, cx, cy+r+14, tag, { r:10 });
    ctx.reg.push(()=>{ const st=mstate(tag); g.setAttribute('class','eq-state '+st); imp.setAttribute('class', st==='run'?'mim-spin':''); });
  }

  function waterTank(ctx, x, y, w, h, label){
    ctx.S.appendChild(E('rect',{class:'eq-housing',x,y,width:w,height:h,rx:4}));
    ctx.S.appendChild(E('rect',{class:'eq-water',x:x+2,y:y+h*0.4,width:w-4,height:h*0.6-2,rx:2}));
    if (label) ctx.S.appendChild(txt(x+w/2,y-5,label,'eq-tag',{'text-anchor':'middle'}));
  }
  function hopper(ctx, x, y, w, h, label){
    ctx.S.appendChild(E('path',{class:'eq-body',d:`M${x},${y} L${x+w},${y} L${x+w*0.62},${y+h} L${x+w*0.38},${y+h} Z`}));
    if (label) ctx.S.appendChild(txt(x+w/2,y-5,label,'eq-tag',{'text-anchor':'middle'}));
  }
  function distributor(ctx, x, y, tag, label){
    const g=E('g',{class:'eq-state'});
    g.appendChild(E('circle',{class:'eq-body',cx:x,cy:y,r:15}));
    g.appendChild(E('path',{class:'eq-line',d:`M${x-9},${y-3} L${x+9},${y-3} M${x},${y-3} L${x},${y+9}`}));
    if (label) g.appendChild(txt(x,y-21,label,'eq-tag',{'text-anchor':'middle'}));
    ctx.S.appendChild(g);
    motor(ctx, x+24, y, tag, { r:10 });
    ctx.reg.push(()=>g.setAttribute('class','eq-state '+mstate(tag)));
  }

  function pipe(ctx, d, activeFn, opts = {}){
    ctx.S.appendChild(E('path',{class:'mim-pipe'+(opts.thin?' thin':''),d}));
    const ov=E('path',{class:'mim-pipe mim-flow'+(opts.thin?' thin':'')+(opts.water?' water':''),d});
    ctx.S.appendChild(ov);
    ctx.reg.push(()=>ov.classList.toggle('active', !!activeFn()));
  }
  function readout(ctx, x, y, w, label, fn){
    const g=E('g',{class:'mim-readout'});
    g.appendChild(E('rect',{class:'ro-box',x,y,width:w,height:26,rx:4}));
    g.appendChild(txt(x+6,y-4,label,'ro-lbl'));
    const v=txt(x+w-8,y+18,'','ro-val'); g.appendChild(v);
    ctx.S.appendChild(g);
    ctx.reg.push(()=>v.textContent=fn());
  }
  function flag(ctx, x, y, text){ ctx.S.appendChild(txt(x,y,text,'mim-arrow-lbl')); }
  function flowArrow(ctx, x, y, label, activeFn){
    const a=E('polygon',{class:'mim-arrow',points:`${x},${y-9} ${x+26},${y-9} ${x+26},${y-16} ${x+44},${y} ${x+26},${y+16} ${x+26},${y+9} ${x},${y+9}`});
    ctx.S.appendChild(a);
    if (label) ctx.S.appendChild(txt(x+22,y-22,label,'mim-arrow-lbl',{'text-anchor':'middle'}));
    if (activeFn) ctx.reg.push(()=>a.classList.toggle('active',!!activeFn()));
  }
  function zone(ctx, x, y, w, h, title){
    ctx.S.appendChild(E('rect',{class:'mim-zone-band',x,y,width:w,height:h,rx:10}));
    ctx.S.appendChild(txt(x+16,y+24,title,'mim-zone-title'));
  }

  /* shorthand run-flags */
  const R = (t)=>()=>PLC.read(t+'_RUN');

  /* ================================================================
     DIAGRAM: SILO FILLING / INTAKE
     ================================================================ */
  function silos(){
    const ctx = build(1000, 360);
    // pipes first (behind)
    pipe(ctx,'M70,300 L66,290',()=>PLC.read('M_IC1_RUN'));
    pipe(ctx,'M250,322 L267,332',()=>PLC.read('M_IC1_RUN'));
    pipe(ctx,'M267,72 C300,72 300,100 320,108',R('M_BE1'));
    pipe(ctx,'M430,108 L544,110',R('M_PC1'));
    for (let i=0;i<6;i++){ const sx=540+i*72; pipe(ctx,`M560,124 L${sx+27},160`,()=>PLC.read('M_DST_RUN')&&PLC.read('SP_FILL_TARGET')===i); }
    pipe(ctx,'M900,300 L900,330 L950,330',()=>PLC.read('PV_FILL_TPH')>0.5);
    // equipment
    hopper(ctx,40,250,56,40,'Tip Pit');
    drag(ctx,70,300,180,'M_IC1',{label:'IC1 · Intake Drag',motorEnd:'left'});
    elevator(ctx,250,60,34,272,'M_BE1',{label:'BE1'});
    sifter(ctx,320,80,110,52,'M_PC1',{label:'PC1 · Pre-Cleaner'});
    fan(ctx,478,58,'M_DEDUST',{label:'Dedust Fan',r:18});
    distributor(ctx,560,110,'M_DST','DST · Distributor');
    for (let i=0;i<6;i++){ const sx=540+i*72; silo(ctx,sx,160,56,148,'S'+(i+1),{label:'Silo '+(i+1)}); }
    flag(ctx,905,322,'→ To Tempering');
    // readouts
    readout(ctx,40,70,150,'INTAKE RATE  t/h',()=>UI.num(PLC.read('PV_FILL_TPH'),1));
    readout(ctx,40,120,150,'DESTINATION',()=>PLC.VESSELS[PLC.read('SP_FILL_TARGET')][1]);
    readout(ctx,40,170,150,'GRAIN TYPE',()=>PLC.GRAIN_TYPES[PLC.read('SP_FILL_GRAIN')]);
    return wrap(ctx);
  }

  /* ================================================================
     DIAGRAM: GRAIN TEMPERING / CONDITIONING
     ================================================================ */
  function temper(){
    const ctx = build(1000, 360);
    const tRun = ()=>PLC.read('LINE_TEMPER_RUN');
    pipe(ctx,'M40,140 L70,140',tRun);
    pipe(ctx,'M126,140 C150,140 150,150 150,150',tRun);
    pipe(ctx,'M175,72 L175,96',R('M_WP1'),{water:true,thin:true});
    pipe(ctx,'M175,124 C175,150 160,150 150,160',R('M_WP1'),{water:true,thin:true});
    pipe(ctx,'M330,160 C350,160 350,300 360,320',R('M_DAMP'));
    pipe(ctx,'M377,86 L450,76',R('M_BE2'));
    for (let i=0;i<4;i++){ const bx=450+i*110; pipe(ctx,`M395,80 L${bx+45},70`,R('M_BE2')); }
    pipe(ctx,'M495,210 L495,240',R('M_TC1')); pipe(ctx,'M605,210 L605,240',R('M_TC1'));
    pipe(ctx,'M715,210 L715,240',R('M_TC2')); pipe(ctx,'M825,210 L825,240',R('M_TC2'));
    pipe(ctx,'M650,260 L890,260 L890,290',tRun);
    pipe(ctx,'M870,260 L920,260',tRun);
    // equipment
    hopper(ctx,70,104,56,34,'Weigher');
    waterTank(ctx,150,32,50,40,'Water');
    pump(ctx,175,110,'M_WP1',{label:'WP1'});
    auger(ctx,130,150,200,'M_DAMP',{label:'DAMP · Dampener Auger',motorEnd:'left'});
    elevator(ctx,360,76,34,234,'M_BE2',{label:'BE2'});
    for (let i=0;i<4;i++){ const bx=450+i*110; silo(ctx,bx,70,90,138,'TB'+(i+1),{label:'Temper Bin '+(i+1),cone:false}); }
    auger(ctx,460,240,200,'M_TC1',{label:'TC1 · Temper Screw',motorEnd:'left'});
    auger(ctx,680,240,200,'M_TC2',{label:'TC2 · Temper Screw',motorEnd:'left'});
    flag(ctx,925,264,'→ To Milling');
    flag(ctx,20,135,'From Silos');
    // readouts
    readout(ctx,720,30,140,'INLET MOIST  %',()=>UI.num(PLC.read('PV_INLET_MOIST'),1));
    readout(ctx,720,80,140,'TEMPERED  %',()=>UI.num(PLC.read('PV_TEMPER_MOIST'),1));
    readout(ctx,720,130,140,'WATER  L/min',()=>UI.num(PLC.read('PV_WATER_LPM'),1));
    return wrap(ctx, [['var(--run)','Running'],['var(--stop)','Stopped'],['var(--alarm)','Fault'],['var(--grain)','Grain flow'],['var(--water)','Water addition']]);
  }

  /* ================================================================
     DIAGRAM: MILLING
     ================================================================ */
  function mill(){
    const ctx = build(1000, 400);
    pipe(ctx,'M40,90 L70,90',()=>PLC.read('LINE_MILL_RUN'));
    pipe(ctx,'M110,72 L110,70',R('M_B1'));
    // rolls down to sifter
    [110,240,400,530].forEach((rx,i)=>{ const tags=['M_B1','M_B2','M_C1','M_C2']; pipe(ctx,`M${rx},${152} L${rx},220`,R(tags[i])); });
    // sifter returns up to next rolls
    pipe(ctx,'M180,220 L240,152',R('M_SIFT'),{thin:true});
    pipe(ctx,'M340,220 L400,152',R('M_SIFT'),{thin:true});
    pipe(ctx,'M470,220 L530,152',R('M_SIFT'),{thin:true});
    pipe(ctx,'M570,255 L650,255',R('M_SIFT'));        // sifter → purifier
    pipe(ctx,'M740,255 L800,255 L800,300',R('M_PUR')); // purifier → packing
    pipe(ctx,'M820,138 L820,124',R('M_PNF'),{thin:true}); // fan duct
    pipe(ctx,'M760,318 L740,318',R('M_PACK'));            // → flour
    pipe(ctx,'M400,300 L400,360 L560,360',()=>PLC.read('PV_MILL_TPH')>0.5); // bran
    // equipment
    rollStand(ctx,70,80,'M_B1',{label:'B1 · 1st Break'});
    rollStand(ctx,200,80,'M_B2',{label:'B2 · 2nd Break'});
    rollStand(ctx,360,80,'M_C1',{label:'C1 · 1st Reduction'});
    rollStand(ctx,490,80,'M_C2',{label:'C2 · 2nd Reduction'});
    sifter(ctx,80,222,490,70,'M_SIFT',{label:'Plansifter'});
    purifier(ctx,650,222,90,66,'M_PUR',{label:'Purifier'});
    fan(ctx,820,100,'M_PNF',{label:'Pneumatic Fan',r:24});
    auger(ctx,640,308,120,'M_PACK',{label:'PACK · Flour Packing',motorEnd:'right'});
    ctx.S.appendChild(E('rect',{class:'eq-body',x:700,y:336,width:26,height:30,rx:2})); // flour bag
    flag(ctx,500,356,'→ Bran / Offal');
    flag(ctx,560,330,'→ Flour to Silo');
    flag(ctx,20,85,'From Bins');
    // readouts
    readout(ctx,820,300,150,'MILL RATE  t/h',()=>UI.num(PLC.read('PV_MILL_TPH'),1));
    readout(ctx,820,350,150,'EXTRACTION  %',()=>UI.num(PLC.read('PV_EXTRACTION'),0));
    return wrap(ctx);
  }

  /* ================================================================
     DIAGRAM: WHOLE PLANT OVERVIEW
     ================================================================ */
  function plant(){
    const ctx = build(1260, 470);
    zone(ctx,20,56,400,372,'INTAKE & STORAGE');
    zone(ctx,440,56,360,372,'TEMPERING');
    zone(ctx,820,56,420,372,'MILLING');
    // inter-zone flow
    flowArrow(ctx,418,210,'Cleaned wheat',R('M_DST'));
    flowArrow(ctx,798,210,'Tempered wheat',R('M_BE2'));
    flag(ctx,40,46,'↓ Wheat Intake');
    // ---- intake pipes/equipment
    pipe(ctx,'M150,360 L150,150',R('M_BE1'));
    pipe(ctx,'M167,150 L210,150',R('M_PC1'));
    pipe(ctx,'M300,170 L330,200',R('M_DST'));
    hopper(ctx,40,330,40,26,'Tip');
    drag(ctx,70,338,70,'M_IC1',{label:'IC1',motorEnd:'left'});
    elevator(ctx,135,120,28,250,'M_BE1',{label:'BE1'});
    sifter(ctx,210,128,80,40,'M_PC1',{label:'PC1'});
    distributor(ctx,300,170,'M_DST','DST');
    silo(ctx,300,210,34,120,'S1',{label:'S1'});
    silo(ctx,345,210,34,120,'S2',{label:'S2'});
    silo(ctx,390,210,28,120,'S3',{label:'S3'});
    // ---- tempering
    pipe(ctx,'M620,180 C640,180 640,320 650,330',R('M_DAMP'));
    pipe(ctx,'M667,150 L700,150',R('M_BE2'));
    auger(ctx,460,170,150,'M_DAMP',{label:'DAMP',motorEnd:'left'});
    waterTank(ctx,470,90,40,32,'H₂O'); pump(ctx,540,120,'M_WP1',{label:'WP1'});
    elevator(ctx,640,120,28,230,'M_BE2',{label:'BE2'});
    silo(ctx,700,150,46,120,'TB1',{label:'Bin1',cone:false});
    silo(ctx,752,150,46,120,'TB2',{label:'Bin2',cone:false});
    // ---- milling
    pipe(ctx,'M880,140 L880,168',R('M_B1'));
    pipe(ctx,'M880,206 L920,250',R('M_B1'));
    pipe(ctx,'M1000,206 L960,250',R('M_C1'));
    pipe(ctx,'M1080,280 L1140,280',R('M_SIFT'));
    rollStand(ctx,840,128,'M_B1',{label:'B1'});
    rollStand(ctx,960,128,'M_C1',{label:'C1'});
    sifter(ctx,840,256,240,60,'M_SIFT',{label:'Plansifter'});
    fan(ctx,1170,140,'M_PNF',{label:'Fan',r:20});
    purifier(ctx,1140,256,70,60,'M_PUR',{label:'Pur'});
    flag(ctx,1150,360,'→ Flour');
    flag(ctx,1150,386,'→ Bran');
    // ---- readouts row
    readout(ctx,40,392,200,'INTAKE  t/h',()=>UI.num(PLC.read('PV_FILL_TPH'),1));
    readout(ctx,460,392,150,'TEMPER MOIST  %',()=>UI.num(PLC.read('PV_TEMPER_MOIST'),1));
    readout(ctx,840,392,150,'MILL RATE  t/h',()=>UI.num(PLC.read('PV_MILL_TPH'),1));
    readout(ctx,1010,392,150,'FLOUR  t',()=>UI.num(PLC.read('CNT_FLOUR_TODAY'),1));
    return wrap(ctx);
  }

  return { silos, temper, mill, plant };
})();
window.MIMIC = MIMIC;

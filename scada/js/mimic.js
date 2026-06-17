/* ====================================================================
   mimic.js — technical SVG process diagrams (P&ID style)
   --------------------------------------------------------------------
   Equipment symbols (drags, augers, bucket elevators, silos, roll
   stands, sifters, purifiers, fans, pumps) drawn schematically with:
     • orthogonal piping + flow-direction arrowheads
     • ISA instrument balloons (LT / WT / MT / FT / QT …)
     • equipment tag numbers (DC-102, BE-105 …)
     • non-overlapping label / readout lanes
   Builds four diagrams: silos, temper, mill, and the whole plant.
   Each builder returns { node, refresh }; refresh() updates live
   state without rebuilding the SVG so animation stays smooth.
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
  const txt = (x,y,s,cls,ex={}) => { const t=E('text',{x,y,class:cls,...ex}); t.appendChild(document.createTextNode(s)); return t; };
  const mstate = (tag) => PLC.read(tag+'_FAULT') ? 'fault' : PLC.read(tag+'_RUN') ? 'run' : 'stop';
  const R = (t) => () => PLC.read(t+'_RUN');

  /* ---- canvas ---------------------------------------------------- */
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

  /* ---- shared helpers ------------------------------------------- */
  function titleBlock(ctx, t, note){
    ctx.S.appendChild(txt(18, 24, t, 'mim-title'));
    if (note) ctx.S.appendChild(txt(18, 39, note, 'mim-note'));
  }
  function lbl(ctx, x, y, tagNo, name, anchor='middle'){
    ctx.S.appendChild(txt(x, y, tagNo, 'eq-tagno', { 'text-anchor':anchor }));
    if (name) ctx.S.appendChild(txt(x, y+12, name, 'eq-name', { 'text-anchor':anchor }));
  }
  function flag(ctx, x, y, text, anchor='start'){ ctx.S.appendChild(txt(x, y, text, 'mim-streamlbl', { 'text-anchor':anchor })); }

  function arrowHead(tip, from, water){
    const dx=tip[0]-from[0], dy=tip[1]-from[1], len=Math.hypot(dx,dy)||1, ux=dx/len, uy=dy/len, s=8;
    const p2=[tip[0]-ux*s - uy*s*0.55, tip[1]-uy*s + ux*s*0.55];
    const p3=[tip[0]-ux*s + uy*s*0.55, tip[1]-uy*s - ux*s*0.55];
    const node=E('polygon',{class:'mim-arrowhead'+(water?' water':''),points:`${tip} ${p2} ${p3}`});
    return { node, set:(on)=>node.classList.toggle('active',on) };
  }
  /* orthogonal pipe through waypoints with flow + end arrowhead */
  function stream(ctx, pts, activeFn, opts={}){
    const d='M'+pts.map(p=>p[0]+','+p[1]).join(' L');
    ctx.S.appendChild(E('path',{class:'mim-pipe'+(opts.thin?' thin':''),d}));
    const ov=E('path',{class:'mim-pipe mim-flow'+(opts.thin?' thin':'')+(opts.water?' water':''),d});
    ctx.S.appendChild(ov);
    let ah=null;
    if (opts.arrow!==false){ ah=arrowHead(pts[pts.length-1],pts[pts.length-2],opts.water); ctx.S.appendChild(ah.node); }
    ctx.reg.push(()=>{ const on=!!activeFn(); ov.classList.toggle('active',on); if(ah) ah.set(on); });
  }
  /* ISA instrument balloon */
  function inst(ctx, x, y, fn, loop, opts={}){
    const r=opts.r||13;
    const g=E('g',{class:'inst'});
    if (opts.lead) g.appendChild(E('line',{class:'il',x1:x,y1:y,x2:opts.lead[0],y2:opts.lead[1]}));
    g.appendChild(E('circle',{class:'ib',cx:x,cy:y,r}));
    g.appendChild(E('line',{class:'idiv',x1:x-r,y1:y,x2:x+r,y2:y}));
    g.appendChild(txt(x,y-3.5,fn,'if'));
    g.appendChild(txt(x,y+8.5,loop,'in'));
    ctx.S.appendChild(g);
  }
  function readout(ctx, x, y, w, label, fn){
    const g=E('g',{class:'mim-readout'});
    g.appendChild(E('rect',{class:'ro-box',x,y,width:w,height:26,rx:3}));
    g.appendChild(txt(x+6,y-4,label,'ro-lbl'));
    const v=txt(x+w-8,y+18,'','ro-val'); g.appendChild(v);
    ctx.S.appendChild(g);
    ctx.reg.push(()=>v.textContent=fn());
  }

  /* ---- motor badge ---------------------------------------------- */
  function motor(ctx, cx, cy, tag, opts={}){
    const r = opts.r || 11;
    const g = E('g', { class:'mim-motor', 'data-m':tag });
    g.appendChild(E('title'));
    g.appendChild(E('circle', { class:'mb-c', cx, cy, r }));
    const rot = E('g', { class:'mb-rot' });
    for (let i=0;i<3;i++){ const a=i*120*Math.PI/180; rot.appendChild(E('line',{x1:cx,y1:cy,x2:cx+(r-4)*Math.cos(a),y2:cy+(r-4)*Math.sin(a),stroke:'#fff','stroke-width':1.3,'stroke-opacity':.45})); }
    g.appendChild(rot);
    g.appendChild(txt(cx, cy, 'M', 'mb-t'));
    g.addEventListener('click', (e)=>{ e.stopPropagation(); UI.faceplate(tag); });
    ctx.S.appendChild(g);
    ctx.reg.push(()=>{ const st=mstate(tag); g.setAttribute('class','mim-motor '+st);
      const run=PLC.read(tag+'_RUN'); g.firstChild.textContent = `${tag} · ${PLC.motorMeta(tag).desc} — ${st.toUpperCase()}${run?` · ${Math.round(PLC.read(tag+'_CURRENT'))}A · ${Math.round(PLC.read(tag+'_SPEED'))}%`:''}`; });
  }

  /* ================================================================
     EQUIPMENT SYMBOLS  (no internal labels — diagram places them)
     ================================================================ */
  function silo(ctx, x, y, w, h, tag, opts={}){
    const cone = opts.cone !== false;
    const coneH = cone ? Math.min(h*0.2, 22) : 5;
    const bodyH = h - coneH;
    const id = 'clip'+(uid++);
    const path = `M${x},${y+7} q0,-7 ${w/2},-7 q${w/2},0 ${w/2},7 L${x+w},${y+bodyH} L${x+w/2},${y+h} L${x},${y+bodyH} Z`;
    ctx.defs.appendChild(E('clipPath', { id }, E('path', { d:path })));
    ctx.S.appendChild(E('path', { class:'eq-body', d:path }));
    const fill = E('rect', { class:'eq-grain', x, y, width:w, height:0, 'clip-path':`url(#${id})` });
    ctx.S.appendChild(fill);
    // graduation marks
    for (let i=1;i<=3;i++) ctx.S.appendChild(E('line',{class:'eq-line',x1:x,y1:y+bodyH*i/4,x2:x+6,y2:y+bodyH*i/4,'stroke-width':1}));
    ctx.S.appendChild(E('path', { class:'eq-line', d:path, fill:'none' }));
    const pct = txt(x+w/2, opts.noGrain?y+bodyH*0.5:y+bodyH*0.42, '', 'eq-label', { 'text-anchor':'middle' }); pct.style.fill='#fff';
    ctx.S.appendChild(pct);
    const gl = opts.noGrain ? null : txt(x+w/2, y+bodyH*0.42+15, '', 'eq-sub', { 'text-anchor':'middle' });
    if (gl){ gl.style.fill='#fff'; gl.style.opacity='.85'; ctx.S.appendChild(gl); }
    ctx.reg.push(()=>{ const lvl=PLC.read(tag+'_LEVEL'); const fh=h*lvl/100;
      fill.setAttribute('y', y+h-fh); fill.setAttribute('height', fh);
      pct.textContent=Math.round(lvl)+'%'; if (gl) gl.textContent=PLC.GRAIN_TYPES[PLC.read(tag+'_GRAIN')]||''; });
  }

  function elevator(ctx, x, y, w, h, tag, opts={}){
    const g = E('g', { class:'eq-state' });
    g.appendChild(E('rect', { class:'eq-housing', x, y, width:w, height:h, rx:3 }));
    g.appendChild(E('circle', { class:'eq-roll', cx:x+w/2, cy:y+11, r:7 }));
    g.appendChild(E('circle', { class:'eq-roll', cx:x+w/2, cy:y+h-11, r:7 }));
    g.appendChild(E('line', { class:'mim-belt', x1:x+w/2-5, y1:y+11, x2:x+w/2-5, y2:y+h-11 }));
    g.appendChild(E('line', { class:'mim-belt', x1:x+w/2+5, y1:y+11, x2:x+w/2+5, y2:y+h-11 }));
    ctx.S.appendChild(g);
    motor(ctx, x+w+12, y+11, tag);
    ctx.reg.push(()=>g.setAttribute('class','eq-state '+mstate(tag)));
  }

  function drag(ctx, x, y, len, tag, opts={}){
    const hgt=20; const g=E('g',{class:'eq-state'});
    g.appendChild(E('rect',{class:'eq-housing',x,y,width:len,height:hgt,rx:3}));
    g.appendChild(E('circle',{class:'eq-roll',cx:x+10,cy:y+hgt/2,r:7}));
    g.appendChild(E('circle',{class:'eq-roll',cx:x+len-10,cy:y+hgt/2,r:7}));
    g.appendChild(E('line',{class:'mim-belt',x1:x+10,y1:y+5,x2:x+len-10,y2:y+5}));
    g.appendChild(E('line',{class:'mim-belt',x1:x+10,y1:y+hgt-5,x2:x+len-10,y2:y+hgt-5}));
    ctx.S.appendChild(g);
    const m=opts.motorAt || [x+len+12, y+hgt/2];
    motor(ctx, m[0], m[1], tag);
    ctx.reg.push(()=>g.setAttribute('class','eq-state '+mstate(tag)));
  }

  function auger(ctx, x, y, len, tag, opts={}){
    const hgt=18; const g=E('g',{class:'eq-state'});
    g.appendChild(E('rect',{class:'eq-housing',x,y,width:len,height:hgt,rx:hgt/2}));
    let d=`M${x+5},${y+hgt/2}`; for (let sx=x+5; sx<x+len-5; sx+=11){ d+=` q5.5,-${hgt/2-3} 11,0 q5.5,${hgt/2-3} 11,0`; }
    g.appendChild(E('path',{class:'mim-screw',d}));
    ctx.S.appendChild(g);
    const m=opts.motorAt || [x+len+12, y+hgt/2];
    motor(ctx, m[0], m[1], tag);
    ctx.reg.push(()=>g.setAttribute('class','eq-state '+mstate(tag)));
  }

  function rollStand(ctx, x, y, tag, opts={}){
    const w=76, h=58; const g=E('g',{class:'eq-state'});
    g.appendChild(E('path',{class:'eq-body',d:`M${x+14},${y} L${x+w-14},${y} L${x+w-26},${y+16} L${x+26},${y+16} Z`}));
    g.appendChild(E('rect',{class:'eq-body',x:x+8,y:y+16,width:w-16,height:h-16,rx:4}));
    const r=11;
    const mk=(ox)=>{ const rg=E('g'); rg.appendChild(E('circle',{class:'eq-roll',cx:x+w/2+ox,cy:y+36,r}));
      rg.appendChild(E('line',{x1:x+w/2+ox,y1:y+36-r,x2:x+w/2+ox,y2:y+36+r,stroke:'var(--mim-eq-stroke)','stroke-width':1.4})); return rg; };
    const rl=mk(-10), rr=mk(10); g.appendChild(rl); g.appendChild(rr);
    g.appendChild(E('path',{class:'eq-line',d:`M${x+26},${y+h} L${x+w/2},${y+h+12} L${x+w-26},${y+h}`}));
    ctx.S.appendChild(g);
    motor(ctx, x+w+1, y+30, tag);
    ctx.reg.push(()=>{ const st=mstate(tag); g.setAttribute('class','eq-state '+st);
      rl.setAttribute('class', st==='run'?'mim-spin':''); rr.setAttribute('class', st==='run'?'mim-spin':''); });
    return { w, h };
  }

  function sifter(ctx, x, y, w, h, tag, opts={}){
    const g=E('g',{class:'eq-state'});
    g.appendChild(E('rect',{class:'eq-housing',x,y,width:w,height:h,rx:5}));
    const n=Math.max(3,Math.round(h/16));
    for (let i=1;i<n;i++) g.appendChild(E('line',{class:'eq-line',x1:x+8,y1:y+i*h/n,x2:x+w-8,y2:y+i*h/n,'stroke-width':1}));
    const gy=E('g'); gy.appendChild(E('circle',{class:'eq-roll',cx:x+w/2,cy:y+h/2,r:7}));
    gy.appendChild(E('circle',{cx:x+w/2+3.5,cy:y+h/2,r:2.5,fill:'var(--mim-eq-stroke)'}));
    g.appendChild(gy);
    ctx.S.appendChild(g);
    motor(ctx, opts.motorAt?opts.motorAt[0]:x+w+12, opts.motorAt?opts.motorAt[1]:y+13, tag);
    ctx.reg.push(()=>{ const st=mstate(tag); g.setAttribute('class','eq-state '+st); gy.setAttribute('class', st==='run'?'mim-spin':''); });
  }

  function purifier(ctx, x, y, w, h, tag, opts={}){
    const g=E('g',{class:'eq-state'});
    g.appendChild(E('rect',{class:'eq-housing',x,y,width:w,height:h,rx:4,transform:`rotate(-3 ${x+w/2} ${y+h/2})`}));
    for (let i=1;i<=3;i++) g.appendChild(E('line',{class:'eq-line',x1:x+6,y1:y+i*h/4,x2:x+w-6,y2:y+i*h/4,'stroke-width':1}));
    ctx.S.appendChild(g);
    motor(ctx, x+w+12, y+12, tag);
    ctx.reg.push(()=>g.setAttribute('class','eq-state '+mstate(tag)));
  }

  function fan(ctx, cx, cy, tag, opts={}){
    const r=opts.r||22; const g=E('g',{class:'eq-state'});
    g.appendChild(E('circle',{class:'eq-housing',cx,cy,r}));
    g.appendChild(E('rect',{class:'eq-housing',x:cx+r-3,y:cy-9,width:13,height:18,rx:2}));
    const imp=E('g'); for (let i=0;i<6;i++){ const a=i*60*Math.PI/180; imp.appendChild(E('line',{x1:cx,y1:cy,x2:cx+(r-5)*Math.cos(a),y2:cy+(r-5)*Math.sin(a),stroke:'var(--mim-eq-stroke)','stroke-width':2})); }
    imp.appendChild(E('circle',{cx,cy,r:4,class:'eq-roll'})); g.appendChild(imp);
    ctx.S.appendChild(g);
    motor(ctx, opts.motorAt?opts.motorAt[0]:cx, opts.motorAt?opts.motorAt[1]:cy+r+14, tag);
    ctx.reg.push(()=>{ const st=mstate(tag); g.setAttribute('class','eq-state '+st); imp.setAttribute('class', st==='run'?'mim-spin':''); });
  }

  function pump(ctx, cx, cy, tag, opts={}){
    const r=13; const g=E('g',{class:'eq-state'});
    g.appendChild(E('circle',{class:'eq-housing',cx,cy,r}));
    const imp=E('path',{d:`M${cx},${cy} L${cx+r-3},${cy-6} L${cx+r-3},${cy+6} Z`,fill:'var(--mim-eq-stroke)'});
    g.appendChild(imp);
    ctx.S.appendChild(g);
    motor(ctx, opts.motorAt?opts.motorAt[0]:cx+r+12, opts.motorAt?opts.motorAt[1]:cy, tag, {r:9});
    ctx.reg.push(()=>{ const st=mstate(tag); g.setAttribute('class','eq-state '+st); imp.setAttribute('class', st==='run'?'mim-spin':''); });
  }

  function tank(ctx, x, y, w, h, opts={}){
    ctx.S.appendChild(E('rect',{class:'eq-housing',x,y,width:w,height:h,rx:4}));
    ctx.S.appendChild(E('rect',{class:opts.water?'eq-water':'eq-grain',x:x+2,y:y+h*0.38,width:w-4,height:h*0.62-2,rx:2}));
  }
  function hopper(ctx, x, y, w, h){
    ctx.S.appendChild(E('path',{class:'eq-body',d:`M${x},${y} L${x+w},${y} L${x+w*0.62},${y+h} L${x+w*0.38},${y+h} Z`}));
  }
  function distributor(ctx, x, y, tag){
    const g=E('g',{class:'eq-state'});
    g.appendChild(E('circle',{class:'eq-body',cx:x,cy:y,r:14}));
    g.appendChild(E('path',{class:'eq-line',d:`M${x-8},${y-3} L${x+8},${y-3} M${x},${y-3} L${x},${y+8}`}));
    ctx.S.appendChild(g);
    motor(ctx, x+22, y, tag, {r:9});
    ctx.reg.push(()=>g.setAttribute('class','eq-state '+mstate(tag)));
  }
  function zone(ctx, x, y, w, h, title){
    ctx.S.appendChild(E('rect',{class:'mim-zone-band',x,y,width:w,height:h,rx:8}));
    ctx.S.appendChild(txt(x+14,y+22,title,'mim-zone-title'));
  }
  function flowArrow(ctx, x, y, label, activeFn){
    const a=E('polygon',{class:'mim-arrow',points:`${x},${y-8} ${x+24},${y-8} ${x+24},${y-15} ${x+42},${y} ${x+24},${y+15} ${x+24},${y+8} ${x},${y+8}`});
    ctx.S.appendChild(a);
    if (label) ctx.S.appendChild(txt(x+21,y-21,label,'mim-streamlbl',{'text-anchor':'middle'}));
    if (activeFn) ctx.reg.push(()=>a.classList.toggle('active',!!activeFn()));
  }

  /* ================================================================
     DIAGRAM: SILO FILLING / INTAKE        P-101
     ================================================================ */
  function silos(){
    const ctx = build(1120, 430);
    titleBlock(ctx, 'P-101  ·  GRAIN INTAKE & SILO STORAGE', 'Tip pit → pre-cleaner → bucket elevator → distributor → storage silos');

    // ---- piping (drawn first, behind equipment) ----
    stream(ctx, [[96,338],[110,338]], R('M_IC1'));                       // tip → drag
    stream(ctx, [[250,344],[262,344],[262,344]], R('M_IC1'));            // drag → elevator boot
    stream(ctx, [[262,344],[266,344],[266,344]], R('M_IC1'), {arrow:false});
    stream(ctx, [[280,78],[280,68],[352,68],[352,92]], R('M_BE1'));      // elevator head → pre-cleaner
    stream(ctx, [[460,118],[510,118],[510,128]], R('M_PC1'));            // pre-cleaner → distributor
    // distribution header + drops into each silo
    const sx0=560, sp=88, sw=64, siloTop=176, headerY=150;
    stream(ctx, [[524,128],[524,headerY],[sx0+5*sp+sw/2,headerY]], R('M_DST'), {arrow:false});
    for (let i=0;i<6;i++){ const cx=sx0+i*sp+sw/2;
      stream(ctx, [[cx,headerY],[cx,siloTop]], ()=>PLC.read('M_DST_RUN')&&PLC.read('SP_FILL_TARGET')===i, {thin:true}); }
    // silo discharge → tempering
    stream(ctx, [[sx0+sw/2,328],[sx0+sw/2,388],[1048,388]], ()=>PLC.read('PV_FILL_TPH')>0.5);

    // ---- equipment ----
    hopper(ctx, 46, 300, 50, 38);
    drag(ctx, 110, 334, 140, 'M_IC1', {motorAt:[110+10, 334+20+15]});
    elevator(ctx, 264, 72, 30, 270, 'M_BE1');
    sifter(ctx, 352, 92, 108, 50, 'M_PC1', {motorAt:[460+12, 142]});
    fan(ctx, 540, 60, 'M_DEDUST', {r:16, motorAt:[540+30, 60]});
    distributor(ctx, 524, 118, 'M_DST');
    for (let i=0;i<6;i++) silo(ctx, sx0+i*sp, siloTop, sw, 152, 'S'+(i+1));

    // ---- labels (placed clear of equipment) ----
    lbl(ctx, 71, 358, 'TP-101', 'Tip Pit');
    lbl(ctx, 180, 392, 'DC-102', 'Intake Drag');
    lbl(ctx, 240, 64, 'BE-105', 'Elevator', 'end');
    lbl(ctx, 406, 84, 'CL-104', 'Pre-Cleaner');
    lbl(ctx, 540, 30, 'FN-103', 'Dedust', 'middle');
    lbl(ctx, 470, 118, 'DV-106', 'Distributor', 'start');
    for (let i=0;i<6;i++){ const cx=sx0+i*sp+sw/2;
      lbl(ctx, cx, 348, 'SI-11'+(i+1), null);
    }
    // grain-type sublabel below tag
    for (let i=0;i<6;i++){ const cx=sx0+i*sp+sw/2; const t=txt(cx,360,'','eq-name',{'text-anchor':'middle'}); ctx.S.appendChild(t);
      ctx.reg.push(()=>t.textContent=PLC.GRAIN_TYPES[PLC.read('S'+(i+1)+'_GRAIN')]||''); }
    flag(ctx, 1044, 382, 'DISCHARGE → P-201', 'end');

    // ---- instruments ----
    inst(ctx, 318, 330, 'WT', '101', {lead:[280,338]});          // intake weigh
    for (let i=0;i<6;i++){ const cx=sx0+i*sp+sw/2; inst(ctx, sx0+i*sp+sw+10, 210, 'LT', '11'+(i+1), {r:10, lead:[sx0+i*sp+sw, 210]}); }

    // ---- readouts (top-left lane, clear of equipment) ----
    readout(ctx, 18, 54, 150, 'INTAKE RATE  t/h', ()=>UI.num(PLC.read('PV_FILL_TPH'),1));
    readout(ctx, 18, 98, 150, 'DESTINATION', ()=>PLC.VESSELS[PLC.read('SP_FILL_TARGET')][1]);
    readout(ctx, 18, 142, 150, 'GRAIN TYPE', ()=>PLC.GRAIN_TYPES[PLC.read('SP_FILL_GRAIN')]);
    return wrap(ctx);
  }

  /* ================================================================
     DIAGRAM: GRAIN TEMPERING               P-201
     ================================================================ */
  function temper(){
    const ctx = build(1160, 450);
    titleBlock(ctx, 'P-201  ·  GRAIN TEMPERING / CONDITIONING', 'Weigher → dampener (water addition) → elevator → temper bins → screw → mill');
    const tRun = ()=>PLC.read('LINE_TEMPER_RUN');

    const binX=[490,640,790,940], binW=110, binTop=120, binBot=250;
    // ---- piping ----
    stream(ctx, [[40,168],[100,168]], tRun);                              // from silos → weigher
    stream(ctx, [[130,190],[150,190],[150,196]], tRun);                   // weigher → dampener
    stream(ctx, [[250,86],[250,110]], R('M_WP1'), {water:true,thin:true});// tank → pump
    stream(ctx, [[250,124],[250,150],[210,150],[210,184]], R('M_WP1'), {water:true,thin:true}); // pump → dampener
    stream(ctx, [[370,196],[392,196],[392,330],[404,330]], R('M_DAMP')); // dampener → elevator boot
    stream(ctx, [[440,130],[460,130],[460,120]], R('M_BE2'), {arrow:false});
    stream(ctx, [[440,120],[480,120],[480,binTop]], R('M_BE2'), {arrow:false}); // elevator head → header
    const hdrY=104; stream(ctx, [[440,118],[440,hdrY],[binX[3]+binW/2,hdrY]], R('M_BE2'), {arrow:false});
    binX.forEach((bx)=>stream(ctx, [[bx+binW/2,hdrY],[bx+binW/2,binTop]], R('M_BE2'), {thin:true}));
    // bins → screws
    const scY=322;
    [0,1].forEach(i=>stream(ctx, [[binX[i]+binW/2,binBot],[binX[i]+binW/2,scY]], R('M_TC1'), {thin:true}));
    [2,3].forEach(i=>stream(ctx, [[binX[i]+binW/2,binBot],[binX[i]+binW/2,scY]], R('M_TC2'), {thin:true}));
    stream(ctx, [[binX[1]+binW/2,scY+9],[binX[1]+binW/2+40,scY+9]], tRun, {arrow:false});
    stream(ctx, [[binX[3]+binW/2,scY+9],[1058,scY+9],[1058,scY+9]], tRun, {arrow:false});
    stream(ctx, [[1050,scY],[1090,scY]], tRun);                           // → milling

    // ---- equipment ----
    hopper(ctx, 70, 120, 60, 34);
    tank(ctx, 222, 50, 56, 36, {water:true});
    pump(ctx, 250, 117, 'M_WP1', {motorAt:[250+24, 117]});
    auger(ctx, 150, 184, 220, 'M_DAMP', {motorAt:[150+220+12, 184+9]});
    elevator(ctx, 404, 120, 30, 222, 'M_BE2');
    binX.forEach((bx,i)=>silo(ctx, bx, binTop, binW, binBot-binTop, 'TB'+(i+1), {cone:false}));
    auger(ctx, binX[0]+binW/2, scY, 240, 'M_TC1', {motorAt:[binX[0]+binW/2-12, scY+9]});
    auger(ctx, binX[2]+binW/2, scY, 240, 'M_TC2', {motorAt:[binX[2]+binW/2-12, scY+9]});

    // ---- labels ----
    lbl(ctx, 100, 172, 'WH-201', null, 'middle');
    lbl(ctx, 214, 60, 'TK-203', 'Water', 'end');
    lbl(ctx, 230, 232, 'MX-202', 'Dampener', 'middle');
    lbl(ctx, 419, 112, 'BE-205', null, 'end');
    binX.forEach((bx,i)=>lbl(ctx, bx+binW/2, binTop-10, 'TB-21'+(i+1), 'Temper Bin '+(i+1)));
    lbl(ctx, binX[0]+binW/2+108, scY+34, 'SC-216', 'Screw', 'middle');
    lbl(ctx, binX[2]+binW/2+108, scY+34, 'SC-217', 'Screw', 'middle');
    flag(ctx, 38, 150, 'FROM P-101');
    flag(ctx, 1140, scY+3, '→ P-301 MILLING', 'end');

    // ---- instruments ----
    inst(ctx, 100, 132, 'WT', '201', {lead:[100,120]});
    inst(ctx, 392, 250, 'MT', '202', {lead:[392,210]});          // outlet moisture on riser
    inst(ctx, 250, 150, 'FT', '204', {r:10, lead:[230,150]});    // water flow
    binX.forEach((bx,i)=>inst(ctx, bx+binW-2, binTop+16, 'LT', '21'+(i+1), {r:9, lead:[bx+binW, binTop+16]}));

    // ---- readouts (top-right lane) ----
    readout(ctx, 640, 22, 156, 'INLET MOISTURE  %', ()=>UI.num(PLC.read('PV_INLET_MOIST'),1));
    readout(ctx, 808, 22, 156, 'TEMPERED  %', ()=>UI.num(PLC.read('PV_TEMPER_MOIST'),1));
    readout(ctx, 976, 22, 156, 'WATER  L/min', ()=>UI.num(PLC.read('PV_WATER_LPM'),1));
    return wrap(ctx, [['var(--run)','Running'],['var(--stop)','Stopped'],['var(--alarm)','Fault'],['var(--grain)','Grain flow'],['var(--water)','Water addition']]);
  }

  /* ================================================================
     DIAGRAM: MILLING                       P-301
     ================================================================ */
  function mill(){
    const ctx = build(1200, 470);
    titleBlock(ctx, 'P-301  ·  ROLLER MILLING', 'Break → plansifter → reduction → purifier → pneumatic lift → packing');

    const rollX=[90,250,420,580], rollTopY=104, rollBotY=178;
    const sifX=90, sifY=250, sifW=510, sifH=66;
    // ---- piping ----
    stream(ctx, [[44,92],[rollX[0]+38,92],[rollX[0]+38,rollTopY]], ()=>PLC.read('LINE_MILL_RUN')); // feed → B1
    const rollTags=['M_B1','M_B2','M_C1','M_C2'];
    rollX.forEach((rx,i)=>stream(ctx, [[rx+38,rollBotY],[rx+38,sifY]], R(rollTags[i]), {thin:true}));   // rolls → sifter
    stream(ctx, [[sifX+sifW,sifY+sifH/2],[680,sifY+sifH/2]], R('M_SIFT'));                              // sifter → purifier
    stream(ctx, [[776,sifY+sifH/2],[810,sifY+sifH/2],[810,358],[840,358]], R('M_PUR'));                 // purifier → packing
    stream(ctx, [[880,150],[880,sifY-6]], R('M_PNF'), {thin:true, arrow:false});                        // fan lift duct
    stream(ctx, [[960,366],[988,366]], R('M_PACK'));                                                    // packing → flour bag
    stream(ctx, [[rollX[1]+38,sifY+sifH],[rollX[1]+38,402],[598,402]], ()=>PLC.read('PV_MILL_TPH')>0.5);// bran out

    // ---- equipment ----
    rollX.forEach((rx,i)=>rollStand(ctx, rx, rollTopY, rollTags[i]));
    sifter(ctx, sifX, sifY, sifW, sifH, 'M_SIFT', {motorAt:[sifX+sifW+12, sifY+14]});
    purifier(ctx, 680, sifY, 96, sifH, 'M_PUR');
    fan(ctx, 880, 124, 'M_PNF', {r:22, motorAt:[880, 124+22+13]});
    auger(ctx, 840, 358, 120, 'M_PACK', {motorAt:[840-12, 367]});
    ctx.S.appendChild(E('rect',{class:'eq-grain',x:990,y:354,width:22,height:26,rx:2}));

    // ---- labels ----
    const rollNames=['1st Break','2nd Break','1st Reduction','2nd Reduction'];
    const rollNo=['RM-301','RM-302','RM-303','RM-304'];
    rollX.forEach((rx,i)=>lbl(ctx, rx+38, rollTopY-10, rollNo[i], rollNames[i]));
    lbl(ctx, 209, sifY-10, 'PS-305 · Plansifter', null, 'middle');
    lbl(ctx, 728, sifY-10, 'PR-306', 'Purifier', 'middle');
    lbl(ctx, 880, 124-32, 'FN-307', 'Pneumatic Fan', 'middle');
    lbl(ctx, 900, 392, 'PK-308', 'Packing', 'middle');
    flag(ctx, 14, 110, 'FROM P-201');
    flag(ctx, 1001, 398, '→ FLOUR', 'middle');
    flag(ctx, 606, 406, '→ BRAN / OFFAL');

    // ---- instruments ----
    inst(ctx, 70, 74, 'WT', '301', {r:10, lead:[90, 92]});
    inst(ctx, 810, 326, 'QT', '305', {r:10, lead:[810, 350]});

    // ---- readouts (top-right lane) ----
    readout(ctx, 720, 22, 150, 'MILL RATE  t/h', ()=>UI.num(PLC.read('PV_MILL_TPH'),1));
    readout(ctx, 884, 22, 150, 'EXTRACTION  %', ()=>UI.num(PLC.read('PV_EXTRACTION'),0));
    readout(ctx, 1048, 22, 138, 'FLOUR ASH  %', ()=>UI.num(PLC.read('PV_ASH'),2));
    return wrap(ctx);
  }

  /* ================================================================
     DIAGRAM: WHOLE PLANT OVERVIEW
     ================================================================ */
  function plant(){
    const ctx = build(1280, 480);
    titleBlock(ctx, 'GRAIN HANDLING & FLOUR MILLING — PROCESS OVERVIEW', 'Wheat intake → storage → tempering → milling → flour & bran');
    zone(ctx,20,64,392,372,'P-101  INTAKE & STORAGE');
    zone(ctx,432,64,360,372,'P-201  TEMPERING');
    zone(ctx,812,64,448,372,'P-301  MILLING');
    flowArrow(ctx,414,206,'Cleaned',R('M_DST'));
    flowArrow(ctx,786,206,'Tempered',R('M_BE2'));
    flag(ctx,36,58,'↓ WHEAT INTAKE');

    // ---- INTAKE ----
    stream(ctx,[[150,360],[150,150]],R('M_BE1'),{thin:true,arrow:false});
    stream(ctx,[[165,150],[206,150]],R('M_PC1'),{thin:true});
    stream(ctx,[[300,168],[300,150],[330,150],[330,196]],R('M_DST'),{thin:true});
    hopper(ctx,44,332,38,26);
    drag(ctx,80,338,62,'M_IC1',{motorAt:[90,372]});
    elevator(ctx,136,118,26,248,'M_BE1');
    sifter(ctx,206,128,80,38,'M_PC1',{motorAt:[206+80+11,142]});
    distributor(ctx,300,168,'M_DST');
    silo(ctx,288,206,30,116,'S1',{noGrain:true}); silo(ctx,330,206,30,116,'S2',{noGrain:true}); silo(ctx,372,206,28,116,'S3',{noGrain:true});
    lbl(ctx,330,338,'SI-111/3',null,'middle');
    readout(ctx,40,392,196,'INTAKE  t/h',()=>UI.num(PLC.read('PV_FILL_TPH'),1));

    // ---- TEMPERING ----
    tank(ctx,446,92,34,26,{water:true}); pump(ctx,520,118,'M_WP1',{motorAt:[520+22,118]});
    stream(ctx,[[520,105],[520,150],[496,150],[496,172]],R('M_WP1'),{water:true,thin:true});
    auger(ctx,448,172,148,'M_DAMP',{motorAt:[448+148+11,181]});
    stream(ctx,[[596,181],[618,181],[618,330],[628,330]],R('M_DAMP'),{thin:true});
    elevator(ctx,624,120,26,230,'M_BE2');
    stream(ctx,[[650,150],[686,150]],R('M_BE2'),{thin:true});
    silo(ctx,686,150,44,120,'TB1',{cone:false,noGrain:true}); silo(ctx,734,150,44,120,'TB2',{cone:false,noGrain:true});
    lbl(ctx,520,204,'MX-202',null,'middle');
    lbl(ctx,710,140,'TB-211/2',null,'middle');
    readout(ctx,448,392,150,'TEMPER MOIST  %',()=>UI.num(PLC.read('PV_TEMPER_MOIST'),1));

    // ---- MILLING ----
    stream(ctx,[[878,168],[878,196]],R('M_B1'),{thin:true});
    stream(ctx,[[878,232],[920,256]],R('M_B1'),{thin:true,arrow:false});
    stream(ctx,[[998,196],[998,168]],R('M_C1'),{thin:true,arrow:false});
    stream(ctx,[[1080,286],[1140,286]],R('M_SIFT'),{thin:true});
    rollStand(ctx,840,128,'M_B1'); rollStand(ctx,960,128,'M_C1');
    sifter(ctx,840,256,236,58,'M_SIFT',{motorAt:[840+236+11,270]});
    purifier(ctx,1140,256,64,58,'M_PUR');
    fan(ctx,1180,150,'M_PNF',{r:18,motorAt:[1180,150+18+12]});
    lbl(ctx,878,118,'RM-301',null,'middle'); lbl(ctx,998,118,'RM-303',null,'middle');
    lbl(ctx,958,250,'PS-305',null,'middle');
    lbl(ctx,1172,236,'PR-306',null,'middle');
    flag(ctx,1150,360,'→ FLOUR'); flag(ctx,1150,384,'→ BRAN');
    readout(ctx,840,392,150,'MILL RATE  t/h',()=>UI.num(PLC.read('PV_MILL_TPH'),1));
    readout(ctx,1008,392,150,'FLOUR  t',()=>UI.num(PLC.read('CNT_FLOUR_TODAY'),1));
    return wrap(ctx);
  }

  return { silos, temper, mill, plant };
})();
window.MIMIC = MIMIC;

/* ====================================================================
   components.js — reusable HMI widgets (vanilla DOM, no framework)
   ==================================================================== */
const UI = (() => {

  /* tiny DOM helper */
  function el(tag, attrs = {}, ...children){
    const n = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)){
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const c of children.flat()){
      if (c == null || c === false) continue;
      n.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return n;
  }

  function num(v, d=1){ return (v==null||isNaN(v)) ? '–' : Number(v).toFixed(d); }

  /* --------------------------------------------------------------- motor */
  function motor(tag){
    const meta = PLC.motorMeta(tag);
    const run = PLC.read(tag+'_RUN'), fault = PLC.read(tag+'_FAULT'), auto = PLC.read(tag+'_AUTO');
    const cls = fault ? 'fault' : run ? 'run' : '';
    const node = el('div', { class: 'motor ' + cls, 'data-motor': tag,
                             onclick: () => faceplate(tag) },
      el('div', { class: 'm-ic' }, 'M'),
      el('div', { class: 'm-body' },
        el('div', { class: 'm-tag' }, tag.replace('M_','')),
        el('div', { class: 'm-desc' }, meta.desc),
        el('div', { class: 'm-meta' },
          fault ? 'FAULT' : run ? `${num(PLC.read(tag+'_CURRENT'),1)}A · ${num(PLC.read(tag+'_SPEED'),0)}%` : 'Stopped'),
      ),
      el('span', { class: 'm-mode ' + (auto?'auto':'manual') }, auto?'A':'M'),
    );
    return node;
  }

  /* --------------------------------------------------- motor faceplate modal */
  function faceplate(tag){
    const meta = PLC.motorMeta(tag);
    const overlay = document.getElementById('modal-root');
    function render(){
      const run = PLC.read(tag+'_RUN'), fault = PLC.read(tag+'_FAULT'), auto = PLC.read(tag+'_AUTO');
      const cls = fault ? 'fault' : run ? 'run' : '';
      overlay.innerHTML = '';
      overlay.appendChild(el('div', { class: 'modal' },
        el('div', { class: 'modal-head ' + cls },
          el('div', { class: 'm-ic' }, 'M'),
          el('h3', {}, tag.replace('M_',''), el('small', {}, meta.desc)),
          el('button', { class:'x', onclick: close }, '×'),
        ),
        el('div', { class: 'modal-body' },
          /* status row */
          el('div', { class:'kv-grid', style:'margin-bottom:16px' },
            kv('Status', fault?'FAULTED':run?'RUNNING':'STOPPED'),
            kv('Mode', auto?'AUTO':'MANUAL'),
            kv('Current', num(PLC.read(tag+'_CURRENT'),1)+' A  / '+meta.flc+' A FLC'),
            kv('Speed', num(PLC.read(tag+'_SPEED'),0)+' %'),
          ),

          el('div', { class:'modal-section-title' }, 'Control'),
          el('div', { class:'ctl-row' },
            el('span', { class:'lbl' }, 'Operating mode'),
            seg(auto, (a) => { PLC.write(tag+'_AUTO', a); toast(`${tag} → ${a?'AUTO':'MANUAL'}`); render(); }),
          ),
          el('div', { class:'ctl-row' },
            el('span', { class:'lbl' }, 'Manual command'),
            el('button', { class:'btn run', disabled: auto||fault||run,
              onclick: () => { PLC.write(tag+'_CMD', true); render(); } }, '▶ Start'),
            el('button', { class:'btn stop', disabled: auto|| !run,
              onclick: () => { PLC.write(tag+'_CMD', false); render(); } }, '■ Stop'),
            fault
              ? el('button', { class:'btn', onclick: () => { PLC.resetFault(tag); toast(`${tag} fault reset`,'good'); render(); } }, '⟳ Reset')
              : el('button', { class:'btn ghost', onclick: () => { PLC.injectFault(tag); toast(`${tag} fault (sim)`,'bad'); render(); } }, 'Sim Fault'),
          ),
          auto ? el('div', { class:'muted', style:'font-size:11px;margin:-6px 0 10px' },
                  'Motor is in AUTO — controlled by the line sequence. Switch to MANUAL for local start/stop.') : null,

          el('div', { class:'modal-section-title' }, 'Runtime & Maintenance'),
          el('div', { class:'kv-grid' },
            kv('Number of Starts', PLC.read(tag+'_STARTS').toLocaleString()),
            kv('Run Hours', num(PLC.read(tag+'_RUNHRS'),1)+' h'),
            kv('Winding Temp', num(PLC.read(tag+'_TEMP'),0)+' °C'),
            kv('Service Due', serviceDue(PLC.read(tag+'_RUNHRS'))),
          ),

          el('div', { class:'modal-section-title' }, 'Motor Nameplate / Specifications'),
          el('div', { class:'kv-grid' },
            kv('Rated Power', meta.kW+' kW'),
            kv('Voltage', meta.V+' V  3~ 50Hz'),
            kv('Poles', meta.poles+' pole'),
            kv('Synchronous Speed', meta.syncRpm+' rpm'),
            kv('Rated Speed', meta.rpm+' rpm'),
            kv('Full Load Current', meta.flc+' A'),
            kv('Frame Size', meta.frame),
            kv('Service Factor', meta.sf),
            kv('Starter Type', meta.vsd ? 'Variable Speed Drive (VSD)' : 'Direct-on-Line / Soft-start'),
            kv('Slip', num((meta.syncRpm-meta.rpm)/meta.syncRpm*100,1)+' %'),
          ),
          el('div', { style:'margin-top:14px;text-align:right' },
            el('span', { class:'tag-chip' }, PLC.tags[tag+'_RUN'].addr.replace('.Run','')),
          ),
        ),
      ));
    }
    function close(){ overlay.classList.remove('show'); off(); }
    const off = PLC.onUpdate((n) => { if (n.startsWith(tag) || n==='__conn__') render(); });
    render();
    overlay.classList.add('show');
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
  }
  function serviceDue(hrs){ const next = Math.ceil(hrs/4000)*4000; return (next-hrs).toFixed(0)+' h ('+next+'h svc)'; }

  function kv(k, v){ return el('div', { class:'kv' }, el('div',{class:'k'},k), el('div',{class:'v'}, String(v))); }

  function seg(isAuto, onChange){
    const wrap = el('div', { class:'seg-ctl' });
    const a = el('button', { class:'auto'+(isAuto?' active auto':''), onclick:()=>onChange(true) }, 'AUTO');
    const m = el('button', { class:'manual'+(!isAuto?' active manual':''), onclick:()=>onChange(false) }, 'MANUAL');
    wrap.append(a, m); return wrap;
  }

  /* --------------------------------------------------------------- silo */
  function silo(tag){
    const v = PLC.vessel(tag);
    const lvl = PLC.read(tag+'_LEVEL');
    const grainId = PLC.read(tag+'_GRAIN');
    const cap = PLC.tags[tag+'_LEVEL'].cap;
    const hi = PLC.read('CFG_SILO_HI'), lo = PLC.read('CFG_SILO_LO');
    const stateCls = lvl>=hi ? 'high' : (lvl<=lo && v[2]==='silos') ? 'low' : '';
    const isWater = v[2] !== 'silos' && false;
    return el('div', { class:'vessel-card' },
      el('div', { class:'silo '+stateCls },
        el('div', { class:'shell' },
          el('div', { class:'fill'+(isWater?' water':''), style:`height:${lvl}%` }),
        ),
        el('div', { class:'pct' }, num(lvl,0)+'%'),
      ),
      el('div', { class:'vtag' }, v[1]),
      el('div', { class:'vgrain' }, PLC.GRAIN_TYPES[grainId] || '—'),
      el('div', { class:'vsub' }, num(lvl/100*cap,1)+' / '+cap+' t'),
    );
  }

  /* --------------------------------------------------------------- gauge */
  function gauge(value, min, max, label, unit, color){
    const r = 46, cx = 60, cy = 60;
    const a0 = Math.PI*0.75, a1 = Math.PI*2.25; // 270° sweep
    const frac = Math.max(0, Math.min(1, (value-min)/(max-min)));
    const ang = a0 + (a1-a0)*frac;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns,'svg');
    svg.setAttribute('width','120'); svg.setAttribute('height','96'); svg.setAttribute('viewBox','0 6 120 84');
    function arc(a0,a1,stroke,w){
      const p = document.createElementNS(ns,'path');
      const x0=cx+r*Math.cos(a0), y0=cy+r*Math.sin(a0), x1=cx+r*Math.cos(a1), y1=cy+r*Math.sin(a1);
      const large = (a1-a0) > Math.PI ? 1 : 0;
      p.setAttribute('d',`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`);
      p.setAttribute('fill','none'); p.setAttribute('stroke',stroke); p.setAttribute('stroke-width',w); p.setAttribute('stroke-linecap','round');
      return p;
    }
    svg.appendChild(arc(a0,a1,'#2a3340',9));
    svg.appendChild(arc(a0,ang,color||'#2f81f7',9));
    const wrap = el('div', { class:'gauge' });
    wrap.appendChild(svg);
    wrap.appendChild(el('div', { class:'g-val', style:`color:${color||'#2f81f7'}` }, num(value, value<10?1:0)+(unit?'':''), el('span',{style:'font-size:11px;color:var(--txt-mute)'},unit?(' '+unit):'')));
    wrap.appendChild(el('div', { class:'g-lbl' }, label));
    return wrap;
  }

  /* --------------------------------------------------------------- setpoint row */
  function setpoint(opts){
    // {label, sub, tag, pvTag, unit, min, max, step, decimals, onWrite}
    const dec = opts.decimals ?? 1;
    const input = el('input', { type:'number', value: num(PLC.read(opts.tag), dec),
      min: opts.min, max: opts.max, step: opts.step });
    const commit = () => {
      let v = parseFloat(input.value);
      if (isNaN(v)) v = PLC.read(opts.tag);
      v = Math.max(opts.min ?? -Infinity, Math.min(opts.max ?? Infinity, v));
      PLC.write(opts.tag, v); input.value = num(v, dec);
      toast(`${opts.label} setpoint → ${num(v,dec)} ${opts.unit||''}`,'good');
      if (opts.onWrite) opts.onWrite(v);
    };
    input.addEventListener('change', commit);
    const step = opts.step || 1;
    const row = el('div', { class:'sp-row' },
      el('div', { class:'sp-label' }, el('b',{},opts.label), opts.sub?el('span',{},opts.sub):null),
      opts.pvTag ? el('div', { class:'sp-pv', 'data-pv': opts.pvTag },
        'PV ', el('b',{}, num(PLC.read(opts.pvTag), dec)), ' '+(opts.unit||'')) : null,
      el('div', { class:'sp-input' },
        el('button', { onclick:()=>{ input.value = num(parseFloat(input.value)-step,dec); commit(); } }, '–'),
        input,
        el('span', { class:'unit' }, opts.unit||''),
        el('button', { onclick:()=>{ input.value = num(parseFloat(input.value)+step,dec); commit(); } }, '+'),
      ),
    );
    return row;
  }

  /* --------------------------------------------------------------- trend chart */
  function trend(series, opts={}){
    // series: [{data:[], color, label}]
    const w = opts.w||560, h = opts.h||120, pad=4;
    const ns='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(ns,'svg');
    svg.setAttribute('class','trend'); svg.setAttribute('viewBox',`0 0 ${w} ${h}`); svg.setAttribute('preserveAspectRatio','none');
    let max = opts.max ?? Math.max(1,...series.flatMap(s=>s.data));
    let min = opts.min ?? 0;
    // grid
    for (let i=0;i<=4;i++){
      const y=pad+(h-2*pad)*i/4;
      const l=document.createElementNS(ns,'line');
      l.setAttribute('x1',0);l.setAttribute('x2',w);l.setAttribute('y1',y);l.setAttribute('y2',y);
      l.setAttribute('stroke','#1c2330');l.setAttribute('stroke-width',1);svg.appendChild(l);
    }
    series.forEach(s=>{
      if(!s.data.length) return;
      const n=s.data.length;
      const pts=s.data.map((v,i)=>{
        const x=n>1?(w*i/(n-1)):0;
        const y=pad+(h-2*pad)*(1-(v-min)/(max-min||1));
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const pl=document.createElementNS(ns,'polyline');
      pl.setAttribute('points',pts);pl.setAttribute('fill','none');
      pl.setAttribute('stroke',s.color);pl.setAttribute('stroke-width',2);pl.setAttribute('stroke-linejoin','round');
      svg.appendChild(pl);
    });
    return svg;
  }

  /* --------------------------------------------------------------- bar chart */
  function barChart(data, opts={}){
    // data: [{label, value, color}]
    const max = Math.max(1, ...data.map(d=>d.value));
    return el('div', { class:'grid', style:'gap:9px' },
      data.map(d => el('div', {},
        el('div', { style:'display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px' },
          el('span',{},d.label), el('span',{class:'mono'}, num(d.value, opts.dec??1)+(opts.unit||''))),
        el('div', { class:'bar-track', style:'height:10px' },
          el('div', { class:'bar-fill', style:`width:${d.value/max*100}%;background:${d.color||'var(--accent)'}` })),
      )),
    );
  }

  /* --------------------------------------------------------------- donut */
  function donut(segments, opts={}){
    // segments [{value,color,label}]
    const total = segments.reduce((s,x)=>s+x.value,0)||1;
    const ns='http://www.w3.org/2000/svg', R=54, C=2*Math.PI*R;
    const svg=document.createElementNS(ns,'svg');
    svg.setAttribute('width','140');svg.setAttribute('height','140');svg.setAttribute('viewBox','0 0 140 140');
    let off=0;
    segments.forEach(s=>{
      const frac=s.value/total;
      const c=document.createElementNS(ns,'circle');
      c.setAttribute('cx',70);c.setAttribute('cy',70);c.setAttribute('r',R);
      c.setAttribute('fill','none');c.setAttribute('stroke',s.color);c.setAttribute('stroke-width',16);
      c.setAttribute('stroke-dasharray',`${C*frac} ${C*(1-frac)}`);
      c.setAttribute('stroke-dashoffset',-C*off);
      c.setAttribute('transform','rotate(-90 70 70)');
      svg.appendChild(c);off+=frac;
    });
    const center=el('div',{style:'position:absolute;inset:0;display:grid;place-items:center;text-align:center'},
      el('div',{},
        el('div',{class:'mono',style:'font-size:22px;font-weight:700'}, opts.centerVal??num(total,0)),
        el('div',{class:'muted',style:'font-size:10px'}, opts.centerLabel||'')));
    return el('div',{style:'position:relative;width:140px;height:140px;margin:0 auto'}, svg, center);
  }

  /* --------------------------------------------------------------- toast */
  let toastWrap;
  function toast(msg, kind=''){
    if (!toastWrap){ toastWrap = el('div',{class:'toast-wrap'}); document.body.appendChild(toastWrap); }
    const t = el('div', { class:'toast '+kind }, msg);
    toastWrap.appendChild(t);
    setTimeout(()=>{ t.style.transition='opacity .3s'; t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 2600);
  }

  return { el, num, motor, faceplate, silo, gauge, setpoint, trend, barChart, donut, toast, kv, seg };
})();
window.UI = UI;

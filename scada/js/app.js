/* ====================================================================
   app.js — application shell, router, and page renderers
   ==================================================================== */
(() => {
  const { el, num } = UI;
  const $ = (s) => document.querySelector(s);

  /* ---- navigation model ----------------------------------------- */
  const PAGES = [
    { id:'dashboard',label:'Dashboard',      ic:'▥',  group:'Operations' },
    { id:'process',  label:'Process Overview',ic:'⬡', group:'Operations' },
    { id:'silos',    label:'Silo Filling',   ic:'▤',  group:'Operations' },
    { id:'temper',   label:'Grain Tempering',ic:'💧', group:'Operations' },
    { id:'mill',     label:'Milling',        ic:'⚙',  group:'Operations' },
    { id:'reports',  label:'Reporting',      ic:'▦',  group:'Management' },
    { id:'settings', label:'Settings',       ic:'⚙', group:'Management' },
  ];

  let current = location.hash.replace('#','') || 'dashboard';
  let pageOff = null; // unsubscribe of current page live bindings

  /* ================================================================
     SHELL
     ================================================================ */
  function buildShell(){
    const cfg = PLC.getCfg();
    document.body.innerHTML = '';
    const nav = el('nav', { class:'nav' });
    let lastGroup = '';
    PAGES.forEach(p => {
      if (p.group !== lastGroup){ nav.appendChild(el('div',{class:'group-label'},p.group)); lastGroup=p.group; }
      nav.appendChild(el('a', { 'data-page':p.id, class: p.id===current?'active':'',
        onclick:()=>go(p.id) },
        el('span',{class:'ic'},p.ic), el('span',{},p.label),
        p.id==='overview'?el('span',{class:'badge hidden','data-alarmbadge':''},'0'):null));
    });

    const app = el('div', { id:'app' },
      el('div', { class:'brand' },
        el('div',{class:'logo'},'W'),
        el('div',{class:'title'},'Wyelec Mill SCADA', el('small',{},'Grain Handling & Flour Milling'))),
      el('div', { class:'topbar' },
        el('div',{class:'page-title','data-pagetitle':''}, ''),
        el('div',{class:'spacer'}),
        el('div',{class:'clock','data-clock':''},''),
        el('button',{class:'theme-toggle','data-themebtn':'',onclick:toggleTheme},''),
        connPill(),
        el('div',{class:'user-chip', onclick:()=>UI.toast('Logged in as Operator: '+currentOperator())},
          el('span',{class:'ava'}, currentOperator().split(/[ .]/).map(s=>s[0]).join('').slice(0,2)),
          el('span',{}, currentOperator())),
      ),
      nav,
      el('main', { class:'main', id:'page' }),
      el('div', { class:'statusbar' },
        el('div',{class:'seg'},'Site: ',el('b',{},cfg.site)),
        el('div',{class:'seg'},'Driver: ',el('b',{'data-drv':''},cfg.driver.toUpperCase())),
        el('div',{class:'seg'},'Scan: ',el('b',{},cfg.scanRateMs+'ms')),
        el('div',{class:'spacer'}),
        el('div',{class:'seg','data-alarmstat':''},'● No active alarms'),
      ),
    );
    document.body.appendChild(app);
    document.body.appendChild(el('div',{class:'modal-overlay',id:'modal-root'}));
    setTheme(currentTheme());
    tickClock();
  }

  function connPill(){
    return el('div', { class:'conn-pill','data-conn':'' },
      el('span',{class:'dot'}), el('span',{'data-conntext':''},'—'));
  }

  function updateConn(){
    const s = PLC.connection();
    const pill = $('[data-conn]'); if (!pill) return;
    pill.className = 'conn-pill ' + (s==='online'?'online': s==='sim'?'sim':'offline');
    const map = { online:'PLC ONLINE', sim:'SIMULATION', connecting:'CONNECTING…', offline:'OFFLINE' };
    $('[data-conntext]').textContent = map[s]||s;
    const drv=$('[data-drv]'); if(drv) drv.textContent = PLC.getCfg().driver.toUpperCase();
  }

  function tickClock(){
    const c=$('[data-clock]'); if(c) c.textContent = new Date().toLocaleString('en-AU',{hour12:false});
    setTimeout(tickClock, 1000);
  }

  function currentOperator(){ return localStorage.getItem('scada.operator') || PLC.OPERATORS[0]; }

  /* ---- theme (light / dark) ------------------------------------- */
  function currentTheme(){ return localStorage.getItem('scada.theme') || 'dark'; }
  function setTheme(t){
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('scada.theme', t);
    const btn=$('[data-themebtn]');
    if (btn) btn.innerHTML = t==='dark' ? '☀ Light' : '🌙 Dark';
  }
  function toggleTheme(){ setTheme(currentTheme()==='dark'?'light':'dark'); }

  /* ---- alarm banner / badge ------------------------------------- */
  function refreshAlarms(){
    const alarms = PLC.activeAlarms().sort((a,b)=> (a.sev===b.sev?0:a.sev==='alarm'?-1:1));
    const badge = $('[data-alarmbadge]');
    const stat = $('[data-alarmstat]');
    if (badge){ badge.textContent = alarms.length; badge.classList.toggle('hidden', alarms.length===0); }
    if (stat){
      if (!alarms.length){ stat.innerHTML='● No active alarms'; stat.style.color='var(--run)'; }
      else { const top=alarms[0]; stat.innerHTML='● '+alarms.length+' active — '+top.msg; stat.style.color=top.sev==='alarm'?'var(--alarm)':'var(--warn)'; }
    }
    // page-level banner
    const banner = $('[data-banner]');
    if (banner){
      const unack = alarms.filter(a=>!a.ack);
      if (!alarms.length){ banner.className='alarm-banner'; }
      else {
        const worst = alarms[0].sev;
        banner.className = 'alarm-banner show '+(worst==='warn'?'warn':'')+(unack.length?' blink':'');
        banner.innerHTML='';
        banner.append(
          el('span',{},'⚠'),
          el('span',{class:'count'},alarms.length),
          el('span',{}, alarms[0].msg + (alarms.length>1?` (+${alarms.length-1} more)`:'')),
          el('button',{class:'ack',onclick:()=>{PLC.ackAll();refreshAlarms();}},'ACK ALL'),
        );
      }
    }
  }

  /* ================================================================
     ROUTER
     ================================================================ */
  function go(id){
    current = id; location.hash = id;
    document.querySelectorAll('.nav a').forEach(a=>a.classList.toggle('active', a.dataset.page===id));
    render();
  }

  function render(){
    if (pageOff){ pageOff(); pageOff=null; }
    const main = $('#page');
    const page = PAGES.find(p=>p.id===current) || PAGES[0];
    $('[data-pagetitle]').innerHTML = page.label + ' <small>'+pageSub(current)+'</small>';
    main.innerHTML='';
    main.appendChild(el('div',{class:'alarm-banner','data-banner':''}));
    const fn = RENDER[current] || RENDER.dashboard;
    const ctx = { refresh: [] };
    main.appendChild(fn(ctx));
    // live binding: re-run lightweight refreshers on tag updates
    pageOff = PLC.onUpdate(() => { ctx.refresh.forEach(f=>{ try{f();}catch(e){} }); refreshAlarms(); updateConn(); });
    refreshAlarms(); updateConn();
  }

  function pageSub(id){
    return ({
      dashboard:'Live plant status, KPIs & area controls',
      process:'Whole-plant process diagram — intake to flour',
      silos:'Intake & silo filling — process mimic, blends & fill control',
      temper:'Grain conditioning — process mimic, moisture & dwell control',
      mill:'Roller milling — process mimic, rate, recipe & extraction',
      reports:'Production counters, recipe logs & operator KPIs',
      settings:'Background configuration & PLC connection',
    })[id]||'';
  }

  /* helper: a self-refreshing text node bound to a tag */
  function live(ctx, fn, node){ const upd=()=>{ const v=fn(); if(node.textContent!==v) node.textContent=v; }; ctx.refresh.push(upd); return node; }

  /* ================================================================
     PAGE: OVERVIEW
     ================================================================ */
  const RENDER = {};

  /* ---- a mimic panel wrapper used by several pages -------------- */
  function mimicPanel(ctx, title, builder, hint){
    const diag = builder();
    ctx.refresh.push(diag.refresh);
    return el('div',{class:'panel',style:'margin-bottom:16px'},
      el('div',{class:'panel-head'}, el('h2',{}, title), el('div',{class:'spacer'}),
        hint?el('span',{class:'hint'}, hint):null),
      diag.node);
  }

  RENDER.process = (ctx) => {
    const wrap = el('div');
    wrap.appendChild(mimicPanel(ctx,'Whole-Plant Process Diagram', MIMIC.plant,
      'Click any motor (M) for auto/manual control & specs'));
    // line state + sequence controls for all three areas
    const ctrl = el('div',{class:'grid cols-3'});
    [['Intake / Silo Filling','LINE_INTAKE_RUN'],
     ['Tempering','LINE_TEMPER_RUN'],
     ['Milling','LINE_MILL_RUN']].forEach(([title,tag])=>{
      ctrl.appendChild(el('div',{class:'panel'},
        el('div',{class:'panel-head'}, el('h2',{},title), el('div',{class:'spacer'}), lineStateChip(ctx,tag)),
        el('div',{style:'display:flex;gap:8px'},
          el('button',{class:'btn run sm',style:'flex:1',onclick:()=>{PLC.write(tag,true);UI.toast(title+' sequence STARTED','good');}},'▶ Start'),
          el('button',{class:'btn stop sm',style:'flex:1',onclick:()=>{PLC.write(tag,false);UI.toast(title+' sequence STOPPED','warn');}},'■ Stop'))));
    });
    wrap.appendChild(ctrl);
    return wrap;
  };

  RENDER.dashboard = (ctx) => {
    const wrap = el('div');
    // KPI tiles
    const tiles = el('div',{class:'grid cols-4',style:'margin-bottom:16px'});
    const mk=(label,fn,unit,kind,sub)=>{
      const v=el('div',{class:'value'}); const s=el('div',{class:'sub'},sub||'');
      const t=el('div',{class:'stat '+kind}, el('div',{class:'accent-bar'}),
        el('div',{class:'label'},label), v, s);
      ctx.refresh.push(()=>{ v.innerHTML=''; v.append(document.createTextNode(num(fn(),1)), el('small',{},unit)); });
      return t;
    };
    tiles.append(
      mk('Milling Rate', ()=>PLC.read('PV_MILL_TPH'),' t/h','good','Target '+num(PLC.read('SP_MILL_TPH'),0)+' t/h'),
      mk('Intake Rate', ()=>PLC.read('PV_FILL_TPH'),' t/h','grain','To '+PLC.VESSELS[PLC.read('SP_FILL_TARGET')][1]),
      mk('Extraction', ()=>PLC.read('PV_EXTRACTION'),' %','', 'Ash '+num(PLC.read('PV_ASH'),2)+'%'),
      mk('Flour Today', ()=>PLC.read('CNT_FLOUR_TODAY'),' t','good','Bran '+num(PLC.read('CNT_BRAN_TODAY'),1)+' t'),
    );
    wrap.appendChild(tiles);

    // three area panels
    const areas = el('div',{class:'grid cols-3'});
    areas.append(
      areaPanel(ctx,'Silo Filling','silos','LINE_INTAKE_RUN',['M_IC1','M_BE1','M_PC1','M_DST']),
      areaPanel(ctx,'Tempering','temper','LINE_TEMPER_RUN',['M_DAMP','M_WP1','M_TC1','M_BE2']),
      areaPanel(ctx,'Milling','mill','LINE_MILL_RUN',['M_B1','M_C1','M_SIFT','M_PNF']),
    );
    wrap.appendChild(areas);

    // trend
    const tpanel = el('div',{class:'panel',style:'margin-top:16px'},
      el('div',{class:'panel-head'},el('h2',{},'Live Trends — last 30 s'),el('div',{class:'spacer'}),
        el('div',{class:'legend'},
          legend('Mill t/h','#2ea043'),legend('Moisture %','#2f81f7'),legend('Extraction %','#c8a24b'))));
    const tnode = el('div'); tpanel.appendChild(tnode);
    ctx.refresh.push(()=>{ const tr=PLC.trends(); tnode.innerHTML='';
      tnode.appendChild(UI.trend([
        {data:tr.tph,color:'#2ea043'},
        {data:tr.moist,color:'#2f81f7'},
        {data:tr.extraction,color:'#c8a24b'},
      ],{max:100,h:130,w:1000})); });
    wrap.appendChild(tpanel);
    return wrap;
  };

  function legend(label,color){ return el('span',{class:'li'},el('span',{class:'sw',style:`background:${color}`}),label); }

  function areaPanel(ctx, title, area, lineTag, motors){
    const head = el('div',{class:'panel-head'},
      el('h2',{},title),el('div',{class:'spacer'}),
      lineStateChip(ctx,lineTag));
    const motorBox = el('div',{class:'grid',style:'gap:8px;margin-bottom:12px'});
    motors.forEach(m=>motorBox.appendChild(UI.motor(m)));
    const panel = el('div',{class:'panel'}, head, motorBox,
      el('div',{style:'display:flex;gap:8px'},
        el('button',{class:'btn run sm',style:'flex:1',onclick:()=>{PLC.write(lineTag,true);UI.toast(title+' sequence STARTED','good');}},'▶ Start Line'),
        el('button',{class:'btn stop sm',style:'flex:1',onclick:()=>{PLC.write(lineTag,false);UI.toast(title+' sequence STOPPED','warn');}},'■ Stop Line'),
      ));
    // rebuild motor faceplate states on refresh (replace whole box)
    ctx.refresh.push(()=>{ motorBox.innerHTML=''; motors.forEach(m=>motorBox.appendChild(UI.motor(m))); });
    return panel;
  }

  function lineStateChip(ctx, tag){
    const chip=el('span',{class:'pill'});
    ctx.refresh.push(()=>{ const r=PLC.read(tag); chip.className='pill '+(r?'run':'stop'); chip.textContent=r?'RUNNING':'STOPPED'; });
    return chip;
  }

  /* ================================================================
     PAGE: SILO FILLING
     ================================================================ */
  RENDER.silos = (ctx) => {
    const wrap = el('div',{class:'grid',style:'grid-template-columns:1fr 360px;align-items:start'});
    const _mp = mimicPanel(ctx,'Silo Filling — Process Mimic',MIMIC.silos,'Tip pit → pre-cleaner → bucket elevator → distributor → silos');
    _mp.style.gridColumn='1 / -1'; _mp.style.marginBottom='0'; wrap.appendChild(_mp);

    /* left: mimic + silos */
    const left = el('div');
    // intake conveying mimic
    const mimic = el('div',{class:'panel',style:'margin-bottom:14px'},
      el('div',{class:'panel-head'},el('h2',{},'Intake Conveying Line'),el('div',{class:'spacer'}),
        el('span',{class:'hint'},'Tip pit → pre-clean → bucket elevator → distributor')));
    const mrow = el('div',{class:'grid',style:'grid-template-columns:repeat(5,1fr);gap:8px'});
    ['M_IC1','M_DEDUST','M_PC1','M_BE1','M_DST'].forEach(m=>mrow.appendChild(UI.motor(m)));
    ctx.refresh.push(()=>{ mrow.innerHTML=''; ['M_IC1','M_DEDUST','M_PC1','M_BE1','M_DST'].forEach(m=>mrow.appendChild(UI.motor(m))); });
    mimic.appendChild(mrow);
    left.appendChild(mimic);

    // silos
    const siloPanel = el('div',{class:'panel'},
      el('div',{class:'panel-head'},el('h2',{},'Storage Silos'),el('div',{class:'spacer'}),
        el('span',{class:'hint'},'Click a motor for auto/manual control')));
    const siloGrid = el('div',{class:'grid cols-6',style:'gap:10px'});
    const siloTags=['S1','S2','S3','S4','S5','S6'];
    siloTags.forEach(s=>siloGrid.appendChild(UI.silo(s)));
    ctx.refresh.push(()=>{ siloGrid.innerHTML=''; siloTags.forEach(s=>siloGrid.appendChild(UI.silo(s))); });
    siloPanel.appendChild(siloGrid);
    left.appendChild(siloPanel);
    wrap.appendChild(left);

    /* right: setpoints */
    const right = el('div');
    const sp = el('div',{class:'panel',style:'margin-bottom:14px'},
      el('div',{class:'panel-head'},el('h2',{},'Fill Setpoints')));

    // target silo selector
    const siloSel = el('select');
    PLC.VESSELS.filter(v=>v[2]==='silos').forEach((v,i)=>siloSel.appendChild(el('option',{value:i},v[1])));
    siloSel.value = PLC.read('SP_FILL_TARGET');
    siloSel.onchange=()=>{ PLC.write('SP_FILL_TARGET',+siloSel.value); UI.toast('Fill target → '+PLC.VESSELS[+siloSel.value][1]); };

    // grain type selector
    const grainSel = el('select');
    PLC.GRAIN_TYPES.forEach((g,i)=>{ if(i<5) grainSel.appendChild(el('option',{value:i},g)); });
    grainSel.value = PLC.read('SP_FILL_GRAIN');
    grainSel.onchange=()=>{ PLC.write('SP_FILL_GRAIN',+grainSel.value); UI.toast('Grain type → '+PLC.GRAIN_TYPES[+grainSel.value]); };

    sp.append(
      el('div',{class:'field'},el('label',{},'Destination Silo'),siloSel),
      el('div',{class:'field'},el('label',{},'Grain Type / Blend Component'),grainSel),
      UI.setpoint({label:'Intake Fill Rate',sub:'Throughput to silo',tag:'SP_FILL_TPH',pvTag:'PV_FILL_TPH',unit:'t/h',min:0,max:80,step:1,decimals:0}),
    );
    right.appendChild(sp);

    // blend recipe quick reference
    const blendPanel = el('div',{class:'panel'},
      el('div',{class:'panel-head'},el('h2',{},'Wheat Inventory')));
    const invTable=el('table',{class:'tbl'});
    const rebuildInv=()=>{
      invTable.innerHTML='';
      invTable.appendChild(el('tr',{},el('th',{},'Grain'),el('th',{class:'right'},'Tonnes'),el('th',{class:'right'},'Silos')));
      const totals={};
      siloTags.forEach(s=>{ const g=PLC.read(s+'_GRAIN'); const t=PLC.read(s+'_LEVEL')/100*PLC.tags[s+'_LEVEL'].cap;
        totals[g]=totals[g]||{t:0,n:0}; totals[g].t+=t; totals[g].n++; });
      Object.entries(totals).forEach(([g,d])=>{
        invTable.appendChild(el('tr',{},el('td',{},
          el('span',{style:'color:var(--grain);font-weight:600'},PLC.GRAIN_TYPES[g])),
          el('td',{class:'right mono'},num(d.t,1)),el('td',{class:'right mono'},d.n)));
      });
    };
    rebuildInv(); ctx.refresh.push(rebuildInv);
    blendPanel.appendChild(invTable);
    right.appendChild(blendPanel);
    wrap.appendChild(right);
    return wrap;
  };

  /* ================================================================
     PAGE: TEMPERING
     ================================================================ */
  RENDER.temper = (ctx) => {
    const wrap = el('div',{class:'grid',style:'grid-template-columns:1fr 360px;align-items:start'});
    const _mp = mimicPanel(ctx,'Grain Tempering — Process Mimic',MIMIC.temper,'Weigher → dampener (water add) → elevator → temper bins → screws → mill');
    _mp.style.gridColumn='1 / -1'; _mp.style.marginBottom='0'; wrap.appendChild(_mp);
    const left = el('div');

    // moisture gauges
    const gauges = el('div',{class:'panel',style:'margin-bottom:14px'},
      el('div',{class:'panel-head'},el('h2',{},'Moisture & Water Addition')));
    const gRow = el('div',{class:'grid cols-4',style:'gap:8px'});
    gauges.appendChild(gRow);
    ctx.refresh.push(()=>{ gRow.innerHTML='';
      gRow.append(
        UI.gauge(PLC.read('PV_INLET_MOIST'),8,20,'Inlet Moisture','%','#8b97a7'),
        UI.gauge(PLC.read('PV_TEMPER_MOIST'),8,20,'Tempered Moisture','%','#2f81f7'),
        UI.gauge(PLC.read('PV_WATER_LPM'),0,60,'Water Flow','L/min','#2f81f7'),
        UI.gauge(PLC.read('SP_TEMPER_TIME'),0,48,'Dwell Time','h','#c8a24b'),
      );
    });
    left.appendChild(gauges);

    // dampener motors
    const mpanel = el('div',{class:'panel',style:'margin-bottom:14px'},
      el('div',{class:'panel-head'},el('h2',{},'Dampening & Conveying')));
    const mrow = el('div',{class:'grid cols-3',style:'gap:8px'});
    const tmotors=['M_DAMP','M_WP1','M_TC1','M_TC2','M_BE2'];
    mpanel.appendChild(mrow);
    ctx.refresh.push(()=>{ mrow.innerHTML=''; tmotors.forEach(m=>mrow.appendChild(UI.motor(m))); });
    left.appendChild(mpanel);

    // temper bins
    const binPanel = el('div',{class:'panel'},
      el('div',{class:'panel-head'},el('h2',{},'Temper Bins'),el('div',{class:'spacer'}),
        el('span',{class:'hint'},'Conditioning dwell before milling')));
    const binGrid=el('div',{class:'grid cols-4',style:'gap:10px'});
    const bins=['TB1','TB2','TB3','TB4'];
    binPanel.appendChild(binGrid);
    ctx.refresh.push(()=>{ binGrid.innerHTML=''; bins.forEach(b=>binGrid.appendChild(UI.silo(b))); });
    left.appendChild(binPanel);
    wrap.appendChild(left);

    // setpoints
    const right = el('div');
    const sp = el('div',{class:'panel'},
      el('div',{class:'panel-head'},el('h2',{},'Tempering Setpoints')),
      UI.setpoint({label:'Target Moisture',sub:'Conditioned wheat',tag:'SP_TEMPER_MOIST',pvTag:'PV_TEMPER_MOIST',unit:'%',min:12,max:18,step:0.1,decimals:1}),
      UI.setpoint({label:'Dwell / Temper Time',sub:'Rest before milling',tag:'SP_TEMPER_TIME',unit:'h',min:4,max:48,step:1,decimals:0}),
      el('div',{class:'modal-section-title'},'Calculated Water Demand'),
      (()=>{ const d=el('div',{class:'kv-grid'}); ctx.refresh.push(()=>{ d.innerHTML='';
        d.append(UI.kv('Water Flow SP', num(PLC.read('SP_WATER_LPM'),1)+' L/min'),
                 UI.kv('Water Flow PV', num(PLC.read('PV_WATER_LPM'),1)+' L/min'),
                 UI.kv('Inlet Moisture', num(PLC.read('PV_INLET_MOIST'),1)+' %'),
                 UI.kv('Moisture Gain', '+'+num(PLC.read('SP_TEMPER_MOIST')-PLC.read('PV_INLET_MOIST'),1)+' %'));
      }); return d; })(),
      el('div',{class:'muted',style:'font-size:11px;margin-top:12px'},
        'Water flow is auto-calculated from inlet moisture, throughput and the water meter K-factor (Settings). Tempering screw and water pump run on the tempering sequence.'),
    );
    right.appendChild(sp);
    wrap.appendChild(right);
    return wrap;
  };

  /* ================================================================
     PAGE: MILLING
     ================================================================ */
  RENDER.mill = (ctx) => {
    const wrap = el('div',{class:'grid',style:'grid-template-columns:1fr 360px;align-items:start'});
    const _mp = mimicPanel(ctx,'Milling — Process Mimic',MIMIC.mill,'Break rolls → plansifter → reduction rolls → purifier → packing');
    _mp.style.gridColumn='1 / -1'; _mp.style.marginBottom='0'; wrap.appendChild(_mp);
    const left = el('div');

    // KPI strip
    const kpis = el('div',{class:'grid cols-4',style:'margin-bottom:14px;gap:10px'});
    const mkk=(label,fn,unit,kind)=>{ const v=el('div',{class:'value'});
      const t=el('div',{class:'stat '+kind},el('div',{class:'accent-bar'}),el('div',{class:'label'},label),v);
      ctx.refresh.push(()=>{ v.innerHTML=''; v.append(document.createTextNode(num(fn(),1)),el('small',{},unit)); }); return t; };
    kpis.append(
      mkk('Mill Rate',()=>PLC.read('PV_MILL_TPH'),' t/h','good'),
      mkk('Extraction',()=>PLC.read('PV_EXTRACTION'),' %','grain'),
      mkk('Flour Ash',()=>PLC.read('PV_ASH'),' %',''),
      mkk('Flour Today',()=>PLC.read('CNT_FLOUR_TODAY'),' t','good'),
    );
    left.appendChild(kpis);

    // roller mill mimic
    const mill = el('div',{class:'panel',style:'margin-bottom:14px'},
      el('div',{class:'panel-head'},el('h2',{},'Roller Mill Passages'),el('div',{class:'spacer'}),
        el('span',{class:'hint'},'Break → Reduction → Sifting → Purifying → Packing')));
    const millRow=el('div',{class:'grid',style:'grid-template-columns:repeat(4,1fr);gap:8px'});
    const millMotors=['M_B1','M_B2','M_C1','M_C2','M_SIFT','M_PUR','M_PNF','M_PACK'];
    mill.appendChild(millRow);
    ctx.refresh.push(()=>{ millRow.innerHTML=''; millMotors.forEach(m=>millRow.appendChild(UI.motor(m))); });
    left.appendChild(mill);

    // quality trend
    const qp=el('div',{class:'panel'},el('div',{class:'panel-head'},el('h2',{},'Rate & Extraction Trend')));
    const qn=el('div'); qp.appendChild(qn);
    ctx.refresh.push(()=>{ const tr=PLC.trends(); qn.innerHTML='';
      qn.appendChild(UI.trend([{data:tr.tph,color:'#2ea043'},{data:tr.extraction,color:'#c8a24b'}],{max:100,h:130,w:700}));
    });
    qp.appendChild(el('div',{class:'legend'},legend('Mill t/h','#2ea043'),legend('Extraction %','#c8a24b')));
    left.appendChild(qp);
    wrap.appendChild(left);

    // setpoints + recipe
    const right=el('div');
    const recPanel=el('div',{class:'panel',style:'margin-bottom:14px'},
      el('div',{class:'panel-head'},el('h2',{},'Active Recipe / Blend')));
    const recSel=el('select');
    PLC.RECIPES.forEach((r,i)=>recSel.appendChild(el('option',{value:i},r.name)));
    recSel.value=PLC.read('SP_ACTIVE_RECIPE');
    const blendBox=el('div',{style:'margin-top:10px'});
    const applyRecipe=(commit)=>{
      const r=PLC.RECIPES[+recSel.value];
      blendBox.innerHTML='';
      blendBox.appendChild(el('div',{class:'modal-section-title'},'Blend composition'));
      blendBox.appendChild(UI.barChart(Object.entries(r.blend).map(([g,p])=>(
        {label:PLC.GRAIN_TYPES[g],value:p,color:'var(--grain)'})),{unit:'%',dec:0}));
      blendBox.appendChild(el('div',{class:'kv-grid',style:'margin-top:12px'},
        UI.kv('Target Moisture',r.moisture+' %'),
        UI.kv('Target Extraction',r.extraction+' %'),
        UI.kv('Recommended Rate',r.tph+' t/h'),
        UI.kv('Recipe Code',r.id)));
      if(commit){
        PLC.write('SP_ACTIVE_RECIPE',+recSel.value);
        PLC.write('SP_TEMPER_MOIST',r.moisture);
        PLC.write('SP_MILL_TPH',r.tph);
        UI.toast('Recipe loaded: '+r.name+' — setpoints applied','good');
        logRecipeStart(r);
      }
    };
    recSel.onchange=()=>applyRecipe(true);
    recPanel.append(el('div',{class:'field'},el('label',{},'Recipe'),recSel),blendBox);
    applyRecipe(false);
    right.appendChild(recPanel);

    const sp=el('div',{class:'panel'},
      el('div',{class:'panel-head'},el('h2',{},'Milling Setpoints')),
      UI.setpoint({label:'Milling Rate',sub:'Tons per hour',tag:'SP_MILL_TPH',pvTag:'PV_MILL_TPH',unit:'t/h',min:0,max:20,step:0.5,decimals:1}),
      UI.setpoint({label:'B1 Break Roll Gap',sub:'First break',tag:'SP_B1_GAP',unit:'mm',min:0.2,max:1.2,step:0.05,decimals:2}),
      UI.setpoint({label:'C1 Reduction Roll Gap',sub:'First reduction',tag:'SP_C1_GAP',unit:'mm',min:0.05,max:0.5,step:0.01,decimals:2}),
    );
    right.appendChild(sp);
    wrap.appendChild(right);
    return wrap;
  };

  /* ================================================================
     PAGE: SETTINGS
     ================================================================ */
  RENDER.settings = (ctx) => {
    const cfg=PLC.getCfg();
    const wrap=el('div',{class:'grid cols-2',style:'align-items:start'});

    /* PLC connection */
    const conn=el('div',{class:'panel'},
      el('div',{class:'panel-head'},el('h2',{},'PLC Connection — Allen-Bradley')));
    const fDriver=el('select');
    [['sim','Simulator (no hardware)'],['live','Live PLC via gateway']].forEach(([v,l])=>fDriver.appendChild(el('option',{value:v},l)));
    fDriver.value=cfg.driver;
    const fIp=el('input',{type:'text',value:cfg.plcPath});
    const fSlot=el('input',{type:'number',value:cfg.plcSlot,min:0,max:17});
    const fGw=el('input',{type:'text',value:cfg.gatewayUrl});
    const fPrefix=el('input',{type:'text',value:cfg.tagPrefix});
    conn.append(
      el('div',{class:'field'},el('label',{},'Connection Driver'),fDriver),
      el('div',{class:'field'},el('label',{},'Controller IP / CIP Path ',el('small',{},'(ControlLogix/CompactLogix)')),fIp),
      el('div',{class:'field'},el('label',{},'CPU Backplane Slot'),fSlot),
      el('div',{class:'field'},el('label',{},'Gateway WebSocket URL ',el('small',{},'(Node EtherNet/IP bridge)')),fGw),
      el('div',{class:'field'},el('label',{},'Tag Scope Prefix ',el('small',{},'(e.g. Program:Mill.)')),fPrefix),
      el('div',{style:'display:flex;gap:8px;margin-top:6px'},
        el('button',{class:'btn primary',onclick:()=>{
          PLC.setCfg({driver:fDriver.value,plcPath:fIp.value,plcSlot:+fSlot.value,gatewayUrl:fGw.value,tagPrefix:fPrefix.value});
          PLC.setDriver(fDriver.value);
          UI.toast('Connection settings applied — '+(fDriver.value==='live'?'connecting to PLC…':'simulation running'),'good');
          updateConn();
        }},'Apply & Connect'),
        el('button',{class:'btn',onclick:()=>{ const s=PLC.connection();
          UI.toast('Connection: '+s.toUpperCase(), s==='online'?'good':s==='offline'?'bad':'warn'); }},'Test Status'),
      ),
      el('div',{class:'muted',style:'font-size:11px;margin-top:12px'},
        'Browsers cannot speak EtherNet/IP directly. Run the Node.js gateway in /server (node-ethernet-ip or pylogix) on the mill network; it bridges PLC tags to this HMI over WebSocket. See README.'),
    );
    wrap.appendChild(conn);

    /* background process settings */
    const proc=el('div',{class:'panel'},
      el('div',{class:'panel-head'},el('h2',{},'Background Process Settings'),el('div',{class:'spacer'}),
        el('span',{class:'hint'},'Rarely changed — engineering config')));
    const cfgTags=[
      ['CFG_SILO_HI','Silo High-Level Alarm','%',0,100,1,0],
      ['CFG_SILO_LO','Silo Low-Level Alarm','%',0,100,1,0],
      ['CFG_MOTOR_TEMP_HI','Motor Winding Temp Alarm','°C',60,140,1,0],
      ['CFG_WATER_KFACTOR','Water Meter K-Factor','',0.8,1.3,0.01,2],
      ['CFG_SCALE_SPAN','Weigh Scale Span','kg',100,5000,10,0],
      ['CFG_DENSITY','Wheat Bulk Density','kg/m³',650,850,1,0],
    ];
    cfgTags.forEach(([tag,label,unit,mn,mx,st,dc])=>proc.appendChild(
      UI.setpoint({label,tag,unit,min:mn,max:mx,step:st,decimals:dc})));
    wrap.appendChild(proc);

    /* HMI / scan settings */
    const hmi=el('div',{class:'panel'},
      el('div',{class:'panel-head'},el('h2',{},'HMI & Scan')));
    const fScan=el('input',{type:'number',value:cfg.scanRateMs,min:100,max:5000,step:100});
    const fSite=el('input',{type:'text',value:cfg.site});
    const fUnits=el('select'); [['metric','Metric (t, kg, °C)'],['imperial','Imperial (lb, °F)']].forEach(([v,l])=>fUnits.appendChild(el('option',{value:v},l))); fUnits.value=cfg.units;
    const fOp=el('select'); PLC.OPERATORS.forEach(o=>fOp.appendChild(el('option',{value:o},o))); fOp.value=currentOperator();
    hmi.append(
      el('div',{class:'field'},el('label',{},'Logged-in Operator'),fOp),
      el('div',{class:'field'},el('label',{},'Site / Line Name'),fSite),
      el('div',{class:'field'},el('label',{},'Scan / Poll Rate (ms)'),fScan),
      el('div',{class:'field'},el('label',{},'Engineering Units'),fUnits),
      el('button',{class:'btn primary',onclick:()=>{
        PLC.setCfg({scanRateMs:+fScan.value,site:fSite.value,units:fUnits.value});
        localStorage.setItem('scada.operator',fOp.value);
        PLC.setDriver(PLC.getCfg().driver);
        UI.toast('HMI settings saved','good'); buildShell(); render();
      }},'Save HMI Settings'),
    );
    wrap.appendChild(hmi);

    /* data / maintenance */
    const data=el('div',{class:'panel'},
      el('div',{class:'panel-head'},el('h2',{},'Data & Maintenance')));
    data.append(
      el('div',{class:'muted',style:'font-size:12px;margin-bottom:12px'},'Production logs and counters are stored locally in this browser for the demo. On a live system these write to a historian / SQL database via the gateway.'),
      el('div',{style:'display:flex;gap:8px;flex-wrap:wrap'},
        el('button',{class:'btn',onclick:()=>{ exportLogs(); }},'⤓ Export Production Log (CSV)'),
        el('button',{class:'btn',onclick:()=>{ if(confirm('Reset daily production counters?')){ PLC.write('CNT_FLOUR_TODAY',0);PLC.write('CNT_BRAN_TODAY',0);PLC.write('CNT_INTAKE_TODAY',0); UI.toast('Daily counters reset','warn'); }}},'Reset Daily Counters'),
        el('button',{class:'btn',onclick:()=>{ if(confirm('Clear all stored recipe logs?')){ localStorage.removeItem('scada.recipelog'); UI.toast('Recipe logs cleared','warn'); }}},'Clear Recipe Logs'),
      ),
    );
    wrap.appendChild(data);
    return wrap;
  };

  /* ================================================================
     PAGE: REPORTING
     ================================================================ */
  RENDER.reports = (ctx) => {
    const wrap=el('div');
    const logs=getRecipeLog();

    // daily production counters
    const tiles=el('div',{class:'grid cols-4',style:'margin-bottom:16px'});
    const mk=(label,fn,unit,kind,sub)=>{ const v=el('div',{class:'value'});
      const t=el('div',{class:'stat '+kind},el('div',{class:'accent-bar'}),el('div',{class:'label'},label),v,sub?el('div',{class:'sub'},sub):null);
      ctx.refresh.push(()=>{ v.innerHTML=''; v.append(document.createTextNode(num(fn(),1)),el('small',{},unit)); }); return t; };
    tiles.append(
      mk('Flour Produced Today',()=>PLC.read('CNT_FLOUR_TODAY'),' t','good','Shift total'),
      mk('Bran / Offal Today',()=>PLC.read('CNT_BRAN_TODAY'),' t','grain','By-product'),
      mk('Wheat Intake Today',()=>PLC.read('CNT_INTAKE_TODAY'),' t','','Received'),
      mk('Avg Extraction',()=>PLC.read('PV_EXTRACTION'),' %','','Current'),
    );
    wrap.appendChild(tiles);

    const row=el('div',{class:'grid',style:'grid-template-columns:1fr 1fr;align-items:start;margin-bottom:16px'});

    // production by recipe (donut)
    const byRecipe={};
    logs.forEach(l=>{ byRecipe[l.recipe]=(byRecipe[l.recipe]||0)+l.tonnes; });
    const colors=['#2ea043','#2f81f7','#c8a24b','#d29922','#a371f7'];
    const segs=Object.entries(byRecipe).map(([r,t],i)=>({label:r,value:t,color:colors[i%colors.length]}));
    const totT=segs.reduce((s,x)=>s+x.value,0);
    const donutPanel=el('div',{class:'panel'},
      el('div',{class:'panel-head'},el('h2',{},'Production by Recipe — 30 days')),
      segs.length?el('div',{class:'grid',style:'grid-template-columns:140px 1fr;align-items:center;gap:18px'},
        UI.donut(segs,{centerVal:num(totT,0),centerLabel:'tonnes'}),
        el('div',{},segs.map(s=>el('div',{style:'display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px'},
          el('span',{class:'sw',style:`width:12px;height:12px;border-radius:3px;background:${s.color}`}),
          el('span',{style:'flex:1'},s.label),
          el('span',{class:'mono'},num(s.value,1)+' t'),
          el('span',{class:'muted mono',style:'width:48px;text-align:right'},num(s.value/totT*100,0)+'%')))),
      ):el('div',{class:'empty'},'No recipe runs logged yet'));
    row.appendChild(donutPanel);

    // operator efficiency leaderboard
    const opStats=computeOperatorStats(logs);
    const opPanel=el('div',{class:'panel flat'},
      el('div',{class:'panel-head',style:'padding:16px 16px 0'},el('h2',{},'Operator Efficiency — Leaderboard')));
    const opTable=el('table',{class:'tbl'},
      el('tr',{},el('th',{},'#'),el('th',{},'Operator'),el('th',{class:'right'},'Tonnes'),el('th',{class:'right'},'Avg t/h'),el('th',{class:'right'},'Avg Extract'),el('th',{},'Efficiency')));
    opStats.forEach((o,i)=>{
      opTable.appendChild(el('tr',{},
        el('td',{class:'mono'},(i+1)),
        el('td',{},i===0?'🏆 '+o.name:o.name),
        el('td',{class:'right mono'},num(o.tonnes,1)),
        el('td',{class:'right mono'},num(o.avgRate,1)),
        el('td',{class:'right mono'},num(o.avgExtract,1)+'%'),
        el('td',{style:'min-width:120px'},
          el('div',{class:'bar-track'},el('div',{class:'bar-fill good',style:`width:${o.eff}%`})))));
    });
    opPanel.appendChild(opTable);
    row.appendChild(opPanel);
    wrap.appendChild(row);

    // daily production trend (last 14 days)
    const daily=computeDailyTotals(logs);
    const dailyPanel=el('div',{class:'panel',style:'margin-bottom:16px'},
      el('div',{class:'panel-head'},el('h2',{},'Daily Flour Production — last 14 days')));
    dailyPanel.appendChild(UI.barChart(daily.map(d=>({label:d.date,value:d.tonnes,color:'var(--run)'})),{unit:' t',dec:1}));
    wrap.appendChild(dailyPanel);

    // recipe production log table
    const logPanel=el('div',{class:'panel flat'},
      el('div',{class:'panel-head',style:'padding:16px 16px 0'},el('h2',{},'Recipe Production Log'),el('div',{class:'spacer'}),
        el('button',{class:'btn sm',style:'margin:0 16px',onclick:exportLogs},'⤓ Export CSV')));
    const logTable=el('table',{class:'tbl'},
      el('tr',{},el('th',{},'Date / Time'),el('th',{},'Recipe'),el('th',{},'Operator'),el('th',{class:'right'},'Tonnes'),el('th',{class:'right'},'Rate t/h'),el('th',{class:'right'},'Extract %'),el('th',{},'Status')));
    logs.slice(0,40).forEach(l=>{
      logTable.appendChild(el('tr',{},
        el('td',{class:'mono'},new Date(l.ts).toLocaleString('en-AU',{hour12:false})),
        el('td',{},el('span',{style:'color:var(--grain);font-weight:600'},l.recipe)),
        el('td',{},l.operator),
        el('td',{class:'right mono'},num(l.tonnes,1)),
        el('td',{class:'right mono'},num(l.rate,1)),
        el('td',{class:'right mono'},num(l.extract,1)),
        el('td',{},el('span',{class:'pill '+(l.status==='Complete'?'run':'auto')},l.status))));
    });
    logPanel.appendChild(logTable);
    wrap.appendChild(logPanel);
    return wrap;
  };

  /* ================================================================
     REPORT DATA (seeded + accumulating, stored locally)
     ================================================================ */
  function ensureSeeded(){
    if (localStorage.getItem('scada.recipelog') == null)
      localStorage.setItem('scada.recipelog', JSON.stringify(seedRecipeLog()));
  }
  function getRecipeLog(){
    ensureSeeded();
    const log = JSON.parse(localStorage.getItem('scada.recipelog')||'[]');
    return log.sort((a,b)=>b.ts-a.ts);
  }
  function seedRecipeLog(){
    const out=[]; const now=Date.now();
    for (let d=29; d>=0; d--){
      const runs=2+Math.floor(Math.random()*3);
      for (let r=0;r<runs;r++){
        const rec=PLC.RECIPES[Math.floor(Math.random()*PLC.RECIPES.length)];
        const op=PLC.OPERATORS[Math.floor(Math.random()*PLC.OPERATORS.length)];
        const rate=rec.tph*(0.85+Math.random()*0.25);
        const extract=rec.extraction*(0.96+Math.random()*0.07);
        const hours=4+Math.random()*4;
        out.push({ ts: now - d*86400000 - r*5400000 - Math.random()*3600000,
          recipe:rec.name, recipeId:rec.id, operator:op,
          tonnes: rate*hours, rate, extract, status:'Complete' });
      }
    }
    return out;
  }
  function logRecipeStart(rec){
    ensureSeeded();
    const log=JSON.parse(localStorage.getItem('scada.recipelog')||'[]');
    log.push({ ts:Date.now(), recipe:rec.name, recipeId:rec.id, operator:currentOperator(),
      tonnes: PLC.read('CNT_FLOUR_TODAY')||0, rate:PLC.read('SP_MILL_TPH'),
      extract:PLC.read('PV_EXTRACTION')||rec.extraction, status:'In Progress' });
    localStorage.setItem('scada.recipelog', JSON.stringify(log));
  }
  function computeOperatorStats(logs){
    const m={};
    logs.forEach(l=>{ const o=m[l.operator]=m[l.operator]||{name:l.operator,tonnes:0,rate:0,extract:0,n:0};
      o.tonnes+=l.tonnes; o.rate+=l.rate; o.extract+=l.extract; o.n++; });
    const arr=Object.values(m).map(o=>({...o,avgRate:o.rate/o.n,avgExtract:o.extract/o.n}));
    // efficiency = blend of throughput vs rated and extraction performance
    const maxRate=Math.max(...arr.map(o=>o.avgRate),1);
    arr.forEach(o=>{ o.eff=Math.min(100, (o.avgRate/maxRate*55 + o.avgExtract/100*45)); });
    return arr.sort((a,b)=>b.eff-a.eff);
  }
  function computeDailyTotals(logs){
    const m={};
    logs.forEach(l=>{ const k=new Date(l.ts).toLocaleDateString('en-AU',{day:'2-digit',month:'short'});
      m[k]=(m[k]||0)+l.tonnes; });
    const keys=Object.keys(m).slice(0,14).reverse();
    return keys.map(k=>({date:k,tonnes:m[k]}));
  }
  function exportLogs(){
    const logs=getRecipeLog();
    const rows=[['Timestamp','Recipe','RecipeID','Operator','Tonnes','Rate_tph','Extraction_pct','Status']];
    logs.forEach(l=>rows.push([new Date(l.ts).toISOString(),l.recipe,l.recipeId,l.operator,
      l.tonnes.toFixed(2),l.rate.toFixed(2),l.extract.toFixed(2),l.status]));
    const csv=rows.map(r=>r.join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download='production-log-'+new Date().toISOString().slice(0,10)+'.csv'; a.click();
    UI.toast('Production log exported','good');
  }

  /* ================================================================
     BOOT
     ================================================================ */
  window.addEventListener('hashchange', () => { const id=location.hash.replace('#',''); if(id&&id!==current) go(id); });

  PLC.start();
  ensureSeeded();
  buildShell();
  render();
  // global periodic refresh for connection pill even if no tag changes
  setInterval(()=>{ refreshAlarms(); updateConn(); }, 1000);
})();

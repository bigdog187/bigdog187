/* ====================================================================
   plc.js — PLC tag layer
   --------------------------------------------------------------------
   The whole HMI talks ONLY to this module. It exposes a tag database
   that mirrors the controller tags you would create in Studio 5000 on
   an Allen-Bradley ControlLogix / CompactLogix PLC.

   Two drivers are provided:
     • SimDriver  — a self-contained process simulator (default). Lets
                    the interface run with no hardware.
     • LiveDriver — connects over a WebSocket to the Node.js gateway in
                    /server/ab-gateway.js, which uses EtherNet/IP
                    (node-ethernet-ip / pylogix) to read & write the
                    real PLC tags. Browsers cannot speak EtherNet/IP
                    directly, hence the gateway.

   Switch drivers from the Settings page (or window.PLC.connectLive()).
   ==================================================================== */

const PLC = (() => {
  /* ---- persisted config ------------------------------------------ */
  const CFG_KEY = 'scada.cfg.v1';
  const defaultCfg = {
    driver: 'sim',                 // 'sim' | 'live'
    plcPath: '192.168.1.10',       // controller IP / CIP path
    plcSlot: 0,                    // backplane slot of the CPU
    gatewayUrl: 'ws://localhost:8080',
    scanRateMs: 500,
    units: 'metric',               // metric | imperial
    site: 'Wyelec Mill — Line 1',
    tagPrefix: 'Program:Mill.',    // program scope prefix for live tags
  };
  let cfg = { ...defaultCfg, ...load(CFG_KEY, {}) };

  function load(k, def){ try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } }
  function save(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
  function saveCfg(){ save(CFG_KEY, cfg); }

  /* ---- tag database ----------------------------------------------- */
  /* Each tag mirrors a controller tag. `t` is the AB data type, `addr`
     is the symbolic tag name the gateway reads/writes on the PLC.      */
  const tags = {};
  const listeners = new Set();

  function defTag(name, value, addr, t='REAL'){
    tags[name] = { name, value, addr: addr || name, t };
  }

  function read(name){ return tags[name] ? tags[name].value : undefined; }
  function readAll(){ const o = {}; for (const k in tags) o[k] = tags[k].value; return o; }

  /* write goes through the active driver (sim updates locally, live
     pushes to the gateway then reflects the echoed value)             */
  function write(name, value){
    if (!tags[name]) { console.warn('write to unknown tag', name); return; }
    driver.write(name, value);
  }
  /* internal — driver sets confirmed value & notifies UI */
  function _set(name, value){
    if (!tags[name]) return;
    if (tags[name].value === value) return;
    tags[name].value = value;
    emit(name);
  }
  function emit(name){ for (const fn of listeners) { try { fn(name); } catch(e){ console.error(e); } } }
  function onUpdate(fn){ listeners.add(fn); return () => listeners.delete(fn); }

  /* ================================================================
     EQUIPMENT MODEL — motors, vessels, recipes, operators
     ================================================================ */

  /* Motor master records — nameplate data lives here (would come from
     the asset register / PLC UDT). Live values (run, current, starts,
     runHrs) are mirrored as tags so the sim/PLC can drive them.        */
  const MOTORS = [
    // tag, desc, area, kW, V, poles, rpm, flc(A), frame, sf, vsd?
    ['M_IC1',  'Intake Drag Conveyor',     'silos',  15,  415, 4, 1455, 27.5, 'D160M', 1.15, false],
    ['M_BE1',  'Bucket Elevator #1',       'silos',  22,  415, 4, 1460, 39.0, 'D180M', 1.15, false],
    ['M_PC1',  'Pre-Cleaner Aspirator',    'silos',  7.5, 415, 2, 2920, 14.2, 'D132S', 1.10, true ],
    ['M_DST',  'Silo Distributor Drive',   'silos',  3.0, 415, 4, 1420, 6.6,  'D100L', 1.10, false],
    ['M_DEDUST','Intake Dedust Fan',       'silos',  11,  415, 2, 2940, 20.5, 'D160M', 1.10, true ],

    ['M_DAMP', 'Dampener Auger',           'temper', 5.5, 415, 4, 1440, 11.1, 'D132S', 1.15, true ],
    ['M_WP1',  'Tempering Water Pump',     'temper', 4.0, 415, 2, 2900, 8.3,  'D112M', 1.10, true ],
    ['M_TC1',  'Temper Bin Screw #1',      'temper', 5.5, 415, 4, 1445, 11.1, 'D132S', 1.15, false],
    ['M_TC2',  'Temper Bin Screw #2',      'temper', 5.5, 415, 4, 1445, 11.1, 'D132S', 1.15, false],
    ['M_BE2',  'Bucket Elevator #2',       'temper', 18.5,415, 4, 1458, 33.5, 'D180M', 1.15, false],

    ['M_B1',   'Break Roll B1 Main',       'mill',   90,  415, 4, 1485, 152,  'D280S', 1.15, true ],
    ['M_B2',   'Break Roll B2 Main',       'mill',   75,  415, 4, 1480, 130,  'D280S', 1.15, true ],
    ['M_C1',   'Reduction Roll C1 Main',   'mill',   110, 415, 4, 1487, 188,  'D315S', 1.15, true ],
    ['M_C2',   'Reduction Roll C2 Main',   'mill',   90,  415, 4, 1485, 152,  'D280S', 1.15, true ],
    ['M_SIFT', 'Plansifter Drive',         'mill',   7.5, 415, 6, 960,  15.8, 'D132M', 1.15, false],
    ['M_PUR',  'Purifier Drive',           'mill',   5.5, 415, 6, 955,  12.0, 'D132S', 1.15, false],
    ['M_PNF',  'Pneumatic Conveying Fan',  'mill',   132, 415, 2, 2965, 225,  'D315M', 1.10, true ],
    ['M_PACK', 'Flour Packing Auger',      'mill',   4.0, 415, 4, 1430, 8.3,  'D112M', 1.10, true ],
  ];

  MOTORS.forEach(m => {
    const [tag] = m;
    defTag(tag + '_RUN',     false, cfg.tagPrefix + tag + '.Run', 'BOOL');
    defTag(tag + '_AUTO',    true,  cfg.tagPrefix + tag + '.Auto', 'BOOL');
    defTag(tag + '_FAULT',   false, cfg.tagPrefix + tag + '.Fault', 'BOOL');
    defTag(tag + '_CMD',     false, cfg.tagPrefix + tag + '.StartCmd', 'BOOL'); // operator start request
    defTag(tag + '_SPEED',   0,     cfg.tagPrefix + tag + '.SpeedFbk');         // % speed (VSD) or 0/100
    defTag(tag + '_CURRENT', 0,     cfg.tagPrefix + tag + '.Current');          // A
    defTag(tag + '_STARTS',  Math.floor(Math.random()*400)+50, cfg.tagPrefix + tag + '.StartCount', 'DINT');
    defTag(tag + '_RUNHRS',  Math.floor(Math.random()*9000)+200, cfg.tagPrefix + tag + '.RunHours');
    defTag(tag + '_TEMP',    35 + Math.random()*8, cfg.tagPrefix + tag + '.WindingTemp'); // °C
  });

  function motor(tag){ return MOTORS.find(m => m[0] === tag); }
  function motorMeta(tag){
    const m = motor(tag);
    if (!m) return null;
    const [, desc, area, kW, V, poles, rpm, flc, frame, sf, vsd] = m;
    return { tag, desc, area, kW, V, poles, rpm, flc, frame, sf, vsd,
             syncRpm: 120*50/poles };
  }

  /* Vessels — silos & temper bins */
  const VESSELS = [
    // tag, label, area, capacity(t), type
    ['S1','Silo 1','silos',120,'grain'],
    ['S2','Silo 2','silos',120,'grain'],
    ['S3','Silo 3','silos',120,'grain'],
    ['S4','Silo 4','silos',120,'grain'],
    ['S5','Silo 5','silos',80,'grain'],
    ['S6','Silo 6','silos',80,'grain'],
    ['TB1','Temper Bin 1','temper',45,'grain'],
    ['TB2','Temper Bin 2','temper',45,'grain'],
    ['TB3','Temper Bin 3','temper',45,'grain'],
    ['TB4','Temper Bin 4','temper',45,'grain'],
  ];
  const GRAIN_TYPES = ['APH Wheat','AH Wheat','ASW Wheat','Durum','Soft Biscuit','Empty'];
  VESSELS.forEach((v,i) => {
    const [tag,,,cap] = v;
    defTag(tag + '_LEVEL', 20 + Math.random()*60, cfg.tagPrefix + tag + '.LevelPct'); // %
    defTag(tag + '_GRAIN', i < 6 ? (i % 5) : 0, cfg.tagPrefix + tag + '.GrainId', 'DINT');
    defTag(tag + '_MOIST', 11 + Math.random()*1.5, cfg.tagPrefix + tag + '.Moisture'); // %
    tags[tag + '_LEVEL'].cap = cap;
  });
  function vessel(tag){ return VESSELS.find(v => v[0] === tag); }

  /* Recipes / blends */
  const RECIPES = [
    // id, name, blend {grainId: pct}, targetMoisture, extraction%, targetTph
    { id:'BAK', name:"Baker's Flour",   blend:{0:60,1:40},     moisture:16.0, extraction:78, tph:12 },
    { id:'WHM', name:'Wholemeal',       blend:{1:50,2:50},     moisture:15.5, extraction:98, tph:10 },
    { id:'CAKE',name:'Cake / Soft',     blend:{4:80,2:20},     moisture:14.5, extraction:72, tph:9  },
    { id:'PIZ', name:'Pizza / Strong',  blend:{0:80,1:20},     moisture:16.5, extraction:76, tph:11 },
    { id:'PASTA',name:'Pasta Semolina', blend:{3:100},         moisture:16.0, extraction:65, tph:8  },
  ];

  /* Operators */
  const OPERATORS = ['R. Wyatt','J. Tan','M. Okafor','S. Petrov','L. Nguyen','D. Brooks'];

  /* Process / setpoint tags ---------------------------------------- */
  defTag('SP_ACTIVE_RECIPE', 0, cfg.tagPrefix + 'ActiveRecipe', 'DINT');
  defTag('SP_MILL_TPH',     12,  cfg.tagPrefix + 'MillRateSP');
  defTag('PV_MILL_TPH',     0,   cfg.tagPrefix + 'MillRatePV');
  defTag('SP_FILL_TPH',     45,  cfg.tagPrefix + 'IntakeRateSP');
  defTag('PV_FILL_TPH',     0,   cfg.tagPrefix + 'IntakeRatePV');
  defTag('SP_FILL_TARGET',  0,   cfg.tagPrefix + 'IntakeTargetSilo','DINT'); // silo index 0..5
  defTag('SP_FILL_GRAIN',   0,   cfg.tagPrefix + 'IntakeGrainId','DINT');

  defTag('SP_TEMPER_MOIST', 16.0,cfg.tagPrefix + 'TemperMoistSP');
  defTag('PV_TEMPER_MOIST', 0,   cfg.tagPrefix + 'TemperMoistPV');
  defTag('SP_TEMPER_TIME',  18,  cfg.tagPrefix + 'TemperTimeSP');  // hours
  defTag('SP_WATER_LPM',    0,   cfg.tagPrefix + 'WaterFlowSP');   // L/min (auto-calc)
  defTag('PV_WATER_LPM',    0,   cfg.tagPrefix + 'WaterFlowPV');
  defTag('PV_INLET_MOIST',  11.2,cfg.tagPrefix + 'InletMoisturePV');

  defTag('SP_B1_GAP',  0.55, cfg.tagPrefix + 'B1RollGapSP'); // mm
  defTag('SP_C1_GAP',  0.18, cfg.tagPrefix + 'C1RollGapSP');
  defTag('PV_EXTRACTION', 0, cfg.tagPrefix + 'ExtractionPV'); // %
  defTag('PV_ASH',     0.52, cfg.tagPrefix + 'AshPV');        // % ash (quality)

  /* line state */
  defTag('LINE_INTAKE_RUN', false, cfg.tagPrefix + 'IntakeSeqRun','BOOL');
  defTag('LINE_TEMPER_RUN', false, cfg.tagPrefix + 'TemperSeqRun','BOOL');
  defTag('LINE_MILL_RUN',   false, cfg.tagPrefix + 'MillSeqRun','BOOL');

  /* background / settings tags (rarely changed) */
  defTag('CFG_SILO_HI',   95,  cfg.tagPrefix + 'SiloHiAlarmSP');
  defTag('CFG_SILO_LO',   8,   cfg.tagPrefix + 'SiloLoAlarmSP');
  defTag('CFG_MOTOR_TEMP_HI', 95, cfg.tagPrefix + 'MotorTempAlarmSP');
  defTag('CFG_WATER_KFACTOR', 1.04, cfg.tagPrefix + 'WaterCalibKFactor');
  defTag('CFG_SCALE_SPAN', 1000, cfg.tagPrefix + 'WeighScaleSpan');
  defTag('CFG_DENSITY',   780,  cfg.tagPrefix + 'BulkDensity'); // kg/m3

  /* counters / production (totalised) */
  defTag('CNT_FLOUR_TODAY', 0, cfg.tagPrefix + 'FlourTotalToday');
  defTag('CNT_BRAN_TODAY',  0, cfg.tagPrefix + 'BranTotalToday');
  defTag('CNT_INTAKE_TODAY',0, cfg.tagPrefix + 'IntakeTotalToday');

  /* ================================================================
     ALARMS
     ================================================================ */
  const alarmState = new Map(); // key -> {sev, msg, ts, ack}
  function setAlarm(key, sev, msg){
    if (!alarmState.has(key)) alarmState.set(key, { sev, msg, ts: Date.now(), ack:false });
    else { const a = alarmState.get(key); a.sev = sev; a.msg = msg; }
  }
  function clearAlarm(key){ alarmState.delete(key); }
  function activeAlarms(){ return [...alarmState.entries()].map(([key,a]) => ({ key, ...a })); }
  function ackAll(){ for (const a of alarmState.values()) a.ack = true; }

  function evalAlarms(){
    const hi = read('CFG_SILO_HI'), lo = read('CFG_SILO_LO');
    const mtHi = read('CFG_MOTOR_TEMP_HI');
    VESSELS.forEach(v => {
      const lvl = read(v[0] + '_LEVEL');
      const k = v[0] + '_LVL';
      if (lvl >= hi) setAlarm(k, 'alarm', `${v[1]} HIGH level ${lvl.toFixed(0)}%`);
      else if (lvl <= lo && v[2]==='silos') setAlarm(k, 'warn', `${v[1]} LOW level ${lvl.toFixed(0)}%`);
      else clearAlarm(k);
    });
    MOTORS.forEach(m => {
      const t = m[0];
      if (read(t+'_FAULT')) setAlarm(t+'_FLT','alarm', `${t} ${m[1]} — motor fault / overload trip`);
      else clearAlarm(t+'_FLT');
      const temp = read(t+'_TEMP');
      if (temp >= mtHi) setAlarm(t+'_TMP','warn', `${t} winding temp high ${temp.toFixed(0)}°C`);
      else clearAlarm(t+'_TMP');
    });
  }

  /* ================================================================
     DRIVERS
     ================================================================ */
  let driver, scanTimer;

  /* ---- Simulation driver ---------------------------------------- */
  const SimDriver = {
    name: 'sim',
    write(name, value){
      // certain writes have side-effects (faceplate start/stop/mode)
      _set(name, value);
      if (name.endsWith('_CMD')) {
        const tag = name.slice(0, -4);
        if (read(tag+'_AUTO')) return; // auto ignores manual cmd
        if (value && !read(tag+'_FAULT')) startMotor(tag);
        else stopMotor(tag);
      }
    },
    start(){
      if (scanTimer) clearInterval(scanTimer);
      scanTimer = setInterval(() => { sim.tick(); evalAlarms(); }, cfg.scanRateMs);
      _conn('sim');
    },
    stop(){ if (scanTimer) clearInterval(scanTimer); },
  };

  function startMotor(tag){ _set(tag+'_RUN', true); _set(tag+'_STARTS', read(tag+'_STARTS')+1); }
  function stopMotor(tag){ _set(tag+'_RUN', false); _set(tag+'_SPEED', 0); _set(tag+'_CURRENT', 0); }

  /* ---- Live driver (WebSocket → AB gateway) --------------------- */
  const LiveDriver = {
    name: 'live', ws: null, reconnect: null,
    write(name, value){
      const tag = tags[name];
      if (!tag) return;
      _set(name, value); // optimistic
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type:'write', tag: tag.addr, value }));
      }
    },
    start(){
      _conn('connecting');
      try {
        this.ws = new WebSocket(cfg.gatewayUrl);
      } catch (e) { _conn('offline'); this._retry(); return; }
      this.ws.onopen = () => {
        _conn('online');
        // subscribe to all mapped tags
        const subs = Object.values(tags).map(t => t.addr);
        this.ws.send(JSON.stringify({ type:'subscribe', tags: subs,
          plc: { path: cfg.plcPath, slot: cfg.plcSlot }, rate: cfg.scanRateMs }));
      };
      this.ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'data') {
          // map addr → tag name
          for (const [addr, val] of Object.entries(msg.values)) {
            const t = Object.values(tags).find(x => x.addr === addr);
            if (t) _set(t.name, val);
          }
          evalAlarms();
        }
      };
      this.ws.onclose = () => { _conn('offline'); this._retry(); };
      this.ws.onerror = () => { _conn('offline'); };
    },
    _retry(){ clearTimeout(this.reconnect); this.reconnect = setTimeout(() => this.start(), 4000); },
    stop(){ if (this.ws) { this.ws.onclose = null; this.ws.close(); } clearTimeout(this.reconnect); },
  };

  /* connection state broadcast */
  let connState = 'offline';
  function _conn(s){ connState = s; emit('__conn__'); }
  function connection(){ return connState; }

  /* ================================================================
     PROCESS SIMULATION
     ================================================================ */
  const sim = (() => {
    const trends = { tph: [], moist: [], extraction: [] };
    function pushTrend(){
      const cap = 60;
      trends.tph.push(read('PV_MILL_TPH'));
      trends.moist.push(read('PV_TEMPER_MOIST'));
      trends.extraction.push(read('PV_EXTRACTION'));
      for (const k in trends) if (trends[k].length > cap) trends[k].shift();
    }
    let lastTotalise = Date.now();

    function tick(){
      const dt = cfg.scanRateMs / 1000;

      /* --- auto sequencing: in AUTO, motors follow the line state -- */
      autoSequence();

      /* --- INTAKE / SILO FILLING --------------------------------- */
      const intakeRun = read('LINE_INTAKE_RUN') && read('M_BE1_RUN') && read('M_IC1_RUN');
      const fillTph = intakeRun ? approach(read('PV_FILL_TPH'), read('SP_FILL_TPH'), 6*dt) : approach(read('PV_FILL_TPH'),0,20*dt);
      _set('PV_FILL_TPH', fillTph);
      if (intakeRun) {
        const tIdx = read('SP_FILL_TARGET');
        const vt = VESSELS[tIdx];
        if (vt) {
          const cap = tags[vt[0]+'_LEVEL'].cap;
          const add = (fillTph * dt/3600) / cap * 100;
          _set(vt[0]+'_LEVEL', clamp(read(vt[0]+'_LEVEL') + add, 0, 100));
          _set(vt[0]+'_GRAIN', read('SP_FILL_GRAIN'));
        }
        _set('CNT_INTAKE_TODAY', read('CNT_INTAKE_TODAY') + fillTph*dt/3600);
      }

      /* --- TEMPERING --------------------------------------------- */
      const temperRun = read('LINE_TEMPER_RUN') && read('M_DAMP_RUN');
      _set('PV_INLET_MOIST', approach(read('PV_INLET_MOIST'), 11.2 + Math.sin(Date.now()/9e4)*0.4, 0.05));
      // water added to reach target moisture; flow auto-calculated
      const inlet = read('PV_INLET_MOIST');
      const tgt = read('SP_TEMPER_MOIST');
      // throughput driving the dampener — use intake rate, fall back to mill rate
      const throughput = read('PV_FILL_TPH') > 0.5 ? read('SP_FILL_TPH') : read('SP_MILL_TPH');
      const flowSP = temperRun ? Math.max(0,(tgt - inlet)) * throughput * 0.18 * read('CFG_WATER_KFACTOR') : 0;
      _set('SP_WATER_LPM', flowSP);
      _set('PV_WATER_LPM', approach(read('PV_WATER_LPM'), read('M_WP1_RUN')?flowSP:0, 4*dt));
      const moistTarget = temperRun ? tgt : inlet;
      _set('PV_TEMPER_MOIST', approach(read('PV_TEMPER_MOIST'), moistTarget, 0.06));
      // temper bins fill/drain slowly
      if (temperRun) {
        ['TB1','TB2'].forEach(b => _set(b+'_LEVEL', clamp(read(b+'_LEVEL') + (Math.random()*0.3-0.05), 5, 100)));
        ['TB1','TB2','TB3','TB4'].forEach(b => _set(b+'_MOIST', approach(read(b+'_MOIST'), tgt, 0.02)));
      }

      /* --- MILLING ----------------------------------------------- */
      const millRun = read('LINE_MILL_RUN') && read('M_B1_RUN') && read('M_C1_RUN') && read('M_PNF_RUN');
      const millTph = millRun ? approach(read('PV_MILL_TPH'), read('SP_MILL_TPH'), 4*dt) : approach(read('PV_MILL_TPH'),0,15*dt);
      _set('PV_MILL_TPH', millTph);
      const rec = RECIPES[read('SP_ACTIVE_RECIPE')] || RECIPES[0];
      const extTarget = millRun ? rec.extraction + (read('SP_B1_GAP')-0.55)*-8 : 0;
      _set('PV_EXTRACTION', approach(read('PV_EXTRACTION'), clamp(extTarget,0,100), 1.2*dt*10));
      _set('PV_ASH', approach(read('PV_ASH'), 0.45 + (read('PV_EXTRACTION')/100)*0.35 + (read('SP_C1_GAP')-0.18)*0.3, 0.01));
      if (millRun) {
        const flour = millTph * (read('PV_EXTRACTION')/100) * dt/3600;
        const bran  = millTph * (1-read('PV_EXTRACTION')/100) * dt/3600;
        _set('CNT_FLOUR_TODAY', read('CNT_FLOUR_TODAY') + flour);
        _set('CNT_BRAN_TODAY',  read('CNT_BRAN_TODAY') + bran);
        // draw down temper bins feeding the mill
        ['TB3','TB4'].forEach(b => _set(b+'_LEVEL', clamp(read(b+'_LEVEL') - millTph*dt/3600/45*100, 0, 100)));
      }

      /* --- per-motor live values --------------------------------- */
      MOTORS.forEach(m => {
        const t = m[0], flc = m[7], vsd = m[10];
        if (read(t+'_RUN')) {
          const tgtSpeed = vsd ? speedDemand(t) : 100;
          _set(t+'_SPEED', approach(read(t+'_SPEED'), tgtSpeed, 30*dt));
          const load = 0.4 + (read(t+'_SPEED')/100)*0.5 + Math.random()*0.08;
          _set(t+'_CURRENT', flc * load);
          _set(t+'_RUNHRS', read(t+'_RUNHRS') + dt/3600);
          _set(t+'_TEMP', approach(read(t+'_TEMP'), 55 + load*30 + Math.random()*4, 0.2));
        } else {
          _set(t+'_SPEED', 0); _set(t+'_CURRENT', 0);
          _set(t+'_TEMP', approach(read(t+'_TEMP'), 32, 0.1));
        }
      });

      pushTrend();
      // periodic recipe-run logging handled in app layer via counters
    }

    function speedDemand(t){
      // VSD motors track a process demand
      if (['M_B1','M_B2','M_C1','M_C2','M_PNF'].includes(t)) return clamp(read('SP_MILL_TPH')/14*100, 30, 100);
      if (['M_PC1','M_DEDUST'].includes(t)) return clamp(read('SP_FILL_TPH')/50*100, 40, 100);
      if (t==='M_DAMP'||t==='M_WP1') return clamp(read('PV_WATER_LPM')*4+40, 40, 100);
      return 100;
    }

    function autoSequence(){
      // Motors in AUTO follow their line sequence run flag
      const map = {
        silos:  read('LINE_INTAKE_RUN'),
        temper: read('LINE_TEMPER_RUN'),
        mill:   read('LINE_MILL_RUN'),
      };
      MOTORS.forEach(m => {
        const t = m[0], area = m[2];
        if (read(t+'_AUTO') && !read(t+'_FAULT')) {
          const shouldRun = !!map[area];
          if (shouldRun && !read(t+'_RUN')) startMotor(t);
          if (!shouldRun && read(t+'_RUN')) stopMotor(t);
        }
      });
    }

    return { tick, trends };
  })();

  function approach(cur, target, step){
    if (cur < target) return Math.min(cur + step, target);
    if (cur > target) return Math.max(cur - step, target);
    return cur;
  }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

  /* ================================================================
     PUBLIC API
     ================================================================ */
  function setDriver(name){
    if (driver) driver.stop();
    driver = name === 'live' ? LiveDriver : SimDriver;
    cfg.driver = driver.name; saveCfg();
    driver.start();
  }
  function connectLive(){ setDriver('live'); }
  function connectSim(){ setDriver('sim'); }

  function getCfg(){ return { ...cfg }; }
  function setCfg(patch){ cfg = { ...cfg, ...patch }; saveCfg(); }

  function start(){ setDriver(cfg.driver); }

  /* trigger a simulated fault (for demo / training) */
  function injectFault(tag){ _set(tag+'_FAULT', true); _set(tag+'_RUN', false); }
  function resetFault(tag){ _set(tag+'_FAULT', false); }

  return {
    start, setDriver, connectLive, connectSim, connection,
    read, readAll, write, onUpdate,
    tags, MOTORS, VESSELS, RECIPES, OPERATORS, GRAIN_TYPES,
    motorMeta, vessel,
    activeAlarms, ackAll, evalAlarms, injectFault, resetFault,
    getCfg, setCfg,
    trends: () => sim.trends,
    _internal: { tags },
  };
})();

window.PLC = PLC;

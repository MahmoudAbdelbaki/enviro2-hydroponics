// TwinSession: owns one "farm" simulation (where faults are injected) and one
// fault-free "shadow twin" simulation of the same farm, advanced in lock-step.
//
//   farm  (seed 42) : the stand-in for the physical farm. Faults go here.
//   twin  (seed 7)  : same FarmSpec, same actions, never faulted. Its sensor
//                     readings are what the farm *should* be reading.
//
// Pure ES module (no DOM) so tests/headless_twin.test.mjs can drive it from Node.

import { Autopilot } from './autopilot.js';
import { buildFarmSpec, cloneDesign, IDS } from '../domain/presets.js';

const STEP_SEC = 300;
export const SPEEDS = [
  { id: '1x', label: '1x', hoursPerSec: 1 },
  { id: '10x', label: '10x', hoursPerSec: 10 },
  { id: 'slow', label: '1 h/s', hoursPerSec: 1 },
  { id: 'med', label: '6 h/s', hoursPerSec: 6 },
  { id: 'fast', label: '1 day/s', hoursPerSec: 24 },
];
const BATCH_MS = 250;
const MAX_HISTORY = 24 * 60;

const HOUR = 3600;
const MAX_TIMELINE = 120;

export const FAULT_TO_SENSOR = Object.freeze({
  pump_degradation: { sensorKind: 'DO', sensorId: 'sen-do-1', zone: 'Gully B1 / Ch-1' },
  aeration_loss: { sensorKind: 'DO', sensorId: 'sen-do-1', zone: 'Reservoir / Aer-1' },
  probe_drift: { sensorKind: 'pH', sensorId: 'sen-ph-1', zone: 'Reservoir (sen-ph-1)' },
  heat_wave: { sensorKind: 'T_air', sensorId: 'sen-tair-1', zone: 'Greenhouse Canopy' },
  reservoir_leak: { sensorKind: 'V_res', sensorId: 'sen-vres-1', zone: 'Reservoir (res-1)' },
  nutrient_imbalance: { sensorKind: 'EC', sensorId: 'sen-ec-1', zone: 'Stock A / Res-1' },
});

export const ALERT_TO_SENSOR = Object.freeze({
  IMPLIED_PUMP_OR_AERATION_FAULT: {
    sensorKind: 'DO',
    sensorId: 'sen-do-1',
    faultKinds: ['pump_degradation', 'aeration_loss'],
    summary: 'Flow / oxygen fault inferred via DO divergence',
  },
  PH_PROBE_DRIFT_SUSPECTED: {
    sensorKind: 'pH',
    sensorId: 'sen-ph-1',
    faultKinds: ['probe_drift'],
    summary: 'pH probe calibration drift inferred; switched to twin observer',
  },
  RESERVOIR_LEAK_SUSPECTED: {
    sensorKind: 'V_res',
    sensorId: 'sen-vres-1',
    faultKinds: ['reservoir_leak'],
    summary: 'Reservoir leak inferred from tank mass-balance divergence',
  },
  HEAT_STRESS_EVENT: {
    sensorKind: 'T_air',
    sensorId: 'sen-tair-1',
    faultKinds: ['heat_wave'],
    summary: 'Greenhouse heat stress inferred; lowering EC target -0.2',
  },
  NUTRIENT_MIX_ANOMALY: {
    sensorKind: 'EC',
    sensorId: 'sen-ec-1',
    faultKinds: ['nutrient_imbalance'],
    summary: 'Nutrient mix concentration anomaly inferred after dosing',
  },
  NUTRIENT_IMBALANCE: {
    sensorKind: 'EC',
    sensorId: 'sen-ec-1',
    faultKinds: ['nutrient_imbalance'],
    summary: 'Nutrient imbalance inferred from EC divergence',
  },
});

const SENSOR_META = {
  DO: { id: 'sen-do-1', unit: 'mg/L', loc: 'Ch-1 outlet', digits: 2 },
  pH: { id: 'sen-ph-1', unit: 'pH', loc: 'Res-1 probe', digits: 2 },
  EC: { id: 'sen-ec-1', unit: 'mS/cm', loc: 'Res-1 probe', digits: 2 },
  T_air: { id: 'sen-tair-1', unit: '°C', loc: 'Canopy enc-1', digits: 1 },
  V_res: { id: 'sen-vres-1', unit: 'L', loc: 'Res-1 level', digits: 1 },
};

export const STOCK_DEFS = Object.freeze({
  a: {
    key: 'a',
    label: 'Stock A',
    short: 'PART A · N / Ca',
    baseCapMl: 300,
    lowRatio: 0.2,
    componentId: IDS.stockA,
    lowCode: 'STOCK_A_LOW',
    emptyCode: 'STOCK_A_EMPTY',
    consequence: 'Calcium & nitrogen feeding paused — EC will drift down as plants feed.',
  },
  b: {
    key: 'b',
    label: 'Stock B',
    short: 'PART B · P / K / Mg',
    baseCapMl: 300,
    lowRatio: 0.2,
    componentId: IDS.stockB,
    lowCode: 'STOCK_B_LOW',
    emptyCode: 'STOCK_B_EMPTY',
    consequence: 'Phosphate & potassium feeding paused — EC will drift down as plants feed.',
  },
  ph: {
    key: 'ph',
    label: 'pH Buffer',
    short: 'HNO₃ / KOH',
    baseCapMl: 550,
    lowRatio: 0.2,
    componentId: IDS.acid,
    lowCode: 'STOCK_PH_LOW',
    emptyCode: 'STOCK_PH_EMPTY',
    consequence: 'pH control paused — root nitrate uptake & source alkalinity will push pH upward.',
  },
});

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `+${h}h ${String(m).padStart(2, '0')}m` : `+${m}m`;
}

class Emitter {
  constructor() { this.handlers = new Map(); }
  on(evt, fn) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt).add(fn);
    return () => this.handlers.get(evt).delete(fn);
  }
  emit(evt, payload) { for (const fn of this.handlers.get(evt) || []) fn(payload); }
}

export class TwinSession extends Emitter {
  constructor(api, { autopilotEnabled = true, enforceStockDepletion = false } = {}) {
    super();
    this.api = api;
    this.autopilotEnabled = autopilotEnabled;
    this.enforceStockDepletion = enforceStockDepletion;
    this.reset();
  }

  _initStocks(design) {
    const volScale = (design?.reservoir?.volumeL || 100) / 100;
    const chScale = ((design?.channels?.count || 2) / 2) * 0.75;
    const scale = Math.max(1, volScale, chScale);
    const out = {};
    for (const [k, def] of Object.entries(STOCK_DEFS)) {
      const cap = Math.round(def.baseCapMl * scale);
      out[k] = {
        key: k,
        label: def.label,
        short: def.short,
        componentId: def.componentId,
        capacityMl: cap,
        remainingMl: cap,
        usedMl: 0,
        pct: 100,
        status: 'ok',
        lastDoseMl: 0,
        refillsCount: 0,
      };
    }
    return out;
  }

  resetStocksToFull() {
    this.stocks = this._initStocks(this.design);
    this.stockAlerts = [];
    this._stockAlertState = { a: 'ok', b: 'ok', ph: 'ok' };
    this.emit('update', this);
  }

  _updateStockStatus(s) {
    s.remainingMl = Math.max(0, Math.round(s.remainingMl * 100) / 100);
    s.pct = s.capacityMl > 0 ? Math.max(0, Math.min(100, Math.round((s.remainingMl / s.capacityMl) * 100))) : 0;
    s.status = s.remainingMl < 1 ? 'empty' : s.remainingMl <= s.capacityMl * STOCK_DEFS[s.key].lowRatio ? 'low' : 'ok';
  }

  reset() {
    this.design = null;
    this.spec = null;
    this.farmId = null;
    this.simId = null;
    this.twinId = null;
    this.status = null;
    this.gt = null;
    this.twinGt = null;
    this.latest = {};       // latest farm sensor reading per kind
    this.latestBySensor = {}; // latest reading per sensor_id (e.g. sen-do-1..sen-do-N)
    this.history = [];      // hourly samples for charts
    this.alerts = [];
    this.stockAlerts = [];
    this._stockAlertState = { a: 'ok', b: 'ok', ph: 'ok' };
    this._stockSeq = 0;
    this.stocks = this._initStocks(null);
    this.commands = [];
    this.events = [];       // local feed items (commands + alerts + notes), newest first
    this.residuals = {};
    this.autopilot = null;
    this.playing = false;
    this.speed = SPEEDS[1];
    this.busy = false;
    this.lastDose = null;   // {at, cmd} for 3D dosing animation

    // Decoupled Ground-Truth vs. Observed-Telemetry diagnosis state
    this.timelineEvents = [];        // chronological { id, kind: 'truth'|'drift'|'ai', tag, simTimeSec, ... }
    this.driftingSensors = new Set(); // observed sensor kinds currently diverging before alert confirmation
    this.sensorDriftDetails = {};    // { [kind]: { from, to, expected, atSec, detail } }
    this._lastNominal = {};          // last known healthy observed reading per sensor kind
    this._recentVresWindow = [];     // rolling observed tank volume samples adjusted for accepted refills
    this._loggedDriftEpisode = new Set();
    this._seenAlertKeys = new Set();
    this._truthInjectedAt = {};
    this._timelineSeq = 0;
    this._resetVresWindowOnNext = false;
    this._lastChemAcceptedSec = -Infinity;
    this.acknowledgedAlerts = new Map(); // alertKey -> { ackAtSec, code, componentId }
  }

  get simDays() { return (this.status?.sim_time_sec || 0) / 86400; }
  get seasonDays() { return this.design?.seasonDays || 30; }
  get activeFaults() { return this.status?.active_faults || []; }

  /** Combined chronological list of simulation alerts and farmer stock bottle alerts. */
  getAllAlerts() {
    const combined = [...(this.alerts || []), ...(this.stockAlerts || [])];
    combined.sort((a, b) => (a.sim_time_sec || 0) - (b.sim_time_sec || 0));
    return combined;
  }

  /** Compute currently open (unresolved) alerts and info count strictly from alert stream. */
  getAlertSummary() {
    const openByCode = new Map();
    let infoCount = 0;
    for (const a of this.getAllAlerts()) {
      if (a.code?.endsWith('_RESOLVED')) {
        openByCode.delete(a.code.slice(0, -'_RESOLVED'.length));
        infoCount++;
      } else if (a.severity === 'critical' || a.severity === 'warning') {
        openByCode.set(a.code, a);
      } else {
        infoCount++;
      }
    }
    const open = [...openByCode.values()];
    const openStock = open.filter((a) => a.code?.startsWith('STOCK_'));
    return { open, openStock, infoCount };
  }

  getOpenStockAlerts() {
    return this.getAlertSummary().openStock;
  }

  /**
   * Overall AI diagnostic stage derived ONLY from observed sensor telemetry & alerts.
   * Never reads `activeFaults` (ground truth remains hidden until telemetry diverges).
   */
  getDiagnosticStage() {
    const { open, infoCount } = this.getAlertSummary();
    const driftingKinds = [...this.driftingSensors];
    const stage = open.length > 0 ? 'fault' : driftingKinds.length > 0 ? 'drifting' : 'nominal';
    return { stage, open, infoCount, driftingKinds };
  }
  get readings() {
    const out = {};
    for (const [k, r] of Object.entries(this.latest || {})) {
      if (r && r.value != null) {
        out[k] = r.value;
        if (r.sensor_id) out[r.sensor_id] = r.value;
      }
    }
    return out;
  }

  /** Create the farm + single simulation from a design. */
  async start(design) {
    this.pause();
    const keepAuto = this.autopilotEnabled;
    const keepEnforce = this.enforceStockDepletion;
    const keepSpeed = this.speed;
    this.reset();
    this.autopilotEnabled = keepAuto;
    this.enforceStockDepletion = keepEnforce;
    this.speed = keepSpeed;
    this.design = cloneDesign(design);
    this.stocks = this._initStocks(this.design);
    this.spec = buildFarmSpec(this.design);
    const farm = await this.api.createFarm(this.spec);
    this.farmId = farm.id;
    const sim = await this.api.createSimulation({ farm_id: farm.id, seed: 42, step_seconds: STEP_SEC, mode: 'paused' });
    this.simId = sim.id;
    this.status = sim;
    this.autopilot = new Autopilot(this.design, this.spec);
    await this.refresh(0);
    this.emit('started', this);
    this.emit('update', this);
  }

  setSpeed(id) {
    this.speed = SPEEDS.find((s) => s.id === id) || this.speed;
    this.emit('update', this);
  }

  play() {
    if (!this.simId || this.playing) return;
    if (this.simDays >= this.seasonDays) return;
    this.playing = true;
    this.emit('update', this);
    this.loop();
  }

  pause() {
    this.playing = false;
    clearTimeout(this.timer);
    this.emit('update', this);
  }

  async loop() {
    if (!this.playing) return;
    const t0 = performance.now();
    const steps = Math.max(1, Math.round((this.speed.hoursPerSec * 3600 * (BATCH_MS / 1000)) / STEP_SEC));
    try {
      await this.step(steps);
    } catch (err) {
      this.playing = false;
      this.emit('error', err);
    }
    if (this.simDays >= this.seasonDays) {
      this.playing = false;
      this.emit('harvest', this);
    }
    this.emit('update', this);
    if (this.playing) this.timer = setTimeout(() => this.loop(), Math.max(0, BATCH_MS - (performance.now() - t0)));
  }

  /** Advance the world by N simulated days in 2h autopilot chunks. */
  async fastForwardDays(days) {
    if (!this.simId || days <= 0) return;
    const wasPlaying = this.playing;
    this.pause();
    const targetSteps = Math.max(1, Math.round((days * 86400) / STEP_SEC));
    await this.step(targetSteps, { chunk: 24 });
    if (this.simDays >= this.seasonDays) this.emit('harvest', this);
    this.emit('update', this);
    if (wasPlaying && this.simDays < this.seasonDays) this.play();
  }

  /** Advance the world by 1 full day (288 steps = 24 hours). */
  async advanceDay() {
    return this.fastForwardDays(1);
  }

  /** Advance the world by `steps` ticks, running autopilot across chunks. */
  async step(steps, { chunk = 24 } = {}) {
    if (this.busy) return;
    this.busy = true;
    try {
      let remaining = steps;
      // Advance in <= 2 h chunks so the autopilot can act right at its mixing cooldown cadence.
      while (remaining > 0) {
        const n = Math.min(remaining, chunk);
        remaining -= n;
        const st = await this.api.advance(this.simId, n);
        this.status = st;
        await this.refresh(n);
      }
    } finally {
      this.busy = false;
    }
  }

  async refresh(stepsJustRun) {
    const nSensors = this.spec.sensors.length;
    const limit = Math.min(5000, Math.max(400, (stepsJustRun + 30) * nSensors));
    const [gt, farmRd] = await Promise.all([
      this.api.groundTruth(this.simId),
      this.api.readings(this.simId, limit),
    ]);
    this.gt = gt;
    for (const r of farmRd) {
      if (!(r.kind in this.latest) || this.latest[r.kind].sim_time_sec < r.sim_time_sec) {
        this.latest[r.kind] = r;
      }
      if (
        r.sensor_id &&
        (!(r.sensor_id in this.latestBySensor) || this.latestBySensor[r.sensor_id].sim_time_sec < r.sim_time_sec)
      ) {
        this.latestBySensor[r.sensor_id] = r;
      }
    }
    const simTimeSec = gt.sim_time_sec;

    let evalExpected = null;
    if (this.autopilot && stepsJustRun > 0) {
      const res = this.autopilot.decide({
        simTimeSec,
        measuredReadings: farmRd,
        stocks: this.enforceStockDepletion ? this.stocks : null,
        pauseDosing: !this.autopilotEnabled,
      });
      if (res.decided) {
        evalExpected = this.autopilot.lastExpected;
        this.residuals = res.residuals;
        await this.applyDecision(res, simTimeSec);
        this.pushHistory(simTimeSec, gt, res.residuals);
      }
    } else if (stepsJustRun > 0) {
      this.pushHistory(simTimeSec, gt, this.residuals);
    }

    if (stepsJustRun > 0 || this.commands.length === 0) {
      const [alerts, commands] = await Promise.all([
        this.api.listAlerts(this.simId),
        this.api.listCommands(this.simId, 500),
      ]);
      this.alerts = alerts;
      this.commands = commands;
    }

    if (stepsJustRun > 0) {
      this._evaluateSymptoms(simTimeSec, farmRd, evalExpected);
      this._syncAlertsToTimeline();
    }
  }

  _pushTimeline(entry) {
    this.timelineEvents.push({ id: ++this._timelineSeq, ...entry });
    if (this.timelineEvents.length > MAX_TIMELINE) this.timelineEvents.shift();
  }

  _windowMean(farmRd, kind, fromSec, toSec) {
    let sum = 0;
    let n = 0;
    for (let i = farmRd.length - 1; i >= 0; i--) {
      const r = farmRd[i];
      if (r.kind !== kind || r.value == null) continue;
      if (r.sim_time_sec <= toSec && r.sim_time_sec >= fromSec) {
        sum += r.value;
        n++;
      }
    }
    return n > 0 ? sum / n : null;
  }

  /** Detect early pre-alarm sensor drift strictly from observed telemetry vs. expected twin state. */
  _evaluateSymptoms(simTimeSec, farmRd, preDoseExpected = null) {
    if (!this.autopilot) return;
    const { open } = this.getAlertSummary();
    const openByKind = new Set(
      open.map((a) => ALERT_TO_SENSOR[a.code]?.sensorKind).filter(Boolean)
    );
    const openCodes = new Set(open.map((a) => a.code));

    const winMean = (k, span = 1800) => this._windowMean(farmRd, k, simTimeSec - span, simTimeSec) ?? this.latest[k]?.value ?? null;
    const obs = {
      DO: winMean('DO', 1800),
      pH: winMean('pH', 2 * HOUR),
      EC: winMean('EC', 1800),
      T_air: winMean('T_air', 1800),
      T_w: winMean('T_w', 1800),
      V_res: winMean('V_res', 1800),
    };

    if (this._resetVresWindowOnNext) {
      this._recentVresWindow = [];
      this._resetVresWindowOnNext = false;
    } else if (obs.V_res != null) {
      const last = this._recentVresWindow[this._recentVresWindow.length - 1];
      if (!last || simTimeSec > last.t) {
        this._recentVresWindow.push({ t: simTimeSec, v: obs.V_res });
        while (this._recentVresWindow.length > 0 && simTimeSec - this._recentVresWindow[0].t > 2 * HOUR) {
          this._recentVresWindow.shift();
        }
      }
    }

    // Allow initial 12h baseline equilibration (startup UI already pre-warms 3 days)
    if (simTimeSec < 12 * HOUR) return;

    const exp = preDoseExpected || this.autopilot.computeExpected(simTimeSec, {
      tw: obs.T_w ?? 22.0,
      ec: obs.EC ?? this.autopilot.twinEC,
    });
    const streak = this.autopilot.streak || {};

    // Compare trailing 30-min tank level mean against prior smoothed baseline to catch leaks without false noise spikes
    let vDropRate = 0;
    let vFrom = null;
    const extraTranspRate = Math.max(0, (exp.V_res || 0.15) - 0.15);
    if (this._recentVresWindow.length >= 2 && obs.V_res != null) {
      for (const ref of this._recentVresWindow) {
        const dtHr = (simTimeSec - ref.t) / HOUR;
        const deltaV = ref.v - obs.V_res;
        const rate = dtHr > 0 ? deltaV / dtHr : 0;
        const excessRate = Math.max(0, rate - extraTranspRate);
        const rapidLeak = dtHr >= 0.65 && deltaV >= 1.15 && excessRate >= 1.85;
        const steadyLeak = dtHr >= 1.5 && deltaV >= 1.45 && excessRate >= 1.05;
        if ((rapidLeak || steadyLeak) && rate > vDropRate) {
          vDropRate = rate;
          vFrom = ref.v;
        }
      }
    }

    const phDepleted = !!(this.enforceStockDepletion && this.stocks?.ph?.status === 'empty');
    const ecDepleted = !!(this.enforceStockDepletion && (this.stocks?.a?.status === 'empty' || this.stocks?.b?.status === 'empty'));

    const checks = [
      {
        kind: 'DO',
        active: obs.DO != null && exp.DO != null && ((exp.DO - obs.DO >= 0.27) || (streak.DO >= 1 && exp.DO - obs.DO >= 0.16)),
        recover: obs.DO != null && exp.DO != null && (exp.DO - obs.DO < 0.14) && !streak.DO,
        cur: obs.DO,
        expected: exp.DO,
        msg: (from, cur, e) => `sen-do-1 (Ch-1) fell from ${from.toFixed(2)} to ${cur.toFixed(2)} mg/L (expected ${e.toFixed(2)})`,
      },
      {
        kind: 'pH',
        active: !phDepleted && obs.pH != null && exp.pH != null && (obs.pH - exp.pH >= 0.47),
        recover: phDepleted || (obs.pH != null && exp.pH != null && (obs.pH - exp.pH < 0.12) && !streak.pH),
        cur: obs.pH,
        expected: exp.pH,
        msg: (from, cur, e) => `sen-ph-1 (Res-1) drifted to ${cur.toFixed(2)} pH (baseline ${from.toFixed(2)}, twin ${e.toFixed(2)})`,
      },
      {
        kind: 'EC',
        active: !ecDepleted && !openCodes.has('RESERVOIR_LEAK_SUSPECTED') && obs.EC != null && exp.EC != null && ((obs.EC - exp.EC >= 0.085) || streak.EC >= 1),
        recover: ecDepleted || (obs.EC != null && exp.EC != null && (obs.EC - exp.EC < 0.04) && !streak.EC),
        cur: obs.EC,
        expected: exp.EC,
        msg: (from, cur, e) => `sen-ec-1 (Res-1) rose to ${cur.toFixed(2)} mS/cm (baseline ${from.toFixed(2)}, twin ${e.toFixed(2)})`,
      },
      {
        kind: 'T_air',
        active: obs.T_air != null && exp.T_air != null && ((obs.T_air - exp.T_air >= 3.25) || streak.T_air >= 1),
        recover: obs.T_air != null && exp.T_air != null && (obs.T_air - exp.T_air < 2.2) && !streak.T_air,
        cur: obs.T_air,
        expected: exp.T_air,
        msg: (from, cur, e) => `sen-tair-1 (Enc-1) heated to ${cur.toFixed(1)} °C (expected ${e.toFixed(1)} °C, +${(cur - e).toFixed(1)})`,
      },
      {
        kind: 'V_res',
        active: obs.V_res != null && (vDropRate > 0 || streak.V_res >= 1),
        recover: vDropRate === 0 && !streak.V_res,
        cur: obs.V_res,
        expected: vFrom ?? obs.V_res,
        msg: (_from, cur, fromV) => `sen-vres-1 (Res-1) losing water at ~${Math.max(0.9, vDropRate).toFixed(1)} L/hr (${(fromV ?? cur).toFixed(1)} → ${cur.toFixed(1)} L)`,
      },
    ];

    for (const c of checks) {
      if (openByKind.has(c.kind)) {
        // Already promoted to a confirmed AI alert
        this.driftingSensors.delete(c.kind);
        continue;
      }
      if (c.active) {
        const baseline = this._lastNominal[c.kind] ?? c.expected ?? c.cur;
        this.driftingSensors.add(c.kind);
        this.sensorDriftDetails[c.kind] = {
          sensorId: SENSOR_META[c.kind]?.id || c.kind,
          from: baseline,
          to: c.cur,
          expected: c.expected,
          atSec: simTimeSec,
          detail: c.msg(baseline, c.cur, c.expected),
        };
        if (!this._loggedDriftEpisode.has(c.kind)) {
          this._loggedDriftEpisode.add(c.kind);
          this._pushTimeline({
            kind: 'drift',
            tag: 'SENSOR DRIFT',
            simTimeSec,
            sensorKind: c.kind,
            sensorId: SENSOR_META[c.kind]?.id,
            text: c.msg(baseline, c.cur, c.expected),
          });
        }
      } else {
        if (this.driftingSensors.has(c.kind) && c.recover) {
          this.driftingSensors.delete(c.kind);
          delete this.sensorDriftDetails[c.kind];
          this._loggedDriftEpisode.delete(c.kind);
        }
        if (!this.driftingSensors.has(c.kind) && c.cur != null) {
          this._lastNominal[c.kind] = c.cur;
        }
      }
    }
  }

  _syncAlertsToTimeline() {
    for (const a of this.alerts || []) {
      const key = `${a.id ?? ''}:${a.code}:${a.sim_time_sec}`;
      if (this._seenAlertKeys.has(key)) continue;
      this._seenAlertKeys.add(key);

      if (a.code?.endsWith('_RESOLVED')) {
        const base = a.code.slice(0, -'_RESOLVED'.length);
        const meta = ALERT_TO_SENSOR[base];
        if (meta?.sensorKind) {
          this.driftingSensors.delete(meta.sensorKind);
          delete this.sensorDriftDetails[meta.sensorKind];
          this._loggedDriftEpisode.delete(meta.sensorKind);
        }
        this._pushTimeline({
          kind: 'ai',
          tag: 'RECOVERED',
          simTimeSec: a.sim_time_sec,
          code: a.code,
          sensorKind: meta?.sensorKind,
          sensorId: meta?.sensorId,
          text: `${base} cleared — sensor telemetry back inside expected physics.`,
        });
        continue;
      }

      if (a.severity === 'critical' || a.severity === 'warning') {
        const meta = ALERT_TO_SENSOR[a.code];
        // Ensure causal Symptom Drift entry precedes AI confirmation even during fast-forward jumps
        if (meta?.sensorKind && !this._loggedDriftEpisode.has(meta.sensorKind)) {
          this._loggedDriftEpisode.add(meta.sensorKind);
          const sMeta = SENSOR_META[meta.sensorKind];
          const curVal = this.latest[meta.sensorKind]?.value;
          const resInfo = this.residuals?.[meta.sensorKind];
          const text = curVal != null && resInfo?.expected != null
            ? `${sMeta?.id || meta.sensorKind} (${sMeta?.loc || ''}) diverged to ${curVal.toFixed(sMeta?.digits ?? 2)} ${sMeta?.unit || ''} (expected ${resInfo.expected.toFixed(sMeta?.digits ?? 2)})`
            : `${meta.sensorId} crossed residual anomaly threshold`;
          this._pushTimeline({
            kind: 'drift',
            tag: 'SENSOR DRIFT',
            simTimeSec: Math.max(0, (a.sim_time_sec || 0) - 900),
            sensorKind: meta.sensorKind,
            sensorId: meta.sensorId,
            text,
          });
        }
        if (meta?.sensorKind) this.driftingSensors.delete(meta.sensorKind);
        let latencySec = null;
        if (meta?.faultKinds) {
          for (const fk of meta.faultKinds) {
            const inj = this._truthInjectedAt[fk];
            if (inj && a.sim_time_sec >= inj.atSec) {
              const dt = a.sim_time_sec - inj.atSec;
              if (latencySec == null || dt < latencySec) latencySec = dt;
            }
          }
        }
        this._pushTimeline({
          kind: 'ai',
          tag: 'AI INFERENCE',
          simTimeSec: a.sim_time_sec,
          code: a.code,
          sensorKind: meta?.sensorKind,
          sensorId: meta?.sensorId,
          latencySec,
          text: `${meta?.summary || a.code}${latencySec != null ? ` (${fmtDuration(latencySec)} after injection)` : ''}.`,
        });
      }
    }
  }

  _pushStockAlert({ simTimeSec, componentId, severity, code, message }) {
    this.stockAlerts.push({
      id: `stk-alrt-${++this._stockSeq}`,
      sim_time_sec: simTimeSec,
      component_id: componentId,
      severity,
      code,
      message,
    });
  }

  _evaluateStockAlerts(simTimeSec = this.gt?.sim_time_sec ?? this.status?.sim_time_sec ?? 0) {
    if (!this.enforceStockDepletion) return;
    for (const [k, def] of Object.entries(STOCK_DEFS)) {
      const s = this.stocks?.[k];
      if (!s) continue;
      this._updateStockStatus(s);
      const prev = this._stockAlertState[k] || 'ok';
      const next = s.status;
      if (next === prev) continue;

      if (next === 'empty') {
        if (prev === 'low') {
          this._pushStockAlert({
            simTimeSec,
            componentId: def.componentId,
            severity: 'info',
            code: `${def.lowCode}_RESOLVED`,
            message: `${def.label} low-stock notice superseded by empty bottle warning.`,
          });
        }
        this._pushStockAlert({
          simTimeSec,
          componentId: def.componentId,
          severity: 'critical',
          code: def.emptyCode,
          message: `${def.label} finished (0 mL remaining — top up needed). ${def.consequence}`,
        });
        this._pushTimeline({
          kind: 'farmer',
          tag: 'STOCK EMPTY',
          simTimeSec,
          stockKey: k,
          text: `${def.label} ran out (0 / ${s.capacityMl} mL left). ${def.consequence} Click Top Up to resume dosing.`,
        });
      } else if (next === 'low') {
        if (prev === 'empty') {
          this._pushStockAlert({
            simTimeSec,
            componentId: def.componentId,
            severity: 'info',
            code: `${def.emptyCode}_RESOLVED`,
            message: `${def.label} partial restock (${Math.round(s.remainingMl)} mL remaining).`,
          });
        }
        this._pushStockAlert({
          simTimeSec,
          componentId: def.componentId,
          severity: 'warning',
          code: def.lowCode,
          message: `${def.label} running low (${Math.round(s.remainingMl)} / ${s.capacityMl} mL, ${s.pct}%). Restock soon to prevent drift.`,
        });
        this._pushTimeline({
          kind: 'farmer',
          tag: 'LOW STOCK',
          simTimeSec,
          stockKey: k,
          text: `${def.label} down to ${s.pct}% (${Math.round(s.remainingMl)} mL left). Farmer restock recommended.`,
        });
      } else if (next === 'ok') {
        const codeToClose = prev === 'empty' ? def.emptyCode : def.lowCode;
        this._pushStockAlert({
          simTimeSec,
          componentId: def.componentId,
          severity: 'info',
          code: `${codeToClose}_RESOLVED`,
          message: `${def.label} topped up to ${s.capacityMl} mL (100%). Automated dosing resumed.`,
        });
      }
      this._stockAlertState[k] = next;
    }
  }

  _refillSingleStock(key, { simTimeSec, quiet = false } = {}) {
    const s = this.stocks?.[key];
    if (!s) return false;
    const prevState = s.status;
    s.remainingMl = s.capacityMl;
    s.refillsCount += 1;
    this._updateStockStatus(s);
    if (this.autopilot) {
      if (key === 'ph' && !this.autopilot.trustTwinPH && this.latest.pH?.value != null) {
        this.autopilot.twinPH = this.latest.pH.value;
      }
      if ((key === 'a' || key === 'b') && this.latest.EC?.value != null) {
        this.autopilot.twinEC = this.latest.EC.value;
      }
      this.autopilot.lastChemSec = -Infinity;
    }
    this._evaluateStockAlerts(simTimeSec);
    if (!quiet || prevState !== 'ok') {
      this._pushTimeline({
        kind: 'farmer',
        tag: 'TOP UP',
        simTimeSec,
        stockKey: key,
        text: `Farmer refilled ${s.label} to ${s.capacityMl} mL (100%) — automated ${key === 'ph' ? 'pH stabilization' : 'nutrient dosing'} resumed.`,
      });
    }
    return true;
  }

  refillStock(key) {
    const simTimeSec = this.gt?.sim_time_sec ?? this.status?.sim_time_sec ?? 0;
    const ok = this._refillSingleStock(key, { simTimeSec });
    if (ok) this.emit('update', this);
    return ok;
  }

  refillAllStocks() {
    const simTimeSec = this.gt?.sim_time_sec ?? this.status?.sim_time_sec ?? 0;
    let changed = false;
    for (const k of Object.keys(STOCK_DEFS)) {
      if (this._refillSingleStock(k, { simTimeSec, quiet: true })) changed = true;
    }
    if (changed) this.emit('update', this);
    return changed;
  }

  depleteStock(key, remainingMl = 0) {
    const s = this.stocks?.[key];
    if (!s) return false;
    const simTimeSec = this.gt?.sim_time_sec ?? this.status?.sim_time_sec ?? 0;
    const prevState = s.status;
    s.remainingMl = Math.max(0, Math.min(s.capacityMl, remainingMl));
    this._updateStockStatus(s);
    this._evaluateStockAlerts(simTimeSec);
    if (!this.enforceStockDepletion || prevState === s.status) {
      this._pushTimeline({
        kind: 'farmer',
        tag: 'SIMULATOR',
        simTimeSec,
        stockKey: key,
        text: `Simulated ${s.label} drained to ${Math.round(s.remainingMl)} mL.`,
      });
    }
    this.emit('update', this);
    return true;
  }

  _recordCommandResult(simTimeSec, cmd, rec) {
    if (rec?.status === 'accepted') {
      if (cmd.dose_stock_a_ml || cmd.dose_stock_b_ml || cmd.dose_acid_ml || cmd.dose_base_ml) {
        this._lastChemAcceptedSec = simTimeSec;
      }
      this.autopilot?.noteChemAccepted(simTimeSec, cmd);
      const applyUse = (key, amt) => {
        const s = this.stocks?.[key];
        if (!s || amt <= 0) return;
        s.usedMl += amt;
        s.lastDoseMl = amt;
        if (this.enforceStockDepletion) {
          s.remainingMl = Math.max(0, s.remainingMl - amt);
          this._updateStockStatus(s);
        }
      };
      applyUse('a', cmd.dose_stock_a_ml || 0);
      applyUse('b', cmd.dose_stock_b_ml || 0);
      applyUse('ph', (cmd.dose_acid_ml || 0) + (cmd.dose_base_ml || 0));
      this._evaluateStockAlerts(simTimeSec);
      if (cmd.refill_water_l) {
        // Clear rolling volume baseline so the top-up step does not distort pre- vs post-refill drop rates
        this._recentVresWindow = [];
        this._resetVresWindowOnNext = true;
      }
      this.lastDose = { at: performance.now(), cmd };
      this.emit('dose', cmd);
    } else {
      this._pushTimeline({
        kind: 'ai',
        tag: 'PLC GUARDIAN',
        simTimeSec: simTimeSec || this.gt?.sim_time_sec || 0,
        blocked: true,
        text: `Blocked unsafe command (${rec?.rejection_code || 'SAFETY_INTERLOCK'}): ${rec?.rejection_message || 'shock limit exceeded'}.`,
      });
      this.emit('rejected', rec);
    }
  }

  async applyDecision(res, simTimeSec) {
    for (const alert of res.alerts) {
      try {
        await this.api.postAlert(this.simId, alert);
        this.emit('alert', alert);
      } catch (err) {
        this.emit('error', err);
      }
    }
    for (const cmd of res.commands) {
      try {
        const rec = await this.api.postCommand(this.simId, cmd);
        this._recordCommandResult(simTimeSec, cmd, rec);
      } catch (err) {
        this.emit('error', err);
      }
    }
  }

  /** Submit a manual or test command directly through the PLC Safety Guardian. */
  async submitCommand(cmd) {
    if (!this.simId) return null;
    const hasChem = !!(cmd.dose_stock_a_ml || cmd.dose_stock_b_ml || cmd.dose_acid_ml || cmd.dose_base_ml);
    let curSec = this.status?.sim_time_sec ?? this.gt?.sim_time_sec ?? 0;
    if (hasChem && curSec - this._lastChemAcceptedSec < 1800) {
      try {
        this.status = await this.api.advance(this.simId, 4);
        curSec = this.status?.sim_time_sec ?? curSec;
      } catch {}
    }
    const rec = await this.api.postCommand(this.simId, cmd);
    const simTimeSec = this.status?.sim_time_sec ?? this.gt?.sim_time_sec ?? 0;
    this._recordCommandResult(simTimeSec, cmd, rec);
    if (rec?.status === 'accepted') {
      try {
        this.status = await this.api.advance(this.simId, 4);
        this._lastChemAcceptedSec = this.status?.sim_time_sec ?? simTimeSec;
        const [gt, farmRd] = await Promise.all([
          this.api.groundTruth(this.simId),
          this.api.readings(this.simId, 60),
        ]);
        this.gt = gt;
        for (const r of farmRd) {
          if (!(r.kind in this.latest) || this.latest[r.kind].sim_time_sec < r.sim_time_sec) {
            this.latest[r.kind] = r;
          }
          if (
            r.sensor_id &&
            (!(r.sensor_id in this.latestBySensor) || this.latestBySensor[r.sensor_id].sim_time_sec < r.sim_time_sec)
          ) {
            this.latestBySensor[r.sensor_id] = r;
          }
        }
      } catch {}
    }
    this.commands = await this.api.listCommands(this.simId, 500);
    this.emit('update', this);
    return rec;
  }

  pushHistory(t, gt, residuals) {
    const pick = (k) => this.latest[k]?.value ?? null;
    this.history.push({
      t,
      day: t / 86400,
      measured: {
        DO: pick('DO'),
        pH: pick('pH'),
        EC: pick('EC'),
        V_res: pick('V_res'),
        T_air: pick('T_air'),
        T_w: pick('T_w'),
        RH: pick('RH'),
      },
      residuals: Object.fromEntries(Object.entries(residuals || {}).map(([k, v]) => [k, v])),
      fw: gt.shoot_fw_g_per_plant,
      stress: gt.stress_factor,
      doRes: gt.c_do_res_mg_l,
      doCh: gt.c_do_ch_out_mg_l,
      gtEc: gt.ec25_ds_m,
      gtPh: gt.ph,
      gtAirT: gt.t_air_c,
      gtResT: gt.t_res_c,
      gtRh: gt.rh_pct,
    });
    if (this.history.length > MAX_HISTORY) this.history.shift();
  }

  async injectFault(fault) {
    if (!this.simId) return;
    this.status = await this.api.injectFault(this.simId, {
      kind: fault.kind,
      target_component_id: fault.target,
      intensity: fault.intensity,
      trigger_at_sim_sec: 0,
    });
    const simTimeSec = this.status?.sim_time_sec ?? this.gt?.sim_time_sec ?? 0;
    const meta = FAULT_TO_SENSOR[fault.kind] || {};
    this._truthInjectedAt[fault.kind] = { atSec: simTimeSec, label: fault.label || fault.kind };
    this._pushTimeline({
      kind: 'truth',
      tag: 'GROUND TRUTH',
      simTimeSec,
      faultKind: fault.kind,
      sensorKind: meta.sensorKind,
      sensorId: meta.sensorId,
      text: `${fault.label || fault.kind} injected on ${fault.target} — hidden from AI & UI.`,
    });
    this.emit('fault', fault);
    this.emit('update', this);
  }

  async clearFault(kind) {
    if (!this.simId) return;
    this.status = await this.api.injectFault(this.simId, { kind, target_component_id: '', intensity: 0, clear: true });
    const simTimeSec = this.status?.sim_time_sec ?? this.gt?.sim_time_sec ?? 0;
    delete this._truthInjectedAt[kind];
    this._pushTimeline({
      kind: 'truth',
      tag: 'GROUND TRUTH',
      simTimeSec,
      faultKind: kind,
      text: `Perturbation cleared in Ground Truth (${kind}) — waiting for sensors to normalize.`,
    });
    this.emit('update', this);
  }

  async clearAllFaults() {
    for (const f of [...this.activeFaults]) await this.clearFault(f.kind);
    this.emit('update', this);
  }

  setAutopilot(enabled) {
    const next = !!enabled;
    if (this.autopilotEnabled === next) return;
    this.autopilotEnabled = next;
    const simTimeSec = this.gt?.sim_time_sec ?? this.status?.sim_time_sec ?? 0;
    this._pushTimeline({
      kind: 'farmer',
      tag: next ? 'AUTOPILOT ON' : 'MANUAL MODE',
      simTimeSec,
      text: next
        ? 'Operator re-armed AI Autopilot closed-loop dosing.'
        : 'Operator switched to Manual / Maintenance Mode — automated dosing paused; PLC Guardian remains armed.',
    });
    this.emit('update', this);
  }

  setRecipeTargets({ ec, ph } = {}) {
    if (!this.design?.targets) return;
    const simTimeSec = this.gt?.sim_time_sec ?? this.status?.sim_time_sec ?? 0;
    if (ec != null) {
      this.design.targets.ec = Math.round(Math.min(2.8, Math.max(1.0, Number(ec))) * 100) / 100;
    }
    if (ph != null) {
      this.design.targets.ph = Math.round(Math.min(6.5, Math.max(5.4, Number(ph))) * 100) / 100;
    }
    this._pushTimeline({
      kind: 'farmer',
      tag: 'RECIPE SETPOINT',
      simTimeSec,
      text: `Operator updated crop recipe targets: EC ${this.design.targets.ec.toFixed(2)} mS/cm · pH ${this.design.targets.ph.toFixed(2)}.`,
    });
    this.emit('update', this);
  }

  acknowledgeAlert(alertKey, alertObj = null) {
    if (!alertKey) return false;
    const simTimeSec = this.gt?.sim_time_sec ?? this.status?.sim_time_sec ?? 0;
    this.acknowledgedAlerts.set(alertKey, {
      ackAtSec: simTimeSec,
      code: alertObj?.code || alertKey,
      componentId: alertObj?.component_id || 'system',
    });
    this._pushTimeline({
      kind: 'farmer',
      tag: 'OPERATOR ACK',
      simTimeSec,
      text: `Technician acknowledged ${alertObj?.code || alertKey} on ${alertObj?.component_id || 'system'} and initiated SOP checklist.`,
    });
    this.emit('update', this);
    return true;
  }
}

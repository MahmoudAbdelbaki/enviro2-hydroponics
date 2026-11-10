// TwinSession: owns one "farm" simulation (where faults are injected) and one
// fault-free "shadow twin" simulation of the same farm, advanced in lock-step.
//
//   farm  (seed 42) : the stand-in for the physical farm. Faults go here.
//   twin  (seed 7)  : same FarmSpec, same actions, never faulted. Its sensor
//                     readings are what the farm *should* be reading.
//
// Pure ES module (no DOM) so tests/headless_twin.test.mjs can drive it from Node.

import { Autopilot } from './autopilot.js';
import { buildFarmSpec, cloneDesign } from '../domain/presets.js';

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
  constructor(api, { autopilotEnabled = true } = {}) {
    super();
    this.api = api;
    this.autopilotEnabled = autopilotEnabled;
    this.reset();
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
    this.history = [];      // hourly samples for charts
    this.alerts = [];
    this.commands = [];
    this.events = [];       // local feed items (commands + alerts + notes), newest first
    this.residuals = {};
    this.autopilot = null;
    this.playing = false;
    this.speed = SPEEDS[1];
    this.busy = false;
    this.lastDose = null;   // {at, cmd} for 3D dosing animation
  }

  get simDays() { return (this.status?.sim_time_sec || 0) / 86400; }
  get seasonDays() { return this.design?.seasonDays || 30; }
  get activeFaults() { return this.status?.active_faults || []; }
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
    const keepSpeed = this.speed;
    this.reset();
    this.autopilotEnabled = keepAuto;
    this.speed = keepSpeed;
    this.design = cloneDesign(design);
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

  /** Advance the world by 1 full day (288 steps = 24 hours). */
  async advanceDay() {
    const wasPlaying = this.playing;
    this.pause();
    const stepsInDay = Math.round(86400 / STEP_SEC);
    await this.step(stepsInDay);
    if (wasPlaying) this.play();
  }

  /** Advance the world by `steps` ticks, run the autopilot hourly. */
  async step(steps) {
    if (this.busy) return;
    this.busy = true;
    try {
      let remaining = steps;
      // Advance in <= 6 h chunks so the autopilot gets a chance to act several times a day.
      while (remaining > 0) {
        const n = Math.min(remaining, 72);
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
    }
    const simTimeSec = gt.sim_time_sec;

    if (this.autopilotEnabled && this.autopilot && stepsJustRun > 0) {
      const res = this.autopilot.decide({ simTimeSec, measuredReadings: farmRd });
      if (res.decided) {
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
        this.api.listCommands(this.simId),
      ]);
      this.alerts = alerts;
      this.commands = commands;
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
      const rec = await this.api.postCommand(this.simId, cmd);
      const chem = cmd.dose_stock_a_ml || cmd.dose_acid_ml || cmd.dose_base_ml;
      if (rec?.status === 'accepted') {
        this.autopilot.noteChemAccepted(simTimeSec, cmd);
        this.lastDose = { at: performance.now(), cmd };
        this.emit('dose', cmd);
      } else {
        this.emit('rejected', rec);
      }
    }
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
    this.emit('fault', fault);
    this.emit('update', this);
  }

  async clearFault(kind) {
    if (!this.simId) return;
    this.status = await this.api.injectFault(this.simId, { kind, target_component_id: '', intensity: 0, clear: true });
    this.emit('update', this);
  }

  async clearAllFaults() {
    for (const f of [...this.activeFaults]) await this.clearFault(f.kind);
    this.emit('update', this);
  }

  setAutopilot(enabled) {
    this.autopilotEnabled = enabled;
    this.emit('update', this);
  }
}

// Reference autopilot: closed-loop dosing + digital-twin residual anomaly detection.
//
// In an industrial digital twin, the controller only observes the physical sensor readings.
// It maintains an internal digital twin state model (physics equations for Benson-Krause
// saturation, mass conservation, buffer chemistry, and diurnal microclimate).
// If the physical sensor readings deviate from what the physics equations predict,
// an anomaly alert is raised (e.g. pump degradation, tank leak, probe drift, heat wave).

import { IDS, SENSOR_CATALOG } from '../domain/presets.js';

const HOUR = 3600;
const SIGMA = Object.fromEntries(SENSOR_CATALOG.map((s) => [s.kind, s.accuracy]));

export function doSatBensonKrause(twC, ec25dSm = 2.0, zElevM = 7.0) {
  const tk = (twC || 20.0) + 273.15;
  const lnC0 =
    -139.34411 +
    1.575701e5 / tk -
    6.642308e7 / (tk * tk) +
    1.243800e10 / (tk * tk * tk) -
    8.621949e11 / (tk * tk * tk * tk);
  const c0 = Math.exp(lnC0);
  const sal = 0.55 * Math.max(0, ec25dSm || 2.0);
  const fS = Math.exp(-sal * (0.017674 - 10.754 / tk + 2140.7 / (tk * tk)));
  const pAtm = Math.pow(1.0 - 2.25577e-5 * zElevM, 5.25588);
  const uVap = Math.exp(11.8571 - 3840.7 / tk - 216961.0 / (tk * tk));
  const theta0 = 0.000975 - 1.426e-5 * (twC || 20.0) + 6.436e-8 * (twC || 20.0) * (twC || 20.0);
  const fP = (pAtm * ((1.0 - uVap / pAtm) * (1.0 - theta0 * pAtm))) / ((1.0 - uVap) * (1.0 - theta0));
  return c0 * fS * fP;
}

export function expectedOutdoorWeather(startDoy, simTimeSec) {
  const doy = (startDoy || 105) + simTimeSec / 86400.0;
  const hour = (simTimeSec / 3600.0) % 24.0;
  const tSeason =
    4.8 *
    (Math.sin(((2.0 * Math.PI) / 365.0) * (doy - 105.0)) -
      Math.sin(((2.0 * Math.PI) / 365.0) * (95.0 - 105.0)));
  const tOut = 21.0 + tSeason + 5.0 * Math.sin(((2.0 * Math.PI) / 24.0) * (hour - 9.0));
  return tOut;
}

export function windowStats(readings, toSec, windowSec) {
  const acc = {};
  for (const r of readings) {
    if (r.value == null || r.sim_time_sec < toSec - windowSec || r.sim_time_sec > toSec) continue;
    const a = (acc[r.kind] ||= { sum: 0, n: 0 });
    a.sum += r.value;
    a.n += 1;
  }
  const out = {};
  for (const [k, a] of Object.entries(acc)) out[k] = { mean: a.sum / a.n, n: a.n };
  return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? '\u2014' : Number(v).toFixed(d));

const DETECTORS = [
  {
    key: 'DO',
    kind: 'DO',
    dir: -1,
    minAbs: 0.32,
    code: 'IMPLIED_PUMP_OR_AERATION_FAULT',
    severity: 'critical',
    component: IDS.pump,
    title: 'Hidden flow problem: roots are short of oxygen',
    explain: (m, e, r) =>
      `Root-zone oxygen at the gully outlet is ${fmt(m)} mg/L, significantly below expected saturation (${fmt(e)} mg/L). ` +
      'Water velocity in the channels has dropped or aerator is degraded, depriving roots of oxygen.',
  },
  {
    key: 'V_res',
    kind: 'V_res',
    dir: -1,
    minAbs: 0.85, // >0.85 L/hr drop exceeds max possible lettuce transpiration (0.25 L/hr)
    code: 'RESERVOIR_LEAK_SUSPECTED',
    severity: 'critical',
    component: IDS.reservoir,
    title: 'Tank is losing water faster than plants drink',
    explain: (m, e, r) =>
      `Tank level is dropping at ${fmt(Math.abs(r), 1)} L/hr while max normal crop transpiration is ~0.2 L/hr. Abnormal volume loss detected — check tank and pipe fittings for a leak.`,
  },
  {
    key: 'pH',
    kind: 'pH',
    dir: +1,
    minAbs: 0.40, // sensor reads >0.40 units higher than predicted post-dosing chemistry
    code: 'PH_PROBE_DRIFT_SUSPECTED',
    severity: 'warning',
    component: 'sen-ph-1',
    title: 'pH probe disagrees with the chemistry',
    explain: (m, e, r) =>
      `The pH probe reads ${fmt(m)} but twin chemistry predicts ${fmt(e)} (${r > 0 ? '+' : ''}${fmt(r)}). ` +
      'Sensor calibration drift detected. Autopilot switches to twin-estimated pH control.',
  },
  {
    key: 'T_air',
    kind: 'T_air',
    dir: +1,
    minAbs: 3.5,
    code: 'HEAT_STRESS_EVENT',
    severity: 'warning',
    component: IDS.enclosure,
    title: 'Greenhouse running hotter than seasonal weather',
    explain: (m, e, r) =>
      `Air is ${fmt(m, 1)} °C but the twin expects ${fmt(e, 1)} °C (+${fmt(r, 1)} °C). Heatwave or ventilation loss detected. Lowering EC target by 0.2 dS/m.`,
  },
  {
    key: 'EC',
    kind: 'EC',
    dir: +1,
    minAbs: 0.10, // post-dose EC jump exceeds expected jump by >0.10 dS/m
    code: 'NUTRIENT_MIX_ANOMALY',
    severity: 'warning',
    component: IDS.stockA,
    title: 'Plant-food strength not matching the doses given',
    explain: (m, e, r) =>
      `EC jumped by +${fmt(m, 2)} dS/m after dosing Stock A, but expected jump was +${fmt(e, 2)} dS/m (+${fmt(r, 2)} dS/m excess). Stock A concentration error suspected.`,
    suppressedBy: ['RESERVOIR_LEAK_SUSPECTED'],
  },
];

export class Autopilot {
  constructor(design, spec) {
    this.design = design;
    this.spec = spec;
    this.installed = new Set(spec.sensors.map((s) => s.kind));
    this.maxL = spec.reservoir.max_volume_l;
    this.targetL = spec.reservoir.initial_volume_l;
    this.bayScale = Math.max(1, (spec.channels?.length || 2) / 2);
    this.lastDecisionSec = -Infinity;
    this.lastChemSec = -Infinity;
    this.streak = {};
    this.okStreak = {};
    this.active = new Map();
    this.trustTwinPH = false;

    // Rolling state
    this.lastV = spec.reservoir.initial_volume_l;
    this.lastVSec = 0;
    this.lastPH = design.targets.ph || 6.0;
    this.lastPHSec = 0;
    this.twinEC = null;
    this.twinPH = null;
    this.lastExpected = null;
  }

  /** Expected physical/chemical readings at `simTimeSec` (shared by residual detectors & symptom tracker). */
  computeExpected(simTimeSec, { tw = 22.0, ec = null } = {}) {
    const ecVal = ec ?? this.twinEC ?? this.design.targets.ec;
    const doSat = doSatBensonKrause(tw, ecVal, this.design.location?.elev || 7.0);
    const day = simTimeSec / 86400.0;
    const normalChannelDrop = 0.10 + 0.45 * Math.min(1.0, day / 28.0);
    const expectedDO = doSat * 0.985 - normalChannelDrop;
    const expectedTAir = expectedOutdoorWeather(this.design.location?.startDoy, simTimeSec) + 1.2;
    return {
      DO: expectedDO,
      V_res: +(0.15 * this.bayScale).toFixed(2), // max normal transpiration rate L/hr scaled to crop footprint
      pH: this.twinPH,
      EC: this.twinEC,
      T_air: expectedTAir,
      T_w: tw,
    };
  }

  decide({ simTimeSec, measuredReadings, stocks = null, pauseDosing = false }) {
    const out = { commands: [], alerts: [], residuals: {}, decided: false };
    if (simTimeSec - this.lastDecisionSec < HOUR - 1) return out;
    const dt = this.lastDecisionSec > 0 ? Math.max(0, simTimeSec - this.lastDecisionSec) : 3600.0;
    this.lastDecisionSec = simTimeSec;
    out.decided = true;

    const phDepleted = !!(stocks?.ph && stocks.ph.remainingMl < 1);
    const aDepleted = !!(stocks?.a && stocks.a.remainingMl < 1);
    const bDepleted = !!(stocks?.b && stocks.b.remainingMl < 1);

    const win = 2 * HOUR;
    const m = windowStats(measuredReadings, simTimeSec, win);
    const recent = windowStats(measuredReadings, simTimeSec, HOUR / 2);

    // Luenberger digital-twin observer: tracks slow seasonal chemical drift (72-hour time constant).
    // When chemical dosing is stalled by an empty bottle, allow observer to follow physical pH/EC climb
    // so genuine chemical drift isn't misdiagnosed as a faulty probe.
    const tauHours = Math.max(12.0, 72.0 / Math.sqrt(this.bayScale));
    const alphaObs = 1.0 - Math.exp(-dt / (tauHours * 3600.0));
    if (this.twinPH == null && recent.pH?.mean != null) {
      this.twinPH = recent.pH.mean;
    } else if (!this.trustTwinPH && recent.pH?.mean != null) {
      const alphaPH = phDepleted ? Math.max(alphaObs, 0.35) : alphaObs;
      this.twinPH += alphaPH * (recent.pH.mean - this.twinPH);
    } else if (this.trustTwinPH && this.twinPH != null) {
      // Model natural root nitrate OH- release so twinPH continues driving scheduled acid maintenance
      this.twinPH = clamp(this.twinPH + 0.016 * (dt / 3600.0), 5.4, 6.8);
    }
    if (this.twinEC == null && recent.EC?.mean != null) {
      this.twinEC = recent.EC.mean;
    } else if (recent.EC?.mean != null) {
      const alphaEC = (aDepleted || bDepleted) ? Math.max(alphaObs, 0.25) : alphaObs;
      this.twinEC += alphaEC * (recent.EC.mean - this.twinEC);
    }

    // Compute expected physical twin readings
    const tw = recent.T_w?.mean ?? 22.0;
    const ec = recent.EC?.mean ?? this.twinEC;

    // Hourly rate of tank volume loss
    const currentV = recent.V_res?.mean ?? this.targetL;
    let hourlyDropL = 0;
    if (this.lastVSec > 0 && simTimeSec > this.lastVSec) {
      const dtHr = (simTimeSec - this.lastVSec) / 3600.0;
      hourlyDropL = Math.max(0, this.lastV - currentV) / dtHr;
    }
    this.lastV = currentV;
    this.lastVSec = simTimeSec;

    // Rate of pH probe upward drift (pH/hr)
    const currentPH = recent.pH?.mean ?? 6.0;
    let phDriftRateHr = 0;
    if (this.lastPHSec > 0 && simTimeSec > this.lastPHSec) {
      const dtHr = (simTimeSec - this.lastPHSec) / 3600.0;
      phDriftRateHr = (currentPH - this.lastPH) / dtHr;
    }
    this.lastPH = currentPH;
    this.lastPHSec = simTimeSec;

    const t = this.design.targets;
    const ecTarget = t.ec - (this.active.has('HEAT_STRESS_EVENT') ? 0.2 : 0);

    const expected = this.computeExpected(simTimeSec, { tw, ec });
    this.lastExpected = expected;

    // Actual observation for each detector
    const obs = {
      DO: m.DO?.mean,
      V_res: hourlyDropL,
      pH: m.pH?.mean,
      EC: m.EC?.mean,
      T_air: m.T_air?.mean,
      T_w: m.T_w?.mean,
    };

    // ---- 1. Anomaly detection on twin residuals -------------------------------
    // Allow a brief 2-hour window to populate baseline rolling averages before arming detectors
    const armed = simTimeSec >= 2 * HOUR;

    for (const d of DETECTORS) {
      if (!this.installed.has(d.kind) || obs[d.kind] == null || expected[d.kind] == null) continue;
      let r = 0;
      if (d.kind === 'V_res') {
        r = -(obs.V_res - expected.V_res);
      } else {
        r = obs[d.kind] - expected[d.kind];
      }

      const thr = d.minAbs;
      out.residuals[d.kind] = { measured: obs[d.kind], expected: expected[d.kind], residual: r, threshold: thr };

      if (!armed) continue;

      const stockBlocked =
        (d.code === 'PH_PROBE_DRIFT_SUSPECTED' && phDepleted) ||
        (d.code === 'NUTRIENT_MIX_ANOMALY' && (aDepleted || bDepleted));
      const suppressed = stockBlocked || (d.suppressedBy || []).some((c) => this.active.has(c));
      const inAlarm = !suppressed && (d.dir === 0 ? Math.abs(r) > thr : d.dir * r > thr);
      if (inAlarm) {
        this.streak[d.key] = (this.streak[d.key] || 0) + 1;
        this.okStreak[d.key] = 0;
        const reqStreak = 2;
        const strong = Math.abs(r) > 1.8 * thr;
        if (!this.active.has(d.code) && (this.streak[d.key] >= reqStreak || strong)) {
          const info = { code: d.code, title: d.title, component: d.component, since: simTimeSec };
          this.active.set(d.code, info);
          out.alerts.push({
            component_id: d.component,
            severity: d.severity,
            code: d.code,
            message: `${d.title}. ${d.explain(obs[d.kind], expected[d.kind], r)}`,
          });
          if (d.code === 'PH_PROBE_DRIFT_SUSPECTED') this.trustTwinPH = true;
        }
      } else {
        this.streak[d.key] = 0;
        this.okStreak[d.key] = (this.okStreak[d.key] || 0) + 1;
        if (this.active.has(d.code) && this.okStreak[d.key] >= 2) {
          this.active.delete(d.code);
          if (d.code !== 'PH_PROBE_DRIFT_SUSPECTED') {
            out.alerts.push({
              component_id: d.component,
              severity: 'info',
              code: `${d.code}_RESOLVED`,
              message: `Back to normal: ${d.kind} matches the twin again (residual ${fmt(r)}).`,
            });
          }
        }
      }
    }

    // ---- 2. Closed-loop care: water, plant food, pH --------------------------
    if (pauseDosing) {
      return out; // Operator Maintenance / Manual Mode: keep AI anomaly detection active, pause automatic dosing
    }

    const V = recent.V_res?.mean ?? this.targetL;
    const EC = recent.EC?.mean ?? this.twinEC;
    const pHsrc = this.trustTwinPH ? this.twinPH : (recent.pH?.mean ?? this.twinPH);
    const phTarget = clamp(t.ph ?? 5.90, 5.4, 6.5);

    const urgentCare = pHsrc > phTarget + 0.18 || EC < ecTarget - 0.12 || V < 0.94 * this.targetL;
    const minCooldown = (this.bayScale > 1.5 && urgentCare) ? HOUR : 2 * HOUR;
    const chemReady = simTimeSec - this.lastChemSec >= minCooldown;
    if (!chemReady) {
      return out; // Wait for mixing cooldown to ensure all additions are safely coordinated
    }

    let refill = 0;
    const parts = [];
    if (V < 0.98 * this.targetL) {
      refill = Math.min(this.targetL - V, this.maxL * 0.98 - V);
      parts.push(`top up ${fmt(refill, 1)} L`);
    }

    let doseA = 0;
    let doseB = 0;
    let acid = 0;
    let base = 0;

    if (V > 0) {
      const vAfter = V + refill;
      const maxSafeAB = Math.max(25, Math.floor(vAfter * 0.25));

      // 1. EC maintenance: dose Part A & B together (capped to available stock volume & PLC shock limit)
      if (EC < ecTarget - 0.05) {
        const reqAB = Math.round(clamp((ecTarget - EC) * vAfter * 4.0, 4, maxSafeAB));
        const aAvail = stocks?.a ? stocks.a.remainingMl : reqAB;
        const bAvail = stocks?.b ? stocks.b.remainingMl : reqAB;
        doseA = Math.min(reqAB, Math.floor(Math.max(0, aAvail)));
        doseB = Math.min(reqAB, Math.floor(Math.max(0, bAvail)));
        if (doseA > 0 && doseB > 0) parts.push(`plant food +${doseA}/${doseB} mL A&B`);
        else if (doseA > 0) parts.push(`Stock A +${doseA} mL (B empty)`);
        else if (doseB > 0) parts.push(`Stock B +${doseB} mL (A empty)`);
      }

      // 2. pH maintenance: neutralize incoming refill alkalinity + existing tank pH climb without overshooting < 4.5 pH
      const srcAlk = this.design.chemistry?.alk || 0.65;
      const phAvail = stocks?.ph ? stocks.ph.remainingMl : Infinity;
      const refillAcid = refill > 0 ? refill * srcAlk * 1.8 : 0;
      const maxTankAcid = Math.max(20, Math.floor(V * 0.22));
      const tankAcid = pHsrc > phTarget + 0.10 ? clamp((pHsrc - phTarget) * V * 1.5, 3, maxTankAcid) : 0;
      const acidNeeded = refillAcid + tankAcid;
      const maxTotalAcid = Math.min(Math.floor(vAfter * 0.75), Math.round(refillAcid + maxTankAcid));
      if (acidNeeded >= 3 && phAvail > 0) {
        acid = Math.min(Math.round(clamp(acidNeeded, 3, maxTotalAcid)), Math.floor(phAvail));
        if (acid >= 1) parts.push(`pH balance +${acid} mL acid`);
        else acid = 0;
      } else if (pHsrc < phTarget - 0.40 && phAvail > 0) {
        base = Math.min(Math.round(clamp((phTarget - 0.05 - pHsrc) * vAfter * 1.2, 3, 20)), Math.floor(phAvail));
        if (base >= 1) parts.push(`pH balance +${base} mL base`);
        else base = 0;
      }
    }

    if (refill > 0.1 || doseA > 0 || doseB > 0 || acid > 0 || base > 0) {
      const cmd = {
        target_component_id: IDS.reservoir,
        action: 'dose',
        reason: `Autopilot: ${parts.join(' · ')}`,
      };
      if (refill > 0.1) cmd.refill_water_l = Math.round(refill * 100) / 100;
      if (doseA > 0) cmd.dose_stock_a_ml = doseA;
      if (doseB > 0) cmd.dose_stock_b_ml = doseB;
      if (acid > 0) cmd.dose_acid_ml = acid;
      if (base > 0) cmd.dose_base_ml = base;
      out.commands.push(cmd);
    }
    return out;
  }

  noteChemAccepted(simTimeSec, cmd) {
    this.lastChemSec = simTimeSec;
    if (cmd.refill_water_l) {
      this.lastV += cmd.refill_water_l;
    }
    if (cmd.dose_stock_a_ml) {
      this.twinEC += (cmd.dose_stock_a_ml / this.targetL) * 0.12;
    }
    if (cmd.dose_acid_ml) {
      this.twinPH = Math.max(5.6, this.twinPH - (cmd.dose_acid_ml / this.targetL) * 0.45);
    }
  }

  resetAlarms() {
    this.streak = {};
    this.okStreak = {};
    for (const code of [...this.active.keys()]) {
      if (code !== 'PH_PROBE_DRIFT_SUSPECTED') this.active.delete(code);
    }
  }
}

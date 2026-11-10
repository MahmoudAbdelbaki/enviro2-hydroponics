// Headless end-to-end check of the twin session + autopilot against a running ./bin/hydro.
//   node tests/headless_twin.test.mjs            (backend on http://localhost:8080)
//
// 1. Healthy 30-day season per Egyptian preset: autopilot keeps the crop alive,
//    harvest lands near the real AASTMT harvest, and raises NO false alarms.
// 2. Each "Challenge the autopilot" fault injected on day 10: autopilot must raise
//    the right alert code using sensor readings only.

import { createApi } from '../src/api/client.js';
import { TwinSession } from '../src/sim/session.js';
import { PRESETS, getPreset } from '../src/domain/presets.js';
import { FAULTS } from '../src/domain/faults.js';

const api = createApi({ baseUrl: process.env.HYDRO_API_URL || 'http://localhost:8080', mlKey: process.env.HYDRO_ML_API_KEY || 'dev-ml-secret-key' });
const only = process.argv[2];
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`); if (!cond) failures++; };

async function runDays(s, days) {
  const steps = Math.round((days * 86400) / 300);
  for (let done = 0; done < steps; done += 12) await s.step(Math.min(12, steps - done));
}

if (!only || only === 'healthy') {
  for (const p of PRESETS) {
    const s = new TwinSession(api);
    await s.start(p);
    await runDays(s, 30);
    const fw = s.gt.shoot_fw_g_per_plant;
    const own = s.alerts.filter((a) => a.severity !== 'info');
    const accepted = s.commands.filter((c) => c.status === 'accepted').length;
    const rejected = s.commands.filter((c) => c.status !== 'accepted');
    console.log(`\n[${p.presetId}] FW=${fw.toFixed(1)} g (real ${p.realHarvest.mean} \u00B1 ${p.realHarvest.sd}) EC=${s.gt.ec25_ds_m.toFixed(2)} pH=${s.gt.ph.toFixed(2)} V=${s.gt.v_res_l.toFixed(1)} stress=${s.gt.stress_factor.toFixed(2)} cmds=${accepted} rejected=${rejected.length}`);
    rejected.slice(0, 3).forEach((c) => console.log('     rejected:', c.rejection_code, c.rejection_message));
    ok(fw > p.realHarvest.mean - 2 * p.realHarvest.sd, `${p.presetId}: harvest within reach of the real farm (>${(p.realHarvest.mean - 2 * p.realHarvest.sd).toFixed(0)} g)`);
    ok(own.length === 0, `${p.presetId}: no false alarms in a healthy season (${own.map((a) => a.code).join(', ') || 'none'})`);
  }
}

const expectCode = {
  pump_degradation: 'IMPLIED_PUMP_OR_AERATION_FAULT',
  aeration_loss: 'IMPLIED_PUMP_OR_AERATION_FAULT',
  probe_drift: 'PH_PROBE_DRIFT_SUSPECTED',
  heat_wave: 'HEAT_STRESS_EVENT',
  reservoir_leak: 'RESERVOIR_LEAK_SUSPECTED',
  nutrient_imbalance: 'NUTRIENT_MIX_ANOMALY',
};

if (!only || only === 'faults') {
  for (const f of FAULTS) {
    const s = new TwinSession(api);
    await s.start(getPreset('exp2'));
    await runDays(s, 10);
    const before = s.alerts.length;
    await s.injectFault(f);
    if (f.kind === 'nutrient_imbalance') {
      const cmd = {
        target_component_id: 'res-1',
        action: 'dose',
        dose_stock_a_ml: 50,
        dose_stock_b_ml: 50,
        reason: 'Test dosing with imbalanced stock A',
      };
      await api.postCommand(s.simId, cmd);
    }
    const t0 = s.gt.sim_time_sec;
    let hit = null;
    for (let h = 0; h < 48 && !hit; h++) {
      await s.step(12);
      hit = s.alerts.slice(before).find((a) => a.code === expectCode[f.kind]);
    }
    const hrs = hit ? (hit.sim_time_sec - t0) / 3600 : null;
    const r = s.residuals[{ pump_degradation: 'DO', aeration_loss: 'DO', probe_drift: 'pH', heat_wave: 'T_air', reservoir_leak: 'V_res', nutrient_imbalance: 'EC' }[f.kind]];
    console.log(`\n[fault ${f.kind}] detected=${!!hit} after ${hrs?.toFixed(1)} h  residual=${r?.residual?.toFixed(3)} thr=${r?.threshold?.toFixed(3)}  other alerts: ${s.alerts.map((a) => a.code).join(', ')}`);
    ok(!!hit && hrs <= 48, `${f.kind} -> ${expectCode[f.kind]} within 48 sim-hours`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

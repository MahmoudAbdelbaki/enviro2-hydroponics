import { createApi } from '../src/api/client.js';
import { PRESETS, getPreset } from '../src/domain/presets.js';

const api = createApi({ baseUrl: process.env.HYDRO_API_URL || 'http://127.0.0.1:8080', mlKey: process.env.HYDRO_ML_API_KEY || 'sensor-x-dev-ml-key' });

async function testSingleSim() {
  const preset = getPreset('exp2');
  const farm = await api.createFarm(preset);
  console.log('Created farm:', farm.id);
  const sim = await api.createSimulation({ farm_id: farm.id, seed: 42, step_seconds: 300, mode: 'paused' });
  console.log('Created sim:', sim.id);

  // Advance 288 steps (1 day)
  const adv = await api.advance(sim.id, 288);
  console.log('Advanced sim to days:', adv.sim_days);

  const gt = await api.groundTruth(sim.id);
  console.log('Ground truth:', gt.sim_time_sec, 'EC:', gt.ec25_ds_m, 'pH:', gt.ph, 'DOch:', gt.c_do_ch_out_mg_l, 'Vres:', gt.v_res_l);

  const rd = await api.readings(sim.id, 20);
  console.log('Got readings count:', rd.length, 'sample:', rd[0]);
}

testSingleSim().catch(console.error);

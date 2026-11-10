import { createApi } from './api/client.js';
import { TwinSession } from './sim/session.js';
import { getPreset, cloneDesign, plantCount } from './domain/presets.js';
import { FAULTS, FAULT_BY_KIND } from './domain/faults.js';

// --- API & Twin Session ---
const api = createApi({ baseUrl: '' });
const session = new TwinSession(api);
window.session = session;
window.api = api;

// --- Application State ---
let currentPreset = getPreset('exp2');
let activeView = 'farm-status';
let selectedFault = FAULTS[0];
let activeAlertTab = 'open';
let selectedVitalityMetric = 'DO';
let selectedDosingTimeframe = '24h';
const dosingTimeouts = {};

// Cumulative AI doses since the current simulation started (drives stock levels).
// Stock capacities are display assumptions; the backend does not model stock depletion.
const STOCK_CAPACITY_ML = { a: 800, b: 800, ph: 350 };
let cumulativeDoses = { a: 0, b: 0, acid: 0, base: 0, water: 0 };
let lastDose = { a: 0, b: 0, acid: 0, base: 0, water: 0 };

const VIEW_TITLES = {
  'farm-status': 'Farm Status',
  'gully-matrix': 'Gully Matrix & Layout',
  'isometric-rack': 'Rack Overview',
  'channel-deepdive': 'Channel B1 Overview',
  'judge-proof': 'Judge / Proof View',
};

const COMPONENT_NAMES = {
  'res-1': 'Main Reservoir',
  'reservoir-1': 'Main Reservoir',
  'pump-1': 'Circulation Pump',
  'aer-1': 'Air Bubbler',
  'enc-1': 'Greenhouse',
  'stock-a': 'Stock A',
  'stock-b': 'Stock B',
  'stock-acid': 'Acid Buffer',
  'stock-base': 'Base Buffer',
  'fans-1': 'Canopy Fans',
  'sen-ph-1': 'pH Probe',
  'sen-ec-1': 'EC Probe',
  'sen-do-1': 'Outlet DO Probe',
};

const ALERT_TITLES = {
  IMPLIED_PUMP_OR_AERATION_FAULT: 'Implied pump flow degradation',
  PH_PROBE_DRIFT_SUSPECTED: 'pH probe drift detected',
  RESERVOIR_LEAK_SUSPECTED: 'Reservoir leak inferred',
  HEAT_STRESS_EVENT: 'Heat stress event',
  NUTRIENT_MIX_ANOMALY: 'Nutrient mix anomaly',
};

// --- Formatting helpers ---
const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
const fmtSimTime = (sec = 0) => `D${pad2(sec / 86400)} ${pad2((sec % 86400) / 3600)}:${pad2((sec % 3600) / 60)}`;
const fmtNum = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
const nameOf = (id) => COMPONENT_NAMES[id] || id || 'System';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function stageOf(days) {
  if (days >= 25) return { n: 4, name: 'Canopy / Harvest' };
  if (days >= 14) return { n: 3, name: 'Vegetative Growth' };
  if (days >= 6) return { n: 2, name: 'Seedling' };
  return { n: 1, name: 'Germination' };
}

// --- DOM cache ---
const $ = (id) => document.getElementById(id);
const el = {
  railBtns: document.querySelectorAll('.rail-btn'),
  views: document.querySelectorAll('.view'),
  viewTitle: $('header-view-title'),
  simMeta: $('sim-meta'),
  railLinkDot: $('rail-link-dot'),

  seasonPicker: $('season-picker'),
  simClock: $('sim-clock-time'),
  btnPlay: $('btn-play-pause'),
  icoPlay: $('ico-play'),
  icoPause: $('ico-pause'),
  btnPlayLabel: $('btn-play-label'),
  speedBtns: document.querySelectorAll('.seg [data-speed]'),
  btnStepDay: $('btn-step-day'),
  btnOpenChallenge: $('btn-open-challenge'),
  badgeAutopilot: $('badge-autopilot'),
  badgePlc: $('badge-plc'),

  kpiEc: $('kpi-ec'),
  kpiPh: $('kpi-ph'),
  kpiDoTank: $('kpi-do-tank'),
  kpiDoOutlet: $('kpi-do-outlet'),
  kpiFlow: $('kpi-flow'),
  kpiVpd: $('kpi-vpd'),

  bioStage: $('bio-stage'),
  bioGullies: $('bio-gullies'),
  bioPorts: $('bio-ports'),
  bioPlants: $('bio-plants'),
  bioFw: $('bio-fw'),
  bioTarget: $('bio-target'),
  bioSegbar: $('bio-segbar'),
  bioPct: $('bio-pct'),
  bioDay: $('bio-day'),
  bioOk: $('bio-ok'),
  bioStress: $('bio-stress'),
  bioPortGrid: $('bio-port-grid'),

  lvl: {
    a: { row: $('lvl-a'), state: $('lvl-a-state'), pct: $('lvl-a-pct'), fill: $('lvl-a-fill') },
    b: { row: $('lvl-b'), state: $('lvl-b-state'), pct: $('lvl-b-pct'), fill: $('lvl-b-fill') },
    ph: { row: $('lvl-ph'), state: $('lvl-ph-state'), pct: $('lvl-ph-pct'), fill: $('lvl-ph-fill') },
    water: { row: $('lvl-water'), state: $('lvl-water-state'), pct: $('lvl-water-pct'), fill: $('lvl-water-fill') },
  },

  cntCrit: $('cnt-crit'),
  cntWarn: $('cnt-warn'),
  cntInfo: $('cnt-info'),
  alertTabs: document.querySelectorAll('#alert-filter-tabs .tab'),
  alertsFeed: $('alerts-feed-container'),

  vitalSelect: $('vitality-metric-select'),
  vitalSvg: $('svg-vitalities-chart'),
  vitalLabel1: $('label-vitality-line1'),
  vitalVal1: $('val-vitality-line1'),
  vitalLabel2: $('label-vitality-line2'),
  vitalVal2: $('val-vitality-line2'),
  vitalDelta: $('val-vitality-delta'),

  dosingSelect: $('dosing-timeframe-select'),
  barSvg: $('svg-dosing-bar-chart'),
  activityTotal: $('activity-total'),

  ledgerStats: $('ledger-stats-subtext'),
  ledgerBody: $('ledger-table-body'),

  matrix: $('matrix-grid-container'),
  isoSvg: $('svg-isometric-rack'),
  timelineStages: document.querySelectorAll('.tl-stage'),
  proofBody: $('proof-table-body'),

  modalChallenge: $('modal-challenge-backdrop'),
  modalChallengeClose: $('modal-challenge-close'),
  modalChallengeCancel: $('modal-challenge-cancel'),
  btnInject: $('btn-inject-selected-fault'),
  activeFaultsList: $('modal-active-faults-list'),
  btnClearAllFaults: $('btn-clear-all-faults'),
  faultOpts: document.querySelectorAll('.fault-opt'),

  btnOpenLayout: $('btn-open-layout-modal'),
  modalLayout: $('modal-layout-backdrop'),
  modalLayoutClose: $('modal-layout-close'),
  modalLayoutCancel: $('modal-layout-cancel'),
  btnApplyLayout: $('btn-apply-custom-farm'),
  sliderChannels: $('slider-channel-count'),
  sliderPlants: $('slider-plants-per-channel'),
  sliderVolume: $('slider-tank-volume'),
  sliderFlow: $('slider-pump-flow'),
  valChannels: $('val-channel-count'),
  valPlants: $('val-plants-per-channel'),
  valVolume: $('val-tank-volume'),
  valFlow: $('val-pump-flow'),
};

// --- Init ---
async function init() {
  bindNavigation();
  bindControls();
  bindModals();
  bindSession();
  session.setSpeed('1x');
  window.addEventListener('resize', () => {
    renderVitalities();
    renderActivity();
  });
  await loadPreset(currentPreset);
}

// --- Navigation ---
function bindNavigation() {
  el.railBtns.forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $('brand-logo')?.addEventListener('click', () => switchView('farm-status'));
}

function switchView(key) {
  if (!VIEW_TITLES[key]) return;
  activeView = key;
  el.railBtns.forEach((b) => b.classList.toggle('active', b.dataset.view === key));
  el.views.forEach((v) => v.classList.toggle('active', v.id === `view-${key}`));
  el.viewTitle.textContent = VIEW_TITLES[key];
  updateAllUI();
}

// --- Controls ---
function bindControls() {
  el.seasonPicker.addEventListener('change', async (e) => {
    if (e.target.value === 'custom') return openLayoutModal();
    currentPreset = getPreset(e.target.value);
    await loadPreset(currentPreset);
  });

  el.btnPlay.addEventListener('click', () => {
    session.playing ? session.pause() : session.play();
    updatePlayUI();
  });

  el.speedBtns.forEach((btn) =>
    btn.addEventListener('click', () => {
      session.setSpeed(btn.dataset.speed);
      el.speedBtns.forEach((b) => b.classList.toggle('active', b === btn));
    })
  );

  el.btnStepDay.addEventListener('click', async () => {
    el.btnStepDay.disabled = true;
    try {
      await session.advanceDay();
    } finally {
      el.btnStepDay.disabled = false;
    }
  });

  el.simMeta.addEventListener('click', () => {
    if (!session.simId) return;
    navigator.clipboard?.writeText(session.simId);
    const prev = el.simMeta.textContent;
    el.simMeta.textContent = `COPIED ${session.simId}`;
    setTimeout(() => (el.simMeta.textContent = prev), 1200);
  });

  el.alertTabs.forEach((tab) =>
    tab.addEventListener('click', () => {
      el.alertTabs.forEach((t) => t.classList.toggle('active', t === tab));
      activeAlertTab = tab.dataset.tab;
      renderAlerts();
    })
  );

  el.dosingSelect.addEventListener('change', (e) => {
    selectedDosingTimeframe = e.target.value;
    renderActivity();
  });

  el.vitalSelect.addEventListener('change', (e) => {
    selectedVitalityMetric = e.target.value;
    renderVitalities();
  });
}

function updatePlayUI() {
  const on = session.playing;
  el.icoPlay.classList.toggle('hidden', on);
  el.icoPause.classList.toggle('hidden', !on);
  el.btnPlayLabel.textContent = on ? 'PAUSE' : 'RUN';
  el.btnPlay.classList.toggle('is-running', on);
}

// --- Preset loading ---
function resetDoseTracking() {
  cumulativeDoses = { a: 0, b: 0, acid: 0, base: 0, water: 0 };
  lastDose = { a: 0, b: 0, acid: 0, base: 0, water: 0 };
}

async function loadPreset(preset) {
  try {
    session.pause();
    updatePlayUI();
    resetDoseTracking();
    await session.start(preset);
    el.railLinkDot.className = 'dot ok';
    updateAllUI();
  } catch (err) {
    console.error('Failed to start farm simulation:', err);
    el.railLinkDot.className = 'dot crit';
    el.simMeta.textContent = 'BACKEND UNREACHABLE · http://localhost:8080';
  }
}

// --- Session events ---
function bindSession() {
  session.on('update', () => updateAllUI());
  session.on('started', () => updateAllUI());
  session.on('dose', (cmd) => onDose(cmd));
  session.on('rejected', (rec) => console.warn('PLC Guardian blocked command:', rec));
  session.on('fault', () => updateAllUI());
  session.on('error', (err) => {
    console.error(err);
    el.railLinkDot.className = 'dot crit';
    updatePlayUI();
  });
  session.on('harvest', () => {
    updatePlayUI();
    alert(`Season complete. Harvest reached on day ${Math.round(session.simDays)}.`);
  });
}

function onDose(cmd) {
  const hits = [];
  if (cmd.dose_stock_a_ml) { cumulativeDoses.a += cmd.dose_stock_a_ml; lastDose.a = cmd.dose_stock_a_ml; hits.push(['a', `+${fmtNum(cmd.dose_stock_a_ml, 1)} mL`]); }
  if (cmd.dose_stock_b_ml) { cumulativeDoses.b += cmd.dose_stock_b_ml; lastDose.b = cmd.dose_stock_b_ml; hits.push(['b', `+${fmtNum(cmd.dose_stock_b_ml, 1)} mL`]); }
  if (cmd.dose_acid_ml) { cumulativeDoses.acid += cmd.dose_acid_ml; lastDose.acid = cmd.dose_acid_ml; hits.push(['ph', `HNO₃ +${fmtNum(cmd.dose_acid_ml, 1)} mL`]); }
  if (cmd.dose_base_ml) { cumulativeDoses.base += cmd.dose_base_ml; lastDose.base = cmd.dose_base_ml; hits.push(['ph', `KOH +${fmtNum(cmd.dose_base_ml, 1)} mL`]); }
  if (cmd.refill_water_l) { cumulativeDoses.water += cmd.refill_water_l; lastDose.water = cmd.refill_water_l; hits.push(['water', `REFILL +${fmtNum(cmd.refill_water_l, 1)} L`]); }

  renderLevels();
  for (const [key, text] of hits) flashLevel(key, text);
  renderActivity();
}

function flashLevel(key, text) {
  const l = el.lvl[key];
  if (!l) return;
  l.row.classList.add('dosing');
  l.state.textContent = `DOSING ${text}`;
  clearTimeout(dosingTimeouts[key]);
  dosingTimeouts[key] = setTimeout(() => {
    l.row.classList.remove('dosing');
    renderLevels();
  }, 3500);
}

// --- Derived telemetry ---
function telemetry() {
  const rd = session.readings;
  const gt = session.gt || {};
  const tAir = rd.T_air ?? gt.t_air_c ?? 23.4;
  const rh = rd.RH ?? gt.rh_pct ?? 64;
  const es = 0.61078 * Math.exp((17.27 * tAir) / (tAir + 237.3));
  return {
    ec: rd.EC ?? gt.ec25_ds_m,
    ph: rd.pH ?? gt.ph,
    doTank: gt.c_do_res_mg_l,
    doOutlet: rd.DO ?? gt.c_do_ch_out_mg_l,
    flow: session.spec?.pump?.rated_flow_l_min,
    vpd: Math.max(0, es - es * (rh / 100)),
  };
}

// --- Master render ---
function updateAllUI() {
  renderHeader();
  renderKpis();
  if (activeView === 'farm-status') {
    renderBiomass();
    renderLevels();
    renderAlerts();
    renderVitalities();
    renderActivity();
    renderLedger();
  } else if (activeView === 'gully-matrix') renderGullyMatrix();
  else if (activeView === 'isometric-rack') renderIsometricRack();
  else if (activeView === 'channel-deepdive') renderTimeline();
  else if (activeView === 'judge-proof') renderProofTable();
}

function renderHeader() {
  const simSec = session.status?.sim_time_sec || 0;
  const days = session.simDays;
  const season = session.seasonDays;
  const stage = stageOf(days);

  el.simClock.textContent = `D${pad2(days)}/${season} · ${pad2((simSec % 86400) / 3600)}:${pad2((simSec % 3600) / 60)}`;

  if (session.simId) {
    const sid = session.simId.replace(/-/g, '').slice(0, 8).toUpperCase();
    el.simMeta.textContent = `SIM-${sid} · STAGE ${stage.n} ${stage.name} · HARVEST TARGET: DAY ${season}`;
  }

  // Autopilot badge
  const auto = session.autopilotEnabled;
  el.badgeAutopilot.innerHTML = `<span class="dot ${auto ? 'ok' : 'idle'}"></span>AUTOPILOT · ${auto ? 'ACTIVE' : 'OFF'}`;

  // PLC Guardian badge
  const cmds = session.commands || [];
  const blocked = cmds.filter((c) => c.status !== 'accepted').length;
  const pct = cmds.length ? Math.round(((cmds.length - blocked) / cmds.length) * 100) : 100;
  el.badgePlc.className = `badge mono${blocked ? ' is-warn' : ''}`;
  el.badgePlc.innerHTML = blocked
    ? `<span class="dot warn"></span>PLC GUARDIAN · ${blocked} BLOCKED`
    : `<span class="dot ok"></span>PLC GUARDIAN · ${pct}% VERIFIED`;

  // Fault button reflects active perturbations
  const nFaults = session.activeFaults.length;
  el.btnOpenChallenge.lastChild.textContent = nFaults ? ` Faults · ${nFaults} active` : ' Inject Fault';
}

function setKpi(node, value, digits, { warn, crit } = {}) {
  node.textContent = fmtNum(value, digits);
  const cell = node.closest('.kpi');
  cell.classList.toggle('is-crit', !!crit);
  cell.classList.toggle('is-warn', !crit && !!warn);
}

function renderKpis() {
  const t = telemetry();
  setKpi(el.kpiEc, t.ec, 2, { warn: t.ec != null && (t.ec < 1.2 || t.ec > 2.8) });
  setKpi(el.kpiPh, t.ph, 2, { warn: t.ph != null && (t.ph < 5.5 || t.ph > 6.8) });
  setKpi(el.kpiDoTank, t.doTank, 1, { warn: t.doTank != null && t.doTank < 6 });
  setKpi(el.kpiDoOutlet, t.doOutlet, 1, { warn: t.doOutlet != null && t.doOutlet < 5, crit: t.doOutlet != null && t.doOutlet < 4 });
  setKpi(el.kpiFlow, t.flow, 1);
  setKpi(el.kpiVpd, t.vpd, 2, { warn: t.vpd > 1.4 || t.vpd < 0.4 });
}

// --- Biomass & Ports ---
function renderBiomass() {
  const gullies = session.spec?.channels?.length ?? currentPreset.channels.count;
  const plants = plantCount(session.design || currentPreset);
  const fw = session.gt?.shoot_fw_g_per_plant ?? 0;
  const target = (session.design || currentPreset).realHarvest?.mean ?? 250;
  const days = session.simDays;
  const season = session.seasonDays;
  const stage = stageOf(days);

  el.bioStage.textContent = `STAGE ${stage.n} · ${stage.name.toUpperCase()}`;
  el.bioGullies.textContent = gullies;
  el.bioPorts.textContent = `${plants}/${plants}`;
  el.bioPlants.textContent = plants;
  el.bioFw.textContent = fmtNum(fw, 1);
  el.bioTarget.textContent = fmtNum(target, 1);

  const ratio = clamp(fw / target, 0, 1);
  const segs = 25;
  const on = Math.round(ratio * segs);
  el.bioSegbar.innerHTML = Array.from({ length: segs }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('');
  el.bioPct.textContent = `${fmtNum(ratio * 100, 1)}% OF HARVEST WEIGHT`;
  el.bioDay.textContent = `D${pad2(days)} / ${season}`;

  const stress = session.gt?.stress_factor ?? 1;
  const stressed = stress < 0.85 ? clamp(Math.round(plants * (1 - stress)), 1, plants) : 0;
  el.bioOk.textContent = plants - stressed;
  el.bioStress.textContent = stressed;

  const shown = Math.min(plants, 96);
  // Spread stressed ports toward the gully outlets (end of each channel), where DO is lowest.
  const perCh = Math.max(1, Math.round(plants / gullies));
  const order = Array.from({ length: shown }, (_, i) => i).sort((x, y) => (y % perCh) - (x % perCh));
  const stressedSet = new Set(order.slice(0, stressed));
  el.bioPortGrid.innerHTML = Array.from({ length: shown }, (_, i) =>
    `<i class="port ${stressedSet.has(i) ? 'stress' : 'ok'}" title="${channelSlot(Math.floor(i / perCh))} · port ${(i % perCh) + 1}"></i>`
  ).join('');
}

function channelSlot(idx) {
  return ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3'][idx] || `CH${idx + 1}`;
}

// --- Chemical & Tank Levels ---
function setLevel(key, pct, state) {
  const l = el.lvl[key];
  l.fill.style.width = `${pct}%`;
  l.fill.classList.toggle('low', pct < 25);
  l.pct.textContent = `${pct}%`;
  if (!l.row.classList.contains('dosing')) l.state.textContent = state;
}

function renderLevels() {
  const pctOf = (used, cap) => clamp(Math.round(100 - (used / cap) * 100), 0, 100);

  setLevel('a', pctOf(cumulativeDoses.a, STOCK_CAPACITY_ML.a), lastDose.a ? `LAST +${fmtNum(lastDose.a, 1)} mL` : 'STANDBY');
  setLevel('b', pctOf(cumulativeDoses.b, STOCK_CAPACITY_ML.b), lastDose.b ? `LAST +${fmtNum(lastDose.b, 1)} mL` : 'STANDBY');
  setLevel(
    'ph',
    pctOf(cumulativeDoses.acid + cumulativeDoses.base, STOCK_CAPACITY_ML.ph),
    lastDose.acid || lastDose.base ? `Σ ${fmtNum(cumulativeDoses.acid + cumulativeDoses.base, 1)} mL` : 'STANDBY'
  );

  const vRes = session.gt?.v_res_l;
  const maxL = session.spec?.reservoir?.max_volume_l ?? 120;
  const pctW = vRes == null ? 0 : clamp(Math.round((vRes / maxL) * 100), 0, 100);
  setLevel('water', pctW, vRes == null ? '— L' : `${fmtNum(vRes, 1)} / ${maxL} L`);
}

// --- Alerts & Detections ---
function filterAlerts(alerts) {
  const has = (a, ...keys) => keys.some((k) => a.component_id?.includes(k) || a.code?.includes(k));
  switch (activeAlertTab) {
    case 'farm': return alerts.filter((a) => has(a, 'pump', 'aer', 'res', 'PUMP', 'AERATION', 'LEAK'));
    case 'sensors': return alerts.filter((a) => has(a, 'sen-', 'probe', 'DRIFT', 'CALIBRATION'));
    case 'plants': return alerts.filter((a) => has(a, 'ch-', 'stock', 'STRESS', 'HEAT', 'NUTRIENT'));
    default: return alerts;
  }
}

function setPill(node, n) {
  node.textContent = n;
  node.parentElement.classList.toggle('has', n > 0);
}

function renderAlerts() {
  const alerts = session.alerts || [];
  setPill(el.cntCrit, alerts.filter((a) => a.severity === 'critical').length);
  setPill(el.cntWarn, alerts.filter((a) => a.severity === 'warning').length);
  setPill(el.cntInfo, alerts.filter((a) => a.severity !== 'critical' && a.severity !== 'warning').length);

  const list = filterAlerts(alerts);
  const now = session.status?.sim_time_sec || 0;
  const sevDot = (s) => (s === 'critical' ? 'crit' : s === 'warning' ? 'warn' : 'idle');

  if (list.length === 0) {
    const faults = session.activeFaults.length;
    el.alertsFeed.innerHTML = `
      <div class="feed-item expanded">
        <span class="dot ok"></span>
        <span class="feed-title">No ${activeAlertTab === 'open' ? 'open' : activeAlertTab} detections</span>
        <span class="feed-time mono">${fmtSimTime(now)}</span>
        <span class="feed-desc">Residual observer comparing probe readings against twin physics. All residuals inside detection thresholds.</span>
      </div>
      <div class="feed-item"><span class="dot ok"></span><span class="feed-title">PLC safety interlock armed</span><span class="feed-time mono">NOMINAL</span></div>
      <div class="feed-item"><span class="dot ${faults ? 'warn' : 'idle'}"></span><span class="feed-title">Injected perturbations</span><span class="feed-time mono">${faults} ACTIVE</span></div>`;
    return;
  }

  const [top, ...rest] = [...list].reverse();
  const restHtml = rest
    .slice(0, 5)
    .map(
      (a) => `
      <div class="feed-item" title="${a.message || ''}">
        <span class="dot ${sevDot(a.severity)}"></span>
        <span class="feed-title">${ALERT_TITLES[a.code] || a.code} · ${nameOf(a.component_id)}</span>
        <span class="feed-time mono">${fmtSimTime(a.sim_time_sec)}</span>
      </div>`
    )
    .join('');

  el.alertsFeed.innerHTML = `
    <div class="feed-item expanded">
      <span class="dot ${sevDot(top.severity)}"></span>
      <span class="feed-title">${ALERT_TITLES[top.code] || top.code || 'Anomaly detected'}</span>
      <span class="feed-time mono">${fmtSimTime(top.sim_time_sec)}</span>
      <span class="feed-desc">${top.message || 'Divergence between probe reading and twin prediction.'}</span>
      <span class="feed-code mono">${top.code} · ${top.component_id || 'system'} · ${(top.severity || 'info').toUpperCase()}</span>
    </div>${restHtml}`;
}

// --- Chart helpers ---
function sizeSvg(svg) {
  const w = Math.max(200, Math.round(svg.clientWidth || 540));
  const h = Math.max(60, Math.round(svg.clientHeight || 150));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  return { w, h };
}

function smoothPath(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const mx = (p.x + c.x) / 2;
    d += ` C${mx.toFixed(1)},${p.y.toFixed(1)} ${mx.toFixed(1)},${c.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)}`;
  }
  return d;
}

const VITAL_METRICS = {
  DO: { min: 2, max: 10, unit: 'mg/L', l1: 'OUTLET PROBE', l2: 'TRUE OUTLET DO', v1: (h) => h.measured.DO, v2: (h) => h.doCh },
  EC: { min: 0.5, max: 3.5, unit: 'mS/cm', l1: 'EC PROBE', l2: 'TRUE EC25', v1: (h) => h.measured.EC, v2: (h) => h.gtEc },
  pH: { min: 4.5, max: 8.5, unit: 'pH', l1: 'pH PROBE', l2: 'TRUE pH', v1: (h) => h.measured.pH, v2: (h) => h.gtPh },
  CLIMATE: { min: 15, max: 35, unit: '°C', l1: 'AIR TEMP', l2: 'WATER TEMP', v1: (h) => h.measured.T_air, v2: (h) => h.measured.T_w ?? h.gtResT },
};

// --- Vitalities ---
function renderVitalities() {
  const svg = el.vitalSvg;
  if (!svg || activeView !== 'farm-status') return;
  const { w, h } = sizeSvg(svg);
  const m = VITAL_METRICS[selectedVitalityMetric];
  const hist = (session.history || []).filter((p) => m.v1(p) != null || m.v2(p) != null);

  const padL = 34, padR = 8, padT = 6, padB = 18;
  const cw = w - padL - padR;
  const ch = h - padT - padB;
  const y = (v) => padT + ch - ((clamp(v, m.min, m.max) - m.min) / (m.max - m.min)) * ch;

  // Gridlines + y labels
  const ticks = [m.min, (m.min + m.max) / 2, m.max];
  let out = ticks
    .map((t) => `<line x1="${padL}" x2="${w - padR}" y1="${y(t)}" y2="${y(t)}" stroke="#F1F5F9"/><text x="${padL - 6}" y="${y(t) + 3}" text-anchor="end">${fmtNum(t, t % 1 ? 1 : 0)}</text>`)
    .join('');

  el.vitalLabel1.textContent = m.l1;
  el.vitalLabel2.textContent = m.l2;

  if (hist.length < 2) {
    out += `<text x="${padL + cw / 2}" y="${padT + ch / 2}" text-anchor="middle">AWAITING TELEMETRY · RUN SIMULATION</text>`;
    svg.innerHTML = out;
    el.vitalVal1.textContent = '—';
    el.vitalVal2.textContent = '—';
    el.vitalDelta.textContent = '—';
    return;
  }

  const t0 = hist[0].t;
  const t1 = hist[hist.length - 1].t;
  const x = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * cw;

  const series = (fn) => hist.filter((p) => fn(p) != null).map((p) => ({ x: x(p.t), y: y(fn(p)) }));
  const s1 = series(m.v1);
  const s2 = series(m.v2);
  const base = padT + ch;
  const area = (pts) => (pts.length ? `${smoothPath(pts)} L${pts[pts.length - 1].x},${base} L${pts[0].x},${base} Z` : '');

  // X labels (start / mid / end, in sim days)
  out += [t0, (t0 + t1) / 2, t1]
    .map((t, i) => `<text x="${x(t)}" y="${h - 4}" text-anchor="${['start', 'middle', 'end'][i]}">${fmtSimTime(t)}</text>`)
    .join('');

  out += `
    <defs>
      <linearGradient id="vg-teal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0D9488" stop-opacity="0.14"/><stop offset="1" stop-color="#0D9488" stop-opacity="0"/></linearGradient>
    </defs>
    <path d="${area(s1)}" fill="url(#vg-teal)"/>
    <path d="${smoothPath(s2)}" fill="none" stroke="#64748B" stroke-width="1.25" stroke-dasharray="3 3"/>
    <path d="${smoothPath(s1)}" fill="none" stroke="#0D9488" stroke-width="1.5"/>`;
  svg.innerHTML = out;

  const last = hist[hist.length - 1];
  const v1 = m.v1(last);
  const v2 = m.v2(last);
  el.vitalVal1.textContent = v1 == null ? '—' : `${fmtNum(v1)} ${m.unit}`;
  el.vitalVal2.textContent = v2 == null ? '—' : `${fmtNum(v2)} ${m.unit}`;
  el.vitalDelta.textContent = v1 != null && v2 != null ? `${v1 - v2 >= 0 ? '+' : ''}${fmtNum(v1 - v2, 3)}` : '—';
}

// --- Activity bar chart ---
function renderActivity() {
  const svg = el.barSvg;
  if (!svg || activeView !== 'farm-status') return;
  const { w, h } = sizeSvg(svg);
  const cmds = (session.commands || []).filter((c) => c.status === 'accepted');
  const now = session.status?.sim_time_sec || 0;
  const is24 = selectedDosingTimeframe === '24h';
  const n = is24 ? 24 : session.seasonDays;
  const bins = Array.from({ length: n }, () => ({ ml: 0, l: 0 }));

  // 24 h view: rolling window ending now, one bin per hour.
  const winStart = Math.max(0, now - 86400);
  for (const c of cmds) {
    const t = c.sim_time_sec || 0;
    let i;
    if (is24) {
      if (t < winStart || t > now) continue;
      i = Math.min(n - 1, Math.floor((t - winStart) / 3600));
    } else {
      i = Math.min(n - 1, Math.floor(t / 86400));
    }
    bins[i].ml += (c.dose_stock_a_ml || 0) + (c.dose_stock_b_ml || 0) + (c.dose_acid_ml || 0) + (c.dose_base_ml || 0);
    bins[i].l += c.refill_water_l || 0;
  }

  const totalMl = bins.reduce((s, b) => s + b.ml, 0);
  const totalL = bins.reduce((s, b) => s + b.l, 0);
  el.activityTotal.textContent = `Σ ${fmtNum(totalMl, 1)} mL · ${fmtNum(totalL, 1)} L`;

  const padL = 34, padR = 8, padT = 4, padB = 16;
  const cw = w - padL - padR;
  const ch = h - padT - padB;
  const base = padT + ch;
  const maxMl = Math.max(5, ...bins.map((b) => b.ml));
  const maxL = Math.max(1, ...bins.map((b) => b.l));
  const slot = cw / n;
  const bw = Math.max(2, slot * 0.62);

  let out = `<line x1="${padL}" x2="${w - padR}" y1="${base}" y2="${base}" stroke="#E2E8F0"/>
    <line x1="${padL}" x2="${w - padR}" y1="${padT}" y2="${padT}" stroke="#F1F5F9"/>
    <text x="${padL - 6}" y="${padT + 7}" text-anchor="end">${fmtNum(maxMl, 0)}</text>
    <text x="${padL - 6}" y="${base}" text-anchor="end">0</text>`;

  bins.forEach((b, i) => {
    const x0 = padL + i * slot + (slot - bw) / 2;
    if (b.ml > 0) {
      const bh = Math.max(1.5, (b.ml / maxMl) * ch);
      out += `<rect x="${x0.toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1" fill="#0D9488"><title>${fmtNum(b.ml, 1)} mL</title></rect>`;
    } else {
      out += `<rect x="${x0.toFixed(1)}" y="${base - 1}" width="${bw.toFixed(1)}" height="1" fill="#E2E8F0"/>`;
    }
    if (b.l > 0) {
      const lh = Math.max(2, (b.l / maxL) * ch * 0.5);
      out += `<rect x="${(x0 + bw / 2 - 1).toFixed(1)}" y="${(base - lh).toFixed(1)}" width="2" height="${lh.toFixed(1)}" fill="#64748B"><title>${fmtNum(b.l, 1)} L refill</title></rect>`;
    }
  });

  const labels = is24
    ? [[0, fmtSimTime(winStart)], [n / 2, fmtSimTime(winStart + 43200)], [n, fmtSimTime(now)]]
    : [[0, 'D01'], [n / 2, `D${pad2(n / 2)}`], [n, `D${pad2(n)}`]];
  out += labels
    .map(([i, txt], k) => `<text x="${padL + i * slot}" y="${h - 3}" text-anchor="${['start', 'middle', 'end'][k]}">${txt}</text>`)
    .join('');
  svg.innerHTML = out;
}

// --- Safety ledger ---
function describeCommand(c) {
  const parts = [];
  if (c.dose_stock_a_ml) parts.push(`A +${fmtNum(c.dose_stock_a_ml, 1)}`);
  if (c.dose_stock_b_ml) parts.push(`B +${fmtNum(c.dose_stock_b_ml, 1)}`);
  if (c.dose_acid_ml) parts.push(`HNO₃ +${fmtNum(c.dose_acid_ml, 1)}`);
  if (c.dose_base_ml) parts.push(`KOH +${fmtNum(c.dose_base_ml, 1)}`);
  switch (c.action) {
    case 'dose': return { verb: 'Dose', detail: `${parts.join(' · ')} mL` };
    case 'refill_water': return { verb: 'Refill water', detail: `+${fmtNum(c.refill_water_l, 1)} L` };
    case 'set_pump_throttle': return { verb: 'Set pump', detail: `${Math.round((c.throttle ?? 1) * 100)}%` };
    case 'set_aerator_throttle': return { verb: 'Set aerator', detail: `${Math.round((c.throttle ?? 1) * 100)}%` };
    case 'set_fan_throttle': return { verb: 'Set fans', detail: `${Math.round((c.throttle ?? 1) * 100)}%` };
    default: return { verb: c.action || 'Command', detail: parts.join(' · ') };
  }
}

function renderLedger() {
  const cmds = session.commands || [];
  const applied = cmds.filter((c) => c.status === 'accepted').length;
  const blocked = cmds.length - applied;
  el.ledgerStats.textContent = `${applied} APPLIED · ${blocked} BLOCKED`;

  if (cmds.length === 0) {
    const ts = `[${fmtSimTime(session.status?.sim_time_sec || 0)}]`;
    const sim = session.simId ? session.simId.slice(0, 8) : '--------';
    el.ledgerBody.className = 'term';
    el.ledgerBody.innerHTML = [
      ['SYSTEM_ARMED', 'Observing sensor array; 0 hazardous doses dispatched'],
      ['PLC_GUARDIAN', 'Interlock armed; EC / pH / volume envelope enforced on every command'],
      ['AUTOPILOT', `Closed-loop controller attached to sim ${sim}; awaiting first decision window`],
      ['LEDGER', 'No actuation commands recorded'],
    ]
      .map(([ev, msg]) => `<tr><td colspan="4"><span class="ts">${ts}</span> <span class="ev">${ev}</span> — ${msg}</td></tr>`)
      .join('');
    return;
  }

  el.ledgerBody.className = '';
  el.ledgerBody.innerHTML = [...cmds]
    .reverse()
    .slice(0, 40)
    .map((c) => {
      const ok = c.status === 'accepted';
      const { verb, detail } = describeCommand(c);
      const why = c.rejection_message || c.rejection_code || (ok ? 'Verified by PLC interlock' : 'Blocked');
      return `<tr>
        <td class="cmd">${verb}<span class="mono">${detail}</span></td>
        <td class="tgt">${nameOf(c.target_component_id)}<span class="mono">${c.target_component_id || '—'}</span></td>
        <td><span class="tag ${ok ? 'ok' : 'bad'}" title="${why}">${ok ? 'APPLIED' : 'REJECTED'}</span></td>
        <td class="time mono r">${fmtSimTime(c.sim_time_sec)}</td>
      </tr>`;
    })
    .join('');
}

// --- VIEW 2: Gully Matrix ---
function renderGullyMatrix() {
  const channels = session.spec?.channels || [];
  const doOut = session.readings.DO ?? session.gt?.c_do_ch_out_mg_l;
  el.matrix.innerHTML = Array.from({ length: 12 }, (_, i) => {
    const ch = channels[i];
    const ports = ch ? ch.plants_per_channel : 6;
    return `
      <div class="gully ${ch ? '' : 'off'}">
        <div class="gully-top">
          <span class="gully-name">Gully ${channelSlot(i)}</span>
          <span class="tag ${ch ? 'ok' : ''}">${ch ? 'ONLINE' : 'UNMOUNTED'}</span>
        </div>
        <div class="port-grid">${Array.from({ length: ports }, () => `<i class="port ${ch ? 'ok' : 'empty'}"></i>`).join('')}</div>
        <div class="gully-foot mono">
          <span>${ch ? ch.id : '—'} · ${ch ? ports : 0} PORTS</span>
          <span>DO ${ch ? fmtNum(doOut, 1) : '—'} mg/L</span>
        </div>
      </div>`;
  }).join('');
}

// --- VIEW 3: Rack Overview ---
function renderIsometricRack() {
  const faults = session.activeFaults || [];
  const doVal = session.readings.DO;
  const plane = (dy, label) => `
    <g transform="translate(0, ${dy})">
      <polygon points="200,200 480,100 640,170 360,270" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1"/>
      <line x1="240" y1="215" x2="520" y2="115" stroke="#F1F5F9" stroke-width="1"/>
      <line x1="280" y1="230" x2="560" y2="130" stroke="#F1F5F9" stroke-width="1"/>
      <line x1="320" y1="245" x2="600" y2="145" stroke="#F1F5F9" stroke-width="1"/>
      ${[0, 1, 2, 3].map((k) => `<rect x="${276 + k * 60}" y="${176 - k * 20}" width="8" height="8" fill="#0D9488"/>`).join('')}
      <text x="200" y="${222}" font-family="JetBrains Mono, monospace" font-size="10" fill="#64748B">${label}</text>
    </g>`;
  const pin = faults.length
    ? `<g transform="translate(340, 96)">
         <rect x="-70" y="-30" width="140" height="18" rx="3" fill="#0F172A"/>
         <text x="0" y="-18" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" fill="#FFFFFF">${faults[0].kind.toUpperCase()}</text>
         <circle r="5" fill="#DC2626"/>
       </g>`
    : `<g transform="translate(340, 96)"><circle r="4" fill="#0D9488"/></g>`;
  el.isoSvg.innerHTML = `
    <polygon points="120,380 400,240 680,380 400,430" fill="#F1F5F9"/>
    ${plane(-60, `GULLY B1 · OUTLET DO ${fmtNum(doVal, 1)} mg/L`)}
    ${plane(0, 'GULLY A1 · NOMINAL')}
    ${pin}`;
}

// --- VIEW 4: Timeline ---
function renderTimeline() {
  const n = stageOf(session.simDays).n;
  el.timelineStages.forEach((s) => {
    const k = Number(s.dataset.stage);
    s.classList.toggle('current', k === n);
    s.classList.toggle('done', k < n);
  });
}

// --- VIEW 5: Judge / Proof ---
function renderProofTable() {
  const rd = session.readings;
  const gt = session.gt || {};
  const res = session.residuals || {};
  const rows = [
    ['EC probe', 'sen-ec-1', rd.EC, gt.ec25_ds_m, 2, 'mS/cm', res.EC, Math.abs(res.EC ?? 0) > 0.1, 'CONCENTRATION ANOMALY'],
    ['pH probe', 'sen-ph-1', rd.pH, gt.ph, 2, 'pH', res.pH, Math.abs(res.pH ?? 0) > 0.4, 'ELECTRODE DRIFT'],
    ['Outlet DO probe', 'sen-do-1', rd.DO, gt.c_do_ch_out_mg_l, 2, 'mg/L', res.DO, (res.DO ?? 0) < -0.32, 'FLOW REDUCTION'],
    ['Reservoir level', 'sen-vres-1', rd.V_res, gt.v_res_l, 1, 'L', res.V_res, (res.V_res ?? 0) < -0.85, 'LEAK SUSPECTED'],
  ];
  el.proofBody.innerHTML = rows
    .map(([name, id, s, g, d, u, r, bad, msg]) => `
      <tr>
        <td class="tgt">${name}<span class="mono">${id}</span></td>
        <td class="mono r">${fmtNum(s, d)} ${u}</td>
        <td class="mono r">${fmtNum(g, d)} ${u}</td>
        <td class="mono r">${fmtNum(r ?? 0, 3)}</td>
        <td><span class="tag ${bad ? 'bad' : 'ok'}">${bad ? msg : 'NOMINAL'}</span></td>
      </tr>`)
    .join('');
}

// --- Modals ---
function bindModals() {
  el.btnOpenChallenge.addEventListener('click', () => {
    renderActiveFaults();
    el.modalChallenge.classList.add('open');
  });
  const closeChallenge = () => el.modalChallenge.classList.remove('open');
  el.modalChallengeClose.addEventListener('click', closeChallenge);
  el.modalChallengeCancel.addEventListener('click', closeChallenge);

  el.faultOpts.forEach((btn) =>
    btn.addEventListener('click', () => {
      el.faultOpts.forEach((b) => b.classList.toggle('selected', b === btn));
      selectedFault = FAULT_BY_KIND[btn.dataset.kind] || FAULTS[0];
    })
  );

  el.btnInject.addEventListener('click', async () => {
    if (!selectedFault) return;
    el.btnInject.disabled = true;
    try {
      await session.injectFault(selectedFault);
      closeChallenge();
    } catch (err) {
      console.error('Fault injection failed:', err);
    } finally {
      el.btnInject.disabled = false;
    }
  });

  el.btnClearAllFaults.addEventListener('click', async () => {
    await session.clearAllFaults();
    renderActiveFaults();
  });

  el.activeFaultsList.addEventListener('click', async (e) => {
    const kind = e.target.closest('[data-clear]')?.dataset.clear;
    if (!kind) return;
    await session.clearFault(kind);
    renderActiveFaults();
  });

  el.btnOpenLayout.addEventListener('click', openLayoutModal);
  const closeLayout = () => {
    el.modalLayout.classList.remove('open');
    el.seasonPicker.value = currentPreset.presetId ?? 'exp2';
  };
  el.modalLayoutClose.addEventListener('click', closeLayout);
  el.modalLayoutCancel.addEventListener('click', closeLayout);

  el.sliderChannels.addEventListener('input', (e) => (el.valChannels.textContent = e.target.value));
  el.sliderPlants.addEventListener('input', (e) => (el.valPlants.textContent = e.target.value));
  el.sliderVolume.addEventListener('input', (e) => (el.valVolume.textContent = `${e.target.value} L`));
  el.sliderFlow.addEventListener('input', (e) => (el.valFlow.textContent = `${Number(e.target.value).toFixed(1)} L/min`));
  el.btnApplyLayout.addEventListener('click', applyCustomLayout);
}

function renderActiveFaults() {
  const faults = session.activeFaults || [];
  el.activeFaultsList.innerHTML = faults.length
    ? faults
        .map((f) => `<div class="fault-chip"><span>${f.kind.toUpperCase()} · ${f.target_component_id || 'system'}</span><button class="btn btn-xs mono" data-clear="${f.kind}">CLEAR</button></div>`)
        .join('')
    : '<span class="mono">NO ACTIVE PERTURBATIONS</span>';
}

function openLayoutModal() {
  el.modalLayout.classList.add('open');
}

async function applyCustomLayout() {
  const count = parseInt(el.sliderChannels.value, 10);
  const plants = parseInt(el.sliderPlants.value, 10);
  const design = cloneDesign(currentPreset);
  design.channels.count = count;
  design.channels.plantsPerChannel = plants;
  design.reservoir.volumeL = parseFloat(el.sliderVolume.value);
  design.pump.flowLMin = parseFloat(el.sliderFlow.value);
  design.name = `Custom Farm Layout (${count} gullies, ${count * plants} plants)`;
  el.modalLayout.classList.remove('open');
  await loadPreset(design);
}

init();

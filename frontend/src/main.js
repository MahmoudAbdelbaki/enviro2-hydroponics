import { createApi } from './api/client.js';
import { TwinSession } from './sim/session.js';
import { getPreset, cloneDesign, plantCount, resolveBayLayout } from './domain/presets.js';
import { FAULTS, FAULT_BY_KIND } from './domain/faults.js';

// --- API & Twin Session ---
const mlKey = import.meta.env?.VITE_HYDRO_ML_API_KEY || 'sensor-x-dev-ml-key';
const api = createApi({ baseUrl: '', mlKey });
const session = new TwinSession(api, { enforceStockDepletion: true });
window.session = session;
window.api = api;

// --- Application State ---
let currentPreset = getPreset('exp2');
let activeView = 'farm-status';
let selectedFault = FAULTS[0];
let activeAlertTab = 'open';
let selectedAlertKey = null;
let selectedVitalityMetric = 'DO';
let selectedDosingTimeframe = '24h';
let selectedRackView = 'rack-1';
let selectedRackId = 'rack-1';
let selectedRackLayer = 'tier-2';
let selectedRackChannelId = null;
let selectedRackSensor = null;
let selectedDeepDiveChannelId = 'ch-1';
let selectedDeepDivePortIdx = 0;
const dosingTimeouts = {};
const STARTUP_PREWARM_DAYS = 3;

let cumulativeDoses = { a: 0, b: 0, acid: 0, base: 0, water: 0 };
let lastDose = { a: 0, b: 0, acid: 0, base: 0, water: 0 };

const VIEW_TITLES = {
  'farm-status': 'Farm Status',
  'gully-matrix': 'Gully Matrix & Bay Layout',
  'isometric-rack': 'Rack Overview · SCADA',
  'channel-deepdive': 'Channel Deep-Dive',
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
  'sen-tair-1': 'Air Temp Sensor',
  'sen-vres-1': 'Tank Level Sensor',
};

const ALERT_TITLES = {
  IMPLIED_PUMP_OR_AERATION_FAULT: 'Implied pump flow degradation',
  PH_PROBE_DRIFT_SUSPECTED: 'pH probe drift detected',
  RESERVOIR_LEAK_SUSPECTED: 'Reservoir leak inferred',
  HEAT_STRESS_EVENT: 'Heat stress event',
  NUTRIENT_MIX_ANOMALY: 'Nutrient mix anomaly',
  NUTRIENT_IMBALANCE: 'Nutrient mix anomaly',
  SENSOR_HARDWARE_STALL: 'Sensor hardware stall (flatline)',
  DOSING_HOLD_INTERLOCK: 'Dosing paused for probe check',
  STOCK_A_LOW: 'Stock A running low — restock soon',
  STOCK_A_EMPTY: 'Stock A empty — farmer top-up required',
  STOCK_B_LOW: 'Stock B running low — restock soon',
  STOCK_B_EMPTY: 'Stock B empty — farmer top-up required',
  STOCK_PH_LOW: 'pH Buffer running low — restock soon',
  STOCK_PH_EMPTY: 'pH Buffer empty — pH climbing until topped up',
};

const ALERT_SOPS = {
  IMPLIED_PUMP_OR_AERATION_FAULT: {
    steps: [
      'Inspect pump-1 intake strainer inside Central Sump (res-1) for root debris or biofilm restriction.',
      'Check Venturi / air stone diffuser on aer-1 to confirm vigorous O₂ bubbling (target DO_in ≥ 7.5 mg/L).',
      'Verify inlet emitter flow on Gully A1-1 (target ≥ 1.2 L/min) before clearing alarm.',
    ],
    rackLayer: 'tier-1',
  },
  PH_PROBE_DRIFT_SUSPECTED: {
    steps: [
      'Keep acid/base dosing on Shadow-Twin observer control — do NOT manually dump acid based on probe reading.',
      'Pull sen-ph-1 from res-1, rinse glass bulb in DI water, and test in pH 7.0 & pH 4.0 calibration buffers.',
      'Clean KCl reference junction or replace drifted electrode, then re-arm closed-loop probe tracking.',
    ],
    rackLayer: 'res-1',
  },
  RESERVOIR_LEAK_SUSPECTED: {
    steps: [
      'Inspect res-1 bulkhead fittings, manifold drain return elbows, and floor catch tray for pooling water.',
      'Close manual isolation valve on leaking return line and tighten or reseal union gasket.',
      'Refill sump to target volume and verify hourly water loss returns below 0.20 L/hr.',
    ],
    rackLayer: 'res-1',
  },
  HEAT_STRESS_EVENT: {
    steps: [
      'Verify canopy exhaust fans (fans-1) are running at 100% duty and intake louvers are unobstructed.',
      'Confirm AI Autopilot lowered EC target by -0.20 mS/cm so plants can transpire water more easily.',
      'Check sump water temperature (< 24 °C) to prevent Pythium root rot on upper tiers.',
    ],
    rackLayer: 'tier-2',
  },
  NUTRIENT_MIX_ANOMALY: {
    steps: [
      'Pause Stock A peristaltic dosing pump and agitate Stock A concentrate tank.',
      'Measure Stock A specific gravity / EC — concentrate batch appears ~4× over-strength.',
      'Use Manual Jog (+5 L Water) to dilute sump EC back inside crop recipe band.',
    ],
    rackLayer: 'res-1',
  },
  NUTRIENT_IMBALANCE: {
    steps: [
      'Pause Stock A peristaltic dosing pump and agitate Stock A concentrate tank.',
      'Measure Stock A specific gravity / EC — concentrate batch appears ~4× over-strength.',
      'Use Manual Jog (+5 L Water) to dilute sump EC back inside crop recipe band.',
    ],
    rackLayer: 'res-1',
  },
  STOCK_A_LOW: {
    steps: [
      'Prepare fresh Calcium Nitrate + Iron chelate Stock A batch before carboy reaches 0 mL.',
      'Inspect suction foot-valve filter at bottom of Stock A carboy.',
      'Click + Top Up Stock A below once refilled to reset level to 100%.',
    ],
    stockKey: 'a',
  },
  STOCK_A_EMPTY: {
    steps: [
      'Refill Stock A carboy immediately — Part A feeding is paused and EC will drift down.',
      'Prime Stock A peristaltic tubing to purge air pockets before resuming auto-dosing.',
      'Click + Top Up Stock A below to restore 100% capacity and resume closed-loop EC control.',
    ],
    stockKey: 'a',
  },
  STOCK_B_LOW: {
    steps: [
      'Prepare fresh Phosphate / Potassium / Magnesium Stock B batch before carboy reaches 0 mL.',
      'Inspect suction foot-valve filter at bottom of Stock B carboy.',
      'Click + Top Up Stock B below once refilled to reset level to 100%.',
    ],
    stockKey: 'b',
  },
  STOCK_B_EMPTY: {
    steps: [
      'Refill Stock B carboy immediately — Part B feeding is paused and EC will drift down.',
      'Prime Stock B peristaltic tubing to purge air pockets before resuming auto-dosing.',
      'Click + Top Up Stock B below to restore 100% capacity and resume closed-loop EC control.',
    ],
    stockKey: 'b',
  },
  STOCK_PH_LOW: {
    steps: [
      'Prepare diluted Nitric Acid (HNO₃) / Potassium Hydroxide (KOH) buffer carboy.',
      'Check Viton acid peristaltic pump tubing for wear or crystallization.',
      'Click + Top Up pH Buffer below once refilled to reset level to 100%.',
    ],
    stockKey: 'ph',
  },
  STOCK_PH_EMPTY: {
    steps: [
      'Refill pH Buffer carboy immediately — root nitrate uptake is pushing tank pH upward.',
      'Prime acid dosing line and verify check-valve injection port at res-1.',
      'Click + Top Up pH Buffer below to restore 100% capacity and bring pH back to setpoint.',
    ],
    stockKey: 'ph',
  },
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
const kpiRefs = (suffix) => ({
  val: $(`kpi-${suffix}`),
  trend: $(`kpi-trend-${suffix}`),
  safe: $(`kpi-safe-${suffix}`),
  pin: $(`kpi-pin-${suffix}`),
  target: $(`kpi-target-${suffix}`),
});
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
  btnJumpD10: $('btn-jump-d10'),
  btnOpenChallenge: $('btn-open-challenge'),
  btnTestPlc: $('btn-test-plc'),
  badgeAutopilot: $('badge-autopilot'),
  badgePlc: $('badge-plc'),

  banner: $('app-banner'),
  bannerDot: $('app-banner-dot'),
  bannerMsg: $('app-banner-msg'),
  bannerClose: $('app-banner-close'),

  stockBanner: $('stock-banner'),
  stockBannerDot: $('stock-banner-dot'),
  stockBannerTitle: $('stock-banner-title'),
  stockBannerMsg: $('stock-banner-msg'),
  stockBannerPer: $('stock-banner-per'),
  btnBannerTopupAll: $('btn-banner-topup-all'),
  btnTopupAll: $('btn-topup-all'),
  lvlLoopStatus: $('lvl-loop-status'),

  kpi: {
    ec: kpiRefs('ec'),
    ph: kpiRefs('ph'),
    doTank: kpiRefs('do-tank'),
    doOutlet: kpiRefs('do-outlet'),
    flow: kpiRefs('flow'),
    vpd: kpiRefs('vpd'),
  },
  kpiFlowSrc: $('kpi-flow-src'),

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
    a: { row: $('lvl-a'), state: $('lvl-a-state'), pct: $('lvl-a-pct'), fill: $('lvl-a-fill'), vol: $('lvl-a-vol') },
    b: { row: $('lvl-b'), state: $('lvl-b-state'), pct: $('lvl-b-pct'), fill: $('lvl-b-fill'), vol: $('lvl-b-vol') },
    ph: { row: $('lvl-ph'), state: $('lvl-ph-state'), pct: $('lvl-ph-pct'), fill: $('lvl-ph-fill'), vol: $('lvl-ph-vol') },
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
  btnExportCsv: $('btn-export-csv'),
  operatorBar: $('operator-control-bar'),
  btnToggleAutopilot: $('btn-toggle-autopilot'),
  opModeDot: $('op-mode-dot'),
  opModeLabel: $('op-mode-label'),
  valSpEc: $('val-sp-ec'),
  valSpPh: $('val-sp-ph'),

  matrix: $('matrix-grid-container'),
  matrixMetaSubtext: $('matrix-meta-subtext'),
  isoSvg: $('svg-isometric-rack'),
  rackBaySwitcher: $('rack-bay-switcher'),
  rackStagePill: $('rack-stage-pill'),
  rackTopoMeta: $('rack-topo-meta'),
  btnRackEditLayout: $('btn-rack-edit-layout'),
  rackLayerTabsEl: $('rack-layer-tabs'),
  rackLayerDetail: $('rack-layer-detail'),
  rackGullyCountBadge: $('rack-gully-count-badge'),
  rackGullyTable: $('rack-gully-table'),
  rackSkidBadge: $('rack-skid-badge'),
  rackSkidSummary: $('rack-skid-summary'),
  rackQuickFaults: $('rack-quick-faults'),
  btnRackClearFaults: $('btn-rack-clear-faults'),
  rackLatencyBadge: $('rack-latency-badge'),
  rackTruthTimeline: $('rack-truth-timeline'),

  deepdiveTitle: $('deepdive-title'),
  deepdiveBreadcrumb: $('deepdive-breadcrumb'),
  btnDeepdivePrev: $('btn-deepdive-prev'),
  btnDeepdiveNext: $('btn-deepdive-next'),
  deepdiveSelect: $('deepdive-channel-select'),
  deepdiveProfileMeta: $('deepdive-profile-meta'),
  deepdiveSvg: $('svg-channel-cross-section'),
  deepdivePortTable: $('deepdive-port-table'),
  deepdivePortBadge: $('deepdive-port-badge'),
  deepdivePortTabs: $('deepdive-port-tabs'),
  deepdivePortCard: $('deepdive-port-card'),
  deepdiveFlowRegime: $('deepdive-flow-regime'),
  deepdiveHydraulics: $('deepdive-hydraulics'),
  deepdiveVigorBadge: $('deepdive-vigor-badge'),
  deepdiveStressBars: $('deepdive-stress-bars'),
  deepdiveDoMeta: $('deepdive-do-meta'),
  deepdiveValDoOut: $('deepdive-val-do-out'),
  deepdiveValDoIn: $('deepdive-val-do-in'),
  deepdiveValDoDrop: $('deepdive-val-do-drop'),
  deepdiveDoSvg: $('svg-deepdive-do-chart'),
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
  valBaySummary: $('val-bay-summary'),
  sliderRacks: $('slider-rack-count'),
  sliderTiers: $('slider-tiers-per-rack'),
  sliderGulliesPerTier: $('slider-gullies-per-tier'),
  sliderChannels: $('slider-channel-count'),
  sliderPlants: $('slider-plants-per-channel'),
  sliderVolume: $('slider-tank-volume'),
  sliderFlow: $('slider-pump-flow'),
  valRacks: $('val-rack-count'),
  valTiers: $('val-tiers-per-rack'),
  valGulliesPerTier: $('val-gullies-per-tier'),
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
    if (activeView === 'channel-deepdive') renderChannelDeepDive();
  });
  await loadPreset(currentPreset);
}

// --- Banner & error helpers ---
function showBanner(kind, message) {
  if (!el.banner) return;
  el.banner.classList.remove('hidden', 'is-error', 'is-warn', 'is-ok');
  const dotClass = kind === 'error' ? 'crit' : kind === 'warn' ? 'warn' : 'ok';
  el.banner.classList.add(`is-${kind}`);
  el.bannerDot.className = `dot ${dotClass}`;
  el.bannerMsg.textContent = message;
}

function hideBanner() {
  el.banner?.classList.add('hidden');
}

function formatApiError(err, action) {
  if (err?.status === 401) {
    return `Authorization failed (HTTP 401) during ${action}: start Go backend with HYDRO_ML_API_KEY=${mlKey}`;
  }
  return `${action} failed: ${err?.message || 'Backend unreachable'}`;
}

function setAdvanceControlsDisabled(disabled) {
  if (el.btnStepDay) el.btnStepDay.disabled = disabled;
  if (el.btnJumpD10) el.btnJumpD10.disabled = disabled || session.simDays >= 10;
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

function openChannelDeepDive(channelId) {
  if (channelId) selectedDeepDiveChannelId = channelId;
  selectedDeepDivePortIdx = 0;
  switchView('channel-deepdive');
}

// --- Controls ---
function bindControls() {
  el.bannerClose?.addEventListener('click', hideBanner);

  el.seasonPicker.addEventListener('change', async (e) => {
    if (e.target.value === 'custom') return openLayoutModal();
    if (e.target.value === 'custom-active') return;
    el.seasonPicker.querySelector('option[value="custom-active"]')?.remove();
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
    setAdvanceControlsDisabled(true);
    try {
      await session.advanceDay();
    } catch (err) {
      showBanner('error', formatApiError(err, '+1 Day advance'));
    } finally {
      setAdvanceControlsDisabled(false);
    }
  });

  el.btnJumpD10?.addEventListener('click', async () => {
    const remainingDays = Math.max(0, 10 - session.simDays);
    if (remainingDays <= 0) return;
    setAdvanceControlsDisabled(true);
    try {
      await session.fastForwardDays(remainingDays);
    } catch (err) {
      showBanner('error', formatApiError(err, 'Jump to Day 10'));
    } finally {
      setAdvanceControlsDisabled(false);
    }
  });

  const triggerOverdoseTest = async (btnEl) => {
    if (!session.simId) return;
    if (btnEl) btnEl.disabled = true;
    try {
      const rec = await session.submitCommand({
        target_component_id: 'res-1',
        action: 'dose',
        dose_acid_ml: 600,
        dose_stock_a_ml: 350,
        reason: 'Operator / Demo Overdose Test: unsafe +600 mL acid shock',
      });
      if (rec && rec.status !== 'accepted') {
        showBanner('warn', `PLC Guardian blocked unsafe command (${rec.rejection_code || 'SAFETY_INTERLOCK'}): ${rec.rejection_message || 'exceeds chemical shock envelope'}`);
      }
    } catch (err) {
      showBanner('error', formatApiError(err, 'PLC safety test'));
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  };

  el.btnTestPlc?.addEventListener('click', () => triggerOverdoseTest(el.btnTestPlc));
  el.btnExportCsv?.addEventListener('click', exportBatchCsv);

  const toggleAutopilotMode = () => {
    const next = !session.autopilotEnabled;
    session.setAutopilot(next);
    showBanner(
      next ? 'ok' : 'warn',
      next
        ? 'AI Autopilot Closed-Loop Dosing re-armed — automatic EC, pH, and water maintenance active.'
        : 'Manual / Maintenance Mode active — automatic dosing paused for probe calibration or manual jog; PLC Safety Guardian remains armed.'
    );
  };
  el.btnToggleAutopilot?.addEventListener('click', toggleAutopilotMode);
  el.badgeAutopilot?.addEventListener('click', toggleAutopilotMode);
  if (el.badgeAutopilot) {
    el.badgeAutopilot.style.cursor = 'pointer';
    el.badgeAutopilot.title = 'Click to toggle between AI Closed-Loop Dosing and Manual / Maintenance Mode';
  }

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

  el.rackBaySwitcher?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rack-view]');
    if (!btn) return;
    selectedRackId = btn.dataset.rackView || 'rack-1';
    selectedRackView = selectedRackId;
    if (selectedRackLayer === 'res-1') selectedRackLayer = 'tier-2';
    lastIsoPipeKey = null;
    renderIsometricRack();
  });

  el.rackLayerTabsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layer]');
    if (!btn) return;
    selectedRackLayer = btn.dataset.layer || 'tier-2';
    selectedRackChannelId = null;
    selectedRackSensor = null;
    renderIsometricRack();
  });

  el.isoSvg?.addEventListener('click', (e) => {
    const sensorEl = e.target.closest('[data-sensor]');
    const channelEl = e.target.closest('[data-channel]');
    const rackUnitEl = e.target.closest('[data-rack-unit]');
    const layerEl = e.target.closest('[data-layer]');
    if (sensorEl) {
      selectedRackSensor = sensorEl.dataset.sensor;
      if (sensorEl.dataset.rack) selectedRackId = sensorEl.dataset.rack;
      if (sensorEl.dataset.layer) selectedRackLayer = sensorEl.dataset.layer;
      if (sensorEl.dataset.channel) selectedRackChannelId = sensorEl.dataset.channel;
      renderIsometricRack();
    } else if (channelEl) {
      selectedRackChannelId = channelEl.dataset.channel;
      if (channelEl.dataset.rack) selectedRackId = channelEl.dataset.rack;
      if (channelEl.dataset.layer) selectedRackLayer = channelEl.dataset.layer;
      selectedRackSensor = null;
      renderIsometricRack();
    } else if (rackUnitEl && !layerEl) {
      selectedRackId = rackUnitEl.dataset.rackUnit;
      renderIsometricRack();
    } else if (layerEl) {
      if (layerEl.dataset.rack) selectedRackId = layerEl.dataset.rack;
      selectedRackLayer = layerEl.dataset.layer;
      selectedRackChannelId = null;
      selectedRackSensor = null;
      renderIsometricRack();
    }
  });

  el.isoSvg?.addEventListener('dblclick', (e) => {
    const channelEl = e.target.closest('[data-channel]');
    if (channelEl?.dataset.channel) {
      openChannelDeepDive(channelEl.dataset.channel);
      return;
    }
    const rackUnitEl = e.target.closest('[data-rack-unit]');
    if (rackUnitEl?.dataset.rackUnit) {
      selectedRackView = rackUnitEl.dataset.rackUnit;
      selectedRackId = selectedRackView;
      lastIsoPipeKey = null;
      renderIsometricRack();
    }
  });

  el.rackLayerDetail?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-select-channel]');
    if (!chip) return;
    selectedRackChannelId = chip.dataset.selectChannel;
    if (chip.dataset.selectRack) selectedRackId = chip.dataset.selectRack;
    renderIsometricRack();
  });

  el.deepdiveSelect?.addEventListener('change', (e) => {
    selectedDeepDiveChannelId = e.target.value;
    selectedDeepDivePortIdx = 0;
    renderChannelDeepDive();
  });

  const stepDeepDiveGully = (delta) => {
    const channels = session.spec?.channels || [];
    if (!channels.length) return;
    const curIdx = Math.max(0, channels.findIndex((c) => c.id === selectedDeepDiveChannelId));
    const nextIdx = (curIdx + delta + channels.length) % channels.length;
    selectedDeepDiveChannelId = channels[nextIdx].id;
    selectedDeepDivePortIdx = 0;
    renderChannelDeepDive();
  };
  el.btnDeepdivePrev?.addEventListener('click', () => stepDeepDiveGully(-1));
  el.btnDeepdiveNext?.addEventListener('click', () => stepDeepDiveGully(1));

  el.btnRackEditLayout?.addEventListener('click', openLayoutModal);

  const handleTopupAll = () => {
    if (session.refillAllStocks()) {
      showBanner('ok', 'Stock A, Stock B, and pH Buffer refilled to 100% — automated dosing resumed.');
    }
  };
  el.btnTopupAll?.addEventListener('click', handleTopupAll);
  el.btnBannerTopupAll?.addEventListener('click', handleTopupAll);

  document.addEventListener('click', (e) => {
    const ddJump = e.target.closest('[data-deepdive-channel]');
    if (ddJump) {
      openChannelDeepDive(ddJump.dataset.deepdiveChannel);
      return;
    }
    const portBtn = e.target.closest('[data-port-idx]');
    if (portBtn) {
      selectedDeepDivePortIdx = parseInt(portBtn.dataset.portIdx, 10) || 0;
      renderChannelDeepDive();
      return;
    }
    const rackSelectRow = e.target.closest('[data-select-gully-row]');
    if (rackSelectRow && !e.target.closest('[data-deepdive-channel]')) {
      selectedRackChannelId = rackSelectRow.dataset.selectGullyRow;
      if (rackSelectRow.dataset.rack) selectedRackId = rackSelectRow.dataset.rack;
      if (rackSelectRow.dataset.layer) selectedRackLayer = rackSelectRow.dataset.layer;
      renderIsometricRack();
      return;
    }
    const topupBtn = e.target.closest('[data-stock-topup]');
    if (topupBtn) {
      const k = topupBtn.dataset.stockTopup;
      const s = session.stocks?.[k];
      if (session.refillStock(k) && s) {
        showBanner('ok', `${s.label} topped up to ${s.capacityMl} mL (100%) — automated dosing resumed.`);
      }
      return;
    }
    const depleteBtn = e.target.closest('[data-stock-deplete]');
    if (depleteBtn) {
      const k = depleteBtn.dataset.stockDeplete;
      const s = session.stocks?.[k];
      if (session.depleteStock(k, 0) && s) {
        showBanner('warn', `Simulator: ${s.label} drained to 0 mL. Watch ${k === 'ph' ? 'pH climb' : 'EC drift down'} without dosing, then click + Top Up.`);
      }
      return;
    }
    const spBtn = e.target.closest('[data-sp-step]');
    if (spBtn) {
      const [field, rawDelta] = (spBtn.dataset.spStep || '').split(':');
      const delta = parseFloat(rawDelta || '0');
      const curTargets = (session.design || currentPreset).targets;
      if (field === 'ec') {
        const nextEc = clamp(Math.round(((curTargets.ec ?? 2.0) + delta) * 10) / 10, 1.0, 2.8);
        session.setRecipeTargets({ ec: nextEc });
        showBanner('ok', `Crop recipe updated: Target EC set to ${nextEc.toFixed(2)} mS/cm (safe band ${(nextEc - 0.3).toFixed(1)}–${(nextEc + 0.3).toFixed(1)} mS/cm).`);
      } else if (field === 'ph') {
        const nextPh = clamp(Math.round(((curTargets.ph ?? 5.8) + delta) * 10) / 10, 5.4, 6.5);
        session.setRecipeTargets({ ph: nextPh });
        showBanner('ok', `Crop recipe updated: Target pH set to ${nextPh.toFixed(2)} pH (safe band ${(nextPh - 0.35).toFixed(2)}–${(nextPh + 0.35).toFixed(2)} pH).`);
      }
      return;
    }
    const manualDoseBtn = e.target.closest('[data-manual-dose]');
    if (manualDoseBtn && session.simId) {
      const kind = manualDoseBtn.dataset.manualDose;
      if (kind === 'overdose') {
        triggerOverdoseTest(manualDoseBtn);
        return;
      }
      manualDoseBtn.disabled = true;
      const cmdMap = {
        food: {
          target_component_id: 'res-1',
          action: 'dose',
          dose_stock_a_ml: 15,
          dose_stock_b_ml: 15,
          reason: 'Manual Operator Jog: +15 mL Stock A & +15 mL Stock B',
        },
        acid: {
          target_component_id: 'res-1',
          action: 'dose',
          dose_acid_ml: 8,
          reason: 'Manual Operator Jog: +8 mL Nitric Acid (pH down)',
        },
        water: {
          target_component_id: 'res-1',
          action: 'dose',
          refill_water_l: 5,
          reason: 'Manual Operator Jog: +5.0 L Fresh Water top-up',
        },
      };
      const cmd = cmdMap[kind];
      if (cmd) {
        session
          .submitCommand(cmd)
          .then((rec) => {
            if (rec?.status === 'accepted') {
              showBanner('ok', `PLC Guardian verified & applied manual command: ${cmd.reason}`);
            } else if (rec) {
              showBanner('warn', `PLC Guardian blocked manual command (${rec.rejection_code || 'SAFETY_INTERLOCK'}): ${rec.rejection_message || 'out of safe envelope'}`);
            }
          })
          .catch((err) => showBanner('error', formatApiError(err, 'Manual jog command')))
          .finally(() => {
            manualDoseBtn.disabled = false;
          });
      } else {
        manualDoseBtn.disabled = false;
      }
      return;
    }
    const ackBtn = e.target.closest('[data-ack-alert]');
    if (ackBtn) {
      e.stopPropagation();
      const alertKey = ackBtn.dataset.ackAlert;
      const all = session.getAllAlerts();
      const found = all.find((a) => `${a.id ?? ''}:${a.code}:${a.sim_time_sec}` === alertKey);
      if (session.acknowledgeAlert(alertKey, found)) {
        showBanner('ok', `Alert acknowledged by operator (${found?.code || 'ALARM'}) — technician SOP checklist logged.`);
      }
      return;
    }
    const alertRackBtn = e.target.closest('[data-alert-rack-layer]');
    if (alertRackBtn) {
      e.stopPropagation();
      selectedRackLayer = alertRackBtn.dataset.alertRackLayer || 'res-1';
      switchView('isometric-rack');
      return;
    }
    const alertSelectEl = e.target.closest('[data-alert-select]');
    if (alertSelectEl && !e.target.closest('button')) {
      selectedAlertKey = alertSelectEl.dataset.alertSelect;
      renderAlerts();
      return;
    }
  });

  el.rackQuickFaults?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-quick-fault]');
    if (!btn || !session.simId) return;
    const fault = FAULT_BY_KIND[btn.dataset.quickFault];
    if (!fault) return;
    btn.disabled = true;
    try {
      await session.injectFault(fault);
    } catch (err) {
      showBanner('error', formatApiError(err, 'Quick inject fault'));
    } finally {
      btn.disabled = false;
    }
  });

  el.btnRackClearFaults?.addEventListener('click', async () => {
    if (!session.simId) return;
    el.btnRackClearFaults.disabled = true;
    try {
      await session.clearAllFaults();
    } catch (err) {
      showBanner('error', formatApiError(err, 'Clear faults'));
    } finally {
      el.btnRackClearFaults.disabled = false;
    }
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
  selectedRackChannelId = null;
  selectedRackSensor = null;
  selectedDeepDivePortIdx = 0;
  lastIsoPipeKey = null;
  lastRackTabKey = null;
  lastRackBayKey = null;
}

async function loadPreset(preset) {
  currentPreset = preset;
  hideBanner();
  setAdvanceControlsDisabled(true);
  try {
    session.pause();
    updatePlayUI();
    resetDoseTracking();
    await session.start(preset);
    el.railLinkDot.className = 'dot ok';
    updateAllUI();
    if (STARTUP_PREWARM_DAYS > 0) {
      el.simMeta.textContent = 'INITIALIZING · PRE-WARMING 3-DAY BASELINE TELEMETRY...';
      await session.fastForwardDays(STARTUP_PREWARM_DAYS);
      session.resetStocksToFull();
    }
    updateAllUI();
  } catch (err) {
    console.error('Failed to start farm simulation:', err);
    el.railLinkDot.className = 'dot crit';
    el.simMeta.textContent = 'BACKEND UNREACHABLE · http://localhost:8080';
    showBanner('error', formatApiError(err, 'Farm simulation startup'));
  } finally {
    setAdvanceControlsDisabled(false);
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
    showBanner('error', formatApiError(err, 'Controller sync'));
  });
  session.on('harvest', () => {
    updatePlayUI();
    showBanner('ok', `Season complete · Harvest reached on Day ${Math.round(session.simDays)} (${fmtNum(session.gt?.shoot_fw_g_per_plant, 1)} g/head).`);
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
  const ec = rd.EC ?? gt.ec25_ds_m ?? 1.8;
  const ph = rd.pH ?? gt.ph ?? 6.0;
  const doTank = gt.c_do_res_mg_l ?? 8.2;
  const doOutlet = rd.DO ?? gt.c_do_ch_out_mg_l ?? 7.6;
  const shootG = gt.shoot_fw_g_per_plant ?? 14.5;
  const fTotal = gt.stress_factor ?? 0.96;
  const fPh = clamp(1 - Math.abs(ph - 6.0) * 0.18, 0.2, 1.0);
  const fEc = clamp(1 - Math.abs(ec - 1.8) * 0.16, 0.2, 1.0);
  const fTemp = clamp(1 - Math.max(0, Math.abs(tAir - 22.5) - 1.0) * 0.06, 0.2, 1.0);
  return {
    ec,
    ph,
    doTank,
    doOutlet,
    flow: session.spec?.pump?.rated_flow_l_min,
    vpd: Math.max(0, es - es * (rh / 100)),
    shootG,
    fTotal,
    fPh,
    fEc,
    fTemp,
  };
}

// --- Master render ---
function updateAllUI() {
  renderHeader();
  renderStockBanner();
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
  else if (activeView === 'channel-deepdive') renderChannelDeepDive();
  else if (activeView === 'judge-proof') renderProofTable();
}

function renderHeader() {
  const simSec = session.status?.sim_time_sec || 0;
  const days = session.simDays;
  const season = session.seasonDays;
  const stage = stageOf(days);
  const diag = session.getDiagnosticStage();

  el.simClock.textContent = `D${pad2(days)}/${season} · ${pad2((simSec % 86400) / 3600)}:${pad2((simSec % 3600) / 60)}`;

  if (session.simId) {
    const sid = session.simId.replace(/-/g, '').slice(0, 8).toUpperCase();
    el.simMeta.textContent = `SIM-${sid} · STAGE ${stage.n} ${stage.name} · HARVEST TARGET: DAY ${season}`;
  }

  // Autopilot badge — strictly derived from observed sensor diagnosis stage (never hidden ground truth)
  const auto = session.autopilotEnabled;
  if (!auto) {
    el.badgeAutopilot.className = 'badge mono is-warn';
    el.badgeAutopilot.innerHTML = '<span class="dot warn"></span>MANUAL OVERRIDE · DOSING PAUSED';
  } else if (diag.stage === 'fault') {
    el.badgeAutopilot.className = 'badge mono is-crit';
    el.badgeAutopilot.innerHTML = '<span class="dot crit"></span>AUTOPILOT · FAULT INFERRED';
  } else if (diag.stage === 'drifting') {
    el.badgeAutopilot.className = 'badge mono is-warn';
    el.badgeAutopilot.innerHTML = '<span class="dot warn"></span>AUTOPILOT · ANOMALY DETECTED';
  } else {
    el.badgeAutopilot.className = 'badge mono';
    el.badgeAutopilot.innerHTML = '<span class="dot ok"></span>AUTOPILOT · NOMINAL';
  }

  // PLC Guardian badge — synchronized with AI safety diagnosis + command verification
  const cmds = session.commands || [];
  const blocked = cmds.filter((c) => c.status !== 'accepted').length;
  const pct = cmds.length ? Math.round(((cmds.length - blocked) / cmds.length) * 100) : 100;
  if (diag.stage === 'fault') {
    el.badgePlc.className = 'badge mono is-crit';
    el.badgePlc.innerHTML = `<span class="dot crit"></span>PLC GUARDIAN · FAULT INFERRED${blocked ? ` (${blocked} BLK)` : ''}`;
  } else if (diag.stage === 'drifting') {
    el.badgePlc.className = 'badge mono is-warn';
    el.badgePlc.innerHTML = '<span class="dot warn"></span>PLC GUARDIAN · ANOMALY DETECTED';
  } else if (blocked > 0) {
    el.badgePlc.className = 'badge mono is-warn';
    el.badgePlc.innerHTML = `<span class="dot warn"></span>PLC GUARDIAN · ${blocked} BLOCKED`;
  } else {
    el.badgePlc.className = 'badge mono';
    el.badgePlc.innerHTML = `<span class="dot ok"></span>PLC GUARDIAN · ${pct}% VERIFIED`;
  }

  // Never leak ground-truth fault count into the topbar telemetry button
  el.btnOpenChallenge.lastChild.textContent = ' Inject Fault';
  if (el.btnJumpD10) el.btnJumpD10.disabled = session.busy || days >= 10;
}

function historyTrend(picker, eps) {
  const h = session.history || [];
  if (h.length < 2) return { symbol: '—', cls: 'is-flat' };
  const cur = picker(h[h.length - 1]);
  const prev = picker(h[h.length - 2]);
  if (cur == null || prev == null) return { symbol: '—', cls: 'is-flat' };
  const d = cur - prev;
  if (d >= eps) return { symbol: '▲', cls: 'is-up' };
  if (d <= -eps) return { symbol: '▼', cls: 'is-down' };
  return { symbol: '—', cls: 'is-flat' };
}

function renderKpiCard(ref, { value, digits, trend, min, max, safeLo, safeHi, targetText, warn, crit }) {
  if (!ref?.val) return;
  ref.val.textContent = fmtNum(value, digits);
  const cell = ref.val.closest('.kpi');
  cell.classList.toggle('is-crit', !!crit);
  cell.classList.toggle('is-warn', !crit && !!warn);

  if (ref.trend) {
    const tr = trend || { symbol: '—', cls: 'is-flat' };
    ref.trend.textContent = tr.symbol;
    ref.trend.className = `kpi-trend mono ${crit ? 'is-crit' : warn ? 'is-warn' : tr.cls}`;
  }

  if (ref.target && targetText) ref.target.textContent = targetText;
  if (ref.safe) {
    const lo = clamp(((safeLo - min) / (max - min)) * 100, 0, 100);
    const hi = clamp(((safeHi - min) / (max - min)) * 100, lo, 100);
    ref.safe.style.left = `${lo.toFixed(1)}%`;
    ref.safe.style.width = `${Math.max(4, hi - lo).toFixed(1)}%`;
  }
  if (ref.pin) {
    if (value == null || Number.isNaN(value)) {
      ref.pin.style.opacity = '0';
    } else {
      ref.pin.style.opacity = '1';
      ref.pin.style.left = `${clamp(((value - min) / (max - min)) * 100, 3, 97).toFixed(1)}%`;
    }
  }
}

function renderKpis() {
  const t = telemetry();
  const diag = session.getDiagnosticStage();
  const openCodes = new Set(diag.open.map((a) => a.code));
  const drifting = session.driftingSensors;

  // Pump flow has NO inline sensor; only transitions once AI infers IMPLIED_PUMP_OR_AERATION_FAULT from DO divergence.
  const flowInferred = openCodes.has('IMPLIED_PUMP_OR_AERATION_FAULT');
  const ratedFlow = t.flow ?? 3.0;
  const expDO = session.residuals?.DO?.expected ?? 8.2;
  const doDeficit = t.doOutlet != null ? Math.max(0.25, expDO - t.doOutlet) : 0.6;
  const displayFlow = flowInferred
    ? clamp(ratedFlow * Math.max(0.15, 1 - doDeficit * 0.45), 0.4, ratedFlow * 0.65)
    : ratedFlow;

  const ecTgt = (session.design || currentPreset).targets.ec - (openCodes.has('HEAT_STRESS_EVENT') ? 0.2 : 0);
  const vpdFrom = (s) => {
    const ta = s?.measured?.T_air;
    const rh = s?.measured?.RH;
    if (ta == null || rh == null) return null;
    const es = 0.61078 * Math.exp((17.27 * ta) / (ta + 237.3));
    return Math.max(0, es - es * (rh / 100));
  };

  renderKpiCard(el.kpi.ec, {
    value: t.ec,
    digits: 2,
    trend: historyTrend((s) => s.measured?.EC, 0.02),
    min: 0.8,
    max: 3.2,
    safeLo: ecTgt - 0.3,
    safeHi: ecTgt + 0.3,
    targetText: `Target: ${fmtNum(ecTgt - 0.3, 1)}–${fmtNum(ecTgt + 0.3, 1)}`,
    warn: (t.ec != null && (t.ec < 1.2 || t.ec > 2.8)) || drifting.has('EC'),
    crit: openCodes.has('NUTRIENT_MIX_ANOMALY') || openCodes.has('NUTRIENT_IMBALANCE'),
  });

  const phTgt = (session.design || currentPreset).targets.ph ?? 5.8;
  renderKpiCard(el.kpi.ph, {
    value: t.ph,
    digits: 2,
    trend: historyTrend((s) => s.measured?.pH, 0.03),
    min: 4.5,
    max: 7.5,
    safeLo: +(phTgt - 0.35).toFixed(2),
    safeHi: +(phTgt + 0.35).toFixed(2),
    targetText: `Target: ${fmtNum(phTgt - 0.35, 1)}–${fmtNum(phTgt + 0.35, 1)} pH`,
    warn: (t.ph != null && (t.ph < phTgt - 0.35 || t.ph > phTgt + 0.65)) || drifting.has('pH'),
    crit: openCodes.has('PH_PROBE_DRIFT_SUSPECTED'),
  });

  renderKpiCard(el.kpi.doTank, {
    value: t.doTank,
    digits: 1,
    trend: historyTrend((s) => s.doRes, 0.08),
    min: 3.0,
    max: 10.5,
    safeLo: 6.5,
    safeHi: 9.8,
    targetText: 'Target: ≥ 6.5 mg/L',
    warn: t.doTank != null && t.doTank < 6.2,
    crit: t.doTank != null && t.doTank < 4.5,
  });

  renderKpiCard(el.kpi.doOutlet, {
    value: t.doOutlet,
    digits: 1,
    trend: historyTrend((s) => s.measured?.DO, 0.06),
    min: 3.0,
    max: 10.5,
    safeLo: 6.0,
    safeHi: 9.8,
    targetText: 'Target: ≥ 6.0 mg/L',
    warn: (t.doOutlet != null && t.doOutlet < 5.5) || drifting.has('DO'),
    crit: flowInferred || (t.doOutlet != null && t.doOutlet < 4.2),
  });

  renderKpiCard(el.kpi.flow, {
    value: displayFlow,
    digits: 1,
    trend: flowInferred ? { symbol: '▼ FAULT', cls: 'is-crit' } : { symbol: '—', cls: 'is-flat' },
    min: 0,
    max: Math.max(4.5, ratedFlow * 1.4),
    safeLo: ratedFlow * 0.8,
    safeHi: ratedFlow * 1.15,
    targetText: `Rated: ${fmtNum(ratedFlow, 1)} L/min`,
    warn: false,
    crit: flowInferred,
  });
  if (el.kpiFlowSrc) {
    el.kpiFlowSrc.textContent = flowInferred ? 'FLOW DROP INFERRED · CHECK DO' : 'no flow meter · inferred via DO';
  }

  renderKpiCard(el.kpi.vpd, {
    value: t.vpd,
    digits: 2,
    trend: historyTrend(vpdFrom, 0.04),
    min: 0.0,
    max: 2.4,
    safeLo: 0.4,
    safeHi: 1.4,
    targetText: 'Target: 0.4–1.4 kPa',
    warn: t.vpd > 1.4 || t.vpd < 0.4 || drifting.has('T_air'),
    crit: openCodes.has('HEAT_STRESS_EVENT'),
  });
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

function renderStockBanner() {
  if (!el.stockBanner) return;
  const openStock = session.getOpenStockAlerts();
  if (openStock.length === 0) {
    el.stockBanner.classList.add('hidden');
    return;
  }

  const hasEmpty = openStock.some((a) => a.severity === 'critical');
  el.stockBanner.className = `stock-banner ${hasEmpty ? 'is-crit' : 'is-warn'}`;
  el.stockBannerDot.className = `dot ${hasEmpty ? 'crit' : 'warn'}`;
  el.stockBannerTitle.textContent = hasEmpty ? 'FARMER ACTION NEEDED · STOCK FINISHED' : 'FARMER NOTICE · STOCK RUNNING LOW';

  const summaryMsgs = openStock.map((a) => a.message).join(' · ');
  el.stockBannerMsg.textContent = summaryMsgs;

  if (el.stockBannerPer) {
    const keys = ['a', 'b', 'ph'].filter((k) => {
      const st = session.stocks?.[k]?.status;
      return st === 'empty' || st === 'low';
    });
    el.stockBannerPer.innerHTML = keys
      .map((k) => {
        const s = session.stocks[k];
        const cls = s.status === 'empty' ? 'btn-mini btn-mini-primary is-urgent mono' : 'btn-mini btn-mini-primary mono';
        return `<button class="${cls}" data-stock-topup="${k}">+ Top Up ${s.label}</button>`;
      })
      .join('');
  }
}

// --- Chemical & Tank Levels ---
function setLevel(key, pct, state, { status = 'ok', volText = null } = {}) {
  const l = el.lvl[key];
  if (!l) return;
  if (status === 'empty') {
    clearTimeout(dosingTimeouts[key]);
    l.row.classList.remove('dosing');
  }
  l.fill.style.width = `${pct}%`;
  l.fill.classList.toggle('low', status === 'low' || (key === 'water' && pct < 25));
  l.fill.classList.toggle('empty', status === 'empty');
  l.row.classList.toggle('is-low', status === 'low');
  l.row.classList.toggle('is-empty', status === 'empty');
  l.pct.textContent = `${pct}%`;
  if (l.vol && volText != null) l.vol.textContent = volText;
  if (!l.row.classList.contains('dosing')) l.state.textContent = state;
}

function renderLevels() {
  const stocks = session.stocks || {};
  const formatState = (k, s) => {
    if (s.status === 'empty') return 'EMPTY · TOP UP NEEDED';
    if (s.status === 'low') return 'LOW · RESTOCK SOON';
    if (k === 'ph') return s.usedMl > 0 ? `Σ ${fmtNum(s.usedMl, 0)} mL USED` : 'STANDBY';
    return s.lastDoseMl > 0 ? `LAST +${fmtNum(s.lastDoseMl, 1)} mL` : 'STANDBY';
  };

  let anyEmpty = false;
  let anyLow = false;
  for (const k of ['a', 'b', 'ph']) {
    const s = stocks[k] || { remainingMl: 0, capacityMl: 250, pct: 0, status: 'empty', usedMl: 0, lastDoseMl: 0 };
    if (s.status === 'empty') anyEmpty = true;
    else if (s.status === 'low') anyLow = true;
    setLevel(k, s.pct, formatState(k, s), {
      status: s.status,
      volText: `${Math.round(s.remainingMl)} / ${s.capacityMl} mL`,
    });
    const rowEl = el.lvl[k]?.row;
    const topupBtn = rowEl?.querySelector(`[data-stock-topup="${k}"]`);
    const depleteBtn = rowEl?.querySelector(`[data-stock-deplete="${k}"]`);
    if (topupBtn) {
      topupBtn.disabled = s.remainingMl >= s.capacityMl;
      topupBtn.classList.toggle('is-urgent', s.status === 'empty');
    }
    if (depleteBtn) depleteBtn.disabled = s.remainingMl < 1;
  }

  if (el.lvlLoopStatus) {
    el.lvlLoopStatus.innerHTML = anyEmpty
      ? '<span class="dot crit"></span>DOSING PAUSED · REFILL'
      : anyLow
        ? '<span class="dot warn"></span>LOW STOCK'
        : '<span class="dot ok"></span>CLOSED LOOP';
  }
  if (el.btnTopupAll) {
    const allFull = ['a', 'b', 'ph'].every((k) => (stocks[k]?.remainingMl ?? 0) >= (stocks[k]?.capacityMl ?? 1));
    el.btnTopupAll.disabled = allFull;
  }

  const vRes = session.gt?.v_res_l;
  const maxL = session.spec?.reservoir?.max_volume_l ?? 120;
  const pctW = vRes == null ? 0 : clamp(Math.round((vRes / maxL) * 100), 0, 100);
  setLevel('water', pctW, vRes == null ? '— L' : `${fmtNum(vRes, 1)} / ${maxL} L`);
}

// --- Alerts & Detections ---
function filterAlerts(alerts, openAlerts) {
  const has = (a, ...keys) => keys.some((k) => a.component_id?.includes(k) || a.code?.includes(k));
  switch (activeAlertTab) {
    case 'all': return alerts;
    case 'farm': return openAlerts.filter((a) => has(a, 'pump', 'aer', 'res', 'PUMP', 'AERATION', 'LEAK', 'DOSING_HOLD'));
    case 'sensors': return openAlerts.filter((a) => has(a, 'sen-', 'probe', 'DRIFT', 'CALIBRATION', 'HARDWARE_STALL'));
    case 'plants': return openAlerts.filter((a) => has(a, 'ch-', 'stock', 'STRESS', 'HEAT', 'NUTRIENT'));
    default: return openAlerts;
  }
}

function setPill(node, n) {
  node.textContent = n;
  node.parentElement.classList.toggle('has', n > 0);
}

function alertKeyOf(a) {
  return `${a.id ?? ''}:${a.code}:${a.sim_time_sec}`;
}

function renderAlerts() {
  const alerts = session.getAllAlerts();
  const { open, infoCount, driftingKinds } = session.getDiagnosticStage();
  setPill(el.cntCrit, open.filter((a) => a.severity === 'critical').length);
  setPill(el.cntWarn, open.filter((a) => a.severity === 'warning').length);
  setPill(el.cntInfo, infoCount);

  const list = filterAlerts(alerts, open);
  const now = session.status?.sim_time_sec || 0;
  const sevDot = (s) => (s === 'critical' ? 'crit' : s === 'warning' ? 'warn' : 'idle');

  if (list.length === 0) {
    const nDrift = driftingKinds.length;
    el.alertsFeed.innerHTML = `
      <div class="feed-item expanded">
        <span class="dot ${nDrift ? 'warn' : 'ok'}"></span>
        <span class="feed-title">No ${activeAlertTab === 'open' || activeAlertTab === 'all' ? 'open' : activeAlertTab} detections</span>
        <span class="feed-time mono">${fmtSimTime(now)}</span>
        <span class="feed-desc">${
          nDrift
            ? `Early telemetry drift spotted on ${nDrift} sensor(s). Gathering sustained samples before confirming AI alert.`
            : 'Residual observer comparing probe readings against twin physics. All residuals inside detection thresholds.'
        }</span>
      </div>
      <div class="feed-item"><span class="dot ok"></span><span class="feed-title">PLC safety interlock armed</span><span class="feed-time mono">NOMINAL</span></div>
      <div class="feed-item"><span class="dot ${nDrift ? 'warn' : 'ok'}"></span><span class="feed-title">Sensor observer</span><span class="feed-time mono">${nDrift ? `${nDrift} DRIFTING` : 'WITHIN TWIN BAND'}</span></div>`;
    return;
  }

  const reversed = [...list].reverse();
  const defaultTop =
    reversed.find((a) => a.severity === 'critical' && !session.acknowledgedAlerts?.has(alertKeyOf(a))) ||
    reversed.find((a) => a.severity === 'critical') ||
    reversed[0];
  const top = reversed.find((a) => alertKeyOf(a) === selectedAlertKey) || defaultTop;
  const topKey = alertKeyOf(top);
  const rest = reversed.filter((a) => alertKeyOf(a) !== topKey);

  const sop = ALERT_SOPS[top.code] || {
    steps: [
      'Inspect sensor telemetry vs. digital twin residual band on the Vitalities chart.',
      'Switch Autopilot to Manual Mode if probe calibration or plumbing repair is required.',
      'Verify physical component and acknowledge alert once telemetry returns to target band.',
    ],
  };
  const topAck = session.acknowledgedAlerts?.get(topKey);

  let quickActionBtn = '';
  if (sop.stockKey) {
    quickActionBtn = `<button class="btn-mini" data-stock-topup="${sop.stockKey}">${sop.actionLabel || '+ Top Up Stock'}</button>`;
  } else if (sop.rackLayer) {
    quickActionBtn = `<button class="btn-mini" data-alert-rack-layer="${sop.rackLayer}">Inspect on Rack →</button>`;
  }

  const ackWidget = topAck
    ? `<span class="ack-badge mono" title="Acknowledged by ${topAck.by} at ${fmtSimTime(topAck.ackAtSec)}">✓ ACKNOWLEDGED BY OPERATOR · ${fmtSimTime(topAck.ackAtSec)}</span>`
    : `<button class="btn-mini is-ack-btn" data-ack-alert="${topKey}">✓ ACKNOWLEDGE ALERT</button>`;

  const restHtml = rest
    .slice(0, 5)
    .map((a) => {
      const k = alertKeyOf(a);
      const isAck = session.acknowledgedAlerts?.has(k);
      return `
      <div class="feed-item clickable" data-alert-select="${k}" title="Click to view Technician SOP Checklist">
        <span class="dot ${isAck ? 'ok' : sevDot(a.severity)}"></span>
        <span class="feed-title">${ALERT_TITLES[a.code] || a.code} · ${nameOf(a.component_id)}</span>
        <span class="feed-time mono">${isAck ? '<span class="tag ack">ACK</span> ' : ''}${fmtSimTime(a.sim_time_sec)}</span>
      </div>`;
    })
    .join('');

  el.alertsFeed.innerHTML = `
    <div class="feed-item expanded">
      <span class="dot ${topAck ? 'ok' : sevDot(top.severity)}"></span>
      <span class="feed-title">${ALERT_TITLES[top.code] || top.code || 'Anomaly detected'}</span>
      <span class="feed-time mono">${fmtSimTime(top.sim_time_sec)}</span>
      <span class="feed-desc">${top.message || 'Divergence between probe reading and twin prediction.'}</span>
      <div class="sop-box">
        <div class="sop-title mono">FIELD SOP · 3-STEP TECHNICIAN REPAIR CHECKLIST</div>
        <ol class="sop-list">
          ${sop.steps.map((s) => `<li>${s}</li>`).join('')}
        </ol>
      </div>
      <div class="alert-actions">
        ${ackWidget}
        ${quickActionBtn}
        <span class="feed-code mono" style="margin-left:auto">${top.code} · ${top.component_id || 'system'}</span>
      </div>
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
  const cmds = (session.commands || []).filter((c) => c.status === 'accepted' || c.status === 'applied');
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

    // Safely extract dosing quantities from either top-level or payload object
    const p = c.payload || {};
    const stockA = c.dose_stock_a_ml ?? p.dose_stock_a_ml ?? 0;
    const stockB = c.dose_stock_b_ml ?? p.dose_stock_b_ml ?? 0;
    const acid = c.dose_acid_ml ?? p.dose_acid_ml ?? 0;
    const base = c.dose_base_ml ?? p.dose_base_ml ?? 0;
    const refill = c.refill_water_l ?? p.refill_water_l ?? 0;

    bins[i].ml += (stockA + stockB + acid + base);
    bins[i].l += refill;
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
  const p = c.payload || {};
  const stockA = c.dose_stock_a_ml ?? p.dose_stock_a_ml;
  const stockB = c.dose_stock_b_ml ?? p.dose_stock_b_ml;
  const acid = c.dose_acid_ml ?? p.dose_acid_ml;
  const base = c.dose_base_ml ?? p.dose_base_ml;
  const refill = c.refill_water_l ?? p.refill_water_l;
  const throttle = c.throttle ?? p.throttle;

  const chemParts = [];
  if (stockA) chemParts.push(`A +${fmtNum(stockA, 1)} mL`);
  if (stockB) chemParts.push(`B +${fmtNum(stockB, 1)} mL`);
  if (acid) chemParts.push(`HNO₃ +${fmtNum(acid, 1)} mL`);
  if (base) chemParts.push(`KOH +${fmtNum(base, 1)} mL`);
  if (refill) chemParts.push(`H₂O +${fmtNum(refill, 1)} L`);

  switch (c.action) {
    case 'dose':
      if (!stockA && !stockB && !acid && !base && refill) {
        return { verb: 'Refill water', detail: `+${fmtNum(refill, 1)} L` };
      }
      return { verb: 'Dose', detail: chemParts.join(' · ') || '0 mL' };
    case 'refill_water': return { verb: 'Refill water', detail: `+${fmtNum(refill, 1)} L` };
    case 'set_pump_throttle': return { verb: 'Set pump', detail: `${Math.round((throttle ?? 1) * 100)}%` };
    case 'set_aerator_throttle': return { verb: 'Set aerator', detail: `${Math.round((throttle ?? 1) * 100)}%` };
    case 'set_fan_throttle': return { verb: 'Set fans', detail: `${Math.round((throttle ?? 1) * 100)}%` };
    default: return { verb: c.action || 'Command', detail: chemParts.join(' · ') };
  }
}

function renderLedger() {
  // Sync Operator Control Bar (Autopilot mode + Recipe setpoints)
  const autoOn = session.autopilotEnabled !== false;
  if (el.btnToggleAutopilot) {
    el.btnToggleAutopilot.classList.toggle('is-auto', autoOn);
    el.btnToggleAutopilot.classList.toggle('is-manual', !autoOn);
  }
  if (el.opModeDot) {
    el.opModeDot.className = `dot ${autoOn ? 'ok' : 'warn'}`;
  }
  if (el.opModeLabel) {
    el.opModeLabel.textContent = autoOn ? 'AUTO CLOSED-LOOP' : 'MANUAL OVERRIDE · DOSING PAUSED';
  }
  const ecSp = session.design?.targets?.ec ?? 1.8;
  const phSp = session.design?.targets?.ph ?? 5.9;
  if (el.valSpEc) el.valSpEc.textContent = `${fmtNum(ecSp, 1)} mS/cm`;
  if (el.valSpPh) el.valSpPh.textContent = `${fmtNum(phSp, 1)} pH`;

  const cmds = session.commands || [];
  const applied = cmds.filter((c) => c.status === 'accepted' || c.status === 'applied').length;
  const blocked = cmds.length - applied;
  el.ledgerStats.textContent = `${applied} APPLIED · ${blocked} BLOCKED`;

  if (cmds.length === 0) {
    const ts = `[${fmtSimTime(session.status?.sim_time_sec || 0)}]`;
    const sim = session.simId ? session.simId.slice(0, 8) : '--------';
    el.ledgerBody.className = 'term';
    el.ledgerBody.innerHTML = [
      ['SYSTEM_ARMED', 'Observing sensor array; 0 hazardous doses dispatched'],
      ['PLC_GUARDIAN', 'Interlock armed; EC / pH / volume envelope enforced on every command'],
      ['AUTOPILOT', autoOn ? `Closed-loop controller attached to sim ${sim}; awaiting first decision window` : 'MANUAL OVERRIDE active — automatic dosing paused; operator jog controls enabled'],
      ['LEDGER', 'No actuation commands recorded'],
    ]
      .map(([ev, msg]) => `<tr><td colspan="4"><span class="ts">${ts}</span> <span class="ev">${ev}</span> — ${msg}</td></tr>`)
      .join('');
    return;
  }

  el.ledgerBody.className = '';
  const sortedCmds = [...cmds].sort((a, b) => (b.sim_time_sec || 0) - (a.sim_time_sec || 0));
  el.ledgerBody.innerHTML = sortedCmds
    .slice(0, 40)
    .map((c) => {
      const ok = c.status === 'accepted' || c.status === 'applied';
      const { verb, detail } = describeCommand(c);
      const why = c.rejection_message || c.rejection_code || (ok ? 'Verified by PLC interlock' : 'Blocked');
      return `<tr>
        <td class="cmd">${verb}<span class="mono">${detail}</span>${ok ? '' : `<span class="ledger-why mono">${c.rejection_code || 'SAFETY_INTERLOCK'}</span>`}</td>
        <td class="tgt">${nameOf(c.target_component_id)}<span class="mono">${c.target_component_id || '—'}</span></td>
        <td><span class="tag ${ok ? 'ok' : 'bad'}" title="${why}">${ok ? 'APPLIED' : 'REJECTED'}</span></td>
        <td class="time mono r">${fmtSimTime(c.sim_time_sec)}</td>
      </tr>`;
    })
    .join('');
}

function exportBatchCsv() {
  const simShort = session.simId ? session.simId.slice(0, 8).toUpperCase() : 'NOSIM';
  const simSec = session.status?.sim_time_sec || 0;
  const dayNum = Math.floor(simSec / 86400) + 1;
  const layout = resolveBayLayout(session.design || currentPreset, session.spec?.channels);
  const t = telemetry();
  const cmds = session.commands || [];
  const alerts = session.getAllAlerts();

  let totWaterL = 0, totStockA = 0, totStockB = 0, totAcid = 0;
  for (const c of cmds) {
    if (c.status !== 'accepted' && c.status !== 'applied') continue;
    const p = c.payload || {};
    totStockA += Number(c.dose_stock_a_ml ?? p.dose_stock_a_ml ?? 0);
    totStockB += Number(c.dose_stock_b_ml ?? p.dose_stock_b_ml ?? 0);
    totAcid += Number(c.dose_acid_ml ?? p.dose_acid_ml ?? 0);
    totWaterL += Number(c.refill_water_l ?? p.refill_water_l ?? 0);
  }

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [];

  rows.push(['HYDROTWIN OS - BATCH TRACEABILITY & PLC SAFETY AUDIT REPORT']);
  rows.push(['Simulation ID', session.simId || 'N/A', 'Exported At (UTC)', new Date().toISOString()]);
  rows.push(['Crop Cycle Timestamp', fmtSimTime(simSec), 'Autopilot Mode', session.autopilotEnabled ? 'AUTO CLOSED-LOOP' : 'MANUAL OVERRIDE']);
  rows.push(['Bay Topology', `${layout.numRacks} Rack(s) x ${layout.layersPerRack} Tier(s) x ${layout.gulliesPerLayer} Gullies (${layout.totalGullies} Total Gullies)`, 'Plant Sites', session.totalPlants]);
  rows.push(['Target Recipe EC (mS/cm)', fmtNum(session.design?.targets?.ec ?? 1.8, 2), 'Target Recipe pH', fmtNum(session.design?.targets?.ph ?? 5.9, 2)]);
  rows.push(['Current Measured EC (mS/cm)', fmtNum(t.ec, 2), 'Current Measured pH', fmtNum(t.ph, 2), 'Current Outlet DO (mg/L)', fmtNum(t.doCh, 2)]);
  rows.push(['Cumulative Water Refill (L)', fmtNum(totWaterL, 2), 'Cumulative Stock A (mL)', fmtNum(totStockA, 1), 'Cumulative Stock B (mL)', fmtNum(totStockB, 1), 'Cumulative Acid HNO3 (mL)', fmtNum(totAcid, 1)]);
  rows.push([]);

  rows.push(['=== SECTION 1: AI & STOCK ALERTS + OPERATOR ACKNOWLEDGEMENTS ===']);
  rows.push(['Sim Time', 'Severity', 'Alert Code', 'Component', 'Message', 'Operator Acknowledged', 'Ack Timestamp']);
  for (const a of alerts) {
    const k = alertKeyOf(a);
    const ack = session.acknowledgedAlerts?.get(k);
    rows.push([
      fmtSimTime(a.sim_time_sec),
      a.severity || 'info',
      a.code || '',
      a.component_id || 'system',
      a.message || '',
      ack ? 'YES' : 'NO',
      ack ? fmtSimTime(ack.ackAtSec) : '',
    ]);
  }
  rows.push([]);

  rows.push(['=== SECTION 2: PLC GUARDIAN COMMAND & SAFETY INTERLOCK LEDGER ===']);
  rows.push(['Sim Time', 'Command Action', 'Dose / Parameter Detail', 'Target Component', 'PLC Verdict', 'Rejection Code / Interlock Reason']);
  for (const c of cmds) {
    const ok = c.status === 'accepted' || c.status === 'applied';
    const { verb, detail } = describeCommand(c);
    rows.push([
      fmtSimTime(c.sim_time_sec),
      verb,
      detail,
      c.target_component_id || 'res-1',
      ok ? 'APPLIED' : 'REJECTED',
      ok ? 'VERIFIED_SAFE' : (c.rejection_code || c.rejection_message || 'SAFETY_INTERLOCK'),
    ]);
  }

  const csvContent = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fname = `hydro-batch-report-SIM-${simShort}-D${pad2(dayNum)}.csv`;
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  banner(`Exported Batch Audit CSV (${fname}) — ${cmds.length} PLC commands & ${alerts.length} alerts recorded.`, false);
}

// --- Shared Multi-Rack Bay & Per-Gully Physics / Telemetry Resolver ---
let lastIsoPipeKey = null;
let lastRackTabKey = null;
let lastRackBayKey = null;

function computeBayState() {
  const diag = session.getDiagnosticStage();
  const openCodes = new Set(diag.open.map((a) => a.code));
  const openStock = diag.openStock || session.getOpenStockAlerts();
  const drifting = session.driftingSensors;
  const rd = session.readings;
  const gt = session.gt || {};
  const t = telemetry();

  const layout = resolveBayLayout(session.design || currentPreset, session.spec?.channels);
  const flowInferred = openCodes.has('IMPLIED_PUMP_OR_AERATION_FAULT');
  const expDo = session.residuals?.DO?.expected ?? session.autopilot?.lastExpected?.DO;
  const doIn = t.doTank ?? gt.c_do_res_mg_l ?? 8.2;
  const totalPumpFlow = t.flow ?? session.design?.pump?.flowLMin ?? 3.0;
  const perGullyBaseFlow = flowInferred ? 0.18 : (totalPumpFlow / Math.max(1, layout.totalGullies));
  const airTempBase = rd.T_air ?? gt.t_air_c ?? 23.5;
  const rhBase = rd.RH ?? gt.rh_pct ?? 62;

  layout.allItems.forEach((item) => {
    item.globalIdx = item.idx;
    const rawDo = session.latestBySensor?.[item.sensorId]?.value;
    // Slight deterministic per-slot micro-gradient if sensor hasn't diverged yet
    const slotOffset = (item.rackIdx * 0.04) + ((layout.tiersPerRack - 1 - item.tierIdx) * 0.03);
    const doVal = rawDo != null ? rawDo : Math.max(0, (t.doOutlet ?? 7.6) - slotOffset);
    item.doVal = doVal;
    item.doIn = doIn;
    item.doDrop = Math.max(0, doIn - doVal);

    const chLowDo = expDo != null && doVal != null && (expDo - doVal >= 0.27);
    item.state = flowInferred
      ? 'fault'
      : (chLowDo || (item.globalIdx === 0 && drifting.has('DO')))
        ? 'drifting'
        : 'nominal';

    item.flowLMin = +(Math.max(0.12, perGullyBaseFlow * item.headFactor)).toFixed(2);
    item.lengthM = item.ch.length_m || 2.0;
    item.widthM = item.ch.width_m || 0.10;
    item.slopePct = 2.0;
    item.filmDepthMm = +clamp(1.15 + item.flowLMin * 0.92, 0.8, 4.8).toFixed(2);
    const areaM2 = item.widthM * (item.filmDepthMm / 1000);
    const flowM3S = (item.flowLMin / 60) / 1000;
    item.velocityCmS = +clamp((flowM3S / Math.max(1e-6, areaM2)) * 100, 1.4, 28.0).toFixed(1);
    item.residenceSec = Math.round((item.lengthM * 100) / Math.max(1.4, item.velocityCmS));

    const P = Math.max(1, item.ch.plants_per_channel || 8);
    item.ports = Array.from({ length: P }, (_, pIdx) => {
      const frac = (pIdx + 0.5) / P;
      const xM = +(0.12 + (pIdx / Math.max(1, P - 1)) * (item.lengthM - 0.24)).toFixed(2);
      const localDo = +clamp(doIn - (doIn - doVal) * Math.pow(frac, 0.92), 0.2, 14).toFixed(2);
      const doDropFromInlet = +Math.max(0, doIn - localDo).toFixed(2);
      const o2UptakeMgH = +(1.6 + (t.shootG / 140) * 4.4 * (0.9 + 0.18 * frac)).toFixed(2);
      const hypoxiaPenalty = localDo < 5.5 ? (5.5 - localDo) * 0.045 : 0;
      const shootG = +Math.max(1.2, t.shootG * (1 - 0.035 * frac - hypoxiaPenalty)).toFixed(1);
      const transpirationMlH = +(4.2 + (shootG / 135) * 16.8).toFixed(1);
      const portState = (item.state === 'fault' || localDo < 4.9)
        ? 'crit'
        : (item.state === 'drifting' || localDo < 6.1)
          ? 'stress'
          : 'ok';
      return {
        portIdx: pIdx,
        portNum: pIdx + 1,
        xM,
        frac,
        localDo,
        doDropFromInlet,
        o2UptakeMgH,
        shootG,
        transpirationMlH,
        portState,
      };
    });
  });

  layout.racks.forEach((rack) => {
    rack.gullies = rack.items;
    let rackRank = 0;
    rack.tiers.forEach((tier, tIdx) => {
      const isTop = tIdx === rack.tiers.length - 1;
      let tierRank = 0;
      tier.items.forEach((item) => {
        tierRank = Math.max(tierRank, item.state === 'fault' ? 2 : item.state === 'drifting' ? 1 : 0);
      });
      if (isTop) {
        if (openCodes.has('HEAT_STRESS_EVENT')) tierRank = 2;
        else if (drifting.has('T_air')) tierRank = Math.max(tierRank, 1);
      }
      tier.state = tierRank === 2 ? 'fault' : tierRank === 1 ? 'drifting' : 'nominal';
      rackRank = Math.max(rackRank, tierRank);
      const validDo = tier.items.map((x) => x.doVal).filter((x) => x != null);
      tier.avgDo = validDo.length ? validDo.reduce((a, b) => a + b, 0) / validDo.length : (t.doOutlet ?? 7.6);
      tier.totalFlow = tier.items.reduce((sum, x) => sum + x.flowLMin, 0);
      tier.plants = tier.items.reduce((sum, x) => sum + (x.ch.plants_per_channel || 0), 0);
      tier.tempC = +(airTempBase + (tier.items[0]?.tempOffsetC ?? 0)).toFixed(1);
      const svp = 0.61078 * Math.exp((17.27 * tier.tempC) / (tier.tempC + 237.3));
      tier.vpdKpa = +Math.max(0.25, svp * (1 - rhBase / 100)).toFixed(2);
      tier.ppfdUmol = tier.items[0]?.ppfdUmol ?? 240;
    });
    rack.state = rackRank === 2 ? 'fault' : rackRank === 1 ? 'drifting' : 'nominal';
    const rackDos = rack.gullies.map((g) => g.doVal).filter((v) => v != null);
    rack.avgDo = rackDos.length ? rackDos.reduce((a, b) => a + b, 0) / rackDos.length : (t.doOutlet ?? 7.6);
    rack.totalFlow = rack.gullies.reduce((sum, g) => sum + g.flowLMin, 0);
    rack.plants = rack.gullies.reduce((sum, g) => sum + (g.ch.plants_per_channel || 0), 0);
  });

  return { layout, diag, openCodes, openStock, drifting, rd, gt, t, flowInferred, doIn };
}

// --- VIEW 2: Gully Matrix (Multi-Rack Interactive Cards -> Deep-Dive) ---
function renderGullyMatrix() {
  if (!el.matrix) return;
  const { layout } = computeBayState();
  const totalPlants = plantCount(session.design || currentPreset);
  if (el.matrixMetaSubtext) {
    el.matrixMetaSubtext.textContent = `${layout.racksCount} ${layout.racksCount === 1 ? 'RACK' : 'RACKS'} · ${layout.totalGullies} ${layout.totalGullies === 1 ? 'GULLY' : 'GULLIES'} · ${totalPlants} PLANTS`;
  }

  const badgeFor = (st) => {
    if (st === 'fault') return { cls: 'crit', text: 'AI FAULT' };
    if (st === 'drifting') return { cls: 'warn', text: 'DRIFTING' };
    return { cls: 'ok', text: 'NOMINAL' };
  };

  el.matrix.innerHTML = layout.racks.map((rack) => {
    const rb = badgeFor(rack.state);
    const cardsHtml = rack.gullies.map((item) => {
      const gb = badgeFor(item.state);
      const cardCls = item.state === 'fault' ? 'is-crit' : item.state === 'drifting' ? 'is-warn' : '';
      const portsHtml = item.ports
        .map((p) => `<i class="port ${p.portState}" title="Port #${p.portNum} (${p.xM}m): DO ${fmtNum(p.localDo, 2)} mg/L"></i>`)
        .join('');
      return `
        <div class="gully is-clickable ${cardCls}" data-deepdive-channel="${item.chId}" title="Click to open Channel Deep-Dive for ${item.chId.toUpperCase()} (${item.slotCode})">
          <div class="gully-top">
            <span class="gully-name">Gully ${item.slotCode}</span>
            <span class="tag ${gb.cls}">${gb.text}</span>
          </div>
          <div class="port-grid">${portsHtml}</div>
          <div class="gully-foot mono">
            <span>${item.chId.toUpperCase()} · ${item.flowLMin.toFixed(1)} L/m</span>
            <span>${item.sensorId}: ${fmtNum(item.doVal, 2)} mg/L</span>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="rack-group">
        <div class="rack-group-head">
          <div class="rack-group-title">
            <span>${rack.label} · NFT CULTIVATION FRAME</span>
            <span class="rack-group-meta mono">${rack.tiers.length} TIERS · ${rack.gullies.length} GULLIES · ${rack.plants} PLANTS · AVG DO ${fmtNum(rack.avgDo, 2)} mg/L · FLOW ${fmtNum(rack.totalFlow, 1)} L/min</span>
          </div>
          <span class="tag ${rb.cls} mono">${rb.text}</span>
        </div>
        <div class="rack-group-grid">${cardsHtml}</div>
      </div>`;
  }).join('');
}

// --- VIEW 3: Rack Overview · Multi-Rack Bay & Single-Rack 3D Digital Twin ---
function isoPt(u, v, z = 0, geom) {
  return [
    +(geom.origin.x + u * geom.u.x + v * geom.v.x).toFixed(1),
    +(geom.origin.y - z + u * geom.u.y + v * geom.v.y).toFixed(1),
  ];
}

function isoPoly(pts) {
  return pts.map((p) => `${p[0]},${p[1]}`).join(' ');
}

/** Build an extruded isometric box from [u0..u1], [v0..v1], [z0..z1] painted back-to-front. */
function isoBoxFaces(u0, u1, v0, v1, z0, z1, { top, left, front, stroke, sw = 1, fillOpacity = 1 }, geom) {
  const b00 = isoPt(u0, v0, z0, geom);
  const b01 = isoPt(u0, v1, z0, geom);
  const b11 = isoPt(u1, v1, z0, geom);
  const t00 = isoPt(u0, v0, z1, geom);
  const t10 = isoPt(u1, v0, z1, geom);
  const t11 = isoPt(u1, v1, z1, geom);
  const t01 = isoPt(u0, v1, z1, geom);
  const sAttr = stroke ? `stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"` : 'stroke="none"';
  const op = fillOpacity < 1 ? `fill-opacity="${fillOpacity}"` : '';
  return `
    <polygon points="${isoPoly([b00, b01, t01, t00])}" fill="${left}" ${op} ${sAttr}/>
    <polygon points="${isoPoly([b01, b11, t11, t01])}" fill="${front}" ${op} ${sAttr}/>
    <polygon points="${isoPoly([t00, t10, t11, t01])}" fill="${top}" ${op} ${sAttr}/>`;
}

const RACK_PALETTE = {
  nominal: {
    top: '#f0fdfa', side: '#ccfbf1', front: '#e2f8f4', stroke: '#0d9488',
    waterTop: 'rgba(20,184,166,0.45)', waterFront: 'rgba(13,148,136,0.30)', waterLeft: 'rgba(15,118,110,0.38)',
    pillBg: '#f0fdfa', pillStroke: '#5eead4', pillText: '#0f766e', dot: '#0d9488', badge: 'NOMINAL',
  },
  drifting: {
    top: '#fffbeb', side: '#fde68a', front: '#fef3c7', stroke: '#d97706',
    waterTop: 'rgba(245,158,11,0.42)', waterFront: 'rgba(217,119,6,0.30)', waterLeft: 'rgba(180,83,9,0.36)',
    pillBg: '#fffbeb', pillStroke: '#fcd34d', pillText: '#b45309', dot: '#d97706', badge: 'DRIFTING',
  },
  fault: {
    top: '#fef2f2', side: '#fecaca', front: '#fee2e2', stroke: '#dc2626',
    waterTop: 'rgba(239,68,68,0.42)', waterFront: 'rgba(220,38,38,0.30)', waterLeft: 'rgba(185,28,28,0.38)',
    pillBg: '#fef2f2', pillStroke: '#fca5a5', pillText: '#b91c1c', dot: '#dc2626', badge: 'AI FAULT',
  },
};

function renderIsometricRack() {
  if (!el.isoSvg) return;
  const state = computeBayState();
  const { layout, diag, openCodes, openStock, drifting, rd, gt, t, flowInferred } = state;

  // Validate active rack selection (always inspect one clean rack at a time in the 3D viewport)
  const rackIds = new Set(layout.racks.map((r) => r.id));
  if (!rackIds.has(selectedRackId)) selectedRackId = layout.racks[0].id;
  if (!rackIds.has(selectedRackView)) selectedRackView = selectedRackId;
  const activeRack = layout.racks.find((r) => r.id === selectedRackId) || layout.racks[0];

  // Update Rack Switcher buttons in card header
  const bayKey = layout.racks.map((r) => `${r.id}:${r.gullies.length}`).join('|');
  if (el.rackBaySwitcher) {
    if (lastRackBayKey !== bayKey) {
      lastRackBayKey = bayKey;
      el.rackBaySwitcher.innerHTML = layout.racks
        .map((r) => `<button data-rack-view="${r.id}">${r.label}${layout.racksCount > 1 ? ` (${r.gullies.length}G)` : ''}</button>`)
        .join('');
    }
    el.rackBaySwitcher.querySelectorAll('[data-rack-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.rackView === activeRack.id);
    });
  }

  const tiers = activeRack.tiers;
  const tierCount = tiers.length;
  const tierIds = new Set(tiers.map((tr) => tr.shortId));
  if (selectedRackLayer !== 'res-1' && !tierIds.has(selectedRackLayer)) {
    selectedRackLayer = tiers[tiers.length - 1].shortId;
  }

  const vRes = rd.V_res ?? gt.v_res_l ?? 100;
  const maxL = session.spec?.reservoir?.max_volume_l ?? 120;
  const fillFrac = clamp(vRes / Math.max(1, maxL), 0.08, 0.96);
  const pctW = Math.round(clamp((vRes / maxL) * 100, 0, 100));

  const hasEmptyStock = openStock.some((a) => a.severity === 'critical');
  const hasLowStock = openStock.some((a) => a.severity === 'warning');
  const resFault = openCodes.has('RESERVOIR_LEAK_SUSPECTED') || openCodes.has('PH_PROBE_DRIFT_SUSPECTED') ||
    openCodes.has('NUTRIENT_MIX_ANOMALY') || openCodes.has('NUTRIENT_IMBALANCE') || hasEmptyStock;
  const resDrift = drifting.has('V_res') || drifting.has('pH') || drifting.has('EC') || hasLowStock;
  const resState = resFault ? 'fault' : resDrift ? 'drifting' : 'nominal';

  // Ensure persistent <g id="iso-scene"> and <g id="iso-pipes"> so 60fps pipe animations don't reset
  let sceneLayer = el.isoSvg.querySelector('#iso-scene');
  let pipesLayer = el.isoSvg.querySelector('#iso-pipes');
  if (!sceneLayer || !pipesLayer) {
    el.isoSvg.innerHTML = '<g id="iso-scene"></g><g id="iso-pipes"></g>';
    sceneLayer = el.isoSvg.querySelector('#iso-scene');
    pipesLayer = el.isoSvg.querySelector('#iso-pipes');
    lastIsoPipeKey = null;
  }

  renderSingleRackSvg({
    sceneLayer,
    pipesLayer,
    layout,
    rack: activeRack,
    tiers,
    tierCount,
    resState,
    vRes,
    maxL,
    fillFrac,
    pctW,
    hasEmptyStock,
    flowInferred,
    openCodes,
    drifting,
    diag,
    rd,
    gt,
    t,
  });

  if (el.rackTopoMeta) {
    const totalPlants = plantCount(session.design || currentPreset);
    el.rackTopoMeta.textContent = `${layout.racksCount} ${layout.racksCount === 1 ? 'RACK' : 'RACKS'} × ${layout.tiersPerRack}T · ${layout.totalGullies} GULLIES · ${totalPlants} PLANTS`;
  }

  renderRackInspector({
    layout,
    activeRack,
    tiers,
    diag,
    t,
    rd,
    gt,
    vRes,
    maxL,
    resState,
    flowInferred,
  });
}

function renderSingleRackSvg({
  sceneLayer,
  pipesLayer,
  rack,
  tiers,
  tierCount,
  resState,
  vRes,
  maxL,
  fillFrac,
  pctW,
  hasEmptyStock,
  flowInferred,
  openCodes,
  drifting,
  diag,
  rd,
  gt,
  t,
}) {
  const geom = tierCount === 3
    ? { origin: { x: 320, y: 446 }, u: { x: 244, y: -42 }, v: { x: 142, y: 42 }, resTopZ: 52, pillarTopZ: 396, boxH: 8 }
    : { origin: { x: 320, y: 432 }, u: { x: 248, y: -48 }, v: { x: 146, y: 46 }, resTopZ: 60, pillarTopZ: 348, boxH: 9 };
  const tierZs = tierCount === 1 ? [218] : tierCount === 2 ? [190, 332] : [162, 274, 386];
  tiers.forEach((tr, idx) => {
    tr.zTop = tierZs[idx];
  });

  // Dynamic supply/return pipe manifolds across 1..3 tiers
  const flowAnimState = flowInferred ? 'stalled' : drifting.has('DO') ? 'slow' : 'normal';
  const pipeKey = `single:${rack.id}:${flowAnimState}:${tierCount}:${rack.gullies.length}`;
  if (lastIsoPipeKey !== pipeKey) {
    lastIsoPipeKey = pipeKey;
    const pipeColor = flowAnimState === 'stalled' ? '#dc2626' : flowAnimState === 'slow' ? '#d97706' : '#0d9488';
    const flowCls = flowAnimState === 'stalled' ? 'is-stalled' : flowAnimState === 'slow' ? 'is-slow' : '';
    const pts = (arr) => arr.map((c) => isoPt(c[0], c[1], c[2], geom)).map((p) => `${p[0]},${p[1]}`).join(' L ');

    const topZ = tiers[tiers.length - 1].zTop - 3;
    const drainTopZ = tiers[tiers.length - 1].zTop - 5;
    const resRetZ = geom.resTopZ - 8;

    const supplyMain = `M ${pts([[0.10, 0.50, 18], [-0.07, 0.50, 18], [-0.07, 0.50, topZ], [0.02, 0.50, topZ]])}`;
    const supplyBranches = tiers.slice(0, -1).map((tr) => `M ${pts([[-0.07, 0.50, tr.zTop - 3], [0.02, 0.50, tr.zTop - 3]])}`);
    const drainMain = `M ${pts([[0.98, 0.60, drainTopZ], [1.07, 0.60, drainTopZ], [1.07, 0.60, resRetZ + 12], [0.82, 0.60, resRetZ + 12], [0.82, 0.60, resRetZ]])}`;
    const drainBranches = tiers.slice(0, -1).map((tr) => `M ${pts([[0.98, 0.60, tr.zTop - 5], [1.07, 0.60, tr.zTop - 5]])}`);
    const pPump = isoPt(-0.07, 0.50, 22, geom);

    pipesLayer.innerHTML = `
      <g pointer-events="none">
        <path d="${supplyMain}" fill="none" stroke="rgba(148,163,184,0.35)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
        ${supplyBranches.map((d) => `<path d="${d}" fill="none" stroke="rgba(148,163,184,0.35)" stroke-width="4" stroke-linejoin="round"/>`).join('')}
        <path d="${drainMain}" fill="none" stroke="rgba(148,163,184,0.30)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
        ${drainBranches.map((d) => `<path d="${d}" fill="none" stroke="rgba(148,163,184,0.30)" stroke-width="4" stroke-linejoin="round"/>`).join('')}
        <path d="${supplyMain}" fill="none" stroke="${pipeColor}" stroke-width="2.2" class="iso-flow-line ${flowCls}" stroke-linecap="round"/>
        ${supplyBranches.map((d) => `<path d="${d}" fill="none" stroke="${pipeColor}" stroke-width="2" class="iso-flow-line ${flowCls}" stroke-linecap="round"/>`).join('')}
        <path d="${drainMain}" fill="none" stroke="${pipeColor}" stroke-width="2.2" class="iso-flow-line ${flowCls}" stroke-opacity="0.82" stroke-linecap="round"/>
        ${drainBranches.map((d) => `<path d="${d}" fill="none" stroke="${pipeColor}" stroke-width="2" class="iso-flow-line ${flowCls}" stroke-opacity="0.82" stroke-linecap="round"/>`).join('')}
        <g transform="translate(${pPump[0]}, ${pPump[1]})">
          <rect x="-12" y="-10" width="24" height="20" rx="4" fill="#0f172a" stroke="${pipeColor}" stroke-width="1.5"/>
          <text x="0" y="3" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8" font-weight="600" fill="#fff">P1</text>
        </g>
      </g>`;
  }

  const pillar = (u, v, z0 = -8, z1 = geom.pillarTopZ, stroke = '#94a3b8') => {
    const a = isoPt(u, v, z0, geom);
    const b = isoPt(u, v, z1, geom);
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>`;
  };

  const renderTier = (tier) => {
    const pal = RACK_PALETTE[tier.state];
    const sel = selectedRackLayer === tier.shortId;
    const zTop = tier.zTop;
    const zShelfBot = zTop - geom.boxH;
    const zShelfTop = zShelfBot + 3;
    const K = tier.items.length;
    // Ensure gap * geom.v.y > (zTop - zShelfTop) so adjacent 3D gullies on a shelf never overlap
    const gap = K <= 1 ? 0 : K === 2 ? 0.18 : 0.15;
    const widthV = (0.90 - (K - 1) * gap) / K;

    const shelfFrame = isoBoxFaces(
      0.00, 1.00, 0.00, 1.00, zShelfBot, zShelfTop,
      { top: '#f8fafc', left: '#e2e8f0', front: '#f1f5f9', stroke: sel ? pal.stroke : '#cbd5e1', sw: sel ? 1.3 : 0.8 },
      geom
    );

    const troughsHtml = tier.items.map((item, k) => {
      const v0 = 0.05 + k * (widthV + gap);
      const v1 = v0 + widthV;
      const vm = (v0 + v1) / 2;
      item.vm = vm;
      const chPal = RACK_PALETTE[item.state];
      const chSel = selectedRackChannelId === item.chId;
      const plantsShown = Math.min(item.ch.plants_per_channel || 8, K <= 2 ? 8 : 6);
      const rDot = K <= 2 ? 3.5 : 3.0;
      const stripW = K <= 1 ? 6 : K === 2 ? 4 : 3;

      const aFlow = isoPt(0.06, vm, zTop + 0.3, geom);
      const bFlow = isoPt(0.94, vm, zTop + 0.3, geom);
      const ports = Array.from({ length: plantsShown }, (_, pIdx) => {
        const uu = 0.12 + (pIdx / Math.max(1, plantsShown - 1)) * 0.76;
        const [px, py] = isoPt(uu, vm, zTop + 1.4, geom);
        return `<circle cx="${px}" cy="${py}" r="${rDot}" fill="${chPal.dot}" fill-opacity="0.90" stroke="#ffffff" stroke-width="0.9"/>`;
      }).join('');

      return `
        <g class="iso-trough" data-rack="${rack.id}" data-layer="${tier.shortId}" data-channel="${item.chId}">
          <title>Gully ${item.slotCode} (${item.chId.toUpperCase()}) · ${item.ch.plants_per_channel} plants · ${item.sensorId}: ${fmtNum(item.doVal, 2)} mg/L · Flow ${item.flowLMin} L/min</title>
          ${isoBoxFaces(
            0.02, 0.98, v0, v1, zShelfTop, zTop,
            { top: chPal.top, left: chPal.side, front: chPal.front, stroke: chSel ? '#0f172a' : chPal.stroke, sw: chSel ? 1.8 : 0.85 },
            geom
          )}
          <line x1="${aFlow[0]}" y1="${aFlow[1]}" x2="${bFlow[0]}" y2="${bFlow[1]}" stroke="${chPal.stroke}" stroke-opacity="0.28" stroke-width="${stripW}" stroke-linecap="round"/>
          ${ports}
        </g>`;
    }).join('');

    return `
      <g class="iso-layer" data-rack="${rack.id}" data-layer="${tier.shortId}">
        ${sel ? `<polygon points="${isoPoly([isoPt(-0.02, -0.02, zTop, geom), isoPt(1.02, -0.02, zTop, geom), isoPt(1.02, 1.02, zTop, geom), isoPt(-0.02, 1.02, zTop, geom)])}" fill="none" stroke="${pal.stroke}" stroke-width="1.5" stroke-dasharray="4 3" stroke-opacity="0.72"/>` : ''}
        ${shelfFrame}
        ${troughsHtml}
      </g>`;
  };

  // Bottom Reservoir (res-1)
  const resPal = RACK_PALETTE[resState];
  const resSel = selectedRackLayer === 'res-1';
  const fluidTopZ = 3 + (geom.resTopZ - 9) * fillFrac;
  const tankPts = [
    isoPt(0.10, 0.14, 0, geom), isoPt(0.90, 0.14, 0, geom), isoPt(0.90, 0.86, 0, geom), isoPt(0.10, 0.86, 0, geom),
    isoPt(0.10, 0.14, geom.resTopZ, geom), isoPt(0.90, 0.14, geom.resTopZ, geom), isoPt(0.90, 0.86, geom.resTopZ, geom), isoPt(0.10, 0.86, geom.resTopZ, geom),
  ];
  const reservoirHtml = `
    <g class="iso-layer" data-layer="res-1">
      ${isoBoxFaces(0.10, 0.90, 0.14, 0.86, 0, geom.resTopZ, { top: 'rgba(241,245,249,0.55)', left: 'rgba(226,232,240,0.45)', front: 'rgba(248,250,252,0.55)', stroke: '#94a3b8', sw: 0.9 }, geom)}
      ${isoBoxFaces(0.12, 0.88, 0.16, 0.84, 2, fluidTopZ, { top: resPal.waterTop, left: resPal.waterLeft, front: resPal.waterFront, stroke: resPal.stroke, sw: 0.8 }, geom)}
      <polygon points="${isoPoly([tankPts[4], tankPts[5], tankPts[6], tankPts[7]])}" fill="none" stroke="${resPal.stroke}" stroke-width="${resSel ? 2 : 1.2}"/>
      <line x1="${tankPts[3][0]}" y1="${tankPts[3][1]}" x2="${tankPts[7][0]}" y2="${tankPts[7][1]}" stroke="${resPal.stroke}" stroke-width="${resSel ? 2 : 1.1}"/>
      <line x1="${tankPts[2][0]}" y1="${tankPts[2][1]}" x2="${tankPts[6][0]}" y2="${tankPts[6][1]}" stroke="${resPal.stroke}" stroke-width="${resSel ? 2 : 1.1}"/>
      <line x1="${tankPts[1][0]}" y1="${tankPts[1][1]}" x2="${tankPts[5][0]}" y2="${tankPts[5][1]}" stroke="${resPal.stroke}" stroke-width="${resSel ? 2 : 1.1}"/>
    </g>`;

  // Left-side tethered badges matched to 1, 2, or 3 tiers + Res-1
  const leftSlots = tierCount === 3 ? [32, 142, 252, 364] : tierCount === 2 ? [58, 196, 344] : [110, 344];
  const leftLabels = [...tiers].reverse().map((tr, i) => ({
    layer: tr.shortId,
    y: leftSlots[i],
    h: tierCount === 3 ? 46 : 48,
    title: `${rack.letter}-${tr.tabLabel} · ${tr.items.length} ${tr.items.length === 1 ? 'GULLY' : 'GULLIES'}`,
    sub: `DO ${fmtNum(tr.avgDo, 1)} mg/L · ${fmtNum(tr.totalFlow, 1)} L/m · ${tr.ppfdUmol} PPFD`,
    state: tr.state,
    target: isoPt(0.0, 0.35, tr.zTop - 2, geom),
  }));
  leftLabels.push({
    layer: 'res-1',
    y: leftSlots[leftSlots.length - 1],
    h: tierCount === 3 ? 46 : 48,
    title: 'RESERVOIR · RES-1',
    sub: hasEmptyStock ? 'STOCK EMPTY · TOP UP' : `VOL ${fmtNum(vRes, 1)} / ${maxL} L (${pctW}%)`,
    state: resState,
    target: isoPt(0.10, 0.65, geom.resTopZ * 0.52, geom),
  });

  const leftBadgesHtml = leftLabels.map((b) => {
    const pal = RACK_PALETTE[b.state];
    const sel = selectedRackLayer === b.layer;
    const cy = b.y + b.h / 2;
    return `
      <g class="iso-layer" data-rack="${rack.id}" data-layer="${b.layer}">
        <polyline points="234,${cy} 262,${cy} ${b.target[0]},${b.target[1]}" fill="none" stroke="${pal.stroke}" stroke-width="${sel ? 1.5 : 1}" stroke-dasharray="${sel ? 'none' : '3 3'}"/>
        <circle cx="${b.target[0]}" cy="${b.target[1]}" r="3.2" fill="${pal.dot}"/>
        <rect x="16" y="${b.y}" width="218" height="${b.h}" rx="6" fill="#ffffff" stroke="${sel ? pal.stroke : '#cbd5e1'}" stroke-width="${sel ? 1.8 : 1}"/>
        <rect x="16" y="${b.y}" width="4" height="${b.h}" rx="2" fill="${pal.dot}"/>
        <text x="28" y="${b.y + 18}" font-family="JetBrains Mono, monospace" font-size="10.5" font-weight="600" fill="#0f172a">${b.title}</text>
        <text x="28" y="${b.y + 35}" font-family="JetBrains Mono, monospace" font-size="9.2" fill="#64748b">${b.sub}</text>
        <rect x="174" y="${b.y + 7}" width="52" height="15" rx="3" fill="${pal.pillBg}" stroke="${pal.pillStroke}" stroke-width="0.8"/>
        <text x="200" y="${b.y + 17.5}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8" font-weight="700" fill="${pal.pillText}">${pal.badge}</text>
      </g>`;
  }).join('');

  // Right-side interactive hardware probe callouts
  const activeTierObj = tiers.find((tr) => tr.shortId === selectedRackLayer) || tiers[tiers.length - 1];
  const focusItem =
    tiers.flatMap((tr) => tr.items.map((x) => ({ tr, x }))).find((o) => o.x.chId === selectedRackChannelId) ||
    { tr: activeTierObj, x: activeTierObj.items[0] };
  const topTier = tiers[tiers.length - 1];

  const sensorNodes = [
    {
      id: focusItem.x.sensorId,
      desc: `Outlet DO Probe (${focusItem.x.slotCode})`,
      layer: focusItem.tr.shortId,
      channel: focusItem.x.chId,
      val: `${fmtNum(focusItem.x.doVal, 2)} mg/L`,
      anchor: isoPt(0.92, focusItem.x.vm ?? 0.50, focusItem.tr.zTop + 1, geom),
      y: 42,
      state: focusItem.x.state || 'nominal',
    },
    {
      id: 'sen-tair-1',
      desc: 'Canopy Air Temp',
      layer: topTier.shortId,
      val: `${fmtNum(rd.T_air ?? gt.t_air_c, 1)} °C`,
      anchor: isoPt(0.82, 0.14, topTier.zTop + 10, geom),
      y: 112,
      state: openCodes.has('HEAT_STRESS_EVENT') ? 'fault' : drifting.has('T_air') ? 'drifting' : 'nominal',
    },
    {
      id: 'sen-ph-1',
      desc: 'Reservoir pH Probe',
      layer: 'res-1',
      val: `${fmtNum(t.ph, 2)} pH`,
      anchor: isoPt(0.84, 0.28, geom.resTopZ, geom),
      y: 224,
      state: openCodes.has('PH_PROBE_DRIFT_SUSPECTED') ? 'fault' : hasEmptyStock && session.stocks?.ph?.status === 'empty' ? 'drifting' : drifting.has('pH') ? 'drifting' : 'nominal',
    },
    {
      id: 'sen-ec-1',
      desc: 'Reservoir EC Probe',
      layer: 'res-1',
      val: `${fmtNum(t.ec, 2)} mS`,
      anchor: isoPt(0.84, 0.54, geom.resTopZ, geom),
      y: 294,
      state: (openCodes.has('NUTRIENT_MIX_ANOMALY') || openCodes.has('NUTRIENT_IMBALANCE')) ? 'fault' : drifting.has('EC') ? 'drifting' : 'nominal',
    },
    {
      id: 'sen-vres-1',
      desc: 'Tank Volume Sensor',
      layer: 'res-1',
      val: `${fmtNum(vRes, 1)} L`,
      anchor: isoPt(0.88, 0.78, geom.resTopZ * 0.44, geom),
      y: 364,
      state: openCodes.has('RESERVOIR_LEAK_SUSPECTED') ? 'fault' : drifting.has('V_res') ? 'drifting' : 'nominal',
    },
  ];
  const sensorBadgesHtml = sensorNodes.map((s) => {
    const pal = RACK_PALETTE[s.state];
    const sel = selectedRackSensor === s.id;
    const cy = s.y + 19;
    return `
      <g class="iso-pin" data-sensor="${s.id}" data-rack="${rack.id}" data-layer="${s.layer}" ${s.channel ? `data-channel="${s.channel}"` : ''}>
        <title>${s.id} (${s.desc}): ${s.val} — ${pal.badge} · Click to inspect</title>
        <polyline points="${s.anchor[0]},${s.anchor[1]} 714,${cy} 732,${cy}" fill="none" stroke="${pal.stroke}" stroke-width="${sel ? 1.5 : 0.9}" stroke-dasharray="2 2"/>
        <circle cx="${s.anchor[0]}" cy="${s.anchor[1]}" r="${s.state === 'nominal' ? 3.5 : 4.5}" fill="${pal.dot}" stroke="#ffffff" stroke-width="1.2"/>
        <rect x="732" y="${s.y}" width="134" height="38" rx="5" fill="${s.state === 'nominal' ? '#ffffff' : pal.pillBg}" stroke="${sel ? '#0f172a' : s.state === 'nominal' ? '#cbd5e1' : pal.pillStroke}" stroke-width="${sel ? 1.6 : 1}"/>
        <circle cx="744" cy="${s.y + 13}" r="3" fill="${pal.dot}"/>
        <text x="752" y="${s.y + 16}" font-family="JetBrains Mono, monospace" font-size="9" font-weight="600" fill="#475569">${s.id}</text>
        <text x="744" y="${s.y + 30}" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600" fill="#0f172a">${s.val}</text>
      </g>`;
  }).join('');

  const alertPinTarget = (code) => {
    if (code?.startsWith('STOCK_')) return { pt: isoPt(0.42, 0.72, geom.resTopZ + 4, geom), label: code.replace(/_/g, ' ') };
    if (code === 'IMPLIED_PUMP_OR_AERATION_FAULT') return { pt: isoPt(0.76, 0.50, topTier.zTop + 4, geom), label: 'FLOW / DO FAULT' };
    if (code === 'HEAT_STRESS_EVENT') return { pt: isoPt(0.55, 0.30, topTier.zTop + 8, geom), label: 'HEAT STRESS' };
    if (code === 'RESERVOIR_LEAK_SUSPECTED') return { pt: isoPt(0.46, 0.55, geom.resTopZ + 4, geom), label: 'TANK LEAK' };
    if (code === 'PH_PROBE_DRIFT_SUSPECTED') return { pt: isoPt(0.60, 0.38, geom.resTopZ + 4, geom), label: 'pH PROBE DRIFT' };
    return { pt: isoPt(0.50, 0.50, geom.resTopZ + 4, geom), label: code?.slice(0, 18) || 'AI FAULT' };
  };
  let pinHtml = '';
  if (diag.open.length > 0) {
    const top = diag.open[diag.open.length - 1];
    const { pt, label } = alertPinTarget(top.code);
    pinHtml = `
      <g transform="translate(${pt[0]}, ${pt[1]})" pointer-events="none">
        <circle class="iso-pulse" r="9" fill="#dc2626"/>
        <circle r="5" fill="#dc2626" stroke="#ffffff" stroke-width="1.5"/>
        <line x1="0" y1="-5" x2="0" y2="-22" stroke="#0f172a" stroke-width="1.4"/>
        <rect x="-72" y="-42" width="144" height="20" rx="4" fill="#dc2626"/>
        <text x="0" y="-29" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8.5" font-weight="700" fill="#ffffff">${label}</text>
      </g>`;
  } else if (diag.driftingKinds.length > 0) {
    const fk = diag.driftingKinds[0];
    const pt = fk === 'DO' || fk === 'T_air' ? isoPt(0.72, 0.50, topTier.zTop + 4, geom) : isoPt(0.50, 0.50, geom.resTopZ + 4, geom);
    pinHtml = `
      <g transform="translate(${pt[0]}, ${pt[1]})" pointer-events="none">
        <circle class="iso-pulse" r="8" fill="#d97706"/>
        <circle r="4.5" fill="#d97706" stroke="#ffffff" stroke-width="1.5"/>
        <line x1="0" y1="-5" x2="0" y2="-20" stroke="#92400e" stroke-width="1.2"/>
        <rect x="-62" y="-39" width="124" height="19" rx="4" fill="#d97706"/>
        <text x="0" y="-26.5" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" font-weight="700" fill="#ffffff">DRIFTING · ${fk}</text>
      </g>`;
  }

  const floorPoly = isoPoly([isoPt(-0.04, -0.04, -8, geom), isoPt(1.04, -0.04, -8, geom), isoPt(1.04, 1.04, -8, geom), isoPt(-0.04, 1.04, -8, geom)]);
  const tiersHtml = tiers.map((tr) => renderTier(tr)).join('');

  sceneLayer.innerHTML = `
    <polygon points="${floorPoly}" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="1"/>
    ${pillar(0.98, 0.02, -8, geom.pillarTopZ, '#cbd5e1')}
    ${pillar(0.02, 0.02, -8, geom.pillarTopZ, '#94a3b8')}
    ${reservoirHtml}
    ${tiersHtml}
    ${pillar(0.98, 0.98, -8, geom.pillarTopZ, '#64748b')}
    ${pillar(0.02, 0.98, -8, geom.pillarTopZ, '#64748b')}
    ${leftBadgesHtml}
    ${sensorBadgesHtml}
    ${pinHtml}`;
}

function renderRackInspector({
  layout,
  activeRack,
  tiers,
  diag,
  t,
  vRes,
  maxL,
  resState,
  flowInferred,
}) {
  // 1. Header AI state pill
  if (el.rackStagePill) {
    if (diag.stage === 'fault') {
      el.rackStagePill.className = 'badge mono is-crit';
      el.rackStagePill.innerHTML = `<span class="dot crit"></span>AI STATE · ALERT ACTIVE (${diag.open.length})`;
    } else if (diag.stage === 'drifting') {
      el.rackStagePill.className = 'badge mono is-warn';
      el.rackStagePill.innerHTML = `<span class="dot warn"></span>AI STATE · ANOMALY DETECTED (${diag.driftingKinds.length})`;
    } else {
      el.rackStagePill.className = 'badge mono';
      el.rackStagePill.innerHTML = '<span class="dot ok"></span>AI STATE · NOMINAL';
    }
  }

  // 2. Dynamic Layer selector tabs (tiers top-to-bottom + res-1)
  const tabKey = `${activeRack.id}:${tiers.map((tr) => tr.shortId).join(':')}`;
  if (el.rackLayerTabsEl) {
    if (lastRackTabKey !== tabKey) {
      lastRackTabKey = tabKey;
      const tierTabs = [...tiers].reverse().map((tr) => `<button data-layer="${tr.shortId}">${activeRack.letter}-${tr.tabLabel}</button>`).join('');
      el.rackLayerTabsEl.innerHTML = `${tierTabs}<button data-layer="res-1">RES-1</button>`;
    }
    el.rackLayerTabsEl.querySelectorAll('[data-layer]').forEach((btn) =>
      btn.classList.toggle('active', btn.dataset.layer === selectedRackLayer)
    );
  }

  const stageBadge = (st) => {
    if (st === 'fault') return '<span class="tag crit">FAULT / ACTION</span>';
    if (st === 'drifting') return '<span class="tag warn">ANOMALY DRIFT</span>';
    return '<span class="tag ok">NOMINAL</span>';
  };
  const drifting = session.driftingSensors;
  const openCodes = new Set(diag.open.map((a) => a.code));

  // 3. Panel 1: Selected Rack Tier or Reservoir Detail
  if (el.rackLayerDetail) {
    if (selectedRackLayer === 'res-1') {
      const stocks = session.stocks || {};
      const stockItemsHtml = ['a', 'b', 'ph'].map((k) => {
        const s = stocks[k] || { key: k, label: k.toUpperCase(), remainingMl: 0, capacityMl: 250, pct: 0, status: 'ok' };
        const stCls = s.status === 'empty' ? 'is-empty' : s.status === 'low' ? 'is-low' : '';
        const btnCls = s.status === 'empty' ? 'btn-mini btn-mini-primary is-urgent mono' : 'btn-mini btn-mini-primary mono';
        return `
          <div class="insp-stock-item ${stCls}">
            <div class="insp-stock-meta">
              <b>${s.label} · ${s.pct}%</b>
              <span class="mono">${Math.round(s.remainingMl)} / ${s.capacityMl} mL</span>
            </div>
            <button class="btn-mini mono" data-stock-deplete="${k}" ${s.remainingMl < 1 ? 'disabled' : ''}>Empty</button>
            <button class="${btnCls}" data-stock-topup="${k}" ${s.remainingMl >= s.capacityMl ? 'disabled' : ''}>+ Top Up</button>
          </div>`;
      }).join('');
      const kvs = [
        { k: 'Tank Level (sen-vres-1)', v: `${fmtNum(vRes, 1)} / ${maxL} L`, cls: openCodes.has('RESERVOIR_LEAK_SUSPECTED') ? 'is-crit' : drifting.has('V_res') ? 'is-warn' : '' },
        { k: 'Acidity (sen-ph-1)', v: `${fmtNum(t.ph, 2)} pH`, cls: openCodes.has('PH_PROBE_DRIFT_SUSPECTED') ? 'is-crit' : (stocks.ph?.status === 'empty' || drifting.has('pH')) ? 'is-warn' : '' },
        { k: 'Plant Food (sen-ec-1)', v: `${fmtNum(t.ec, 2)} mS/cm`, cls: (openCodes.has('NUTRIENT_MIX_ANOMALY') || openCodes.has('NUTRIENT_IMBALANCE')) ? 'is-crit' : drifting.has('EC') ? 'is-warn' : '' },
        { k: 'Tank Supply DO (DO_in)', v: `${fmtNum(t.doTank, 2)} mg/L`, cls: '' },
      ];
      el.rackLayerDetail.innerHTML = `
        <div class="insp-title-row">
          <span class="insp-title">Central Mixing Sump &amp; Dosing (res-1)</span>
          ${stageBadge(resState)}
        </div>
        <div class="insp-desc">Closed-loop mixing reservoir feeding ${layout.racksCount} ${layout.racksCount === 1 ? 'rack' : 'racks'} (${layout.totalGullies} NFT gullies) via manifold pump-1.</div>
        <div class="insp-metrics">
          ${kvs.map((kv) => `<div class="insp-kv ${kv.cls}"><span class="k mono">${kv.k}</span><span class="v mono">${kv.v}</span></div>`).join('')}
        </div>
        <div class="insp-stock-list">${stockItemsHtml}</div>`;
    } else {
      const tier = tiers.find((tr) => tr.shortId === selectedRackLayer) || tiers[tiers.length - 1];
      const activeCh = tier.items.find((x) => x.chId === selectedRackChannelId) || tier.items[0];
      const chStatusCls = activeCh.state === 'fault' ? 'is-crit' : activeCh.state === 'drifting' ? 'is-warn' : '';
      const kvs = [
        { k: `Outlet DO (${activeCh.sensorId})`, v: `${fmtNum(activeCh.doVal, 2)} mg/L (Δ -${fmtNum(activeCh.doDrop, 2)})`, cls: chStatusCls },
        { k: 'Gully Flow & Film Speed', v: flowInferred ? `STALLED (${activeCh.flowLMin} L/m)` : `${activeCh.flowLMin.toFixed(1)} L/m · ${activeCh.velocityCmS} cm/s`, cls: flowInferred ? 'is-crit' : '' },
        { k: 'Canopy Light (PPFD)', v: `${tier.ppfdUmol} µmol/m²/s · 16h/8h`, cls: '' },
        { k: 'Tier Microclimate', v: `${fmtNum(tier.tempC, 1)} °C · VPD ${fmtNum(tier.vpdKpa, 2)} kPa`, cls: openCodes.has('HEAT_STRESS_EVENT') ? 'is-crit' : drifting.has('T_air') ? 'is-warn' : '' },
      ];
      const chChips = tier.items.map((x) => {
        const selCls = x.chId === activeCh.chId ? 'active' : '';
        const stCls = x.state === 'fault' ? 'is-crit' : x.state === 'drifting' ? 'is-warn' : '';
        return `
          <button class="insp-ch-chip ${selCls} ${stCls}" data-select-channel="${x.chId}" title="Gully ${x.slotCode} (${x.sensorId}): ${fmtNum(x.doVal, 2)} mg/L">
            <span class="ch-id mono">${x.slotCode}</span>
            <span class="ch-val mono">${fmtNum(x.doVal, 1)} mg/L</span>
          </button>`;
      }).join('');
      el.rackLayerDetail.innerHTML = `
        <div class="insp-title-row">
          <span class="insp-title">${tier.title}</span>
          ${stageBadge(tier.state)}
        </div>
        <div class="insp-desc">${tier.items.length} parallel NFT ${tier.items.length === 1 ? 'gully' : 'gullies'} (${tier.plants} plants) at 2.0% hydraulic slope. Select a gully or jump to Channel Deep-Dive.</div>
        <div class="insp-metrics">
          ${kvs.map((kv) => `<div class="insp-kv ${kv.cls}"><span class="k mono">${kv.k}</span><span class="v mono">${kv.v}</span></div>`).join('')}
        </div>
        <div class="insp-channel-list">${chChips}</div>`;
    }
  }

  // 4. Panel 2: Per-Gully SCADA Telemetry Table with "Inspect ->" jump to View 4
  const shownGullies = layout.allItems;
  if (el.rackGullyCountBadge) {
    el.rackGullyCountBadge.textContent = layout.racksCount > 1
      ? `BAY · ${shownGullies.length} GULLIES`
      : `${activeRack.label} · ${shownGullies.length} GULLIES`;
  }
  if (el.rackGullyTable) {
    const rowsHtml = shownGullies.map((item) => {
      const stTag = item.state === 'fault'
        ? '<span class="tag crit">FAULT</span>'
        : item.state === 'drifting'
          ? '<span class="tag warn">DRIFT</span>'
          : '<span class="tag ok">OK</span>';
      const isSel = item.chId === selectedRackChannelId ? 'is-selected' : '';
      return `
        <tr class="${isSel}" data-select-gully-row="${item.chId}" data-rack="${item.rackId}" data-layer="${item.tierShortId}">
          <td><b>${item.slotCode}</b> <span class="muted">(${item.chId})</span></td>
          <td>R${item.rackLetter}·T${item.tierIdx + 1}</td>
          <td class="r">${item.flowLMin.toFixed(1)} L/m</td>
          <td class="r">${fmtNum(item.doVal, 2)} mg/L</td>
          <td>${stTag}</td>
          <td class="r"><button class="btn-mini btn-mini-primary mono" data-deepdive-channel="${item.chId}">Inspect →</button></td>
        </tr>`;
    }).join('');
    el.rackGullyTable.innerHTML = `
      <table class="rack-gully-tbl mono">
        <thead>
          <tr><th>Gully</th><th>Tier</th><th class="r">Flow</th><th class="r">Outlet DO</th><th>State</th><th class="r">Deep-Dive</th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }

  // 5. Panel 3: Pumping, Climate & Dosing Skid Summary
  const stocks = session.stocks || {};
  const emptyStocks = ['a', 'b', 'ph'].filter((k) => stocks[k]?.status === 'empty');
  const lowStocks = ['a', 'b', 'ph'].filter((k) => stocks[k]?.status === 'low');
  const totalBayFlow = layout.allItems.reduce((s, x) => s + x.flowLMin, 0);
  if (el.rackSkidBadge) {
    if (flowInferred || emptyStocks.length > 0) {
      el.rackSkidBadge.className = 'tag crit mono';
      el.rackSkidBadge.textContent = 'DEGRADED · ACTION REQ';
    } else if (lowStocks.length > 0 || drifting.size > 0) {
      el.rackSkidBadge.className = 'tag warn mono';
      el.rackSkidBadge.textContent = 'GUARDIAN COMPENSATING';
    } else {
      el.rackSkidBadge.className = 'tag ok mono';
      el.rackSkidBadge.textContent = 'SKID NOMINAL';
    }
  }
  if (el.rackSkidSummary) {
    const pumpCls = flowInferred ? 'is-crit' : '';
    const aerCls = flowInferred ? 'is-warn' : '';
    const hvacCls = openCodes.has('HEAT_STRESS_EVENT') ? 'is-crit' : drifting.has('T_air') ? 'is-warn' : '';
    const doseCls = emptyStocks.length ? 'is-crit' : lowStocks.length ? 'is-warn' : '';
    el.rackSkidSummary.innerHTML = `
      <div class="skid-item ${pumpCls}">
        <span class="skid-k mono">MANIFOLD PUMP (pump-1)</span>
        <span class="skid-v mono">${flowInferred ? 'CAVITATION / LOSS' : `ONLINE · ${fmtNum(totalBayFlow, 1)} L/min`}</span>
        <span class="skid-sub mono">${layout.totalGullies} gullies @ ~${fmtNum(totalBayFlow / Math.max(1, layout.totalGullies), 1)} L/m each</span>
      </div>
      <div class="skid-item ${aerCls}">
        <span class="skid-k mono">VENTURI AERATOR (aer-1)</span>
        <span class="skid-v mono">DO_in ${fmtNum(t.doTank, 2)} mg/L</span>
        <span class="skid-sub mono">Sump O₂ saturation transfer</span>
      </div>
      <div class="skid-item ${hvacCls}">
        <span class="skid-k mono">CANOPY HVAC (fans-1)</span>
        <span class="skid-v mono">${fmtNum(session.readings.T_air ?? 23.5, 1)} °C · ${fmtNum(session.readings.RH ?? 62, 0)}% RH</span>
        <span class="skid-sub mono">LED 16h/8h · VPD ${fmtNum(t.vpd, 2)} kPa</span>
      </div>
      <div class="skid-item ${doseCls}">
        <span class="skid-k mono">PERISTALTIC DOSING SKID</span>
        <span class="skid-v mono">${emptyStocks.length ? `${emptyStocks.map((k) => k.toUpperCase()).join('/')} EMPTY` : `A ${stocks.a?.pct ?? 100}% · B ${stocks.b?.pct ?? 100}% · pH ${stocks.ph?.pct ?? 100}%`}</span>
        <span class="skid-sub mono">PID EC ${fmtNum(t.ec, 2)} mS · pH ${fmtNum(t.ph, 2)}</span>
      </div>`;
  }
}

// --- VIEW 4: Channel Deep-Dive (Axial NFT Profile, Plant Port Inspector & Hydraulics) ---
function renderChannelDeepDive() {
  const { layout, t } = computeBayState();
  const items = layout.allItems;
  if (!items.length) return;

  if (!selectedDeepDiveChannelId || !items.some((x) => x.chId === selectedDeepDiveChannelId)) {
    selectedDeepDiveChannelId = items[0].chId;
  }
  const item = items.find((x) => x.chId === selectedDeepDiveChannelId) || items[0];
  const P = item.ports.length;
  selectedDeepDivePortIdx = clamp(selectedDeepDivePortIdx, 0, P - 1);
  const activePort = item.ports[selectedDeepDivePortIdx] || item.ports[0];

  // Populate channel selector dropdown
  if (el.deepdiveSelect) {
    const optKey = items.map((x) => `${x.chId}:${x.slotCode}`).join('|');
    if (el.deepdiveSelect.dataset.optKey !== optKey) {
      el.deepdiveSelect.dataset.optKey = optKey;
      el.deepdiveSelect.innerHTML = items
        .map((x) => `<option value="${x.chId}">Gully ${x.slotCode} (${x.chId.toUpperCase()}) — ${x.rackLabel} · Tier ${x.tierIdx + 1}</option>`)
        .join('');
    }
    el.deepdiveSelect.value = item.chId;
  }

  if (el.deepdiveTitle) {
    el.deepdiveTitle.textContent = `GULLY ${item.slotCode} (${item.chId.toUpperCase()}) · AXIAL O₂ MASS-TRANSFER & PORT TELEMETRY`;
  }
  if (el.deepdiveBreadcrumb) {
    const stText = item.state === 'fault' ? 'AI FAULT' : item.state === 'drifting' ? 'DRIFTING' : 'NOMINAL';
    el.deepdiveBreadcrumb.className = `badge mono ${item.state === 'fault' ? 'is-crit' : item.state === 'drifting' ? 'is-warn' : ''}`;
    el.deepdiveBreadcrumb.textContent = `${item.rackLabel.toUpperCase()} · TIER ${item.tierIdx + 1} · ${item.sensorId.toUpperCase()} (${stText})`;
  }
  if (el.deepdiveProfileMeta) {
    el.deepdiveProfileMeta.textContent = `SLOPE ${item.slopePct.toFixed(1)}% · ${item.lengthM.toFixed(2)} m · FLOW ${item.flowLMin.toFixed(2)} L/min · ${P} PORTS`;
  }

  // 1. Industrial SCADA Axial Dissolved O2 Mass-Transfer Chart (#svg-channel-cross-section)
  if (el.deepdiveSvg) {
    const pal = RACK_PALETTE[item.state];
    const xL = 56;
    const xR = 724;
    const yT = 28;
    const yB = 148;
    const chartW = xR - xL;
    const chartH = yB - yT;

    const minDo = Math.min(4.0, Math.floor(Math.min(item.doVal, ...item.ports.map((p) => p.localDo)) - 0.6));
    const maxDo = Math.max(9.2, Math.ceil((item.doIn + 0.4) * 2) / 2);
    const mapX = (frac) => +(xL + frac * chartW).toFixed(1);
    const mapY = (v) => +(yB - clamp((v - minDo) / Math.max(0.5, maxDo - minDo), 0, 1) * chartH).toFixed(1);

    // 4 horizontal gridlines
    const gridSteps = [0, 0.333, 0.667, 1].map((f) => {
      const val = minDo + f * (maxDo - minDo);
      const y = mapY(val);
      return `
        <line x1="${xL}" y1="${y}" x2="${xR}" y2="${y}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="2 3"/>
        <text x="${xL - 8}" y="${y + 3}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="9" fill="#64748b">${val.toFixed(1)}</text>`;
    }).join('');

    // Curve points from Inlet (x=0) through P1..PN to Outlet Probe (x=L)
    const allPts = [
      { x: mapX(0), y: mapY(item.doIn) },
      ...item.ports.map((p) => ({ x: mapX(p.frac), y: mapY(p.localDo), p })),
      { x: mapX(1), y: mapY(item.doVal) },
    ];
    const linePath = `M ${allPts.map((pt) => `${pt.x},${pt.y}`).join(' L ')}`;
    const areaPath = `${linePath} L ${xR},${yB} L ${xL},${yB} Z`;
    const ySupply = mapY(item.doIn);
    const yHypoxia = mapY(5.0);

    const portsNodesHtml = item.ports.map((p, idx) => {
      const cx = mapX(p.frac);
      const cy = mapY(p.localDo);
      const isSel = idx === selectedDeepDivePortIdx;
      const dotCol = p.portState === 'crit' ? '#dc2626' : p.portState === 'stress' ? '#d97706' : '#0d9488';
      // Alternate label above/below if ports > 8 so numbers never touch
      const labelY = isSel ? cy - 11 : (P > 8 && idx % 2 === 1 ? cy + 15 : cy - 9);
      return `
        <g class="dd-port-node ${isSel ? 'is-selected' : ''}" data-port-idx="${idx}">
          <title>Port #${p.portNum} (x = ${p.xM} m) · Local DO: ${fmtNum(p.localDo, 2)} mg/L · ΔDO: -${fmtNum(p.doDropFromInlet, 2)} mg/L · Shoot: ${p.shootG} g</title>
          <line x1="${cx}" y1="${yT}" x2="${cx}" y2="${yB}" stroke="${isSel ? '#0f172a' : '#cbd5e1'}" stroke-width="${isSel ? 1.3 : 0.7}" stroke-dasharray="${isSel ? '3 2' : '1 3'}"/>
          <circle cx="${cx}" cy="${cy}" r="${isSel ? 5.5 : 3.8}" fill="${dotCol}" stroke="#ffffff" stroke-width="1.5"/>
          <text x="${cx}" y="${labelY}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="${isSel ? '9.5' : '8.5'}" font-weight="${isSel ? '700' : '600'}" fill="${isSel ? '#0f172a' : dotCol}">${fmtNum(p.localDo, 2)}</text>
          <text x="${cx}" y="${yB + 15}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" font-weight="${isSel ? '700' : '500'}" fill="${isSel ? '#0f172a' : '#475569'}">P${p.portNum}</text>
          <text x="${cx}" y="${yB + 26}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="7.8" fill="#94a3b8">${p.xM}m</text>
        </g>`;
    }).join('');

    el.deepdiveSvg.innerHTML = `
      <rect width="760" height="186" rx="6" fill="#ffffff"/>
      <!-- Header Legend Row (No Overlaps) -->
      <text x="${xL}" y="16" font-family="JetBrains Mono, monospace" font-size="9.5" font-weight="700" fill="#0284c7">INLET SUPPLY DO_in: ${fmtNum(item.doIn, 2)} mg/L (x = 0.00 m)</text>
      <text x="${xR}" y="16" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="9.5" font-weight="700" fill="${pal.stroke}">OUTLET ${item.sensorId.toUpperCase()}: ${fmtNum(item.doVal, 2)} mg/L (x = ${item.lengthM.toFixed(2)} m)</text>

      <!-- Plot Frame & Grid -->
      <rect x="${xL}" y="${yT}" width="${chartW}" height="${chartH}" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>
      ${gridSteps}

      <!-- Tank Supply Reference & Hypoxia Floor -->
      <line x1="${xL}" y1="${ySupply}" x2="${xR}" y2="${ySupply}" stroke="#0284c7" stroke-width="1" stroke-dasharray="4 3" stroke-opacity="0.75"/>
      <line x1="${xL}" y1="${yHypoxia}" x2="${xR}" y2="${yHypoxia}" stroke="#dc2626" stroke-width="1.1" stroke-dasharray="4 3" stroke-opacity="0.75"/>
      <text x="${xR - 6}" y="${Math.max(yT + 10, yHypoxia - 4)}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="8" font-weight="600" fill="#dc2626">HYPOXIA LIMIT 5.0 mg/L</text>

      <!-- Axial DO Area & Curve -->
      <path d="${areaPath}" fill="${pal.waterTop}" fill-opacity="0.28"/>
      <path d="${linePath}" fill="none" stroke="${pal.stroke}" stroke-width="2.2" stroke-linejoin="round"/>

      <!-- Inlet & Outlet Endpoint Markers -->
      <circle cx="${xL}" cy="${ySupply}" r="3.5" fill="#0284c7" stroke="#ffffff" stroke-width="1.2"/>
      <circle cx="${xR}" cy="${mapY(item.doVal)}" r="4" fill="${pal.dot}" stroke="#ffffff" stroke-width="1.2"/>
      <text x="${xL}" y="${yB + 15}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8.5" font-weight="600" fill="#0284c7">IN</text>
      <text x="${xR}" y="${yB + 15}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8.5" font-weight="600" fill="${pal.stroke}">OUT</text>

      <!-- Interactive Port Nodes -->
      ${portsNodesHtml}`;
  }

  // 1B. Port-by-Port Axial Telemetry Table (#deepdive-port-table)
  if (el.deepdivePortTable) {
    const portRows = item.ports.map((p, idx) => {
      const isSel = idx === selectedDeepDivePortIdx ? 'is-active' : '';
      const stBadge = p.portState === 'crit'
        ? '<span class="tag crit">HYPOXIA</span>'
        : p.portState === 'stress'
          ? '<span class="tag warn">DRAW</span>'
          : '<span class="tag ok">NOMINAL</span>';
      return `
        <tr class="${isSel}" data-port-idx="${idx}" style="cursor:pointer">
          <td><b>P${p.portNum}</b></td>
          <td class="r">${p.xM.toFixed(2)} m</td>
          <td class="r"><b>${fmtNum(p.localDo, 2)} mg/L</b></td>
          <td class="r">-${fmtNum(p.doDropFromInlet, 2)} mg/L</td>
          <td class="r">${fmtNum(p.o2UptakeMgH, 2)} mg/h</td>
          <td class="r">${fmtNum(p.shootG, 1)} g</td>
          <td class="r">${fmtNum(p.transpirationMlH, 1)} mL/h</td>
          <td>${stBadge}</td>
        </tr>`;
    }).join('');
    el.deepdivePortTable.innerHTML = `
      <table class="rack-gully-tbl mono">
        <thead>
          <tr>
            <th>Port</th>
            <th class="r">Axial Pos</th>
            <th class="r">Local DO</th>
            <th class="r">ΔDO</th>
            <th class="r">Root O₂ Resp.</th>
            <th class="r">Est. Shoot FW</th>
            <th class="r">Transpiration</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>${portRows}</tbody>
      </table>`;
  }

  // 2. Plant Port Selector Tabs & Inspector Card
  if (el.deepdivePortTabs) {
    el.deepdivePortTabs.innerHTML = item.ports
      .map((p, idx) => `<button data-port-idx="${idx}" class="${idx === selectedDeepDivePortIdx ? 'active' : ''}">P${p.portNum}</button>`)
      .join('');
  }
  if (el.deepdivePortBadge) {
    el.deepdivePortBadge.className = `tag mono ${activePort.portState === 'crit' ? 'crit' : activePort.portState === 'stress' ? 'warn' : 'ok'}`;
    el.deepdivePortBadge.textContent = `PORT #${activePort.portNum} · x = ${activePort.xM}m (${activePort.portState.toUpperCase()})`;
  }
  if (el.deepdivePortCard) {
    const portKvs = [
      { k: 'Local Root-Zone DO', v: `${fmtNum(activePort.localDo, 2)} mg/L`, cls: activePort.portState === 'crit' ? 'is-crit' : activePort.portState === 'stress' ? 'is-warn' : '' },
      { k: 'Cumulative ΔDO from Inlet', v: `-${fmtNum(activePort.doDropFromInlet, 2)} mg/L`, cls: '' },
      { k: 'Root O₂ Respiration', v: `${fmtNum(activePort.o2UptakeMgH, 2)} mg O₂/h`, cls: '' },
      { k: 'Sheet Velocity @ Roots', v: `${fmtNum(item.velocityCmS, 1)} cm/s (${item.filmDepthMm} mm)`, cls: '' },
      { k: 'Est. Shoot Biomass', v: `${fmtNum(activePort.shootG, 1)} g fresh`, cls: '' },
      { k: 'Plant Transpiration', v: `${fmtNum(activePort.transpirationMlH, 1)} mL/h`, cls: '' },
    ];
    const diagText = activePort.portState === 'crit'
      ? `Critical root-zone oxygen depletion at Port #${activePort.portNum} (${fmtNum(activePort.localDo, 2)} mg/L). Downstream roots are experiencing respiration bottleneck due to reduced mass transfer.`
      : activePort.portState === 'stress'
        ? `Moderate axial oxygen drawdown at Port #${activePort.portNum} (${fmtNum(activePort.localDo, 2)} mg/L). Monitor flow rate (${item.flowLMin} L/min) and reservoir aeration.`
        : `Healthy boundary-layer mass transfer at Port #${activePort.portNum}. Sheet velocity (${item.velocityCmS} cm/s) replenishes dissolved O₂ across the root mat.`;
    el.deepdivePortCard.innerHTML = `
      <div class="insp-metrics">
        ${portKvs.map((kv) => `<div class="insp-kv ${kv.cls}"><span class="k mono">${kv.k}</span><span class="v mono">${kv.v}</span></div>`).join('')}
      </div>
      <div class="insp-desc">${diagText}</div>`;
  }

  // 3. Bottom-Left: Channel Hydraulics & Mass Transfer
  if (el.deepdiveFlowRegime) {
    el.deepdiveFlowRegime.className = `tag mono ${item.state === 'fault' ? 'crit' : item.state === 'drifting' ? 'warn' : 'ok'}`;
    el.deepdiveFlowRegime.textContent = item.state === 'fault' ? 'STAGNANT FILM' : 'LAMINAR NFT SHEET';
  }
  if (el.deepdiveHydraulics) {
    const hydKvs = [
      { k: 'Trough Geometry', v: `${item.lengthM.toFixed(1)} m × ${(item.widthM * 100).toFixed(0)} cm @ ${item.slopePct.toFixed(1)}% grade`, cls: '' },
      { k: 'Volumetric Flow (Q_ch)', v: `${item.flowLMin.toFixed(2)} L/min (${Math.round(item.flowLMin * 60)} L/h)`, cls: item.state === 'fault' ? 'is-crit' : '' },
      { k: 'Nutrient Film Thickness', v: `${item.filmDepthMm.toFixed(2)} mm`, cls: '' },
      { k: 'Mean Sheet Velocity', v: `${item.velocityCmS.toFixed(1)} cm/s`, cls: '' },
      { k: 'Hydraulic Residence Time', v: `${item.residenceSec} sec (inlet → outlet)`, cls: '' },
      { k: 'Axial O₂ Depletion (ΔDO)', v: `${fmtNum(item.doIn, 2)} → ${fmtNum(item.doVal, 2)} mg/L (-${fmtNum(item.doDrop, 2)})`, cls: item.state !== 'nominal' ? 'is-warn' : '' },
    ];
    el.deepdiveHydraulics.innerHTML = `
      <div class="insp-metrics">
        ${hydKvs.map((kv) => `<div class="insp-kv ${kv.cls}"><span class="k mono">${kv.k}</span><span class="v mono">${kv.v}</span></div>`).join('')}
      </div>`;
  }

  // 4. Bottom-Middle: Crop Lifecycle & 4-Axis Root-Zone Stress Breakdown
  const stg = stageOf(session.simDays);
  el.timelineStages.forEach((s) => {
    const k = Number(s.dataset.stage);
    s.classList.toggle('current', k === stg.n);
    s.classList.toggle('done', k < stg.n);
  });
  if (el.deepdiveVigorBadge) {
    el.deepdiveVigorBadge.className = `tag mono ${t.fTotal < 0.7 ? 'crit' : t.fTotal < 0.88 ? 'warn' : 'ok'}`;
    el.deepdiveVigorBadge.textContent = `STAGE ${stg.n}/4 · VIGOR ${Math.round(t.fTotal * 100)}%`;
  }
  if (el.deepdiveStressBars) {
    const fDoLocal = clamp((item.doVal - 2.0) / (6.5 - 2.0), 0.1, 1.0);
    const axes = [
      { label: 'Dissolved O₂ Factor (f_DO)', val: fDoLocal },
      { label: 'Acidity Factor (f_pH)', val: t.fPh ?? 0.98 },
      { label: 'Nutrient EC Factor (f_EC)', val: t.fEc ?? 0.96 },
      { label: 'Canopy Temp Factor (f_T)', val: t.fTemp ?? 0.95 },
    ];
    el.deepdiveStressBars.innerHTML = axes.map((ax) => {
      const pct = Math.round(clamp(ax.val, 0, 1) * 100);
      const cls = pct < 68 ? 'is-crit' : pct < 86 ? 'is-warn' : '';
      return `
        <div class="stress-row">
          <div class="stress-top mono"><span>${ax.label}</span><b>${pct}%</b></div>
          <div class="stress-bar"><div class="stress-fill ${cls}" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
  }

  // 5. Bottom-Right: 24h Gully Outlet DO vs Tank Inlet Saturation Chart
  if (el.deepdiveDoMeta) el.deepdiveDoMeta.textContent = item.sensorId.toUpperCase();
  if (el.deepdiveValDoOut) el.deepdiveValDoOut.textContent = `${fmtNum(item.doVal, 2)} mg/L`;
  if (el.deepdiveValDoIn) el.deepdiveValDoIn.textContent = `${fmtNum(item.doIn, 2)} mg/L`;
  if (el.deepdiveValDoDrop) el.deepdiveValDoDrop.textContent = `-${fmtNum(item.doDrop, 2)} mg/L`;
  if (el.deepdiveDoSvg) {
    el.deepdiveDoSvg.setAttribute('viewBox', '0 0 360 155');
    const hist = (session.history || []).slice(-60);
    const vals = hist.length ? hist.map((p) => (p.measured?.DO ?? item.doVal) - (item.globalIdx * 0.03)) : [item.doVal];
    const minV = 3.5;
    const maxV = Math.max(9.5, item.doIn + 0.5);
    const mapY = (v) => 138 - clamp((v - minV) / (maxV - minV), 0, 1) * 116;
    const pts = vals.map((v, idx) => {
      const x = 16 + (idx / Math.max(1, vals.length - 1)) * 328;
      return `${x.toFixed(1)},${mapY(v).toFixed(1)}`;
    });
    const linePath = pts.length > 1 ? `M ${pts.join(' L ')}` : `M 16,${mapY(vals[0]).toFixed(1)} L 344,${mapY(vals[0]).toFixed(1)}`;
    const areaPath = `${linePath} L 344,142 L 16,142 Z`;
    const inY = mapY(item.doIn).toFixed(1);
    const hypY = mapY(5.0).toFixed(1);
    const strokeCol = item.state === 'fault' ? '#dc2626' : item.state === 'drifting' ? '#d97706' : '#0d9488';

    el.deepdiveDoSvg.innerHTML = `
      <rect width="360" height="155" rx="6" fill="#f8fafc"/>
      <line x1="16" y1="${inY}" x2="344" y2="${inY}" stroke="#0284c7" stroke-width="1.2" stroke-dasharray="4 3"/>
      <text x="20" y="${Math.max(12, inY - 4)}" font-family="JetBrains Mono, monospace" font-size="8" fill="#0284c7">TANK INLET DO_in (${fmtNum(item.doIn, 2)} mg/L)</text>
      <line x1="16" y1="${hypY}" x2="344" y2="${hypY}" stroke="#dc2626" stroke-width="1" stroke-dasharray="3 3" stroke-opacity="0.7"/>
      <text x="20" y="${hypY - 4}" font-family="JetBrains Mono, monospace" font-size="8" fill="#dc2626">HYPOXIA THRESHOLD (5.0 mg/L)</text>
      <path d="${areaPath}" fill="${strokeCol}" fill-opacity="0.16"/>
      <path d="${linePath}" fill="none" stroke="${strokeCol}" stroke-width="2.2"/>`;
  }
}

// --- VIEW 5: Judge / Proof & Chaos Fault Injection ---
function formatSigned(v, digits = 3, unit = '') {
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${Number(v).toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

function renderProofTable() {
  const rd = session.readings;
  const gt = session.gt || {};
  const res = session.residuals || {};
  const diag = session.getDiagnosticStage();
  const openCodes = new Set(session.getAlertSummary().open.map((a) => a.code));

  const rows = [
    {
      name: 'EC probe',
      id: 'sen-ec-1',
      sensorText: rd.EC != null ? `${fmtNum(rd.EC, 2)} mS/cm` : '—',
      truthText: gt.ec25_ds_m != null ? `${fmtNum(gt.ec25_ds_m, 2)} mS/cm` : '—',
      residual: res.EC?.residual ?? null,
      digits: 3,
      unit: 'mS/cm',
      bad: openCodes.has('NUTRIENT_MIX_ANOMALY') || openCodes.has('NUTRIENT_IMBALANCE') ||
        (res.EC?.residual != null && res.EC.residual > res.EC.threshold),
      alertText: 'CONCENTRATION ANOMALY',
    },
    {
      name: 'pH probe',
      id: 'sen-ph-1',
      sensorText: rd.pH != null ? `${fmtNum(rd.pH, 2)} pH` : '—',
      truthText: gt.ph != null ? `${fmtNum(gt.ph, 2)} pH` : '—',
      residual: res.pH?.residual ?? null,
      digits: 3,
      unit: 'pH',
      bad: openCodes.has('PH_PROBE_DRIFT_SUSPECTED') ||
        (res.pH?.residual != null && res.pH.residual > res.pH.threshold),
      alertText: 'ELECTRODE DRIFT',
    },
    {
      name: 'Outlet DO probe',
      id: 'sen-do-1',
      sensorText: rd.DO != null ? `${fmtNum(rd.DO, 2)} mg/L` : '—',
      truthText: gt.c_do_ch_out_mg_l != null ? `${fmtNum(gt.c_do_ch_out_mg_l, 2)} mg/L` : '—',
      residual: res.DO?.residual ?? null,
      digits: 3,
      unit: 'mg/L',
      bad: openCodes.has('IMPLIED_PUMP_OR_AERATION_FAULT') ||
        (res.DO?.residual != null && -res.DO.residual > res.DO.threshold),
      alertText: 'FLOW / AERATION FAULT',
    },
    {
      name: 'Air Temp probe',
      id: 'sen-tair-1',
      sensorText: rd.T_air != null ? `${fmtNum(rd.T_air, 1)} °C` : '—',
      truthText: gt.t_air_c != null ? `${fmtNum(gt.t_air_c, 1)} °C` : '—',
      residual: res.T_air?.residual ?? null,
      digits: 2,
      unit: '°C',
      bad: openCodes.has('HEAT_STRESS_EVENT') ||
        (res.T_air?.residual != null && res.T_air.residual > res.T_air.threshold),
      alertText: 'HEAT STRESS',
    },
    {
      name: 'Reservoir level',
      id: 'sen-vres-1',
      sensorText: rd.V_res != null
        ? `${fmtNum(rd.V_res, 1)} L${res.V_res?.measured != null ? ` (${fmtNum(res.V_res.measured, 2)} L/h)` : ''}`
        : '—',
      truthText: gt.v_res_l != null ? `${fmtNum(gt.v_res_l, 1)} L (≤0.15 L/h)` : '—',
      residual: res.V_res?.residual ?? null,
      digits: 2,
      unit: 'L/h',
      bad: openCodes.has('RESERVOIR_LEAK_SUSPECTED') ||
        (res.V_res?.residual != null && -res.V_res.residual > res.V_res.threshold),
      alertText: 'LEAK SUSPECTED',
    },
  ];

  el.proofBody.innerHTML = rows
    .map((r) => `
      <tr>
        <td class="tgt">${r.name}<span class="mono">${r.id}</span></td>
        <td class="mono r">${r.sensorText}</td>
        <td class="mono r">${r.truthText}</td>
        <td class="mono r">${formatSigned(r.residual, r.digits, r.unit)}</td>
        <td><span class="tag ${r.bad ? 'bad' : 'ok'}">${r.bad ? r.alertText : 'NOMINAL'}</span></td>
      </tr>`)
    .join('');

  // Render Chaos Fault Injection & God-Mode Timeline on Judge / Proof View
  const activeTruthKinds = new Set((session.activeFaults || []).map((f) => f.kind));
  el.rackQuickFaults?.querySelectorAll('[data-quick-fault]').forEach((btn) => {
    const on = activeTruthKinds.has(btn.dataset.quickFault);
    btn.classList.toggle('is-injected', on);
    let tag = btn.querySelector('.qf-tag');
    if (on && !tag) {
      tag = document.createElement('span');
      tag.className = 'qf-tag';
      tag.textContent = 'ON';
      btn.appendChild(tag);
    } else if (!on && tag) {
      tag.remove();
    }
  });
  if (el.btnRackClearFaults) el.btnRackClearFaults.disabled = activeTruthKinds.size === 0;

  const events = session.timelineEvents || [];
  if (el.rackLatencyBadge) {
    const latestAi = [...events].reverse().find((e) => e.latencySec != null);
    if (latestAi) {
      const h = Math.floor(latestAi.latencySec / 3600);
      const m = Math.floor((latestAi.latencySec % 3600) / 60);
      el.rackLatencyBadge.textContent = `LAST LAG +${h}h ${String(m).padStart(2, '0')}m`;
      el.rackLatencyBadge.className = 'tag crit mono';
    } else if (activeTruthKinds.size > 0 && diag.stage === 'nominal') {
      el.rackLatencyBadge.textContent = 'HIDDEN · AWAITING DRIFT';
      el.rackLatencyBadge.className = 'tag warn mono';
    } else if (diag.stage === 'drifting') {
      el.rackLatencyBadge.textContent = 'DRIFT SPOTTED · CONFIRMING';
      el.rackLatencyBadge.className = 'tag warn mono';
    } else {
      el.rackLatencyBadge.textContent = 'DECOUPLED · SYNCED';
      el.rackLatencyBadge.className = 'tag ok mono';
    }
  }

  if (el.rackTruthTimeline) {
    if (!events.length) {
      el.rackTruthTimeline.innerHTML =
        '<div class="god-empty">No events yet. Inject a hidden fault above to watch the time-lag between physical ground-truth injection, sensor drift, and AI/Guardian confirmation.</div>';
    } else {
      el.rackTruthTimeline.innerHTML = [...events].reverse().map((e) => {
        const cls = e.kind === 'truth'
          ? 'is-truth'
          : e.kind === 'drift'
            ? 'is-drift'
            : e.kind === 'farmer'
              ? (e.tag === 'TOP UP' ? 'is-recovered' : 'is-farmer')
              : e.tag === 'RECOVERED'
                ? 'is-recovered'
                : 'is-ai';
        return `
          <div class="god-entry ${cls}">
            <div class="god-top">
              <span class="god-tag mono">[${e.tag}]</span>
              <span class="god-time mono">${fmtSimTime(e.simTimeSec)}</span>
            </div>
            <div class="god-text">${e.text}</div>
          </div>`;
      }).join('');
    }
  }
}

// --- Modals ---
function updateLayoutModalSummary(syncTotalFromTopology = false) {
  const racks = parseInt(el.sliderRacks?.value || '1', 10);
  const tiers = parseInt(el.sliderTiers?.value || '2', 10);
  const gulliesPerTier = parseInt(el.sliderGulliesPerTier?.value || '1', 10);
  const plants = parseInt(el.sliderPlants?.value || '8', 10);
  if (el.valRacks) el.valRacks.textContent = `${racks} ${racks === 1 ? 'Rack' : 'Racks'}`;
  if (el.valTiers) el.valTiers.textContent = `${tiers} ${tiers === 1 ? 'Tier' : 'Tiers'}`;
  if (el.valGulliesPerTier) el.valGulliesPerTier.textContent = `${gulliesPerTier} ${gulliesPerTier === 1 ? 'Gully' : 'Gullies'}`;
  if (syncTotalFromTopology && el.sliderChannels) {
    const computed = racks * tiers * gulliesPerTier;
    el.sliderChannels.value = String(computed);
    if (el.sliderVolume) {
      const recVol = Math.min(500, Math.max(100, Math.round((computed * 25) / 10) * 10));
      el.sliderVolume.value = String(recVol);
      if (el.valVolume) el.valVolume.textContent = `${recVol} L`;
    }
    if (el.sliderFlow) {
      const recFlow = Math.min(20, Math.max(3.0, +(computed * 1.5).toFixed(1)));
      el.sliderFlow.value = String(recFlow);
      if (el.valFlow) el.valFlow.textContent = `${recFlow.toFixed(1)} L/min`;
    }
  }
  const totalGullies = parseInt(el.sliderChannels?.value || String(racks * tiers * gulliesPerTier), 10);
  if (el.valChannels) el.valChannels.textContent = String(totalGullies);
  if (el.valPlants) el.valPlants.textContent = String(plants);
  if (el.valBaySummary) {
    el.valBaySummary.textContent = `${racks} ${racks === 1 ? 'Rack' : 'Racks'} × ${tiers} ${tiers === 1 ? 'Tier' : 'Tiers'} × ${gulliesPerTier} ${gulliesPerTier === 1 ? 'Gully' : 'Gullies'} = ${totalGullies} Gullies (${totalGullies * plants} Plants)`;
  }
}

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
      showBanner('error', formatApiError(err, 'Inject fault'));
    } finally {
      el.btnInject.disabled = false;
    }
  });

  el.btnClearAllFaults.addEventListener('click', async () => {
    try {
      await session.clearAllFaults();
      renderActiveFaults();
    } catch (err) {
      showBanner('error', formatApiError(err, 'Clear faults'));
    }
  });

  el.activeFaultsList.addEventListener('click', async (e) => {
    const kind = e.target.closest('[data-clear]')?.dataset.clear;
    if (!kind) return;
    try {
      await session.clearFault(kind);
      renderActiveFaults();
    } catch (err) {
      showBanner('error', formatApiError(err, 'Clear fault'));
    }
  });

  el.btnOpenLayout?.addEventListener('click', openLayoutModal);
  const closeLayout = () => {
    el.modalLayout.classList.remove('open');
    el.seasonPicker.value = currentPreset.presetId || 'exp2';
  };
  el.modalLayoutClose.addEventListener('click', closeLayout);
  el.modalLayoutCancel.addEventListener('click', closeLayout);

  el.sliderRacks?.addEventListener('input', () => updateLayoutModalSummary(true));
  el.sliderTiers?.addEventListener('input', () => updateLayoutModalSummary(true));
  el.sliderGulliesPerTier?.addEventListener('input', () => updateLayoutModalSummary(true));
  el.sliderChannels.addEventListener('input', () => updateLayoutModalSummary(false));
  el.sliderPlants.addEventListener('input', () => updateLayoutModalSummary(false));
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
  const d = session.design || currentPreset;
  const resolved = resolveBayLayout(d, session.spec?.channels);
  if (el.sliderRacks) el.sliderRacks.value = String(resolved.racksCount);
  if (el.sliderTiers) el.sliderTiers.value = String(resolved.tiersPerRack);
  if (el.sliderGulliesPerTier) el.sliderGulliesPerTier.value = String(resolved.gulliesPerTier);
  el.sliderChannels.value = String(d.channels.count);
  el.sliderPlants.value = String(d.channels.plantsPerChannel);
  el.sliderVolume.value = String(d.reservoir.volumeL);
  el.valVolume.textContent = `${d.reservoir.volumeL} L`;
  el.sliderFlow.value = String(d.pump.flowLMin);
  el.valFlow.textContent = `${Number(d.pump.flowLMin).toFixed(1)} L/min`;
  updateLayoutModalSummary(false);
  el.modalLayout.classList.add('open');
}

async function applyCustomLayout() {
  const racks = parseInt(el.sliderRacks?.value || '1', 10);
  const tiersPerRack = parseInt(el.sliderTiers?.value || '2', 10);
  const gulliesPerTier = parseInt(el.sliderGulliesPerTier?.value || '1', 10);
  const count = parseInt(el.sliderChannels.value, 10);
  const plants = parseInt(el.sliderPlants.value, 10);
  const design = cloneDesign(session.design || currentPreset);
  design.presetId = 'custom-active';
  design.channels.racks = racks;
  design.channels.tiersPerRack = tiersPerRack;
  design.channels.gulliesPerTier = gulliesPerTier;
  design.channels.count = count;
  design.channels.plantsPerChannel = plants;
  design.reservoir.volumeL = parseFloat(el.sliderVolume.value);
  design.pump.flowLMin = parseFloat(el.sliderFlow.value);
  design.name = `Custom Bay (${racks}R×${tiersPerRack}T, ${count} gullies, ${count * plants} plants)`;

  let opt = el.seasonPicker.querySelector('option[value="custom-active"]');
  if (!opt) {
    opt = document.createElement('option');
    opt.value = 'custom-active';
    el.seasonPicker.insertBefore(opt, el.seasonPicker.querySelector('option[value="custom"]'));
  }
  opt.textContent = `Custom · ${racks}R×${tiersPerRack}T · ${count}×${plants} (${design.reservoir.volumeL} L)`;
  el.seasonPicker.value = 'custom-active';

  selectedRackView = 'rack-1';
  selectedRackId = 'rack-1';
  el.modalLayout.classList.remove('open');
  await loadPreset(design);
}

init();

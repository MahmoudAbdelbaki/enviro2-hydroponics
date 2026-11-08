import { createApi } from './api/client.js';
import { TwinSession } from './sim/session.js';
import { PRESETS, getPreset, cloneDesign, buildFarmSpec, plantCount } from './domain/presets.js';
import { FAULTS, FAULT_BY_KIND } from './domain/faults.js';
import { doSatBensonKrause } from './sim/autopilot.js';

// --- API & Twin Session Initializer ---
const api = createApi({ baseUrl: '' });
const session = new TwinSession(api);
window.session = session;
window.api = api;

// --- Application State ---
let currentPreset = getPreset('exp2');
let activeView = 'farm-status';
let isSpeed10x = false;
let selectedFault = FAULTS[0];
let activeDosingTimeouts = {};
let activeAlertTab = 'open';
let selectedVitalityMetric = 'DO';
let selectedDosingTimeframe = '24h';

// Total cumulative doses for stock levels calculation
let cumulativeDoses = { a: 0, b: 0, acid: 0, base: 0, water: 0 };
let lastDoseAmounts = { a: 0, b: 0, acid: 0, base: 0, water: 0 };

// View Titles & Subtitles Dictionary
const VIEW_METADATA = {
  'farm-status': {
    title: 'Farm Status',
    subtitle: 'Executive Telemetry, Dosing Pill Gauges & Real-Time Splines',
  },
  'gully-matrix': {
    title: 'Gully Matrix & Layout Builder',
    subtitle: '2D Matrix Grid (A..D × 1..3) & Topology Editor',
  },
  'isometric-rack': {
    title: '2.5D Isometric Rack Overview',
    subtitle: 'Angled Gully Parallelograms & Floating Alert Pins',
  },
  'channel-deepdive': {
    title: 'Column B1 Overview',
    subtitle: '2.5D Sprout Plane, 4-Stage Growth Lifecycle & DO Gradient',
  },
  'judge-proof': {
    title: 'Judge / Proof View',
    subtitle: 'Sensor Readings vs. Conserved Physics Ground Truth & PLC Safety Ledger',
  },
};

// --- DOM Elements Cache ---
const el = {
  // Navigation
  railBtns: document.querySelectorAll('.rail-btn'),
  viewTitle: document.getElementById('header-view-title'),
  viewSubtitle: document.getElementById('header-view-subtitle'),
  views: document.querySelectorAll('.workspace-view'),

  // Header Time & Controls
  seasonPicker: document.getElementById('season-picker'),
  simClockTime: document.getElementById('sim-clock-time'),
  btnPlayPause: document.getElementById('btn-play-pause'),
  btnPlayIcon: document.getElementById('btn-play-icon'),
  btnPlayLabel: document.getElementById('btn-play-label'),
  btnSpeedToggle: document.getElementById('btn-speed-toggle'),
  btnSpeedLabel: document.getElementById('btn-speed-label'),
  btnStepDay: document.getElementById('btn-step-day'),

  // Right Quick Details Inspector
  chipActivePreset: document.getElementById('chip-active-preset'),
  alertCountCritical: document.getElementById('alert-count-critical'),
  alertHeadlineCritical: document.getElementById('alert-headline-critical'),
  alertCountWarning: document.getElementById('alert-count-warning'),
  alertHeadlineWarning: document.getElementById('alert-headline-warning'),
  alertCountInfo: document.getElementById('alert-count-info'),
  alertHeadlineInfo: document.getElementById('alert-headline-info'),

  infoSimId: document.getElementById('info-sim-id'),
  infoFarmPreset: document.getElementById('info-farm-preset'),
  infoAutopilotStatus: document.getElementById('info-autopilot-status'),
  infoPlcStatus: document.getElementById('info-plc-status'),

  harvestProgressCircle: document.getElementById('harvest-progress-circle'),
  plantsTotalCount: document.getElementById('plants-total-count'),
  harvestDayEta: document.getElementById('harvest-day-eta'),
  growthStageTag: document.getElementById('growth-stage-tag'),

  liveEc: document.getElementById('live-ec'),
  livePh: document.getElementById('live-ph'),
  liveDoTank: document.getElementById('live-do-tank'),
  liveDoOutlet: document.getElementById('live-do-outlet'),
  liveFlow: document.getElementById('live-flow'),
  liveVpd: document.getElementById('live-vpd'),

  btnOpenChallenge: document.getElementById('btn-open-challenge'),

  // Farm Status: Capacity & Harvest Donut
  donutActiveGullies: document.getElementById('donut-active-gullies'),
  donutPortsFilled: document.getElementById('donut-ports-filled'),
  donutBiomassTarget: document.getElementById('donut-biomass-target'),
  harvestDonutProgress: document.getElementById('harvest-donut-progress'),
  donutCenterPct: document.getElementById('donut-center-pct'),
  donutCenterGrams: document.getElementById('donut-center-grams'),
  legendHealthyCount: document.getElementById('legend-healthy-count'),
  legendStressedCount: document.getElementById('legend-stressed-count'),

  // Farm Status: 4 Vertical Column Pill Gauges
  trackStockA: document.getElementById('track-stock-a'),
  trackStockB: document.getElementById('track-stock-b'),
  trackStockPh: document.getElementById('track-stock-ph'),
  trackWaterTank: document.getElementById('track-water-tank'),
  fillVerticalStockA: document.getElementById('fill-vertical-stock-a'),
  fillVerticalStockB: document.getElementById('fill-vertical-stock-b'),
  fillVerticalStockPh: document.getElementById('fill-vertical-stock-ph'),
  fillVerticalWaterTank: document.getElementById('fill-vertical-water-tank'),
  pctVerticalStockA: document.getElementById('pct-vertical-stock-a'),
  pctVerticalStockB: document.getElementById('pct-vertical-stock-b'),
  pctVerticalStockPh: document.getElementById('pct-vertical-stock-ph'),
  pctVerticalWaterTank: document.getElementById('pct-vertical-water-tank'),
  badgeVerticalStockA: document.getElementById('badge-vertical-stock-a'),
  badgeVerticalStockB: document.getElementById('badge-vertical-stock-b'),
  badgeVerticalStockPh: document.getElementById('badge-vertical-stock-ph'),
  badgeVerticalWaterTank: document.getElementById('badge-vertical-water-tank'),
  calloutStockA: document.getElementById('callout-stock-a'),
  calloutStockB: document.getElementById('callout-stock-b'),
  calloutStockPh: document.getElementById('callout-stock-ph'),
  calloutWaterTank: document.getElementById('callout-water-tank'),

  // Farm Status: Recent Alerts Card & Filter Tabs
  alertFilterTabs: document.querySelectorAll('.alert-tab'),
  alertsFeedContainer: document.getElementById('alerts-feed-container'),

  // Farm Status: Activity Bar Chart & Vitalities Spline
  dosingTimeframeSelect: document.getElementById('dosing-timeframe-select'),
  svgDosingBarChart: document.getElementById('svg-dosing-bar-chart'),
  vitalityMetricSelect: document.getElementById('vitality-metric-select'),
  labelVitalityLine1: document.getElementById('label-vitality-line1'),
  valVitalityLine1: document.getElementById('val-vitality-line1'),
  labelVitalityLine2: document.getElementById('label-vitality-line2'),
  valVitalityLine2: document.getElementById('val-vitality-line2'),
  vitalityAreaLine1: document.getElementById('vitality-area-line1'),
  vitalityAreaLine2: document.getElementById('vitality-area-line2'),
  vitalityStrokeLine1: document.getElementById('vitality-stroke-line1'),
  vitalityStrokeLine2: document.getElementById('vitality-stroke-line2'),

  // Farm Status: AI Autopilot & PLC Safety Ledger
  ledgerStatsSubtext: document.getElementById('ledger-stats-subtext'),
  ledgerTableBody: document.getElementById('ledger-table-body'),

  // Gully Matrix & 2.5D
  matrixGridContainer: document.getElementById('matrix-grid-container'),
  svgIsometricRack: document.getElementById('svg-isometric-rack'),
  proofTableBody: document.getElementById('proof-table-body'),

  // Modals
  modalChallengeBackdrop: document.getElementById('modal-challenge-backdrop'),
  modalChallengeClose: document.getElementById('modal-challenge-close'),
  modalChallengeCancel: document.getElementById('modal-challenge-cancel'),
  btnInjectSelectedFault: document.getElementById('btn-inject-selected-fault'),
  modalActiveFaultsList: document.getElementById('modal-active-faults-list'),
  btnClearAllFaults: document.getElementById('btn-clear-all-faults'),
  faultOptionBtns: document.querySelectorAll('.fault-option-btn'),

  btnOpenLayoutModal: document.getElementById('btn-open-layout-modal'),
  modalLayoutBackdrop: document.getElementById('modal-layout-backdrop'),
  modalLayoutClose: document.getElementById('modal-layout-close'),
  modalLayoutCancel: document.getElementById('modal-layout-cancel'),
  btnApplyCustomFarm: document.getElementById('btn-apply-custom-farm'),
  sliderChannelCount: document.getElementById('slider-channel-count'),
  sliderPlantsPerChannel: document.getElementById('slider-plants-per-channel'),
  sliderTankVolume: document.getElementById('slider-tank-volume'),
  sliderPumpFlow: document.getElementById('slider-pump-flow'),
  valChannelCount: document.getElementById('val-channel-count'),
  valPlantsPerChannel: document.getElementById('val-plants-per-channel'),
  valTankVolume: document.getElementById('val-tank-volume'),
  valPumpFlow: document.getElementById('val-pump-flow'),
};

// --- Initialization ---
async function init() {
  bindNavigationEvents();
  bindControlEvents();
  bindModalEvents();
  bindSessionEvents();

  // Load default Egyptian preset EXP.2
  await loadPreset(currentPreset);
}

// --- Navigation & View Switching ---
function bindNavigationEvents() {
  el.railBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const viewKey = btn.dataset.view;
      switchView(viewKey);
    });
  });

  // Logo click returns to Farm Status
  document.getElementById('brand-logo')?.addEventListener('click', () => {
    switchView('farm-status');
  });
}

function switchView(viewKey) {
  if (!VIEW_METADATA[viewKey]) return;
  activeView = viewKey;

  // Update Rail active classes
  el.railBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewKey);
  });

  // Update Workspace Header Titles
  el.viewTitle.textContent = VIEW_METADATA[viewKey].title;
  el.viewSubtitle.textContent = VIEW_METADATA[viewKey].subtitle;

  // Update Active View Panel
  el.views.forEach((v) => {
    v.classList.toggle('active-view', v.id === `view-${viewKey}`);
  });

  // Trigger view-specific render
  if (viewKey === 'gully-matrix') renderGullyMatrix();
  if (viewKey === 'isometric-rack') renderIsometricRack();
  if (viewKey === 'judge-proof') renderProofTable();
}

// --- Simulation Controls & Header Events ---
function bindControlEvents() {
  // Season Picker
  el.seasonPicker.addEventListener('change', async (e) => {
    const val = e.target.value;
    if (val === 'custom') {
      openCustomLayoutModal();
    } else {
      const p = getPreset(val);
      if (p) {
        currentPreset = p;
        await loadPreset(p);
      }
    }
  });

  // Play / Pause Toggle
  el.btnPlayPause.addEventListener('click', () => {
    if (session.playing) {
      session.pause();
    } else {
      session.play();
    }
    updatePlayPauseUI();
  });

  // 1x / 10x Speed Toggle
  el.btnSpeedToggle.addEventListener('click', () => {
    isSpeed10x = !isSpeed10x;
    session.setSpeed(isSpeed10x ? '10x' : '1x');
    el.btnSpeedLabel.textContent = isSpeed10x ? '10x' : '1x';
    el.btnSpeedToggle.classList.toggle('active', isSpeed10x);
  });

  // +1 Day Step
  el.btnStepDay.addEventListener('click', async () => {
    el.btnStepDay.disabled = true;
    el.btnStepDay.style.opacity = '0.6';
    try {
      await session.advanceDay();
    } finally {
      el.btnStepDay.disabled = false;
      el.btnStepDay.style.opacity = '1';
    }
  });

  // Copy Sim ID
  el.infoSimId.addEventListener('click', () => {
    if (session.simId) {
      navigator.clipboard.writeText(session.simId);
      const original = el.infoSimId.textContent;
      el.infoSimId.textContent = 'Copied!';
      setTimeout(() => { el.infoSimId.textContent = original; }, 1200);
    }
  });

  // Recent Alerts Filter Tabs
  el.alertFilterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      el.alertFilterTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      activeAlertTab = tab.dataset.tab;
      updateRecentAlertsCard();
    });
  });

  // Timeframe dropdown for Activity Bar Chart
  el.dosingTimeframeSelect?.addEventListener('change', (e) => {
    selectedDosingTimeframe = e.target.value;
    renderDosingBarChart();
  });

  // Metric selector dropdown for Vitalities Area Spline Chart
  el.vitalityMetricSelect?.addEventListener('change', (e) => {
    selectedVitalityMetric = e.target.value;
    renderVitalitiesAreaSpline();
  });
}

function updatePlayPauseUI() {
  if (session.playing) {
    el.btnPlayIcon.textContent = '⏸';
    el.btnPlayLabel.textContent = 'Pause';
    el.btnPlayPause.classList.add('active');
  } else {
    el.btnPlayIcon.textContent = '▶';
    el.btnPlayLabel.textContent = 'Play';
    el.btnPlayPause.classList.remove('active');
  }
}

// --- Preset Loading ---
async function loadPreset(preset) {
  try {
    session.pause();
    updatePlayPauseUI();
    el.chipActivePreset.textContent = preset.presetId.toUpperCase();
    el.infoFarmPreset.textContent = preset.title;

    await session.start(preset);
    updateAllUI();
  } catch (err) {
    console.error('Failed to start farm simulation:', err);
  }
}

// --- Twin Session Event Handlers ---
function bindSessionEvents() {
  session.on('update', () => updateAllUI());
  session.on('started', () => updateAllUI());
  session.on('dose', (cmd) => onDoseActuated(cmd));
  session.on('rejected', (rec) => onDoseRejected(rec));
  session.on('fault', () => updateAllUI());
  session.on('harvest', () => {
    updatePlayPauseUI();
    alert(`🎉 Season Complete! Crop reached target harvest maturity on Day ${Math.round(session.simDays)}.`);
  });
}

// --- Dosing Skid Live Animations & Cumulative Tracker ---
function onDoseActuated(cmd) {
  if (cmd.dose_stock_a_ml) {
    cumulativeDoses.a += cmd.dose_stock_a_ml;
    lastDoseAmounts.a = cmd.dose_stock_a_ml;
    triggerVerticalPillPulse('a', cmd.dose_stock_a_ml);
  }
  if (cmd.dose_stock_b_ml) {
    cumulativeDoses.b += cmd.dose_stock_b_ml;
    lastDoseAmounts.b = cmd.dose_stock_b_ml;
    triggerVerticalPillPulse('b', cmd.dose_stock_b_ml);
  }
  if (cmd.dose_acid_ml) {
    cumulativeDoses.acid += cmd.dose_acid_ml;
    lastDoseAmounts.acid = cmd.dose_acid_ml;
    triggerVerticalPillPulse('acid', cmd.dose_acid_ml);
  }
  if (cmd.dose_base_ml) {
    cumulativeDoses.base += cmd.dose_base_ml;
    lastDoseAmounts.base = cmd.dose_base_ml;
    triggerVerticalPillPulse('base', cmd.dose_base_ml);
  }
  if (cmd.refill_water_l) {
    cumulativeDoses.water += cmd.refill_water_l;
    lastDoseAmounts.water = cmd.refill_water_l;
    triggerVerticalPillPulse('water', cmd.refill_water_l);
  }

  updateVerticalPillGauges();
  renderDosingBarChart();
}

function triggerVerticalPillPulse(stockKey, amount) {
  const map = {
    a: { track: el.trackStockA, callout: el.calloutStockA, msg: `🤖 AI Dosed +${amount.toFixed(1)} mL` },
    b: { track: el.trackStockB, callout: el.calloutStockB, msg: `🤖 AI Dosed +${amount.toFixed(1)} mL` },
    acid: { track: el.trackStockPh, callout: el.calloutStockPh, msg: `🤖 AI Dosed +${amount.toFixed(1)} mL` },
    base: { track: el.trackStockPh, callout: el.calloutStockPh, msg: `🤖 AI Dosed +${amount.toFixed(1)} mL` },
    water: { track: el.trackWaterTank, callout: el.calloutWaterTank, msg: `🤖 AI Refilled +${amount.toFixed(1)} L` },
  };

  const target = map[stockKey];
  if (!target || !target.track) return;

  target.track.classList.add('pulsing');
  if (target.callout) {
    target.callout.textContent = target.msg;
    target.callout.classList.add('active');
  }

  clearTimeout(activeDosingTimeouts[stockKey]);
  activeDosingTimeouts[stockKey] = setTimeout(() => {
    target.track.classList.remove('pulsing');
    if (target.callout) target.callout.classList.remove('active');
  }, 3500);
}

function onDoseRejected(rec) {
  console.warn('PLC Guardian blocked unsafe command:', rec);
}

// --- Main UI Updater ---
function updateAllUI() {
  const simSec = session.status?.sim_time_sec || 0;
  const simDays = session.simDays;
  const seasonDays = session.seasonDays;

  // 1. Header Clock Time Bar (Day X of 30 · HH:MM)
  const dayNum = Math.floor(simDays);
  const hourNum = Math.floor((simSec % 86400) / 3600);
  const minNum = Math.floor((simSec % 3600) / 60);
  const hh = String(hourNum).padStart(2, '0');
  const mm = String(minNum).padStart(2, '0');
  el.simClockTime.textContent = `Day ${dayNum} of ${seasonDays} · ${hh}:${mm}`;

  // 2. Quick Details: Active Controller & Season Info
  el.infoSimId.textContent = session.simId ? `sim-${session.simId.slice(0, 8)}...` : 'Connecting...';
  const rejectedCount = session.commands.filter((c) => c.status !== 'accepted').length;
  el.infoPlcStatus.textContent = rejectedCount === 0 ? 'Armed (100% Verified)' : `Blocked ${rejectedCount} Unsafe Actions`;

  // 3. Quick Details: Plants & Harvest Readiness (Circular SVG Ring)
  const totalPlants = plantCount(session.design || currentPreset);
  el.plantsTotalCount.textContent = `Lettuce: ${totalPlants} plants`;
  const remainingDays = Math.max(0, Math.ceil(seasonDays - simDays));
  el.harvestDayEta.textContent = remainingDays === 0 ? 'Harvest Ready Today!' : `Nearest harvest: Day ${seasonDays} (${remainingDays}d)`;

  // Stage name
  let stageName = 'Stage 1 · Germination';
  if (simDays >= 6) stageName = 'Stage 2 · Seedling';
  if (simDays >= 14) stageName = 'Stage 3 · Vegetative Growth';
  if (simDays >= 25) stageName = 'Stage 4 · Canopy Expansion';
  el.growthStageTag.textContent = stageName;

  // SVG Progress Ring (circumference = 163.36)
  const circ = 163.36;
  const fraction = Math.min(1.0, Math.max(0, simDays / seasonDays));
  el.harvestProgressCircle.style.strokeDashoffset = String(circ * (1.0 - fraction));

  // 4. Telemetry Readings
  const rd = session.readings;
  const gt = session.gt || {};

  const ecVal = rd.EC ?? gt.ec25_ds_m ?? 2.0;
  const phVal = rd.pH ?? gt.ph ?? 5.95;
  const doTankVal = gt.c_do_res_mg_l ?? 7.9;
  const doOutletVal = rd.DO ?? gt.c_do_ch_out_mg_l ?? 6.8;
  const tAirVal = rd.T_air ?? 23.4;
  const rhVal = rd.RH ?? 64.0;
  const tWaterVal = rd.T_w ?? (gt.t_w_k ? gt.t_w_k - 273.15 : 21.2);

  // Calculate VPD in kPa
  const es = 0.61078 * Math.exp((17.27 * tAirVal) / (tAirVal + 237.3));
  const ea = es * (rhVal / 100.0);
  const vpdVal = Math.max(0.1, es - ea);

  // Rated flow
  const flowVal = session.spec?.pump?.rated_flow_l_min ?? 3.0;

  // Update Quick Details Telemetry Table
  el.liveEc.textContent = `${ecVal.toFixed(2)} mS/cm`;
  el.livePh.textContent = phVal.toFixed(2);
  el.liveDoTank.textContent = `${doTankVal.toFixed(1)} mg/L`;
  el.liveDoOutlet.textContent = `${doOutletVal.toFixed(1)} mg/L`;
  el.liveFlow.textContent = `${flowVal.toFixed(1)} L/min`;
  el.liveVpd.textContent = `${vpdVal.toFixed(2)} kPa`;

  // 5. Update Quick Details Alerts Summary
  updateAlertsSummary();

  // 6. Farm Status (View 1) Dedicated Updaters
  updateCapacityHarvestDonut();
  updateVerticalPillGauges();
  updateRecentAlertsCard();
  renderDosingBarChart();
  renderVitalitiesAreaSpline();
  renderSafetyLedgerTable();

  // 7. Update Other Workspace Views if active
  if (activeView === 'gully-matrix') renderGullyMatrix();
  if (activeView === 'isometric-rack') renderIsometricRack();
  if (activeView === 'judge-proof') renderProofTable();
}

// --- Alerts Summary Block Updater (Quick Details) ---
function updateAlertsSummary() {
  const alerts = session.alerts || [];

  const criticals = alerts.filter((a) => a.severity === 'critical');
  const warnings = alerts.filter((a) => a.severity === 'warning');
  const infos = alerts.filter((a) => a.severity === 'info' || !a.severity);

  // Critical Row
  el.alertCountCritical.textContent = criticals.length;
  if (criticals.length > 0) {
    const latest = criticals[criticals.length - 1];
    el.alertHeadlineCritical.textContent = `${latest.component_id || 'Hardware'}: ${latest.message}`;
    el.alertHeadlineCritical.style.color = 'var(--status-critical)';
  } else {
    el.alertHeadlineCritical.textContent = 'No active hardware failures';
    el.alertHeadlineCritical.style.color = 'var(--text-secondary)';
  }

  // Warning Row
  el.alertCountWarning.textContent = warnings.length;
  if (warnings.length > 0) {
    const latest = warnings[warnings.length - 1];
    el.alertHeadlineWarning.textContent = `${latest.component_id || 'Sensor'}: ${latest.message}`;
    el.alertHeadlineWarning.style.color = 'var(--status-warning)';
  } else {
    el.alertHeadlineWarning.textContent = 'Sensor probes within ±2% calibration';
    el.alertHeadlineWarning.style.color = 'var(--text-secondary)';
  }

  // Info Row
  const commands = session.commands || [];
  const acceptedCommands = commands.filter((c) => c.status === 'accepted');
  el.alertCountInfo.textContent = acceptedCommands.length + infos.length;
  if (acceptedCommands.length > 0) {
    const latest = acceptedCommands[acceptedCommands.length - 1];
    const chemDetail = latest.dose_stock_a_ml ? `Dosed ${latest.dose_stock_a_ml}mL Stock A` : 'Routine actuation';
    el.alertHeadlineInfo.textContent = `PLC Guardian: Verified ${chemDetail}`;
  } else {
    el.alertHeadlineInfo.textContent = 'System armed and observing sensors';
  }
}

// --- VIEW 1 (Top-Left): Capacity & Harvest Readiness Donut ---
function updateCapacityHarvestDonut() {
  if (!el.donutActiveGullies) return;

  const activeGullies = session.spec?.channels?.length ?? 2;
  const totalPlants = plantCount(session.design || currentPreset);
  const fw = session.gt?.shoot_fw_g_per_plant ?? 5.0;
  const target = currentPreset.realHarvest?.mean ?? 250.0;

  el.donutActiveGullies.textContent = activeGullies;
  el.donutPortsFilled.textContent = `${totalPlants} / ${totalPlants}`;
  el.donutBiomassTarget.textContent = `${target.toFixed(1)} g`;

  // Crop Harvest Progress (% toward 250g harvest weight)
  const ratio = Math.min(1.0, Math.max(0.02, fw / target));
  const pct = Math.min(100, Math.round(ratio * 100));

  el.donutCenterPct.textContent = `${pct}%`;
  el.donutCenterGrams.textContent = `${fw.toFixed(1)} g / ${target.toFixed(0)} g`;

  // Circumference = 2 * PI * 48 = 301.59
  const circ = 301.59;
  const offset = circ * (1.0 - ratio);
  el.harvestDonutProgress.style.strokeDashoffset = String(offset);

  // Healthy vs Stressed ports
  const stress = session.gt?.stress_factor ?? 1.0;
  const stressed = stress < 0.85 ? Math.max(1, Math.round(totalPlants * (1.0 - stress))) : 0;
  const healthy = Math.max(0, totalPlants - stressed);

  el.legendHealthyCount.textContent = healthy;
  el.legendStressedCount.textContent = stressed;
}

// --- VIEW 1 (Top-Center): Autonomous AI Dosing & Reservoir Pill Gauges ---
function updateVerticalPillGauges() {
  if (!el.fillVerticalStockA) return;

  // Stock A
  const pctA = Math.max(15, Math.min(100, Math.round(100 - (cumulativeDoses.a / 800) * 100)));
  el.fillVerticalStockA.style.height = `${pctA}%`;
  el.pctVerticalStockA.textContent = `${pctA}%`;
  el.badgeVerticalStockA.textContent = lastDoseAmounts.a ? `+${lastDoseAmounts.a.toFixed(1)} mL` : 'Standby';

  // Stock B
  const pctB = Math.max(15, Math.min(100, Math.round(100 - (cumulativeDoses.b / 800) * 100)));
  el.fillVerticalStockB.style.height = `${pctB}%`;
  el.pctVerticalStockB.textContent = `${pctB}%`;
  el.badgeVerticalStockB.textContent = lastDoseAmounts.b ? `+${lastDoseAmounts.b.toFixed(1)} mL` : 'Standby';

  // pH Down / Up
  const totalBuffer = cumulativeDoses.acid + cumulativeDoses.base;
  const pctPh = Math.max(20, Math.min(100, Math.round(100 - (totalBuffer / 350) * 100)));
  el.fillVerticalStockPh.style.height = `${pctPh}%`;
  el.pctVerticalStockPh.textContent = `${pctPh}%`;
  el.badgeVerticalStockPh.textContent = lastDoseAmounts.acid ? `-${lastDoseAmounts.acid.toFixed(1)} mL` : 'HNO₃ / KOH';

  // Water Tank
  const vRes = session.gt?.v_res_l ?? 98.4;
  const maxL = session.spec?.reservoir?.max_volume_l ?? 120.0;
  const pctWater = Math.max(10, Math.min(100, Math.round((vRes / maxL) * 100)));
  el.fillVerticalWaterTank.style.height = `${pctWater}%`;
  el.pctVerticalWaterTank.textContent = `${pctWater}%`;
  el.badgeVerticalWaterTank.textContent = `${vRes.toFixed(1)} L`;
}

// --- VIEW 1 (Top-Right): Floating "Recent Alerts & AI Detections" Card ---
function updateRecentAlertsCard() {
  if (!el.alertsFeedContainer) return;

  const alerts = session.alerts || [];

  // Filter based on active tab
  let filtered = alerts;
  if (activeAlertTab === 'farm') {
    filtered = alerts.filter(
      (a) =>
        a.component_id?.includes('pump') ||
        a.component_id?.includes('aer') ||
        a.component_id?.includes('res') ||
        a.code?.includes('PUMP') ||
        a.code?.includes('AERATION') ||
        a.code?.includes('LEAK')
    );
  } else if (activeAlertTab === 'sensors') {
    filtered = alerts.filter(
      (a) =>
        a.component_id?.includes('sen-') ||
        a.component_id?.includes('probe') ||
        a.code?.includes('DRIFT') ||
        a.code?.includes('CALIBRATION')
    );
  } else if (activeAlertTab === 'plants') {
    filtered = alerts.filter(
      (a) =>
        a.component_id?.includes('ch-') ||
        a.code?.includes('STRESS') ||
        a.code?.includes('HEAT') ||
        a.code?.includes('NUTRIENT')
    );
  }

  const simSec = session.status?.sim_time_sec || 0;
  const dayNum = Math.floor(simSec / 86400);
  const hourNum = Math.floor((simSec % 86400) / 3600);
  const minNum = Math.floor((simSec % 3600) / 60);
  const timeStr = `Day ${dayNum} · ${String(hourNum).padStart(2, '0')}:${String(minNum).padStart(2, '0')}`;

  if (filtered.length === 0) {
    el.alertsFeedContainer.innerHTML = `
      <div class="alert-pill-expanded">
        <div class="alert-pill-top">
          <div class="alert-pill-title-row">
            <span class="alert-status-dot info"></span>
            <span class="alert-pill-title">All ${activeAlertTab.toUpperCase()} Systems Nominal</span>
          </div>
          <span class="alert-pill-time">${timeStr}</span>
        </div>
        <p class="alert-pill-desc">
          Sensors operating within ±2% tolerance. Mathematical observer running closed-loop verification against Benson-Krause saturation physics.
        </p>
      </div>
      <div class="alert-pill-compact">
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="alert-status-dot info"></span>
          <span style="font-weight:600; color:var(--text-primary);">PLC Safety Interlock</span>
        </div>
        <span style="color:var(--text-secondary); font-size:10px;">Armed & Active</span>
      </div>
    `;
    return;
  }

  // Top expanded card (most recent)
  const topAlert = filtered[filtered.length - 1];
  const topDay = Math.floor((topAlert.sim_time_sec || simSec) / 86400);
  const topH = Math.floor(((topAlert.sim_time_sec || simSec) % 86400) / 3600);
  const topM = Math.floor(((topAlert.sim_time_sec || simSec) % 3600) / 60);
  const topTime = `Day ${topDay} · ${String(topH).padStart(2, '0')}:${String(topM).padStart(2, '0')}`;

  const dotClass = topAlert.severity === 'critical' ? 'critical' : topAlert.severity === 'warning' ? 'warning' : 'info';

  const friendlyTitle =
    topAlert.code === 'IMPLIED_PUMP_OR_AERATION_FAULT'
      ? 'Implied Pump Flow Degradation'
      : topAlert.code === 'PH_PROBE_DRIFT_SUSPECTED'
      ? 'pH Probe Drift Detected'
      : topAlert.code === 'RESERVOIR_LEAK_SUSPECTED'
      ? 'Physical Reservoir Leak Inferred'
      : topAlert.code === 'HEAT_STRESS_EVENT'
      ? 'Extreme Climate Heatwave Alert'
      : topAlert.code || 'AI Anomaly Detected';

  const remaining = [...filtered.slice(0, -1)].reverse().slice(0, 3);

  const compactRows = remaining
    .map((a) => {
      const aD = Math.floor((a.sim_time_sec || simSec) / 86400);
      const aH = Math.floor(((a.sim_time_sec || simSec) % 86400) / 3600);
      const aM = Math.floor(((a.sim_time_sec || simSec) % 3600) / 60);
      const dot = a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info';
      return `
      <div class="alert-pill-compact">
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="alert-status-dot ${dot}"></span>
          <span style="font-weight:600; color:var(--text-primary);">${a.component_id || 'system'}: ${a.code}</span>
        </div>
        <span style="color:var(--text-secondary); font-size:10px;">Day ${aD} · ${String(aH).padStart(2, '0')}:${String(aM).padStart(2, '0')}</span>
      </div>
    `;
    })
    .join('');

  el.alertsFeedContainer.innerHTML = `
    <div class="alert-pill-expanded">
      <div class="alert-pill-top">
        <div class="alert-pill-title-row">
          <span class="alert-status-dot ${dotClass}"></span>
          <span class="alert-pill-title">${friendlyTitle}</span>
        </div>
        <span class="alert-pill-time">${topTime}</span>
      </div>
      <p class="alert-pill-desc">${topAlert.message || 'Anomaly inferred from divergence between physical sensor reading and digital twin state.'}</p>
    </div>
    ${compactRows}
  `;
}

// --- VIEW 1 (Bottom-Left Top): "AI Dosing & Actuation Activity" Vertical Bar Chart ---
function renderDosingBarChart() {
  if (!el.svgDosingBarChart) return;

  const commands = session.commands || [];
  const simSec = session.status?.sim_time_sec || 0;

  // ViewBox: 540 x 100.
  const chartW = 540;
  const chartH = 100;
  const baselineY = 78;

  let bins = [];
  let numBins = selectedDosingTimeframe === '24h' ? 24 : 30;

  if (selectedDosingTimeframe === '24h') {
    // 24 hours
    bins = Array.from({ length: 24 }, (_, i) => ({ label: `${i}h`, ml: 0, refills: 0 }));
    for (const cmd of commands) {
      if (cmd.sim_time_sec >= simSec - 86400) {
        const hour = Math.floor((cmd.sim_time_sec % 86400) / 3600);
        const idx = Math.min(23, Math.max(0, hour));
        const ml = (cmd.dose_stock_a_ml || 0) + (cmd.dose_stock_b_ml || 0) + (cmd.dose_acid_ml || 0) + (cmd.dose_base_ml || 0);
        bins[idx].ml += ml;
        bins[idx].refills += cmd.refill_water_l || 0;
      }
    }
  } else {
    // 30 days
    bins = Array.from({ length: 30 }, (_, i) => ({ label: `D${i + 1}`, ml: 0, refills: 0 }));
    for (const cmd of commands) {
      const day = Math.min(29, Math.max(0, Math.floor(cmd.sim_time_sec / 86400)));
      const ml = (cmd.dose_stock_a_ml || 0) + (cmd.dose_stock_b_ml || 0) + (cmd.dose_acid_ml || 0) + (cmd.dose_base_ml || 0);
      bins[day].ml += ml;
      bins[day].refills += cmd.refill_water_l || 0;
    }
  }

  // If no doses recorded yet, inject nominal baseline dosing pulse
  const maxDose = Math.max(15, ...bins.map((b) => b.ml));
  const barWidth = Math.max(4, Math.floor((chartW - 60) / numBins) - 4);
  const startX = 30;

  const barElements = bins
    .map((b, i) => {
      const x = startX + i * ((chartW - 60) / numBins);
      // Normalized height up to 60px
      const displayVal = b.ml > 0 ? b.ml : (i % 6 === 0 ? 2.5 : 0.8); // Faint background pulse if idle
      const barHeight = Math.min(62, Math.max(4, (displayVal / maxDose) * 60));
      const y = baselineY - barHeight;

      return `
      <rect
        x="${x.toFixed(1)}"
        y="${y.toFixed(1)}"
        width="${barWidth}"
        height="${barHeight.toFixed(1)}"
        rx="3"
        fill="#4F9DA6"
        opacity="${b.ml > 0 ? '0.95' : '0.22'}"
      >
        <title>${b.label}: ${b.ml > 0 ? `${b.ml.toFixed(1)} mL dosed` : 'Nominal monitoring'}</title>
      </rect>
    `;
    })
    .join('');

  // Subtle hour/day ticks
  const tickLabels = selectedDosingTimeframe === '24h'
    ? `<text x="30" y="93" font-size="9" fill="#7A8B8E" font-weight="600">00:00</text>
       <text x="160" y="93" font-size="9" fill="#7A8B8E" font-weight="600">06:00</text>
       <text x="290" y="93" font-size="9" fill="#7A8B8E" font-weight="600">12:00</text>
       <text x="420" y="93" font-size="9" fill="#7A8B8E" font-weight="600">18:00</text>
       <text x="500" y="93" font-size="9" fill="#7A8B8E" font-weight="600">Now</text>`
    : `<text x="30" y="93" font-size="9" fill="#7A8B8E" font-weight="600">Day 1</text>
       <text x="180" y="93" font-size="9" fill="#7A8B8E" font-weight="600">Day 10</text>
       <text x="340" y="93" font-size="9" fill="#7A8B8E" font-weight="600">Day 20</text>
       <text x="490" y="93" font-size="9" fill="#7A8B8E" font-weight="600">Day 30</text>`;

  el.svgDosingBarChart.innerHTML = `
    <!-- Baseline line -->
    <line x1="20" y1="${baselineY}" x2="520" y2="${baselineY}" stroke="rgba(18, 91, 99, 0.12)" />
    ${barElements}
    ${tickLabels}
  `;
}

// --- VIEW 1 (Bottom-Left Floating): "Vitalities (Telemetry vs. Physics Ground Truth)" Smooth Area Spline ---
function renderVitalitiesAreaSpline() {
  if (!el.vitalityStrokeLine1) return;

  const rawHistory = session.history || [];
  // Ensure we have at least 2 points for a curve
  let history = [...rawHistory];
  if (history.length === 0) {
    const rd = session.readings;
    const gt = session.gt || {};
    history = [
      {
        t: 0,
        measured: { DO: rd.DO ?? 6.8, EC: rd.EC ?? 2.0, pH: rd.pH ?? 5.95, T_air: rd.T_air ?? 23.4, T_w: 21.2 },
        doRes: gt.c_do_res_mg_l ?? 7.9,
        doCh: gt.c_do_ch_out_mg_l ?? 6.8,
        gtEc: gt.ec25_ds_m ?? 2.0,
        gtPh: gt.ph ?? 5.95,
        gtAirT: gt.t_air_c ?? 23.4,
        gtResT: 21.2,
      },
      {
        t: 3600,
        measured: { DO: rd.DO ?? 6.8, EC: rd.EC ?? 2.0, pH: rd.pH ?? 5.95, T_air: rd.T_air ?? 23.4, T_w: 21.2 },
        doRes: gt.c_do_res_mg_l ?? 7.9,
        doCh: gt.c_do_ch_out_mg_l ?? 6.8,
        gtEc: gt.ec25_ds_m ?? 2.0,
        gtPh: gt.ph ?? 5.95,
        gtAirT: gt.t_air_c ?? 23.4,
        gtResT: 21.2,
      },
    ];
  } else if (history.length === 1) {
    history = [{ ...history[0], t: 0 }, history[0]];
  }

  // ViewBox: 540 x 140. Coordinates: left=20, right=520, top=20, bottom=125.
  const chartW = 500;
  const chartH = 105;
  const x0 = 20;
  const y0 = 20;
  const bottomY = y0 + chartH;

  const n = history.length;
  const getX = (i) => x0 + (i / (n - 1)) * chartW;

  let minVal = 0;
  let maxVal = 10;
  let getVal1 = (h) => 0;
  let getVal2 = (h) => 0;
  let unit = '';
  let label1 = '';
  let label2 = '';

  if (selectedVitalityMetric === 'DO') {
    minVal = 2.0;
    maxVal = 10.0;
    unit = 'mg/L';
    label1 = 'Tank Inlet / Noisy Sensor:';
    label2 = 'Gully Outlet / Ground Truth:';
    getVal1 = (h) => h.measured.DO ?? h.doRes ?? 7.9;
    getVal2 = (h) => h.doCh ?? 6.8;
  } else if (selectedVitalityMetric === 'EC') {
    minVal = 0.5;
    maxVal = 3.5;
    unit = 'mS/cm';
    label1 = 'Noisy EC Probe (sen-ec-1):';
    label2 = 'Conserved Physics (gt):';
    getVal1 = (h) => h.measured.EC ?? 2.0;
    getVal2 = (h) => h.gtEc ?? 2.0;
  } else if (selectedVitalityMetric === 'pH') {
    minVal = 4.5;
    maxVal = 8.5;
    unit = 'pH';
    label1 = 'Noisy pH Probe (sen-ph-1):';
    label2 = 'True Conserved Chemistry:';
    getVal1 = (h) => h.measured.pH ?? 5.95;
    getVal2 = (h) => h.gtPh ?? 5.95;
  } else {
    // CLIMATE
    minVal = 15.0;
    maxVal = 35.0;
    unit = '°C';
    label1 = 'Air Temperature Sensor:';
    label2 = 'Reservoir Water Temp:';
    getVal1 = (h) => h.measured.T_air ?? 23.4;
    getVal2 = (h) => h.measured.T_w ?? h.gtResT ?? 21.2;
  }

  const getY = (val) => {
    const clamped = Math.min(maxVal, Math.max(minVal, val));
    return y0 + chartH - ((clamped - minVal) / (maxVal - minVal)) * chartH;
  };

  // Build points arrays
  const pts1 = [];
  const pts2 = [];
  for (let i = 0; i < n; i++) {
    const x = getX(i);
    pts1.push({ x, y: getY(getVal1(history[i])) });
    pts2.push({ x, y: getY(getVal2(history[i])) });
  }

  // Generate smooth cubic Bezier path
  function buildSplinePath(pts) {
    if (pts.length === 0) return '';
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const cp1x = prev.x + (cur.x - prev.x) / 2;
      const cp1y = prev.y;
      const cp2x = prev.x + (cur.x - prev.x) / 2;
      const cp2y = cur.y;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}`;
    }
    return d;
  }

  const stroke1 = buildSplinePath(pts1);
  const stroke2 = buildSplinePath(pts2);

  const lastPt = pts1[pts1.length - 1];
  const firstPt = pts1[0];
  const area1 = `${stroke1} L ${lastPt.x.toFixed(1)} ${bottomY} L ${firstPt.x.toFixed(1)} ${bottomY} Z`;

  const lastPt2 = pts2[pts2.length - 1];
  const firstPt2 = pts2[0];
  const area2 = `${stroke2} L ${lastPt2.x.toFixed(1)} ${bottomY} L ${firstPt2.x.toFixed(1)} ${bottomY} Z`;

  el.vitalityStrokeLine1.setAttribute('d', stroke1);
  el.vitalityAreaLine1.setAttribute('d', area1);
  el.vitalityStrokeLine2.setAttribute('d', stroke2);
  el.vitalityAreaLine2.setAttribute('d', area2);

  // Update Legend Labels & Current Values
  const latestH = history[history.length - 1];
  const latestV1 = getVal1(latestH);
  const latestV2 = getVal2(latestH);

  el.labelVitalityLine1.textContent = label1;
  el.valVitalityLine1.textContent = `${latestV1.toFixed(2)} ${unit}`;
  el.labelVitalityLine2.textContent = label2;
  el.valVitalityLine2.textContent = `${latestV2.toFixed(2)} ${unit}`;
}

// --- VIEW 1 (Bottom-Right): "AI Autopilot & PLC Safety Ledger" Table ---
function renderSafetyLedgerTable() {
  if (!el.ledgerTableBody) return;

  const commands = session.commands || [];
  const appliedCount = commands.filter((c) => c.status === 'accepted').length;
  const rejectedCount = commands.filter((c) => c.status !== 'accepted').length;

  el.ledgerStatsSubtext.textContent =
    commands.length === 0
      ? 'Awaiting AI actuation commands'
      : `${appliedCount} Applied · ${rejectedCount} Blocked by Safety Guardian`;

  if (commands.length === 0) {
    el.ledgerTableBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-secondary); padding: 24px;">
          🤖 Autopilot observing sensors · Zero hazardous doses dispatched
        </td>
      </tr>
    `;
    return;
  }

  const recent = [...commands].reverse().slice(0, 16);

  el.ledgerTableBody.innerHTML = recent
    .map((cmd) => {
      const isApplied = cmd.status === 'accepted';
      const simSec = cmd.sim_time_sec || 0;
      const d = Math.floor(simSec / 86400);
      const h = Math.floor((simSec % 86400) / 3600);
      const m = Math.floor((simSec % 3600) / 60);
      const timeStr = `Day ${d} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

      // Plain-English Action Description
      let actionDesc = 'Safety Interlock check';
      if (cmd.dose_stock_a_ml) actionDesc = `🧪 Stock Part A (+${cmd.dose_stock_a_ml.toFixed(1)} mL)`;
      else if (cmd.dose_stock_b_ml) actionDesc = `🧪 Stock Part B (+${cmd.dose_stock_b_ml.toFixed(1)} mL)`;
      else if (cmd.dose_acid_ml) actionDesc = `⚗️ Nitric Acid (+${cmd.dose_acid_ml.toFixed(1)} mL)`;
      else if (cmd.dose_base_ml) actionDesc = `⚗️ KOH Base (+${cmd.dose_base_ml.toFixed(1)} mL)`;
      else if (cmd.refill_water_l) actionDesc = `💧 Fresh Water (+${cmd.refill_water_l.toFixed(1)} L)`;
      else if (cmd.action === 'set_pump_throttle') actionDesc = `⚙️ Set Pump Throttle (${Math.round((cmd.throttle || 1) * 100)}%)`;

      // Friendly Target Translation
      let targetName = cmd.target_component_id || 'System';
      if (targetName === 'res-1' || targetName === 'reservoir-1') targetName = 'Main Reservoir';
      else if (targetName === 'pump-1') targetName = 'Circulation Pump';
      else if (targetName === 'stock-a') targetName = 'Stock A Tank';
      else if (targetName === 'stock-b') targetName = 'Stock B Tank';
      else if (targetName === 'stock-acid') targetName = 'Acid Buffer';

      return `
      <tr>
        <td><b>${actionDesc}</b></td>
        <td>${targetName}</td>
        <td>
          <span class="audit-badge ${isApplied ? 'applied' : 'rejected'}" title="${cmd.rejection_message || (isApplied ? 'Verified by PLC interlock' : 'Blocked')}">
            ${isApplied ? 'APPLIED' : 'REJECTED'}
          </span>
        </td>
        <td class="tabular-nums" style="color: var(--text-secondary);">${timeStr}</td>
      </tr>
    `;
    })
    .join('');
}

// --- VIEW 2: Gully Matrix Grid (A..D × 1..3) ---
function renderGullyMatrix() {
  const channels = session.spec?.channels || [
    { id: 'ch-1', plants_per_channel: 6 },
    { id: 'ch-2', plants_per_channel: 6 },
  ];

  const channelMap = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3'];
  const doReading = session.readings.DO ?? session.gt?.c_do_ch_out_mg_l ?? 6.8;

  el.matrixGridContainer.innerHTML = channelMap
    .map((slot, idx) => {
      const isActive = idx < channels.length;
      const count = isActive ? channels[idx]?.plants_per_channel || 6 : 0;
      const chDo = isActive ? doReading : 0;

      return `
        <div class="gully-card-cell" style="opacity: ${isActive ? '1' : '0.45'};">
          <div class="gully-cell-top">
            <span class="gully-title">Gully ${slot}</span>
            <span class="kpi-badge ${isActive ? 'healthy' : ''}" style="${isActive ? '' : 'background: #EEE; color: #888;'}">
              ${isActive ? 'Online' : 'Unmounted'}
            </span>
          </div>
          <div class="gully-ports-row">
            ${Array.from({ length: Math.min(8, count || 6) })
              .map(() => `<span class="port-sprout-dot">${isActive ? '🥬' : '·'}</span>`)
              .join('')}
          </div>
          <div style="font-size: 11px; color: var(--text-secondary); display: flex; justify-content: space-between; margin-top: 4px;">
            <span>Plants: <b>${count}</b></span>
            <span>DO: <b class="tabular-nums">${isActive ? chDo.toFixed(1) : '\u2014'} mg/L</b></span>
          </div>
        </div>
      `;
    })
    .join('');
}

// --- VIEW 3: 2.5D Isometric Rack Overview SVG ---
function renderIsometricRack() {
  const faults = session.activeFaults || [];
  const hasFault = faults.length > 0;
  const doVal = session.readings.DO ?? 6.8;

  el.svgIsometricRack.innerHTML = `
    <!-- Isometric Floor Grid Shadows -->
    <polygon points="120,380 400,240 680,380 400,430" fill="rgba(18, 91, 99, 0.04)" />

    <!-- Rack Level 3 (Top Gully Plane) -->
    <g transform="translate(0, -60)">
      <polygon points="200,200 480,100 640,170 360,270" fill="#FFFFFF" stroke="#125B63" stroke-width="1.8" filter="drop-shadow(0 10px 18px rgba(18,91,99,0.08))" />
      <!-- Gully lines -->
      <line x1="240" y1="215" x2="520" y2="115" stroke="#E6ECEB" stroke-width="2" />
      <line x1="280" y1="230" x2="560" y2="130" stroke="#E6ECEB" stroke-width="2" />
      <line x1="320" y1="245" x2="600" y2="145" stroke="#E6ECEB" stroke-width="2" />
      <!-- Sprout dots -->
      <circle cx="280" cy="180" r="7" fill="#E6F7EE" stroke="#16B364" stroke-width="1.5" />
      <circle cx="340" cy="160" r="7" fill="#E6F7EE" stroke="#16B364" stroke-width="1.5" />
      <circle cx="400" cy="140" r="7" fill="#E6F7EE" stroke="#16B364" stroke-width="1.5" />
      <circle cx="460" cy="120" r="7" fill="#E6F7EE" stroke="#16B364" stroke-width="1.5" />
      <text x="210" y="220" font-size="10" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#125B63">GULLY B1 (Outlet DO: ${doVal.toFixed(1)} mg/L)</text>
    </g>

    <!-- Rack Level 2 (Middle Gully Plane) -->
    <g transform="translate(0, 0)">
      <polygon points="200,200 480,100 640,170 360,270" fill="#FFFFFF" stroke="#125B63" stroke-width="1.8" filter="drop-shadow(0 10px 18px rgba(18,91,99,0.08))" />
      <circle cx="280" cy="180" r="7" fill="#E6F7EE" stroke="#16B364" stroke-width="1.5" />
      <circle cx="340" cy="160" r="7" fill="#E6F7EE" stroke="#16B364" stroke-width="1.5" />
      <circle cx="400" cy="140" r="7" fill="#E6F7EE" stroke="#16B364" stroke-width="1.5" />
      <circle cx="460" cy="120" r="7" fill="#E6F7EE" stroke="#16B364" stroke-width="1.5" />
      <text x="210" y="220" font-size="10" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#125B63">GULLY A1 (Nominal)</text>
    </g>

    <!-- Floating Anomaly Alert Pin if fault is active -->
    ${
      hasFault
        ? `
      <g transform="translate(340, 100)">
        <circle cx="0" cy="0" r="14" fill="#EB4D3D" filter="drop-shadow(0 4px 10px rgba(235,77,61,0.5))" />
        <text x="0" y="4" text-anchor="middle" font-size="12" font-weight="800" fill="#FFFFFF">✕</text>
        <rect x="-60" y="-36" width="120" height="22" rx="6" fill="#125B63" />
        <text x="0" y="-22" text-anchor="middle" font-size="9" font-weight="700" fill="#FFFFFF">${faults[0].kind}</text>
      </g>
    `
        : `
      <g transform="translate(340, 100)">
        <circle cx="0" cy="0" r="12" fill="#16B364" filter="drop-shadow(0 4px 8px rgba(22,179,100,0.3))" />
        <text x="0" y="4" text-anchor="middle" font-size="10" font-weight="800" fill="#FFFFFF">✓</text>
      </g>
    `
    }
  `;
}

// --- VIEW 5: Judge / Proof View ---
function renderProofTable() {
  const rd = session.readings;
  const gt = session.gt || {};
  const res = session.residuals || {};

  const rows = [
    {
      comp: 'Nutrient EC Probe (sen-ec-1)',
      sensor: `${(rd.EC ?? 2.0).toFixed(2)} mS/cm`,
      gt: `${(gt.ec25_ds_m ?? 2.0).toFixed(2)} mS/cm`,
      delta: `${(res.EC ?? 0).toFixed(3)}`,
      status: Math.abs(res.EC ?? 0) > 0.1 ? '⚠️ Concentration anomaly' : '✓ Calibration verified',
    },
    {
      comp: 'Acidity pH Probe (sen-ph-1)',
      sensor: `${(rd.pH ?? 5.95).toFixed(2)} pH`,
      gt: `${(gt.ph ?? 5.95).toFixed(2)} pH`,
      delta: `${(res.pH ?? 0).toFixed(3)}`,
      status: Math.abs(res.pH ?? 0) > 0.4 ? '❌ Electrode drift detected' : '✓ Chemical balance matched',
    },
    {
      comp: 'Gully Outlet DO Probe (sen-do-1)',
      sensor: `${(rd.DO ?? 6.8).toFixed(2)} mg/L`,
      gt: `${(gt.c_do_ch_out_mg_l ?? 6.8).toFixed(2)} mg/L`,
      delta: `${(res.DO ?? 0).toFixed(3)}`,
      status: (res.DO ?? 0) < -0.32 ? '❌ Flow reduction implied' : '✓ Root oxygen nominal',
    },
    {
      comp: 'Reservoir Level Probe (sen-vres-1)',
      sensor: `${(rd.V_res ?? 98.4).toFixed(1)} L`,
      gt: `${(gt.v_res_l ?? 98.4).toFixed(1)} L`,
      delta: `${(res.V_res ?? 0).toFixed(3)}`,
      status: (res.V_res ?? 0) < -0.85 ? '❌ Physical leak suspected' : '✓ Water conservation nominal',
    },
  ];

  el.proofTableBody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td><b>${r.comp}</b></td>
      <td class="tabular-nums">${r.sensor}</td>
      <td class="tabular-nums">${r.gt}</td>
      <td class="tabular-nums">${r.delta}</td>
      <td><span class="audit-badge ${r.status.startsWith('✓') ? 'applied' : 'rejected'}">${r.status}</span></td>
    </tr>
  `
    )
    .join('');
}

// --- Chaos Testing Modal Logic ---
function bindModalEvents() {
  // Open / Close Challenge Modal
  el.btnOpenChallenge.addEventListener('click', () => {
    updateActiveFaultsModalList();
    el.modalChallengeBackdrop.classList.add('open');
  });

  el.modalChallengeClose.addEventListener('click', () => el.modalChallengeBackdrop.classList.remove('open'));
  el.modalChallengeCancel.addEventListener('click', () => el.modalChallengeBackdrop.classList.remove('open'));

  // Select Fault Button
  el.faultOptionBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      el.faultOptionBtns.forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      const kind = btn.dataset.kind;
      selectedFault = FAULT_BY_KIND[kind] || FAULTS[0];
    });
  });

  // Inject Selected Fault
  el.btnInjectSelectedFault.addEventListener('click', async () => {
    if (!selectedFault) return;
    el.btnInjectSelectedFault.disabled = true;
    try {
      await session.injectFault(selectedFault);
      updateActiveFaultsModalList();
      el.modalChallengeBackdrop.classList.remove('open');
    } finally {
      el.btnInjectSelectedFault.disabled = false;
    }
  });

  // Clear All Faults
  el.btnClearAllFaults.addEventListener('click', async () => {
    await session.clearAllFaults();
    updateActiveFaultsModalList();
  });

  // Custom Layout Builder Modal
  el.btnOpenLayoutModal?.addEventListener('click', () => openCustomLayoutModal());
  el.modalLayoutClose?.addEventListener('click', () => el.modalLayoutBackdrop.classList.remove('open'));
  el.modalLayoutCancel?.addEventListener('click', () => el.modalLayoutBackdrop.classList.remove('open'));

  // Custom Layout Sliders
  el.sliderChannelCount?.addEventListener('input', (e) => (el.valChannelCount.textContent = e.target.value));
  el.sliderPlantsPerChannel?.addEventListener('input', (e) => (el.valPlantsPerChannel.textContent = e.target.value));
  el.sliderTankVolume?.addEventListener('input', (e) => (el.valTankVolume.textContent = `${e.target.value} L`));
  el.sliderPumpFlow?.addEventListener('input', (e) => (el.valPumpFlow.textContent = `${e.target.value} L/m`));

  el.btnApplyCustomFarm?.addEventListener('click', async () => {
    await applyCustomFarmLayout();
  });
}

function updateActiveFaultsModalList() {
  const faults = session.activeFaults || [];
  if (faults.length === 0) {
    el.modalActiveFaultsList.innerHTML = '<span style="font-size: 11px; color: var(--text-secondary);">No physical faults active in the loop.</span>';
    return;
  }

  el.modalActiveFaultsList.innerHTML = faults
    .map(
      (f) => `
    <div class="active-fault-badge">
      <span>⚡ ${f.kind} on ${f.target_component_id || 'system'}</span>
      <button class="btn-clear-single" onclick="window.clearSingleFault('${f.kind}')">Clear</button>
    </div>
  `
    )
    .join('');
}

window.clearSingleFault = async function (kind) {
  await session.clearFault(kind);
  updateActiveFaultsModalList();
};

function openCustomLayoutModal() {
  el.modalLayoutBackdrop.classList.add('open');
}

async function applyCustomFarmLayout() {
  const count = parseInt(el.sliderChannelCount.value, 10);
  const plants = parseInt(el.sliderPlantsPerChannel.value, 10);
  const vol = parseFloat(el.sliderTankVolume.value);
  const flow = parseFloat(el.sliderPumpFlow.value);

  const customDesign = cloneDesign(currentPreset);
  customDesign.channels.count = count;
  customDesign.channels.plantsPerChannel = plants;
  customDesign.reservoir.volumeL = vol;
  customDesign.pump.flowLMin = flow;
  customDesign.name = `Custom Farm Layout (${count} Gullies, ${count * plants} Plants)`;

  el.modalLayoutBackdrop.classList.remove('open');
  await session.start(customDesign);
  el.chipActivePreset.textContent = 'CUSTOM';
  el.infoFarmPreset.textContent = customDesign.name;
  updateAllUI();
}

// --- Run Boot Initializer ---
init();

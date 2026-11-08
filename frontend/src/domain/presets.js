// Farm presets + the "design" model the Farm Builder edits.
//
// A design is a compact, user-friendly description of a farm. buildFarmSpec(design)
// turns it into a FarmSpec that matches ../../schema/farm.schema.json exactly
// (the backend decodes with DisallowUnknownFields, so no extra keys are allowed).
//
// The three Egyptian presets reuse the calibrated site parameters from
// testdata/real_datasets/hydrogrownet_egypt/exp{1,2,3}_farm.json (validated at 93%).

export const IDS = Object.freeze({
  enclosure: 'enc-1',
  reservoir: 'res-1',
  pump: 'pump-1',
  aerator: 'aer-1',
  fans: 'fans-1',
  stockA: 'stock-a',
  stockB: 'stock-b',
  acid: 'stock-acid',
  base: 'stock-base',
});

// Sensor catalogue: which sensors can be installed and where they mount.
export const SENSOR_CATALOG = [
  { kind: 'EC', id: 'sen-ec-1', attach: 'reservoir', accuracy: 0.02, label: 'Plant food (EC) probe' },
  { kind: 'pH', id: 'sen-ph-1', attach: 'reservoir', accuracy: 0.02, label: 'Acidity (pH) probe' },
  { kind: 'T_w', id: 'sen-tw-1', attach: 'reservoir', accuracy: 0.1, label: 'Water temperature probe' },
  { kind: 'V_res', id: 'sen-vres-1', attach: 'reservoir', accuracy: 0.3, label: 'Tank level sensor' },
  { kind: 'DO', id: 'sen-do-1', attach: 'channel', accuracy: 0.08, label: 'Root-zone oxygen probe (gully outlet)' },
  { kind: 'T_air', id: 'sen-tair-1', attach: 'enclosure', accuracy: 0.15, label: 'Air temperature sensor' },
  { kind: 'RH', id: 'sen-rh-1', attach: 'enclosure', accuracy: 1.0, label: 'Humidity sensor' },
  { kind: 'CO2', id: 'sen-co2-1', attach: 'enclosure', accuracy: 8.0, label: 'CO\u2082 sensor' },
];

const ALL_SENSORS = SENSOR_CATALOG.map((s) => s.kind);

const ALEXANDRIA = { lat: 31.2001, lon: 29.9187, elev: 7.0 };

function egyptPreset({ id, emoji, title, subtitle, months, startDoy, ageDays, tau, vent, alk, ions, ecTarget, phTarget = 6.0, realHarvest }) {
  return {
    presetId: id,
    emoji,
    title,
    subtitle,
    months,
    realHarvest,
    name: `AASTMT HydroGrowNet NFT — ${title}`,
    location: { ...ALEXANDRIA, startDoy },
    enclosure: { type: 'greenhouse', floorArea: 0.96, height: 3.0, coverTransmittance: tau, vent },
    reservoir: { volumeL: 100, placement: 'indoor', wallU: 2.5 },
    pump: { flowLMin: 3.0 },
    aerator: { airFlowLMin: 4.0, otrGH: 2.5 },
    fans: { placement: 'horizontal_canopy', airflow: 0.12 },
    channels: { count: 2, length: 1.5, width: 0.1, slope: 0.02, plantsPerChannel: 6, spacing: 0.22, ageDays },
    chemistry: { sourceProfile: 'egypt_nile_fresh', alk, ions },
    sensors: [...ALL_SENSORS],
    targets: { ec: ecTarget, ph: phTarget },
    seasonDays: 30,
  };
}

export const PRESETS = [
  egyptPreset({
    id: 'exp1',
    emoji: '🌱',
    title: 'Spring crop',
    subtitle: 'Alexandria · Mar–Apr',
    months: 'March → April 2024',
    startDoy: 69,
    ageDays: 0,
    tau: 0.34,
    vent: 0.045,
    alk: 0.42,
    ions: { NO3: 12.78, P_tot: 1.74, K: 6.97, Ca: 3.49, Mg: 1.16, SO4: 1.16 },
    ecTarget: 2.0,
    phTarget: 5.95,
    realHarvest: { mean: 201.9, sd: 29.2, n: 72 },
  }),
  egyptPreset({
    id: 'exp2',
    emoji: '☀️',
    title: 'Optimal crop',
    subtitle: 'Alexandria · Apr–May',
    months: 'April → May 2024',
    startDoy: 106,
    ageDays: 2,
    tau: 0.56,
    vent: 0.035,
    alk: 0.65,
    ions: { NO3: 14.12, P_tot: 1.93, K: 7.7, Ca: 3.85, Mg: 1.28, SO4: 1.28 },
    ecTarget: 2.0,
    phTarget: 6.30,
    realHarvest: { mean: 290.8, sd: 40.7, n: 72 },
  }),
  egyptPreset({
    id: 'exp3',
    emoji: '🔥',
    title: 'Warm summer crop',
    subtitle: 'Alexandria · May–Jun',
    months: 'May → June 2024',
    startDoy: 140,
    ageDays: 2.5,
    tau: 0.52,
    vent: 0.045,
    alk: 1.15,
    ions: { NO3: 15.98, P_tot: 2.18, K: 8.72, Ca: 4.36, Mg: 1.45, SO4: 1.45 },
    ecTarget: 2.39,
    phTarget: 7.05,
    realHarvest: { mean: 252.2, sd: 46.5, n: 78 },
  }),
];

export function getPreset(id) {
  return PRESETS.find((p) => p.presetId === id) || PRESETS[1];
}

export function cloneDesign(d) {
  return JSON.parse(JSON.stringify(d));
}

export function channelId(i) {
  return `ch-${i + 1}`;
}

export function plantCount(design) {
  return design.channels.count * design.channels.plantsPerChannel;
}

/** Derived tank geometry: keep a realistic ~0.48 m water column. */
export function tankGeometry(design) {
  const maxL = Math.round(design.reservoir.volumeL * 1.2);
  const surface = Math.max(0.05, maxL / 1000 / 0.48);
  return { maxL, surface };
}

/** Footprint of the gully bank (cropped area) in m². */
export function channelFootprint(design) {
  const c = design.channels;
  return c.count * c.length * c.width;
}

const r2 = (v) => Math.round(v * 1000) / 1000;

/** design -> FarmSpec JSON accepted by POST /api/v1/farms. */
export function buildFarmSpec(design) {
  const { maxL, surface } = tankGeometry(design);
  const c = design.channels;
  const channels = Array.from({ length: c.count }, (_, i) => ({
    id: channelId(i),
    length_m: r2(c.length),
    width_m: r2(c.width),
    slope: r2(c.slope),
    plant_spacing_m: r2(c.spacing),
    plants_per_channel: Math.round(c.plantsPerChannel),
    initial_plant_age_days: c.ageDays,
  }));

  const attachTo = { reservoir: IDS.reservoir, channel: channelId(0), enclosure: IDS.enclosure };
  const sensors = SENSOR_CATALOG.filter((s) => design.sensors.includes(s.kind)).map((s) => ({
    id: s.id,
    kind: s.kind,
    attached_to_id: attachTo[s.attach],
    accuracy: s.accuracy,
    drift_per_day: 0,
  }));

  const chem = design.chemistry;
  return {
    schema_version: '1.0',
    name: design.name,
    location: {
      lat_deg: design.location.lat,
      lon_deg: design.location.lon,
      elevation_m: design.location.elev,
      start_doy: Math.round(design.location.startDoy),
    },
    enclosure: {
      id: IDS.enclosure,
      type: design.enclosure.type,
      floor_area_m2: r2(design.enclosure.floorArea),
      air_volume_m3: r2(design.enclosure.floorArea * design.enclosure.height),
      cover_transmittance: design.enclosure.coverTransmittance,
      vent_conductance_m_s: design.enclosure.vent,
    },
    reservoir: {
      id: IDS.reservoir,
      initial_volume_l: design.reservoir.volumeL,
      max_volume_l: maxL,
      surface_area_m2: r2(surface),
      wall_conductance_w_m2_k: design.reservoir.wallU,
      placement: design.reservoir.placement,
    },
    pump: { id: IDS.pump, rated_flow_l_min: design.pump.flowLMin, initial_health: 1.0 },
    aerator: { id: IDS.aerator, air_flow_l_min: design.aerator.airFlowLMin, otr_std_g_h: design.aerator.otrGH },
    fans: { id: IDS.fans, placement: design.fans.placement, airflow_m3_s: design.fans.airflow },
    channels,
    source_water: { profile: chem.sourceProfile, alkalinity_meq_l: chem.alk },
    initial_solution: { profile: 'hoagland_lettuce_std', alkalinity_meq_l: chem.alk, ions_mmol_l: { ...chem.ions } },
    dosing_stocks: {
      stock_a: { id: IDS.stockA, profile: 'standard_part_a' },
      stock_b: { id: IDS.stockB, profile: 'standard_part_b' },
      acid: { id: IDS.acid, profile: 'nitric_acid_0_5M' },
      base: { id: IDS.base, profile: 'potassium_hydroxide_0_5M' },
    },
    sensors,
  };
}

// "Challenge the autopilot" scenarios -> backend FaultSpec (POST /simulations/{id}/faults).
// Intensities are in the engine's units (see internal/physics/engine.go Step()).

import { IDS } from './presets.js';

export const FAULTS = [
  {
    id: 'pump',
    kind: 'pump_degradation',
    target: IDS.pump,
    intensity: 0.85,
    icon: '⚙️',
    label: 'Clog the pump',
    detail: 'Pump loses 85% of its flow. Nobody measures flow directly — can the autopilot still notice?',
    watch: 'Watch the gully water turn amber at the far end as roots run out of oxygen.',
  },
  {
    id: 'aer',
    kind: 'aeration_loss',
    target: IDS.aerator,
    intensity: 0.9,
    icon: '\uD83E\uDEE7',
    label: 'Cut the air bubbler',
    detail: 'Air stones stop oxygenating the tank (90% loss).',
    watch: 'Bubbles stop. Oxygen falls everywhere in the loop.',
  },
  {
    id: 'drift',
    kind: 'probe_drift',
    target: 'sen-ph-1',
    intensity: 0.8 / 86400, // +0.8 pH per day of bias, applied per second
    icon: '\uD83D\uDCC9',
    label: 'Make the pH probe lie',
    detail: 'The pH probe drifts upward by +0.8 per day. The water itself is fine.',
    watch: 'A naive controller would keep pouring acid. Does the autopilot catch the lying sensor?',
    requiresSensor: 'pH',
  },
  {
    id: 'heat',
    kind: 'heat_wave',
    target: IDS.enclosure,
    intensity: 6,
    icon: '\uD83C\uDF21\uFE0F',
    label: 'Heatwave +6 \u00B0C',
    detail: 'Outdoor air jumps 6 \u00B0C above the seasonal normal with stronger sun.',
    watch: 'Leaves droop and the greenhouse warms up.',
  },
  {
    id: 'leak',
    kind: 'reservoir_leak',
    target: IDS.reservoir,
    intensity: 1.0e-6, // 1 mm\u00B2 orifice
    icon: '\uD83D\uDCA7',
    label: 'Puncture the tank',
    detail: 'A 1 mm\u00B2 hole near the tank floor starts leaking.',
    watch: 'The water level drops faster than plants can drink.',
  },
  {
    id: 'mix',
    kind: 'nutrient_imbalance',
    target: IDS.stockA,
    intensity: 3.0,
    icon: '🧪',
    label: 'Mis-mix nutrient A',
    detail: 'Stock A was mixed 300% too strong. Shows up as abnormal jump when autopilot doses.',
    watch: 'Plant food rises more than the twin expects after each dose.',
  },
];

export const FAULT_BY_KIND = Object.fromEntries(FAULTS.map((f) => [f.kind, f]));

export function faultsForComponent(componentId) {
  return FAULTS.filter((f) => f.target === componentId);
}

# Digital Twin & Control Architecture: Model Schemas Reference

This reference document catalogs the formal names, input schemas, and output schemas across all six models of the Hydro Twin system.

---

## 1. Model 1: Enclosure Microclimate & Thermal-Vapor Dynamics Engine

* **System Layer:** Physics Simulation / Analytical Reference Observer
* **Purpose:** Simulates sensible heat balance, humidity, $\text{CO}_2$, and reservoir/channel thermal equilibrium.

### Input Schema (`model1_input.json`)
```json
{
  "sim_time_sec": 86400.0,
  "delta_t_sec": 300.0,
  "outdoor_weather": {
    "shortwave_irradiance_w_m2": 650.0,
    "air_temperature_c": 28.5,
    "relative_humidity_pct": 55.0,
    "barometric_pressure_pa": 101325.0
  },
  "facility_parameters": {
    "floor_area_m2": 150.0,
    "enclosure_volume_m3": 600.0,
    "cover_transmittance": 0.75,
    "cover_heat_transfer_coeff_w_m2_k": 5.8,
    "ventilation_rate_m3_s": 1.25
  },
  "coupled_states": {
    "canopy_transpiration_kg_m2_s": 0.00012,
    "canopy_sensible_heat_w_m2": 45.2,
    "net_co2_uptake_kg_m2_s": 0.0000018,
    "pump_flow_rate_m3_s": 0.00005,
    "co2_injection_kg_m2_s": 0.0
  }
}
```

### Output Schema (`model1_output.json`)
```json
{
  "sim_time_sec": 86700.0,
  "enclosure_states": {
    "t_air_c": 24.35,
    "chi_vap_kg_m3": 0.0135,
    "relative_humidity_pct": 62.4,
    "vpd_kpa": 1.15,
    "co2_concentration_ppm": 485.2
  },
  "root_zone_states": {
    "t_res_c": 21.85,
    "t_ch_out_c": 22.40,
    "t_ch_mean_c": 22.12
  }
}
```

---

## 2. Model 2: Dissolved Oxygen & Channel Hydraulics Soft-Sensor Observer

* **System Layer:** Soft-Sensor Observer / Physics Reference Generator
* **Purpose:** Predicts dissolved oxygen saturation, root respiration consumption, thin-film hydraulics, and gully outlet DO without high-maintenance sensors.

### Input Schema (`model2_input.json`)
```json
{
  "temperatures": {
    "t_res_c": 21.85,
    "t_ch_c": 22.40
  },
  "water_properties": {
    "ec25_ds_m": 2.02,
    "elevation_m": 7.0
  },
  "channel_geometry": {
    "num_channels": 6,
    "channel_length_m": 12.0,
    "channel_width_m": 0.15,
    "bed_slope_m_m": 0.02,
    "plants_per_channel": 12,
    "plant_spacing_m": 0.20
  },
  "operational_states": {
    "pump_flow_rate_m3_s": 0.00005,
    "reservoir_do_mg_l": 8.15,
    "root_dry_mass_kg_plant": 0.0055
  }
}
```

### Output Schema (`model2_output.json`)
```json
{
  "dissolved_oxygen": {
    "saturation_concentration_mg_l": 8.68,
    "channel_outlet_do_mg_l": 7.42,
    "channel_mean_do_mg_l": 7.78,
    "specific_root_consumption_mg_hr_plant": 14.2
  },
  "hydraulics": {
    "film_depth_mm": 3.85,
    "flow_velocity_m_s": 0.086,
    "total_channel_volume_l": 41.58,
    "residence_time_sec": 831.6
  }
}
```

---

## 3. Model 3: Solution Chemistry, Multi-Ion Speciation & pH Equilibrium Solver

* **System Layer:** Physics Simulation / Chemical Observer
* **Purpose:** Tracks 10 individual ion mass balances, Kohlrausch-Onsager conductivity, non-linear electroneutrality speciation, and Van Slyke buffer capacity $\beta_{\text{buf}}$.

### Input Schema (`model3_input.json`)
```json
{
  "total_volume_l": 100.0,
  "water_temperature_c": 21.85,
  "makeup_water": {
    "flow_rate_l_s": 0.0,
    "alkalinity_meq_l": 0.42,
    "ions_mmol_l": {
      "NO3": 0.1,
      "Ca": 0.8,
      "Mg": 0.3,
      "Cl": 0.5
    }
  },
  "dosing_actions": {
    "dose_stock_a_ml": 0.0,
    "dose_stock_b_ml": 0.0,
    "dose_acid_ml": 0.0,
    "acid_normality_eq_l": 1.0
  },
  "crop_uptake_fluxes_mol_s": {
    "NO3": 0.0000085,
    "NH4": 0.0000008,
    "H2PO4": 0.0000012,
    "K": 0.0000045,
    "Ca": 0.0000021,
    "Mg": 0.0000009
  },
  "transpiration_rate_l_s": 0.00025
}
```

### Output Schema (`model3_output.json`)
```json
{
  "bulk_properties": {
    "ec25_ds_m": 2.015,
    "ec_raw_ds_m": 1.894,
    "ph": 5.965,
    "buffer_capacity_meq_l_ph": 0.384,
    "titration_alkalinity_meq_l": 0.521,
    "ionic_strength_mol_l": 0.024
  },
  "dissolved_ions_mmol_l": {
    "NO3": 14.25,
    "NH4": 0.85,
    "H2PO4": 1.95,
    "K": 7.82,
    "Ca": 3.90,
    "Mg": 1.30,
    "SO4": 1.30,
    "Na": 0.45,
    "Cl": 0.55,
    "Fe_chel": 0.035
  },
  "precipitation_rates_mmol_s": {
    "Fe_precip": 0.0,
    "CaHPO4_precip": 0.0
  }
}
```

---

## 4. Model 4: Stanghellini Transpiration & Van Henten Crop Biomass Engine

* **System Layer:** Biological Simulation / Agronomic Reference Engine
* **Purpose:** Computes Stanghellini canopy transpiration, Van Henten 2-state dry-matter partitioning, root nutrient uptake rates, and fresh weight under osmotic salinity stress.

### Input Schema (`model4_input.json`)
```json
{
  "microclimate": {
    "par_irradiance_w_m2": 320.0,
    "air_temperature_c": 24.35,
    "relative_humidity_pct": 62.4,
    "vpd_kpa": 1.15,
    "co2_ppm": 485.2,
    "canopy_air_speed_m_s": 0.25
  },
  "root_zone": {
    "channel_outlet_do_mg_l": 7.42,
    "ph": 5.965,
    "ec25_ds_m": 2.015,
    "water_temp_c": 22.40,
    "ions_mmol_l": {
      "NO3": 14.25,
      "H2PO4": 1.95,
      "K": 7.82
    }
  },
  "crop_parameters": {
    "cohort_age_days": 18,
    "plant_density_pl_m2": 24.0,
    "spacing_m": 0.20
  }
}
```

### Output Schema (`model4_output.json`)
```json
{
  "transpiration": {
    "canopy_transpiration_kg_m2_s": 0.000125,
    "daily_water_use_l_plant_day": 0.45,
    "stomatal_resistance_s_m": 142.5,
    "leaf_temperature_c": 23.95
  },
  "biomass_and_yield": {
    "structural_dry_weight_g_plant": 4.82,
    "non_structural_dry_weight_g_plant": 1.12,
    "total_dry_weight_g_plant": 5.94,
    "shoot_fresh_weight_g_plant": 95.8,
    "effective_lai": 1.85,
    "stress_factor": 0.982
  },
  "root_uptake_fluxes_mol_plant_s": {
    "NO3": 0.0000085,
    "H2PO4": 0.0000012,
    "K": 0.0000045,
    "Ca": 0.0000021
  }
}
```

---

## 5. Model 5: Multi-Fault Isolation & Physics-Guided Residual Anomaly Detector

* **System Layer:** Diagnostic Supervisor / Fault Detection & Isolation (FDI) Engine
* **Purpose:** Evaluates physics-guided innovation residuals and cross-state decoupling rules (Torricelli leaks, pump/aeration DO decoupling, pH probe drift) to emit component-level diagnostic alerts.

### Input Schema (`model5_input.json`)
```json
{
  "simulation_id": "sim-894a0f04-f37d-4889",
  "sim_time_sec": 86400.0,
  "observed_telemetry": [
    {"kind": "V_res", "sensor_id": "sen-vres-1", "value": 78.4, "unit": "L"},
    {"kind": "EC", "sensor_id": "sen-ec-1", "value": 2.01, "unit": "dS/m"},
    {"kind": "pH", "sensor_id": "sen-ph-1", "value": 5.98, "unit": "pH"},
    {"kind": "DO", "sensor_id": "sen-do-1", "value": 4.95, "unit": "mg/L"},
    {"kind": "T_air", "sensor_id": "sen-tair-1", "value": 24.5, "unit": "C"}
  ],
  "twin_reference_states": {
    "v_res_l": 88.2,
    "ec25_ds_m": 2.02,
    "ph": 5.95,
    "c_do_ch_out_mg_l": 7.65,
    "c_do_res_mg_l": 8.12,
    "t_air_c": 24.1
  },
  "actuator_context": {
    "pump_throttle": 1.0,
    "last_chemical_dose_sec": 72000.0,
    "dose_acid_commanded_ml": 0.0
  }
}
```

### Output Schemas

#### A. Emitted Alert Payload (`POST /alerts`)
```json
{
  "component_id": "pump-1",
  "severity": "critical",
  "code": "IMPLIED_PUMP_OR_AERATION_FAULT",
  "message": "Outlet DO dropped to 4.95 mg/L (expected 7.65 mg/L) while reservoir DO remains saturated at 8.12 mg/L. Pump degradation or root obstruction diagnosed."
}
```

#### B. Internal Sensor Health Matrix (`model5_health_matrix.json`)
```json
{
  "evaluation_time_sec": 86400.0,
  "overall_system_status": "DEGRADED",
  "sensor_health": {
    "sen-vres-1": "HEALTHY",
    "sen-ec-1": "HEALTHY",
    "sen-ph-1": "HEALTHY",
    "sen-do-1": "DEGRADED",
    "sen-tair-1": "HEALTHY"
  },
  "active_diagnosed_faults": [
    "IMPLIED_PUMP_OR_AERATION_FAULT"
  ]
}
```

---

## 6. Model 6: Autonomous Fertigation Dosing & PLC Safety Guardian Engine

* **System Layer:** Supervisory Controller / Safe Actuation Dispatcher
* **Purpose:** Computes water replenishment and nutrient/acid dosing, filtering commands through 5 zero-bypass PLC safety interlocks to guarantee a 0.0% Go-core rejection rate.

### Input Schema (`model6_input.json`)
```json
{
  "simulation_id": "sim-894a0f04-f37d-4889",
  "sim_time_sec": 86400.0,
  "current_telemetry": {
    "v_res_l": 88.5,
    "ec25_ds_m": 1.78,
    "ph": 6.35,
    "water_temp_c": 22.0
  },
  "agronomic_targets": {
    "v_target_l": 100.0,
    "ec_target_ds_m": 2.00,
    "ph_target": 6.00
  },
  "chemical_context": {
    "buffer_capacity_meq_l_ph": 0.384,
    "stock_ec_ds_m": 50.0,
    "acid_normality_n": 1.0,
    "last_chemical_dose_sec": 79200.0
  }
}
```

### Output Schema: Validated Actuation Command (`POST /commands`)
```json
{
  "target_component_id": "res-1",
  "action": "dose",
  "refill_water_l": 11.5,
  "dose_stock_a_ml": 8.0,
  "dose_stock_b_ml": 8.0,
  "dose_acid_ml": 4.5,
  "reason": "Replenish tank to 100L setpoint, adjust EC to 2.0 dS/m, and counter nitrate alkalinization."
}
```
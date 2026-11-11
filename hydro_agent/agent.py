"""End-to-End Autonomous Hydroponic Digital Twin Diagnostic & Control Agent.

Integrates the 6 physical digital twin models with the Go Core backend (:8080):
- Step 1: Telemetry ingestion & packet loss compensation (forward-fill buffer).
- Step 2: Forward digital twin state simulation (Models 1-4).
- Step 3: Residual anomaly detection and component-tagged alert dispatch (Model 5).
- Step 4: Closed-loop fertigation control with 5 deterministic PLC safety interlocks (Model 6).
- Step 5: Actuation command submission to Go Core Safety Guardian.

Physical Reference:
- docs/ML docs/end_to_end_system_workflow_dataflow.md
"""

from __future__ import annotations

from dataclasses import asdict
import logging
import time
from typing import Any, Dict, List, Optional

from hydro_agent.client.twin_client import TwinClient
from hydro_agent.client.ingestion import TelemetryIngestionGuard
from hydro_agent.models.model1_microclimate import (
    CoupledStates,
    FacilityParameters,
    MicroclimateThermalEngine,
    Model1Input,
    OutdoorWeather,
)
from hydro_agent.models.model2_oxygen import (
    ChannelGeometryInputs,
    DissolvedOxygenHydraulicsObserver,
    Model2Input,
    OperationalStateInputs,
    TemperatureInputs,
    WaterPropertyInputs,
)
from hydro_agent.models.model3_chemistry import (
    DosingActions,
    Model3Input,
    SolutionChemistrySolver,
)
from hydro_agent.models.model4_crop import (
    CropBiomassEngine,
    CropMicroclimate,
    CropParameters,
    Model4Input,
    RootZoneContext,
)
from hydro_agent.models.model5_diagnostics import (
    ActuatorContext,
    DiagnosticAlert,
    FaultResidualAnomalyDetector,
    Model5HealthMatrix,
    Model5Input,
    TelemetryPoint,
    TwinReferenceStates,
)
from hydro_agent.models.model6_controller import (
    ActuationCommand,
    AgronomicTargets,
    ChemicalContext,
    CurrentTelemetry,
    FertigationSafetyController,
    Model6Input,
)

logger = logging.getLogger(__name__)


class HydroAutonomousAgent:
    """Master orchestrator combining Models 1-6 with Go Core twin API."""

    def __init__(
        self,
        client: Optional[TwinClient] = None,
        base_url: str = "http://localhost:8080",
        api_key: str = "sensor-x-dev-ml-key",
    ):
        self.client = client or TwinClient(base_url=base_url, api_key=api_key)

        # Initialize the 6 physical and supervisory models
        self.m1_microclimate = MicroclimateThermalEngine()
        self.m2_oxygen = DissolvedOxygenHydraulicsObserver()
        self.m3_chemistry = SolutionChemistrySolver()
        self.m4_crop = CropBiomassEngine()
        self.m5_diagnostics = FaultResidualAnomalyDetector()
        self.m6_controller = FertigationSafetyController()
        self.ingestion_guard = TelemetryIngestionGuard()

        # Operational state memory
        self.last_chemical_dose_sec: float = 0.0
        self.last_command: Optional[ActuationCommand] = None

    def process_telemetry_batch(
        self,
        raw_readings: List[Dict[str, Any]],
        sim_time_sec: float,
        simulation_id: str,
        weather: Optional[OutdoorWeather] = None,
    ) -> Dict[str, Any]:
        """Execute a full single-step diagnostic and control cycle across all 6 models."""
        weather = weather or OutdoorWeather()

        # ----------------------------------------------------------------------
        # Step 1: Telemetry Cleaning, Forward-Fill & Stall Detection
        # ----------------------------------------------------------------------
        cleaned_points, stall_alerts = self.ingestion_guard.clean_telemetry_batch(
            raw_readings=raw_readings,
            sim_time_sec=sim_time_sec,
        )

        for stall in stall_alerts:
            try:
                self.client.post_alert(simulation_id, asdict(stall))
                logger.warning("Dispatched Stall Alert [%s]: %s", stall.code, stall.message)
            except Exception as e:
                logger.error("Failed to dispatch stall alert to Go backend: %s", e)

        telemetry_points = [
            TelemetryPoint(
                kind=cp.kind,
                sensor_id=cp.sensor_id,
                value=cp.value,
                unit=cp.unit,
                component_id=cp.component_id,
                tick_index=cp.tick_index,
                sim_time_sec=cp.sim_time_sec,
            )
            for cp in cleaned_points
        ]
        sensor_map = {pt.kind: pt.value for pt in telemetry_points}
        target_res_id = self.ingestion_guard.resolved_reservoir_id

        v_res = sensor_map.get("V_res", 88.5)
        ec_val = sensor_map.get("EC", 2.01)
        ph_val = sensor_map.get("pH", 5.98)
        tw_val = sensor_map.get("T_w", 22.0)
        t_air_obs = sensor_map.get("T_air", 24.5)

        # ----------------------------------------------------------------------
        # Step 2: Forward Digital Twin Observers (Models 1-4)
        # ----------------------------------------------------------------------
        # Model 4: Crop growth & transpiration
        m4_out = self.m4_crop.simulate(
            Model4Input(
                microclimate=CropMicroclimate(air_temperature_c=t_air_obs),
                root_zone=RootZoneContext(
                    ph=ph_val,
                    ec25_ds_m=ec_val,
                    water_temp_c=tw_val,
                ),
            )
        )

        # Model 1: Enclosure Microclimate
        m1_out = self.m1_microclimate.step(
            Model1Input(
                sim_time_sec=sim_time_sec,
                outdoor_weather=weather,
                coupled_states=CoupledStates(
                    canopy_transpiration_kg_m2_s=m4_out.transpiration.canopy_transpiration_kg_m2_s,
                    lai=m4_out.biomass_and_yield.effective_lai,
                    reservoir_volume_l=v_res,
                ),
            )
        )

        # Model 3: Solution Chemistry & Buffer Capacity
        m3_out = self.m3_chemistry.solve(
            Model3Input(
                total_volume_l=v_res,
                water_temperature_c=tw_val,
                crop_uptake_fluxes_mol_s=m4_out.root_uptake_fluxes_mol_plant_s,
            )
        )

        # Model 2: Dissolved Oxygen & Hydraulics Virtual Sensing
        root_dm_kg_plant = (m4_out.biomass_and_yield.total_dry_weight_g_plant * 0.15) / 1000.0
        m2_out = self.m2_oxygen.observe(
            Model2Input(
                temperatures=TemperatureInputs(
                    t_res_c=m1_out.root_zone_states.t_res_c,
                    t_ch_c=m1_out.root_zone_states.t_ch_out_c,
                ),
                water_properties=WaterPropertyInputs(ec25_ds_m=m3_out.bulk_properties.ec25_ds_m),
                channel_geometry=ChannelGeometryInputs(),
                operational_states=OperationalStateInputs(
                    reservoir_do_mg_l=sensor_map.get("DO", 8.15),
                    root_dry_mass_kg_plant=max(0.002, root_dm_kg_plant),
                ),
            )
        )

        # ----------------------------------------------------------------------
        # Step 3: Residual Anomaly Detection & FDI (Model 5)
        # ----------------------------------------------------------------------
        twin_refs = TwinReferenceStates(
            v_res_l=v_res,
            ec25_ds_m=m3_out.bulk_properties.ec25_ds_m,
            ph=m3_out.bulk_properties.ph,
            c_do_ch_out_mg_l=m2_out.dissolved_oxygen.channel_outlet_do_mg_l,
            c_do_res_mg_l=m2_out.dissolved_oxygen.saturation_concentration_mg_l,
            t_air_c=m1_out.enclosure_states.t_air_c,
        )

        m5_health = self.m5_diagnostics.evaluate(
            Model5Input(
                simulation_id=simulation_id,
                sim_time_sec=sim_time_sec,
                observed_telemetry=telemetry_points,
                twin_reference_states=twin_refs,
                actuator_context=ActuatorContext(
                    last_chemical_dose_sec=self.last_chemical_dose_sec,
                    target_reservoir_id=target_res_id,
                ),
            )
        )

        # Dispatch alerts to Go backend if anomalies confirmed
        dispatched_alerts = []
        for alert in m5_health.alerts_to_dispatch:
            try:
                res = self.client.post_alert(simulation_id, asdict(alert))
                dispatched_alerts.append(res)
                logger.warning("Dispatched Alert [%s]: %s", alert.code, alert.message)
            except Exception as e:
                logger.error("Failed to dispatch alert to Go backend: %s", e)

        # ----------------------------------------------------------------------
        # Step 4: Closed-Loop Actuation Formulation & PLC Safety (Model 6)
        # ----------------------------------------------------------------------
        m6_command = self.m6_controller.compute_action(
            Model6Input(
                simulation_id=simulation_id,
                sim_time_sec=sim_time_sec,
                current_telemetry=CurrentTelemetry(
                    v_res_l=v_res,
                    ec25_ds_m=ec_val,
                    ph=ph_val,
                    water_temp_c=tw_val,
                ),
                agronomic_targets=AgronomicTargets(
                    v_target_l=100.0,
                    ec_target_ds_m=2.00,
                    ph_target=6.00,
                ),
                chemical_context=ChemicalContext(
                    buffer_capacity_meq_l_ph=m3_out.bulk_properties.buffer_capacity_meq_l_ph,
                    last_chemical_dose_sec=self.last_chemical_dose_sec,
                ),
                target_component_id=target_res_id,
            )
        )

        # Dispatch command if action needed
        command_audit = None
        has_action = (
            m6_command.refill_water_l > 0.0
            or m6_command.dose_stock_a_ml > 0.0
            or m6_command.dose_acid_ml > 0.0
        )
        if has_action:
            try:
                command_audit = self.client.send_command(simulation_id, m6_command.to_dict())
                if m6_command.dose_stock_a_ml > 0.0 or m6_command.dose_acid_ml > 0.0:
                    self.last_chemical_dose_sec = sim_time_sec
                self.last_command = m6_command
                logger.info("Executed Fertigation Command: %s", m6_command.reason)
            except Exception as e:
                logger.error("Command rejected by Go PLC Safety Guardian: %s", e)

        return {
            "sim_time_sec": sim_time_sec,
            "virtual_sensing": {
                "model1": m1_out.to_dict(),
                "model2": m2_out.to_dict(),
                "model3": m3_out.to_dict(),
                "model4": m4_out.to_dict(),
            },
            "diagnostics": m5_health.to_dict(),
            "control": {
                "command": m6_command.to_dict(),
                "audit": command_audit,
            },
        }

    def run_polling_step(self, simulation_id: str) -> Dict[str, Any]:
        """Fetch latest telemetry from Go backend and run one agent evaluation step."""
        readings_payload = self.client.get_readings(simulation_id, limit=200)
        readings = readings_payload if isinstance(readings_payload, list) else readings_payload.get("readings", [])

        sim_status = self.client.get_simulation(simulation_id)
        sim_time = float(sim_status.get("sim_time_sec", 0.0))

        return self.process_telemetry_batch(
            raw_readings=readings,
            sim_time_sec=sim_time,
            simulation_id=simulation_id,
        )

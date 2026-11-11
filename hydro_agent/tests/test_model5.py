"""Unit and physical tests for Model 5: Multi-Fault FDI Engine."""

import unittest

from hydro_agent.models.model5_diagnostics import (
    ActuatorContext,
    DiagnosticAlert,
    FaultResidualAnomalyDetector,
    Model5HealthMatrix,
    Model5Input,
    TelemetryPoint,
    TwinReferenceStates,
)


class TestModel5Diagnostics(unittest.TestCase):
    """Test suite for Model 5 residual anomaly detector."""

    def setUp(self):
        self.detector = FaultResidualAnomalyDetector()

    def test_nominal_state_no_faults(self):
        """Under healthy matching telemetry, no faults should be raised."""
        inputs = Model5Input(
            simulation_id="sim-test-1",
            sim_time_sec=86400.0,
            observed_telemetry=[
                TelemetryPoint("V_res", "sen-vres-1", 88.0, "L"),
                TelemetryPoint("EC", "sen-ec-1", 2.02, "dS/m"),
                TelemetryPoint("pH", "sen-ph-1", 5.96, "pH"),
                TelemetryPoint("DO", "sen-do-1", 7.60, "mg/L"),
                TelemetryPoint("T_air", "sen-tair-1", 24.2, "C"),
            ],
            twin_reference_states=TwinReferenceStates(
                v_res_l=88.2,
                ec25_ds_m=2.02,
                ph=5.95,
                c_do_ch_out_mg_l=7.65,
                c_do_res_mg_l=8.12,
                t_air_c=24.1,
            ),
        )
        health = self.detector.evaluate(inputs)
        self.assertEqual(health.overall_system_status, "NOMINAL")
        self.assertEqual(len(health.active_diagnosed_faults), 0)

    def test_spatial_do_decoupling_pump_fault(self):
        """When channel outlet DO collapses while reservoir is saturated, diagnose pump fault."""
        inputs = Model5Input(
            simulation_id="sim-test-2",
            sim_time_sec=86400.0,
            observed_telemetry=[
                TelemetryPoint("DO", "sen-do-1", 4.95, "mg/L"),
            ],
            twin_reference_states=TwinReferenceStates(
                v_res_l=88.0,
                ec25_ds_m=2.0,
                ph=6.0,
                c_do_ch_out_mg_l=7.65,
                c_do_res_mg_l=8.12,  # Reservoir saturated!
                t_air_c=24.0,
            ),
        )
        health = self.detector.evaluate(inputs)
        self.assertEqual(health.overall_system_status, "DEGRADED")
        self.assertIn("IMPLIED_PUMP_OR_AERATION_FAULT", health.active_diagnosed_faults)
        self.assertEqual(len(health.alerts_to_dispatch), 1)
        self.assertEqual(health.alerts_to_dispatch[0].component_id, "pump-1")

    def test_torricelli_reservoir_leak(self):
        """When reservoir drops rapidly without salinity concentration, diagnose leak."""
        # Prime history with 3 successive points dropping fast
        t0 = 86400.0
        for i, v in enumerate([90.0, 89.0, 87.8]):
            inputs = Model5Input(
                simulation_id="sim-test-3",
                sim_time_sec=t0 + i * 300.0,
                observed_telemetry=[
                    TelemetryPoint("V_res", "sen-vres-1", v, "L"),
                    TelemetryPoint("EC", "sen-ec-1", 2.00, "dS/m"),
                ],
                twin_reference_states=TwinReferenceStates(
                    v_res_l=90.0, ec25_ds_m=2.0, ph=6.0,
                    c_do_ch_out_mg_l=7.5, c_do_res_mg_l=8.0, t_air_c=24.0,
                ),
            )
            health = self.detector.evaluate(inputs)

        # Rate of loss is (87.8 - 90.0) / (600 / 3600) = -2.2 / (1/6) = -13.2 L/h < -0.85 L/h
        self.assertIn("RESERVOIR_LEAK_SUSPECTED", health.active_diagnosed_faults)


if __name__ == "__main__":
    unittest.main()


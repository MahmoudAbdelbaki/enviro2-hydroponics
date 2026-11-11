"""Unit and safety interlock tests for Model 6: Fertigation Controller."""

import unittest

from hydro_agent.models.model6_controller import (
    ActuationCommand,
    AgronomicTargets,
    ChemicalContext,
    CurrentTelemetry,
    FertigationSafetyController,
    Model6Input,
)


class TestModel6Controller(unittest.TestCase):
    """Test suite for Model 6 controller and 5 PLC safety interlocks."""

    def setUp(self):
        self.controller = FertigationSafetyController()

    def test_nominal_dosing_command(self):
        """Under normal deficit, calculate balanced water, stock and acid doses."""
        inputs = Model6Input(
            simulation_id="sim-test-1",
            sim_time_sec=86400.0,
            current_telemetry=CurrentTelemetry(
                v_res_l=88.5,
                ec25_ds_m=1.78,
                ph=6.35,
                water_temp_c=22.0,
            ),
            agronomic_targets=AgronomicTargets(
                v_target_l=100.0,
                ec_target_ds_m=2.00,
                ph_target=6.00,
            ),
            chemical_context=ChemicalContext(
                buffer_capacity_meq_l_ph=0.384,
                last_chemical_dose_sec=72000.0,  # 4 hours ago, cooldown passed!
            ),
        )
        cmd = self.controller.compute_action(inputs)

        self.assertIsInstance(cmd, ActuationCommand)
        self.assertEqual(cmd.target_component_id, "res-1")
        self.assertEqual(cmd.action, "dose")
        self.assertAlmostEqual(cmd.refill_water_l, 11.5, delta=0.5)
        # 1:1 Stock A and B balance lock
        self.assertEqual(cmd.dose_stock_a_ml, cmd.dose_stock_b_ml)
        self.assertGreater(cmd.dose_stock_a_ml, 0.0)
        self.assertGreater(cmd.dose_acid_ml, 0.0)

    def test_interlock_mixing_cooldown(self):
        """Rule 4: Chemical dosing must be suppressed if within mixing cooldown."""
        inputs = Model6Input(
            simulation_id="sim-test-2",
            sim_time_sec=86400.0,
            current_telemetry=CurrentTelemetry(v_res_l=88.5, ec25_ds_m=1.70, ph=6.4, water_temp_c=22.0),
            chemical_context=ChemicalContext(
                last_chemical_dose_sec=85800.0,  # Only 600s ago (< 1800s cooldown)
            ),
        )
        cmd = self.controller.compute_action(inputs)

        # Refill allowed, but chemicals must be strictly 0
        self.assertEqual(cmd.dose_stock_a_ml, 0.0)
        self.assertEqual(cmd.dose_stock_b_ml, 0.0)
        self.assertEqual(cmd.dose_acid_ml, 0.0)
        self.assertIn("mixing cooldown", cmd.reason)

    def test_interlock_tank_overflow_cap(self):
        """Rule 3: Refill volume must be clamped so total never exceeds 120.0 L."""
        inputs = Model6Input(
            simulation_id="sim-test-3",
            sim_time_sec=86400.0,
            current_telemetry=CurrentTelemetry(v_res_l=115.0, ec25_ds_m=2.0, ph=6.0, water_temp_c=22.0),
            agronomic_targets=AgronomicTargets(v_target_l=130.0),  # Target above tank capacity
        )
        cmd = self.controller.compute_action(inputs)

        # 115.0 + refill <= 120.0 -> max refill is 5.0 L
        self.assertLessEqual(cmd.refill_water_l, 5.0)


if __name__ == "__main__":
    unittest.main()


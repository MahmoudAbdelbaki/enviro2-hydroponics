"""Unit tests for Telemetry Ingestion Guard: Forward-Fill, Stall Detection, and Dynamic ID."""

import math
import unittest

from hydro_agent.client.ingestion import CleanedTelemetryPoint, StallAlert, TelemetryIngestionGuard


class TestTelemetryIngestionGuard(unittest.TestCase):
    """Test suite for TelemetryIngestionGuard."""

    def setUp(self):
        self.guard = TelemetryIngestionGuard(stall_window_ticks=20, stall_variance_threshold=1e-12)

    def test_zero_order_hold_forward_fill(self):
        """Null or NaN packet dropouts must be forward-filled from last valid reading."""
        # Tick 1: Good reading
        batch1 = [
            {"sensor_id": "sen-ph-1", "kind": "pH", "value": 5.95, "unit": "pH", "component_id": "res-1"}
        ]
        pts1, alerts1 = self.guard.clean_telemetry_batch(batch1, sim_time_sec=300.0, tick_index=1)
        self.assertEqual(len(pts1), 1)
        self.assertEqual(pts1[0].value, 5.95)
        self.assertFalse(pts1[0].is_forward_filled)

        # Tick 2: Packet dropout (None)
        batch2 = [
            {"sensor_id": "sen-ph-1", "kind": "pH", "value": None, "unit": "pH", "component_id": "res-1"}
        ]
        pts2, alerts2 = self.guard.clean_telemetry_batch(batch2, sim_time_sec=600.0, tick_index=2)
        self.assertEqual(len(pts2), 1)
        self.assertEqual(pts2[0].value, 5.95)
        self.assertTrue(pts2[0].is_forward_filled)

        # Tick 3: NaN dropout
        batch3 = [
            {"sensor_id": "sen-ph-1", "kind": "pH", "value": float("nan"), "unit": "pH", "component_id": "res-1"}
        ]
        pts3, alerts3 = self.guard.clean_telemetry_batch(batch3, sim_time_sec=900.0, tick_index=3)
        self.assertEqual(len(pts3), 1)
        self.assertEqual(pts3[0].value, 5.95)
        self.assertTrue(pts3[0].is_forward_filled)

    def test_hardware_stall_detector(self):
        """20 consecutive flatlined readings must trigger SENSOR_HARDWARE_STALL alert."""
        alerts = []
        for tick in range(1, 25):
            batch = [
                {"sensor_id": "sen-ec-1", "kind": "EC", "value": 2.05, "unit": "dS/m", "component_id": "res-1"}
            ]
            _, tick_alerts = self.guard.clean_telemetry_batch(batch, sim_time_sec=tick * 300.0, tick_index=tick)
            alerts.extend(tick_alerts)

        # Alert should trigger at tick 20 and be latched (no duplicate alert spam)
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0].code, "SENSOR_HARDWARE_STALL")
        self.assertEqual(alerts[0].sensor_id, "sen-ec-1")
        self.assertEqual(alerts[0].component_id, "res-1")

    def test_dynamic_reservoir_id_resolution(self):
        """Must dynamically detect reservoir-1 vs res-1 from sensor component tags."""
        guard_valid_farm = TelemetryIngestionGuard()
        batch_valid = [
            {"sensor_id": "sen-vres-1", "kind": "V_res", "value": 95.0, "component_id": "reservoir-1"}
        ]
        guard_valid_farm.clean_telemetry_batch(batch_valid, sim_time_sec=300.0)
        self.assertEqual(guard_valid_farm.resolved_reservoir_id, "reservoir-1")

        guard_egypt_farm = TelemetryIngestionGuard()
        batch_egypt = [
            {"sensor_id": "sen-vres-1", "kind": "V_res", "value": 95.0, "component_id": "res-1"}
        ]
        guard_egypt_farm.clean_telemetry_batch(batch_egypt, sim_time_sec=300.0)
        self.assertEqual(guard_egypt_farm.resolved_reservoir_id, "res-1")


if __name__ == "__main__":
    unittest.main()


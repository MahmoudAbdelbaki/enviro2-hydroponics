"""Integration tests for HydroAutonomousAgent orchestrating Models 1-6."""

import unittest

from hydro_agent.agent import HydroAutonomousAgent
from hydro_agent.client.twin_client import TwinClient


class DummyTwinClient(TwinClient):
    """In-memory mock client to verify agent loop without running Go server."""

    def __init__(self):
        super().__init__(base_url="http://mock", api_key="test-key")
        self.dispatched_alerts = []
        self.dispatched_commands = []

    def post_alert(self, sim_id: str, alert_payload: dict):
        self.dispatched_alerts.append((sim_id, alert_payload))
        return {"status": "created", "alert_id": "alt-mock-1"}

    def send_command(self, sim_id: str, command_payload: dict):
        self.dispatched_commands.append((sim_id, command_payload))
        return {"status": "accepted", "id": "cmd-mock-1"}


class TestHydroAutonomousAgent(unittest.TestCase):
    """End-to-end integration tests for HydroAutonomousAgent."""

    def setUp(self):
        self.mock_client = DummyTwinClient()
        self.agent = HydroAutonomousAgent(client=self.mock_client)

    def test_single_step_execution_nominal(self):
        """Verify forward twin execution and safety command formulation."""
        raw_telemetry = [
            {"sensor_id": "sen-ec-1", "kind": "EC", "value": 1.85, "unit": "dS/m"},
            {"sensor_id": "sen-ph-1", "kind": "pH", "value": 6.25, "unit": "pH"},
            {"sensor_id": "sen-tw-1", "kind": "T_w", "value": 22.0, "unit": "C"},
            {"sensor_id": "sen-vres-1", "kind": "V_res", "value": 90.0, "unit": "L"},
            {"sensor_id": "sen-do-1", "kind": "DO", "value": 8.30, "unit": "mg/L"},
            {"sensor_id": "sen-tair-1", "kind": "T_air", "value": 24.5, "unit": "C"},
        ]

        result = self.agent.process_telemetry_batch(
            raw_readings=raw_telemetry,
            sim_time_sec=86400.0,
            simulation_id="sim-integration-1",
        )

        self.assertIn("virtual_sensing", result)
        self.assertIn("diagnostics", result)
        self.assertIn("control", result)

        # Virtual sensing states should be present
        vs = result["virtual_sensing"]
        self.assertIn("model1", vs)
        self.assertIn("model2", vs)
        self.assertIn("model3", vs)
        self.assertIn("model4", vs)

        # Command should have been dispatched to mock client
        self.assertEqual(len(self.mock_client.dispatched_commands), 1)
        sim_id, cmd = self.mock_client.dispatched_commands[0]
        self.assertEqual(sim_id, "sim-integration-1")
        self.assertEqual(cmd["action"], "dose")
        self.assertEqual(cmd["dose_stock_a_ml"], cmd["dose_stock_b_ml"])

    def test_anomaly_triggers_alert_dispatch(self):
        """Verify that DO collapse immediately dispatches component-tagged alert."""
        raw_telemetry = [
            {"sensor_id": "sen-vres-1", "kind": "V_res", "value": 88.0, "unit": "L"},
            {"sensor_id": "sen-ec-1", "kind": "EC", "value": 2.0, "unit": "dS/m"},
            {"sensor_id": "sen-ph-1", "kind": "pH", "value": 6.0, "unit": "pH"},
            {"sensor_id": "sen-do-1", "kind": "DO", "value": 4.10, "unit": "mg/L"},  # Sudden drop!
        ]

        self.agent.process_telemetry_batch(
            raw_readings=raw_telemetry,
            sim_time_sec=86400.0,
            simulation_id="sim-integration-2",
        )

        self.assertEqual(len(self.mock_client.dispatched_alerts), 1)
        sim_id, alert = self.mock_client.dispatched_alerts[0]
        self.assertEqual(alert["code"], "IMPLIED_PUMP_OR_AERATION_FAULT")
        self.assertEqual(alert["component_id"], "pump-1")

    def test_dosing_hold_dispatches_info_audit_alert(self):
        """Verify that when dosing is suppressed by an interlock, a DOSING_HOLD_INTERLOCK info alert is dispatched."""
        # Set agent in cooldown state
        self.agent.last_chemical_dose_sec = 86000.0  # 400s ago (< 7200s cooldown)
        raw_telemetry = [
            {"sensor_id": "sen-vres-1", "kind": "V_res", "value": 100.0, "unit": "L"},
            {"sensor_id": "sen-ec-1", "kind": "EC", "value": 1.5, "unit": "dS/m"},  # Needs stock fertilizer!
            {"sensor_id": "sen-ph-1", "kind": "pH", "value": 6.5, "unit": "pH"},   # Needs acid!
            {"sensor_id": "sen-do-1", "kind": "DO", "value": 8.0, "unit": "mg/L"},
        ]

        self.agent.process_telemetry_batch(
            raw_readings=raw_telemetry,
            sim_time_sec=86400.0,
            simulation_id="sim-integration-hold",
        )

        # Confirm DOSING_HOLD_INTERLOCK was dispatched as severity 'info'
        hold_alerts = [a for _, a in self.mock_client.dispatched_alerts if a["code"] == "DOSING_HOLD_INTERLOCK"]
        self.assertEqual(len(hold_alerts), 1)
        alert = hold_alerts[0]
        self.assertEqual(alert["severity"], "info")
        self.assertIn("INTERLOCK_4_MIXING_COOLDOWN", alert["message"])
        self.assertIn("res-1", alert["component_id"])


if __name__ == "__main__":
    unittest.main()


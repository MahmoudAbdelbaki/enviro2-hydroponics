"""Go Core Digital Twin REST API Client.

Interfaces with the Go Core backend (:8080) for clock management, simulation stepping,
sensor telemetry observation, component-tagged fault injection, alert dispatch,
and ML-exclusive closed-loop fertigation actuation.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class TwinClientError(Exception):
    """Base exception for TwinClient API errors."""

    def __init__(self, status_code: int, message: str, payload: Any = None):
        super().__init__(f"HTTP {status_code}: {message}")
        self.status_code = status_code
        self.payload = payload


class TwinClient:
    """High-reliability HTTP client for the Go Core hydroponic simulation backend."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout_s: float = 15.0,
    ):
        """Initialize the TwinClient.

        Args:
            base_url: Base URL of Go Core backend (defaults to HYDRO_TWIN_URL or http://localhost:8080).
            api_key: Bearer token for ML operations (defaults to HYDRO_ML_API_KEY or test-ml-secret-key-12345).
            timeout_s: Request timeout in seconds.
        """
        self.base_url = (base_url or os.getenv("HYDRO_TWIN_URL", "http://localhost:8080")).rstrip("/")
        self.api_key = api_key or os.getenv("HYDRO_ML_API_KEY", "sensor-x-dev-ml-key")
        self.timeout_s = timeout_s

    def _request(
        self,
        method: str,
        path: str,
        data: Optional[Dict[str, Any]] = None,
        auth: bool = True,
    ) -> Any:
        """Internal helper to dispatch JSON HTTP requests via urllib.request."""
        url = f"{self.base_url}{path}"
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if auth and self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        body_bytes = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as response:
                res_body = response.read().decode("utf-8")
                if res_body:
                    try:
                        return json.loads(res_body)
                    except json.JSONDecodeError:
                        return {"raw": res_body}
                return {}
        except urllib.error.HTTPError as e:
            raw_err = e.read().decode("utf-8")
            try:
                err_payload = json.loads(raw_err)
            except Exception:
                err_payload = raw_err
            logger.error("TwinClient HTTP Error %d on %s %s: %s", e.code, method, path, err_payload)
            raise TwinClientError(e.code, f"Error from {path}: {err_payload}", err_payload) from e
        except urllib.error.URLError as e:
            logger.error("TwinClient Connection Error on %s %s: %s", method, path, e.reason)
            raise ConnectionError(f"Failed to connect to digital twin at {url}: {e.reason}") from e

    # --- System & Farm Management ---

    def health_check(self) -> Dict[str, Any]:
        """Check Go backend server health (GET /healthz)."""
        return self._request("GET", "/healthz", auth=False)

    def validate_farm(self, farm_spec: Dict[str, Any]) -> Dict[str, Any]:
        """Validate a Farm JSON spec against structural & physical laws (POST /api/v1/farms/validate)."""
        return self._request("POST", "/api/v1/farms/validate", data=farm_spec, auth=False)

    def create_farm(self, farm_spec: Dict[str, Any]) -> Dict[str, Any]:
        """Persist a new validated Farm specification (POST /api/v1/farms)."""
        return self._request("POST", "/api/v1/farms", data=farm_spec, auth=False)

    def list_farms(self) -> List[Dict[str, Any]]:
        """List all registered farm specifications (GET /api/v1/farms)."""
        res = self._request("GET", "/api/v1/farms", auth=False)
        return res if isinstance(res, list) else res.get("farms", [])

    def get_farm(self, farm_id: str) -> Dict[str, Any]:
        """Retrieve a saved Farm specification by ID (GET /api/v1/farms/{farm_id})."""
        return self._request("GET", f"/api/v1/farms/{farm_id}", auth=False)

    # --- Simulation Lifecycle & Clock Control ---

    def list_simulations(self) -> List[Dict[str, Any]]:
        """List all active and stored simulations (GET /api/v1/simulations)."""
        res = self._request("GET", "/api/v1/simulations", auth=False)
        return res if isinstance(res, list) else res.get("simulations", [])

    def start_simulation(
        self,
        farm_id: str,
        seed: int = 42,
        step_seconds: int = 300,
        initial_mode: str = "running",
        speed_multiplier: float = 60.0,
        scheduled_faults: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Initialize and start a simulation run for a farm (POST /api/v1/simulations)."""
        payload: Dict[str, Any] = {
            "farm_id": farm_id,
            "seed": seed,
            "step_seconds": step_seconds,
            "initial_mode": initial_mode,
            "speed_multiplier": speed_multiplier,
            "scheduled_faults": scheduled_faults or [],
        }
        return self._request("POST", "/api/v1/simulations", data=payload, auth=False)

    def get_simulation(self, sim_id: str) -> Dict[str, Any]:
        """Get simulation run status, elapsed time, and fault summary (GET /api/v1/simulations/{sim_id})."""
        return self._request("GET", f"/api/v1/simulations/{sim_id}", auth=False)

    def control_clock(
        self,
        sim_id: str,
        mode: str,
        speed_multiplier: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Pause, resume, or adjust clock speed of the twin (POST /api/v1/simulations/{sim_id}/clock)."""
        payload: Dict[str, Any] = {"mode": mode}
        if speed_multiplier is not None:
            payload["speed_multiplier"] = speed_multiplier
        return self._request("POST", f"/api/v1/simulations/{sim_id}/clock", data=payload, auth=False)

    def advance(self, sim_id: str, steps: int = 1) -> Dict[str, Any]:
        """Synchronously advance simulation by N steps at maximum CPU rate (POST /api/v1/simulations/{sim_id}/advance)."""
        return self._request("POST", f"/api/v1/simulations/{sim_id}/advance", data={"steps": steps}, auth=False)

    # --- Sensor Telemetry & Ground Truth ---

    def get_readings(self, sim_id: str, limit: int = 200) -> Dict[str, Any]:
        """Get noisy sensor observations from Module 11 observer layer (GET /api/v1/simulations/{sim_id}/readings?limit=200)."""
        path = f"/api/v1/simulations/{sim_id}/readings"
        if limit:
            path += f"?limit={limit}"
        return self._request("GET", path, auth=False)

    def get_ground_truth(self, sim_id: str) -> Dict[str, Any]:
        """Export true conserved physical states for ML training (GET /api/v1/simulations/{sim_id}/ground-truth)."""
        return self._request("GET", f"/api/v1/simulations/{sim_id}/ground-truth", auth=True)

    # --- Physical Fault Injection & Clearing ---

    def inject_fault(self, sim_id: str, fault_spec: Dict[str, Any]) -> Dict[str, Any]:
        """Inject or clear a physical fault perturbation (POST /api/v1/simulations/{sim_id}/faults)."""
        return self._request("POST", f"/api/v1/simulations/{sim_id}/faults", data=fault_spec, auth=True)

    # --- Diagnostic Alerts ---

    def post_alert(self, sim_id: str, alert_payload: Dict[str, Any]) -> Dict[str, Any]:
        """Emit a component-tagged diagnostic fault alert (POST /api/v1/simulations/{sim_id}/alerts)."""
        return self._request("POST", f"/api/v1/simulations/{sim_id}/alerts", data=alert_payload, auth=True)

    def get_alerts(self, sim_id: str) -> List[Dict[str, Any]]:
        """List active and historical alerts (GET /api/v1/simulations/{sim_id}/alerts)."""
        res = self._request("GET", f"/api/v1/simulations/{sim_id}/alerts", auth=False)
        return res if isinstance(res, list) else res.get("alerts", [])

    # --- ML Actuation Commands ---

    def send_command(self, sim_id: str, command_payload: Dict[str, Any]) -> Dict[str, Any]:
        """Submit an actuation command behind the Go PLC safety guardian (POST /api/v1/simulations/{sim_id}/commands)."""
        return self._request("POST", f"/api/v1/simulations/{sim_id}/commands", data=command_payload, auth=True)

    def get_commands(self, sim_id: str) -> List[Dict[str, Any]]:
        """List ML actuation commands and safety guardian audit outcomes (GET /api/v1/simulations/{sim_id}/commands)."""
        res = self._request("GET", f"/api/v1/simulations/{sim_id}/commands", auth=False)
        return res if isinstance(res, list) else res.get("commands", [])


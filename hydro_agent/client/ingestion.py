"""Telemetry Ingestion Guard & Cleaning Pipeline.

Implements:
1. Zero-Order Hold (Forward-Fill): Replaces Bernoulli packet dropouts (null, NaN)
   with the last known valid sensor measurement.
2. Hardware Stall Detector: Tracks consecutive ticks per sensor. If an individual
   sensor flatlines across 20 consecutive ticks (Var(y_s) -> 0), raises a
   SENSOR_HARDWARE_STALL diagnostic alert.
3. Dynamic Reservoir ID Resolution: Inspects sensor component tags to dynamically
   resolve whether the facility uses 'res-1' (Egyptian datasets) or 'reservoir-1' (valid_farm.json).
"""

from __future__ import annotations

import collections
import logging
import math
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class CleanedTelemetryPoint:
    """Cleaned, type-validated telemetry point."""
    kind: str
    sensor_id: str
    value: float
    unit: str
    component_id: str
    tick_index: int
    sim_time_sec: float
    is_forward_filled: bool = False


@dataclass
class StallAlert:
    """Alert raised when sensor output flatlines."""
    sensor_id: str
    component_id: str
    kind: str
    consecutive_ticks: int
    variance: float
    severity: str = "warning"
    code: str = "SENSOR_HARDWARE_STALL"
    message: str = ""


class TelemetryIngestionGuard:
    """In-memory telemetry cleaner and sensor integrity monitor."""

    def __init__(self, stall_window_ticks: int = 20, stall_variance_threshold: float = 1e-12):
        self.stall_window_ticks = stall_window_ticks
        self.stall_variance_threshold = stall_variance_threshold

        # Last valid measurement per sensor_id: {sensor_id: CleanedTelemetryPoint}
        self.last_valid_points: Dict[str, CleanedTelemetryPoint] = {}

        # Sliding window of values per sensor_id: {sensor_id: Deque[float]}
        self.sensor_history: Dict[str, Deque[float]] = collections.defaultdict(
            lambda: collections.deque(maxlen=self.stall_window_ticks)
        )

        # Active latched stall alerts to avoid alert spam: {sensor_id: bool}
        self.latched_stalls: Dict[str, bool] = {}

        # Resolved reservoir component ID ('res-1' or 'reservoir-1')
        self.resolved_reservoir_id: str = "res-1"

    def clean_telemetry_batch(
        self,
        raw_readings: List[Dict[str, Any]],
        sim_time_sec: float,
        tick_index: int = 0,
    ) -> Tuple[List[CleanedTelemetryPoint], List[StallAlert]]:
        """Clean raw readings with Zero-Order Hold and detect hardware stalls."""
        cleaned_points: List[CleanedTelemetryPoint] = []
        stall_alerts: List[StallAlert] = []

        for reading in raw_readings:
            kind = reading.get("kind", "")
            sensor_id = reading.get("sensor_id", "")
            raw_val = reading.get("value")
            unit = reading.get("unit", "")
            component_id = reading.get("component_id") or ""
            reading_tick = reading.get("tick_index", tick_index)
            reading_sim_time = float(reading.get("sim_time_sec", sim_time_sec))

            # Dynamic reservoir ID detection from telemetry component IDs
            if "res" in component_id.lower() or "reservoir" in component_id.lower():
                if component_id in ("res-1", "reservoir-1"):
                    self.resolved_reservoir_id = component_id

            # Determine validity of measurement
            is_valid = True
            if raw_val is None:
                is_valid = False
            else:
                try:
                    f_val = float(raw_val)
                    if math.isnan(f_val) or math.isinf(f_val):
                        is_valid = False
                except (ValueError, TypeError):
                    is_valid = False

            if is_valid:
                val = float(raw_val)
                point = CleanedTelemetryPoint(
                    kind=kind,
                    sensor_id=sensor_id,
                    value=val,
                    unit=unit,
                    component_id=component_id or self.resolved_reservoir_id,
                    tick_index=reading_tick,
                    sim_time_sec=reading_sim_time,
                    is_forward_filled=False,
                )
                self.last_valid_points[sensor_id] = point
                self.sensor_history[sensor_id].append(val)
                cleaned_points.append(point)

                # Check if recovering from a latched stall
                if sensor_id in self.latched_stalls and self.latched_stalls[sensor_id]:
                    # If variance reappears, unlatch
                    if len(self.sensor_history[sensor_id]) >= self.stall_window_ticks:
                        var = self._compute_variance(self.sensor_history[sensor_id])
                        if var > self.stall_variance_threshold:
                            self.latched_stalls[sensor_id] = False
                            logger.info("Sensor %s hardware stall recovered (variance=%.3e)", sensor_id, var)
            else:
                # Zero-Order Hold (Forward-Fill) from last valid reading
                if sensor_id in self.last_valid_points:
                    last_pt = self.last_valid_points[sensor_id]
                    point = CleanedTelemetryPoint(
                        kind=kind or last_pt.kind,
                        sensor_id=sensor_id,
                        value=last_pt.value,
                        unit=unit or last_pt.unit,
                        component_id=component_id or last_pt.component_id,
                        tick_index=reading_tick,
                        sim_time_sec=reading_sim_time,
                        is_forward_filled=True,
                    )
                    cleaned_points.append(point)
                    self.sensor_history[sensor_id].append(last_pt.value)
                else:
                    # No prior reading exists; skip this point
                    continue

            # Hardware Stall Detection
            history = self.sensor_history[sensor_id]
            if len(history) >= self.stall_window_ticks:
                var = self._compute_variance(history)
                if var <= self.stall_variance_threshold:
                    if not self.latched_stalls.get(sensor_id, False):
                        self.latched_stalls[sensor_id] = True
                        alert = StallAlert(
                            sensor_id=sensor_id,
                            component_id=component_id or self.resolved_reservoir_id,
                            kind=kind,
                            consecutive_ticks=len(history),
                            variance=var,
                            severity="warning",
                            code="SENSOR_HARDWARE_STALL",
                            message=(
                                f"Sensor '{sensor_id}' ({kind}) on component '{component_id}' "
                                f"flatlined across {len(history)} consecutive ticks (Var={var:.2e}). "
                                "Hardware probe freeze or analog ADC stall diagnosed."
                            ),
                        )
                        stall_alerts.append(alert)
                        logger.warning("Hardware stall detected on sensor %s", sensor_id)

        return cleaned_points, stall_alerts

    @staticmethod
    def _compute_variance(vals: Deque[float]) -> float:
        """Sample variance over sliding window."""
        n = len(vals)
        if n < 2:
            return 1.0
        mean = sum(vals) / n
        return sum((x - mean) ** 2 for x in vals) / (n - 1)


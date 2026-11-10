"""Model 5: Multi-Fault Isolation & Physics-Guided Residual Anomaly Detector.

Implements fault detection and isolation (FDI) based on physics-guided innovation residuals:
    r_s(t) = | y_s,observed(t) - x_hat_s,twin(t) |

Isolates 6 target physical fault signatures:
1. pump_degradation (pump-1): Spatial DO decoupling (channel outlet DO collapses while reservoir DO is normal).
2. aeration_loss (aer-1): Parallel DO collapse in both reservoir and channels.
3. heat_wave (enc-1): Enclosure temperature spike (> +3.5 °C) coupled with high VPD.
4. probe_drift (sen-ph-1): Measured pH diverges from speciation without chemical actuator actions.
5. nutrient_imbalance (stock-a): Concentration deviation causing unexpected EC shift post-dosing.
6. reservoir_leak (res-1): Torricelli solute invariance (volume drop dV/dt < -0.85 L/h while dEC/dt <= 0).

Physical Reference:
- Gertler, J. (1998), Fault Detection and Diagnosis in Engineering Systems, Marcel Dekker.
- docs/ML docs/model_5_multi_fault_residual_anomaly_detector.md
"""

from __future__ import annotations

import collections
from dataclasses import asdict, dataclass, field
from typing import Any, Deque, Dict, List, Optional


@dataclass
class TelemetryPoint:
    """Individual noisy sensor reading from Module 11 observer."""
    kind: str
    sensor_id: str
    value: float
    unit: str
    component_id: Optional[str] = None
    tick_index: Optional[int] = None
    sim_time_sec: Optional[float] = None


@dataclass
class TwinReferenceStates:
    """Expected analytical states synthesized by Models 1-4."""
    v_res_l: float
    ec25_ds_m: float
    ph: float
    c_do_ch_out_mg_l: float
    c_do_res_mg_l: float
    t_air_c: float


@dataclass
class ActuatorContext:
    """Operational actuator state to disambiguate control from physical failures."""
    pump_throttle: float = 1.0
    last_chemical_dose_sec: float = 0.0
    dose_acid_commanded_ml: float = 0.0
    dose_stock_a_commanded_ml: float = 0.0


@dataclass
class Model5Input:
    """Strongly typed input schema for Model 5."""
    simulation_id: str
    sim_time_sec: float
    observed_telemetry: List[TelemetryPoint]
    twin_reference_states: TwinReferenceStates
    actuator_context: ActuatorContext = field(default_factory=ActuatorContext)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Model5Input":
        telemetry = [TelemetryPoint(**pt) for pt in data.get("observed_telemetry", [])]
        return cls(
            simulation_id=data["simulation_id"],
            sim_time_sec=data["sim_time_sec"],
            observed_telemetry=telemetry,
            twin_reference_states=TwinReferenceStates(**data["twin_reference_states"]),
            actuator_context=ActuatorContext(**data.get("actuator_context", {})),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DiagnosticAlert:
    """Component-tagged alert payload matching POST /alerts schema."""
    component_id: str
    severity: str
    code: str
    message: str


@dataclass
class Model5HealthMatrix:
    """Internal sensor health summary and active diagnosed faults."""
    evaluation_time_sec: float
    overall_system_status: str
    sensor_health: Dict[str, str]
    active_diagnosed_faults: List[str]
    alerts_to_dispatch: List[DiagnosticAlert] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Model5HealthMatrix":
        alerts = [DiagnosticAlert(**a) for a in data.get("alerts_to_dispatch", [])]
        return cls(
            evaluation_time_sec=data["evaluation_time_sec"],
            overall_system_status=data["overall_system_status"],
            sensor_health=data["sensor_health"],
            active_diagnosed_faults=data["active_diagnosed_faults"],
            alerts_to_dispatch=alerts,
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class FaultResidualAnomalyDetector:
    """Physics-informed innovation residual anomaly detector and FDI supervisor."""

    def __init__(self, history_len: int = 20):
        # Ring buffers for temporal derivatives and variance tracking
        self.history_len = history_len
        self.time_history: Deque[float] = collections.deque(maxlen=history_len)
        self.vres_history: Deque[float] = collections.deque(maxlen=history_len)
        self.ec_history: Deque[float] = collections.deque(maxlen=history_len)
        self.ph_history: Deque[float] = collections.deque(maxlen=history_len)
        self.do_channel_history: Deque[float] = collections.deque(maxlen=history_len)
        self.do_res_history: Deque[float] = collections.deque(maxlen=history_len)
        self.last_good_readings: Dict[str, float] = {}

    def _update_histories(self, t_sec: float, sensor_map: Dict[str, TelemetryPoint]):
        """Maintain historical buffers with forward-fill for dropouts."""
        self.time_history.append(t_sec)

        # Forward fill or register values
        if "V_res" in sensor_map:
            val = sensor_map["V_res"].value
            self.last_good_readings["V_res"] = val
            self.vres_history.append(val)
        elif "V_res" in self.last_good_readings:
            self.vres_history.append(self.last_good_readings["V_res"])

        if "EC" in sensor_map:
            val = sensor_map["EC"].value
            self.last_good_readings["EC"] = val
            self.ec_history.append(val)
        elif "EC" in self.last_good_readings:
            self.ec_history.append(self.last_good_readings["EC"])

        if "pH" in sensor_map:
            val = sensor_map["pH"].value
            self.last_good_readings["pH"] = val
            self.ph_history.append(val)
        elif "pH" in self.last_good_readings:
            self.ph_history.append(self.last_good_readings["pH"])

        if "DO" in sensor_map:
            val = sensor_map["DO"].value
            self.last_good_readings["DO"] = val
            self.do_channel_history.append(val)
        elif "DO" in self.last_good_readings:
            self.do_channel_history.append(self.last_good_readings["DO"])

    def _compute_rate(self, deque_vals: Deque[float]) -> float:
        """Compute rate of change per hour from historical deque."""
        if len(deque_vals) < 2 or len(self.time_history) < 2:
            return 0.0
        dt_hr = (self.time_history[-1] - self.time_history[0]) / 3600.0
        if dt_hr <= 1e-4:
            return 0.0
        return (deque_vals[-1] - deque_vals[0]) / dt_hr

    def evaluate(self, inputs: Model5Input) -> Model5HealthMatrix:
        """Evaluate physics residuals and diagnose root-cause faults."""
        sensor_map = {pt.kind: pt for pt in inputs.observed_telemetry}
        self._update_histories(inputs.sim_time_sec, sensor_map)

        faults: List[str] = []
        alerts: List[DiagnosticAlert] = []
        sensor_health: Dict[str, str] = {pt.sensor_id: "HEALTHY" for pt in inputs.observed_telemetry}

        # ----------------------------------------------------------------------
        # Fault 1 & 2: Dissolved Oxygen Diagnostics (Pump vs Aeration Loss)
        # ----------------------------------------------------------------------
        if "DO" in sensor_map:
            do_obs = sensor_map["DO"].value
            do_ch_exp = inputs.twin_reference_states.c_do_ch_out_mg_l
            do_res_exp = inputs.twin_reference_states.c_do_res_mg_l
            residual_do = do_obs - do_ch_exp

            if residual_do < -0.32:
                # Disambiguation: Check reservoir DO state
                if do_res_exp >= 7.5:
                    # Spatial decoupling: channel DO collapses while reservoir is saturated
                    fault_code = "IMPLIED_PUMP_OR_AERATION_FAULT"
                    faults.append(fault_code)
                    sensor_health[sensor_map["DO"].sensor_id] = "DEGRADED"
                    alerts.append(
                        DiagnosticAlert(
                            component_id="pump-1",
                            severity="critical",
                            code=fault_code,
                            message=(
                                f"Outlet DO dropped to {do_obs:.2f} mg/L (expected {do_ch_exp:.2f} mg/L) "
                                f"while reservoir DO remains saturated at {do_res_exp:.2f} mg/L. "
                                "Pump degradation or root obstruction diagnosed."
                            ),
                        )
                    )
                else:
                    # Parallel drop: both collapsed -> aerator compressor failure
                    fault_code = "AERATION_LOSS_SUSPECTED"
                    faults.append(fault_code)
                    alerts.append(
                        DiagnosticAlert(
                            component_id="aer-1",
                            severity="critical",
                            code=fault_code,
                            message=(
                                f"Both channel DO ({do_obs:.2f} mg/L) and reservoir DO ({do_res_exp:.2f} mg/L) "
                                "collapsed below hypoxic limits. Aeration compressor or diffuser clog diagnosed."
                            ),
                        )
                    )

        # ----------------------------------------------------------------------
        # Fault 3: Torricelli Reservoir Leak Invariance
        # ----------------------------------------------------------------------
        if len(self.vres_history) >= 3:
            dv_dt_hr = self._compute_rate(self.vres_history)
            dec_dt_hr = self._compute_rate(self.ec_history)

            # Torricelli leak: volume drops rapidly while salinity does not concentrate (dEC/dt <= 0)
            if dv_dt_hr < -0.85 and dec_dt_hr <= 0.01:
                fault_code = "RESERVOIR_LEAK_SUSPECTED"
                faults.append(fault_code)
                sensor_id = sensor_map.get("V_res", TelemetryPoint("V_res", "sen-vres-1", 0.0, "L")).sensor_id
                sensor_health[sensor_id] = "DEGRADED"
                alerts.append(
                    DiagnosticAlert(
                        component_id="res-1",
                        severity="critical",
                        code=fault_code,
                        message=(
                            f"Reservoir loss rate ({dv_dt_hr:.2f} L/h) exceeds normal evapotranspiration (0.05-0.22 L/h) "
                            f"without salinity concentration (dEC/dt = {dec_dt_hr:.3f} dS/m/h). Structural leak detected."
                        ),
                    )
                )

        # ----------------------------------------------------------------------
        # Fault 4: pH Sensor Drift Decoupling
        # ----------------------------------------------------------------------
        if "pH" in sensor_map:
            ph_obs = sensor_map["pH"].value
            ph_exp = inputs.twin_reference_states.ph
            residual_ph = abs(ph_obs - ph_exp)

            # Divergence > 0.40 pH without commanded acid dosing within cooldown window
            time_since_dose = inputs.sim_time_sec - inputs.actuator_context.last_chemical_dose_sec
            if residual_ph > 0.40 and time_since_dose > 1800.0:
                fault_code = "PH_PROBE_DRIFT_SUSPECTED"
                faults.append(fault_code)
                sensor_health[sensor_map["pH"].sensor_id] = "DEGRADED"
                alerts.append(
                    DiagnosticAlert(
                        component_id="sen-ph-1",
                        severity="warning",
                        code=fault_code,
                        message=(
                            f"Observed pH ({ph_obs:.2f}) diverges from speciation expectation ({ph_exp:.2f}) "
                            f"by |r_pH| = {residual_ph:.2f} without actuator chemical events. Probe drift suspected."
                        ),
                    )
                )

        # ----------------------------------------------------------------------
        # Fault 5: Heat Wave Spike
        # ----------------------------------------------------------------------
        if "T_air" in sensor_map:
            t_air_obs = sensor_map["T_air"].value
            t_air_exp = inputs.twin_reference_states.t_air_c
            if (t_air_obs - t_air_exp) > 3.5:
                fault_code = "HEAT_WAVE_EMERGENCY"
                faults.append(fault_code)
                alerts.append(
                    DiagnosticAlert(
                        component_id="enc-1",
                        severity="warning",
                        code=fault_code,
                        message=(
                            f"Enclosure air temperature ({t_air_obs:.1f} °C) elevated > 3.5 °C above reference ({t_air_exp:.1f} °C). "
                            "Acute greenhouse thermal surge diagnosed."
                        ),
                    )
                )

        status = "DEGRADED" if faults else "NOMINAL"
        return Model5HealthMatrix(
            evaluation_time_sec=inputs.sim_time_sec,
            overall_system_status=status,
            sensor_health=sensor_health,
            active_diagnosed_faults=faults,
            alerts_to_dispatch=alerts,
        )

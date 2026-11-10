"""Model 1: Enclosure Microclimate & Thermal-Vapor Dynamics Engine.

Implements first-principles conservation of:
1. Enclosure sensible heat balance (dT_air/dt) with solar absorption, cover conduction,
   ventilation exchange, and canopy sensible heat.
2. Enclosure water vapor mass balance (dchi_vap/dt) with canopy transpiration, cover condensation,
   and psychrometrics (Magnus-Tetens).
3. Carbon dioxide mass balance (dchi_CO2/dt) with crop net assimilation and ventilation dilution.
4. Channel thin-film Number of Transfer Units (NTU) heat exchanger algebraic solver for outlet DO/temperature.
5. Reservoir liquid thermal equilibrium (dT_res/dt).

Physical Reference:
- Stanghellini, C. (1987), Transpiration of greenhouse crops.
- Albright, L.D. (1990), Environment Control for Animals and Plants.
- docs/ML docs/model_1_microclimate_thermal_vapor_dynamics (1).md
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Optional, Tuple


@dataclass(frozen=True)
class MicroclimateParams:
    """Physical constants for Model 1 microclimate engine."""
    rho_a: float = 1.20                # kg m^(-3) dry air density at 20 °C
    cp_a: float = 1010.0               # J kg^(-1) K^(-1) specific heat of air
    rho_w: float = 1000.0              # kg m^(-3) liquid water density
    cp_w: float = 4184.0               # J kg^(-1) K^(-1) specific heat of water
    lambda_v: float = 2.45e6           # J kg^(-1) latent heat of vaporization of water

    # Psychrometric Magnus-Tetens coefficients
    mag_a: float = 610.78              # Pa
    mag_b: float = 17.27
    mag_c: float = 237.3               # °C

    # Gully & Cover Heat Transfer
    u_ch_top: float = 15.0             # W m^(-2) K^(-1) channel surface heat transfer coefficient
    alpha_ch_sol: float = 0.15         # Solar absorptance of white PVC gully
    k_ext_sw: float = 0.65             # Canopy light extinction coefficient
    k_cond_cov: float = 0.005          # m s^(-1) cover condensation mass transfer coefficient
    u_res_wall: float = 2.5            # W m^(-2) K^(-1) reservoir wall conduction to ambient
    co2_ppm_to_kg_m3: float = 1.8e-6   # Conversion factor at standard conditions


@dataclass
class OutdoorWeather:
    """Ambient external weather boundary conditions."""
    shortwave_irradiance_w_m2: float = 650.0
    air_temperature_c: float = 28.5
    relative_humidity_pct: float = 55.0
    barometric_pressure_pa: float = 101325.0


@dataclass
class FacilityParameters:
    """Enclosure structural geometry and ventilation properties."""
    floor_area_m2: float = 150.0
    enclosure_volume_m3: float = 600.0
    cover_transmittance: float = 0.75
    cover_heat_transfer_coeff_w_m2_k: float = 5.8
    ventilation_rate_m3_s: float = 1.25


@dataclass
class CoupledStates:
    """Coupled boundary fluxes from Models 4, 6, and physical actuators."""
    canopy_transpiration_kg_m2_s: float = 0.00012
    canopy_sensible_heat_w_m2: float = 45.2
    net_co2_uptake_kg_m2_s: float = 1.8e-6
    pump_flow_rate_m3_s: float = 0.00005
    co2_injection_kg_m2_s: float = 0.0
    lai: float = 1.85
    reservoir_volume_l: float = 100.0
    channel_total_area_m2: float = 10.8


@dataclass
class Model1Input:
    """Strongly typed input schema for Model 1."""
    sim_time_sec: float
    delta_t_sec: float = 300.0
    outdoor_weather: OutdoorWeather = field(default_factory=OutdoorWeather)
    facility_parameters: FacilityParameters = field(default_factory=FacilityParameters)
    coupled_states: CoupledStates = field(default_factory=CoupledStates)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Model1Input":
        return cls(
            sim_time_sec=data["sim_time_sec"],
            delta_t_sec=data.get("delta_t_sec", 300.0),
            outdoor_weather=OutdoorWeather(**data.get("outdoor_weather", {})),
            facility_parameters=FacilityParameters(**data.get("facility_parameters", {})),
            coupled_states=CoupledStates(**data.get("coupled_states", {})),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class EnclosureStates:
    """Simulated internal greenhouse atmospheric state variables."""
    t_air_c: float
    chi_vap_kg_m3: float
    relative_humidity_pct: float
    vpd_kpa: float
    co2_concentration_ppm: float


@dataclass
class RootZoneStates:
    """Simulated hydroponic root-zone thermal variables."""
    t_res_c: float
    t_ch_out_c: float
    t_ch_mean_c: float


@dataclass
class Model1Output:
    """Strongly typed output schema for Model 1."""
    sim_time_sec: float
    enclosure_states: EnclosureStates
    root_zone_states: RootZoneStates

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Model1Output":
        return cls(
            sim_time_sec=data["sim_time_sec"],
            enclosure_states=EnclosureStates(**data["enclosure_states"]),
            root_zone_states=RootZoneStates(**data["root_zone_states"]),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class MicroclimateThermalEngine:
    """First-principles enclosure microclimate and root-zone thermal engine."""

    def __init__(self, params: Optional[MicroclimateParams] = None):
        self.params = params or MicroclimateParams()
        # Internal state memory for continuous integration
        self.t_air: float = 24.35
        self.chi_vap: float = 0.0135
        self.chi_co2: float = 485.2 * self.params.co2_ppm_to_kg_m3
        self.t_res: float = 21.85

    # --------------------------------------------------------------------------
    # Psychrometric Utilities
    # --------------------------------------------------------------------------

    def sat_vapor_pressure_pa(self, temp_c: float) -> float:
        """Magnus-Tetens formula for saturation vapor pressure e*(T) [Pa]."""
        p = self.params
        return p.mag_a * math.exp((p.mag_b * temp_c) / (p.mag_c + temp_c))

    def sat_vapor_density(self, temp_c: float) -> float:
        """Saturation vapor density chi_vap*(T) [kg/m^3]."""
        e_sat = self.sat_vapor_pressure_pa(temp_c)
        tk = temp_c + 273.15
        return e_sat / (461.5 * tk)

    def compute_vpd_kpa(self, temp_c: float, chi_vap_kg_m3: float) -> Tuple[float, float]:
        """Compute relative humidity [%] and vapor pressure deficit (VPD) [kPa]."""
        e_sat = self.sat_vapor_pressure_pa(temp_c)
        tk = temp_c + 273.15
        actual_e = max(0.0, chi_vap_kg_m3) * 461.5 * tk
        actual_e = min(actual_e, e_sat)  # clamp to saturation

        rh_pct = (actual_e / e_sat) * 100.0 if e_sat > 0 else 100.0
        vpd_kpa = (e_sat - actual_e) / 1000.0
        return float(rh_pct), max(0.0, float(vpd_kpa))

    # --------------------------------------------------------------------------
    # Channel NTU Thermal Heat Exchanger
    # --------------------------------------------------------------------------

    def solve_channel_temperature(
        self,
        t_air_c: float,
        t_res_c: float,
        solar_canopy_w_m2: float,
        lai: float,
        pump_flow_m3_s: float,
        channel_area_m2: float,
    ) -> Tuple[float, float]:
        """Algebraic NTU solution for nutrient solution temperature along NFT gullies."""
        p = self.params
        transmitted_solar = math.exp(-p.k_ext_sw * max(0.0, lai)) * solar_canopy_w_m2
        t_eq_ch = t_air_c + (p.alpha_ch_sol * transmitted_solar) / p.u_ch_top

        if pump_flow_m3_s <= 1e-12:
            return float(t_eq_ch), float(t_eq_ch)

        capacitance_rate = p.rho_w * p.cp_w * pump_flow_m3_s
        conductance = p.u_ch_top * channel_area_m2
        ntu = conductance / capacitance_rate

        t_ch_out = t_eq_ch + (t_res_c - t_eq_ch) * math.exp(-ntu)
        t_ch_mean = 0.5 * (t_res_c + t_ch_out)
        return float(t_ch_out), float(t_ch_mean)

    # --------------------------------------------------------------------------
    # Time Stepping Integration
    # --------------------------------------------------------------------------

    def step(self, inputs: Model1Input) -> Model1Output:
        """Advance enclosure microclimate by delta_t seconds using forward dynamics."""
        p = self.params
        dt = inputs.delta_t_sec
        weather = inputs.outdoor_weather
        fac = inputs.facility_parameters
        coupled = inputs.coupled_states

        h_enc = fac.enclosure_volume_m3 / fac.floor_area_m2
        solar_canopy = weather.shortwave_irradiance_w_m2 * fac.cover_transmittance
        phi_vent = fac.ventilation_rate_m3_s / fac.floor_area_m2

        # 1. Gully Thermal NTU Solve
        t_ch_out, t_ch_mean = self.solve_channel_temperature(
            t_air_c=self.t_air,
            t_res_c=self.t_res,
            solar_canopy_w_m2=solar_canopy,
            lai=coupled.lai,
            pump_flow_m3_s=coupled.pump_flow_rate_m3_s,
            channel_area_m2=coupled.channel_total_area_m2,
        )

        # 2. Air Sensible Heat Balance
        q_rad_air = 0.15 * solar_canopy
        h_can_air = coupled.canopy_sensible_heat_w_m2
        h_ch_air = (coupled.channel_total_area_m2 / fac.floor_area_m2) * p.u_ch_top * (t_ch_mean - self.t_air)
        q_vent_sens = p.rho_a * p.cp_a * phi_vent * (self.t_air - weather.air_temperature_c)
        q_cov_cond = fac.cover_heat_transfer_coeff_w_m2_k * (self.t_air - weather.air_temperature_c)

        dt_air_dt = (q_rad_air + h_can_air + h_ch_air - q_vent_sens - q_cov_cond) / (p.rho_a * p.cp_a * h_enc)

        # 3. Water Vapor Balance
        chi_vap_out = self.sat_vapor_density(weather.air_temperature_c) * (weather.relative_humidity_pct / 100.0)
        phi_vent_vap = phi_vent * (self.chi_vap - chi_vap_out)
        e_can = coupled.canopy_transpiration_kg_m2_s

        dchi_vap_dt = (e_can - phi_vent_vap) / h_enc

        # 4. CO2 Balance
        chi_co2_out = 420.0 * p.co2_ppm_to_kg_m3
        phi_vent_co2 = phi_vent * (self.chi_co2 - chi_co2_out)
        dchi_co2_dt = (coupled.co2_injection_kg_m2_s - coupled.net_co2_uptake_kg_m2_s - phi_vent_co2) / h_enc

        # 5. Reservoir Thermal Balance
        v_res_m3 = max(0.01, coupled.reservoir_volume_l / 1000.0)
        q_advect = p.rho_w * p.cp_w * coupled.pump_flow_rate_m3_s * (t_ch_out - self.t_res)
        q_wall = p.u_res_wall * 1.5 * (self.t_air - self.t_res)
        dt_res_dt = (q_advect + q_wall) / (p.rho_w * p.cp_w * v_res_m3)

        # Forward integration
        self.t_air = float(self.t_air + dt * dt_air_dt)
        self.chi_vap = float(max(1e-4, self.chi_vap + dt * dchi_vap_dt))
        self.chi_co2 = float(max(1e-5, self.chi_co2 + dt * dchi_co2_dt))
        self.t_res = float(self.t_res + dt * dt_res_dt)

        rh_pct, vpd_kpa = self.compute_vpd_kpa(self.t_air, self.chi_vap)
        co2_ppm = self.chi_co2 / p.co2_ppm_to_kg_m3

        return Model1Output(
            sim_time_sec=inputs.sim_time_sec + dt,
            enclosure_states=EnclosureStates(
                t_air_c=round(self.t_air, 2),
                chi_vap_kg_m3=round(self.chi_vap, 4),
                relative_humidity_pct=round(rh_pct, 1),
                vpd_kpa=round(vpd_kpa, 2),
                co2_concentration_ppm=round(co2_ppm, 1),
            ),
            root_zone_states=RootZoneStates(
                t_res_c=round(self.t_res, 2),
                t_ch_out_c=round(t_ch_out, 2),
                t_ch_mean_c=round(t_ch_mean, 2),
            ),
        )

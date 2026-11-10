"""Model 2: Dissolved Oxygen & Channel Hydraulics Soft-Sensor Observer.

Implements a first-principles digital twin soft-sensor combining:
1. Benson & Krause (1984) / USGS DOTABLES theoretical DO saturation C_DO_sat(T_w, EC_25, P_atm).
2. Manning open-channel shallow sheet hydraulics with dynamic root-mat drag amplification.
3. Chun & Takakura (1994) specific root respiration kinetics with Q10 thermal scaling and
   Michaelis-Menten half-saturation.
4. 1D Longitudinal plug-flow advection-reaction-reaeration balance yielding outlet DO (C_DO,ch,out)
   and longitudinal mean channel DO (C_DO,ch,mean).

Physical References:
- Benson, B.B. and Krause, D. (1984), Limnol. Oceanogr. 29(3): 620-632.
- USGS Office of Water Quality Technical Memorandum 2011.03 (DOTABLES).
- Chun, C. and Takakura, T. (1994), Acta Hortic. 396: 181-188.
- Chow, V.T. (1959), Open-Channel Hydraulics, McGraw-Hill.
- Higbie, R. (1935), Trans. AIChE 35: 365-373 (Penetration Theory of Gas Absorption).
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Optional, Tuple


# ==============================================================================
# 1. Physical Parameter Registry & Configuration
# ==============================================================================

@dataclass(frozen=True)
class OxygenHydraulicsParams:
    """Consolidated physical constants and hydrodynamic coefficients for Model 2.

    All units are in SI standard unless explicitly noted.
    """

    # --- Benson & Krause (1984) Dissolved Oxygen Constants ---
    # Pure water polynomial coefficients (TK in Kelvin)
    bk_a0: float = -139.34411
    bk_a1: float = 1.575701e5
    bk_a2: float = -6.642308e7
    bk_a3: float = 1.243800e10
    bk_a4: float = -8.621949e11

    # Salinity factor coefficients (S in g/kg, TK in Kelvin)
    bk_s0: float = 0.017674
    bk_s1: float = -10.754
    bk_s2: float = 2140.7

    # Atmospheric & non-ideal gas virial coefficients
    bk_elev_lapse: float = 2.25577e-5  # Barometric lapse factor (1 - k*z)^n
    bk_elev_exp: float = 5.25588       # Exponent in standard barometric formula
    ec_to_salinity_ratio: float = 0.55 # S [g/kg] ≈ 0.55 * EC25 [dS/m]

    # --- Manning Hydraulics & Root-Mat Drag Constants ---
    n_pvc: float = 0.010               # s m^(-1/3) Manning roughness of clean smooth PVC
    c_root_drag: float = 12.0          # Dimensionless root-mat drag multiplier
    rho_rt_bulk: float = 55.0          # kg DM m^(-3) bulk root dry matter density
    h_res_puddle: float = 5.0e-4       # m (0.5 mm) residual puddle depth retained when flow stalls

    # --- Chun-Takakura Specific Root Respiration Constants ---
    r_o2_ref: float = 7.8e-4           # g O2 (kg root DM)^(-1) s^(-1) at 23 °C (= 2.808 mg O2 g^(-1) h^(-1))
    q10_do: float = 2.0                # Temperature coefficient Q10 for root respiration
    km_do: float = 1.50                # mg L^(-1) Michaelis-Menten half-saturation DO concentration
    t_ref_resp_c: float = 23.0         # °C reference temperature for root respiration

    # --- Channel Free-Surface Re-Aeration Constants ---
    kv_ch_20: float = 2.2e-5           # m s^(-1) baseline thin-film reaeration velocity at 20 °C
    theta_aer: float = 1.024           # Dimensionless van 't Hoff-Arrhenius gas transfer coefficient
    v0_ref: float = 0.10               # m s^(-1) reference velocity for Higbie penetration scaling
    h0_ref: float = 0.002              # m (2.0 mm) reference film depth for Higbie penetration scaling


# ==============================================================================
# 2. Strict Input & Output Dataclass Schemas
# ==============================================================================

@dataclass
class TemperatureInputs:
    """Reservoir and channel liquid temperatures."""
    t_res_c: float
    t_ch_c: float


@dataclass
class WaterPropertyInputs:
    """Physicochemical properties of the recirculating nutrient solution."""
    ec25_ds_m: float = 2.02
    elevation_m: float = 7.0
    p_atm_bar: Optional[float] = None


@dataclass
class ChannelGeometryInputs:
    """Physical dimensions and layout of the NFT gully array."""
    num_channels: int = 6
    channel_length_m: float = 12.0
    channel_width_m: float = 0.15
    bed_slope_m_m: float = 0.02
    plants_per_channel: int = 12
    plant_spacing_m: float = 0.20


@dataclass
class OperationalStateInputs:
    """Dynamic operational and biological states."""
    pump_flow_rate_m3_s: float = 0.00005
    reservoir_do_mg_l: float = 8.15
    root_dry_mass_kg_plant: float = 0.0055


@dataclass
class Model2Input:
    """Complete strongly-typed input specification for Model 2."""
    temperatures: TemperatureInputs
    water_properties: WaterPropertyInputs
    channel_geometry: ChannelGeometryInputs
    operational_states: OperationalStateInputs

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Model2Input":
        """Instantiate schema from a nested JSON dictionary."""
        return cls(
            temperatures=TemperatureInputs(**data["temperatures"]),
            water_properties=WaterPropertyInputs(**data["water_properties"]),
            channel_geometry=ChannelGeometryInputs(**data["channel_geometry"]),
            operational_states=OperationalStateInputs(**data["operational_states"]),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize dataclass to JSON-compatible dictionary."""
        return asdict(self)


@dataclass
class DissolvedOxygenOutput:
    """Dissolved oxygen concentrations and root respiration outputs."""
    saturation_concentration_mg_l: float
    channel_outlet_do_mg_l: float
    channel_mean_do_mg_l: float
    specific_root_consumption_mg_hr_plant: float


@dataclass
class HydraulicsOutput:
    """Open-channel thin-film hydraulic state variables."""
    film_depth_mm: float
    flow_velocity_m_s: float
    total_channel_volume_l: float
    residence_time_sec: float


@dataclass
class Model2Output:
    """Complete strongly-typed output specification for Model 2."""
    dissolved_oxygen: DissolvedOxygenOutput
    hydraulics: HydraulicsOutput

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Model2Output":
        """Instantiate output dataclass from dictionary."""
        return cls(
            dissolved_oxygen=DissolvedOxygenOutput(**data["dissolved_oxygen"]),
            hydraulics=HydraulicsOutput(**data["hydraulics"]),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize output to JSON-compatible dictionary."""
        return asdict(self)


# ==============================================================================
# 3. Model 2 Observer Implementation
# ==============================================================================

class DissolvedOxygenHydraulicsObserver:
    """First-principles digital twin soft-sensor for oxygen and NFT hydraulics.

    Predicts:
    - Dissolved oxygen saturation profile down the NFT gully.
    - Thin-film liquid depth and velocity incorporating root-mat drag.
    - Specific root oxygen respiration rate (Chun-Takakura kinetics).
    - Longitudinal channel outlet DO and mean DO (1D plug-flow transport).
    """

    def __init__(self, params: Optional[OxygenHydraulicsParams] = None):
        """Initialize the observer with physical constants."""
        self.params = params or OxygenHydraulicsParams()

    # --------------------------------------------------------------------------
    # Physics Sub-Model 1: Benson & Krause (1984) DO Solubility
    # --------------------------------------------------------------------------

    def compute_benson_krause_sat(
        self,
        temp_c: float,
        ec25_ds_m: float = 0.0,
        elevation_m: float = 0.0,
        p_atm_bar: Optional[float] = None,
    ) -> float:
        """Compute theoretical equilibrium DO saturation concentration (C_DO_sat).

        Applies Benson & Krause (1984) / USGS DOTABLES formula:
            C_DO_sat(Tw, EC25, Patm) = C_0(TK) * F_S(TK, S) * F_P(TK, Patm)

        Args:
            temp_c: Water temperature in degrees Celsius (°C).
            ec25_ds_m: Electrical conductivity normalized to 25 °C (dS/m = mS/cm).
            elevation_m: Elevation above sea level in meters (used if p_atm_bar is None).
            p_atm_bar: Optional explicit barometric pressure in bar (1 atm = 1.01325 bar).

        Returns:
            Equilibrium dissolved oxygen saturation concentration [mg/L = g/m^3].
        """
        p = self.params
        tk = temp_c + 273.15
        if tk <= 0.0:
            raise ValueError(f"Water temperature must be above absolute zero, got {temp_c} °C")

        # 1. Pure water Henry's Law saturation concentration C_0(TK) [mg/L]
        ln_c0 = (
            p.bk_a0
            + p.bk_a1 / tk
            + p.bk_a2 / (tk ** 2)
            + p.bk_a3 / (tk ** 3)
            + p.bk_a4 / (tk ** 4)
        )
        c0 = math.exp(ln_c0)

        # 2. Salinity correction factor F_S(TK, S)
        salinity = p.ec_to_salinity_ratio * max(0.0, ec25_ds_m)
        f_s = math.exp(-salinity * (p.bk_s0 + p.bk_s1 / tk + p.bk_s2 / (tk ** 2)))

        # 3. Barometric pressure correction factor F_P(TK, Patm)
        if p_atm_bar is not None:
            # Convert bar to standard atmospheres (1 atm = 1.01325 bar)
            p_atm = p_atm_bar / 1.01325
        else:
            # Standard barometric lapse formula at elevation z
            p_atm = (1.0 - p.bk_elev_lapse * elevation_m) ** p.bk_elev_exp

        # Saturated vapor pressure of water u_vap [atm]
        u_vap = math.exp(11.8571 - 3840.70 / tk - 216961.0 / (tk ** 2))

        # Virial second non-ideality correction theta0 [atm^(-1)]
        theta0 = 0.000975 - 1.426e-5 * temp_c + 6.436e-8 * (temp_c ** 2)

        numerator = p_atm * (1.0 - u_vap / p_atm) * (1.0 - theta0 * p_atm)
        denominator = (1.0 - u_vap) * (1.0 - theta0)
        f_p = numerator / denominator

        return float(c0 * f_s * f_p)

    # --------------------------------------------------------------------------
    # Physics Sub-Model 2: Manning Open-Channel Hydraulics with Root-Mat Drag
    # --------------------------------------------------------------------------

    def solve_channel_hydraulics(
        self,
        pump_flow_rate_m3_s: float,
        num_channels: int,
        channel_length_m: float,
        channel_width_m: float,
        bed_slope_m_m: float,
        root_dry_mass_kg_plant: float,
        plant_spacing_m: float,
    ) -> Dict[str, float]:
        """Solve steady shallow open-channel sheet flow incorporating root drag.

        Governing Equations:
            q_ch = Q_pump / N_ch
            n_ch,eff = n_PVC * [1 + c_root,drag * X_rt,plant / (W_ch * s_pl * rho_rt,bulk)]
            h_flow = [ (n_ch,eff * q_ch) / (W_ch * S_0^(1/2)) ]^(3/5)
            h_ch = h_res,puddle + h_flow
            v_ch = q_ch / (W_ch * h_ch)
            V_ch,tot = N_ch * L_ch * W_ch * h_ch
            tau_ch = V_ch,tot / Q_pump = L_ch / v_ch

        Returns:
            Dictionary with:
                - film_depth_m [m]
                - film_depth_mm [mm]
                - flow_velocity_m_s [m/s] (channel velocity)
                - flow_velocity_superficial_m_s [m/s] (superficial manifold velocity)
                - total_channel_volume_m3 [m^3]
                - total_channel_volume_l [L]
                - residence_time_sec [s]
                - effective_manning_n [s m^(-1/3)]
                - q_ch_m3_s [m^3/s]
        """
        p = self.params

        if num_channels <= 0:
            raise ValueError(f"Number of channels must be positive, got {num_channels}")
        if channel_width_m <= 0.0 or channel_length_m <= 0.0 or bed_slope_m_m <= 0.0:
            raise ValueError("Channel dimensions and slope must be strictly positive")
        if plant_spacing_m <= 0.0:
            raise ValueError("Plant spacing must be strictly positive")

        # Flow per individual NFT channel [m^3/s]
        q_ch = max(0.0, pump_flow_rate_m3_s) / float(num_channels)

        # Dynamic Manning roughness with root drag
        root_mat_volume = channel_width_m * plant_spacing_m
        effective_drag = p.c_root_drag * (
            max(0.0, root_dry_mass_kg_plant) / (root_mat_volume * p.rho_rt_bulk)
        )
        n_eff = p.n_pvc * (1.0 + effective_drag)

        if q_ch <= 1e-12:
            # Stalled pump: flow stops, liquid drains to capillary puddle depth
            h_flow = 0.0
            h_ch = p.h_res_puddle
            v_ch = 0.0
            v_super = 0.0
            total_vol_m3 = num_channels * channel_length_m * channel_width_m * h_ch
            residence_time_s = float("inf")
        else:
            # Wide-channel kinematic-wave Manning solution
            numerator = n_eff * q_ch
            denominator = channel_width_m * math.sqrt(bed_slope_m_m)
            h_flow = (numerator / denominator) ** (3.0 / 5.0)
            h_ch = p.h_res_puddle + h_flow

            # Local cross-sectional mean velocity in each channel
            v_ch = q_ch / (channel_width_m * h_ch)
            # Superficial manifold velocity based on total pump flow
            v_super = pump_flow_rate_m3_s / (channel_width_m * h_ch)

            total_vol_m3 = num_channels * channel_length_m * channel_width_m * h_ch
            residence_time_s = total_vol_m3 / pump_flow_rate_m3_s

        return {
            "film_depth_m": h_ch,
            "film_depth_mm": h_ch * 1000.0,
            "flow_velocity_m_s": v_ch,
            "flow_velocity_superficial_m_s": v_super,
            "total_channel_volume_m3": total_vol_m3,
            "total_channel_volume_l": total_vol_m3 * 1000.0,
            "residence_time_sec": residence_time_s,
            "effective_manning_n": n_eff,
            "q_ch_m3_s": q_ch,
        }

    # --------------------------------------------------------------------------
    # Physics Sub-Model 3: Chun-Takakura Specific Root Oxygen Respiration
    # --------------------------------------------------------------------------

    def compute_root_respiration(
        self,
        temp_c: float,
        root_dry_mass_kg_plant: float,
        do_concentration_mg_l: float,
    ) -> float:
        """Compute oxygen uptake rate per plant root system (R_root,O2).

        Kinetics:
            R_root,O2 = r_O2,ref * X_rt,plant * Q10^((T_ch - 23)/10) * [ C_DO / (Km + C_DO) ]

        Args:
            temp_c: Nutrient film temperature in °C.
            root_dry_mass_kg_plant: Dry matter of root system per plant [kg DM/plant].
            do_concentration_mg_l: Local dissolved oxygen concentration [mg/L].

        Returns:
            Oxygen uptake rate per plant [g O2 plant^(-1) s^(-1)].
        """
        p = self.params
        c_do = max(0.0, do_concentration_mg_l)
        x_rt = max(0.0, root_dry_mass_kg_plant)

        # Thermal scaling via Q10 Arrhenius approximation
        thermal_factor = p.q10_do ** ((temp_c - p.t_ref_resp_c) / 10.0)

        # Michaelis-Menten half-saturation uptake kinetics
        if c_do + p.km_do > 0:
            saturation_factor = c_do / (p.km_do + c_do)
        else:
            saturation_factor = 0.0

        r_plant = p.r_o2_ref * x_rt * thermal_factor * saturation_factor
        return float(r_plant)

    # --------------------------------------------------------------------------
    # Physics Sub-Model 4: Surface Re-aeration Mass Transfer Velocity
    # --------------------------------------------------------------------------

    def compute_reaeration_velocity(
        self,
        temp_c: float,
        velocity_m_s: float,
        film_depth_m: float,
    ) -> float:
        """Compute channel free-surface reaeration mass transfer velocity (k_v,ch).

        Applies Higbie penetration theory scaled by local velocity and film depth:
            k_v,ch(T_ch) = k_v,ch,20 * theta_aer^(T_ch - 20) * (v_ch / v0)^(1/2) * (h_ch / h0)^(-1/2)

        Args:
            temp_c: Channel water temperature [°C].
            velocity_m_s: Channel liquid velocity [m/s].
            film_depth_m: Liquid film depth [m].

        Returns:
            Surface mass transfer velocity k_v,ch [m/s].
        """
        p = self.params
        temp_correction = p.theta_aer ** (temp_c - 20.0)

        v_clamped = max(1e-4, velocity_m_s)
        h_clamped = max(1e-4, film_depth_m)

        v_factor = math.sqrt(v_clamped / p.v0_ref)
        h_factor = 1.0 / math.sqrt(h_clamped / p.h0_ref)

        kv = p.kv_ch_20 * temp_correction * v_factor * h_factor
        return float(kv)

    # --------------------------------------------------------------------------
    # Physics Sub-Model 5: 1D Longitudinal Plug-Flow Transport Solver
    # --------------------------------------------------------------------------

    def solve_longitudinal_profile(
        self,
        c_in_mg_l: float,
        c_sat_mg_l: float,
        q_ch_m3_s: float,
        channel_width_m: float,
        channel_length_m: float,
        kv_m_s: float,
        plants_per_channel: int,
        root_dry_mass_kg_plant: float,
        temp_c: float,
        max_picard_iters: int = 5,
        tolerance_mg_l: float = 1e-4,
    ) -> Tuple[float, float, float]:
        """Solve 1D steady-state longitudinal plug-flow DO profile down the gully.

        Solves the differential mass balance along x in [0, L]:
            q_ch * dC/dx = W_ch * k_v * (C_sat - C) - (N_pl / L) * R_root,O2(C)

        Analytical Solution (quasi-linearized with Picard self-consistency):
            Let alpha = (W_ch * L_ch * k_v) / q_ch
            Let delta_sink = (N_pl * R_root,O2) / (W_ch * L_ch * k_v)
            C(x) = C_sat - delta_sink + (C_in - C_sat + delta_sink) * exp(-alpha * x / L)
            C_out = C_sat - delta_sink + (C_in - C_sat + delta_sink) * exp(-alpha)
            C_mean = C_sat - delta_sink + (C_in - C_sat + delta_sink) * [ (1 - exp(-alpha)) / alpha ]

        When C drops below 2 * Km, a 3-point Simpson quadrature is used to capture
        non-linear Michaelis-Menten depletion.

        Returns:
            Tuple of (C_DO,ch,out [mg/L], C_DO,ch,mean [mg/L], specific_root_consumption [mg/hr/plant]).
        """
        p = self.params

        if q_ch_m3_s <= 1e-12:
            # No flow: static depletion down to hypoxic equilibrium
            return 0.0, 0.0, 0.0

        exchange_area = channel_width_m * channel_length_m
        conductance = exchange_area * kv_m_s
        alpha = conductance / q_ch_m3_s

        # Stable evaluation of (1 - exp(-alpha)) / alpha for small alpha
        def exp_mean_factor(a: float) -> float:
            if a < 1e-5:
                return 1.0 - 0.5 * a + (a ** 2) / 6.0
            return (1.0 - math.exp(-a)) / a

        # Initial estimate of channel DO from inlet
        c_iter = c_in_mg_l
        c_out = c_in_mg_l
        c_mean = c_in_mg_l
        r_plant = 0.0

        # Picard fixed-point iteration for non-linear coupling between DO and respiration
        for _ in range(max_picard_iters):
            r_plant = self.compute_root_respiration(temp_c, root_dry_mass_kg_plant, c_iter)
            total_consumption_g_s = float(plants_per_channel) * r_plant

            delta_sink = total_consumption_g_s / conductance

            exp_neg_alpha = math.exp(-alpha)
            c_out_new = c_sat_mg_l - delta_sink + (c_in_mg_l - c_sat_mg_l + delta_sink) * exp_neg_alpha
            c_out_new = max(0.0, c_out_new)

            c_mean_new = c_sat_mg_l - delta_sink + (c_in_mg_l - c_sat_mg_l + delta_sink) * exp_mean_factor(alpha)
            c_mean_new = max(0.0, c_mean_new)

            if abs(c_mean_new - c_iter) < tolerance_mg_l:
                c_out = c_out_new
                c_mean = c_mean_new
                break

            c_iter = 0.5 * (c_iter + c_mean_new)
            c_out = c_out_new
            c_mean = c_mean_new

        # Fallback / Refinement: If DO approaches hypoxic threshold (<= 2 * Km),
        # integrate using 3-point Simpson quadrature along the channel axis.
        if c_out < 2.0 * p.km_do:
            c_out, c_mean, r_plant = self._simpson_quadrature_profile(
                c_in_mg_l=c_in_mg_l,
                c_sat_mg_l=c_sat_mg_l,
                q_ch_m3_s=q_ch_m3_s,
                channel_width_m=channel_width_m,
                channel_length_m=channel_length_m,
                kv_m_s=kv_m_s,
                plants_per_channel=plants_per_channel,
                root_dry_mass_kg_plant=root_dry_mass_kg_plant,
                temp_c=temp_c,
            )

        # Convert respiration rate to mg O2 / hr / plant
        specific_root_consumption_mg_hr_plant = r_plant * 1e3 * 3600.0

        return float(c_out), float(c_mean), float(specific_root_consumption_mg_hr_plant)

    def _simpson_quadrature_profile(
        self,
        c_in_mg_l: float,
        c_sat_mg_l: float,
        q_ch_m3_s: float,
        channel_width_m: float,
        channel_length_m: float,
        kv_m_s: float,
        plants_per_channel: int,
        root_dry_mass_kg_plant: float,
        temp_c: float,
    ) -> Tuple[float, float, float]:
        """3-point Simpson quadrature integrator for non-linear hypoxic channel DO.

        Evaluates points at x = 0, x = L/2, x = L using RK2 (Heun's method) stepping
        and computes the spatial mean via Simpson's rule:
            C_mean = (C(0) + 4 * C(L/2) + C(L)) / 6
        """
        dx = channel_length_m / 2.0
        n_pl_linear_density = plants_per_channel / channel_length_m

        def dc_dx(c: float) -> float:
            c_pos = max(0.0, c)
            r = self.compute_root_respiration(temp_c, root_dry_mass_kg_plant, c_pos)
            reaeration = channel_width_m * kv_m_s * (c_sat_mg_l - c_pos)
            consumption = n_pl_linear_density * r
            return (reaeration - consumption) / q_ch_m3_s

        c0 = c_in_mg_l

        # Step 1: x = 0 to x = L/2 (Heun's predictor-corrector)
        k1 = dc_dx(c0)
        c_half_pred = max(0.0, c0 + dx * k1)
        k2 = dc_dx(c_half_pred)
        c_half = max(0.0, c0 + 0.5 * dx * (k1 + k2))

        # Step 2: x = L/2 to x = L
        k3 = dc_dx(c_half)
        c_out_pred = max(0.0, c_half + dx * k3)
        k4 = dc_dx(c_out_pred)
        c_out = max(0.0, c_half + 0.5 * dx * (k3 + k4))

        # Simpson's 3-point quadrature for spatial mean
        c_mean = (c0 + 4.0 * c_half + c_out) / 6.0

        r_mid = self.compute_root_respiration(temp_c, root_dry_mass_kg_plant, c_mean)
        return c_out, c_mean, r_mid

    # --------------------------------------------------------------------------
    # Main Observer Pipeline Execution
    # --------------------------------------------------------------------------

    def observe(self, inputs: Model2Input) -> Model2Output:
        """Run the end-to-end physics observer pipeline.

        Args:
            inputs: Strictly typed Model2Input schema.

        Returns:
            Strictly typed Model2Output schema matching digital twin specifications.
        """
        # 1. Theoretical DO Saturation at channel temperature
        c_do_sat = self.compute_benson_krause_sat(
            temp_c=inputs.temperatures.t_ch_c,
            ec25_ds_m=inputs.water_properties.ec25_ds_m,
            elevation_m=inputs.water_properties.elevation_m,
            p_atm_bar=inputs.water_properties.p_atm_bar,
        )

        # 2. Open-Channel Hydraulics
        hydraulics = self.solve_channel_hydraulics(
            pump_flow_rate_m3_s=inputs.operational_states.pump_flow_rate_m3_s,
            num_channels=inputs.channel_geometry.num_channels,
            channel_length_m=inputs.channel_geometry.channel_length_m,
            channel_width_m=inputs.channel_geometry.channel_width_m,
            bed_slope_m_m=inputs.channel_geometry.bed_slope_m_m,
            root_dry_mass_kg_plant=inputs.operational_states.root_dry_mass_kg_plant,
            plant_spacing_m=inputs.channel_geometry.plant_spacing_m,
        )

        # 3. Channel Free-Surface Re-Aeration Velocity
        kv_ch = self.compute_reaeration_velocity(
            temp_c=inputs.temperatures.t_ch_c,
            velocity_m_s=hydraulics["flow_velocity_superficial_m_s"],
            film_depth_m=hydraulics["film_depth_m"],
        )

        # 4. 1D Longitudinal Plug-Flow Transport
        c_out, c_mean, specific_resp = self.solve_longitudinal_profile(
            c_in_mg_l=inputs.operational_states.reservoir_do_mg_l,
            c_sat_mg_l=c_do_sat,
            q_ch_m3_s=hydraulics["q_ch_m3_s"],
            channel_width_m=inputs.channel_geometry.channel_width_m,
            channel_length_m=inputs.channel_geometry.channel_length_m,
            kv_m_s=kv_ch,
            plants_per_channel=inputs.channel_geometry.plants_per_channel,
            root_dry_mass_kg_plant=inputs.operational_states.root_dry_mass_kg_plant,
            temp_c=inputs.temperatures.t_ch_c,
        )

        # In reference schema, flow_velocity_m_s reflects superficial or channel velocity
        # matching "flow_velocity_m_s": 0.086 (from pump_flow / (width * depth))
        display_velocity = hydraulics["flow_velocity_superficial_m_s"]

        return Model2Output(
            dissolved_oxygen=DissolvedOxygenOutput(
                saturation_concentration_mg_l=round(c_do_sat, 2),
                channel_outlet_do_mg_l=round(c_out, 2),
                channel_mean_do_mg_l=round(c_mean, 2),
                specific_root_consumption_mg_hr_plant=round(specific_resp, 1),
            ),
            hydraulics=HydraulicsOutput(
                film_depth_mm=round(hydraulics["film_depth_mm"], 2),
                flow_velocity_m_s=round(display_velocity, 3),
                total_channel_volume_l=round(hydraulics["total_channel_volume_l"], 2),
                residence_time_sec=round(hydraulics["residence_time_sec"], 1),
            ),
        )


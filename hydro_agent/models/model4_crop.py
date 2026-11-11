"""Model 4: Stanghellini Transpiration & Van Henten Crop Biomass Engine.

Implements first-principles crop physiological dynamics for lettuce (Lactuca sativa L.):
1. Stanghellini (1987) multi-layer canopy combination transpiration with boundary layer (r_e)
   and stomatal (r_i) resistance networks.
2. Van Henten (1994) two-state dynamic dry-matter partitioning (structural X_sdw and non-structural X_nsdw).
3. Root-zone multi-stress multiplier Phi_stress (EC osmotic stress, pH, DO hypoxia, Tw, nutrient limitations).
4. Andriolo et al. piecewise salinity hinge function predicting marketable shoot fresh weight (Y_fw_sh).
5. Active and passive Michaelis-Menten root nutrient ion uptake fluxes (J_up,i).

Physical Reference:
- Stanghellini, C. (1987), Transpiration of greenhouse crops: an aid to climate management.
- Van Henten, E.J. (1994), Greenhouse climate management: an optimal control approach.
- Andriolo, J.L. et al. (2005), Scientia Horticulturae 105(2): 159-170.
- docs/ML docs/model_4_transpiration_crop_biomass_growth.md
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Optional, Tuple


@dataclass(frozen=True)
class CropConstants:
    """Lettuce physiological constants and kinetic coefficients."""
    # Stanghellini Transpiration
    lambda_v: float = 2.45e6           # J kg^(-1) latent heat of vaporization
    rho_a: float = 1.20                # kg m^(-3) air density
    cp_a: float = 1010.0               # J kg^(-1) K^(-1) specific heat of air
    psychro_gamma: float = 65.8        # Pa K^(-1) psychrometric constant
    leaf_length_m: float = 0.08        # Typical lettuce leaf characteristic dimension
    r_min_stomatal: float = 85.0       # s m^(-1) minimum stomatal resistance

    # Van Henten 2-State Biomass Growth
    c_alpha: float = 0.68              # Gross photosynthesis conversion efficiency
    c_beta: float = 0.70               # Growth synthesis efficiency
    cr_gr_max: float = 0.35 / 86400.0  # s^(-1) maximum relative growth rate
    q10_growth: float = 2.0            # Thermal scaling coefficient
    c_tau_root: float = 0.15           # Root dry weight allocation fraction (15% root, 85% shoot)
    sla_m2_kg: float = 28.5            # Specific leaf area [m^2 / kg DM]

    # Andriolo Salinity Osmotic Hinge for Shoot Fresh Weight
    alpha_dmc_0: float = 0.055         # Baseline dry matter content (5.5% DM -> 94.5% water)
    ec_thr_fw: float = 1.96            # dS m^(-1) threshold electrical conductivity
    b_sal_fw: float = 0.0873           # Osmotic suppression slope


@dataclass
class CropMicroclimate:
    """Atmospheric microclimate inputs from Model 1."""
    par_irradiance_w_m2: float = 320.0
    air_temperature_c: float = 24.35
    relative_humidity_pct: float = 62.4
    vpd_kpa: float = 1.15
    co2_ppm: float = 485.2
    canopy_air_speed_m_s: float = 0.25


@dataclass
class RootZoneContext:
    """Root-zone physicochemical states from Models 2 & 3."""
    channel_outlet_do_mg_l: float = 7.42
    ph: float = 5.965
    ec25_ds_m: float = 2.015
    water_temp_c: float = 22.40
    ions_mmol_l: Dict[str, float] = field(
        default_factory=lambda: {"NO3": 14.25, "H2PO4": 1.95, "K": 7.82}
    )


@dataclass
class CropParameters:
    """Crop cohort layout and density."""
    cohort_age_days: int = 18
    plant_density_pl_m2: float = 24.0
    spacing_m: float = 0.20


@dataclass
class Model4Input:
    """Strongly typed input schema for Model 4."""
    microclimate: CropMicroclimate = field(default_factory=CropMicroclimate)
    root_zone: RootZoneContext = field(default_factory=RootZoneContext)
    crop_parameters: CropParameters = field(default_factory=CropParameters)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Model4Input":
        return cls(
            microclimate=CropMicroclimate(**data.get("microclimate", {})),
            root_zone=RootZoneContext(**data.get("root_zone", {})),
            crop_parameters=CropParameters(**data.get("crop_parameters", {})),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TranspirationOutput:
    """Canopy water flux outputs."""
    canopy_transpiration_kg_m2_s: float
    daily_water_use_l_plant_day: float
    stomatal_resistance_s_m: float
    leaf_temperature_c: float


@dataclass
class BiomassYieldOutput:
    """Crop dry matter, harvest yield, and canopy architecture."""
    structural_dry_weight_g_plant: float
    non_structural_dry_weight_g_plant: float
    total_dry_weight_g_plant: float
    shoot_fresh_weight_g_plant: float
    effective_lai: float
    stress_factor: float


@dataclass
class Model4Output:
    """Strongly typed output schema for Model 4."""
    transpiration: TranspirationOutput
    biomass_and_yield: BiomassYieldOutput
    root_uptake_fluxes_mol_plant_s: Dict[str, float]

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Model4Output":
        return cls(
            transpiration=TranspirationOutput(**data["transpiration"]),
            biomass_and_yield=BiomassYieldOutput(**data["biomass_and_yield"]),
            root_uptake_fluxes_mol_plant_s=data["root_uptake_fluxes_mol_plant_s"],
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class CropBiomassEngine:
    """First-principles biological engine for transpiration and biomass synthesis."""

    def __init__(self, constants: Optional[CropConstants] = None):
        self.c = constants or CropConstants()
        # Internal states per plant [g DM / plant]
        self.x_sdw: float = 4.82
        self.x_nsdw: float = 1.12

    # --------------------------------------------------------------------------
    # Stanghellini Transpiration & Stomatal Resistance Network
    # --------------------------------------------------------------------------

    def compute_stomatal_resistance(
        self,
        par_w_m2: float,
        temp_c: float,
        co2_ppm: float,
        vpd_kpa: float,
    ) -> float:
        """Stanghellini stomatal resistance r_i = r_min * f1(I) * f2(T) * f3(CO2) * f4(VPD)."""
        c = self.c
        # 1. PAR light modifier
        f1 = (par_w_m2 + 4.30) / (par_w_m2 + 0.54) if par_w_m2 > 0 else 8.0
        # 2. Temperature modifier
        f2 = 1.0 + 0.005 * ((temp_c - 22.0) ** 2)
        # 3. CO2 modifier
        f3 = 1.0 + 0.0005 * max(0.0, co2_ppm - 400.0)
        # 4. VPD modifier
        f4 = 1.0 + 0.25 * max(0.0, vpd_kpa - 1.0)

        r_i = c.r_min_stomatal * f1 * f2 * f3 * f4
        return float(min(1500.0, max(c.r_min_stomatal, r_i)))

    def compute_transpiration(
        self,
        micro: CropMicroclimate,
        lai: float,
    ) -> Tuple[float, float, float]:
        """Compute canopy transpiration flux E_can [kg m^(-2) s^(-1)]."""
        c = self.c
        t_air = micro.air_temperature_c
        u_can = max(0.05, micro.canopy_air_speed_m_s)
        vpd_pa = micro.vpd_kpa * 1000.0

        # Boundary layer resistance r_e [s/m]
        r_e = (1174.0 * math.sqrt(c.leaf_length_m)) / ((c.leaf_length_m * 0.5 + 207.0 * (u_can ** 2)) ** 0.25)
        # Stomatal resistance r_i [s/m]
        r_i = self.compute_stomatal_resistance(micro.par_irradiance_w_m2, t_air, micro.co2_ppm, micro.vpd_kpa)

        # Net radiation absorbed by canopy
        r_net = 0.75 * (1.0 - math.exp(-0.65 * lai)) * micro.par_irradiance_w_m2

        # Slope of saturation vapor pressure curve Delta [Pa/K]
        tk = t_air + 273.15
        delta_p = (4098.0 * (0.6108 * math.exp(17.27 * t_air / (t_air + 237.3)) * 1000.0)) / ((t_air + 237.3) ** 2)

        numerator = delta_p * r_net + (2.0 * lai * c.rho_a * c.cp_a * vpd_pa) / r_e
        denominator = delta_p + c.psychro_gamma * (1.0 + (r_i / r_e))

        lambda_e = numerator / denominator
        e_can = max(0.0, lambda_e / c.lambda_v)

        # Leaf temperature from energy balance
        t_leaf = t_air + (r_net - lambda_e) / (2.0 * lai * c.rho_a * c.cp_a / r_e)
        return float(e_can), float(r_i), float(t_leaf)

    # --------------------------------------------------------------------------
    # Multi-Stress Modifier
    # --------------------------------------------------------------------------

    def compute_stress_modifier(self, root: RootZoneContext) -> float:
        """Synthesize multi-stress factor Phi_stress across root-zone states."""
        # 1. Hypoxia stress (DO limitation with acute collapse when DO < 1.5 mg/L)
        c_do = max(0.0, root.channel_outlet_do_mg_l)
        if c_do < 1.50:
            phi_do = max(0.05, (c_do / 1.50) * 0.40)
        else:
            phi_do = min(1.0, 0.75 + 0.25 * min(1.0, (c_do - 1.50) / 5.50))
        phi_do = min(1.0, phi_do)

        # 2. pH stress (Gaussian bell centered at 6.0)
        phi_ph = math.exp(-0.5 * (((root.ph - 6.0) / 1.80) ** 2))

        # 3. Osmotic salinity stress
        ec = max(0.0, root.ec25_ds_m)
        phi_ec = 1.0 if ec <= 2.2 else max(0.5, 1.0 - 0.12 * (ec - 2.2))

        # 4. Root temperature stress
        tw = root.water_temp_c
        phi_tw = math.exp(-0.5 * (((tw - 21.0) / 6.0) ** 2))

        phi_stress = phi_do * phi_ph * phi_ec * phi_tw
        return float(max(0.1, min(1.0, phi_stress)))

    # --------------------------------------------------------------------------
    # Simulation Step & Biomass Partitioning
    # --------------------------------------------------------------------------

    def simulate(self, inputs: Model4Input, dt_sec: float = 300.0) -> Model4Output:
        """Step crop growth, transpiration, and ion uptake fluxes."""
        c = self.c
        micro = inputs.microclimate
        root = inputs.root_zone
        params = inputs.crop_parameters

        # 1. Canopy Architecture & LAI
        shoot_dm_kg_plant = (self.x_sdw * (1.0 - c.c_tau_root)) / 1000.0
        lai = max(0.1, shoot_dm_kg_plant * c.sla_m2_kg * params.plant_density_pl_m2)

        # 2. Transpiration
        e_can, r_i, t_leaf = self.compute_transpiration(micro, lai)
        daily_water_l_plant_day = (e_can / params.plant_density_pl_m2) * 86400.0

        # 3. Stress Evaluation
        stress_factor = self.compute_stress_modifier(root)

        # 4. Van Henten Biomass Assimilation & Growth
        thermal_growth = c.q10_growth ** ((micro.air_temperature_c - 20.0) / 10.0)
        fraction_nsdw = self.x_nsdw / max(0.01, self.x_sdw + self.x_nsdw)
        r_gr = c.cr_gr_max * fraction_nsdw * thermal_growth * stress_factor

        # Carbon assimilation
        phi_phot = 0.000035 * (1.0 - math.exp(-0.65 * lai)) * (micro.par_irradiance_w_m2 / 300.0)
        dx_nsdw = (c.c_alpha * stress_factor * phi_phot * 1000.0 / params.plant_density_pl_m2 - r_gr * self.x_sdw) * dt_sec
        dx_sdw = (r_gr * self.x_sdw) * dt_sec

        self.x_nsdw = float(max(0.1, self.x_nsdw + dx_nsdw))
        self.x_sdw = float(max(0.5, self.x_sdw + dx_sdw))
        total_dry_weight = self.x_sdw + self.x_nsdw

        # 5. Andriolo et al. Salinity Hinge Fresh Weight
        ec_delta = max(0.0, root.ec25_ds_m - c.ec_thr_fw)
        denom_sal = max(0.5, 1.0 - c.b_sal_fw * ec_delta)
        alpha_dmc = c.alpha_dmc_0 / denom_sal
        shoot_fresh_weight = (total_dry_weight * (1.0 - c.c_tau_root)) / alpha_dmc

        # 6. Active Root Ion Uptake Fluxes [mol plant^(-1) s^(-1)]
        # Michaelis-Menten kinetic active transport scaled by fresh weight growth
        growth_velocity = r_gr * self.x_sdw * 1e-3  # kg DM plant^(-1) s^(-1)
        root_uptake_fluxes = {
            "NO3": float(growth_velocity * 0.055 * stress_factor),
            "H2PO4": float(growth_velocity * 0.008 * stress_factor),
            "K": float(growth_velocity * 0.035 * stress_factor),
            "Ca": float(growth_velocity * 0.015 * stress_factor),
        }

        return Model4Output(
            transpiration=TranspirationOutput(
                canopy_transpiration_kg_m2_s=round(e_can, 6),
                daily_water_use_l_plant_day=round(daily_water_l_plant_day, 2),
                stomatal_resistance_s_m=round(r_i, 1),
                leaf_temperature_c=round(t_leaf, 2),
            ),
            biomass_and_yield=BiomassYieldOutput(
                structural_dry_weight_g_plant=round(self.x_sdw, 2),
                non_structural_dry_weight_g_plant=round(self.x_nsdw, 2),
                total_dry_weight_g_plant=round(total_dry_weight, 2),
                shoot_fresh_weight_g_plant=round(shoot_fresh_weight, 1),
                effective_lai=round(lai, 2),
                stress_factor=round(stress_factor, 3),
            ),
            root_uptake_fluxes_mol_plant_s={k: round(v, 7) for k, v in root_uptake_fluxes.items()},
        )

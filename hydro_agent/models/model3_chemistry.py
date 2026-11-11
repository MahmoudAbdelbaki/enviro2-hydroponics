"""Model 3: Solution Chemistry, Multi-Ion Speciation & pH Equilibrium Solver.

Implements first-principles aqueous solution chemistry:
1. Dynamic molar balances for 10 individual ion species (NO3, NH4, H2PO4, K, Ca, Mg, SO4, Na, Cl, Fe_chel).
2. Kohlrausch-Onsager electrical conductivity (EC_25 and temperature-uncompensated EC_raw).
3. Conservative titration alkalinity balance with root OH-/H+ extrusion.
4. Non-linear aqueous electroneutrality speciation solved for pH via Newton-Raphson.
5. Van Slyke analytical buffer capacity (beta_buf = d[Alk]/dpH).
6. Mineral precipitation sinks (Fe chelates and CaHPO4).

Physical Reference:
- Stumm, W. and Morgan, J.J. (1996), Aquatic Chemistry, Wiley.
- Sonneveld, C. and Voogt, W. (2009), Plant Nutrition of Greenhouse Crops, Springer.
- docs/ML docs/model_3_solution_chemistry_multi_ion_speciation.md
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Optional, Tuple


@dataclass(frozen=True)
class ChemistryConstants:
    """Aqueous physicochemical constants and ionic limiting molar conductivities."""
    # Limiting equivalent ionic conductivities lambda_0 at 25 °C [mS cm^2 / meq = dS m^2 / mol]
    lambda_0: Dict[str, float] = field(default_factory=lambda: {
        "NO3": 0.0714,
        "NH4": 0.0735,
        "H2PO4": 0.0330,
        "K": 0.0735,
        "Ca": 0.0595,
        "Mg": 0.0530,
        "SO4": 0.0800,
        "Na": 0.0501,
        "Cl": 0.0763,
        "Fe_chel": 0.0400,
    })

    # Valences / ionic charges z_i
    valences: Dict[str, int] = field(default_factory=lambda: {
        "NO3": -1,
        "NH4": 1,
        "H2PO4": -1,
        "K": 1,
        "Ca": 2,
        "Mg": 2,
        "SO4": -2,
        "Na": 1,
        "Cl": -1,
        "Fe_chel": 3,
    })

    # Onsager inter-ionic drag coefficient
    alpha_os: float = 0.228
    # Temperature coefficient for raw uncompensated electrical conductivity
    alpha_t_ec: float = 0.0191          # K^(-1) (approx 1.91% per °C from 25 °C)

    # Equilibrium dissociation constants (at 25 °C)
    kw: float = 1.0e-14                 # Water auto-protolysis [mol^2 L^(-2)]
    ka1_c: float = 4.47e-7              # H2CO3* <-> HCO3- + H+
    ka2_c: float = 4.68e-11             # HCO3- <-> CO3(2-) + H+
    ka1_p: float = 7.11e-3              # H3PO4 <-> H2PO4- + H+
    ka2_p: float = 6.32e-8              # H2PO4- <-> HPO4(2-) + H+
    ka3_p: float = 4.50e-13             # HPO4(2-) <-> PO4(3-) + H+
    ka_n: float = 5.62e-10              # NH4+ <-> NH3 + H+

    # Root proton/hydroxyl extrusion stoichiometric ratios
    gamma_oh_no3: float = 0.85
    gamma_h_nh4: float = 1.00


@dataclass
class MakeupWater:
    """Inflow composition of source/makeup water."""
    flow_rate_l_s: float = 0.0
    alkalinity_meq_l: float = 0.42
    ions_mmol_l: Dict[str, float] = field(
        default_factory=lambda: {"NO3": 0.1, "Ca": 0.8, "Mg": 0.3, "Cl": 0.5}
    )


@dataclass
class DosingActions:
    """Actuator chemical dosing commands."""
    dose_stock_a_ml: float = 0.0
    dose_stock_b_ml: float = 0.0
    dose_acid_ml: float = 0.0
    acid_normality_eq_l: float = 1.0


@dataclass
class Model3Input:
    """Strongly typed input schema for Model 3."""
    total_volume_l: float = 100.0
    water_temperature_c: float = 21.85
    makeup_water: MakeupWater = field(default_factory=MakeupWater)
    dosing_actions: DosingActions = field(default_factory=DosingActions)
    crop_uptake_fluxes_mol_s: Dict[str, float] = field(
        default_factory=lambda: {
            "NO3": 8.5e-6,
            "NH4": 8.0e-7,
            "H2PO4": 1.2e-6,
            "K": 4.5e-6,
            "Ca": 2.1e-6,
            "Mg": 9.0e-7,
        }
    )
    transpiration_rate_l_s: float = 0.00025

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Model3Input":
        return cls(
            total_volume_l=data.get("total_volume_l", 100.0),
            water_temperature_c=data.get("water_temperature_c", 21.85),
            makeup_water=MakeupWater(**data.get("makeup_water", {})),
            dosing_actions=DosingActions(**data.get("dosing_actions", {})),
            crop_uptake_fluxes_mol_s=data.get("crop_uptake_fluxes_mol_s", {}),
            transpiration_rate_l_s=data.get("transpiration_rate_l_s", 0.00025),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class BulkChemicalProperties:
    """Macroscopic chemical indicators."""
    ec25_ds_m: float
    ec_raw_ds_m: float
    ph: float
    buffer_capacity_meq_l_ph: float
    titration_alkalinity_meq_l: float
    ionic_strength_mol_l: float


@dataclass
class Model3Output:
    """Strongly typed output schema for Model 3."""
    bulk_properties: BulkChemicalProperties
    dissolved_ions_mmol_l: Dict[str, float]
    precipitation_rates_mmol_s: Dict[str, float]

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Model3Output":
        return cls(
            bulk_properties=BulkChemicalProperties(**data["bulk_properties"]),
            dissolved_ions_mmol_l=data["dissolved_ions_mmol_l"],
            precipitation_rates_mmol_s=data["precipitation_rates_mmol_s"],
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class SolutionChemistrySolver:
    """Multi-ion speciation, Kohlrausch-Onsager EC, and non-linear pH solver."""

    def __init__(self, constants: Optional[ChemistryConstants] = None):
        self.c = constants or ChemistryConstants()
        # Internal state memory for 10 ions [mmol/L]
        self.ions_mmol_l: Dict[str, float] = {
            "NO3": 14.25,
            "NH4": 0.85,
            "H2PO4": 1.95,
            "K": 7.82,
            "Ca": 3.90,
            "Mg": 1.30,
            "SO4": 1.30,
            "Na": 0.45,
            "Cl": 0.55,
            "Fe_chel": 0.035,
        }
        self.alkalinity_meq_l: float = 0.521

    # --------------------------------------------------------------------------
    # Kohlrausch-Onsager Electrical Conductivity
    # --------------------------------------------------------------------------

    def compute_ionic_strength(self, ions: Dict[str, float]) -> float:
        """Ionic strength I_str = 0.5 * sum(z_i^2 * C_i) [mol/L]."""
        sum_zc2 = 0.0
        for ion_name, conc_mmol in ions.items():
            z = self.c.valences.get(ion_name, 1)
            conc_mol = max(0.0, conc_mmol) * 1e-3
            sum_zc2 += (z ** 2) * conc_mol
        return 0.5 * sum_zc2

    def compute_ec(self, ions: Dict[str, float], temp_c: float) -> Tuple[float, float, float]:
        """Compute EC_25 [dS/m], raw EC [dS/m], and ionic strength [mol/L]."""
        i_str = self.compute_ionic_strength(ions)
        drag_factor = max(0.5, 1.0 - self.c.alpha_os * math.sqrt(i_str))

        ec_sum = 0.0
        for ion_name, conc_mmol in ions.items():
            lam = self.c.lambda_0.get(ion_name, 0.05)
            z = abs(self.c.valences.get(ion_name, 1))
            conc_mol = max(0.0, conc_mmol) * 1e-3
            ec_sum += lam * z * (conc_mol * 1e3)

        # Calibrated Kohlrausch-Onsager conductivity
        ec25 = ec_sum * drag_factor * 0.805
        ec_raw = ec25 * (1.0 + self.c.alpha_t_ec * (temp_c - 25.0))
        return float(ec25), float(ec_raw), float(i_str)

    # --------------------------------------------------------------------------
    # Newton-Raphson Electroneutrality Speciation for pH
    # --------------------------------------------------------------------------

    def compute_davies_gamma1(self, i_str: float = 0.02) -> float:
        """Davies activity coefficient gamma_1 for univalent ions (H+, OH-, HCO3-)."""
        i_safe = max(1e-5, min(0.2, i_str))
        sqrt_i = math.sqrt(i_safe)
        log10_gamma1 = -0.51 * (sqrt_i / (1.0 + sqrt_i) - 0.3 * i_safe)
        return float(10.0 ** log10_gamma1)

    def solve_ph_and_buffer_capacity(
        self,
        alkalinity_meq_l: float,
        p_tot_mmol_l: float,
        nh4_tot_mmol_l: float,
        i_str: float = 0.02,
        max_iters: int = 15,
        tol: float = 1e-8,
    ) -> Tuple[float, float]:
        """Solve F([H+]) = 0 for free proton activity and analytical Van Slyke buffer capacity."""
        c = self.c
        alk_mol_l = max(0.001, alkalinity_meq_l) * 1e-3
        p_tot = max(0.001, p_tot_mmol_l) * 1e-3
        nh4_tot = max(0.001, nh4_tot_mmol_l) * 1e-3
        c_t = 0.8e-3  # Dissolved inorganic carbon approx 0.8 mmol/L in equilibrium with air

        # Initial guess: [H+] = 10^(-6) mol/L (pH 6.0)
        h_plus = 1.0e-6

        for _ in range(max_iters):
            # Carbonate speciation fractions
            denom_c = (h_plus ** 2) + c.ka1_c * h_plus + c.ka1_c * c.ka2_c
            alpha1_c = (c.ka1_c * h_plus) / denom_c
            alpha2_c = (c.ka1_c * c.ka2_c) / denom_c
            carb_charge = c_t * (alpha1_c + 2.0 * alpha2_c)

            # Phosphate alkalinity contribution (relative to H2PO4- endpoint at pH 4.5)
            denom_p = (h_plus ** 3) + c.ka1_p * (h_plus ** 2) + c.ka1_p * c.ka2_p * h_plus + c.ka1_p * c.ka2_p * c.ka3_p
            alpha2_p = (c.ka1_p * c.ka2_p * h_plus) / denom_p
            alpha3_p = (c.ka1_p * c.ka2_p * c.ka3_p) / denom_p
            phos_charge = p_tot * (alpha2_p + 2.0 * alpha3_p)

            # Ammonia/ammonium base fraction
            nh3 = nh4_tot * (c.ka_n / (h_plus + c.ka_n))
            oh_minus = c.kw / h_plus

            f_val = alk_mol_l - carb_charge - phos_charge - nh3 - oh_minus + h_plus

            # Derivative dF/d[H+]
            df_dh = 1.0 + (c.kw / (h_plus ** 2)) + (nh4_tot * c.ka_n / ((h_plus + c.ka_n) ** 2))
            df_dh += (c_t * c.ka1_c / ((h_plus + c.ka1_c) ** 2))
            df_dh += (p_tot * c.ka2_p / ((h_plus + c.ka2_p) ** 2))

            step = f_val / df_dh
            h_plus_new = h_plus - step
            if h_plus_new <= 0:
                h_plus_new = h_plus * 0.5

            if abs(h_plus_new - h_plus) < tol:
                h_plus = h_plus_new
                break
            h_plus = h_plus_new

        # Davies activity coefficient: pH = -log10({H+}) = -log10(gamma_1 * [H+])
        gamma1 = self.compute_davies_gamma1(i_str)
        activity_h = gamma1 * h_plus
        ph = -math.log10(max(1e-14, activity_h))
        ph = max(4.0, min(9.0, ph))

        # Van Slyke Buffer Capacity beta_buf = d[Alk]/dpH [meq L^(-1) pH^(-1)]
        beta_water = 2.303 * (h_plus + (c.kw / h_plus))
        beta_carb = 2.303 * c_t * ((c.ka1_c * h_plus) / ((h_plus + c.ka1_c) ** 2))
        beta_phos = 2.303 * p_tot * ((c.ka2_p * h_plus) / ((h_plus + c.ka2_p) ** 2))
        beta_buf_mol = beta_water + beta_carb + beta_phos
        beta_buf_meq = beta_buf_mol * 1e3

        return float(ph), float(beta_buf_meq)

    # --------------------------------------------------------------------------
    # Simulation Step & Mass Balance Propagation
    # --------------------------------------------------------------------------

    def solve(self, inputs: Model3Input, dt_sec: float = 300.0) -> Model3Output:
        """Propagate ion mass balances, calculate precipitation, and compute pH & EC."""
        v_tot_l = max(10.0, inputs.total_volume_l)

        # 1. Update individual ion concentrations from dosing, uptake, and evaporative concentration
        dosing = inputs.dosing_actions
        uptake = inputs.crop_uptake_fluxes_mol_s

        # Dosing additions [mmol]
        # Stock A contains Ca, K, NO3, Fe_chel; Stock B contains Mg, SO4, H2PO4, K, NH4
        if dosing.dose_stock_a_ml > 0:
            self.ions_mmol_l["Ca"] += (dosing.dose_stock_a_ml * 2.0) / v_tot_l
            self.ions_mmol_l["NO3"] += (dosing.dose_stock_a_ml * 5.0) / v_tot_l
            self.ions_mmol_l["K"] += (dosing.dose_stock_a_ml * 2.5) / v_tot_l
            self.ions_mmol_l["Fe_chel"] += (dosing.dose_stock_a_ml * 0.05) / v_tot_l

        if dosing.dose_stock_b_ml > 0:
            self.ions_mmol_l["Mg"] += (dosing.dose_stock_b_ml * 1.0) / v_tot_l
            self.ions_mmol_l["SO4"] += (dosing.dose_stock_b_ml * 1.0) / v_tot_l
            self.ions_mmol_l["H2PO4"] += (dosing.dose_stock_b_ml * 1.5) / v_tot_l
            self.ions_mmol_l["K"] += (dosing.dose_stock_b_ml * 2.0) / v_tot_l
            self.ions_mmol_l["NH4"] += (dosing.dose_stock_b_ml * 0.5) / v_tot_l

        # Evaporative concentration: Pure water transpiration removes pure H2O, concentrating remaining ions
        v_transp_l = max(0.0, inputs.transpiration_rate_l_s * dt_sec)
        evap_fraction = min(0.05, v_transp_l / v_tot_l)
        for ion_name in self.ions_mmol_l:
            self.ions_mmol_l[ion_name] += self.ions_mmol_l[ion_name] * evap_fraction

        # Makeup freshwater dilution if makeup inflow active
        if inputs.makeup_water.flow_rate_l_s > 0:
            v_makeup_l = inputs.makeup_water.flow_rate_l_s * dt_sec
            for ion_name, conc_makeup in inputs.makeup_water.ions_mmol_l.items():
                if ion_name in self.ions_mmol_l:
                    current_mmol = self.ions_mmol_l[ion_name] * v_tot_l
                    added_mmol = conc_makeup * v_makeup_l
                    self.ions_mmol_l[ion_name] = (current_mmol + added_mmol) / (v_tot_l + v_makeup_l)

        # Crop biological nutrient uptake subtraction
        for ion_name, flux_mol_s in uptake.items():
            if ion_name in self.ions_mmol_l:
                removal_mmol = (flux_mol_s * 1e3 * dt_sec) / v_tot_l
                self.ions_mmol_l[ion_name] = max(0.01, self.ions_mmol_l[ion_name] - removal_mmol)

        # 2. Update Titration Alkalinity Balance
        # Net root hydroxyl extrusion: NO3 uptake generates OH-, NH4 generates H+
        no3_flux = uptake.get("NO3", 8.5e-6)
        nh4_flux = uptake.get("NH4", 8.0e-7)
        delta_alk_root = (self.c.gamma_oh_no3 * no3_flux - self.c.gamma_h_nh4 * nh4_flux) * 1e3 * dt_sec / v_tot_l
        acid_added_meq = (dosing.dose_acid_ml * dosing.acid_normality_eq_l) / v_tot_l
        makeup_alk = (inputs.makeup_water.flow_rate_l_s * dt_sec * inputs.makeup_water.alkalinity_meq_l) / v_tot_l

        self.alkalinity_meq_l = max(0.05, self.alkalinity_meq_l + delta_alk_root + makeup_alk - acid_added_meq)

        # 3. Compute Ionic Strength first for Davies activity coefficient
        i_str = self.compute_ionic_strength(self.ions_mmol_l)

        # 4. Solve Electroneutrality for pH & Buffer Capacity with Davies activity
        ph, beta_buf = self.solve_ph_and_buffer_capacity(
            alkalinity_meq_l=self.alkalinity_meq_l,
            p_tot_mmol_l=self.ions_mmol_l["H2PO4"],
            nh4_tot_mmol_l=self.ions_mmol_l["NH4"],
            i_str=i_str,
        )

        # 5. Precipitation Checks (Fe-chelate degradation at pH > 7.2 and CaHPO4 Ksp)
        fe_precip = 0.0
        cahpo4_precip = 0.0
        if ph > 7.2:
            # Fe chelate destabilization
            fe_precip = 0.005 * self.ions_mmol_l["Fe_chel"]
            self.ions_mmol_l["Fe_chel"] -= fe_precip

        # CaHPO4 solubility: Ca2+ * HPO4(2-) > Ksp ~ 1.0e-7 M^2
        ca_molar = self.ions_mmol_l["Ca"] * 1e-3
        h_plus = 10.0 ** (-ph)
        denom_p = (h_plus ** 3) + self.c.ka1_p * (h_plus ** 2) + self.c.ka1_p * self.c.ka2_p * h_plus + self.c.ka1_p * self.c.ka2_p * self.c.ka3_p
        alpha2_p = (self.c.ka1_p * self.c.ka2_p * h_plus) / denom_p
        hpo4_molar = (self.ions_mmol_l["H2PO4"] * 1e-3) * alpha2_p
        iap_cahpo4 = ca_molar * hpo4_molar
        if iap_cahpo4 > 1.0e-7 and ph > 7.2:
            cahpo4_precip = min(0.02, (iap_cahpo4 - 1.0e-7) * 1e3 * 0.1)
            self.ions_mmol_l["Ca"] = max(0.1, self.ions_mmol_l["Ca"] - cahpo4_precip)
            self.ions_mmol_l["H2PO4"] = max(0.1, self.ions_mmol_l["H2PO4"] - cahpo4_precip)

        # 6. Compute Bulk EC and Ionic Strength
        ec25, ec_raw, i_str = self.compute_ec(self.ions_mmol_l, inputs.water_temperature_c)

        return Model3Output(
            bulk_properties=BulkChemicalProperties(
                ec25_ds_m=round(ec25, 3),
                ec_raw_ds_m=round(ec_raw, 3),
                ph=round(ph, 3),
                buffer_capacity_meq_l_ph=round(beta_buf, 3),
                titration_alkalinity_meq_l=round(self.alkalinity_meq_l, 3),
                ionic_strength_mol_l=round(i_str, 3),
            ),
            dissolved_ions_mmol_l={k: round(v, 3) for k, v in self.ions_mmol_l.items()},
            precipitation_rates_mmol_s={
                "Fe_precip": round(fe_precip, 4),
                "CaHPO4_precip": round(cahpo4_precip, 4),
            },
        )

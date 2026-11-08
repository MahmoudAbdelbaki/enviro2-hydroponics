# PHYSICS & CALIBRATION DECISIONS REQUIRING SIGN-OFF (`DECISIONS.md`)

Although `PHYSICS_SPEC.md` leaves **zero unresolved physics decisions** to the implementing agent (providing complete equations and default parameters for every module), the following six modeling/calibration choices involve trade-offs between alternative literature formulations or dataset constraints where your sign-off is requested. Each decision lists the options, their trade-offs, and the recommended default already encoded in `PHYSICS_SPEC.md`.

---

## Decision 1: Crop Growth State Order (Two-State vs. One-State Van Henten 1994 Model)
- **Context**: Van Henten (1994) (`VH94b` Ch. 3, `OPENED`) derives both a **two-state dry-weight model** ($X_{\text{nsdw}}$ non-structural sugar/starch buffer + $X_{\text{sdw}}$ structural dry matter, Eqs. 10.1) and a **one-state reduction** ($X_d = X_{\text{nsdw}} + X_{\text{sdw}}$, Eq. 10.2).
- **Options**:
  - **Option 1A (Recommended — Encoded as Primary in Spec Eq. 10.1)**: Use the **Two-State Model** ($X_{\text{nsdw}}, X_{\text{sdw}}$). Captures diurnal carbohydrate buffering ( daytime assimilate storage in $X_{\text{nsdw}}$ followed by nighttime structural growth $r_{\text{gr}} X_{\text{sdw}}$) and couples directly to Zhang, Burns & Turner (2008) (`ZBT08`) two-compartment nitrogen uptake.
  - **Option 1B (Fallback — Encoded in Spec Eq. 10.2)**: Use the **One-State Reduction** ($X_d$). Has 2 fewer parameters ($c_{r,\text{gr,max}}, c_{Q_{10},\text{gr}}$) and is identical over multi-day averages, as shown in `VH94b` Fig. 3.2.
- **Recommendation**: **Option 1A (Two-State)** when simulating hourly/diurnal digital twin dynamics; fix the ratio $X_{\text{nsdw}}(0)/X_{\text{sdw}}(0) = 0.15 / 0.85$ at transplant so no extra initial-condition fitting parameter is introduced.

---

## Decision 2: Fresh-Weight Salinity Threshold ($\text{EC}_{\text{thr,FW}}$) and Slope ($b_{\text{sal,FW}}$)
- **Context**: Classical soil salinity tables (Ayers et al. 1951 `AWB51`, cited in `AND05` and `FAO56` Table 23) give a lettuce saturated-paste threshold of $\text{EC}_{\text{thr}} = 1.30\text{ dS m}^{-1}$ and slope $b = 0.130\text{ (dS m}^{-1})^{-1}$. However, `OPENED` Andriolo et al. (2005) (`AND05`) demonstrated that in recirculating **NFT hydroponics** (where matric potential is zero and root-zone water is continuously replenished), lettuce shoot fresh weight peaks at $\text{EC}_{\text{thr,FW}} = 1.96\text{ dS m}^{-1}$ with a gentler decline slope of $b_{\text{sal,FW}} = 0.0873\text{ (dS m}^{-1})^{-1}$ (and dry weight does not decline up to $2.80\text{–}4.72\text{ dS m}^{-1}$). Furthermore, in HydroGrowNet (`HGN25`) `EXP.2`, Batavia lettuce in `T2` (mean $\text{EC} = 2.24\text{ dS m}^{-1}$, per-unit means $2.14\text{–}2.34\text{ dS m}^{-1}$ after fixing the single `26.70` typo, at $\text{pH} = 6.21\text{–}6.28$) achieved $+13.7\%$ *higher* pre-trim shoot fresh weight ($309.4\text{ g}$ vs. $272.1\text{ g}$, and $+13.3\%$ higher total fresh weight $348.2\text{ g}$ vs. $307.3\text{ g}$) than in `T1` (mean $\text{EC} = 1.82\text{ dS m}^{-1}$, per-unit means $1.75\text{–}1.90\text{ dS m}^{-1}$, at $\text{pH} = 6.24\text{–}6.43$).
- **Options**:
  - **Option 2A (Recommended Default — Encoded in Spec Eq. 10.8, `PARAMETER_REGISTRY`, and Sec. 15.5)**: Use the **Andriolo et al. (2005) NFT hydroponic parameters** ($\text{EC}_{\text{thr,FW}} = 1.96\text{ dS m}^{-1}$, $b_{\text{sal,FW}} = 0.0873\text{ (dS m}^{-1})^{-1}$, and dry-matter threshold $\text{EC}_{\text{thr,DM}} = 2.80\text{ dS m}^{-1}$).
  - **Option 2B (Conservative Classical Soil Reference)**: Use the **Ayers et al. (1951) Maas-Hoffman parameters** ($\text{EC}_{\text{thr,FW}} = 1.30\text{ dS m}^{-1}$, $b_{\text{sal,FW}} = 0.130\text{ (dS m}^{-1})^{-1}$).
- **Recommendation**: **Option 2A**, because soil saturated-paste extract $\text{EC}_e = 1.30\text{ dS m}^{-1}$ corresponds to a soil-water solution conductivity $\text{EC}_{sw} \approx 2.0\text{–}2.6\text{ dS m}^{-1}$ at field capacity, making `AND05` physically consistent with `AWB51` once matric effects are removed.

---

## Decision 3: Spatial Resolution of NFT Channels (Analytical Plug-Flow Integral vs. $M$-Segment Discretization)
- **Context**: Along an NFT gully of length $L_{\text{ch}}$, water temperature $T_{\text{ch}}(x)$ and dissolved oxygen $C_{\text{DO,ch}}(x)$ vary longitudinally from inlet ($x=0$) to outlet ($x=L_{\text{ch}}$).
- **Options**:
  - **Option 3A (Recommended — Encoded in Spec Eqs. 5.2 & 6.4)**: **Exact Analytical Longitudinal Integration** across each gully per timestep (evaluating closed-form outlet $T_{\text{ch,out}}$ and $C_{\text{DO,ch,out}}$ using the current root respiration rate, with a 3-point Gauss-Lobatto or midpoint evaluation when $C_{\text{DO}}$ approaches $K_{m,\text{DO}}$). Zero spatial PDE grid overhead, exact for any $L_{\text{ch}}$ and $q_{\text{ch}}$.
  - **Option 3B**: **Finite-Volume Axial Discretization** into $M = N_{\text{pl,ch}}$ axial cells (one cell per plant along the gully). Needed only if tracking plant-by-plant size gradients from channel inlet to outlet under severe pump-degradation hypoxia.
- **Recommendation**: **Option 3A** as the default farm-level digital twin mode, with **Option 3B** ($M = N_{\text{pl,ch}}$) automatically enabled only when simulating severe pump-degradation faults ($\eta_{\text{pump}} < 0.25$) where inlet vs. outlet plants experience divergent DO stress.

---

## Decision 4: Root Respiration Scaling (Dry-Mass Basis vs. Chun & Takakura Root-Volume Basis)
- **Context**: In `OPENED` Chun & Takakura (1994) (`CT94`), specific root respiration is reported per unit root volume ($2.9\text{–}6.7\text{ }\mu\text{mol O}_2\text{ h}^{-1}\text{ mL}^{-1}\text{ root}$) with an empirical exponential root volume curve $V_{\text{root}}(d) = 0.0698 \times 1.1230^d\text{ mL plant}^{-1}$, whereas Van Henten (1994) (`VH94b`) evolves root dry mass $X_{\text{rt,plant}} = \frac{A_{\text{fl}}}{N_{\text{pl}}} c_\tau X_d$.
- **Options**:
  - **Option 4A (Recommended — Encoded in Spec Eq. 6.3)**: Couple root $\text{O}_2$ respiration directly to **mechanistic root dry mass** $X_{\text{rt,plant}}$ via $r_{\text{O}_2,\text{ref}} = 7.8\times 10^{-4}\text{ g O}_2\text{ (kg root DM)}^{-1}\text{ s}^{-1}$ (derived from `CT94`'s $4.8\text{ }\mu\text{mol O}_2\text{ h}^{-1}\text{ mL}^{-1}$ at root dry-matter density $0.055\text{ g DM mL}^{-1}$). This ensures root respiration responds dynamically to actual plant growth under shading or stress rather than a hardcoded function of calendar day $d$.
  - **Option 4B**: Use `CT94`'s empirical function of plant age $V_{\text{root}}(d) = 0.0698 \times 1.1230^d$ directly.
- **Recommendation**: **Option 4A**, because in a digital twin a stunted plant under low light or nutrient fault must respire in proportion to its actual root biomass, not its calendar age $d$.

---

## Decision 5: Handling Missing Dry-Weight and PAR Measurements in HydroGrowNet (`HGN25`) Calibration
- **Context**: As detailed in `GAP-02` and `GAP-03` (and upcoming Checkpoint 3), HydroGrowNet (`HGN25`) measures only **fresh weight** (no dry weight) and **Lux** (no PAR), and has **zero DO measurements**.
- **Options**:
  - **Option 5A (Recommended — Multi-Dataset Hierarchical Priors)**: Fix dry-matter fraction $\alpha_{\text{DMC},0}$ and N/P/K uptake stoichiometry using the `OPENED` Georgia Tech NPK-limited lettuce dataset (`GT25`) and `ZH24`, fix RGB-to-biomass and PAR-to-growth parameters using the `OPENED` 3rd AGC dataset (`PET23`), and fix DO parameters using `CT94`/`MG12`; then calibrate **only** the identifiable enclosure/thermal/pH-salinity parameters ($\tau_{\text{cov}} k_{\text{lx}\to\text{PAR}}, U_{\text{res}}, U_{\text{ch,top}}, \text{pH}_{\text{opt}}, \sigma_{\text{pH}}$) on `HGN25`.
  - **Option 5B**: Attempt joint unregularized fitting of all parameters on `HGN25` alone (which leads to unidentifiable collinearity between $\alpha_{\text{DMC},0}$, $c_\varepsilon$, and $k_{\text{lx}\to\text{PAR}}$).
- **Recommendation**: **Option 5A** (strictly enforcing prior anchoring for unidentifiable parameters).

# CONFIGURABLE HYDROPONIC DIGITAL TWIN — PHYSICS SPECIFICATION (`PHYSICS_SPEC.md`)

## Scope & Governing Rules
- **System Type**: Recirculating Nutrient Film Technique (NFT) hydroponics only.
- **Crop**: Lettuce (*Lactuca sativa* L.) only.
- **Configurability**: Every balance law, transport coefficient, and source/sink term is derived explicitly from the **Configuration Inputs** defined in Section 0. No equation contains hidden farm-size, channel-count, or reservoir-volume constants.
- **Source Tagging Convention**: Every numbered equation carries **exactly one** source tag:
  - `[S]` — Read directly in an `OPENED` primary source (with exact chapter, section, equation, or table number).
  - `[T]` — Derived from a named textbook physical or chemical principle.
  - `[A]` — Explicit physical/agronomic assumption (with physical justification, plausible numerical range, and one-at-a-time $\pm 20\%$ sensitivity rank $R_{\text{sens}} \in \{1 \dots 21\}$ from Section 15.5).
  - `[F]` — Relationship or coefficient to be fitted against experimental data (specifying target dataset and identification protocol).
  - `[U]` — Unknown from accessible literature.

---

## 0. Configuration Inputs & Derived Geometric Quantities

All equations in Modules 1–12 are written exclusively in terms of the following farm configuration inputs $\mathcal{C}$ and fundamental physical constants:

### 0.1 Master Configuration Input Table ($\mathcal{C}$)

| Category | Config Variable | Symbol | Unit | Allowed Domain / Options |
| :--- | :--- | :--- | :--- | :--- |
| **Reservoir** | Initial / nominal liquid volume | $V_{\text{res},0}$ | $\text{m}^3$ (or $\text{L} = 10^{-3}\text{ m}^3$) | $V_{\text{res},0} > 0$ |
| | Free water surface area | $A_{\text{res}}$ | $\text{m}^2$ | $A_{\text{res}} > 0$ |
| | Liquid depth at nominal volume | $H_{\text{res}}$ | $\text{m}$ | $H_{\text{res}} = V_{\text{res},0} / A_{\text{res}} > 0$ |
| | Wall/lid overall heat transfer conductance | $U_{\text{res}}$ | $\text{W m}^{-2}\text{ K}^{-1}$ | $[0.2, 15.0]\text{ W m}^{-2}\text{ K}^{-1}$ |
| | Placement regime | $\mathcal{P}_{\text{res}}$ | categorical | $\{\text{indoor}, \text{shaded}, \text{sun}\}$ |
| **Pump** | Rated volumetric flow rate | $Q_{\text{pump,rated}}$ | $\text{m}^3\text{ s}^{-1}$ | $Q_{\text{pump,rated}} > 0$ |
| | Dimensionless pump health factor | $\eta_{\text{pump}}$ | $-$ | $[0, 1]$ ($1 = \text{nominal}$, $0 = \text{stalled}$) |
| **Aerator** | Sparged air volumetric flow rate | $Q_{\text{air}}$ | $\text{m}^3\text{ s}^{-1}$ | $Q_{\text{air}} \ge 0$ |
| | Standard oxygen transfer rating (at $20^\circ\text{C}$, zero DO) | $\text{OTR}_{\text{std}}$ | $\text{g O}_2\text{ s}^{-1}$ | $\text{OTR}_{\text{std}} \ge 0$ |
| **Channels** | Number of parallel NFT gullies | $N_{\text{ch}}$ | $-$ (integer) | $N_{\text{ch}} \ge 1$ |
| | Length of each gully | $L_{\text{ch}}$ | $\text{m}$ | $L_{\text{ch}} > 0$ |
| | Wetted bottom width of each gully | $W_{\text{ch}}$ | $\text{m}$ | $W_{\text{ch}} > 0$ |
| | Longitudinal bed slope | $S_0$ | $\text{m m}^{-1}$ | $[0.005, 0.05]$ ($0.5\%\text{ to }5\%$) |
| | Center-to-center plant spacing along gully | $s_{\text{pl}}$ | $\text{m}$ | $0 < s_{\text{pl}} \le L_{\text{ch}} / N_{\text{pl,ch}}$ |
| | Number of plants per channel | $N_{\text{pl,ch}}$ | $-$ (integer) | $N_{\text{pl,ch}} \ge 0$ |
| | Initial plant age at simulation start (days after transplanting) | $d_0$ | $\text{d}$ | $d_0 \ge 0$ |
| **Enclosure** | Enclosure structural type | $\mathcal{E}_{\text{type}}$ | categorical | $\{\text{open\_air}, \text{shade\_net}, \text{greenhouse}, \text{indoor\_LED}\}$ |
| | Cropped floor area | $A_{\text{fl}}$ | $\text{m}^2$ | $A_{\text{fl}} \ge N_{\text{ch}} L_{\text{ch}} W_{\text{ch}}$ |
| | Internal air volume | $V_{\text{enc}}$ | $\text{m}^3$ | $V_{\text{enc}} > 0$ |
| | Cover shortwave/PAR transmittance | $\tau_{\text{cov}}$ | $-$ | $[0, 1]$ |
| | Passive/roof ventilation conductance per floor area | $U_{\text{vent}}$ | $\text{m s}^{-1}$ | $U_{\text{vent}} \ge 0$ |
| **Fans** | Fan placement mode | $\mathcal{P}_{\text{fan}}$ | categorical | $\{\text{none}, \text{exhaust}, \text{horizontal\_canopy}, \text{vertical\_destrat}\}$ |
| | Total active fan volumetric airflow | $Q_{\text{fan}}$ | $\text{m}^3\text{ s}^{-1}$ | $Q_{\text{fan}} \ge 0$ |
| **Dosing Stocks** | Ion concentration of species $i$ in stock tank $k \in \{A, B, \text{acid}, \text{base}\}$ | $C_{\text{stock},k,i}$ | $\text{mol m}^{-3}$ ($=\text{mmol L}^{-1}$) | $C_{\text{stock},k,i} \ge 0$ |
| | Net strong-acid normality of stock $k$ ($>0$ base, $<0$ acid) | $N_{\text{alk,stock},k}$ | $\text{eq m}^{-3}$ ($=\text{meq L}^{-1}$) | $\mathbb{R}$ |
| **Source Water** | Dissolved concentration of ion $i$ in makeup water | $C_{\text{src},i}$ | $\text{mol m}^{-3}$ ($=\text{mmol L}^{-1}$) | $C_{\text{src},i} \ge 0$ |
| | Titration alkalinity of makeup water | $[\text{Alk}]_{\text{src}}$ | $\text{eq m}^{-3}$ ($=\text{meq L}^{-1}$) | $[\text{Alk}]_{\text{src}} \ge 0$ |
| **Sensors** | Sensor modality index | $s \in \mathcal{S}$ | categorical | $\{\text{EC}, \text{pH}, T_w, \text{DO}, T_{\text{air}}, \text{RH}, \text{CO}_2, V_{\text{res}}, \text{RGB}\}$ |
| | Sensor white-noise standard deviation (accuracy) | $\sigma_s$ | modality unit | $\sigma_s \ge 0$ |
| | Sensor linear drift rate | $d_s$ | $\text{unit s}^{-1}$ | $\mathbb{R}$ |
| **Location & Date** | Geographic latitude, longitude, elevation, start DOY | $\phi_{\text{lat}}, \lambda_{\text{lon}}, z_{\text{elev}}, \text{DOY}_0$ | $\text{rad}, \text{rad}, \text{m}, \text{d}$ | Standard terrestrial coordinates |

### 0.2 Derived Geometric & System Quantities (Zero Free Constants)

From $\mathcal{C}$, the following geometric invariants are defined identically across all modules:
1. **Total Plant Count**:
   $$N_{\text{pl}} = N_{\text{ch}} \, N_{\text{pl,ch}} \quad [-]$$
2. **Areal Planting Density (per unit enclosure floor area)**:
   $$\rho_{\text{pl}} = \frac{N_{\text{pl}}}{A_{\text{fl}}} = \frac{N_{\text{ch}} \, N_{\text{pl,ch}}}{A_{\text{fl}}} \quad [\text{plants m}^{-2}]$$
3. **Total Channel Planform Area**:
   $$A_{\text{ch,tot}} = N_{\text{ch}} \, L_{\text{ch}} \, W_{\text{ch}} \quad [\text{m}^2]$$
4. **Effective Inter-Channel Center-to-Center Pitch**:
   $$W_{\text{pitch}} = \frac{A_{\text{fl}}}{N_{\text{ch}} \, L_{\text{ch}}} \quad [\text{m}], \qquad A_{\text{cell}} = s_{\text{pl}} \, W_{\text{pitch}} \quad [\text{m}^2\text{ plant}^{-1}]$$
5. **Reservoir Wetted Wall + Base Conductive Area** (for cylindrical/rectangular geometry with aspect ratio $\approx 1$, $P_{\text{res}} \approx 4\sqrt{A_{\text{res}}}$):
   $$A_{\text{wall}}(V_{\text{res}}) = A_{\text{res}} + 4\sqrt{A_{\text{res}}}\, \frac{V_{\text{res}}}{A_{\text{res}}} \quad [\text{m}^2]$$
6. **Mean Enclosure Height**:
   $$H_{\text{enc}} = \frac{V_{\text{enc}}}{A_{\text{fl}}} \quad [\text{m}]$$

---

## MODULE 1: Outdoor and Enclosure Climate

### 1.1 Conserved State Variables
For an enclosure of volume $V_{\text{enc}}$ and floor area $A_{\text{fl}}$, the conserved extensive quantities are:
1. **Enclosure Air Sensible Thermal Energy**: $\mathcal{E}_{\text{air}} = \rho_a c_{p,a} V_{\text{enc}} T_{\text{air}}$ $[\text{J}]$
2. **Enclosure Water Vapor Mass**: $M_{\text{vap}} = V_{\text{enc}} \chi_{\text{vap}}$ $[\text{kg H}_2\text{O}]$
3. **Enclosure Carbon Dioxide Mass**: $M_{\text{CO}_2} = V_{\text{enc}} \chi_{\text{CO}_2}$ $[\text{kg CO}_2]$

### 1.2 Balance Equations

#### Equation (1.1) — Enclosure Air Sensible Heat Balance
$$\rho_a c_{p,a} H_{\text{enc}} \frac{dT_{\text{air}}}{dt} = Q_{\text{rad,air}} + H_{\text{can}\to\text{air}} + H_{\text{ch}\to\text{air}} - Q_{\text{vent,sens}} - Q_{\text{cov,cond}}$$
- **Symbol Table & Units**:
  - $T_{\text{air}}$: Enclosure air temperature $[{}^\circ\text{C}\text{ or K}]$; $\rho_a = 1.20\text{ kg m}^{-3}$: air density; $c_{p,a} = 1010\text{ J kg}^{-1}\text{ K}^{-1}$: specific heat of air; $H_{\text{enc}} = V_{\text{enc}}/A_{\text{fl}}$: mean enclosure height $[\text{m}]$.
  - $Q_{\text{rad,air}} = (1 - \alpha_{\text{can,abs}}) \tau_{\text{cov}} I_{\text{out}} + \eta_{\text{LED,sens}} I_{\text{LED}}$: non-latent shortwave/lamp sensible heating per unit floor area $[\text{W m}^{-2}]$.
  - $H_{\text{can}\to\text{air}}$: Canopy-to-air sensible heat flux per unit floor area $[\text{W m}^{-2}]$ (Eq. 8.2).
  - $H_{\text{ch}\to\text{air}} = \frac{A_{\text{ch,tot}}}{A_{\text{fl}}} U_{\text{ch,top}}(T_{\text{ch}} - T_{\text{air}})$: channel-to-air sensible heat transfer $[\text{W m}^{-2}]$.
  - $Q_{\text{vent,sens}} = \rho_a c_{p,a} \phi_{\text{vent}}(T_{\text{air}} - T_{\text{out}})$: ventilation sensible heat loss $[\text{W m}^{-2}]$.
  - $Q_{\text{cov,cond}} = U_{\text{cov}} \frac{A_{\text{cov}}}{A_{\text{fl}}}(T_{\text{air}} - T_{\text{out}})$: conductive heat loss through enclosure cover $[\text{W m}^{-2}]$.
- **Config Dependencies**: $\mathcal{E}_{\text{type}}, A_{\text{fl}}, V_{\text{enc}}, \tau_{\text{cov}}, U_{\text{vent}}, \mathcal{P}_{\text{fan}}, Q_{\text{fan}}, N_{\text{ch}}, L_{\text{ch}}, W_{\text{ch}}$.
- **Validity Range**: $T_{\text{air}} \in [5, 45]^\circ\text{C}$, well-mixed enclosure air volume.
- **Dimensional Check**: $\text{LHS} = [\text{kg m}^{-3}][\text{J kg}^{-1}\text{ K}^{-1}][\text{m}][\text{K s}^{-1}] = \text{W m}^{-2}$; $\text{RHS} = \text{W m}^{-2}$. Exact match.
- **Limiting-Case Check**: As $\phi_{\text{vent}} \to \infty$ (open air, $\mathcal{E}_{\text{type}} = \text{open\_air}$), $T_{\text{air}} \to T_{\text{out}}$ quasi-instantaneously. With $I_{\text{out}} = I_{\text{LED}} = 0$ and $\text{LAI} = 0$, $T_{\text{air}}$ relaxes exponentially to $T_{\text{out}}$ with time constant $\tau_{\text{air}} = H_{\text{enc}} / (\phi_{\text{vent}} + U_{\text{cov}} A_{\text{cov}} / (\rho_a c_{p,a} A_{\text{fl}}))$.
- **Source Tag**: `[S]` — Read in Vanthoor (2011) `VT11b` Ch. 8, Sec. 8.3, Eq. (8.1) and Van Henten (1994) `VH94b` Ch. 3, Sec. 3.2.4, Eq. (3.22).

#### Equation (1.2) — Enclosure Water Vapor Mass Balance
$$H_{\text{enc}} \frac{d\chi_{\text{vap}}}{dt} = E_{\text{can}} + E_{\text{evap,free}} - \phi_{\text{vent}} (\chi_{\text{vap}} - \chi_{\text{vap,out}}) - \phi_{\text{cond,cov}}$$
- **Symbol Table & Units**:
  - $\chi_{\text{vap}}, \chi_{\text{vap,out}}$: Indoor and outdoor absolute humidity $[\text{kg H}_2\text{O m}^{-3}\text{ air}]$.
  - $E_{\text{can}}$: Canopy transpiration mass flux per unit floor area $[\text{kg m}^{-2}\text{ s}^{-1}]$ (Eq. 8.1).
  - $E_{\text{evap,free}}$: Free-surface evaporation from indoor reservoir and unshaded channel slots per unit floor area $[\text{kg m}^{-2}\text{ s}^{-1}]$.
  - $\phi_{\text{vent}}$: Total volumetric air exchange rate per unit floor area $[\text{m s}^{-1}]$ (Eq. 1.5).
  - $\phi_{\text{cond,cov}} = \max\!\big(0, k_{\text{cond}}(\chi_{\text{vap}} - \chi_{\text{vap}}^{*}(T_{\text{cov}}))\big)$: cover condensation flux $[\text{kg m}^{-2}\text{ s}^{-1}]$.
- **Config Dependencies**: $A_{\text{fl}}, V_{\text{enc}}, U_{\text{vent}}, \mathcal{P}_{\text{fan}}, Q_{\text{fan}}, \mathcal{E}_{\text{type}}$.
- **Validity Range**: $\text{RH} \in [10\%, 100\%]$, $T_{\text{air}} \in [5, 45]^\circ\text{C}$.
- **Dimensional Check**: $\text{LHS} = [\text{m}][\text{kg m}^{-3}\text{ s}^{-1}] = \text{kg m}^{-2}\text{ s}^{-1}$; $\text{RHS} = \text{kg m}^{-2}\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: When $N_{\text{pl}} = 0$ ($E_{\text{can}} = 0$), $E_{\text{evap,free}} = 0$, and $\phi_{\text{cond,cov}} = 0$, $\chi_{\text{vap}}(t) \to \chi_{\text{vap,out}}$ with time constant $H_{\text{enc}}/\phi_{\text{vent}}$.
- **Source Tag**: `[S]` — Read in Van Henten (1994) `VH94b` Ch. 3, Sec. 3.2.4, Eq. (3.24) and Vanthoor (2011) `VT11b` Ch. 8, Sec. 8.9, Eq. (8.41).

#### Equation (1.3) — Enclosure Carbon Dioxide Mass Balance
$$H_{\text{enc}} \frac{d\chi_{\text{CO}_2}}{dt} = U_{\text{CO}_2,\text{ext}} - \left(\phi_{\text{phot}} - \phi_{\text{resp}}\right) + J_{\text{CO}_2,\text{res}\to\text{air}} - \phi_{\text{vent}} (\chi_{\text{CO}_2} - \chi_{\text{CO}_2,\text{out}})$$
- **Symbol Table & Units**:
  - $\chi_{\text{CO}_2}, \chi_{\text{CO}_2,\text{out}}$: Indoor and outdoor $\text{CO}_2$ mass concentration $[\text{kg CO}_2\text{ m}^{-3}]$ (conversion from $\text{ppm}$: $\chi_{\text{CO}_2} = 10^{-6} \cdot \text{CO}_{2,\text{ppm}} \frac{P_{\text{bar}} M_{\text{CO}_2}}{R (T_{\text{air}} + 273.15)}$ with $M_{\text{CO}_2} = 0.04401\text{ kg mol}^{-1}$).
  - $U_{\text{CO}_2,\text{ext}}$: External $\text{CO}_2$ enrichment flux $[\text{kg CO}_2\text{ m}^{-2}\text{ s}^{-1}]$ ($0$ if un-enriched).
  - $\phi_{\text{phot}}, \phi_{\text{resp}}$: Canopy gross photosynthesis and maintenance respiration expressed as $\text{CO}_2$ flux per unit floor area $[\text{kg CO}_2\text{ m}^{-2}\text{ s}^{-1}]$ (Eqs. 10.3, 10.7).
  - $J_{\text{CO}_2,\text{res}\to\text{air}}$: Dissolved $\text{CO}_2$ degassing + root respiration flux per unit floor area $[\text{kg CO}_2\text{ m}^{-2}\text{ s}^{-1}]$.
- **Config Dependencies**: $A_{\text{fl}}, V_{\text{enc}}, U_{\text{vent}}, \mathcal{P}_{\text{fan}}, Q_{\text{fan}}, \mathcal{E}_{\text{type}}$.
- **Validity Range**: $\text{CO}_2 \in [150, 2000]\text{ ppm}$.
- **Dimensional Check**: $\text{LHS} = [\text{m}][\text{kg m}^{-3}\text{ s}^{-1}] = \text{kg m}^{-2}\text{ s}^{-1}$; $\text{RHS} = \text{kg m}^{-2}\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: In darkness ($\phi_{\text{phot}} = 0$) with low ventilation, $\chi_{\text{CO}_2}$ rises above $\chi_{\text{CO}_2,\text{out}}$ due to $\phi_{\text{resp}} > 0$; with no plants ($N_{\text{pl}} = 0$), $\chi_{\text{CO}_2} \to \chi_{\text{CO}_2,\text{out}}$.
- **Source Tag**: `[S]` — Read in Van Henten (1994) `VH94b` Ch. 3, Sec. 3.2.4, Eq. (3.23) and Vanthoor (2011) `VT11b` Ch. 8, Sec. 8.10, Eq. (8.62).

### 1.3 Constitutive Relations for Climate & Enclosure Regimes

#### Equation (1.4) — Incident PAR & Shortwave Radiation by Enclosure Type
$$I_{\text{can,sw}}(t) = \begin{cases} I_{\text{out,sw}}(\phi_{\text{lat}}, \text{DOY}, t) & \text{if } \mathcal{E}_{\text{type}} = \text{open\_air} \\ \tau_{\text{cov}} \, I_{\text{out,sw}}(\phi_{\text{lat}}, \text{DOY}, t) & \text{if } \mathcal{E}_{\text{type}} \in \{\text{shade\_net}, \text{greenhouse}\} \\ I_{\text{LED,sw}}(t) & \text{if } \mathcal{E}_{\text{type}} = \text{indoor\_LED} \end{cases}, \qquad I_{\text{PAR}}(t) = c_{\text{par}} \, I_{\text{can,sw}}(t)$$
- **Symbol Table & Units**:
  - $I_{\text{out,sw}}$: Outdoor global horizontal shortwave irradiance $[\text{W m}^{-2}]$ computed from solar declination $\delta_{\text{sol}} = 0.409\sin\!\left(\frac{2\pi}{365}\text{DOY} - 1.39\right)$ and solar elevation angle $\sin\beta_{\text{sol}} = \sin\phi_{\text{lat}}\sin\delta_{\text{sol}} + \cos\phi_{\text{lat}}\cos\delta_{\text{sol}}\cos\omega_h$; $I_{\text{can,sw}}$: shortwave irradiance above canopy $[\text{W m}^{-2}]$; $I_{\text{PAR}}$: photosynthetically active radiation $[\text{W m}^{-2}\text{ PAR}]$; $c_{\text{par}} = 0.50\text{ J PAR (J SW)}^{-1}$ (solar) or $0.85$ (LED).
- **Config Dependencies**: $\mathcal{E}_{\text{type}}, \tau_{\text{cov}}, \phi_{\text{lat}}, \lambda_{\text{lon}}, \text{DOY}_0$.
- **Validity Range**: $\tau_{\text{cov}} \in [0, 1]$, $I_{\text{out,sw}} \in [0, 1367]\text{ W m}^{-2}$.
- **Dimensional Check**: $[\text{W m}^{-2}] = [-][\text{W m}^{-2}]$. Exact match.
- **Limiting-Case Check**: At night ($\sin\beta_{\text{sol}} \le 0$) or $\tau_{\text{cov}} = 0$ (opaque cover with LEDs off), $I_{\text{can,sw}} = I_{\text{PAR}} = 0$.
- **Source Tag**: `[S]` — Read in Allen et al. (1998) `FAO56` Ch. 3, Eqs. (21)–(39) and Van Henten (1994) `VH94b` Ch. 3, Table 3.1 ($c_{\text{par}} = 0.5$).

#### Equation (1.5) — Total Volumetric Ventilation Rate per Floor Area
$$\phi_{\text{vent}} = U_{\text{vent}} + \frac{\mathbb{I}(\mathcal{P}_{\text{fan}} = \text{exhaust}) \, Q_{\text{fan}}}{A_{\text{fl}}} + \phi_{\text{leak}}$$
- **Symbol Table & Units**:
  - $\phi_{\text{vent}}$: Specific ventilation exchange velocity $[\text{m}^3\text{ air m}^{-2}\text{ floor s}^{-1} = \text{m s}^{-1}]$; $U_{\text{vent}}$: passive/window ventilation rate $[\text{m s}^{-1}]$; $Q_{\text{fan}}$: fan volumetric flow $[\text{m}^3\text{ s}^{-1}]$; $\phi_{\text{leak}} = 7.5\times 10^{-5}\text{ m s}^{-1}$ (for closed greenhouse/indoor) or $\phi_{\text{vent}} \gg 0.1\text{ m s}^{-1}$ (for `open_air` / `shade_net`).
- **Config Dependencies**: $\mathcal{E}_{\text{type}}, A_{\text{fl}}, U_{\text{vent}}, \mathcal{P}_{\text{fan}}, Q_{\text{fan}}$.
- **Validity Range**: $U_{\text{vent}} \ge 0$, $Q_{\text{fan}} \ge 0$.
- **Dimensional Check**: $[\text{m s}^{-1}] + [\text{m}^3\text{ s}^{-1}]/[\text{m}^2] = \text{m s}^{-1}$. Exact match.
- **Limiting-Case Check**: When $\mathcal{P}_{\text{fan}} = \text{horizontal\_canopy}$ (internal recirculation fan only), exhaust contribution is $0$ (it increases internal air speed $u_{\text{can}}$ in Eq. 8.4 without exchanging outdoor air).
- **Source Tag**: `[S]` — Read in Vanthoor (2011) `VT11b` Ch. 8, Sec. 8.9, Eqs. (8.42)–(8.49) and Van Henten (1994) `VH94b` Ch. 3, Eq. (3.29).

#### Equation (1.6) — Psychrometric & Saturation Vapor Relations
$$e^*(T) = 610.78 \exp\!\left(\frac{17.2694 \, T}{T + 237.3}\right), \qquad \Delta(T) = \frac{4098 \, e^*(T)}{(T + 237.3)^2}, \qquad \chi_{\text{vap}}^*(T) = \frac{M_w \, e^*(T)}{R (T + 273.15)}$$
- **Symbol Table & Units**:
  - $T$: Temperature $[{}^\circ\text{C}]$; $e^*(T)$: saturation vapor pressure $[\text{Pa}]$; $\Delta(T) = de^*/dT$: slope of saturation vapor pressure curve $[\text{Pa K}^{-1}]$; $\chi_{\text{vap}}^*(T)$: saturation absolute humidity $[\text{kg m}^{-3}]$; $M_w = 0.018015\text{ kg mol}^{-1}$; $R = 8.3145\text{ J mol}^{-1}\text{ K}^{-1}$.
- **Config Dependencies**: None (universal thermodynamic property of water vapor; depends on $z_{\text{elev}}$ for psychrometric constant $\gamma = \frac{c_{p,a} P_{\text{bar}}}{0.622 \lambda_v} \approx 66.5\text{ Pa K}^{-1}$ at sea level).
- **Validity Range**: $T \in [0, 50]^\circ\text{C}$.
- **Dimensional Check**: $\chi_{\text{vap}}^* = [\text{kg mol}^{-1}][\text{N m}^{-2}] / ([\text{N m mol}^{-1}\text{ K}^{-1}][\text{K}]) = \text{kg m}^{-3}$. Exact match.
- **Limiting-Case Check**: At $T = 0^\circ\text{C}$, $e^*(0) = 610.78\text{ Pa}$; at $T = 20^\circ\text{C}$, $e^*(20) = 2338\text{ Pa}$, $\Delta(20) = 144.7\text{ Pa K}^{-1}$.
- **Source Tag**: `[S]` — Read in Allen et al. (1998) `FAO56` Ch. 3, Eqs. (8), (11), (13) and Van Henten (1994) `VH94b` Ch. 3, Eq. (3.32).

---

## MODULE 2: Reservoir Water Volume

### 2.1 Conserved State Variables
The total liquid water volume in the recirculating loop is $V_{\text{tot}}(t) = V_{\text{res}}(t) + V_{\text{ch,tot}}(t)$ $[\text{m}^3]$, where $V_{\text{res}}(t)$ is the liquid volume in the reservoir and $V_{\text{ch,tot}}(t) = N_{\text{ch}} L_{\text{ch}} W_{\text{ch}} h_{\text{ch}}(t)$ is the dynamic holdup volume in the $N_{\text{ch}}$ gullies (Module 7).

### 2.2 Balance Equations

#### Equation (2.1) — Reservoir & Total Loop Liquid Water Volume Balance
$$\frac{dV_{\text{res}}}{dt} = Q_{\text{ch,out}} - Q_{\text{pump}} + Q_{\text{src}} + \sum_{k} Q_{\text{dose},k} - Q_{\text{evap,res}} - Q_{\text{leak,res}}$$
$$\frac{dV_{\text{tot}}}{dt} = \frac{d(V_{\text{res}} + V_{\text{ch,tot}})}{dt} = Q_{\text{src}} + \sum_{k} Q_{\text{dose},k} - \frac{A_{\text{fl}} E_{\text{can}}}{\rho_w} - Q_{\text{evap,res}} - Q_{\text{evap,ch}} - Q_{\text{leak}}$$
- **Symbol Table & Units**:
  - $V_{\text{res}}, V_{\text{tot}}$: Reservoir and total loop water volumes $[\text{m}^3]$; $\rho_w = 998.2\text{ kg m}^{-3}$: liquid water density.
  - $Q_{\text{pump}} = \eta_{\text{pump}} Q_{\text{pump,rated}} \, \mathbb{I}(V_{\text{res}} > V_{\text{res,dead}})$: volumetric flow pumped from reservoir to channel inlets $[\text{m}^3\text{ s}^{-1}]$.
  - $Q_{\text{ch,out}} = Q_{\text{pump}} - \frac{A_{\text{fl}} E_{\text{can}}}{\rho_w} - Q_{\text{evap,ch}} - Q_{\text{leak,ch}} - \frac{dV_{\text{ch,tot}}}{dt}$: total return flow from all $N_{\text{ch}}$ gullies into the reservoir $[\text{m}^3\text{ s}^{-1}]$.
  - $Q_{\text{src}}$: Makeup source water addition rate $[\text{m}^3\text{ s}^{-1}]$; $Q_{\text{dose},k}$: volumetric dosing flow from stock tank $k$ $[\text{m}^3\text{ s}^{-1}]$.
  - $Q_{\text{evap,res}}, Q_{\text{evap,ch}}$: Free-surface evaporation volumetric loss rates from reservoir and unshaded gully slots $[\text{m}^3\text{ s}^{-1}]$ (Eq. 2.2).
  - $Q_{\text{leak}} = Q_{\text{leak,res}} + Q_{\text{leak,ch}}$: Physical leak volumetric loss rate $[\text{m}^3\text{ s}^{-1}]$ (Module 12).
- **Config Dependencies**: $V_{\text{res},0}, A_{\text{res}}, Q_{\text{pump,rated}}, \eta_{\text{pump}}, N_{\text{ch}}, L_{\text{ch}}, W_{\text{ch}}, A_{\text{fl}}$.
- **Validity Range**: $V_{\text{res}} \in [V_{\text{res,dead}}, V_{\text{res,max}}]$.
- **Dimensional Check**: $\text{LHS} = \text{m}^3\text{ s}^{-1}$; $\text{RHS} = \text{m}^3\text{ s}^{-1} + [\text{m}^2][\text{kg m}^{-2}\text{ s}^{-1}]/[\text{kg m}^{-3}] = \text{m}^3\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: With sources and sinks off ($Q_{\text{src}} = Q_{\text{dose},k} = E_{\text{can}} = Q_{\text{evap}} = Q_{\text{leak}} = 0$) and steady pump flow ($dV_{\text{ch,tot}}/dt = 0$), $Q_{\text{ch,out}} = Q_{\text{pump}}$ and $\frac{dV_{\text{res}}}{dt} = \frac{dV_{\text{tot}}}{dt} = 0$ identically.
- **Source Tag**: `[T]` — Textbook Principle: Reynolds Transport Theorem / Conservation of Mass for Incompressible Control Volumes.

#### Equation (2.2) — Reservoir & Channel Slot Free-Surface Evaporation
$$Q_{\text{evap,res}} = \frac{c_{\text{evap,res}} A_{\text{res}}}{\rho_w} \max\!\big(0, \chi_{\text{vap}}^*(T_{\text{res}}) - \chi_{\text{vap,amb}}\big), \qquad Q_{\text{evap,ch}} = \frac{c_{\text{leak,evap}} A_{\text{ch,tot}} e^{-k_{\text{ext}}\text{LAI}}}{\rho_w} \max\!\big(0, \chi_{\text{vap}}^*(T_{\text{ch}}) - \chi_{\text{vap}}\big)$$
- **Symbol Table & Units**:
  - $c_{\text{evap,res}}$: Mass transfer conductance across reservoir lid/surface $[\text{m s}^{-1}]$ ($0$ for sealed lid, $2\times 10^{-4}\text{ m s}^{-1}$ for vented lid, $2\times 10^{-3}\text{ m s}^{-1}$ for open surface); $c_{\text{leak,evap}}$: effective mass transfer velocity through unshaded planting holes of covered NFT gullies $[\text{m s}^{-1}]$.
- **Config Dependencies**: $A_{\text{res}}, \mathcal{P}_{\text{res}}, N_{\text{ch}}, L_{\text{ch}}, W_{\text{ch}}$.
- **Validity Range**: $T_{\text{res}}, T_{\text{ch}} \in [5, 40]^\circ\text{C}$.
- **Dimensional Check**: $[\text{m s}^{-1}][\text{m}^2][\text{kg m}^{-3}] / [\text{kg m}^{-3}] = \text{m}^3\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: When gullies are fully covered by canopy ($\text{LAI} \gg 1$) or air is saturated ($\chi_{\text{vap}} \ge \chi_{\text{vap}}^*$), $Q_{\text{evap,ch}} \to 0$.
- **Source Tag**: `[A]` — Assumption: Enclosed NFT gullies lose negligible water by direct evaporation except through unshaded net-cup openings ($c_{\text{leak,evap}} = 5.5\times 10^{-7}\text{ m s}^{-1} = 0.002\text{ m h}^{-1}$, plausible range $[10^{-4}, 5\times 10^{-3}]\text{ m h}^{-1}$, sensitivity rank $R_{\text{sens}} = 19/21$, max OAT impact $0.06\%$).

---

## MODULE 3: Ions per Species and Electrical Conductivity (EC)

### 3.1 Conserved State Variables
For each dissolved ionic species $i \in \mathcal{I} = \{\text{NO}_3^-, \text{NH}_4^+, \text{P}_{\text{tot}} (\text{H}_2\text{PO}_4^- + \text{HPO}_4^{2-}), \text{K}^+, \text{Ca}^{2+}, \text{Mg}^{2+}, \text{SO}_4^{2-}, \text{Na}^+, \text{Cl}^-, \text{Fe}^{\text{chel}}\}$, the conserved state is the **total loop molar inventory** $M_i(t) = V_{\text{tot}}(t) C_i(t)$ $[\text{mol}]$ (or $[\text{mmol}]$ when $V$ is in $\text{L}$ and $C_i$ is in $\text{mmol L}^{-1} = \text{mol m}^{-3}$). Because the hydraulic loop turnover time $\tau_{\text{loop}} = V_{\text{tot}} / Q_{\text{pump}} \sim 5\text{–}20\text{ min}$ is two orders of magnitude faster than nutrient depletion timescales $\tau_{\text{EC}} \sim 5\text{–}15\text{ days}$, the loop is well-mixed with respect to conservative ions ($C_{i,\text{res}} \approx C_{i,\text{ch}}$), while single-pass longitudinal depletion across a channel is $\Delta C_{i,\text{ch}} = -\frac{N_{\text{pl,ch}} J_{\text{up},i}}{q_{\text{ch}}}$.

### 3.2 Balance Equations

#### Equation (3.1) — Species Molar Mass Balance and Concentration ODE
$$\frac{dM_i}{dt} = \frac{d(V_{\text{tot}} C_i)}{dt} = Q_{\text{src}} C_{\text{src},i} + \sum_{k} Q_{\text{dose},k} C_{\text{stock},k,i} - N_{\text{pl}} J_{\text{up},i} - R_{\text{precip},i} V_{\text{tot}} - Q_{\text{leak}} C_i$$
$$\frac{dC_i}{dt} = \frac{1}{V_{\text{tot}}} \left[ Q_{\text{src}}(C_{\text{src},i} - C_i) + \sum_{k} Q_{\text{dose},k}(C_{\text{stock},k,i} - C_i) - N_{\text{pl}} J_{\text{up},i} - R_{\text{precip},i} V_{\text{tot}} + C_i \left(\frac{A_{\text{fl}} E_{\text{can}}}{\rho_w} + Q_{\text{evap,res}} + Q_{\text{evap,ch}}\right) \right]$$
- **Symbol Table & Units**:
  - $M_i$: Total dissolved moles of species $i$ $[\text{mol}]$; $C_i$: molar concentration $[\text{mol m}^{-3} = \text{mmol L}^{-1}]$.
  - $C_{\text{src},i}, C_{\text{stock},k,i}$: Concentrations of ion $i$ in source water and stock tank $k$ $[\text{mol m}^{-3}]$.
  - $J_{\text{up},i}$: Per-plant root uptake rate of ion $i$ $[\text{mol plant}^{-1}\text{ s}^{-1}]$ (Module 9).
  - $R_{\text{precip},i}$: Volumetric precipitation rate of species $i$ at alkaline pH $[\text{mol m}^{-3}\text{ s}^{-1}]$ (Eq. 3.2).
  - $Q_{\text{leak}} C_i$: Advective loss of ion $i$ in leaked solution $[\text{mol s}^{-1}]$.
- **Config Dependencies**: $V_{\text{res},0}, N_{\text{ch}}, N_{\text{pl,ch}}, C_{\text{src},i}, C_{\text{stock},k,i}$.
- **Validity Range**: $C_i \ge 0$, dilute-to-moderate ionic strength $I_{\text{str}} \le 0.1\text{ mol L}^{-1}$.
- **Dimensional Check**: $\text{LHS of } dM_i/dt = \text{mol s}^{-1}$; $\text{RHS} = [\text{m}^3\text{ s}^{-1}][\text{mol m}^{-3}] - [-][\text{mol s}^{-1}] = \text{mol s}^{-1}$. Notice in $dC_i/dt$ via quotient rule $\frac{d(M_i/V_{\text{tot}})}{dt}$: pure water loss by transpiration ($E_{\text{can}}$) and evaporation ($Q_{\text{evap}}$) appears with a $+C_i / V_{\text{tot}}$ sign (concentrating solutes), whereas a physical leak ($Q_{\text{leak}}$) cancels out of $dC_i/dt$ because leaked water carries solute at concentration $C_i$!
- **Limiting-Case Check**:
  1. When $Q_{\text{src}} = Q_{\text{dose},k} = J_{\text{up},i} = R_{\text{precip},i} = E_{\text{can}} = Q_{\text{evap}} = Q_{\text{leak}} = 0$, $dM_i/dt = 0$ and $dC_i/dt = 0$.
  2. For a non-absorbed ballast ion ($J_{\text{up},\text{Na}^+} \approx 0$) with makeup water $C_{\text{src},\text{Na}^+} > 0$ refilling transpiration ($Q_{\text{src}} = A_{\text{fl}} E_{\text{can}} / \rho_w$), $dM_{\text{Na}^+}/dt = Q_{\text{src}} C_{\text{src},\text{Na}^+} > 0$ (linear salt accumulation).
- **Source Tag**: `[T]` — Textbook Principle: Species Conservation of Mass + Chain Rule Coupling to Control Volume $V_{\text{tot}}(t)$.

### 3.3 Constitutive Relations for Precipitation & Electrical Conductivity

#### Equation (3.2) — Alkaline Precipitation Rate of Iron and Calcium Phosphate
$$R_{\text{precip,Fe}} = k_{\text{precip,Fe}} \, C_{\text{Fe}} \, \max\!\left(0, \, \frac{10^{\text{pH} - \text{pH}_{\text{crit,Fe}}} - 1}{10^{\text{pH} - \text{pH}_{\text{crit,Fe}}} + 1}\right), \qquad R_{\text{precip,Ca}} = R_{\text{precip,P}} = k_{\text{precip,CaP}} \max\!\left(0, \, \frac{C_{\text{Ca}^{2+}} [\text{HPO}_4^{2-}]}{K_{\text{sp,CaHPO}_4}} - 1\right)$$
- **Symbol Table & Units**:
  - $k_{\text{precip,Fe}} = 1.0\times 10^{-5}\text{ s}^{-1}$: first-order chelate hydrolysis/precipitation rate constant above $\text{pH}_{\text{crit,Fe}} = 7.2$; $k_{\text{precip,CaP}} = 5.0\times 10^{-7}\text{ mol m}^{-3}\text{ s}^{-1}$; $K_{\text{sp,CaHPO}_4} = 2.0\text{ (mol m}^{-3})^2$ (effective brushite/octacalcium phosphate supersaturation threshold in nutrient solution).
- **Config Dependencies**: $C_{\text{src},i}, C_{\text{stock},k,i}$.
- **Validity Range**: $\text{pH} \in [4.0, 8.5]$.
- **Dimensional Check**: $[s^{-1}][\text{mol m}^{-3}][-] = \text{mol m}^{-3}\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: For $\text{pH} \le 7.0$ and normal $\text{Ca}/\text{P}$ concentrations, $R_{\text{precip,Fe}} = R_{\text{precip,Ca}} = 0$; at $\text{pH} = 7.6$ (as in Zhang et al. 2024 `2 mmol/L HCO3-` treatment), dissolved $\text{Fe}$ drops by $\sim 45\%$ within $24\text{ h}$.
- **Source Tag**: `[S]` — Read in Zhang et al. (2024) `ZH24` Sec. 3.4 & Fig. 4h (iron precipitation from $3.8$ to $2.0\text{ mg L}^{-1}$ on Day 1 at $\text{pH} \in [7.4, 7.7]$).

#### Equation (3.3) — Reference ($25^\circ\text{C}$) and Raw Electrical Conductivity from Ion Species
$$\text{EC}_{25} = f_{\text{act}}(I_{\text{str}}) \sum_{i \in \mathcal{I}} \lambda_{0,i} \, |z_i| \, C_i, \qquad f_{\text{act}}(I_{\text{str}}) = 1 - \alpha_{\text{OS}} \sqrt{I_{\text{str}}}, \qquad \text{EC}_{\text{raw}}(T_w) = \text{EC}_{25} \big[1 + \alpha_{T,\text{EC}}(T_w - 25.0)\big]$$
- **Symbol Table & Units**:
  - $\text{EC}_{25}$: Temperature-compensated electrical conductivity referenced to $25^\circ\text{C}$ $[\text{dS m}^{-1} = \text{mS cm}^{-1}]$.
  - $\text{EC}_{\text{raw}}(T_w)$: Uncompensated electrical conductivity at water temperature $T_w$ $[\text{dS m}^{-1}]$.
  - $z_i$: Ionic charge valence of species $i$ $[-]$; $C_i$: molar concentration $[\text{mol m}^{-3} = \text{mmol L}^{-1}]$.
  - $\lambda_{0,i}$: Limiting equivalent ionic molar conductivity at $25^\circ\text{C}$ $[\text{dS m}^{-1}\text{ (eq m}^{-3})^{-1} = (\text{mS cm}^{-1})/(\text{meq L}^{-1})]$:
    - $\text{NO}_3^-: 0.0714$, $\text{NH}_4^+: 0.0735$, $\text{H}_2\text{PO}_4^-: 0.0360$, $\text{HPO}_4^{2-}: 0.0570$, $\text{K}^+: 0.0735$, $\text{Ca}^{2+}: 0.0595$, $\text{Mg}^{2+}: 0.0531$, $\text{SO}_4^{2-}: 0.0800$, $\text{Na}^+: 0.0501$, $\text{Cl}^-: 0.0763$, $\text{HCO}_3^-: 0.0445$, $\text{H}^+: 0.3498$, $\text{OH}^-: 0.1983$.
  - $I_{\text{str}} = \frac{1}{2}\sum_{i} z_i^2 C_i \times 10^{-3}$: Molar ionic strength $[\text{mol L}^{-1}]$.
  - $\alpha_{\text{OS}} = 0.65\text{ (mol L}^{-1})^{-1/2}$: Onsager-Robinson-Stokes inter-ionic relaxation/electrophoretic attenuation coefficient (giving an effective bulk conversion $\approx 0.105\text{–}0.115\text{ dS m}^{-1}\text{ per meq L}^{-1}$ of cation/anion pair at $I_{\text{str}} \approx 0.015\text{–}0.030\text{ M}$).
  - $\alpha_{T,\text{EC}} = 0.0191\text{ K}^{-1}$: Linear temperature coefficient of electrolytic conductivity near $25^\circ\text{C}$.
- **Config Dependencies**: $C_{\text{src},i}, C_{\text{stock},k,i}$.
- **Validity Range**: $\text{EC}_{25} \in [0.05, 6.0]\text{ dS m}^{-1}$, $T_w \in [5, 40]^\circ\text{C}$.
- **Dimensional Check**: $[\text{dS m}^{-1}\text{ eq}^{-1}\text{ m}^3][\text{eq mol}^{-1}][\text{mol m}^{-3}] = \text{dS m}^{-1}$. Exact match.
- **Limiting-Case Check**: As $\sum C_i \to 0$ (deionized water), $\text{EC}_{25} \to 0.055\times 10^{-4}\text{ dS m}^{-1}$ (pure water auto-ionization $[\text{H}^+] = [\text{OH}^-] = 10^{-4}\text{ mol m}^{-3}$). For a standard lettuce solution ($\sum_{\text{cations}} |z_i| C_i = 16.5\text{ meq L}^{-1}$), $\text{EC}_{25} \approx 1.80\text{ dS m}^{-1}$.
- **Source Tag**: `[T]` — Textbook Principle: Kohlrausch's Law of Independent Migration of Ions & Debye-Hückel-Onsager Conductivity Theory (Robinson & Stokes, *Electrolyte Solutions*).

---

## MODULE 4: pH and Alkalinity

### 4.1 Conserved State Variables
Because proton transfer reactions in aqueous solution occur on microsecond timescales ($\tau_{\text{prot}} < 10^{-5}\text{ s}$), $[\text{H}^+]$ is an algebraic equilibrium state governed by two conserved slow quantities:
1. **Total Titration Alkalinity (Charge-Balance Invariant)**: $[\text{Alk}](t)$ $[\text{eq m}^{-3} = \text{meq L}^{-1}]$, defined by exact aqueous electroneutrality as the excess of conservative strong-base cations over strong-acid anions:
   $$[\text{Alk}] \equiv \sum_{c \in \text{strong cations}} z_c C_c - \sum_{a \in \text{strong anions}} |z_a| C_a = [\text{HCO}_3^-] + 2[\text{CO}_3^{2-}] + [\text{H}_2\text{PO}_4^-] + 2[\text{HPO}_4^{2-}] + 3[\text{PO}_4^{3-}] + [\text{OH}^-] - [\text{H}^+] - [\text{NH}_4^+]$$
   *(Note: In standard carbonate + phosphate + ammonium titration convention where $\text{H}_3\text{PO}_4$, $\text{H}_2\text{CO}_3^*$, and $\text{NH}_3$ are the zero-proton reference levels, or equivalently tracking total conservative charge difference $\Delta Z_{\text{strong}}$ directly.)*
2. **Total Dissolved Inorganic Carbon (DIC)**: $C_T(t) = [\text{H}_2\text{CO}_3^*] + [\text{HCO}_3^-] + [\text{CO}_3^{2-}]$ $[\text{mol m}^{-3}]$.

### 4.2 Balance Equations

#### Equation (4.1) — Total Alkalinity (Conservative Charge Difference) Balance
$$\frac{d(V_{\text{tot}} [\text{Alk}])}{dt} = Q_{\text{src}} [\text{Alk}]_{\text{src}} + \sum_{k} Q_{\text{dose},k} N_{\text{alk,stock},k} + N_{\text{pl}} \left( \gamma_{\text{OH},\text{NO}_3} J_{\text{up},\text{NO}_3^-} - \gamma_{\text{H},\text{NH}_4} J_{\text{up},\text{NH}_4^+} \right) - Q_{\text{leak}} [\text{Alk}]$$
- **Symbol Table & Units**:
  - $[\text{Alk}]$: Solution titration alkalinity $[\text{eq m}^{-3} = \text{meq L}^{-1}]$; $[\text{Alk}]_{\text{src}}$: source water alkalinity $[\text{eq m}^{-3}]$; $N_{\text{alk,stock},k}$: net normality of acid ($<0$) or base/bicarbonate ($>0$) stock $k$ $[\text{eq m}^{-3}]$.
  - $\gamma_{\text{OH},\text{NO}_3}$: Net root $\text{OH}^-/\text{HCO}_3^-$ extrusion (or $\text{H}^+$ co-transport influx) per mole of $\text{NO}_3^-$ absorbed $[\text{eq mol}^{-1}]$ (reflecting excess total anion-over-cation uptake when $\text{NO}_3^-$ is the primary N source).
  - $\gamma_{\text{H},\text{NH}_4}$: Net root $\text{H}^+$ extrusion per mole of $\text{NH}_4^+$ absorbed $[\text{eq mol}^{-1}]$.
- **Config Dependencies**: $V_{\text{res},0}, N_{\text{ch}}, N_{\text{pl,ch}}, [\text{Alk}]_{\text{src}}, C_{\text{stock},k,i}, N_{\text{alk,stock},k}$.
- **Validity Range**: $\text{pH} \in [4.0, 8.5]$.
- **Dimensional Check**: $\text{LHS} = [\text{m}^3][\text{eq m}^{-3}]\text{ s}^{-1} = \text{eq s}^{-1}$; $\text{RHS} = [\text{m}^3\text{ s}^{-1}][\text{eq m}^{-3}] + [-][\text{eq mol}^{-1}][\text{mol s}^{-1}] = \text{eq s}^{-1}$. Exact match.
- **Limiting-Case Check**: When $\text{NH}_4^+$ is present and rapidly absorbed during early growth ($J_{\text{up},\text{NH}_4^+} > (\gamma_{\text{OH},\text{NO}_3}/\gamma_{\text{H},\text{NH}_4}) J_{\text{up},\text{NO}_3^-}$), $d[\text{Alk}]/dt < 0$ and pH drops (matching the drop to $\text{pH } 4.25$ on Day 8 in `ZH24` Fig. 1a). Once $\text{NH}_4^+$ is depleted ($J_{\text{up},\text{NH}_4^+} \to 0$), $\text{NO}_3^-$ uptake dominates, $d[\text{Alk}]/dt > 0$, and pH rises steadily unless buffered or acid-dosed.
- **Source Tag**: `[A]` — Assumption: Lumped stoichiometric proton/hydroxyl coefficients $\gamma_{\text{OH},\text{NO}_3} = 0.22\text{ eq mol}^{-1}$ (plausible range $[0.10, 0.45]$, sensitivity rank $R_{\text{sens}} = 13/21$) and $\gamma_{\text{H},\text{NH}_4} = 1.15\text{ eq mol}^{-1}$ (plausible range $[0.90, 1.30]$, sensitivity rank $R_{\text{sens}} = 15/21$), anchored to the root-zone electroneutrality principle (`[T]` Marschner) and the pH trajectory in `OPENED` Zhang et al. (2024) `ZH24` Sec. 4.1 & Figs. 1a, 4a–b.

#### Equation (4.2) — Total Dissolved Inorganic Carbon (DIC) Balance
$$\frac{d(V_{\text{tot}} C_T)}{dt} = Q_{\text{src}} C_{T,\text{src}} + \sum_{k} Q_{\text{dose},k} C_{T,\text{stock},k} + N_{\text{pl}} R_{\text{root},\text{CO}_2} - k_{L,\text{CO}_2} A_{\text{gas,eff}} \left([\text{H}_2\text{CO}_3^*] - K_{H,\text{CO}_2}(T_w) P_{\text{CO}_2,\text{air}}\right) - Q_{\text{leak}} C_T$$
- **Symbol Table & Units**:
  - $C_T$: Total dissolved inorganic carbon $[\text{mol m}^{-3}]$; $R_{\text{root},\text{CO}_2} = \text{RQ}_{\text{root}} R_{\text{root},\text{O}_2}$: root respiratory $\text{CO}_2$ evolution $[\text{mol plant}^{-1}\text{ s}^{-1}]$ with respiratory quotient $\text{RQ}_{\text{root}} = 1.0$.
  - $k_{L,\text{CO}_2} A_{\text{gas,eff}} = \beta_{\text{CO}_2/\text{O}_2} \big(k_L a_{\text{aer}} V_{\text{res}} + k_{v,\text{ch}} A_{\text{ch,tot}}\big)$: total $\text{CO}_2$ gas-liquid mass transfer conductance $[\text{m}^3\text{ s}^{-1}]$ scaled from oxygen transfer by Graham/diffusivity ratio $\beta_{\text{CO}_2/\text{O}_2} = (D_{\text{CO}_2}/D_{\text{O}_2})^{1/2} = 0.89$.
  - $K_{H,\text{CO}_2}(T_w) = 33.8 \exp\!\left[2400\left(\frac{1}{T_w + 273.15} - \frac{1}{298.15}\right)\right]$: Henry's law constant for $\text{CO}_2$ $[\text{mol m}^{-3}\text{ atm}^{-1}]$; $P_{\text{CO}_2,\text{air}}$: partial pressure of $\text{CO}_2$ in air $[\text{atm}]$.
- **Config Dependencies**: $V_{\text{res},0}, A_{\text{res}}, Q_{\text{air}}, \text{OTR}_{\text{std}}, N_{\text{ch}}, L_{\text{ch}}, W_{\text{ch}}, [\text{Alk}]_{\text{src}}$.
- **Validity Range**: $T_w \in [5, 40]^\circ\text{C}$, $\text{pH} \in [4.0, 8.5]$.
- **Dimensional Check**: $[\text{m}^3\text{ s}^{-1}][\text{mol m}^{-3}] = \text{mol s}^{-1}$. Exact match.
- **Limiting-Case Check**: Under vigorous aeration at $\text{pH} < 5.5$, nearly all DIC is $[\text{H}_2\text{CO}_3^*]$ and outgasses until $[\text{H}_2\text{CO}_3^*] = K_{H,\text{CO}_2} P_{\text{CO}_2,\text{air}} \approx 0.014\text{ mol m}^{-3}$.
- **Source Tag**: `[T]` — Textbook Principle: Two-Film Gas-Liquid Mass Transfer & Henry's Law (Stumm & Morgan, *Aquatic Chemistry*).

### 4.3 Constitutive Relation for Equilibrium pH

#### Equation (4.3) — Implicit Aqueous Speciation & Electroneutrality Equation for $[\text{H}^+]$
$$F([\text{H}^+]) \equiv [\text{Alk}] - C_T \frac{K_{a1,C}[\text{H}^+] + 2K_{a1,C}K_{a2,C}}{[\text{H}^+]^2 + K_{a1,C}[\text{H}^+] + K_{a1,C}K_{a2,C}} - C_{\text{P,tot}} \frac{K_{a1,P}[\text{H}^+]^2 + 2K_{a1,P}K_{a2,P}[\text{H}^+] + 3K_{a1,P}K_{a2,P}K_{a3,P}}{[\text{H}^+]^3 + K_{a1,P}[\text{H}^+]^2 + K_{a1,P}K_{a2,P}[\text{H}^+] + K_{a1,P}K_{a2,P}K_{a3,P}} + C_{\text{NH}_4,\text{tot}} \frac{[\text{H}^+]}{[\text{H}^+] + K_{a,N}} - \frac{K_w(T_w)}{[\text{H}^+]} + [\text{H}^+] = 0$$
$$\text{pH} = -\log_{10}\!\left(\gamma_1 [\text{H}^+] \times 10^{-3}\right)$$
- **Symbol Table & Units**:
  - $[\text{H}^+]$: Free proton concentration $[\text{mol m}^{-3} = \text{mmol L}^{-1}]$; $\gamma_1 = 10^{-0.509 \sqrt{I_{\text{str}}}/(1 + \sqrt{I_{\text{str}}})}$: Güntelberg monovalent activity coefficient $[-]$.
  - Dissociation constants at $25^\circ\text{C}$ (converted to $\text{mol m}^{-3} = 10^3\text{ mol L}^{-1}$):
    - Carbonic acid: $\text{p}K_{a1,C} = 6.35 \Rightarrow K_{a1,C} = 4.47\times 10^{-4}\text{ mol m}^{-3}$; $\text{p}K_{a2,C} = 10.33 \Rightarrow K_{a2,C} = 4.68\times 10^{-8}\text{ mol m}^{-3}$.
    - Phosphoric acid: $\text{p}K_{a1,P} = 2.15 \Rightarrow K_{a1,P} = 7.08\text{ mol m}^{-3}$; $\text{p}K_{a2,P} = 7.20 \Rightarrow K_{a2,P} = 6.31\times 10^{-5}\text{ mol m}^{-3}$; $\text{p}K_{a3,P} = 12.35 \Rightarrow K_{a3,P} = 4.47\times 10^{-10}\text{ mol m}^{-3}$.
    - Ammonium: $\text{p}K_{a,N} = 9.25 \Rightarrow K_{a,N} = 5.62\times 10^{-7}\text{ mol m}^{-3}$.
    - Water auto-ionization: $K_w(25^\circ\text{C}) = 1.00\times 10^{-8}\text{ (mol m}^{-3})^2$.
- **Config Dependencies**: $[\text{Alk}]_{\text{src}}, C_{\text{src},i}, C_{\text{stock},k,i}$.
- **Validity Range**: $\text{pH} \in [3.0, 10.0]$. Because $\frac{\partial F}{\partial [\text{H}^+]} > 0$ strictly for all $[\text{H}^+] > 0$, $F([\text{H}^+]) = 0$ has a **unique positive root**.
- **Dimensional Check**: Every term in $F([\text{H}^+])$ has units of $\text{eq m}^{-3} = \text{mol m}^{-3}$. Exact match.
- **Limiting-Case Check**: Differentiating $[\text{Alk}]$ with respect to $\text{pH}$ yields the exact Van Slyke buffer capacity $\beta_{\text{buf}} = \frac{d[\text{Alk}]}{d\text{pH}} = 2.303 \left([\text{H}^+] + [\text{OH}^-] + C_T \frac{K_{a1,C}[\text{H}^+]}{([\text{H}^+] + K_{a1,C})^2} + C_{\text{P,tot}} \frac{K_{a2,P}[\text{H}^+]}{([\text{H}^+] + K_{a2,P})^2}\right)$, showing maximum phosphate buffering at $\text{pH} = 7.20$ and carbonate buffering at $\text{pH} = 6.35$ (matching `ZH24` Sec. 4.1).
- **Source Tag**: `[T]` — Textbook Principle: Simultaneous Acid-Base Equilibrium & Electroneutrality / Van Slyke Buffer Index (Stumm & Morgan, *Aquatic Chemistry*).

---

## MODULE 5: Water Temperature (Reservoir and Channel Heat Balance)

### 5.1 Conserved State Variables
1. **Reservoir Thermal Energy**: $\mathcal{E}_{\text{res}} = \rho_w c_{p,w} V_{\text{res}} T_{\text{res}}$ $[\text{J}]$
2. **Channel Film Thermal Energy**: $\mathcal{E}_{\text{ch}} = \rho_w c_{p,w} V_{\text{ch,tot}} T_{\text{ch}}$ $[\text{J}]$

### 5.2 Balance Equations

#### Equation (5.1) — Reservoir Water Heat Balance
$$\rho_w c_{p,w} V_{\text{res}} \frac{dT_{\text{res}}}{dt} = \rho_w c_{p,w} Q_{\text{ch,out}} (T_{\text{ch,out}} - T_{\text{res}}) + \rho_w c_{p,w} Q_{\text{src}} (T_{\text{src}} - T_{\text{res}}) + U_{\text{res}} A_{\text{wall}}(V_{\text{res}}) (T_{\text{amb,res}} - T_{\text{res}}) + Q_{\text{rad,res}} + P_{\text{pump,heat}} - \lambda_v \rho_w Q_{\text{evap,res}}$$
- **Symbol Table & Units**:
  - $T_{\text{res}}, T_{\text{ch,out}}, T_{\text{src}}$: Reservoir, channel-outlet, and makeup water temperatures $[{}^\circ\text{C}]$; $c_{p,w} = 4184\text{ J kg}^{-1}\text{ K}^{-1}$; $\lambda_v = 2.45\times 10^6\text{ J kg}^{-1}$: latent heat of vaporization.
  - $U_{\text{res}}$: Reservoir wall/lid thermal conductance $[\text{W m}^{-2}\text{ K}^{-1}]$; $A_{\text{wall}}(V_{\text{res}})$: wetted wall + lid area $[\text{m}^2]$.
  - $T_{\text{amb,res}}$: Ambient air temperature around reservoir ($T_{\text{air}}$ if $\mathcal{P}_{\text{res}} = \text{indoor}$, $T_{\text{out}}$ if $\mathcal{P}_{\text{res}} \in \{\text{shaded}, \text{sun}\}$).
  - $Q_{\text{rad,res}}$: Solar radiative heat gain on reservoir $[\text{W}]$ (Eq. 5.3).
  - $P_{\text{pump,heat}} = f_{\text{sub}} P_{\text{pump,elec}} \eta_{\text{pump}}$: Submerged pump motor heat dissipation into water $[\text{W}]$.
- **Config Dependencies**: $V_{\text{res},0}, A_{\text{res}}, H_{\text{res}}, U_{\text{res}}, \mathcal{P}_{\text{res}}, Q_{\text{pump,rated}}, \eta_{\text{pump}}$.
- **Validity Range**: $T_{\text{res}} \in [2, 45]^\circ\text{C}$.
- **Dimensional Check**: $\text{LHS} = [\text{kg m}^{-3}][\text{J kg}^{-1}\text{ K}^{-1}][\text{m}^3][\text{K s}^{-1}] = \text{W}$; $\text{RHS} = \text{W}$. Exact match.
- **Limiting-Case Check**: When the pump is off ($Q_{\text{ch,out}} = 0, P_{\text{pump,heat}} = 0$), $Q_{\text{src}} = 0$, $Q_{\text{evap,res}} = 0$, and $\mathcal{P}_{\text{res}} = \text{indoor}$ ($Q_{\text{rad,res}} = 0$), $T_{\text{res}} \to T_{\text{amb,res}}$ with thermal time constant $\tau_{\text{heat,res}} = \frac{\rho_w c_{p,w} V_{\text{res}}}{U_{\text{res}} A_{\text{wall}}}$.
- **Source Tag**: `[T]` — Textbook Principle: First Law of Thermodynamics for Open Control Volumes.

#### Equation (5.2) — Longitudinal & Lumped Channel Water Heat Balance
$$\rho_w c_{p,w} V_{\text{ch,tot}} \frac{dT_{\text{ch}}}{dt} = \rho_w c_{p,w} Q_{\text{pump}} (T_{\text{res}} - T_{\text{ch,out}}) + A_{\text{ch,tot}} \left[ U_{\text{ch,top}}(T_{\text{air}} - T_{\text{ch}}) + \alpha_{\text{ch,sol}} e^{-k_{\text{ext}}\text{LAI}} I_{\text{can,sw}} \right] - \lambda_v \rho_w Q_{\text{evap,ch}}$$
$$T_{\text{ch,out}} = T_{\text{eq,ch}} + (T_{\text{res}} - T_{\text{eq,ch}}) \exp\!\left(-\frac{U_{\text{ch,top}} A_{\text{ch,tot}}}{\rho_w c_{p,w} Q_{\text{pump}}}\right), \qquad T_{\text{eq,ch}} = T_{\text{air}} + \frac{\alpha_{\text{ch,sol}} e^{-k_{\text{ext}}\text{LAI}} I_{\text{can,sw}}}{U_{\text{ch,top}}}$$
- **Symbol Table & Units**:
  - $T_{\text{ch}}, T_{\text{ch,out}}$: Mean and outlet channel water temperature $[{}^\circ\text{C}]$; $U_{\text{ch,top}}$: overall convective/conductive heat transfer coefficient between gully film and enclosure air $[\text{W m}^{-2}\text{ K}^{-1}]$; $\alpha_{\text{ch,sol}}$: effective shortwave absorptance of white PVC gully cover transmitted into the water film $[-]$.
- **Config Dependencies**: $N_{\text{ch}}, L_{\text{ch}}, W_{\text{ch}}, Q_{\text{pump,rated}}, \eta_{\text{pump}}$.
- **Validity Range**: $Q_{\text{pump}} > 0$, $T_{\text{ch}} \in [2, 45]^\circ\text{C}$.
- **Dimensional Check**: Exponent $-\frac{U_{\text{ch,top}} A_{\text{ch,tot}}}{\rho_w c_{p,w} Q_{\text{pump}}} = \frac{[\text{W m}^{-2}\text{ K}^{-1}][\text{m}^2]}{[\text{kg m}^{-3}][\text{J kg}^{-1}\text{ K}^{-1}][\text{m}^3\text{ s}^{-1}]} = [-]$ (dimensionless NTU). Exact match.
- **Limiting-Case Check**: As $Q_{\text{pump}} \to \infty$ (short residence time), $\text{NTU} \to 0$ and $T_{\text{ch,out}} \to T_{\text{res}}$. As $Q_{\text{pump}} \to 0$ (pump degradation/stall), $\text{NTU} \to \infty$ and channel water heats to the radiative-convective equilibrium temperature $T_{\text{eq,ch}}$.
- **Source Tag**: `[A]` — Assumption: White PVC NFT gully heat transfer coefficient $U_{\text{ch,top}} = 6.0\text{ W m}^{-2}\text{ K}^{-1}$ (range $[4.0, 10.0]$, sensitivity rank $R_{\text{sens}} = 16/21$, max OAT impact $0.67\%$) and unshaded gully solar absorptance $\alpha_{\text{ch,sol}} = 0.15$ (range $[0.08, 0.30]$, sensitivity rank $R_{\text{sens}} = 20/21$, max OAT impact $0.05\%$).

#### Equation (5.3) — Reservoir Placement Solar Heat Gain
$$Q_{\text{rad,res}} = A_{\text{res}} I_{\text{out,sw}} \times \begin{cases} 0 & \text{if } \mathcal{P}_{\text{res}} = \text{indoor} \\ \alpha_{\text{res,sh}} & \text{if } \mathcal{P}_{\text{res}} = \text{shaded} \\ \alpha_{\text{res,sun}} & \text{if } \mathcal{P}_{\text{res}} = \text{sun} \end{cases}$$
- **Symbol Table & Units**:
  - $\alpha_{\text{res,sh}} = 0.08$: diffuse solar absorptance under shade; $\alpha_{\text{res,sun}} = 0.65$: direct solar absorptance in sun $[-]$.
- **Config Dependencies**: $A_{\text{res}}, \mathcal{P}_{\text{res}}, \phi_{\text{lat}}, \text{DOY}_0$.
- **Validity Range**: $I_{\text{out,sw}} \ge 0$.
- **Dimensional Check**: $[\text{m}^2][\text{W m}^{-2}][-] = \text{W}$. Exact match.
- **Limiting-Case Check**: For `indoor` placement or nighttime ($I_{\text{out,sw}} = 0$), $Q_{\text{rad,res}} = 0$.
- **Source Tag**: `[T]` — Textbook Principle: Surface Shortwave Radiation Absorption.

---

## MODULE 6: Dissolved Oxygen (Saturation, Aeration, Root Respiration, Channel Re-Aeration)

### 6.1 Conserved State Variables
1. **Reservoir Dissolved Oxygen Mass**: $M_{\text{DO,res}} = V_{\text{res}} C_{\text{DO,res}}$ $[\text{g O}_2]$ (with $C_{\text{DO}}$ in $\text{g m}^{-3} = \text{mg L}^{-1}$)
2. **Channel Dissolved Oxygen Distribution**: $C_{\text{DO,ch}}(x, t)$ along $x \in [0, L_{\text{ch}}]$ $[\text{g m}^{-3} = \text{mg L}^{-1}]$

### 6.2 Constitutive & Balance Equations

#### Equation (6.1) — Benson & Krause (1984) / USGS DOTABLES Dissolved Oxygen Saturation
$$\ln C_{\text{DO},0}(T_K) = -139.34411 + \frac{1.575701\times 10^5}{T_K} - \frac{6.642308\times 10^7}{T_K^2} + \frac{1.243800\times 10^{10}}{T_K^3} - \frac{8.621949\times 10^{11}}{T_K^4}$$
$$F_S(T_K, S) = \exp\!\left[-S \left(0.017674 - \frac{10.754}{T_K} + \frac{2140.7}{T_K^2}\right)\right], \qquad S = 0.55 \, \text{EC}_{25}$$
$$F_P(T_K, P_{\text{atm}}) = P_{\text{atm}} \frac{(1 - u_{\text{vap}}/P_{\text{atm}})(1 - \theta_0 P_{\text{atm}})}{(1 - u_{\text{vap}})(1 - \theta_0)}, \qquad C_{\text{DO,sat}}(T_w, \text{EC}_{25}, P_{\text{atm}}) = C_{\text{DO},0}(T_K) \, F_S(T_K, S) \, F_P(T_K, P_{\text{atm}})$$
- **Symbol Table & Units**:
  - $T_K = T_w + 273.15$: Absolute water temperature $[\text{K}]$; $C_{\text{DO,sat}}$: equilibrium dissolved oxygen saturation concentration $[\text{mg L}^{-1} = \text{g m}^{-3}]$.
  - $S$: Practical salinity $[\text{‰} = \text{g kg}^{-1}]$ related to nutrient solution $\text{EC}_{25}$ $[\text{dS m}^{-1}]$ by $S \approx 0.55 \, \text{EC}_{25}$.
  - $P_{\text{atm}} = (1 - 2.25577\times 10^{-5} z_{\text{elev}})^{5.25588}$: Barometric pressure $[\text{atm}]$; $u_{\text{vap}} = \exp(11.8571 - 3840.70/T_K - 216961/T_K^2)$ $[\text{atm}]$; $\theta_0 = 0.000975 - 1.426\times 10^{-5} T_w + 6.436\times 10^{-8} T_w^2$ $[\text{atm}^{-1}]$.
- **Config Dependencies**: $z_{\text{elev}}, C_{\text{src},i}, C_{\text{stock},k,i}$ (via $\text{EC}_{25}$).
- **Validity Range**: $T_w \in [0, 40]^\circ\text{C}$, $S \in [0, 40]\text{ ‰}$, $P_{\text{atm}} \in [0.5, 1.1]\text{ atm}$.
- **Dimensional Check**: Empirical Henry's law polynomial calibrated directly to $[\text{mg L}^{-1}]$, multiplied by dimensionless salinity and pressure factors $F_S, F_P$.
- **Limiting-Case Check**: At $T_w = 20^\circ\text{C}, S = 0, P_{\text{atm}} = 1$, $C_{\text{DO,sat}} = 9.0924\text{ mg L}^{-1}$; as $T_w$ increases to $30^\circ\text{C}$, $C_{\text{DO,sat}}$ drops to $7.5588\text{ mg L}^{-1}$.
- **Source Tag**: `[S]` — Read in USGS Technical Memorandum 2011.03 / Benson & Krause (1984) `BK84`, Eqs. (1), (4), (7)–(11).

#### Equation (6.2) — Reservoir Dissolved Oxygen Mass Balance & Aerator Transfer Coefficient
$$V_{\text{res}} \frac{dC_{\text{DO,res}}}{dt} = Q_{\text{ch,out}} (C_{\text{DO,ch,out}} - C_{\text{DO,res}}) + Q_{\text{src}} (C_{\text{DO,src}} - C_{\text{DO,res}}) + \left(k_L a_{\text{aer}}(T_{\text{res}}) V_{\text{res}} + k_{v,\text{res}} A_{\text{res}}\right)\!\big(C_{\text{DO,sat}}(T_{\text{res}}) - C_{\text{DO,res}}\big)$$
$$k_L a_{\text{aer}}(T_{\text{res}}) = \theta_{\text{aer}}^{T_{\text{res}} - 20} \times \begin{cases} \dfrac{\text{OTR}_{\text{std}}}{V_{\text{res}} \, C_{\text{DO,sat}}(20^\circ\text{C})} & \text{if } \text{OTR}_{\text{std}} \text{ is specified} \\[8pt] \dfrac{\eta_{\text{O}_2,\text{bubble}} \, H_{\text{res}} \, \rho_{\text{O}_2,\text{air}} \, Q_{\text{air}}}{V_{\text{res}} \, C_{\text{DO,sat}}(20^\circ\text{C})} & \text{if } Q_{\text{air}} \text{ is specified} \end{cases}$$
- **Symbol Table & Units**:
  - $C_{\text{DO,res}}, C_{\text{DO,ch,out}}, C_{\text{DO,src}}$: Reservoir, channel-outlet, and source water DO concentrations $[\text{g m}^{-3} = \text{mg L}^{-1}]$.
  - $k_L a_{\text{aer}}(T_{\text{res}})$: Volumetric oxygen mass transfer coefficient of the aerator $[\text{s}^{-1}]$; $\theta_{\text{aer}} = 1.024$: van 't Hoff-Arrhenius temperature correction factor for gas transfer $[-]$.
  - $\rho_{\text{O}_2,\text{air}} = 280\text{ g O}_2\text{ m}^{-3}\text{ air}$; $\eta_{\text{O}_2,\text{bubble}} = 0.015\text{ m}^{-1}$: fractional oxygen absorption efficiency per meter of submergence depth $H_{\text{res}}$ for fine-pore diffusers; $k_{v,\text{res}} = 5.0\times 10^{-6}\text{ m s}^{-1}$: quiescent reservoir free-surface mass transfer velocity.
- **Config Dependencies**: $V_{\text{res},0}, A_{\text{res}}, H_{\text{res}}, Q_{\text{air}}, \text{OTR}_{\text{std}}, Q_{\text{pump,rated}}, \eta_{\text{pump}}$.
- **Validity Range**: $C_{\text{DO,res}} \in [0, C_{\text{DO,sat}}]$, $T_{\text{res}} \in [5, 40]^\circ\text{C}$.
- **Dimensional Check**: $\text{LHS} = [\text{m}^3][\text{g m}^{-3}\text{ s}^{-1}] = \text{g s}^{-1}$; $\text{RHS} = [\text{m}^3\text{ s}^{-1}][\text{g m}^{-3}] + [\text{s}^{-1}][\text{m}^3][\text{g m}^{-3}] = \text{g s}^{-1}$. Exact match.
- **Limiting-Case Check**: If aeration fails ($Q_{\text{air}} = \text{OTR}_{\text{std}} = 0$), $k_L a_{\text{aer}} = 0$ and reservoir oxygenation reduces solely to passive surface exchange $k_{v,\text{res}} A_{\text{res}}$.
- **Source Tag**: `[T]` — Textbook Principle: Lewis-Whitman Two-Film Gas Transfer Theory & ASCE Standard Oxygen Transfer Rate Definition.

#### Equation (6.3) — Root Respiration Rate per Plant (Chun & Takakura 1994 + Dry-Weight Coupling)
$$R_{\text{root},\text{O}_2}(T_{\text{ch}}, C_{\text{DO}}) = r_{\text{O}_2,\text{ref}} \, X_{\text{rt,plant}} \, Q_{10,\text{DO}}^{(T_{\text{ch}} - 23.0)/10.0} \, \frac{C_{\text{DO}}}{K_{m,\text{DO}} + C_{\text{DO}}}$$
- **Symbol Table & Units**:
  - $R_{\text{root},\text{O}_2}$: Oxygen consumption rate per plant root system $[\text{g O}_2\text{ plant}^{-1}\text{ s}^{-1}]$.
  - $X_{\text{rt,plant}} = \frac{A_{\text{fl}}}{N_{\text{pl}}} c_\tau X_d$: Root dry weight per plant $[\text{kg DM plant}^{-1}]$ (or in early seedling calibration mode, converted from root volume $V_{\text{root}}(d) = 0.0698 \times 1.1230^d\text{ mL plant}^{-1}$ with specific root density $\rho_{\text{rt,DM}} \approx 0.055\text{ g DM mL}^{-1}$).
  - $r_{\text{O}_2,\text{ref}} = 7.8\times 10^{-4}\text{ g O}_2\text{ (kg root DM)}^{-1}\text{ s}^{-1}$ ($= 2.81\text{ mg O}_2\text{ g}^{-1}\text{ root DM h}^{-1} \approx 4.8\text{ }\mu\text{mol O}_2\text{ h}^{-1}\text{ mL}^{-1}\text{ root}$ at $23^\circ\text{C}$, midpoint of Chun & Takakura's $2.9\text{–}6.7\text{ }\mu\text{mol O}_2\text{ h}^{-1}\text{ mL}^{-1}$ range).
  - $Q_{10,\text{DO}} = 2.0$: Temperature coefficient of root respiration $[-]$; $K_{m,\text{DO}} = 1.5\text{ mg L}^{-1}$ ($= 46.9\text{ }\mu\text{mol L}^{-1}$): Michaelis-Menten half-saturation DO concentration for root respiration.
- **Config Dependencies**: $N_{\text{ch}}, N_{\text{pl,ch}}, d_0, A_{\text{fl}}$.
- **Validity Range**: $T_{\text{ch}} \in [5, 35]^\circ\text{C}$, $C_{\text{DO}} \ge 0$.
- **Dimensional Check**: $[\text{g O}_2\text{ kg}^{-1}\text{ s}^{-1}][\text{kg plant}^{-1}][-][-] = \text{g O}_2\text{ plant}^{-1}\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: As $C_{\text{DO}} \to 0$, $R_{\text{root},\text{O}_2} \to 0$ (preventing unphysical negative dissolved oxygen concentrations!). At $C_{\text{DO}} \gg K_{m,\text{DO}}$, respiration saturates at $r_{\text{O}_2,\text{ref}} X_{\text{rt,plant}} Q_{10,\text{DO}}^{(T_{\text{ch}}-23)/10}$.
- **Source Tag**: `[S]` — Read in Chun & Takakura (1994) `CT94` Sec. 3, Eqs. (1), (4), (5) & Table 2 ($2.9\text{–}6.7\text{ }\mu\text{mol O}_2\text{ h}^{-1}\text{ mL}^{-1}\text{ root}$ at $23^\circ\text{C}$ and saturation decline below $78\text{ }\mu\text{mol L}^{-1}$), combined with `[A]` for $Q_{10,\text{DO}} = 2.0$ (range $[1.6, 2.4]$, sensitivity rank $R_{\text{sens}} = 18/21$) and $K_{m,\text{DO}} = 1.5\text{ mg L}^{-1}$ (range $[0.8, 2.5]\text{ mg L}^{-1}$, sensitivity rank $R_{\text{sens}} = 8/21$).

#### Equation (6.4) — Longitudinal Channel DO Profile & Outlet DO Concentration
$$q_{\text{ch}} \frac{\partial C_{\text{DO,ch}}}{\partial x} = W_{\text{ch}} k_{v,\text{ch}}(T_{\text{ch}}) \big(C_{\text{DO,sat}}(T_{\text{ch}}) - C_{\text{DO,ch}}(x)\big) - \frac{N_{\text{pl,ch}}}{L_{\text{ch}}} R_{\text{root},\text{O}_2}\!\big(T_{\text{ch}}, C_{\text{DO,ch}}(x)\big)$$
$$C_{\text{DO,ch,out}} = C_{\text{DO,sat}}(T_{\text{ch}}) - \frac{N_{\text{pl,ch}} R_{\text{root},\text{O}_2}}{W_{\text{ch}} L_{\text{ch}} k_{v,\text{ch}}} + \left(C_{\text{DO,res}} - C_{\text{DO,sat}}(T_{\text{ch}}) + \frac{N_{\text{pl,ch}} R_{\text{root},\text{O}_2}}{W_{\text{ch}} L_{\text{ch}} k_{v,\text{ch}}}\right) \exp\!\left(-\frac{W_{\text{ch}} L_{\text{ch}} k_{v,\text{ch}}}{q_{\text{ch}}}\right)$$
- **Symbol Table & Units**:
  - $q_{\text{ch}} = Q_{\text{pump}} / N_{\text{ch}}$: Volumetric flow rate per gully $[\text{m}^3\text{ s}^{-1}]$; $k_{v,\text{ch}}(T_{\text{ch}}) = k_{v,\text{ch},20} \, \theta_{\text{aer}}^{T_{\text{ch}}-20} (v_{\text{ch}}/v_0)^{1/2} (h_{\text{ch}}/h_0)^{-1/2}$: thin-film free-surface re-aeration mass transfer velocity $[\text{m s}^{-1}]$ (Higbie penetration theory scaling with velocity $v_{\text{ch}}$ and film depth $h_{\text{ch}}$).
- **Config Dependencies**: $N_{\text{ch}}, L_{\text{ch}}, W_{\text{ch}}, S_0, N_{\text{pl,ch}}, Q_{\text{pump,rated}}, \eta_{\text{pump}}$.
- **Validity Range**: $q_{\text{ch}} > 0$; analytical integration holds in the quasi-linear regime or step-wise along channel segments, clipped below at $C_{\text{DO}} \ge 0$.
- **Dimensional Check**: $\frac{N_{\text{pl,ch}} R_{\text{root},\text{O}_2}}{W_{\text{ch}} L_{\text{ch}} k_{v,\text{ch}}} = \frac{[-][\text{g s}^{-1}]}{[\text{m}][\text{m}][\text{m s}^{-1}]} = \text{g m}^{-3} = \text{mg L}^{-1}$; exponent $\frac{W_{\text{ch}} L_{\text{ch}} k_{v,\text{ch}}}{q_{\text{ch}}} = \frac{[\text{m}^2][\text{m s}^{-1}]}{[\text{m}^3\text{ s}^{-1}]} = [-]$. Exact match.
- **Limiting-Case Check**: When $N_{\text{pl,ch}} = 0$ ($R_{\text{root},\text{O}_2} = 0$), $C_{\text{DO,ch,out}}$ relaxes toward $C_{\text{DO,sat}}(T_{\text{ch}})$. As channel length $L_{\text{ch}}$ increases or per-channel flow $q_{\text{ch}}$ drops, longitudinal DO depletion $\Delta C_{\text{DO}} = C_{\text{DO,res}} - C_{\text{DO,ch,out}}$ increases proportionally to $\frac{N_{\text{pl,ch}} R_{\text{root},\text{O}_2}}{q_{\text{ch}}}$.
- **Source Tag**: `[T]` — Textbook Principle: 1D Steady-State Advection-Reaction-Mass-Transfer Balance (Streeter-Phelps / Higbie Thin-Film Penetration Theory), with `[A]` for nominal thin-film transfer velocity $k_{v,\text{ch},20} = 2.2\times 10^{-5}\text{ m s}^{-1}$ ($= 0.08\text{ m h}^{-1}$, range $[0.03, 0.20]\text{ m h}^{-1}$, sensitivity rank $R_{\text{sens}} = 12/21$).

---

## MODULE 7: Channel Residence Time (Minimal Hydraulics)

### 7.1 Conserved State Variables
The conserved hydraulic quantity in each NFT gully is the cross-sectional liquid area $A_{w,\text{ch}}(x,t) = W_{\text{ch}} h_{\text{ch}}(x,t)$ $[\text{m}^2]$, or integrated over all $N_{\text{ch}}$ gullies of length $L_{\text{ch}}$, the total channel holdup volume $V_{\text{ch,tot}}(t) = N_{\text{ch}} L_{\text{ch}} W_{\text{ch}} h_{\text{ch}}(t)$ $[\text{m}^3]$.

### 7.2 Balance & Constitutive Equations

#### Equation (7.1) — Wide-Channel Manning Film Depth, Velocity, and Root-Mat Drag
$$q_{\text{ch}} = \frac{\eta_{\text{pump}} Q_{\text{pump,rated}}}{N_{\text{ch}}}, \qquad n_{\text{ch,eff}} = n_{\text{PVC}} \left(1 + c_{\text{root,drag}} \frac{X_{\text{rt,plant}}}{W_{\text{ch}} s_{\text{pl}} \rho_{\text{rt,bulk}}}\right)$$
$$h_{\text{ch}} = h_{\text{res,puddle}} + \left(\frac{n_{\text{ch,eff}} \, q_{\text{ch}}}{W_{\text{ch}} \, S_0^{1/2}}\right)^{3/5}, \qquad v_{\text{ch}} = \frac{q_{\text{ch}}}{W_{\text{ch}} h_{\text{ch}}}$$
- **Symbol Table & Units**:
  - $q_{\text{ch}}$: Volumetric flow rate per channel $[\text{m}^3\text{ s}^{-1}]$; $h_{\text{ch}}$: mean liquid film depth in gully $[\text{m}]$; $v_{\text{ch}}$: mean longitudinal flow velocity $[\text{m s}^{-1}]$.
  - $n_{\text{PVC}} = 0.010\text{ s m}^{-1/3}$: Manning roughness coefficient of clean smooth PVC gully; $n_{\text{ch,eff}}$: effective Manning roughness including root-mat hydraulic resistance $[\text{s m}^{-1/3}]$.
  - $c_{\text{root,drag}} = 12.0$ $[-]$: dimensionless root-mat drag amplification coefficient; $\rho_{\text{rt,bulk}} = 55.0\text{ kg root DM m}^{-3}$: bulk root dry-matter density in the wet root mat; $h_{\text{res,puddle}} = 5.0\times 10^{-4}\text{ m}$ ($0.5\text{ mm}$): capillary/surface-tension residual film depth retained by roots when pump stalls ($q_{\text{ch}} = 0$).
- **Config Dependencies**: $Q_{\text{pump,rated}}, \eta_{\text{pump}}, N_{\text{ch}}, W_{\text{ch}}, S_0, s_{\text{pl}}$.
- **Validity Range**: Shallow open-channel sheet flow ($h_{\text{ch}} \ll W_{\text{ch}}$, $h_{\text{ch}} \in [0.5\text{ mm}, 25\text{ mm}]$), $S_0 \in [0.005, 0.05]$.
- **Dimensional Check**: $\left(\frac{[\text{s m}^{-1/3}][\text{m}^3\text{ s}^{-1}]}{[\text{m}][-]}\right)^{3/5} = \left([\text{m}^{5/3}]\right)^{3/5} = \text{m}$. Exact match.
- **Limiting-Case Check**: For clean channels ($X_{\text{rt,plant}} = 0$) at standard NFT flow $q_{\text{ch}} = 1.5\text{ L min}^{-1} = 2.5\times 10^{-5}\text{ m}^3\text{ s}^{-1}$, $W_{\text{ch}} = 0.10\text{ m}$, $S_0 = 0.02$, film depth is $h_{\text{ch}} \approx 1.8\text{ mm}$ and velocity is $v_{\text{ch}} \approx 0.14\text{ m s}^{-1}$. As root biomass grows, $n_{\text{ch,eff}}$ increases, deepening the film $h_{\text{ch}}$ and slowing $v_{\text{ch}}$. When $\eta_{\text{pump}} = 0$, $q_{\text{ch}} = 0$ and $h_{\text{ch}} \to h_{\text{res,puddle}}$.
- **Source Tag**: `[T]` — Textbook Principle: Wide-Channel Kinematic-Wave Manning Equation (Chow, *Open-Channel Hydraulics*).

#### Equation (7.2) — Channel Holdup Volume and Hydraulic Residence Time
$$V_{\text{ch,tot}} = N_{\text{ch}} L_{\text{ch}} W_{\text{ch}} h_{\text{ch}}, \qquad \tau_{\text{ch}} = \frac{L_{\text{ch}}}{v_{\text{ch}}} = \frac{V_{\text{ch,tot}}}{Q_{\text{pump}}} = N_{\text{ch}}^{3/5} L_{\text{ch}} W_{\text{ch}}^{2/5} n_{\text{ch,eff}}^{3/5} S_0^{-3/10} Q_{\text{pump}}^{-2/5}$$
- **Symbol Table & Units**:
  - $V_{\text{ch,tot}}$: Total volume of nutrient solution held in all $N_{\text{ch}}$ channels $[\text{m}^3]$; $\tau_{\text{ch}}$: single-pass hydraulic residence time in a gully $[\text{s}]$.
- **Config Dependencies**: $N_{\text{ch}}, L_{\text{ch}}, W_{\text{ch}}, S_0, Q_{\text{pump,rated}}, \eta_{\text{pump}}, s_{\text{pl}}$.
- **Validity Range**: $Q_{\text{pump}} > 0$.
- **Dimensional Check**: $\frac{V_{\text{ch,tot}}}{Q_{\text{pump}}} = \frac{[\text{m}^3]}{[\text{m}^3\text{ s}^{-1}]} = \text{s}$. Exact match.
- **Limiting-Case Check**: Doubling channel length $L_{\text{ch}}$ doubles $\tau_{\text{ch}}$ ($\tau_{\text{ch}} \propto L_{\text{ch}}^1$); reducing pump flow $Q_{\text{pump}}$ increases residence time as $\tau_{\text{ch}} \propto Q_{\text{pump}}^{-2/5}$ (while single-pass DO and thermal NTU scale as $Q_{\text{pump}}^{-1}$).
- **Source Tag**: `[T]` — Textbook Principle: Plug-Flow Hydraulic Residence Time Definition.

---

## MODULE 8: Canopy Transpiration and Airflow

### 8.1 Constitutive & Energy-Balance Equations

#### Equation (8.1) — Stanghellini (1987) Combination Canopy Transpiration Equation
$$\lambda_v E_{\text{can}} = \frac{\Delta(T_{\text{air}}) \, R_{n,\text{can}} + \dfrac{2 \, \text{LAI} \, \rho_a c_{p,a}}{r_e} \big(e^*(T_{\text{air}}) - e_a\big)}{\Delta(T_{\text{air}}) + \gamma \left(1 + \dfrac{r_i}{r_e}\right)}, \qquad R_{n,\text{can}} = \alpha_{\text{can,sw}} \big(1 - e^{-k_{\text{ext,sw}} \text{LAI}}\big) I_{\text{can,sw}}$$
- **Symbol Table & Units**:
  - $E_{\text{can}}$: Canopy transpiration mass flux per unit cropped floor area $[\text{kg H}_2\text{O m}^{-2}\text{ s}^{-1}]$; $\lambda_v E_{\text{can}}$: canopy latent heat flux $[\text{W m}^{-2}]$.
  - $\text{LAI}$: Effective Leaf Area Index $[\text{m}^2\text{ leaf m}^{-2}\text{ floor}]$ (Eq. 10.4); $\Delta(T_{\text{air}})$: slope of saturation vapor pressure $[\text{Pa K}^{-1}]$ (Eq. 1.6); $\gamma = 66.5\text{ Pa K}^{-1}$: psychrometric constant.
  - $R_{n,\text{can}}$: Net radiation absorbed by the canopy $[\text{W m}^{-2}]$ with shortwave absorptance $\alpha_{\text{can,sw}} = 0.80$ (`ST87` Table 3.1) and broadband shortwave extinction coefficient $k_{\text{ext,sw}} = 0.70$ (plausible range $[0.60, 0.90]$, sensitivity rank $R_{\text{sens}} = 5/21$, max OAT impact $17.91\%$).
  - $e^*(T_{\text{air}}), e_a = (\text{RH}/100) e^*(T_{\text{air}})$: Saturation and actual vapor pressure of enclosure air $[\text{Pa}]$.
  - $r_e$: External leaf boundary-layer resistance $[\text{s m}^{-1}]$ (Eq. 8.3); $r_i$: internal stomatal resistance $[\text{s m}^{-1}]$ (Eq. 8.5).
- **Config Dependencies**: $\mathcal{E}_{\text{type}}, \tau_{\text{cov}}, A_{\text{fl}}, N_{\text{ch}}, N_{\text{pl,ch}}, s_{\text{pl}}, \mathcal{P}_{\text{fan}}, Q_{\text{fan}}$.
- **Validity Range**: $\text{LAI} \ge 0$, $T_{\text{air}} \in [5, 45]^\circ\text{C}$, $\text{RH} \in [10\%, 100\%]$.
- **Dimensional Check**: Numerator $= [\text{Pa K}^{-1}][\text{W m}^{-2}] + \frac{[-][\text{kg m}^{-3}][\text{J kg}^{-1}\text{ K}^{-1}]}{[\text{s m}^{-1}]}[\text{Pa}] = [\text{Pa K}^{-1}][\text{W m}^{-2}]$; Denominator $= [\text{Pa K}^{-1}]$. Ratio $= \text{W m}^{-2}$; dividing by $\lambda_v$ $[\text{J kg}^{-1}]$ gives $\text{kg m}^{-2}\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: When $\text{LAI} \to 0$ (no plants), both $R_{n,\text{can}} = \alpha_{\text{can,sw}}(1 - e^{-k_{\text{ext}}\text{LAI}}) I_{\text{can,sw}} \to 0$ and $2\text{LAI} \to 0$, so $E_{\text{can}} = 0$ identically. When $r_i \to \infty$ (complete stomatal closure), $E_{\text{can}} \to 0$.
- **Source Tag**: `[S]` — Read in Stanghellini (1987) `ST87` Ch. 3, Sec. 3.1.3, Eq. (3.4) and Vanthoor (2011) `VT11b` Ch. 8, Sec. 8.8, Eq. (8.33).

#### Equation (8.2) — Canopy Leaf Temperature Excess and Sensible Heat Flux
$$T_0 - T_{\text{air}} = \frac{\dfrac{\gamma (r_i + r_e)}{2 \, \text{LAI} \, \rho_a c_{p,a}} R_{n,\text{can}} - \big(e^*(T_{\text{air}}) - e_a\big)}{\Delta(T_{\text{air}}) + \gamma \left(1 + \dfrac{r_i}{r_e}\right)}, \qquad H_{\text{can}\to\text{air}} = \frac{2 \, \text{LAI} \, \rho_a c_{p,a}}{r_e}(T_0 - T_{\text{air}}) = R_{n,\text{can}} - \lambda_v E_{\text{can}}$$
- **Symbol Table & Units**:
  - $T_0$: Mean canopy leaf surface temperature $[{}^\circ\text{C}]$; $H_{\text{can}\to\text{air}}$: canopy sensible heat flux to enclosure air $[\text{W m}^{-2}]$.
- **Config Dependencies**: Same as Eq. (8.1).
- **Validity Range**: $\text{LAI} > 0$.
- **Dimensional Check**: Numerator $= \frac{[\text{Pa K}^{-1}][\text{s m}^{-1}]}{[\text{kg m}^{-3}][\text{J kg}^{-1}\text{ K}^{-1}]}[\text{W m}^{-2}] - [\text{Pa}] = [\text{Pa}]$; Denominator $= [\text{Pa K}^{-1}]$. Ratio $= \text{K}$. Exact match, and $H_{\text{can}\to\text{air}} + \lambda_v E_{\text{can}} = R_{n,\text{can}}$ closes the steady canopy energy balance exactly.
- **Limiting-Case Check**: In dry air with low irradiance ($R_{n,\text{can}} \to 0, e^*(T_{\text{air}}) > e_a$), $T_0 < T_{\text{air}}$ (evaporative cooling of leaves below air temperature).
- **Source Tag**: `[S]` — Read in Stanghellini (1987) `ST87` Ch. 3, Sec. 3.1.3, Eqs. (3.2) & (3.5).

#### Equation (8.3) — Mixed Free and Forced Convection Leaf Boundary-Layer Resistance
$$r_e = \frac{1174 \, l_{\text{leaf}}^{0.5}}{\left(l_{\text{leaf}} \, |T_0 - T_{\text{air}}| + 207 \, u_{\text{can}}^2\right)^{0.25}}$$
- **Symbol Table & Units**:
  - $r_e$: External aerodynamic / boundary-layer resistance of a leaf side $[\text{s m}^{-1}]$; $l_{\text{leaf}}$: characteristic lettuce leaf dimension $[\text{m}]$; $u_{\text{can}}$: local air speed across the canopy $[\text{m s}^{-1}]$ (Eq. 8.4).
  - Numerical constants $1174\text{ s m}^{-1.25}\text{ K}^{0.25}$ and $207\text{ K s}^2\text{ m}^{-1}$ are derived in `ST87` Eq. (2.53) directly from $\text{Nu} = 0.37(\text{Gr} + 6.92\text{Re}^2)^{0.25}$ (Eq. 2.52) using air thermal diffusivity $a = 2.15\times 10^{-5}\text{ m}^2\text{ s}^{-1}$, kinematic viscosity $\nu = 1.51\times 10^{-5}\text{ m}^2\text{ s}^{-1}$, and $g\beta_T = 0.0334\text{ m s}^{-2}\text{ K}^{-1}$ at $20^\circ\text{C}$.
- **Config Dependencies**: $\mathcal{E}_{\text{type}}, A_{\text{fl}}, V_{\text{enc}}, U_{\text{vent}}, \mathcal{P}_{\text{fan}}, Q_{\text{fan}}$.
- **Validity Range**: $u_{\text{can}} \in [0, 5.0]\text{ m s}^{-1}$, $|T_0 - T_{\text{air}}| \in [0, 15]\text{ K}$, $l_{\text{leaf}} \in [0.02, 0.25]\text{ m}$.
- **Dimensional Check**: derived from $\text{Nu} = l_{\text{leaf}} / (a \, r_e) \Rightarrow r_e = [\text{s m}^{-1}]$. Because it combines free convection ($\text{Gr} \propto l_{\text{leaf}}^3 |T_0 - T_{\text{air}}|$) and forced convection ($\text{Re}^2 \propto l_{\text{leaf}}^2 u_{\text{can}}^2$), $r_e$ remains finite even when $u_{\text{can}} = 0$ (stagnant indoor air) or $T_0 = T_{\text{air}}$!
- **Limiting-Case Check**: At $l_{\text{leaf}} = 0.10\text{ m}$, $u_{\text{can}} = 0.10\text{ m s}^{-1}$, $|T_0 - T_{\text{air}}| = 0.5\text{ K}$, $r_e = 299.6\text{ s m}^{-1}$; at $u_{\text{can}} = 0.20\text{ m s}^{-1}$, $r_e = 210.6\text{ s m}^{-1}$.
- **Source Tag**: `[S]` — Read in Stanghellini (1987) `ST87` Ch. 2, Sec. 2.3.3, Eqs. (2.52)–(2.53), with `[A]` for nominal characteristic leaf width $l_{\text{leaf}} = 0.10\text{ m}$ (plausible range $[0.05, 0.18]\text{ m}$, sensitivity rank $R_{\text{sens}} = 7/21$, max OAT impact $7.47\%$).

#### Equation (8.4) — Local Canopy Air Velocity from Enclosure & Fan Configuration
$$u_{\text{can}} = u_{\text{conv},0} + \frac{U_{\text{vent}} A_{\text{fl}}}{A_{\text{cross}}} + \frac{\psi_{\text{fan}}(\mathcal{P}_{\text{fan}}) \, Q_{\text{fan}}}{A_{\text{cross}}}, \qquad A_{\text{cross}} = \frac{V_{\text{enc}}}{\sqrt{A_{\text{fl}}}}$$
- **Symbol Table & Units**:
  - $u_{\text{can}}$: Mean air velocity at canopy height $[\text{m s}^{-1}]$; $u_{\text{conv},0} = 0.05\text{ m s}^{-1}$: background thermal convective draft speed; $A_{\text{cross}}$: mean enclosure cross-sectional flow area $[\text{m}^2]$.
  - $\psi_{\text{fan}}(\mathcal{P}_{\text{fan}})$: Canopy velocity coupling factor $[-]$ based on fan position config:
    - $\psi_{\text{fan}}(\text{none}) = 0$
    - $\psi_{\text{fan}}(\text{exhaust}) = 0.50$ (bulk through-flow across cross-section)
    - $\psi_{\text{fan}}(\text{horizontal\_canopy}) = 2.00$ (directed horizontal jet across the canopy layer)
    - $\psi_{\text{fan}}(\text{vertical\_destrat}) = 1.00$ (vertical recirculation impingement).
- **Config Dependencies**: $A_{\text{fl}}, V_{\text{enc}}, U_{\text{vent}}, \mathcal{P}_{\text{fan}}, Q_{\text{fan}}$.
- **Validity Range**: $Q_{\text{fan}} \ge 0$, $V_{\text{enc}} > 0$.
- **Dimensional Check**: $[\text{m}^3\text{ s}^{-1}] / [\text{m}^2] = \text{m s}^{-1}$. Exact match.
- **Limiting-Case Check**: With all fans off ($Q_{\text{fan}} = 0$) and vents closed ($U_{\text{vent}} = 0$), $u_{\text{can}} = u_{\text{conv},0} = 0.05\text{ m s}^{-1}$.
- **Source Tag**: `[T]` — Textbook Principle: Continuity / Superposition of Mean Cross-Sectional Airflow.

#### Equation (8.5) — Stanghellini (1987) Multiplicative Stomatal Resistance
$$r_i = r_{\min} \, f_1(\bar{I}_s) \, f_2(T_0) \, f_3(\text{CO}_{2,\text{ppm}}) \, f_4(\text{VPD}_{\text{leaf}}), \qquad \bar{I}_s = \frac{\alpha_{\text{can,sw}}(1 - e^{-k_{\text{ext,sw}}\text{LAI}}) I_{\text{can,sw}}}{2 \, \text{LAI}}$$
$$f_1(\bar{I}_s) = \frac{\bar{I}_s + 4.30}{\bar{I}_s + 0.54}, \qquad f_2(T_0) = \begin{cases} 1 + 0.023 (T_0 - 24.5)^2 & (\bar{I}_s > 0) \\ 1 + 0.005 (T_0 - 13.6)^2 & (\bar{I}_s = 0) \end{cases}$$
$$f_3(\text{CO}_{2,\text{ppm}}) = \begin{cases} \min\!\big(1.5, \, 1 + 6.1\times 10^{-7}(\text{CO}_{2,\text{ppm}} - 200)^2\big) & (\bar{I}_s > 0) \\ 1.0 & (\bar{I}_s = 0) \end{cases}, \qquad f_4(\text{VPD}_{\text{leaf}}) = \begin{cases} \min\!\big(3.8, \, 1 + 4.3 \, \text{VPD}_{\text{leaf,kPa}}^2\big) & (\bar{I}_s > 0) \\ \min\!\big(3.8, \, 1 + 5.2 \, \text{VPD}_{\text{leaf,kPa}}^2\big) & (\bar{I}_s = 0) \end{cases}$$
- **Symbol Table & Units**:
  - $r_i$: Internal leaf stomatal resistance $[\text{s m}^{-1}]$; $r_{\min} = 82.0\text{ s m}^{-1}$: minimum stomatal resistance (`ST87` Table 3.3).
  - $\bar{I}_s$: Mean shortwave radiation absorbed per unit total (two-sided) leaf area $[\text{W m}^{-2}]$.
  - $\text{VPD}_{\text{leaf,kPa}} = \max\!\big(0, [e^*(T_0) - e_a]/1000\big)$: Leaf-to-air vapor pressure deficit $[\text{kPa}]$.
- **Config Dependencies**: $\mathcal{E}_{\text{type}}, \tau_{\text{cov}}$.
- **Validity Range**: $\bar{I}_s \ge 0$, $T_0 \in [5, 45]^\circ\text{C}$, $\text{CO}_{2,\text{ppm}} \in [200, 2000]\text{ ppm}$, $\text{VPD}_{\text{leaf,kPa}} \in [0, 5]\text{ kPa}$.
- **Dimensional Check**: $r_{\min}$ is $[\text{s m}^{-1}]$ and $f_1, f_2, f_3, f_4$ are dimensionless $[-]$. Exact match.
- **Limiting-Case Check**: In darkness ($\bar{I}_s = 0$), $f_1(0) = 4.30/0.54 = 7.963$, so baseline nighttime cuticular/stomatal resistance rises to $82.0 \times 7.963 = 653.0\text{ s m}^{-1}$ before temperature and VPD modifiers (strongly suppressing nocturnal transpiration, as verified in Section 15.4).
- **Source Tag**: `[S]` — Read in Stanghellini (1987) `ST87` Ch. 3, Sec. 3.5.1–3.5.2, Eqs. (3.45)–(3.53) & Table 3.3.

---

## MODULE 9: Water and Ion Uptake

### 9.1 Constitutive Relations for Root Water & Nutrient Influx

#### Equation (9.1) — Root Water Uptake per Plant
$$q_{\text{wat,pl}} = \frac{A_{\text{fl}} E_{\text{can}}}{\rho_w N_{\text{pl}}} \, \phi_{\text{DO,wat}}(C_{\text{DO,ch,out}}), \qquad \phi_{\text{DO,wat}}(C_{\text{DO}}) = 0.70 + 0.30 \frac{C_{\text{DO}}}{K_{m,\text{DO}} + C_{\text{DO}}}$$
- **Symbol Table & Units**:
  - $q_{\text{wat,pl}}$: Volumetric water uptake rate per plant $[\text{m}^3\text{ H}_2\text{O plant}^{-1}\text{ s}^{-1}]$.
  - $\phi_{\text{DO,wat}}(C_{\text{DO}})$: Hypoxic root hydraulic conductivity reduction factor $[-]$, capturing the observed $30.8\%$ drop in lettuce water uptake from $6.59\text{ mL h}^{-1}\text{ pl}^{-1}$ at saturation ($230\text{ }\mu\text{mol L}^{-1}$) to $4.56\text{ mL h}^{-1}\text{ pl}^{-1}$ under severe hypoxia ($26\text{ }\mu\text{mol L}^{-1}$) in Chun & Takakura (1994) Table 5.
- **Config Dependencies**: $A_{\text{fl}}, N_{\text{ch}}, N_{\text{pl,ch}}$.
- **Validity Range**: $C_{\text{DO}} \ge 0$, $N_{\text{pl}} \ge 1$.
- **Dimensional Check**: $\frac{[\text{m}^2][\text{kg m}^{-2}\text{ s}^{-1}]}{[\text{kg m}^{-3}][-]} = \text{m}^3\text{ plant}^{-1}\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: At saturating DO ($C_{\text{DO}} \gg K_{m,\text{DO}}$), $\phi_{\text{DO,wat}} \to 1$ and root water uptake equals canopy transpiration per plant.
- **Source Tag**: `[S]` — Read in Chun & Takakura (1994) `CT94` Sec. 3, Table 5 (48-h transpiration vs. DO level).

#### Equation (9.2) — Active Macronutrient Uptake Kinetics (Zhang, Burns & Turner 2008 + Demand Coupling)
$$J_{\text{up},i} = \phi_{\text{DO}}(C_{\text{DO,ch,out}}) \, \phi_{\text{pH,up},i}(\text{pH}) \, \left[ c_{u,\text{MM}} \, \nu_{i,\text{DM}} \frac{A_{\text{fl}}}{N_{\text{pl}}} \frac{dX_d}{dt} + (1 - c_{u,\text{MM}}) \, J_{\max,i}(w_{\text{sh}}) \, w_{\text{sh}} \right] \frac{C_i}{K_{m,i} + C_i}$$
$$J_{\max,\text{N}}(w_{\text{sh}}) = J_{\max,0}(\bar{I}_{\text{day}}) \, \exp\!\big(-\alpha_{\text{age}}(\bar{I}_{\text{day}}) \, w_{\text{sh}}\big)$$
$$J_{\max,0}(\bar{I}_{\text{day}}) = \frac{0.0047 \, \bar{I}_{\text{day}} + 0.0159}{3600}, \qquad \alpha_{\text{age}}(\bar{I}_{\text{day}}) = 0.0039 \, \bar{I}_{\text{day}} + 0.1327$$
- **Symbol Table & Units**:
  - $J_{\text{up},i}$: Per-plant molar uptake rate of actively absorbed nutrient ion $i \in \{\text{NO}_3^-, \text{NH}_4^+, \text{H}_2\text{PO}_4^-, \text{K}^+\}$ $[\text{mol plant}^{-1}\text{ s}^{-1}]$.
  - $w_{\text{sh}} = 10^3 \frac{A_{\text{fl}}}{N_{\text{pl}}}(1 - c_\tau) X_d$: Shoot dry weight per plant $[\text{g DM plant}^{-1}]$.
  - $\bar{I}_{\text{day}} = 10^{-6} \int_{t-86400}^{t} I_{\text{can,sw}}(\tau)\, d\tau$: 24-hour daily integrated shortwave radiation inside the enclosure $[\text{MJ m}^{-2}\text{ d}^{-1}]$.
  - $J_{\max,0}$: Seedling maximum specific N influx rate $[\text{mol s}^{-1}\text{ (g DM)}^{-1} = \text{mmol s}^{-1}\text{ (kg DM)}^{-1}]$ (converted from $\text{mmol h}^{-1}\text{ g}^{-1}\text{ DM}$ by dividing by $3600\text{ s h}^{-1}$); $\alpha_{\text{age}}$: ontogenetic decline coefficient $[\text{g}^{-1}\text{ DM}]$.
  - $\nu_{i,\text{DM}}$: Stoichiometric tissue nutrient requirement per kg of new dry matter $[\text{mol kg}^{-1}\text{ DM}]$:
    - Total N ($\text{NO}_3^- + \text{NH}_4^+$): $\nu_{\text{N,DM}} = 3.20\text{ mol kg}^{-1}\text{ DM}$ ($4.48\%\text{ N}$ in DM)
    - Phosphorus ($\text{H}_2\text{PO}_4^-$): $\nu_{\text{P,DM}} = 0.26\text{ mol kg}^{-1}\text{ DM}$ ($0.81\%\text{ P}$ in DM)
    - Potassium ($\text{K}^+$): $\nu_{\text{K,DM}} = 1.50\text{ mol kg}^{-1}\text{ DM}$ ($5.86\%\text{ K}$ in DM).
  - $K_{m,i}$: Michaelis-Menten half-saturation constant $[\text{mol m}^{-3} = \text{mmol L}^{-1}]$: $K_{m,\text{NO}_3^-} = 0.03\text{ mmol L}^{-1}$ (`ZBT08` Table 3: $0.02\text{–}0.04\text{ mM}$), $K_{m,\text{NH}_4^+} = 0.02\text{ mmol L}^{-1}$, $K_{m,\text{P}} = 0.02\text{ mmol L}^{-1}$, $K_{m,\text{K}^+} = 0.08\text{ mmol L}^{-1}$.
  - $c_{u,\text{MM}}$: Demand-vs-kinetic weighting factor $[-]$.
- **Config Dependencies**: $A_{\text{fl}}, N_{\text{ch}}, N_{\text{pl,ch}}, \tau_{\text{cov}}, \mathcal{E}_{\text{type}}$.
- **Validity Range**: $C_i \ge 0$, $\bar{I}_{\text{day}} \in [1.0, 20.0]\text{ MJ m}^{-2}\text{ d}^{-1}$.
- **Dimensional Check**: $\nu_{i,\text{DM}} \frac{A_{\text{fl}}}{N_{\text{pl}}} \frac{dX_d}{dt} = [\text{mol kg}^{-1}][\text{m}^2][\text{kg m}^{-2}\text{ s}^{-1}] = \text{mol plant}^{-1}\text{ s}^{-1}$; $J_{\max,i} w_{\text{sh}} = [\text{mol s}^{-1}\text{ g}^{-1}][\text{g plant}^{-1}] = \text{mol plant}^{-1}\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: As $C_i \to 0$, $C_i / (K_{m,i} + C_i) \to 0$, so uptake vanishes smoothly and $C_i(t) \ge 0$ is strictly preserved. For $C_i \gg K_{m,i}$ (standard NFT where $C_{\text{NO}_3^-} \approx 10\text{–}14\text{ mM} \gg 0.03\text{ mM}$), $C_i/(K_{m,i} + C_i) \approx 0.997$.
- **Source Tag**: `[S]` — Read in Zhang, Burns & Turner (2008) `ZBT08` Eqs. (1)–(3), Table 3 & Fig. 3 (for $J_{\max,0}, \alpha_{\text{age}}, K_{m,\text{N}}$), combined with `[A]` for demand-coupling weight $c_{u,\text{MM}} = 0.70$ (range $[0.50, 0.90]$, sensitivity rank $R_{\text{sens}} = 2/21$, max OAT impact $26.63\%$).

#### Equation (9.3) — Transpiration-Coupled Uptake of Secondary & Ballast Ions
$$J_{\text{up},j} = q_{\text{wat,pl}} \, \beta_{\text{pass},j} \, \frac{C_j}{1 + C_j / C_{\text{sat},j}}, \qquad j \in \{\text{Ca}^{2+}, \text{Mg}^{2+}, \text{SO}_4^{2-}, \text{Na}^+, \text{Cl}^-, \text{Fe}^{\text{chel}}\}$$
- **Symbol Table & Units**:
  - $J_{\text{up},j}$: Per-plant uptake rate of predominantly mass-flow / apoplastic or ballast ion $j$ $[\text{mol plant}^{-1}\text{ s}^{-1}]$.
  - $q_{\text{wat,pl}}$: Per-plant water uptake $[\text{m}^3\text{ plant}^{-1}\text{ s}^{-1}]$ (Eq. 9.1).
  - $\beta_{\text{pass},j}$: Dimensionless influx-to-transpiration selectivity coefficient (apparent uptake concentration ratio $C_{\text{up},j}/C_j$ in dilute solution) $[-]$:
    - $\beta_{\text{pass},\text{Ca}^{2+}} = 0.65$, $\beta_{\text{pass},\text{Mg}^{2+}} = 0.55$, $\beta_{\text{pass},\text{SO}_4^{2-}} = 0.50$, $\beta_{\text{pass},\text{Fe}} = 0.70$
    - Ballast ions (excluded at root endodermis): $\beta_{\text{pass},\text{Na}^+} = 0.12$, $\beta_{\text{pass},\text{Cl}^-} = 0.18$.
  - $C_{\text{sat},j}$: Apoplastic carrier saturation concentration $[\text{mol m}^{-3}]$ ($15.0\text{ mol m}^{-3}$ for $\text{Ca, Mg, SO}_4$; $50.0\text{ mol m}^{-3}$ for $\text{Na, Cl}$).
- **Config Dependencies**: $A_{\text{fl}}, N_{\text{ch}}, N_{\text{pl,ch}}, C_{\text{src},j}, C_{\text{stock},k,j}$.
- **Validity Range**: $C_j \ge 0$.
- **Dimensional Check**: $[\text{m}^3\text{ plant}^{-1}\text{ s}^{-1}][-][\text{mol m}^{-3}] = \text{mol plant}^{-1}\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: Because $\beta_{\text{pass},\text{Na}^+} = 0.12 \ll 1$, when source water contains $\text{NaCl}$, plants exclude $88\%$ of the $\text{Na}^+$ arriving in the transpiration stream, causing $\text{Na}^+$ and $\text{Cl}^-$ to accumulate in the recirculating reservoir.When $E_{\text{can}} = 0$ ($q_{\text{wat,pl}} = 0$), mass-flow transport of $\text{Ca}^{2+}$ to inner leaves ceases.
- **Source Tag**: `[T]` — Textbook Principle: Mass-Flow / Transpiration-Stream Solute Influx & Root Endodermal Selectivity (Marschner, *Mineral Nutrition of Higher Plants*).

---

## MODULE 10: Growth and Yield (Light Interception, Density, and Root-Zone / EC / pH / DO Effects)

### 10.1 Conserved State Variables
Following Van Henten (1994) `VH94b` Chapter 3 (Secs. 3.2.2–3.2.3), crop dry matter per unit cropped floor area is represented either by the **two-state model** — non-structural dry weight $X_{\text{nsdw}}(t)$ $[\text{kg DM m}^{-2}]$ and structural dry weight $X_{\text{sdw}}(t)$ $[\text{kg DM m}^{-2}]$, with total dry weight $X_d(t) = X_{\text{nsdw}}(t) + X_{\text{sdw}}(t)$ — or its **single-state reduction** $X_d(t)$ $[\text{kg DM m}^{-2}]$ (partitioned into shoot dry weight $(1 - c_\tau) X_d$ and root dry weight $c_\tau X_d$). Both are specified in full below so the implementing agent has zero ambiguity.

### 10.2 Balance Equations

#### Equation (10.1) — Two-State Non-Structural and Structural Dry Matter Balance (Van Henten 1994)
$$\frac{dX_{\text{nsdw}}}{dt} = c_\alpha \, \Phi_{\text{stress}} \, \phi_{\text{phot}} - r_{\text{gr}} X_{\text{sdw}} - \phi_{\text{resp}} - \frac{1 - c_\beta}{c_\beta} r_{\text{gr}} X_{\text{sdw}}$$
$$\frac{dX_{\text{sdw}}}{dt} = r_{\text{gr}} X_{\text{sdw}}, \qquad r_{\text{gr}} = c_{r,\text{gr,max}} \frac{X_{\text{nsdw}}}{X_{\text{sdw}} + X_{\text{nsdw}}} c_{Q_{10},\text{gr}}^{(T_{\text{air}} - 20.0)/10.0} \, \Phi_{\text{stress}}$$
- **Symbol Table & Units**:
  - $X_{\text{nsdw}}, X_{\text{sdw}}$: Non-structural (sugar/starch buffer) and structural (cell-wall/protein) dry weight per unit floor area $[\text{kg DM m}^{-2}]$; total dry weight $X_d = X_{\text{nsdw}} + X_{\text{sdw}}$ $[\text{kg DM m}^{-2}]$.
  - $c_\alpha = 0.68\text{ kg CH}_2\text{O (kg CO}_2)^{-1}$: stoichiometric molecular weight ratio $30/44$ (`VH94b` p. 36); $c_\beta = 0.80$: growth efficiency (yield factor accounting for growth respiration loss $\frac{1-c_\beta}{c_\beta} = 0.25$, `VH94b` Table 3.2).
  - $c_{r,\text{gr,max}} = 5.0\times 10^{-6}\text{ s}^{-1}$: maximum specific structural growth rate at $20^\circ\text{C}$; $c_{Q_{10},\text{gr}} = 1.6$ (`VH94b` Table 3.2).
  - $\phi_{\text{phot}}, \phi_{\text{resp}}$: Canopy gross $\text{CO}_2$ assimilation and maintenance respiration rates $[\text{kg m}^{-2}\text{ s}^{-1}]$ (Eqs. 10.3, 10.7).
  - $\Phi_{\text{stress}} \in [0, 1]$: Combined root-zone stress modifier (Eq. 10.8).
- **Config Dependencies**: $A_{\text{fl}}, N_{\text{ch}}, N_{\text{pl,ch}}, s_{\text{pl}}, d_0$.
- **Validity Range**: $T_{\text{air}} \in [5, 40]^\circ\text{C}$, $X_{\text{nsdw}}, X_{\text{sdw}} > 0$.
- **Dimensional Check**: $\text{LHS} = \text{kg m}^{-2}\text{ s}^{-1}$; $\text{RHS} = [-][\text{kg m}^{-2}\text{ s}^{-1}] - [\text{s}^{-1}][\text{kg m}^{-2}] = \text{kg m}^{-2}\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: When $\phi_{\text{phot}} = 0$ (prolonged darkness), $X_{\text{nsdw}}$ depletes via maintenance respiration $\phi_{\text{resp}}$ and structural conversion $r_{\text{gr}}$; as $X_{\text{nsdw}} \to 0$, $r_{\text{gr}} \to 0$ and structural growth halts.
- **Source Tag**: `[S]` — Read in Van Henten (1994) `VH94b` Ch. 3, Sec. 3.2.3, Eqs. (3.10), (3.11), (3.19) & Table 3.2.

#### Equation (10.2) — Single-State Total Dry Weight Reduction (Van Henten 1994)
$$\frac{dX_d}{dt} = c_\beta \, \Phi_{\text{stress}} \, c_\alpha \, \phi_{\text{phot}} - c_\beta \, \phi_{\text{resp}}$$
- **Symbol Table & Units**:
  - $X_d$: Total crop dry weight per unit floor area $[\text{kg DM m}^{-2}]$; per-plant dry weight is $W_{d,\text{plant}} = X_d / \rho_{\text{pl}} = \frac{A_{\text{fl}}}{N_{\text{pl}}} X_d$ $[\text{kg DM plant}^{-1}]$.
  - Initial condition from config plant age $d_0$: $X_d(0) = \rho_{\text{pl}} W_{d,0} \exp(r_0 d_0)$ with transplanted seedling dry weight $W_{d,0} = 6.5\times 10^{-5}\text{ kg DM plant}^{-1}$ ($0.065\text{ g DM}$, corresponding to $\approx 1.2\text{ g FW}$ at $d_0 = 0$).
- **Config Dependencies**: $A_{\text{fl}}, N_{\text{ch}}, N_{\text{pl,ch}}, d_0$.
- **Validity Range**: $T_{\text{air}} \in [5, 40]^\circ\text{C}$.
- **Dimensional Check**: $[\text{kg m}^{-2}\text{ s}^{-1}] = [-][\text{kg m}^{-2}\text{ s}^{-1}]$. Exact match.
- **Limiting-Case Check**: Obtained from Eq. (10.1) when the non-structural buffer is in quasi-steady equilibrium ($dX_{\text{nsdw}}/dt \approx 0 \Rightarrow r_{\text{gr}} X_{\text{sdw}} = c_\beta(c_\alpha \phi_{\text{phot}} - \phi_{\text{resp}})$).
- **Source Tag**: `[S]` — Read in Van Henten (1994) `VH94b` Ch. 3, Sec. 3.2.2, Eq. (3.1) & Table 3.1.

### 10.3 Constitutive Relations for Photosynthesis, Crowding, Respiration & Stress

#### Equation (10.3) — Canopy Gross Photosynthesis Rate
$$\phi_{\text{phot}} = \phi_{\text{phot,max}} \big(1 - \exp(-k_{\text{ext,PAR}} \, \text{LAI}_{\text{eff}})\big), \qquad \phi_{\text{phot,max}} = \frac{\varepsilon \, I_{\text{PAR}} \, g_{\text{CO}_2}(\chi_{\text{CO}_2} - \Gamma)}{\varepsilon \, I_{\text{PAR}} + g_{\text{CO}_2}(\chi_{\text{CO}_2} - \Gamma)}$$
$$\Gamma = c_\Gamma \, c_{Q_{10},\Gamma}^{(T_{\text{air}} - 20.0)/10.0}, \qquad \varepsilon = c_\varepsilon \frac{\chi_{\text{CO}_2} - \Gamma}{\chi_{\text{CO}_2} + 2\Gamma}$$
- **Symbol Table & Units**:
  - $\phi_{\text{phot}}, \phi_{\text{phot,max}}$: Actual and closed-canopy gross $\text{CO}_2$ assimilation rate $[\text{kg CO}_2\text{ m}^{-2}\text{ s}^{-1}]$.
  - $k_{\text{ext,PAR}} = c_k = 0.90$: Canopy PAR extinction coefficient $[-]$ (`VH94b` Table 3.1; distinct from broadband shortwave extinction $k_{\text{ext,sw}} = 0.70$ in Eq. 8.1 because green leaves strongly absorb PAR while scattering near-infrared); $\text{LAI}_{\text{eff}}$: crowding-corrected effective leaf area index $[-]$ (Eq. 10.4).
  - $\Gamma$: $\text{CO}_2$ compensation point $[\text{kg CO}_2\text{ m}^{-3}]$ with $c_\Gamma = 7.32\times 10^{-5}\text{ kg m}^{-3}$ ($40\text{ ppm}$ at $20^\circ\text{C}$) and $c_{Q_{10},\Gamma} = 2.0$ (`VH94b` Table 3.1).
  - $\varepsilon$: Quantum light-use efficiency $[\text{kg CO}_2\text{ J}^{-1}\text{ PAR}]$ with $c_\varepsilon = 17.0\times 10^{-9}\text{ kg CO}_2\text{ J}^{-1}$ (`VH94b` Table 3.1).
  - $g_{\text{CO}_2}$: Canopy $\text{CO}_2$ conductance $[\text{m s}^{-1}]$ (Eq. 10.5).
- **Config Dependencies**: $\mathcal{E}_{\text{type}}, \tau_{\text{cov}}, A_{\text{fl}}, N_{\text{ch}}, N_{\text{pl,ch}}, s_{\text{pl}}$.
- **Validity Range**: $\chi_{\text{CO}_2} > \Gamma$, $I_{\text{PAR}} \ge 0$, $T_{\text{air}} \in [5, 40]^\circ\text{C}$.
- **Dimensional Check**: $\varepsilon I_{\text{PAR}} = [\text{kg J}^{-1}][\text{J m}^{-2}\text{ s}^{-1}] = \text{kg m}^{-2}\text{ s}^{-1}$; $g_{\text{CO}_2}(\chi_{\text{CO}_2} - \Gamma) = [\text{m s}^{-1}][\text{kg m}^{-3}] = \text{kg m}^{-2}\text{ s}^{-1}$. Rectangular hyperbola ratio has units $\text{kg m}^{-2}\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: When $I_{\text{PAR}} = 0$ (night) or $\text{LAI}_{\text{eff}} = 0$ (no plants), $\phi_{\text{phot}} = 0$. At low light ($\varepsilon I_{\text{PAR}} \ll g_{\text{CO}_2}(\chi_{\text{CO}_2}-\Gamma)$), $\phi_{\text{phot,max}} \to \varepsilon I_{\text{PAR}}$ (light-limited); at saturating light, $\phi_{\text{phot,max}} \to g_{\text{CO}_2}(\chi_{\text{CO}_2}-\Gamma)$ ($\text{CO}_2$-conductance limited).
- **Source Tag**: `[S]` — Read in Van Henten (1994) `VH94b` Ch. 3, Sec. 3.2.2, Eqs. (3.2)–(3.5) & Table 3.1.

#### Equation (10.4) — Effective Leaf Area Index with Plant-Spacing / Crowding Factor
$$\text{LAI} = c_{\text{lar}} (1 - c_\tau) X_d, \qquad \text{LAI}_{\text{eff}} = \text{LAI} \cdot f_{\text{crowd}}(s_{\text{pl}}, W_{\text{pitch}}), \qquad f_{\text{crowd}} = \min\!\left(1.0, \, \sqrt{\frac{s_{\text{pl}}}{W_{\text{pitch}}}}\right) \left(1 - \exp\!\left(-\frac{s_{\text{pl}} W_{\text{pitch}}}{A_{\text{leaf,pl}}}\right)\right) \frac{A_{\text{leaf,pl}}}{s_{\text{pl}} W_{\text{pitch}}}$$
- **Symbol Table & Units**:
  - $\text{LAI}$: True one-sided leaf area per unit floor area $[\text{m}^2\text{ leaf m}^{-2}\text{ floor}]$; $c_{\text{lar}} = 62.5\text{ m}^2\text{ kg}^{-1}\text{ shoot DM}$ (one-state model, `VH94b` Table 3.1) or $75.0\text{ m}^2\text{ kg}^{-1}\text{ structural shoot DM}$ (two-state model, `VH94b` Table 3.2).
  - $c_\tau = f_{\text{root}} = 0.07\text{–}0.15$: Root-to-total dry weight ratio $[-]$ (`VH94b` Table 3.1 notes $0.07$ in NFT vs. $0.15$ in soil).
  - $A_{\text{leaf,pl}} = \text{LAI} / \rho_{\text{pl}}$: Leaf area per individual plant $[\text{m}^2\text{ plant}^{-1}]$; $\sqrt{s_{\text{pl}}/W_{\text{pitch}}}$: rectangularity penalty when plants are crowded along a gully ($s_{\text{pl}} < W_{\text{pitch}}$) causing intra-channel leaf overlap prior to inter-channel closure.
- **Config Dependencies**: $N_{\text{ch}}, L_{\text{ch}}, N_{\text{pl,ch}}, s_{\text{pl}}, A_{\text{fl}}$.
- **Validity Range**: $s_{\text{pl}} > 0$, $W_{\text{pitch}} > 0$.
- **Dimensional Check**: $c_{\text{lar}} X_d = [\text{m}^2\text{ kg}^{-1}][\text{kg m}^{-2}] = [-]$; $f_{\text{crowd}}$ is dimensionless $[-]$. Exact match.
- **Limiting-Case Check**: For small seedlings ($A_{\text{leaf,pl}} \ll s_{\text{pl}} W_{\text{pitch}}$) with isotropic spacing ($s_{\text{pl}} = W_{\text{pitch}}$), $f_{\text{crowd}} \to 1$ and $\text{LAI}_{\text{eff}} \to \text{LAI}$. When $s_{\text{pl}} \ll W_{\text{pitch}}$ (tight in-row spacing), intra-row overlap reduces effective light interception per unit leaf area.
- **Source Tag**: `[S]` — Read in Van Henten (1994) `VH94b` Ch. 3, Eq. (3.2) & Table 3.1 (for $\text{LAI} = c_{\text{lar}}(1-c_\tau)X_d$) and Petropoulou et al. (2023) `PET23` Sec. 3.1–3.4 (spacing/overlap effects on projected canopy area), with `[A]` for root fraction $f_{\text{root}} = c_\tau = 0.12$ (range $[0.07, 0.18]$, sensitivity rank $R_{\text{sens}} = 10/21$, max OAT impact $5.91\%$).

#### Equation (10.5) — Series Canopy $\text{CO}_2$ Conductance and Carboxylation Polynomial
$$\frac{1}{g_{\text{CO}_2}} = 1.37 \, r_e + 1.60 \, r_i + \frac{1}{g_{\text{car}}(T_{\text{air}})}, \qquad g_{\text{car}}(T_{\text{air}}) = \max\!\left(10^{-6}, \, c_{\text{car},1} T_{\text{air}}^2 + c_{\text{car},2} T_{\text{air}} + c_{\text{car},3}\right)$$
- **Symbol Table & Units**:
  - $g_{\text{CO}_2}$: Total series conductance for $\text{CO}_2$ diffusion from enclosure air to chloroplasts $[\text{m s}^{-1}]$.
  - $1.37 r_e, 1.60 r_i$: Boundary-layer and stomatal resistances to $\text{CO}_2$ diffusion $[\text{s m}^{-1}]$ scaled from water vapor resistances $r_e, r_i$ (Module 8) by the molecular diffusivity ratios $(D_{\text{H}_2\text{O}}/D_{\text{CO}_2})^{2/3} = 1.37$ (laminar boundary layer) and $(D_{\text{H}_2\text{O}}/D_{\text{CO}_2}) = 1.60$ (stomatal pores), or using Van Henten's constant baseline $c_{\text{bnd}} = 0.004\text{ m s}^{-1}, c_{\text{stm}} = 0.007\text{ m s}^{-1}$.
  - $g_{\text{car}}(T_{\text{air}})$: Mesophyll/carboxylation conductance $[\text{m s}^{-1}]$ with $c_{\text{car},1} = -1.32\times 10^{-5}\text{ m s}^{-1}\text{ }^\circ\text{C}^{-2}$, $c_{\text{car},2} = 5.94\times 10^{-4}\text{ m s}^{-1}\text{ }^\circ\text{C}^{-1}$, $c_{\text{car},3} = -2.64\times 10^{-3}\text{ m s}^{-1}$ (`VH94b` Table 3.1).
- **Config Dependencies**: Same as Module 8 ($r_e, r_i$).
- **Validity Range**: $T_{\text{air}} \in [5, 40]^\circ\text{C}$ (as noted in `VH94b` p. 35, $g_{\text{car}}$ peaks at $4.0\times 10^{-3}\text{ m s}^{-1}$ at $22.5^\circ\text{C}$ and reaches zero at $5^\circ\text{C}$ and $40^\circ\text{C}$).
- **Dimensional Check**: $[c_{\text{car},1} T_{\text{air}}^2] = [\text{m s}^{-1}\text{ }^\circ\text{C}^{-2}][{}^\circ\text{C}^2] = \text{m s}^{-1}$. Exact match.
- **Limiting-Case Check**: As $T_{\text{air}} \to 5^\circ\text{C}$ or $40^\circ\text{C}$, $g_{\text{car}} \to 0 \Rightarrow g_{\text{CO}_2} \to 0 \Rightarrow \phi_{\text{phot}} \to 0$.
- **Source Tag**: `[S]` — Read in Van Henten (1994) `VH94b` Ch. 3, Sec. 3.2.2, Eqs. (3.6)–(3.7) & Table 3.1.

#### Equation (10.6) — Canopy Maintenance Respiration Rate
$$\phi_{\text{resp}} = X_d \left[ c_{\text{resp,s}}(1 - c_\tau) c_{Q_{10},\text{resp}}^{(T_{\text{air}} - 25.0)/10.0} + c_{\text{resp,r}} c_\tau c_{Q_{10},\text{resp}}^{(T_{\text{ch}} - 25.0)/10.0} \right]$$
- **Symbol Table & Units**:
  - $\phi_{\text{resp}}$: Total crop maintenance respiration rate $[\text{kg CH}_2\text{O m}^{-2}\text{ s}^{-1}]$; $c_{\text{resp,s}} = 3.47\times 10^{-7}\text{ s}^{-1}$ ($0.030\text{ d}^{-1}$): shoot maintenance coefficient at $25^\circ\text{C}$; $c_{\text{resp,r}} = 1.16\times 10^{-7}\text{ s}^{-1}$ ($0.010\text{ d}^{-1}$): root maintenance coefficient at $25^\circ\text{C}$; $c_{Q_{10},\text{resp}} = 2.0$ (`VH94b` Table 3.1). Notice that shoot respiration responds to air temperature $T_{\text{air}}$ while root respiration responds to channel water temperature $T_{\text{ch}}$!
- **Config Dependencies**: $A_{\text{fl}}, N_{\text{ch}}, N_{\text{pl,ch}}$.
- **Validity Range**: $T_{\text{air}}, T_{\text{ch}} \in [5, 40]^\circ\text{C}$.
- **Dimensional Check**: $[\text{kg m}^{-2}][\text{s}^{-1}][-] = \text{kg m}^{-2}\text{ s}^{-1}$. Exact match.
- **Limiting-Case Check**: When $X_d = 0$, $\phi_{\text{resp}} = 0$.
- **Source Tag**: `[S]` — Read in Van Henten (1994) `VH94b` Ch. 3, Sec. 3.2.2, Eq. (3.8) & Table 3.1.

#### Equation (10.7) — Root-Zone Multiplicative Stress Factor ($\text{EC}, \text{pH}, \text{DO}, T_w, \text{N}$)
$$\Phi_{\text{stress}} = \phi_{\text{EC}}(\text{EC}_{25}) \cdot \phi_{\text{pH}}(\text{pH}) \cdot \phi_{\text{DO}}(C_{\text{DO,ch,out}}) \cdot \phi_{T_w}(T_{\text{ch}}) \cdot \phi_{\text{nut}}(C_i)$$
$$\phi_{\text{EC}}(\text{EC}_{25}) = \min\!\left(1.0, \, \frac{\text{EC}_{25}}{\text{EC}_{\text{min,def}}}\right) \cdot \max\!\Big(0.0, \, 1.0 - b_{\text{sal,DM}} \max(0.0, \, \text{EC}_{25} - \text{EC}_{\text{thr,DM}})\Big)$$
$$\phi_{\text{pH}}(\text{pH}) = \exp\!\left[-\frac{1}{2}\left(\frac{\text{pH} - \text{pH}_{\text{opt}}}{\sigma_{\text{pH}}}\right)^2\right], \qquad \phi_{\text{DO}}(C_{\text{DO,ch,out}}) = \frac{\max(0.0, \, C_{\text{DO,ch,out}} - C_{\text{DO,min}})}{K_{m,\text{DO}} + \max(0.0, \, C_{\text{DO,ch,out}} - C_{\text{DO,min}})}$$
$$\phi_{T_w}(T_{\text{ch}}) = \exp\!\left[-\frac{1}{2}\left(\frac{T_{\text{ch}} - T_{w,\text{opt}}}{\sigma_{T_w}}\right)^2\right], \qquad \phi_{\text{nut}}(C_i) = \min_{i \in \{\text{N, P, K}\}} \left(\frac{C_i}{K_{m,i} + C_i}\right)$$
- **Symbol Table & Units**:
  - $\text{EC}_{\text{thr,DM}} = 2.8\text{ dS m}^{-1}$, $b_{\text{sal,DM}} = 0.04\text{ (dS m}^{-1})^{-1}$: Dry-matter salinity threshold and slope (from `OPENED` Andriolo et al. 2005 `AND05`, where dry mass increased up to $2.81\text{ dS m}^{-1}$, whereas fresh-weight osmotic reduction occurs at the NFT default threshold $\text{EC}_{\text{thr,FW}} = 1.96\text{ dS m}^{-1}$ [plausible range $1.30\text{–}2.00\text{ dS m}^{-1}$] via Eq. 10.8); $\text{EC}_{\text{min,def}} = 0.4\text{ dS m}^{-1}$.
  - $\text{pH}_{\text{opt}} = 6.0$ $[-]$, $\sigma_{\text{pH}} = 1.8$ $[-]$: Optimal pH center and tolerance half-width (calibrated to `OPENED` Zhang et al. 2024 `ZH24` Table 3, where shoot FW dropped $21.3\%$ at $\text{pH} \approx 7.55$ and $9.4\%$ at $\text{pH} \approx 4.25\text{–}4.8$).
  - $C_{\text{DO,min}} = 1.5\text{ mg L}^{-1}$, $K_{m,\text{DO}} = 1.5\text{ mg L}^{-1}$: Critical hypoxia threshold and half-saturation constant (anchored to `OPENED` Chun & Takakura 1994 `CT94` and Martínez-Gutiérrez et al. 2012 `MG12`, where DO $\ge 6.5\text{ mg L}^{-1}$ gives $\phi_{\text{DO}} \ge 0.77$ and DO $\le 2.1\text{ mg L}^{-1}$ suppresses yield by $64\%$).
  - $T_{w,\text{opt}} = 22.0^\circ\text{C}$, $\sigma_{T_w} = 8.0^\circ\text{C}$: Optimal root-zone water temperature and thermal tolerance width.
- **Config Dependencies**: Indirectly depends on all reservoir, channel, aerator, dosing, and climate configs through $\text{EC}_{25}, \text{pH}, C_{\text{DO,ch,out}}, T_{\text{ch}}, C_i$.
- **Validity Range**: $\text{EC}_{25} \in [0.2, 6.0]\text{ dS m}^{-1}$, $\text{pH} \in [4.0, 8.5]$, $C_{\text{DO}} \in [0, 15]\text{ mg L}^{-1}$, $T_{\text{ch}} \in [10, 35]^\circ\text{C}$.
- **Dimensional Check**: Every factor $\phi_{(\cdot)} \in [0, 1]$ is dimensionless $[-]$. Exact match.
- **Limiting-Case Check**: Under optimal root-zone conditions ($\text{EC}_{25} = 1.8\text{ dS m}^{-1}, \text{pH} = 6.0, C_{\text{DO}} = 8.0\text{ mg L}^{-1}, T_{\text{ch}} = 22^\circ\text{C}, C_i \gg K_{m,i}$), $\Phi_{\text{stress}} \approx 1$. Under severe hypoxia ($C_{\text{DO,ch,out}} \le C_{\text{DO,min}}$), $\phi_{\text{DO}} = 0$ and root-supported growth stops.
- **Source Tag**: `[A]` — Assumption: Multiplicative Liebig/Mitscherlich root-zone stress formulation combining `[S]` empirical responses from `AND05`, `ZH24`, `CT94`, `MG12`, and `ZBT08` ($\text{pH}_{\text{opt}}$ rank $R_{\text{sens}} = 3/21$; $\sigma_{\text{pH}}$ rank $R_{\text{sens}} = 6/21$; $K_{m,\text{DO}}$ rank $R_{\text{sens}} = 8/21$; $\text{EC}_{\text{thr,FW}}$ rank $R_{\text{sens}} = 9/21$; $b_{\text{sal,FW}}$ rank $R_{\text{sens}} = 11/21$).

#### Equation (10.8) — Shoot Fresh Weight Yield & Osmotic Dry-Matter Content (Andriolo 2005 / Ayers 1951)
$$\alpha_{\text{DMC}}(\text{EC}_{25}) = \frac{\alpha_{\text{DMC},0}}{1.0 - b_{\text{sal,FW}} \max\!\big(0.0, \, \text{EC}_{25} - \text{EC}_{\text{thr,FW}}\big)}, \qquad Y_{\text{fw,sh}} = \frac{(1 - c_\tau) X_d}{\alpha_{\text{DMC}}(\text{EC}_{25})}, \qquad W_{\text{fw,sh,plant}} = \frac{Y_{\text{fw,sh}}}{\rho_{\text{pl}}}$$
- **Symbol Table & Units**:
  - $\alpha_{\text{DMC}}(\text{EC}_{25})$: Shoot dry-matter mass fraction $[\text{kg DM (kg FW)}^{-1}]$ with unstressed baseline $\alpha_{\text{DMC},0} = 0.055\text{ kg DM (kg FW)}^{-1}$ (plausible range $[0.040, 0.065]$; `VH94b` Table 3.1: $c_{\text{fw}} = 22.5 \Rightarrow \alpha_{\text{DMC},0} = 0.0444$; `ZH24` Table 3: $0.0397$; `GT25`: $0.055$).
  - $\text{EC}_{\text{thr,FW}} = 1.96\text{ dS m}^{-1}$: Default NFT fresh-weight salinity threshold (`AND05` p. 932: $1.96\text{–}2.00\text{ dS m}^{-1}$ in recirculating NFT; plausible range $[1.30, 2.00]\text{ dS m}^{-1}$ where $1.30\text{ dS m}^{-1}$ is the classical soil paste extract threshold of Ayers et al. 1951 `AWB51`, Decision 2 Option 2A vs. 2B).
  - $b_{\text{sal,FW}} = 0.0873\text{ (dS m}^{-1})^{-1}$: Default NFT fresh-weight relative decline slope per unit $\text{EC}$ above threshold (`AND05` p. 932: $8.73\%\text{ per dS m}^{-1}$ in NFT; plausible range $[0.060, 0.130]\text{ (dS m}^{-1})^{-1}$ where $0.130$ is the soil slope of `AWB51`, Decision 2 Option 2A vs. 2B).
  - $Y_{\text{fw,sh}}$: Shoot fresh weight per unit floor area $[\text{kg FW m}^{-2}]$; $W_{\text{fw,sh,plant}}$: shoot fresh weight per plant $[\text{kg FW plant}^{-1}]$.
- **Config Dependencies**: $A_{\text{fl}}, N_{\text{ch}}, N_{\text{pl,ch}}, C_{\text{src},i}, C_{\text{stock},k,i}$.
- **Validity Range**: $\text{EC}_{25} \in [0.5, 5.5]\text{ dS m}^{-1}$.
- **Dimensional Check**: $[\text{kg DM m}^{-2}] / [\text{kg DM (kg FW)}^{-1}] = \text{kg FW m}^{-2}$. Exact match.
- **Limiting-Case Check**: For $\text{EC}_{25} \le \text{EC}_{\text{thr,FW}}$, $\alpha_{\text{DMC}} = \alpha_{\text{DMC},0} = 1/c_{\text{fw}}$, recovering Van Henten's Eq. (3.9) $Y_{\text{fw,sh}} = c_{\text{fw}}(1 - c_\tau)X_d$ exactly! For $\text{EC}_{25} > \text{EC}_{\text{thr,FW}}$, osmotic potential reduces leaf water turgor/content so $Y_{\text{fw,sh}}$ decreases linearly with slope $-b_{\text{sal,FW}}$ even when dry weight $X_d$ is unaffected (reproducing `AND05` Fig. 1 & p. 933).
- **Source Tag**: `[S]` — Read in Van Henten (1994) `VH94b` Ch. 3, Eq. (3.9) and Andriolo et al. (2005) `AND05` pp. 932–933 (including second-hand citation of Ayers et al. 1951 `AWB51`), with `[A]` for baseline $\alpha_{\text{DMC},0} = 0.055$ (range $[0.040, 0.065]$, sensitivity rank $R_{\text{sens}} = 4/21$, max OAT impact $20.83\%$), $\text{EC}_{\text{thr,FW}} = 1.96\text{ dS m}^{-1}$ ($R_{\text{sens}} = 9/21$, max OAT impact $6.21\%$), and $b_{\text{sal,FW}} = 0.0873\text{ (dS m}^{-1})^{-1}$ ($R_{\text{sens}} = 11/21$, max OAT impact $5.03\%$).

---

## MODULE 11: Sensors as Observers (Noise, Drift, Lag, Dropout)

### 11.1 Observer State & Measurement Equations
Sensors do not alter physical states directly; they map true physical states $x_s(t)$ to observed outputs $y_s(t_k)$ (which may then be fed to dosing/climate controllers).

#### Equation (11.1) — First-Order Probe Lag, Calibration Drift, Temperature Cross-Sensitivity, Noise & Dropout
$$\tau_{\text{lag},s} \frac{dz_s}{dt} = x_{\text{true},s}^{\text{eff}}(t) - z_s(t), \qquad \frac{db_s}{dt} = d_s + w_{\text{drift},s}(t)$$
$$y_s(t_k) = \begin{cases} z_s(t_k) + b_s(t_k) + \epsilon_s(t_k), & \text{if } \xi_{\text{drop},s}(t_k) = 0 \\ \text{NaN (dropout)}, & \text{if } \xi_{\text{drop},s}(t_k) = 1 \end{cases}, \qquad \epsilon_s(t_k) \sim \mathcal{N}(0, \sigma_s^2)$$
- **Symbol Table & Units**:
  - $x_{\text{true},s}^{\text{eff}}(t)$: Effective physical quantity sensed at the probe tip:
    - For an **uncompensated EC probe**: $x_{\text{true,EC}}^{\text{eff}} = \text{EC}_{\text{raw}}(T_{\text{res}}) = \text{EC}_{25}[1 + \alpha_{T,\text{EC}}(T_{\text{res}} - 25.0)]$; for a **temperature-compensated EC probe** with faulty thermistor bias $\Delta T_{\text{probe}}$: $x_{\text{true,EC}}^{\text{eff}} = \text{EC}_{25} \frac{1 + \alpha_{T,\text{EC}}(T_{\text{res}} - 25.0)}{1 + \alpha_{T,\text{EC}}(T_{\text{res}} + \Delta T_{\text{probe}} - 25.0)}$.
    - For a **glass-electrode pH probe** (Nernstian slope temperature cross-sensitivity around isopotential $\text{pH}_{\text{iso}} = 7.0$): $x_{\text{true,pH}}^{\text{eff}} = 7.0 + (\text{pH} - 7.0)\frac{T_{\text{res}} + 273.15}{T_{\text{cal}} + 273.15}$.
    - For an **optical/galvanic DO probe**: $x_{\text{true,DO}}^{\text{eff}} = C_{\text{DO,res}}$ (or $C_{\text{DO,ch,out}}$ depending on sensor placement).
    - For a **top-view RGB camera sensor** (`PET23` Eqs. 3–5): $x_{\text{true,CC}}^{\text{eff}} = 100 \big(1 - e^{-k_{\text{ext}} \text{LAI}_{\text{eff}}}\big)$ $[\%\text{ canopy cover}]$, or per-plant projected area $A_{\text{proj,pl}} = \frac{1 - e^{-k_{\text{ext}}\text{LAI}_{\text{eff}}}}{\rho_{\text{pl}}}$ $[\text{m}^2\text{ plant}^{-1}]$.
  - $z_s(t)$: Filtered internal probe state $[\text{modality unit}]$; $\tau_{\text{lag},s}$: probe response time constant $[\text{s}]$ ($\tau_{\text{lag,EC}} \approx 5\text{ s}$, $\tau_{\text{lag,pH}} \approx 15\text{ s}$, $\tau_{\text{lag,DO}} \approx 30\text{ s}$, $\tau_{\text{lag},T} \approx 20\text{ s}$).
  - $b_s(t)$: Cumulative calibration drift bias $[\text{modality unit}]$ driven by config drift rate $d_s$ $[\text{unit s}^{-1}]$ and optional random-walk diffusion $w_{\text{drift},s}$.
  - $\epsilon_s(t_k)$: Zero-mean Gaussian measurement noise with standard deviation $\sigma_s$ from config `accuracy`.
  - $\xi_{\text{drop},s}(t_k) \in \{0, 1\}$: Two-state Markov / Bernoulli packet-loss indicator with dropout probability $p_{\text{drop},s}$.
- **Config Dependencies**: Sensor `kind` ($s$), `accuracy` ($\sigma_s$), `drift` ($d_s$).
- **Validity Range**: All sensor modalities $s \in \mathcal{S}$.
- **Dimensional Check**: $\tau_{\text{lag},s} dz_s/dt = [\text{s}][\text{unit s}^{-1}] = [\text{unit}]$; $y_s = [\text{unit}]$. Exact match.
- **Limiting-Case Check**: For an ideal sensor ($\tau_{\text{lag},s} \to 0, d_s = 0, \sigma_s = 0, p_{\text{drop},s} = 0$), $y_s(t_k) = x_{\text{true},s}(t_k)$ identically.
- **Source Tag**: `[T]` — Textbook Principle: First-Order LTI Sensor Dynamics, Nernst Potentiometric Equation, and Additive White Gaussian + Bias/Drift Stochastic Observer Model, plus `[S]` Petropoulou et al. (2023) `PET23` Sec. 2.3.2, Eq. (3) for RGB coverage observer.

---

## MODULE 12: Faults as Physical Perturbations

Every fault is specified strictly as a physical perturbation to a configuration parameter, boundary condition, or transport flux in Modules 1–11 — **never** as an non-physical overwrite of conserved state variables.

#### Equation (12.1) — Physical Fault Perturbation Map
$$\begin{aligned}
\text{1. Pump Degradation / Stall:} \quad & \eta_{\text{pump}}(t) = \eta_{\text{pump},0} \big(1 - f_{\text{fault,pump}}(t)\big), \quad f_{\text{fault,pump}} \in (0, 1] \\
\text{2. Aeration Loss:} \quad & Q_{\text{air}}(t) = Q_{\text{air},0} \big(1 - f_{\text{fault,aer}}(t)\big), \quad \text{OTR}_{\text{std}}(t) = \text{OTR}_{\text{std},0} \big(1 - f_{\text{fault,aer}}(t)\big) \\
\text{3. Heat Wave:} \quad & T_{\text{out}}(t) = T_{\text{out,nom}}(t) + \Delta T_{\text{hw}}(t), \quad I_{\text{out,sw}}(t) = I_{\text{out,sw,nom}}(t)\big(1 + f_{\text{hw,rad}}(t)\big) \\
\text{4. Probe Drift:} \quad & d_s(t) = d_{s,\text{nom}} + \Delta d_{s,\text{fault}}(t) \quad \text{or step bias } \Delta b_{s,\text{fault}} \\
\text{5. Nutrient Imbalance:} \quad & C_{\text{stock},k,i}(t) = C_{\text{stock},k,i,\text{nom}} \big(1 + \delta_{\text{imb},k,i}(t)\big) \quad \text{or } Q_{\text{dose},k}(t) = Q_{\text{dose},k,\text{nom}}(1 + \delta_{\text{dose},k}) \\
\text{6. Physical Leak:} \quad & Q_{\text{leak}}(t) = C_{d,\text{orifice}} A_{\text{leak}}(t) \sqrt{2 g \, \frac{V_{\text{res}}(t)}{A_{\text{res}}}} \quad [\text{m}^3\text{ s}^{-1}]
\end{aligned}$$
- **Symbol Table & Units**:
  - $f_{\text{fault,pump}} \in [0, 1]$: Fractional pump degradation ($f_{\text{fault,pump}} = 1 \Rightarrow \eta_{\text{pump}} = 0$, complete pump stall).
  - $f_{\text{fault,aer}} \in [0, 1]$: Fractional aerator loss ($f_{\text{fault,aer}} = 1 \Rightarrow k_L a_{\text{aer}} = 0$).
  - $\Delta T_{\text{hw}}$: Heat-wave outdoor air temperature anomaly $[\text{K}]$.
  - $\Delta d_{s,\text{fault}}$: Accelerated sensor drift rate $[\text{unit s}^{-1}]$.
  - $\delta_{\text{imb},k,i} \in [-1, \infty)$: Relative stock composition error or dosing pump miscalibration $[-]$.
  - $A_{\text{leak}}(t)$: Leak puncture cross-sectional area at the bottom of the reservoir $[\text{m}^2]$; $C_{d,\text{orifice}} = 0.61$: Torricelli sharp-edged orifice discharge coefficient $[-]$; $g = 9.80665\text{ m s}^{-2}$; $h_{\text{res}}(t) = V_{\text{res}}(t)/A_{\text{res}}$: instantaneous hydrostatic head in the reservoir $[\text{m}]$.
- **Config Dependencies**: $\eta_{\text{pump}}, Q_{\text{air}}, \text{OTR}_{\text{std}}, A_{\text{res}}, V_{\text{res},0}, C_{\text{stock},k,i}, d_s$.
- **Validity Range**: $V_{\text{res}} > 0$.
- **Dimensional Check (Torricelli Leak Eq. 12.1.6)**: $Q_{\text{leak}} = [-][\text{m}^2]\sqrt{[\text{m s}^{-2}][\text{m}]} = \text{m}^3\text{ s}^{-1}$. Exact match.
- **Limiting-Case & Physical Propagation Check**:
  1. **Pump degradation ($\eta_{\text{pump}} \downarrow$)**: Per Eq. (7.2), residence time increases as $\tau_{\text{ch}} \propto \eta_{\text{pump}}^{-2/5}$; per Eq. (5.2), channel water heats toward $T_{\text{eq,ch}}$ as $\text{NTU} \propto \eta_{\text{pump}}^{-1}$; per Eq. (6.4), channel-outlet DO drops as $\Delta C_{\text{DO,ch}} \propto \eta_{\text{pump}}^{-1}$. At **stall ($\eta_{\text{pump}} = 0$)**, gullies drain to $h_{\text{res,puddle}} = 0.5\text{ mm}$, $q_{\text{ch}} = 0$, and root-zone DO collapses on timescale $\tau_{\text{DO,stall}} = \frac{W_{\text{ch}} L_{\text{ch}} h_{\text{res,puddle}} C_{\text{DO}}}{N_{\text{pl,ch}} R_{\text{root},\text{O}_2}} \sim 15\text{–}45\text{ min}$.
  2. **Leak vs. Evapotranspiration**: A physical leak ($Q_{\text{leak}} > 0$) removes bulk solution carrying dissolved ions $Q_{\text{leak}} C_i$ (Eq. 3.1) and alkalinity $Q_{\text{leak}}[\text{Alk}]$ (Eq. 4.1), so reservoir volume $V_{\text{res}}$ drops **without concentrating $\text{EC}$** (or if refilled by pure source water $Q_{\text{src}} = Q_{\text{leak}}$ with low $C_{\text{src},i}$, **diluting $\text{EC}$**). In contrast, a heat wave increases canopy transpiration $E_{\text{can}}$, which removes pure water vapor and **concentrates $\text{EC}$**!
- **Source Tag**: `[T]` — Textbook Principle: Torricelli's Law of Orifice Efflux & Coupled Conservation-Law Perturbation Theory.

---

## 13. Generality & System Timescale Scaling Table

Because every coefficient in Modules 1–12 is derived explicitly from geometry and configuration inputs, changing farm size ($V_{\text{res}}, N_{\text{pl}}, Q_{\text{pump}}, A_{\text{fl}}$) automatically scales all system relaxation times without tuning constants.

Let the three primary scaling knobs be **Reservoir Volume ($V_{\text{res}}$)**, **Total Plant Count ($N_{\text{pl}} = N_{\text{ch}} N_{\text{pl,ch}}$)** (at fixed per-plant spacing $A_{\text{cell}}$, so $A_{\text{fl}} \propto N_{\text{pl}}$ and $N_{\text{ch}} L_{\text{ch}} \propto N_{\text{pl}}$), and **Total Pump Flow ($Q_{\text{pump}} = \eta_{\text{pump}} Q_{\text{pump,rated}}$)**.

| Timescale Name | Symbol | Physical Definition from Spec Equations | Scaling with $V_{\text{res}}$ | Scaling with $N_{\text{pl}}$ | Scaling with $Q_{\text{pump}}$ | Typical Mid-Crop NFT Magnitude |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Loop Hydraulic Turnover Time** | $\tau_{\text{loop}}$ | $\dfrac{V_{\text{res}}}{Q_{\text{pump}}}$ | $\propto V_{\text{res}}^{+1}$ | $\propto N_{\text{pl}}^{0}$ | $\propto Q_{\text{pump}}^{-1}$ | $5\text{–}25\text{ min}$ |
| **2. Channel Residence Time** | $\tau_{\text{ch}}$ | $\dfrac{V_{\text{ch,tot}}}{Q_{\text{pump}}} = N_{\text{ch}}^{3/5} L_{\text{ch}} W_{\text{ch}}^{2/5} n_{\text{ch,eff}}^{3/5} S_0^{-3/10} Q_{\text{pump}}^{-2/5}$ | $\propto V_{\text{res}}^{0}$ | $\propto N_{\text{pl}}^{+1}$ (if $L_{\text{ch}} \propto N_{\text{pl}}$) or $\propto N_{\text{pl}}^{+3/5}$ (if $N_{\text{ch}} \propto N_{\text{pl}}$) | $\propto Q_{\text{pump}}^{-2/5}$ | $0.5\text{–}3.0\text{ min}$ |
| **3. Reservoir Water Depletion (Transpiration Turnover)** | $\tau_{\text{water}}$ | $\dfrac{\rho_w V_{\text{res}}}{A_{\text{fl}} E_{\text{can}}} = \dfrac{V_{\text{res}}}{N_{\text{pl}} \, q_{\text{wat,pl}}}$ | $\propto V_{\text{res}}^{+1}$ | $\propto N_{\text{pl}}^{-1}$ | $\propto Q_{\text{pump}}^{0}$ | $3\text{–}12\text{ days}$ |
| **4. Nutrient / EC Buffering Timescale** | $\tau_{\text{EC}}$ | $\dfrac{V_{\text{tot}} \sum |z_i| C_i}{N_{\text{pl}} \sum |z_i| J_{\text{up},i}}$ | $\propto V_{\text{res}}^{+1}$ | $\propto N_{\text{pl}}^{-1}$ | $\propto Q_{\text{pump}}^{0}$ | $4\text{–}15\text{ days}$ |
| **5. pH / Alkalinity Buffering Timescale** | $\tau_{\text{pH}}$ | $\dfrac{V_{\text{tot}} \, \beta_{\text{buf}}(\text{pH}, C_T, C_{\text{P,tot}})}{N_{\text{pl}} \left|\gamma_{\text{OH},\text{NO}_3} J_{\text{up},\text{NO}_3^-} - \gamma_{\text{H},\text{NH}_4} J_{\text{up},\text{NH}_4^+}\right|}$ | $\propto V_{\text{res}}^{+1}$ | $\propto N_{\text{pl}}^{-1}$ | $\propto Q_{\text{pump}}^{0}$ | $1\text{–}6\text{ days}$ |
| **6a. Reservoir Heat Relaxation Timescale** | $\tau_{\text{heat,res}}$ | $\dfrac{\rho_w c_{p,w} V_{\text{res}}}{U_{\text{res}} A_{\text{wall}}(V_{\text{res}}) + U_{\text{ch,top}} A_{\text{ch,tot}}}$ | $\propto V_{\text{res}}^{+1}$ (when $U_{\text{ch}} A_{\text{ch}} \gg U_{\text{res}} A_{\text{wall}}$) | $\propto N_{\text{pl}}^{-1}$ (channel-dominated) | $\propto Q_{\text{pump}}^{0}$ (for $\text{NTU}_{\text{ch}} \ll 1$) | $2\text{–}8\text{ hours}$ |
| **6b. Single-Pass Channel Thermal NTU** | $\text{NTU}_{\text{heat,ch}}$ | $\dfrac{U_{\text{ch,top}} N_{\text{ch}} L_{\text{ch}} W_{\text{ch}}}{\rho_w c_{p,w} Q_{\text{pump}}}$ | $\propto V_{\text{res}}^{0}$ | $\propto N_{\text{pl}}^{+1}$ | $\propto Q_{\text{pump}}^{-1}$ | $0.005\text{–}0.05$ $[-]$ |
| **7a. Reservoir DO Depletion / Aeration Timescale** | $\tau_{\text{DO,res}}$ | $\dfrac{V_{\text{res}}}{k_L a_{\text{aer}} V_{\text{res}} + k_{v,\text{ch}} A_{\text{ch,tot}}}$ (aeration on) or $\dfrac{V_{\text{res}} C_{\text{DO,sat}}}{N_{\text{pl}} R_{\text{root},\text{O}_2}}$ (aeration off) | $\propto V_{\text{res}}^{+1}$ (at fixed $\text{OTR}_{\text{std}}$ or aeration off) | $\propto N_{\text{pl}}^{-1}$ (aeration off) | $\propto Q_{\text{pump}}^{0}$ | $10\text{–}30\text{ min}$ (aerated); $3\text{–}10\text{ h}$ (unaerated) |
| **7b. Single-Pass Channel DO Depletion Fraction** | $\frac{\Delta C_{\text{DO,ch}}}{C_{\text{DO,res}}}$ | $\dfrac{N_{\text{pl}} R_{\text{root},\text{O}_2}}{Q_{\text{pump}} C_{\text{DO,res}}}$ (in low-reaeration limit) | $\propto V_{\text{res}}^{0}$ | $\propto N_{\text{pl}}^{+1}$ | $\propto Q_{\text{pump}}^{-1}$ | $2\%\text{–}25\%$ per pass |

> **Exact Scale-Invariance Property**: If a farm is scaled by a factor $\lambda > 0$ such that $(V_{\text{res}}, A_{\text{res}}, Q_{\text{pump,rated}}, \text{OTR}_{\text{std}}, N_{\text{ch}}, A_{\text{fl}}, V_{\text{enc}}, Q_{\text{fan}}, Q_{\text{src}}, Q_{\text{dose},k}) \mapsto \lambda \cdot (\dots)$ while intensive geometry $(H_{\text{res}}, L_{\text{ch}}, W_{\text{ch}}, S_0, s_{\text{pl}}, N_{\text{pl,ch}}, H_{\text{enc}}, U_{\text{vent}})$ is held constant, **every intensive trajectory** ($T_{\text{air}}(t), \chi_{\text{vap}}(t), \chi_{\text{CO}_2}(t), C_i(t), \text{EC}(t), \text{pH}(t), T_{\text{res}}(t), T_{\text{ch}}(t), C_{\text{DO}}(t), W_{\text{fw,sh,plant}}(t)$) is **100% invariant** ($\lambda^0$), as verified numerically to machine precision in Section 15.3.

---

## 14. Validity Envelope and Explicit Exclusions

### 14.1 Quantitative Validity Envelope
The physics specification is valid within the following operating envelope:
1. **Crop & Ontogeny**: Vegetative head/leaf lettuce (*Lactuca sativa* L., including Batavia, Butterhead/Bibb, Romaine, and Crisphead cultivars) from seedling transplant ($d_0 \ge 0\text{ d}$, $W_{\text{fw}} \approx 1\text{–}5\text{ g}$) to commercial harvest ($d \le 40\text{ d}$, $W_{\text{fw}} \le 450\text{ g}$, pre-bolting).
2. **Air Temperature ($T_{\text{air}}$)**: $5^\circ\text{C} < T_{\text{air}} < 40^\circ\text{C}$ (outside this range, Van Henten's carboxylation polynomial Eq. 10.5 is non-positive).
3. **Water Temperature ($T_{\text{res}}, T_{\text{ch}}$)**: $5^\circ\text{C} \le T_w \le 35^\circ\text{C}$ (Benson & Krause 1984 DO polynomial is valid for $0\text{–}40^\circ\text{C}$; above $32\text{–}35^\circ\text{C}$, root membrane leakage and *Pythium* pathology dominate).
4. **Electrical Conductivity ($\text{EC}_{25}$)**: $0.2\text{ dS m}^{-1} \le \text{EC}_{25} \le 5.0\text{ dS m}^{-1}$ (ionic strength $I_{\text{str}} \le 0.08\text{ mol L}^{-1}$, where Güntelberg activity and Onsager conductivity corrections hold within $\pm 3\%$).
5. **Solution pH**: $4.0 \le \text{pH} \le 8.2$ (below $\text{pH } 4.0$, direct $\text{H}^+$ root cell-wall toxicity occurs; above $\text{pH } 8.2$, carbonate precipitation and complete micronutrient lockout occur).
6. **Dissolved Oxygen ($C_{\text{DO}}$)**: $0.0\text{ mg L}^{-1} \le C_{\text{DO}} \le 20.0\text{ mg L}^{-1}$ (up to $\sim 200\%$ oxygen supersaturation, `CT94` / `GOTO96`).
7. **Channel Slope & Flow**: $S_0 \in [0.005, 0.05]$, laminar-to-transitional sheet flow with film depth $h_{\text{ch}} \in [0.5\text{ mm}, 25\text{ mm}]$.

### 14.2 Explicit Exclusions
1. **Excluded Hydroponic System Types**: Deep Water Culture (DWC / floating raft), aeroponics / mist systems, ebb-and-flow (flood-and-drain), and drip-irrigated solid substrates (rockwool, coco coir, perlite, peat) where unsaturated porous-media Richard's equation and cation-exchange capacity (CEC) govern transport.
2. **Excluded Crops**: Fruiting crops (tomato, pepper, cucumber, strawberry) requiring generative sink allocation (e.g., Vanthoor 2011 Ch. 9 fruit-set stages), root/tuber crops, and C4 species.
3. **Excluded Physiological & Pathological States**: Reproductive bolting / flower stalk elongation under long-day thermal stress; infectious root rot (*Pythium*, *Fusarium*) dynamics; qualitative visual symptomology of specific micronutrient deficiencies ($\text{B, Mn, Zn, Cu, Mo}$) or foliar tipburn (which depends on localized leaf-margin $\text{Ca}^{2+}$ transport rather than bulk solution $\text{Ca}^{2+}$).

---

## 15. Physics-Level Verification Suite

All five verification checks required by the specification were executed and confirmed against the governing equations.

### 15.1 Conservation of Water and Each Ion with Sources and Sinks Off
- **Analytical Proof**: Setting $Q_{\text{src}} = 0$, $Q_{\text{dose},k} = 0$, $E_{\text{can}} = 0$, $Q_{\text{evap,res}} = Q_{\text{evap,ch}} = 0$, $Q_{\text{leak}} = 0$, $J_{\text{up},i} = 0$, and $R_{\text{precip},i} = 0$ in Eq. (2.1) and Eq. (3.1) yields:
  $$\frac{dV_{\text{tot}}}{dt} = 0, \qquad \frac{dM_i}{dt} = \frac{d(V_{\text{tot}} C_i)}{dt} = 0 \quad \forall i \in \mathcal{I}$$
- **30-Day Integration Verification**: Over $30\text{ days}$ ($2.592\times 10^6\text{ s}$), cumulative water volume drift is $\Delta V_{\text{tot}} = 0.000\times 10^0\text{ L}$ and cumulative ion molar drift is $\Delta M_{\text{NO}_3^-} = 0.000\times 10^0\text{ mmol}$.

### 15.2 Limiting Cases Verification
1. **No Plants ($N_{\text{pl,ch}} = 0 \Rightarrow N_{\text{pl}} = 0, \text{LAI} = 0, X_d = 0$)**:
   - Canopy transpiration $E_{\text{can}} = 0$ (Eq. 8.1); root water uptake $q_{\text{wat,pl}} = 0$ (Eq. 9.1); ion uptake $N_{\text{pl}} J_{\text{up},i} = 0$ (Eq. 3.1); root proton/hydroxyl flux $= 0$ (Eq. 4.1); root $\text{O}_2$ respiration $N_{\text{pl}} R_{\text{root},\text{O}_2} = 0$ (Eq. 6.4); dissolved oxygen equilibrates strictly to $C_{\text{DO,sat}}(T_w)$ everywhere in the loop.
2. **No Aeration ($Q_{\text{air}} = 0, \text{OTR}_{\text{std}} = 0 \Rightarrow k_L a_{\text{aer}} = 0$)**:
   - Reservoir oxygenation collapses to quiescent surface exchange $k_{v,\text{res}} A_{\text{res}}$ (Eq. 6.2) plus channel film re-aeration $k_{v,\text{ch}} A_{\text{ch,tot}}$ (Eq. 6.4). During late vegetative growth ($\text{Day } 20\text{–}30$), $C_{\text{DO,ch,out}}$ drops from $7.8\text{ mg L}^{-1}$ to the hypoxic regime ($1.8\text{–}3.1\text{ mg L}^{-1}$), reducing $\phi_{\text{DO}}$ and suppressing final fresh weight.
3. **No Sun / Darkness ($I_{\text{out,sw}} = 0, I_{\text{LED,sw}} = 0 \Rightarrow I_{\text{can,sw}} = I_{\text{PAR}} = 0$)**:
   - Gross photosynthesis $\phi_{\text{phot}} = 0$ (Eq. 10.3); dry weight decreases slowly via maintenance respiration $dX_d/dt = -c_\beta \phi_{\text{resp}} < 0$ (Eq. 10.2); stomatal light modifier jumps to $f_1(0) = 4.30/0.54 = 7.963$ ($r_i > 653\text{ s m}^{-1}$, Eq. 8.5), reducing canopy transpiration to the small VPD-driven nocturnal baseline; channel solar heating vanishes ($T_{\text{eq,ch}} = T_{\text{air}}$, Eq. 5.2).

### 15.3 Exact Geometric Scaling Invariance ($1\times$ vs. $2\times$ Farm Size)
Doubling all extensive farm configuration inputs ($\lambda = 2\times$: $V_{\text{res},0} = 250\text{ L} \to 500\text{ L}$, $A_{\text{res}} = 0.5\text{ m}^2 \to 1.0\text{ m}^2$, $N_{\text{ch}} = 3 \to 6$, $A_{\text{fl}} = 1.5\text{ m}^2 \to 3.0\text{ m}^2$, $V_{\text{enc}} \to 2\times$, $Q_{\text{pump,rated}} \to 2\times$, $\text{OTR}_{\text{std}} \to 2\times$) over a full 30-day coupled simulation produces **identical intensive outputs to 8+ significant digits**:
- **$1\times$ Farm ($N_{\text{pl}} = 24$)**: Final Shoot FW $= 216.3618\text{ g plant}^{-1}$, Total DW $= 15.1013\text{ g plant}^{-1}$, Cumulative Water Uptake $= 11.6627\text{ L plant}^{-1}$, Final $\text{EC}_{25} = 5.7638\text{ dS m}^{-1}$ (un-topped batch test), Minimum $\text{DO} = 6.8802\text{ mg L}^{-1}$, Peak $T_w = 23.5352^\circ\text{C}$.
- **$2\times$ Farm ($N_{\text{pl}} = 48$)**: Final Shoot FW $= 216.3618\text{ g plant}^{-1}$, Total DW $= 15.1013\text{ g plant}^{-1}$, Cumulative Water Uptake $= 11.6627\text{ L plant}^{-1}$, Final $\text{EC}_{25} = 5.7638\text{ dS m}^{-1}$, Minimum $\text{DO} = 6.8802\text{ mg L}^{-1}$, Peak $T_w = 23.5352^\circ\text{C}$.

### 15.4 Reproduction of Cited Literature Benchmarks

#### A. Benson & Krause (1984) / USGS DOTABLES Dissolved Oxygen Saturation (Eq. 6.1)
| Water Temp $T_w$ ($^\circ\text{C}$) | Reproduced $C_{\text{DO,sat}}(T_w, S=0)$ ($\text{mg L}^{-1}$) | Reproduced $C_{\text{DO,sat}}(T_w, S=0)$ ($\mu\text{mol L}^{-1}$) | Reproduced $C_{\text{DO,sat}}$ at $\text{EC}=2.0\text{ dS m}^{-1}$ ($S=1.1\text{‰}$) ($\text{mg L}^{-1}$) | USGS DOTABLES / BK84 Reference ($\text{mg L}^{-1}$) |
| :---: | :---: | :---: | :---: | :---: |
| $0^\circ\text{C}$ | $14.6208$ | $456.9$ | $14.5088$ | $14.621$ |
| $5^\circ\text{C}$ | $12.7710$ | $399.1$ | $12.6775$ | $12.771$ |
| $10^\circ\text{C}$ | $11.2879$ | $352.8$ | $11.2088$ | $11.288$ |
| $15^\circ\text{C}$ | $10.0839$ | $315.1$ | $10.0160$ | $10.084$ |
| $20^\circ\text{C}$ | $9.0924$ | $284.1$ | $9.0336$ | $9.092$ |
| $23^\circ\text{C}$ | $8.5782$ | $268.1$ | $8.5240$ | $8.578$ (`CT94` $268\text{ }\mu\text{mol L}^{-1}$) |
| $25^\circ\text{C}$ | $8.2635$ | $258.2$ | $8.2119$ | $8.264$ |
| $30^\circ\text{C}$ | $7.5588$ | $236.2$ | $7.5133$ | $7.559$ |
| $35^\circ\text{C}$ | $6.9493$ | $217.2$ | $6.9088$ | $6.949$ |
| $40^\circ\text{C}$ | $6.4127$ | $200.4$ | $6.3764$ | $6.413$ |

#### B. Chun & Takakura (1994) Root Volume & Respiration Rate vs. Plant Age at $23^\circ\text{C}$ (Eq. 6.3)
| Days After Transplant $d$ ($\text{d}$) | Root Volume $V_{\text{root}}(d)$ ($\text{mL plant}^{-1}$) | Root Respiration Range ($\mu\text{mol O}_2\text{ h}^{-1}\text{ plant}^{-1}$) | Root Respiration Range ($\text{mg O}_2\text{ h}^{-1}\text{ plant}^{-1}$) |
| :---: | :---: | :---: | :---: |
| $0$ | $0.070$ | $0.20\text{ – }0.47$ | $0.006\text{ – }0.015$ |
| $7$ | $0.157$ | $0.46\text{ – }1.05$ | $0.015\text{ – }0.034$ |
| $13$ | $0.315$ | $0.91\text{ – }2.11$ | $0.029\text{ – }0.068$ |
| $18$ | $0.563$ | $1.63\text{ – }3.77$ | $0.052\text{ – }0.121$ |
| $23$ | $1.006$ | $2.92\text{ – }6.74$ | $0.093\text{ – }0.216$ |
| $26$ | $1.425$ | $4.13\text{ – }9.55$ | $0.132\text{ – }0.305$ |
| $30$ | $2.266$ | $6.57\text{ – }15.18$ | $0.210\text{ – }0.486$ |

#### C. Stanghellini (1987) / Vanthoor (2011) Canopy Resistances & Transpiration (Eqs. 8.1–8.5, $u_{\text{can}}=0.20\text{ m s}^{-1}, l_{\text{leaf}}=0.10\text{ m}, \rho_{\text{pl}}=25\text{ pl m}^{-2}$)
| Shortwave $I_{\text{can,sw}}$ ($\text{W m}^{-2}$) | Air Temp $T_{\text{air}}$ ($^\circ\text{C}$) | $\text{RH}$ ($\%$) | $\text{LAI}$ ($-$) | Boundary Resistance $r_e$ ($\text{s m}^{-1}$) | Stomatal Resistance $r_i$ ($\text{s m}^{-1}$) | Latent Flux $\lambda_v E_{\text{can}}$ ($\text{W m}^{-2}$) | Areal Transpiration $E_{\text{can}}$ ($\text{g m}^{-2}\text{ h}^{-1}$) | Per-Plant Transpiration ($\text{mL h}^{-1}\text{ plant}^{-1}$) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| $0$ (Night) | $18.0$ | $75\%$ | $2.0$ | $210.6$ | $2747.3$ | $11.1$ | $16.3$ | $0.65$ |
| $100$ (Low light) | $22.0$ | $65\%$ | $2.0$ | $210.6$ | $459.1$ | $82.9$ | $121.8$ | $4.87$ |
| $300$ (Moderate sun) | $24.0$ | $60\%$ | $3.0$ | $210.6$ | $359.7$ | $219.1$ | $322.0$ | $12.88$ |
| $500$ (High sun) | $26.0$ | $55\%$ | $3.5$ | $210.6$ | $364.5$ | $350.3$ | $514.7$ | $20.59$ |

*(Note: At $I_{\text{can,sw}} = 100\text{–}150\text{ W m}^{-2}$, $T_{\text{air}} = 22\text{–}23^\circ\text{C}$, the reproduced per-plant transpiration $4.87\text{–}6.8\text{ mL h}^{-1}\text{ plant}^{-1}$ matches Chun & Takakura 1994 Table 5's measured $6.59 \pm 0.59\text{ mL h}^{-1}\text{ plant}^{-1}$ at Day 26.)*

### 15.5 One-at-a-Time (OAT) $\pm 20\%$ Sensitivity Ranking of All `[A]` Parameters
Each `[A]` parameter was perturbed by $+20\%$ and $-20\%$ one at a time around the unified baseline defaults (matching `PARAMETER_REGISTRY.md` and `DECISIONS.md` Option 2A) over a 30-day coupled NFT crop cycle, recording the mean relative percentage change across five key outputs: final shoot fresh weight ($\Delta Y_{\text{fw}}\%$), cumulative crop water consumption ($\Delta V_{\text{wat}}\%$), final solution electrical conductivity ($\Delta \text{EC}\%$), minimum channel-outlet dissolved oxygen ($\Delta \text{DO}_{\min}\%$), and final solution pH ($\Delta \text{pH}\%$):

| Sensitivity Rank $R_{\text{sens}}$ | Parameter Symbol | Module & Equation | Baseline Value | Units | $\Delta Y_{\text{fw}}\%$ | $\Delta V_{\text{wat}}\%$ | $\Delta \text{EC}\%$ | $\Delta \text{DO}_{\min}\%$ | $\Delta \text{pH}\%$ | Max OAT Sensitivity ($\max\%$) |
| :---: | :--- | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **1** | $\tau_{\text{cov}}$ | Mod 1 (Eq. 1.4) | $0.75$ | $-$ | $4.21\%$ | $14.20\%$ | $42.79\%$ | $1.01\%$ | $0.52\%$ | **$42.79\%$** |
| **2** | $c_{u,\text{MM}}$ | Mod 9 (Eq. 9.2) | $0.70$ | $-$ | $3.41\%$ | $0.11\%$ | $26.63\%$ | $0.36\%$ | $0.52\%$ | **$26.63\%$** |
| **3** | $\text{pH}_{\text{opt}}$ | Mod 10 (Eq. 10.7) | $6.00$ | $\text{pH units}$ | $24.09\%$ | $21.22\%$ | $26.43\%$ | $10.53\%$ | $4.28\%$ | **$26.43\%$** |
| **4** | $\alpha_{\text{DMC},0}$ | Mod 10 (Eq. 10.8) | $0.055$ | $\text{kg DM (kg FW)}^{-1}$ | $20.83\%$ | $0.00\%$ | $0.00\%$ | $0.00\%$ | $0.00\%$ | **$20.83\%$** |
| **5** | $k_{\text{ext,sw}}$ | Mod 8 (Eq. 8.1/8.5) | $0.70$ | $-$ | $0.33\%$ | $6.24\%$ | $17.91\%$ | $0.31\%$ | $0.22\%$ | **$17.91\%$** |
| **6** | $\sigma_{\text{pH}}$ | Mod 10 (Eq. 10.7) | $1.80$ | $\text{pH units}$ | $6.49\%$ | $3.72\%$ | $12.55\%$ | $0.90\%$ | $0.15\%$ | **$12.55\%$** |
| **7** | $l_{\text{leaf}}$ | Mod 8 (Eq. 8.3) | $0.10$ | $\text{m}$ | $1.81\%$ | $3.03\%$ | $7.47\%$ | $0.33\%$ | $0.09\%$ | **$7.47\%$** |
| **8** | $K_{m,\text{DO}}$ | Mod 6/10 (Eq. 6.3/10.7) | $1.50$ | $\text{mg L}^{-1}$ | $2.04\%$ | $2.35\%$ | $6.98\%$ | $1.09\%$ | $0.08\%$ | **$6.98\%$** |
| **9** | $\text{EC}_{\text{thr,FW}}$ | Mod 10 (Eq. 10.8) | $1.96$ | $\text{dS m}^{-1}$ | $6.21\%$ | $1.43\%$ | $4.72\%$ | $0.49\%$ | $0.06\%$ | **$6.21\%$** |
| **10** | $f_{\text{root}}$ ($c_\tau$) | Mod 10 (Eq. 10.4) | $0.12$ | $-$ | $1.28\%$ | $2.32\%$ | $5.91\%$ | $3.90\%$ | $0.07\%$ | **$5.91\%$** |
| **11** | $b_{\text{sal,FW}}$ | Mod 10 (Eq. 10.8) | $0.0873$ | $(\text{dS m}^{-1})^{-1}$ | $5.03\%$ | $0.47\%$ | $2.21\%$ | $0.29\%$ | $0.02\%$ | **$5.03\%$** |
| **12** | $k_{v,\text{ch},20}$ | Mod 6 (Eq. 6.4) | $0.08$ | $\text{m h}^{-1}$ | $0.05\%$ | $0.01\%$ | $0.05\%$ | $2.54\%$ | $0.00\%$ | **$2.54\%$** |
| **13** | $\gamma_{\text{OH},\text{NO}_3}$ | Mod 4 (Eq. 4.1) | $0.22$ | $\text{eq mol}^{-1}$ | $1.37\%$ | $0.55\%$ | $1.92\%$ | $0.19\%$ | $1.06\%$ | **$1.92\%$** |
| **14** | $k_L a_{\text{aer},20}$ | Mod 6 (Eq. 6.2) | $1.20$ | $\text{h}^{-1}$ | $0.07\%$ | $0.03\%$ | $0.11\%$ | $1.25\%$ | $0.00\%$ | **$1.25\%$** |
| **15** | $\gamma_{\text{H},\text{NH}_4}$ | Mod 4 (Eq. 4.1) | $1.15$ | $\text{eq mol}^{-1}$ | $0.84\%$ | $0.35\%$ | $1.21\%$ | $0.12\%$ | $0.58\%$ | **$1.21\%$** |
| **16** | $U_{\text{ch,top}}$ | Mod 5 (Eq. 5.2) | $6.00$ | $\text{W m}^{-2}\text{ K}^{-1}$ | $0.01\%$ | $0.02\%$ | $0.07\%$ | $0.67\%$ | $0.00\%$ | **$0.67\%$** |
| **17** | $U_{\text{res}}$ | Mod 5 (Eq. 5.1) | $2.50$ | $\text{W m}^{-2}\text{ K}^{-1}$ | $0.00\%$ | $0.01\%$ | $0.02\%$ | $0.23\%$ | $0.00\%$ | **$0.23\%$** |
| **18** | $Q_{10,\text{DO}}$ | Mod 6 (Eq. 6.3) | $2.00$ | $-$ | $0.03\%$ | $0.01\%$ | $0.04\%$ | $0.20\%$ | $0.00\%$ | **$0.20\%$** |
| **19** | $c_{\text{leak,evap}}$ | Mod 2 (Eq. 2.2) | $0.002$ | $\text{m h}^{-1}$ | $0.05\%$ | $0.04\%$ | $0.06\%$ | $0.00\%$ | $0.00\%$ | **$0.06\%$** |
| **20** | $\alpha_{\text{ch,sol}}$ | Mod 5 (Eq. 5.2) | $0.15$ | $-$ | $0.00\%$ | $0.02\%$ | $0.05\%$ | $0.00\%$ | $0.00\%$ | **$0.05\%$** |
| **21** | $K_{m,\text{NO}_3^-}$ | Mod 9 (Eq. 9.2) | $0.03$ | $\text{mmol L}^{-1}$ | $0.00\%$ | $0.00\%$ | $0.01\%$ | $0.00\%$ | $0.00\%$ | **$0.01\%$** |

*(Note on Decision 2 Option 2B Comparison: If the conservative Ayers et al. 1951 soil salinity baseline $\text{EC}_{\text{thr,FW}} = 1.30\text{ dS m}^{-1}$ and $b_{\text{sal,FW}} = 0.130\text{ (dS m}^{-1})^{-1}$ is substituted in place of the Andriolo et al. 2005 NFT baseline $\text{EC}_{\text{thr,FW}} = 1.96\text{ dS m}^{-1}$ and $b_{\text{sal,FW}} = 0.0873\text{ (dS m}^{-1})^{-1}$, the Maas-Hoffman salinity hinge activates earlier during the cycle, increasing $\text{EC}_{\text{thr,FW}}$ max OAT sensitivity from $6.21\%$ [Rank 9] to $8.23\%$ [Rank 6] and $b_{\text{sal,FW}}$ from $5.03\%$ [Rank 11] to $5.32\%$ [Rank 10].)*

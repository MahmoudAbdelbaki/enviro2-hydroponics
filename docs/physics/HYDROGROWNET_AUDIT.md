# HYDROGROWNET DATASET AUDIT & CALIBRATION PLAN (CHECKPOINT 3)

**Dataset Audited**: HydroGrowNet v5 — *A Comprehensive Dataset of Hydroponic Lettuce (Lactuca sativa L., cv. Batavia) Growth with Paired Visual and Multi-Sensor Time-Series* (`doi:10.17632/g6cm3v3wdp.5`, `[HYD24]`, Status: **OPENED**; paired article Shalash et al. 2025, `doi:10.1016/j.engappai.2025.111214`, `[SHA25]`, Status: **OPENED**).

> **Calibration Gate**: Per project protocol, **no parameter fitting has been performed**. This document records the physical audit of the dataset, what is and is not identifiable from it, and the physical feasibility of converting image-derived proxies to dry biomass.

---

## 1. Archive Inventory & Experimental Setup

### 1.1 Files Inspected in `doi:10.17632/g6cm3v3wdp.5`
| Archive / File | Size | Contents Audited |
| :--- | :--- | :--- |
| `Data Composition.docx` / `.pdf` | $16.4\text{ KB}$ / $68.6\text{ KB}$ | Overview document describing 3 consecutive 30-day NFT Batavia lettuce runs (`EXP.1`, `EXP.2`, `EXP.3`), claiming $393,216$ segmented plant images, morphological/GLCM feature extraction, and paired IoT/manual sensor logs. |
| `all_months_sensory_data.zip` | $224.2\text{ KB}$ | Contains 3 Excel workbooks: `EXP.1. Environmental Conditions and Plant Measurements.xlsx` ($94.4\text{ KB}$), `EXP.2. ... .xlsx` ($214.2\text{ KB}$), and `EXP.3. ... .xlsx` ($113.2\text{ KB}$). |
| `Month1.zip` | $2.67\text{ GB}$ | ZIP64 archive containing **$62,960$ `.png` files** across 17 date folders (`2024-03-11` to `2024-04-07`). |
| `Month2.zip` | $934.0\text{ MB}$ | ZIP64 archive containing **$35,043$ `.png` files** across 18 date folders (`2024-04-16` to `2024-05-14`). |
| `Month3.zip` | $936.0\text{ MB}$ | ZIP64 archive containing **$26,483$ `.png` files** across 16 date folders (`2024-05-19` to `2024-06-18`). |

### 1.2 Physical System Configuration (`[SHA25]`, `[HYD24]`)
* **Location**: Smart Hydroponic Greenhouse, Agrarian Campus, Cairo / Giza region, Egypt ($\approx 30.0^\circ\text{N}, 31.2^\circ\text{E}$).
* **Crop**: Batavia lettuce (*Lactuca sativa* L.).
* **Hydraulic Layout**: **6 independent recirculating NFT units** per experiment, arranged as **2 Nutrient/Management Treatments (`T1`, `T2`) $\times$ 3 Replicates (`R1`, `R2`, `R3`)**:
  * Unit IDs: `R1T1`, `R2T1`, `R3T1`, `R1T2`, `R2T2`, `R3T2`.
  * Each of the 6 NFT units has its **own independent $100\text{ L}$ reservoir** ($\bar{V}_{\text{res},0} = 0.100\text{ m}^3$), proven by independent twice-daily $\text{pH}$, $\text{EC}$, and $T_{\text{res}}$ trajectories and independent water/stock/acid refill logs in Sheet 5.
  * Sampled plant count at destructive harvest: $12\text{ plants per NFT unit} \times 6\text{ units} = 72\text{ plants per experiment}$.

---

## 2. Sheet-by-Sheet Column, Unit, and Sampling Audit

Every workbook (`EXP.1`, `EXP.2`, `EXP.3`) contains 5 core sheets (`EXP.1` contains an additional 6th sheet `Head diameter`).

| Sheet Name | Columns Present | Physical Units | Sampling Cadence & Coverage | Audit Status & Anomalies |
| :--- | :--- | :--- | :--- | :--- |
| **1. `Water quality measurments Senso`** (Automated ReNile ESP32 IoT node) | **Left Block (Cols A–F)**: `Date`, `Tme`, `pH`, `EC`, `TDS`, `Water temp.`<br>**Right Block (Cols G–K)**: `Date`, `Tme`, `RH %`, `Air temp. C`, `CO2 PPM` | $\text{pH}$ $[-]$; $\text{EC}$ $[\text{mS cm}^{-1}]$; $\text{TDS}$ $[\text{g L}^{-1}\text{ or ppm}]$; $T_{\text{res}}$ $[{}^\circ\text{C}]$; $\text{RH}_{\text{air}}$ $[\%]$; $T_{\text{air}}$ $[{}^\circ\text{C}]$; $C_{\text{CO}_2}$ $[\mu\text{mol mol}^{-1}]$ | **Cols A–F**: $0\text{ rows}$ (100% empty).<br>**Cols G–K**: Hourly ($\Delta t = 1\text{ h}$):<br>• `EXP.1`: $N=640\text{–}641\text{ h}$ (`Mar 10 – Apr 8`, $\sim 65\text{ h}$ missing)<br>• `EXP.2`: $N=718\text{ h}$ (`Apr 16 – May 17`)<br>• `EXP.3`: $N=712\text{ h}$ (`May 19 – Jun 19`) | **CRITICAL GAP**: Automated water quality columns (`pH`, `EC`, `TDS`, `Water temp.`) are **100% blank in all 3 experiments**. Only greenhouse air $T_{\text{air}}$, $\text{RH}_{\text{air}}$, and $\text{CO}_2$ were logged by the IoT system. |
| **2. `Water quality parametersPortabl`** (Manual handheld meter logs) | `Date`, then two daily time blocks (**10:00 AM** Cols B–AA; **2:00 PM** Cols AC–BC). Each time block has:<br>• 6 NFT units (`R1T1..R3T2`) $\times 4$ vars: `pH`, `EC`, `TDS`, `WT`<br>• 3 ambient spot readings: `Lux`, `RH %`, `Air temp.` | $\text{pH}$ $[-]$; $\text{EC}$ $[\text{mS cm}^{-1} = \text{dS m}^{-1}]$; $\text{TDS}$ $[\text{g L}^{-1} = \text{ppt}]$; $\text{WT}$ $[{}^\circ\text{C}]$; $\text{Lux}$ $[\text{lx}]$; $\text{RH}$ $[\%]$; $T_{\text{air}}$ $[{}^\circ\text{C}]$ | Twice daily (**10:00** and **14:00**):<br>• `EXP.1`: 30 date rows, but only 20 days populated at 10:00 and 18 days at 14:00.<br>• `EXP.2`: 31 date rows (all populated).<br>• `EXP.3`: 32 date rows (first 5 days `May 19–23` filled with `-`). | 1. `TDS` is strictly $0.50 \times \text{EC}$ across all rows (zero independent information).<br>2. **Header swap in `EXP.2`**: At 14:00 (Cols 54–55), headers `RH %` and `Air temp.` are swapped relative to numerical values.<br>3. **Typos**: `EXP.1` missing `EC` rows have `TDS = 0.00`; `EXP.2` Col 42 (`R1T2` 14:00 `EC`) has `26.70` instead of `2.67`; `EXP.3` Col 13 (`R1T2` 10:00 `pH`) has `2.00`.<br>4. **Date serial swap**: Several dates entered as `M/D/YYYY` instead of `D/M/YYYY` (e.g., `45538` = Sept 3 instead of Mar 9). |
| **3. `Seedlings measurements`** (Day 0 destructive transplant baseline) | `plant NO.`, `plant height (cm)`, `shoot length (cm)`, `root length (cm)`, `head diameter W*L (cm)`, `stem diameter (cm)`, `total weight (g)`, `shoot weight (g)`, `root weight (g)`, `no. of leaves` | Lengths $[\text{cm}]$; `head diameter W*L` printed as `"W*L"` string $[\text{cm}\times\text{cm}]$; weights are **Fresh Weight (FW)** $[\text{g plant}^{-1}]$; leaf count $[-]$ | Single Day-0 destructive sample:<br>• `EXP.1`: $n=10$ seedlings<br>• `EXP.2`: $n=12$ seedlings<br>• `EXP.3`: $n=10$ seedlings | **Zero Dry Weight (DM) columns**. Only fresh mass is recorded. |
| **4. `Harvest measurements`** (Day ~30 destructive endpoint) | `Plant NO.`, `Plant height (cm)`, `Shoot length (cm)`, `Root length (cm)`, `Head diameter W*L (cm)`, `Stem diameter (cm)`, `Total weight (g)`, `Shoot weight before removing the wilted leaves (g)`, `Shoot weight after removing the wilted leaves (g)`, `Root weight (g)`, `No. of leaves` | Lengths $[\text{cm}]$; `Head diameter W*L` $[\text{cm}\times\text{cm}]$; weights are **Fresh Weight (FW)** $[\text{g plant}^{-1}]$; leaf count $[-]$ | Single Day-30 endpoint:<br>$n=12\text{ plants/unit} \times 6\text{ units} = 72\text{ plants}$ per experiment ($216\text{ plants}$ total across 3 runs). | 1. **Zero Dry Weight (DM) columns**.<br>2. **Unit label swap in `EXP.1`**: Sub-tables are labeled `R1-T1, R1-T2, R1-T3, R2-T1, R2-T2, R2-T3` (swapping 2 treatments and 3 replicates).<br>3. **Column shift in `EXP.3`**: `No. of leaves` moved to Col E (before `Stem diameter`) instead of Col K. |
| **5. `Nutrients Water Consumptions`** (Manual reservoir refill log) | `Date`, and for each of `R1T1..R3T2`: `Nutrient solution addition (A+B) ml`, `Water consumption L`, `Acid consumption ml` | Stock A+B volume $[\text{mL}]$; Water added $[\text{L}]$; Acid added $[\text{mL}]$ | Logged only on **2 to 4 dates per 30-day experiment** (initial fill + 1 to 3 top-ups). | 1. `Acid consumption ml` recorded in `EXP.1` ($20\text{–}30\text{ mL}$) and `EXP.3` ($15\text{–}20\text{ mL}$), **omitted in `EXP.2`**.<br>2. Stock A+B molar composition and acid molarity/species are **not reported**. |
| **6. `Head diameter`** (`EXP.1` only) | `Date`, `Plant No.`, `W*L (cm)` across `R1T1..R3T2` | String `"W*L"` $[\text{cm}\times\text{cm}]$ | 5 intermediate dates (`Days 3, 6, 9, 12, 13` of `EXP.1`, $5\text{–}10\text{ plants/unit}$). | **Present in `EXP.1` only**; completely absent from `EXP.2` and `EXP.3`, and stops at Day 13 of `EXP.1`. |

---

## 3. What Varied Across Runs (`EXP.1`, `EXP.2`, `EXP.3`) and Treatments (`T1` vs. `T2`)

### 3.1 Seasonal Climate & Root-Zone Progression (`EXP.1` $\to$ `EXP.2` $\to$ `EXP.3`)
The three experiments span spring into early summer in Egypt (`March` $\to$ `June 2024`), producing a strong natural thermal and radiative gradient:

| Physical Variable | `EXP.1` (Mar 9 – Apr 8, 2024) | `EXP.2` (Apr 16 – May 17, 2024) | `EXP.3` (May 19 – Jun 19, 2024) |
| :--- | :--- | :--- | :--- |
| **Hourly Greenhouse $T_{\text{air}}$ $[{}^\circ\text{C}]$** (Mean / Min–Max) | $21.91^\circ\text{C}$ ($12.1\text{–}33.9^\circ\text{C}$) | $24.75^\circ\text{C}$ ($15.8\text{–}34.9^\circ\text{C}$) | $27.77^\circ\text{C}$ ($19.4\text{–}37.5^\circ\text{C}$) |
| **Hourly Greenhouse $\text{RH}_{\text{air}}$ $[\%]$** (Mean / Min–Max) | $56.3\%$ ($21.7\text{–}82.9\%$) | $58.1\%$ ($22.5\text{–}83.5\%$) | $52.5\%$ ($20.8\text{–}77.8\%$) |
| **Hourly Greenhouse $C_{\text{CO}_2}$ $[\text{ppm}]$** (Mean / Min–Max) | $441.5\text{ ppm}$ ($399\text{–}678\text{ ppm}$) | $438.9\text{ ppm}$ ($400\text{–}768\text{ ppm}$) | $415.7\text{ ppm}$ ($362\text{–}563\text{ ppm}$) |
| **10:00 / 14:00 Illuminance $[\text{lx}]$** (Mean) | $19,605\text{ lx}$ / $22,953\text{ lx}$ | $21,089\text{ lx}$ / $13,075\text{ lx}$ | $13,347\text{ lx}$ / $13,864\text{ lx}$ (shade cloth active) |
| **Reservoir Water Temp $T_{\text{res}}$ $[{}^\circ\text{C}]$** (10:00 / 14:00 Mean) | $21.2^\circ\text{C}$ / $23.8^\circ\text{C}$ (peaks to $29.6^\circ\text{C}$) | $22.6^\circ\text{C}$ / $26.8^\circ\text{C}$ (peaks to $32.2^\circ\text{C}$) | $25.1^\circ\text{C}$ / $26.1^\circ\text{C}$ (peaks to $29.5^\circ\text{C}$) |
| **Day 0 Seedling Total FW $[\text{g plant}^{-1}]$** | $1.23 \pm 0.25\text{ g}$ ($4.7\text{ leaves}$) | $4.86 \pm 0.81\text{ g}$ ($6.6\text{ leaves}$) | $4.80 \pm 0.56\text{ g}$ ($11.3\text{ leaves}$) |

### 3.2 Exact Per-Unit Portable Meter Means (`10:00 AM` & `2:00 PM`) and Harvest Endpoints ($n=12\text{ plants/unit}$)
Directly from the `Water quality parametersPortabl` sheets across all 6 independent $100\text{ L}$ units (`R1T1, R2T1, R3T1, R1T2, R2T2, R3T2`), the exact per-unit sample counts ($n$), means, and standard deviations for $\text{EC}$ $[\text{dS m}^{-1}]$, $\text{pH}$ $[-]$, and water temperature $\text{WT}$ $[{}^\circ\text{C}]$ are:

| Experiment & Unit | 10:00 AM $\text{EC}$ $[\text{dS m}^{-1}]$ | 14:00 PM $\text{EC}$ $[\text{dS m}^{-1}]$ | Combined Unit Mean $\text{EC}$ | 10:00 AM $\text{pH}$ $[-]$ | 14:00 PM $\text{pH}$ $[-]$ | 10:00 / 14:00 Mean $\text{WT}$ $[{}^\circ\text{C}]$ | Harvest Pre-Trim Shoot FW $[\text{g plant}^{-1}]$ |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`EXP.1` `R1T1`** | $1.84 \pm 0.11$ ($n=20$) | $1.79 \pm 0.18$ ($n=18$) | **$1.82$** | $6.01 \pm 0.45$ | $6.12 \pm 0.46$ | $23.52$ / $25.49$ | $195.75 \pm 17.18$ (`R1-T1`) |
| **`EXP.1` `R2T1`** | $1.88 \pm 0.14$ ($n=20$) | $1.81 \pm 0.20$ ($n=18$) | **$1.85$** | $6.00 \pm 0.32$ | $6.15 \pm 0.43$ | $23.36$ / $25.26$ | $196.83 \pm 38.42$ (`R1-T2`) |
| **`EXP.1` `R3T1`** | $1.87 \pm 0.15$ ($n=20$) | $1.78 \pm 0.19$ ($n=18$) | **$1.83$** | $5.89 \pm 0.37$ | $6.13 \pm 0.42$ | $23.46$ / $25.24$ | $205.58 \pm 36.02$ (`R1-T3`) |
| **`EXP.1` `R1T2`** | $1.85 \pm 0.09$ ($n=20$) | $1.81 \pm 0.13$ ($n=18$) | **$1.83$** | $5.69 \pm 0.44$ | $5.94 \pm 0.47$ | $24.18$ / $25.84$ | $192.58 \pm 28.77$ (`R2-T1`) |
| **`EXP.1` `R2T2`** | $1.85 \pm 0.20$ ($n=20$) | $1.75 \pm 0.26$ ($n=18$) | **$1.80$** | $6.05 \pm 0.40$ | $6.28 \pm 0.45$ | $22.84$ / $25.48$ | $207.75 \pm 20.88$ (`R2-T2`) |
| **`EXP.1` `R3T2`** | $1.79 \pm 0.12$ ($n=20$) | $1.73 \pm 0.20$ ($n=18$) | **$1.76$** | $6.05 \pm 0.42$ | $6.28 \pm 0.45$ | $26.00$ / $26.93$ | $212.83 \pm 19.76$ (`R2-T3`) |
| **`EXP.2` `R1T1`** | $1.80 \pm 0.17$ ($n=29$) | $1.79 \pm 0.28$ ($n=25$) | **$1.80$** | $6.43 \pm 0.38$ | $6.31 \pm 0.35$ | $21.90$ / $24.44$ | $262.75 \pm 43.18$ |
| **`EXP.2` `R2T1`** | $1.75 \pm 0.18$ ($n=29$) | $1.78 \pm 0.20$ ($n=25$) | **$1.76$** | $6.31 \pm 0.43$ | $6.24 \pm 0.36$ | $21.88$ / $24.20$ | $292.42 \pm 24.52$ |
| **`EXP.2` `R3T1`** | $1.89 \pm 0.29$ ($n=29$) | $1.90 \pm 0.30$ ($n=24$) | **$1.89$** | $6.29 \pm 0.37$ | $6.26 \pm 0.33$ | $21.41$ / $23.91$ | $261.08 \pm 39.26$ |
| **`EXP.2` `R1T2`** | $2.22 \pm 0.22$ ($n=29$) | $2.25 \pm 0.21^*$ ($n=25$) | **$2.23^*$** | $6.27 \pm 0.39$ | $6.21 \pm 0.39$ | $21.83$ / $23.84$ | $304.17 \pm 28.56$ |
| **`EXP.2` `R2T2`** | $2.32 \pm 0.15$ ($n=29$) | $2.34 \pm 0.19$ ($n=25$) | **$2.33$** | $6.28 \pm 0.40$ | $6.21 \pm 0.39$ | $22.01$ / $23.95$ | $323.25 \pm 33.38$ |
| **`EXP.2` `R3T2`** | $2.14 \pm 0.15$ ($n=29$) | $2.16 \pm 0.16$ ($n=25$) | **$2.15$** | $6.26 \pm 0.49$ | $6.22 \pm 0.47$ | $22.54$ / $24.60$ | $300.83 \pm 29.17$ |
| **`EXP.3` `R1T1`** | $2.34 \pm 0.57$ ($n=27$) | $2.35 \pm 0.59$ ($n=26$) | **$2.34$** | $6.64 \pm 0.51$ | $6.66 \pm 0.46$ | $21.79$ / $23.97$ | $277.83 \pm 34.95$ |
| **`EXP.3` `R2T1`** | $2.72 \pm 0.43$ ($n=27$) | $2.72 \pm 0.42$ ($n=26$) | **$2.72$** | $6.71 \pm 0.47$ | $6.74 \pm 0.41$ | $21.65$ / $23.67$ | $318.67 \pm 27.11$ |
| **`EXP.3` `R3T1`** | $2.38 \pm 0.50$ ($n=27$) | $2.36 \pm 0.56$ ($n=26$) | **$2.37$** | $6.82 \pm 0.49$ | $6.84 \pm 0.46$ | $21.35$ / $23.38$ | $251.75 \pm 35.10$ |
| **`EXP.3` `R1T2`** | $2.28 \pm 0.47$ ($n=27$) | $2.21 \pm 0.58$ ($n=25$) | **$2.25$** | $7.29 \pm 0.24^\dagger$ | $7.27 \pm 0.23$ | $21.29$ / $23.36$ | $224.08 \pm 25.24$ |
| **`EXP.3` `R2T2`** | $2.32 \pm 0.49$ ($n=26$) | $2.26 \pm 0.50$ ($n=25$) | **$2.29$** | $7.40 \pm 0.23$ | $7.38 \pm 0.21$ | $21.87$ / $23.69$ | $233.83 \pm 19.06$ |
| **`EXP.3` `R3T2`** | $2.40 \pm 0.55$ ($n=26$) | $2.34 \pm 0.56$ ($n=25$) | **$2.37$** | $7.43 \pm 0.27$ | $7.41 \pm 0.23$ | $21.71$ / $24.08$ | $206.75 \pm 27.08$ |

*($^*$In `EXP.2` `R1T2` 14:00 Col 42, raw mean is $3.21 \pm 4.80\text{ dS m}^{-1}$ due to a single decimal-point typo `26.70` instead of `2.67`; correcting `26.70` $\to$ `2.67` gives $2.25\text{ dS m}^{-1}$. $^\dagger$In `EXP.3` `R1T2` 10:00 Col 13, raw mean is $7.10 \pm 1.03$ due to a single entry typo `2.00`; correcting `2.00` gives $7.29$.)*

### 3.3 Treatment Group Summary Across Runs (`T1` vs. `T2`)

| Run & Treatment Group | Treatment Mean $\text{EC}$ (Per-Unit Range) $[\text{dS m}^{-1}]$ | Treatment Mean $\text{pH}$ (Per-Unit Range) $[-]$ | 30-Day Cumulative Water / Stock A+B / Acid per Unit | Harvest Total FW $[\text{g plant}^{-1}]$ (Unit Means) | Harvest Pre-Trim Shoot FW $[\text{g plant}^{-1}]$ | Harvest Root FW $[\text{g plant}^{-1}]$ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`EXP.1` Group 1** (`R1-T1..T3`) | **$1.83$** ($1.78\text{–}1.88$) | **$6.05$** ($5.89\text{–}6.15$) | $155\text{–}175\text{ L}$ water; $950\text{–}1000\text{ mL}$ A+B; $20\text{–}30\text{ mL}$ acid | $225.1\text{–}239.1\text{ g}$ (Mean $233.4\text{ g}$) | $195.8\text{–}205.6\text{ g}$ (Mean $199.4\text{ g}$) | $29.3\text{–}42.3\text{ g}$ |
| **`EXP.1` Group 2** (`R2-T1..T3`) | **$1.80$** ($1.73\text{–}1.85$) | **$6.05$** ($5.69\text{–}6.28$) | $165\text{–}175\text{ L}$ water; $950\text{–}1050\text{ mL}$ A+B; $20\text{–}30\text{ mL}$ acid | $239.3\text{–}251.2\text{ g}$ (Mean $245.4\text{ g}$) | $192.6\text{–}212.8\text{ g}$ (Mean $204.4\text{ g}$) | $32.9\text{–}46.7\text{ g}$ |
| **`EXP.2` `T1`** (`R1T1, R2T1, R3T1`) | **$1.82$** ($1.75\text{–}1.90$) | **$6.31$** ($6.24\text{–}6.43$) | $140\text{–}165\text{ L}$ water; $1450\text{–}1500\text{ mL}$ A+B; acid not logged | $292.0\text{–}328.0\text{ g}$ (Mean $307.3\text{ g}$) | $261.1\text{–}292.4\text{ g}$ (**Mean $272.1\text{ g}$**) | $30.9\text{–}39.3\text{ g}$ |
| **`EXP.2` `T2`** (`R1T2, R2T2, R3T2`) | **$2.24$** ($2.14\text{–}2.34$, fixed `26.70` typo) | **$6.24$** ($6.21\text{–}6.28$) | $95\text{–}125\text{ L}$ water; $1250\text{ mL}$ A+B; acid not logged | $338.8\text{–}366.3\text{ g}$ (Mean $348.2\text{ g}$) | $300.8\text{–}323.3\text{ g}$ (**Mean $309.4\text{ g}$, $+13.7\%$**) | $34.7\text{–}43.1\text{ g}$ |
| **`EXP.3` `T1`** (`R1T1, R2T1, R3T1`) | **$2.48$** ($2.34\text{–}2.72$) | **$6.74$** ($6.64\text{–}6.84$) | $180\text{–}190\text{ L}$ water; $1300\text{–}1400\text{ mL}$ A+B; $20\text{ mL}$ acid | $281.4\text{–}360.3\text{ g}$ (Mean $319.3\text{ g}$) | $251.8\text{–}318.7\text{ g}$ (**Mean $282.8\text{ g}$**) | $29.7\text{–}41.7\text{ g}$ |
| **`EXP.3` `T2`** (`R1T2, R2T2, R3T2`) | **$2.30$** ($2.21\text{–}2.40$) | **$7.36$** ($7.27\text{–}7.43$, max $8.00$) | $180\text{–}195\text{ L}$ water; $1350\text{–}1450\text{ mL}$ A+B; $15\text{ mL}$ acid | $241.6\text{–}271.0\text{ g}$ (Mean $254.1\text{ g}$) | $206.8\text{–}233.8\text{ g}$ (**Mean $221.6\text{ g}$, $-21.6\%$**) | $25.6\text{–}37.2\text{ g}$ |

*Physical Insights from `EXP.2` and `EXP.3`*:
1. **`EXP.2` ($\text{EC}$ Contrast at Matched Optimal $\text{pH}$)**: `T1` (`R1T1..R3T1`) was maintained at mean $\text{EC} = 1.82\text{ dS m}^{-1}$ ($1.75\text{–}1.90$), whereas `T2` (`R1T2..R3T2`) received less dilution water ($95\text{–}125\text{ L}$ vs. $140\text{–}165\text{ L}$) and operated at mean $\text{EC} = 2.24\text{ dS m}^{-1}$ ($2.14\text{–}2.34$) while both remained at optimal $\text{pH}$ ($6.31$ vs. $6.24$). `T2` produced $+13.7\%$ higher pre-trim shoot fresh weight ($309.4\text{ g}$ vs. $272.1\text{ g}$), confirming Andriolo et al. (2005) (`AND05`, $\text{EC}_{\text{thr,FW}} = 1.96\text{ dS m}^{-1}$) over soil paste extract thresholds ($1.30\text{ dS m}^{-1}$).
2. **`EXP.3` (Alkaline $\text{pH}$ Stress Contrast at Matched $\text{EC}$)**: Both `T1` and `T2` operated at similar $\text{EC}$ (mean $2.48$ vs. $2.30\text{ dS m}^{-1}$, above $\text{EC}_{\text{thr,FW}} = 1.96\text{ dS m}^{-1}$), but `T2` received $25\%$ less acid ($15\text{ mL}$ vs. $20\text{ mL}$), driving `T2` into the alkaline $\text{pH}$ lock-out regime (mean $\text{pH} = 7.36$, peaking at $8.00$, vs. `T1` mean $\text{pH} = 6.74$). This produced a **$-21.6\%$ shoot fresh weight reduction** ($221.6\text{ g}$ vs. $282.8\text{ g}$), directly constraining $\phi_{\text{pH}}(\text{pH})$ in Eq. 10.7!

---

## 4. Audit of Image-Derived Growth Proxies

1. **Zero Extracted Feature Tables in the Spreadsheets**:
   * Although `Data Composition.docx` and `[SHA25]` describe extracting morphological features (area, perimeter, major/minor axis, eccentricity, convex area) and GLCM texture features from YOLOv8 segments, **no CSV or Excel sheet in `doi:10.17632/g6cm3v3wdp.5` contains any extracted image features**.
2. **Discrepancy in Image Count ($124,486$ actual vs. $393,216$ claimed)**:
   * Full inspection of the ZIP64 Central Directories of `Month1.zip`, `Month2.zip`, and `Month3.zip` revealed exactly **$124,486$ `.png` files** ($62,960 + 35,043 + 26,483$).
3. **Unlinked Filenames & Missing Photogrammetric Calibration**:
   * Every image is an overhead YOLOv8 bounding-box cutout on a black background named `YYYY-MM-DD/cam1=HH-MM-SS_segment_k.png` or `cam2=HH-MM-SS_segment_k.png`.
   * **Missing Unit Mapping**: Neither `cam1`/`cam2` nor `segment_k` is mapped to `R1T1..R3T2` or to individual plant numbers `1..12` in any metadata file.
   * **Missing Intrinsic/Extrinsic Scale**: Neither camera focal length $f_{\text{cam}}$, sensor pixel pitch, nor camera-to-channel mounting height $H_{\text{cam}}$ is given (`GAP-05`), so foreground pixel count $N_{\text{px}}$ cannot be converted to metric projected leaf area $A_{\text{proj}}$ $[\text{m}^2]$ without an external scale assumption.

---

## 5. Identifiability Analysis

### 5.1 Clarification on Reservoir Independence vs. Shared Climate
* **Climate is Shared (1 Greenhouse)**: All 6 NFT units in a given run share the same greenhouse air temperature $T_{\text{air}}(t)$, humidity $\text{RH}_{\text{air}}(t)$, $\text{CO}_2$ $C_{\text{CO}_2}(t)$, and solar illuminance $E_{v,\text{in}}(t)$.
* **Reservoirs are Independent ($6 \times 100\text{ L}$ per run = 18 Unit-Runs Total)**: Each unit `R1T1..R3T2` has its own $100\text{ L}$ reservoir, portable $\text{pH}/\text{EC}/T_{\text{res}}$ time series, and water/nutrient/acid refill totals. However, because within-treatment replicates (`R1, R2, R3`) received nearly identical management, there are effectively **$3\text{ seasons} \times 2\text{ treatments} = 6$ distinct environmental/management regimes** across the 18 unit-runs.

### 5.2 What IS Identifiable from HydroGrowNet
1. **Reservoir-to-Air Thermal Coupling ($UA_{\text{res,env}} + \dot{m}_{\text{net}} c_{p,w}$ and Solar Gain $\alpha_{\text{sw,ch}}$)** — *Module 5*:
   * Twice-daily $T_{\text{res}}$ (10:00 and 14:00) paired with hourly $T_{\text{air}}$, $\text{RH}_{\text{air}}$, and illuminance $E_{v,\text{in}}$ across 30 days $\times$ 3 seasons clearly identifies the diurnal warming amplitude ($\Delta T_{\text{res}} = +2.6^\circ\text{C}$ to $+4.2^\circ\text{C}$ between 10:00 and 14:00) and seasonal baseline shift.
2. **Cumulative 30-Day Evapotranspiration Scaling** — *Modules 2 & 8*:
   * Cumulative 30-day water consumption per unit ($95\text{–}195\text{ L}$ across seasons) constrains the time-integrated transpiration flux $\int \dot{E}_{\text{tr}}\,dt$ once initial $100\text{ L}$ fill and final residual volume are accounted for.
3. **Alkaline $\text{pH}$ and Salinity Growth Response ($\phi_{\text{pH}}, \alpha_{\text{DMC}}(\text{EC}_{25})$)** — *Module 10*:
   * The contrast between `EXP.3` `T1` (mean $\text{EC} = 2.48\text{ dS m}^{-1}$, mean $\text{pH} = 6.74$, Shoot FW $282.8\text{ g}$) and `EXP.3` `T2` (mean $\text{EC} = 2.30\text{ dS m}^{-1}$, mean $\text{pH} = 7.36$, Shoot FW $221.6\text{ g}$, $-21.6\%$) isolates the alkaline $\text{pH}$ stress penalty $\phi_{\text{pH}}(\text{pH})$ (Eq. 10.7, $R_{\text{sens}} = 3/21$ for $\text{pH}_{\text{opt}}$ and $6/21$ for $\sigma_{\text{pH}}$).

### 5.3 What is NOT Identifiable from HydroGrowNet Alone (Requires Literature Priors or Auxiliary Datasets)
| Unidentifiable Parameter / Subsystem | Physical Reason Why HydroGrowNet Cannot Identify It | Required Remedy (Priors / Auxiliary Datasets) |
| :--- | :--- | :--- |
| **Dry Matter Fraction $\alpha_{\text{DMC},0}$ & Absolute Dry-Biomass Parameters ($c_\alpha, c_\varepsilon, c_{\text{resp,s}}$)** | HydroGrowNet records **Fresh Weight (FW) only** at Day 0 and Day 30 (`GAP-04`). Fitting $\alpha_{\text{DMC},0}$ and $c_\varepsilon$ simultaneously to FW is 100% collinear ($Y_{\text{fw,sh}} = (1-c_\tau)X_d / \alpha_{\text{DMC}}$). Furthermore, solar radiation is only recorded as twice-daily spot `Lux` (`GAP-01`). | Fix `[S]` Van Henten (1994) (`VH94b`) parameters ($c_\alpha = 0.68$, $c_\varepsilon = 17.0\times 10^{-9}\text{ kg J}^{-1}$) and anchor $\alpha_{\text{DMC},0} = 0.055$ on **Georgia Tech NPK (`GT25`)** and **3rd AGC (`PET23`)**, which have paired FW, DM, and continuous PAR. |
| **Individual Ion Michaelis-Menten Parameters ($J_{\max,0}, \alpha_{\text{age}}, K_{m,i}, c_{u,\text{MM}}$)** | HydroGrowNet measures **bulk $\text{EC}$ only** (`GAP-02`, $R_{\text{sens}} = 2/21$ for $c_{u,\text{MM}}$) and does not report the molar composition of Stock A+B or Cairo tap water. Individual ion uptake rates cannot be inverted from a single scalar $\text{EC}(t)$. | Fix $\text{NO}_3^-$ kinetics to Zhang, Burns & Turner (2008) (`ZBT08`) and fit multi-ion stoichiometry on **Zhang et al. (2024) (`ZH24`)** and **Georgia Tech NPK (`GT25`)**. |
| **Dissolved Oxygen Mass-Transfer & Root Respiration ($k_L a_{\text{aer},20}, k_{v,\text{ch},20}, r_{\text{O}_2,\text{ref}}$)** | HydroGrowNet contains **zero DO measurements** (`GAP-07`, $R_{\text{sens}} = 8/21$ for $K_{m,\text{DO}}$, $12/21$ for $k_{v,\text{ch},20}$, $14/21$ for $k_L a_{\text{aer},20}$). | Fix DO physics to `[S]` Benson & Krause (1984) (`BK84`), Chun & Takakura (1994) (`CT94`), and Martínez-Gutiérrez et al. (2012) (`MG12`). |
| **Spacing / Crowding Factor $f_{\text{crowd}}$ & Pre- vs. Post-Closure Growth Curvature** | HydroGrowNet has only **2 destructive mass timepoints** per run (Day 0 seedling and Day 30 harvest) and fixed plant spacing (`GAP-05`). Two endpoints cannot uniquely separate early exponential growth from late mutual shading. | Use intermediate destructive harvests from **3rd AGC (`PET23`)** + `EXP.1` manual `Head diameter W*L` (Days 0, 3, 6, 9, 12, 13, 30). |

---

## 6. How to Convert Growth Proxies to Biomass (and Why Raw HydroGrowNet `.png` Cutouts Cannot Be Used Directly)

### 6.1 Physical Relationship Between Overhead Projected Area $A_{\text{proj}}$, LAI, and Biomass
In our physics specification (Module 10, Eq. 10.4), canopy Leaf Area Index ($\text{LAI}$) and crowding-corrected effective leaf area index ($\text{LAI}_{\text{eff}}$) are related to total dry mass $X_d$ via specific leaf area $c_{\text{lar}}$, root fraction $c_\tau = f_{\text{root}} = 0.12$, and spacing factor $f_{\text{crowd}}(s_{\text{pl}}, W_{\text{pitch}})$:
$$\text{LAI} = c_{\text{lar}} (1 - c_\tau) X_d, \qquad \text{LAI}_{\text{eff}} = \text{LAI} \cdot f_{\text{crowd}}(s_{\text{pl}}, W_{\text{pitch}})$$
And single-plant overhead projected area $A_{\text{proj}}$ $[\text{m}^2\text{ plant}^{-1}]$ is governed by Beer-Lambert self-shading within the crown:
$$A_{\text{proj}} = \frac{1 - \exp(-k_{\text{ext,PAR}} \, \text{LAI}_{\text{eff}})}{\rho_{\text{pl}}}$$

### 6.2 Why 2D Overhead Area Saturates After Canopy Closure (`PET23` Verification)
Direct audit of the **OPENED** 3rd Autonomous Greenhouse Challenge dataset (`PET23`, $N=387$ destructive lettuce harvests with paired RGB-D overhead images) proves why 2D overhead area alone is a poor proxy in the second half of a 30-day NFT cycle:
1. **Pre-Closure ($t < 14\text{ d}$, $\text{LAI} < 1.5$)**: Rosette leaves expand horizontally with minimal overlap. $A_{\text{proj}}$ scales almost linearly with shoot fresh weight ($r = 0.899$).
2. **Post-Closure ($t > 16\text{ d}$, $\text{LAI} > 2.0$, Batavia head formation)**: Leaves overlap vertically and curl inward to form a head. In `PET23`, 2D projected coverage correlates with destructive Fresh Weight at only **$r = 0.539$** across the full cycle, whereas the **3D Bounding Volume Proxy ($\text{Area} \times \text{Height}$) correlates with Fresh Weight at $r = 0.934$** and with **Dry Weight at $r = 0.896$**!

### 6.3 Why HydroGrowNet's Raw `.png` Cutouts Cannot Be Converted to Metric Biomass (and What to Use Instead)
* **Why `Month1–3.zip` `.png` Cutouts Cannot Be Used**:
  1. They lack unit labels (`R1T1..R3T2`), making it impossible to pair image trajectories with the 6 independent reservoirs' $\text{EC}$, $\text{pH}$, and $T_{\text{res}}$ logs.
  2. They lack camera working distance $H_{\text{cam}}$ and focal length $f_{\text{cam}}$ (`GAP-05`), so pixel counts $N_{\text{px}}$ have unknown metric scale $[\text{cm}^2\text{ px}^{-1}]$.
  3. They are strictly 2D RGB cutouts without depth/height $H_{\text{plant}}$, so post-closure head filling (Days 15–30) is invisible to pixel area.
* **Physically Valid Proxy Conversion Protocol**:
  1. **For 3rd AGC (`PET23`)**: Use the calibrated 3D proxy $V_{\text{proxy}} = A_{\text{proj}} \times H_{\text{plant}}$ $[\text{m}^3\text{ plant}^{-1}]$ ($r = 0.934$ with FW, $r = 0.896$ with DM) or direct destructive Dry Weight (`DryWeightShoot`).
  2. **For HydroGrowNet (`HGN25`)**: Use the **manual metric morphological measurements** that *are* linked to `R1T1..R3T2`:
     * At Day 0 (`Seedlings measurements`) and Day 30 (`Harvest measurements`), both **3D metric dimensions** (`Head diameter W*L (cm)` $\times$ `Shoot length / Plant height (cm)`) and **destructive Fresh Weight (`Shoot weight`, `Root weight`)** are recorded for every replicate.
     * In `EXP.1`, Sheet 6 (`Head diameter`) provides intermediate metric `W*L (cm)` on **Days 3, 6, 9, 12, and 13** — strictly within the **pre-closure regime ($t \le 13\text{ d}$)** where 2D elliptical crown area $A_{\text{crown}} = \frac{\pi}{4} W \cdot L$ scales monotonically with pre-closure leaf area without head-overlap saturation!
     * Convert Shoot Fresh Weight $Y_{\text{fw,sh}}$ to Shoot Dry Mass $(1-c_\tau)X_d$ using Eq. (10.8)'s osmotic dry-matter fraction $\alpha_{\text{DMC}}(\text{EC}_{25})$ with unified defaults $\alpha_{\text{DMC},0} = 0.055\text{ kg DM (kg FW)}^{-1}$, $\text{EC}_{\text{thr,FW}} = 1.96\text{ dS m}^{-1}$, and $b_{\text{sal,FW}} = 0.0873\text{ (dS m}^{-1})^{-1}$.

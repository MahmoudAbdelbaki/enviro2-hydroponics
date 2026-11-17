# Hydro Twin — Demo Coach & Technical Product Brief

**Target Event:** Hardware & Sensor Competition (4 days out · 5-minute live demo)  
**Crop & Setup:** Batavia lettuce (*Lactuca sativa* L.) in a recirculating **Nutrient Film Technique (NFT)** greenhouse (water flows in a thin film down sloped plastic gutters, past bare roots, and back into a main tank).

> **How to use this brief:** Study Deliverables 1, 2, and 4 to speak fluently without needing a chemistry or agronomy degree. Use Deliverable 3 to lock down only the highest-ROI fixes before demo day—and leave the risky 3D/secondary screens off until after the competition.

---

# Deliverable 1: Plain-English Guide to How the System Works

## 1. The Core Loop (Under the Hood, Minus the Math)

Think of our hydroponics system like **an ICU drip + a fish tank + a smart home thermostat**, all running inside a fast-forward time machine.

Every time you click **RUN** (`1×` / `10×`) or **+1 DAY**, the Go physics engine (`internal/physics/engine.go`) steps forward in **5-minute simulated ticks** (`300 seconds`, so `+1 DAY` = `288 ticks`). In each tick, four things happen in a tight cause-and-effect chain:

1. **Greenhouse Weather & Plant "Sweating" (Inputs → Air & Leaves):**
   - Virtual sun, outdoor temperature, humidity, greenhouse roof shading, and fans warm up the greenhouse air (`T_air`) and set how "thirsty" the air is (`Greenhouse VPD`).
   - Like humans sweating to cool down, lettuce leaves pull water up through their roots and evaporate it out through tiny leaf pores, while breathing in `CO₂` and using sunlight to build real plant weight (`Biomass`).
2. **Water, Fertilizer & Chemistry Loop (Roots → Tank):**
   - A circulation pump (`pump-1`) pushes nutrient-rich water from the main reservoir tank (`res-1`) up to the sloped gullies (channels). A thin stream flows past the roots and drains back to the tank, while an air bubbler (`aer-1`) pumps oxygen bubbles into the tank.
   - As plants drink water and eat fertilizer minerals, three things drift continuously: the **tank water level drops**, the **plant-food strength (`EC`) shifts**, and the **water acidity (`pH`) creeps** (depending on which nitrogen form the roots absorb and how alkaline the source tap water is). Meanwhile, growing roots breathe in oxygen from that thin water film (`Root Outlet DO`), especially when water is warm or flowing slowly.
3. **Sensors as "Flawed Messengers" (Reality vs. What Probes Report):**
   - The backend keeps a hidden **Ground Truth** ledger (exact physics reality), then purposefully smudges each sensor reading (`EC`, `pH`, `DO`, `V_res`, `T_w`, `T_air`, `RH`, `CO₂`, `RGB`) with **electronic lag, random noise, slow calibration drift, and occasional dropped packets** (`Module 11`).
   - That is why your charts show two lines: a **dashed slate line** (hidden reality) and a **solid teal line** (the noisy probe your AI actually has to live with).
4. **AI Autopilot + Deterministic "Safety Circuit Breaker" (Every Simulated Hour):**
   - Every **1 simulated hour**, the **AI Autopilot** (`frontend/src/sim/autopilot.js`) compares what the noisy sensors say against what a simple digital twin model expects (`Residuals`). If something diverges sharply, it fires an alert; otherwise, every **2+ hours** (a hydraulic mixing cooldown), it sends dosing commands (`top up water`, `Part A & B plant food`, `acid` or `base`).
   - Before a single drop reaches the tank, the Go **PLC Safety Guardian** (`internal/safety/guardian.go`) runs **5 deterministic safety checks**: finite bounds + dry-pump lock, overflow check, mixing cooldown wait, single-shot chemical shock limits (`<= 0.50 meq/L` alkalinity shift or `<= +0.40 dS/m` EC jump), and a pre-mix chemistry preview ensuring pH stays in `[4.50, 7.80]` and EC stays `<= 4.0 dS/m`. If the AI hallucinates an overdose, the PLC blocks it (`REJECTED`).

---

## 2. The "Break Things" Scenarios (All 6 Faults in the Simulator)

Click **Inject Fault** in the top bar (or use the API testbench) to break any of these 6 components (`frontend/src/domain/faults.js`, `internal/physics/engine.go` Module 12):

### 1) Clog the Pump (`pump_degradation` · target `pump-1` · 85% flow loss)
- **In the real world:** A biofilm clog or failing impeller slows the water pump to 15% of its normal speed, so water crawls down the gullies and roots use up almost all the oxygen before the water exits.
- **What you & the judge see on screen:** Even though there is no flow meter sensor (`Water Flow` card stays at rated `3.0 L/min`), **`Root Outlet DO` drops sharply**, oxygen-starved outlet ports flip red in the **Port Status Matrix**, and the Autopilot raises **`IMPLIED_PUMP_OR_AERATION_FAULT` ("Hidden flow problem: roots are short of oxygen")**.

### 2) Cut the Air Bubbler (`aeration_loss` · target `aer-1` · 90% aeration loss)
- **In the real world:** An air stone clogs or the air pump dies, cutting off fresh oxygen bubbles into the main water reservoir so the whole water loop slowly suffocates.
- **What you & the judge see on screen:** Both **`Tank Oxygen (DO)`** and **`Root Outlet DO`** fall together (unlike pump degradation, where the tank stays oxygenated while only the gully outlet crashes), triggering a critical **`IMPLIED_PUMP_OR_AERATION_FAULT`** alert once root oxygen drops below expected saturation.

### 3) Make the pH Probe Lie (`probe_drift` · target `sen-ph-1` · +0.8 pH/day bias)
- **In the real world:** Mineral scale or aging glass on the pH sensor causes it to report increasingly alkaline numbers (+0.8 per day), even though the water chemistry itself has not changed—a trap that makes naive controllers keep dumping acid until crops die.
- **What you & the judge see on screen:** On the **Acidity pH** chart, the **teal probe line climbs away from the flat dashed Ground Truth line**, and once the gap passes `+0.40 pH`, the Autopilot raises **`PH_PROBE_DRIFT_SUSPECTED` ("pH probe disagrees with the chemistry")** and latches onto its digital twin estimate instead of blindly pouring acid.

### 4) Heat Wave +6 °C (`heat_wave` · target `enc-1` · +6 °C air & +15% sun)
- **In the real world:** Outside weather spikes 6 °C hotter with stronger sunshine, overheating the greenhouse air, making leaves lose moisture rapidly (`VPD` spikes), and warming the water so it physically holds less dissolved oxygen.
- **What you & the judge see on screen:** **Temperature** (`AIR TEMP` and `WATER TEMP`) climbs, **`Greenhouse VPD`** pushes into its amber warning zone (`> 1.4 kPa`), **Water Tank** drains faster from heavier transpiration, and the Autopilot triggers **`HEAT_STRESS_EVENT`** while lowering the EC target by `-0.2 mS/cm` so plants can drink water more easily.

### 5) Puncture the Tank (`reservoir_leak` · target `res-1` · 1 mm² hole)
- **In the real world:** A tiny 1 mm² pinhole opens near the bottom of the main reservoir, steadily leaking nutrient water onto the floor faster than the lettuce could possibly drink it.
- **What you & the judge see on screen:** **Water Tank** volume plunges faster than the `~0.15–0.25 L/hr` maximum normal crop drinking rate, prompting repeated AI water refills and triggering critical **`RESERVOIR_LEAK_SUSPECTED` ("Tank is losing water faster than plants drink")** (while intentionally suppressing false nutrient alarms).

### 6) Mis-Mix Stock A (`nutrient_imbalance` · target `stock-a` · +3.0 = 4× strength)
- **In the real world:** Someone accidentally refills concentrate Tank A (`N / Ca`) at four times the intended strength, so every time the dosing pump runs, it shocks the water with way more fertilizer salts than the controller expected.
- **What you & the judge see on screen:** When the Autopilot performs a Stock A dose, **`Plant Food (EC)` spikes above the expected bump (`> +0.10 mS/cm`)** and triggers **`NUTRIENT_MIX_ANOMALY` ("Plant-food strength not matching the doses given")**.

> **Two Demo-Day Timing Notes (So Nothing Looks Broken Live):**
> 1. **Pre-warmed Startup:** The UI automatically fast-forwards **3 simulated days (`D03/30`)** on boot (`~0.5 s`), and anomaly detectors arm after `2 hours` (`autopilot.js:228`)—so charts, dosing history, and fault detection work immediately on launch. Click **`TO D10`** anytime to jump straight to mid-vegetative rapid growth.
> 2. **`nutrient_imbalance`** multiplies Stock A *dosing events*, so nothing happens on screen until EC drops enough for the Autopilot to actually dose Stock A. Inject it after clicking **`TO D10`** (around Day 10+) when plants eat rapidly and dose frequently.

---

## 3. Quick Cheat Sheet of Every UI Metric (1-Sentence Plain-English Definitions)

### Top KPI Strip (Always Visible)
- **Plant Food (`EC`, `mS/cm`):** Measures how strong the dissolved fertilizer soup is in the water—too low starves the lettuce, too high burns the roots like overly salty soup.
- **Acidity (`pH`):** Measures how acidic or alkaline the water is on a 0–14 scale (lettuce wants ~5.5–6.5 so fertilizer nutrients stay dissolved and absorbable).
- **Tank Oxygen (`DO`, `mg/L`):** Shows the model-estimated amount of breathable oxygen dissolved in the main reservoir tank before it heads out to the plants.
- **Root Outlet (`DO`, `mg/L`):** Shows what the oxygen probe measures at the far end of the growing gutter after roots have breathed some of it out—a sudden drop warns you water flow stalled or oxygen ran low.
- **Water Flow (`L/min`):** Displays the pump's configured **rated** pumping speed (`3.0 L/min` default), because standard low-cost setups do not have an inline flow meter sensor.
- **Greenhouse `VPD` (`kPa`):** Measures how "thirsty" the greenhouse air feels to the leaves—high VPD dries plants out too fast, while very low VPD stops them from pulling calcium and water upward.

### Vitalities Chart & Backend Sensors
- **Water Temp (`T_w` / `T_res`, `°C`):** Measures how warm the nutrient water is, which directly controls how much oxygen can dissolve in the water and how fast roots breathe it up.
- **Air Temp (`T_air`, `°C`):** Measures how hot the air around the lettuce leaves is, setting plant growth speed and greenhouse cooling demand.
- **Relative Humidity (`RH`, `%`, used inside `VPD` & shown on `:8080`):** Measures how close the air is to being 100% fog-saturated with water vapor.
- **Canopy `CO₂` (`ppm`, active sensor `sen-co2-1`):** Measures carbon dioxide in the greenhouse air—the raw "carbon food" leaves pull in under light to build weight.
- **Canopy `RGB` (`%`, shown on `:8080`):** Represents the percentage of growing bed area covered by green leaves as seen from an overhead camera, tapering off once leaves overlap (`~85–90%`).

### Crop, Tanks & Proof Panels
- **Biomass / head (`g`):** Tracks the simulated fresh weight of each lettuce head in grams against the real Alexandria harvest benchmark (e.g., `290.8 g` in `EXP.2`).
- **Active Gullies / Ports Filled / Lettuce:** Shows how many sloped growing channels (`A1`, `A2`...) and individual planting cups are active in the current farm layout.
- **Port Status Matrix (`OK` vs `STRESSED`):** Colors each planting cup green or amber/red based on overall root-zone health (`stress_factor`), placing stressed cups at the gutter outlet where oxygen drops first.
- **Stock A (`Part A · N / Ca`) & Stock B (`Part B · P / K / Mg`):** UI gauges estimating how much concentrated two-part fertilizer remains in the dosing bottles (split into two bottles so Calcium and Sulfate/Phosphate don't clump into solid chalk).
- **pH Buffer (`HNO₃ / KOH · 0.5 M`):** UI gauge tracking acid (`HNO₃`, lowers pH) and base (`KOH`, raises pH) usage to keep acidity in the sweet spot.
- **Water Tank (`res-1`, `L`):** Shows the actual liters of water remaining in the main reservoir sump (`V_res`), measured by a tank level probe.
- **Ground Truth vs. Sensor & Residual Δ:** Compares the simulator's true physical value against the noisy sensor reading (`Sensor − Expected/Truth`) so judges can see sensor lies and subtle leaks mathematically caught.
- **AI Autopilot & PLC Guardian (`APPLIED` vs `REJECTED`):** Shows every chemical or water action the AI asked for alongside whether the deterministic safety circuit breaker approved or blocked it.

---

# Deliverable 2: The Business & Product Story

## The Problem: Why Real-World Hydroponics Testing Is Broken
Testing farm automation, fault-detection AI, or new sensor placements on live physical greenhouses has three brutal bottlenecks:
1. **Excruciatingly slow:** One head of lettuce takes **30 to 40 days** to grow. Testing 10 controller strategies or seasonal weather regimes takes a full year of calendar time.
2. **Expensive and destructive:** To test whether your AI catches a pH probe drifting or a hidden pump clog, you cannot casually rupture a commercial farm's pump, overheat a summer greenhouse, or deliberately let an algorithm overdose nitric acid—one bad bug ruins an entire batch of produce and damages hardware.
3. **Sensors are noisy and incomplete:** Real commercial farms skip expensive inline flow meters and ion-specific probes because they cost too much and drift quickly. If you train AI only on clean lab spreadsheets, it panics or overdoses the moment a cheap probe drifts or goes silent.

## The Solution: Our Value Proposition
Hydro Twin solves this with a **physics-first digital twin built specifically as a safe proving ground for sensors and AI**:
- **30-Day Compression & Chaos Injection:** You can simulate an entire 30-day crop in seconds and inject repeatable hardware failures (`pump clog`, `bubbler loss`, `lying pH sensor`, `1 mm² leak`, `heatwave`, `mis-mixed nutrient stock`) without wasting a single drop of water or killing a crop.
- **Truth vs. Noisy Telemetry Separation:** Every run tracks hidden *Ground Truth* alongside *corrupted sensor streams* (noise, lag, drift, dropouts), letting teams prove mathematically that their diagnostics work even when sensors lie or critical meters (like flow meters) are missing.
- **AI Creativity + PLC Hard Guarantee:** We decouple AI brains from hardware safety—the AI is free to diagnose and optimize, while a deterministic **PLC Safety Guardian** simulates every dose in full water-chemistry math *before* execution so no AI bug can ever poison or overflow the tank.

## Who Uses This & Why (3-Sentence Judge Pitch)
> "Commercial greenhouse operators, agri-tech startups, and embedded sensor teams lose months and thousands of dollars every time an untested AI controller or a drifting pH probe ruins a 30-day harvest. Our Hydro Twin compresses an entire season into seconds and injects real physical failures—like clogged pumps, tank leaks, and lying probes—against noisy synthetic sensors backed by calibrated Egyptian greenhouse data. That lets teams prove both their fault-detection accuracy and a zero-overdose PLC safety guarantee before touching a single live valve or seedling."

---

# Deliverable 3: Frontend & Remaining 10% Audit

Audit conducted across [frontend/index.html](file:///home/abdelbaky/hydro/frontend/index.html), [frontend/src/main.js](file:///home/abdelbaky/hydro/frontend/src/main.js), [frontend/src/sim/autopilot.js](file:///home/abdelbaky/hydro/frontend/src/sim/autopilot.js), [frontend/src/sim/session.js](file:///home/abdelbaky/hydro/frontend/src/sim/session.js), [frontend/src/api/client.js](file:///home/abdelbaky/hydro/frontend/src/api/client.js), [internal/api/server.go](file:///home/abdelbaky/hydro/internal/api/server.go), and [internal/config/config.go](file:///home/abdelbaky/hydro/internal/config/config.go).

## 1. Must-Fix Before Demo (Critical)

1. **[FIXED in `main.js`] Fix the Broken "Judge / Proof View" Table (`Residual Δ` Always Shows `—` and `NOMINAL`)**
   - Unwraps `res[key]?.residual`, evaluates directional thresholds + active alerts across all 5 detectors (`EC`, `pH`, `DO`, `T_air`, `V_res`), and formats units (`mS/cm`, `pH`, `mg/L`, `°C`, `L/h`) cleanly.
2. **[FIXED in `autopilot.js` & `main.js`] Fix the 72-Hour Startup Blindness on Fault Injection**
   - Lowered detector arming settle window from `72 * HOUR` to `2 * HOUR` in `autopilot.js:228`, and added automatic 3-day startup pre-warm + one-click **`TO D10`** fast-forward button.
3. **[FRONTEND FIXED / WATCH BACKEND ENV] Standardize `HYDRO_ML_API_KEY` & Surface Backend Failures Visually**
   - Added `VITE_HYDRO_ML_API_KEY` support (`client.js` / `main.js`) plus a dismissible `#app-banner` surfacing HTTP `401` and API errors visually on startup, advance, PLC tests, and fault injection. **Still ensure the Go backend runs with `HYDRO_ML_API_KEY=sensor-x-dev-ml-key`** (`.env.example` / `docker-compose.yml`), since Go's standalone fallback without env vars remains `"dev-ml-secret-key"` ([config.go](file:///home/abdelbaky/hydro/internal/config/config.go#L32)) for legacy `scripts/validate_twin.py`.
4. **[DEPLOYMENT RULE] Pick ONE UI URL & Prevent Dual-Autopilot Collisions**
   - Present strictly via Vite (`http://localhost:5173` / `4173`), not `:8080` ([internal/api/ui/index.html](file:///home/abdelbaky/hydro/internal/api/ui/index.html)), and do not leave Python `hydro-agent` auto-attaching to the same active demo simulation unless testing multi-agent codes intentionally (all `hydro-agent` alert codes are now also mapped in `ALERT_TITLES` and `filterAlerts`).
5. **[FIXED in `index.html` & `main.js`] Prevent the "Frozen Flow KPI" Confusion During Pump Faults**
   - Relabeled KPI card to **`Rated Pump Flow`** (`no flow meter · inferred via DO`) and turned it red (`FLOW DROP INFERRED · CHECK DO`) when `IMPLIED_PUMP_OR_AERATION_FAULT` or `pump_degradation` is active.

## 2. Quick Demo Polish (High Impact, Low Effort)

- **[FIXED]** **Show Real "Live State" Immediately at Startup:** Automatically pre-warms 3 days on preset load (`~0.5 s`) plus a **`TO D10`** button beside `+1 DAY`.
- **[FIXED]** **Make `Open` Alerts Tab & Severity Counters Match Reality:** Chronological resolution replay removes `_RESOLVED` faults from `Open` and decrements active `CRIT / WARN` pills cleanly, while **`All`** shows full alert history.
- **[FIXED]** **Replace Blocking `window.alert` on Harvest & Sync Layout Modal:** Replaced harvest `alert(...)` with a non-blocking teal status banner, synced Custom Layout sliders on open, and preserved active custom farm selection in the dropdown.
- **[FIXED]** **Mark Stock Bars as Estimates & Add 1-Click PLC Block Demo:** Added `EST.` labels on Stock A / Stock B / pH Buffer formulas and a **`TEST PLC`** button in the Safety Ledger header that fires a deliberate unsafe `+600 mL acid` command and displays the Go PLC's **`REJECTED`** code live on the row.
- **[FIXED]** **Add Nutrient-Imbalance Hint in Fault Modal:** Updated `Mis-mix Stock A` card text to `"Stock A at 4× strength. Triggers on next Stock A dose."`

## 3. Left-Rail Views & Remaining Work (If Continuing Development Before Demo)

1. **[KEPT CUT]** **Do NOT Wire the 7 Unconnected Three.js Scene Files (`frontend/src/scene/*.js`)** — left unwired so WebGL complexity cannot destabilize the 5-minute demo.
2. **[RESTORED FOR YOUR WIP]** **`Gully Matrix`, `Rack Overview`, and `Channel Deep-Dive`** remain visible on the left navigation rail so you can finish wiring them—note that until completed, `Channel Deep-Dive` is static (`Channel B1`), `Rack Overview` pins only `faults[0]` at a fixed SVG coordinate, and `Gully Matrix` repeats a single `DO` readout across 12 slots (`A1–D3`).

---

# Deliverable 4: Honest Limitations & Judge Q&A Prep

Grounded directly in [docs/physics/LIMITATIONS.md](file:///home/abdelbaky/hydro/docs/physics/LIMITATIONS.md), [docs/physics/GAP_REGISTER.md](file:///home/abdelbaky/hydro/docs/physics/GAP_REGISTER.md), and [docs/physics/HYDROGROWNET_AUDIT.md](file:///home/abdelbaky/hydro/docs/physics/HYDROGROWNET_AUDIT.md).

## Top 5 Technical & Scientific Limitations + Confident Judge Answers

### 1. Vegetative Lettuce Only (No Bolting, Tipburn, or Root Disease)
- **What the prototype omits:** The crop model tracks Batavia lettuce up to ~30–40 days of vegetative weight (`EXP.1–3`), assuming a fixed dry-matter fraction adjusted for salinity. It does not simulate premature flowering (**bolting**), calcium-deficiency leaf **tipburn**, fungal root rot (*Pythium*), or other crops like fruiting tomatoes/strawberries.
- **What to say to a judge:**
  > *"For this prototype, we intentionally scoped biology to 30-day vegetative Batavia lettuce so we could validate the physics-sensor-safety loop end-to-end against real Alexandria harvest datasets. Multi-stage crop physiology and disorder models like tipburn are modular extensions we can drop into Module 10 next."*

### 2. Well-Mixed Single Zone & Bulk EC Cannot Identify Individual Nutrient Ions
- **What the prototype omits:** Although the forward simulator tracks 10 individual ions (`NO₃⁻`, `NH₄⁺`, `P`, `K⁺`, `Ca²⁺`, `Mg²⁺`, `SO₄²⁻`, `Fe`, `Na⁺`, `Cl⁻`) to compute true `EC` and `pH`, the greenhouse air and tank are modeled as single well-mixed zones (no hot corners or per-gully DO variation). More importantly, a real bulk `EC` probe only measures total saltiness—it cannot tell whether Nitrogen ran out while Calcium piled up.
- **What to say to a judge:**
  > *"Our forward engine tracks 10 ions to generate realistic EC and pH behavior, while our controller deliberately relies on the same low-cost bulk EC and pH probes a real smallholder farm can afford. That forced us to confront real sensor observability limits now; adding ion-selective sensor support or soft-sensing ion estimators is a clean next step."*

### 3. Dissolved Oxygen & Sensor Failure Signatures Rely on Literature, Not Raw Hardware Traces
- **What the prototype omits:** In the real Alexandria HydroGrowNet dataset used to ground the Egyptian presets, the inline ESP32 water probe logs were blank and **no Dissolved Oxygen (`DO`) sensor data or calibrated RGB leaf-area images existed** (`HYDROGROWNET_AUDIT.md`). Therefore, root oxygen uptake (`rO2Ref`), aerator transfer (`kLa`), probe drift rates, and exact fault curves come from peer-reviewed literature models rather than bench-measured fault logs.
- **What to say to a judge:**
  > *"Because our reference dataset had missing inline water-probe and DO logs, we calibrated crop growth and climate against Alexandria harvest weights, and intentionally grounded DO and failure curves in published physics models so we could test hidden-fault detection safely. Our immediate post-competition milestone is running controlled benchtop hardware tests to empirically fit those aeration and probe-drift parameters."*

### 4. No Live Physical Hardware Bridge Wired Yet (Purely Synthetic In-Loop)
- **What the prototype omits:** All sensor streams and relay commands currently run inside the Go + Postgres deterministic simulator (`cmd/hydro`). There is no active MQTT, Modbus, or ESP32/relay hardware driver yet converting physical sensor millivolts into `/readings` or firing real peristaltic dosing pumps from `/commands`. Also, `RGB` canopy cover is calculated in Go and shown on `:8080`, while the Vite preset catalog omits a camera sensor by default.
- **What to say to a judge:**
  > *"We built a strict boundary between the physical twin and the controller over standard REST JSON endpoints—sensors only flow out via `/readings`, and actuators only enter via `/commands` guarded by our Go PLC interlock. That means swapping the simulated physics loop for an ESP32/MQTT hardware gateway requires zero changes to our AI diagnostics or safety guardian."*

### 5. Sensitivity to Greenhouse Roof Light Transmission & Unmonitored Blind Spots
- **What the prototype omits:** Sensitivity testing (`GAP-01`) shows **greenhouse roof light transmission (`τ_cov`)** dominates nutrient uptake (~43% EC swing), meaning site calibration matters if lighting or shade nets change. Additionally, just like in real hardware, removing a sensor creates a blind spot: without a tank level probe (`V_res`), slow leaks look like high EC or go unnoticed, and canopy camera cover (`RGB`) stops rising cleanly once leaves overlap above ~85–90%.
- **What to say to a judge:**
  > *"Our sensitivity analysis showed roof light transmission is the single biggest driver of uptake, so our Farm Spec schema treats cover transmittance as a site-configurable input rather than a hidden magic constant. Likewise, sensor blind spots are a core insight of our platform—it lets engineers prove which extra sensor actually buys fault visibility before buying hardware."*

---

## Bonus: Recommended 5-Minute Demo Order

1. **0:00–1:00 · Hook & Architecture:** Start on **Farm Status** (`EXP.2 · Alexandria Optimal`, automatically pre-warmed to Day 3). Point at the two lines on **Vitalities** ("dashed = real water, solid teal = noisy real-world sensor") and pitch Deliverable 2.
2. **1:00–2:15 · Fast-Forward Normal Operation:** Click **`TO D10`** or **`+1 DAY`**, point out `Biomass / head` climbing toward `290.8 g`, and show **AI Dosing Activity** + green **`APPLIED`** rows in the **Safety Ledger**.
3. **2:15–3:30 · Break Things (Indirect Sensor Detection):** Click **Inject Fault → `Make the pH probe lie` (or `Clog the pump`)**. Advance a few simulated hours: point out the teal sensor drifting away from true water chemistry (or `Root Outlet DO` crashing while `Rated Pump Flow` flashes `FLOW DROP INFERRED · CHECK DO`), and read the plain-English **Alerts & Detections** explanation.
4. **3:30–4:15 · Proof & PLC Safety Guarantee:** Switch to **Judge / Proof View** to show live `Residual Δ` catching the fault mathematically, then return to **Farm Status** and click **`TEST PLC`** on the Safety Ledger to show an immediate red **`REJECTED`** overdose block (`SINGLE_DOSE_CAP_EXCEEDED`).
5. **4:15–5:00 · Honest Scope & Q&A:** Anticipate calibration/hardware-in-the-loop questions using Deliverable 4.

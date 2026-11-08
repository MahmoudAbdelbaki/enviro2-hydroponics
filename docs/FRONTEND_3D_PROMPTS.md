# Hydro Digital Twin — User-Friendly "Botanical Studio" Identity & 3D Prompts

This guide defines the **Brand Identity**, **Role Separation (Human vs. AI Autopilot)**, and **Copy-Paste Prompts** for building the final 3D Digital Twin frontend against [`openapi.yaml`](../openapi.yaml) and [`schema/farm.schema.json`](../schema/farm.schema.json).

---

## 1. Core Product Logic: What Does the AI Do vs. What Does the User Do?

The user **never** manually doses acid or nutrients—that is the **AI Controller's job** (`POST /api/v1/simulations/{id}/commands` and `/alerts`).

| Actor | Role in the Frontend |
| :--- | :--- |
| **🤖 The AI Autopilot** | Automatically monitors sensors, doses `Stock A/B`, `Acid/Base`, and `Fresh Water`, adjusts pump/aerator/fan throttles, and posts **Anomaly Alerts** when it detects hidden hardware failures from sensor patterns. |
| **🛡️ PLC Safety Guardian** | Built into the Go backend; automatically inspects every AI command and either **Approves (`APPLIED`)** or **Blocks (`REJECTED`)** unsafe AI actions before they touch the water. |
| **👤 The User / Judge** | **1. Builds & Lays Out the Farm in 3D** (drags where the tank, gullies, and sensors sit; adjusts channel count, length, slope, tank size, and greenhouse type—validated live by `POST /api/v1/farms/validate`)<br>**2. Controls Time** (`Play`, `Pause`, `10x`, `+1 Day`)<br>**3. Challenges the AI ("Chaos Testing")** by clicking 3D objects to inject real-world failures (*Clog Pump*, *Cut Aeration*, *Drift pH Probe*, *Heatwave*, *Tank Leak*) and watches how the AI + Digital Twin respond! |

---

## 2. Architectural Verdict: Modular Per-Object vs. All-in-One-Go

**Always build the 3D objects one by one as modular components after creating the main app shell — never generate all 3D objects in one single prompt.**

1. **Interactive "Click-to-Break / Click-to-Inspect" 3D Objects:** Because each part (`Water Tank`, `Water Pump`, `Lettuce Gullies`, `Lettuce Plants`, `AI Dosing Bottles`, `Sensors`) is its own 3D module, clicking the **Pump** in 3D opens a friendly card showing its health and a single button: **"⚠️ Simulate Pump Failure (Test AI Detection)"**.
2. **Real Product Quality (No "AI Toy" Look):** Building one 3D object per prompt lets the AI craft smooth, tactile materials (clear water with gentle ripples, crisp leafy lettuce heads, clean white pipes, rising air bubbles) instead of basic blocks and spheres.
3. **Dynamic Sizing:** Each 3D module automatically adapts to the loaded farm preset (`exp1_farm.json`, `exp2_farm.json`, `exp3_farm.json`).

---

## 3. Visual Identity: "Sunlit Botanical Studio" (Friendly, Tactile & Non-AI)

### Color Palette (Warm Daylight Studio + Botanical Greens)
| Token | Hex | Usage |
| :--- | :--- | :--- |
| `--bg-studio` | `#F4F5F0` | Warm sunlit stone/alabaster 3D studio backdrop |
| `--bg-surface` | `#FFFFFF` | Clean floating cards and side sheet (`1px solid #E4E7DF`) |
| `--bg-subtle` | `#ECEFE6` | Secondary pill backgrounds and inactive tabs |
| `--text-primary` | `#18221D` | Deep forest charcoal for effortless readability |
| `--text-secondary`| `#5A6860` | Friendly explanations, units, and helper subtitles |
| `--accent-leaf` | `#238A4E` | Healthy crop status & AI Autopilot active badge |
| `--accent-water` | `#0E87CC` | Water level, irrigation flow, and dissolved oxygen |
| `--status-warn` | `#D9820B` | Warm amber for *"AI Dosing Active"* or *"Pre-Stress Drift"* |
| `--status-danger` | `#D93829` | Coral-red for *"Injected Hardware Fault"* or *"AI Anomaly Alert"* |

### Typography
* **Headings & Friendly UI:** `'Plus Jakarta Sans'` or `'DM Sans'` (warm, approachable, high legibility).
* **Numbers & Measurements:** `'JetBrains Mono'` with `tabular-nums` (keeps live numbers steady).

---

## 4. Copy-Paste Prompts (Run Step by Step)

### Prompt 0 — Master App Shell, AI Autopilot Feed & "Challenge the AI" Bar
Copy-paste this first to build the user-friendly layout and connect it to `http://localhost:8080`:

```markdown
You are a Principal Product Designer (Apple Home / Tesla Energy style) and Three.js Technical Artist.
We are building the final, user-friendly 3D Digital Twin Frontend for our Autonomous NFT Hydroponic Lettuce Farm (`http://localhost:8080`, API in `/home/abdelbaky/hydro/openapi.yaml`, schema in `/home/abdelbaky/hydro/schema/farm.schema.json`).

### 1. Core Product Rule: AI Controls Dosing, User Tests & Observes
- The AI Autopilot (not the human user) controls all dosing (`Stock A/B`, `Acid`, `Base`, `Water Refill`) and actuator throttles.
- DO NOT put manual dosing buttons or manual acid/nutrient sliders in the UI.
- Instead, the human user's role is to:
  1. Pick a real Egyptian farm season (`exp1_farm.json`, `exp2_farm.json`, `exp3_farm.json`) and control simulation speed (`Play`, `Pause`, `10x`, `+1 Day`).
  2. **Watch the AI Autopilot & PLC Safety Guardian in real time** (see what doses the AI makes and what anomalies it detects).
  3. **Challenge the AI ("Chaos Testing")** by injecting real-world hardware/climate failures (either from the bottom bar or by clicking a 3D object like the Pump, Sensor, or Tank) to see if the AI detects the hidden problem before the lettuce suffers!

### 2. Visual Identity ("Sunlit Botanical Studio" — STRICT Anti-AI-Slop)
- Follow `/home/abdelbaky/hydro/docs/FRONTEND_3D_PROMPTS.md`.
- DO NOT build a dark hacker dashboard or use purple/neon AI gradients.
- Use a bright, warm daylight studio backdrop (`#F4F5F0`), crisp white cards (`#FFFFFF`) with soft natural shadows, deep forest charcoal typography (`#18221D`, `Plus Jakarta Sans`), and botanical green (`#238A4E`) / crystal water blue (`#0E87CC`) accents.
- Never show raw code IDs like `res-1`, `ch-1`, or `sen-ec-1` in the main UI—translate everything into plain English (*"Main Water Tank"*, *"Plant Food Strength (EC)"*, *"Root Oxygen"*).

### 3. Clean 4-Part Layout
1. **Top Header Bar:**
   - Season Picker (`🌱 Alexandria Spring EXP.1`, `☀️ Alexandria Optimal EXP.2`, `🔥 Alexandria Summer EXP.3`).
   - Day & Time Pill (`Day 14 of 30 · 2:00 PM`) with playback controls (`Play`, `Pause`, `10x`, `+1 Day`).
   - `🤖 AI Autopilot: ACTIVE` status pill + a `Judge / Proof View` toggle (slides open a drawer comparing Noisy Sensor Readings vs. Hidden Physics Ground Truth and showing the 93% AASTMT Egypt dataset validation).
2. **4 Summary Health Cards (Top Overlay):**
   - **Crop Growth:** Lettuce weight (`g`), growth stage, and harvest progress.
   - **Water & Nutrients:** Tank level (`L`), Plant Food (`EC`), and Acidity (`pH`) — maintained automatically by the AI.
   - **Root Health & Oxygen:** Root-Zone Dissolved Oxygen (`mg/L`) and water flow (`L/min`).
   - **Greenhouse Climate:** Air Temp (`°C`), Humidity (`%`), and VPD comfort badge.
3. **Right Floating Card — "🤖 AI Brain & Safety Log" (320px width):**
   - A clean, friendly live timeline showing:
     - **AI Decisions:** e.g., *"🤖 AI topped up 4.2 L water & dosed 10 mL Nutrient A+B (EC was 1.42)"* with a green `"🛡️ PLC Safety Verified"` badge.
     - **AI Anomaly Detections (`/alerts`):** e.g., *"🚨 AI Detected Implied Pump Degradation (92% confidence): Tank oxygen is normal (7.9 mg/L) but gully root oxygen dropped to 3.1 mg/L!"*
4. **Bottom "Challenge the AI (Inject Fault)" Bar + Interactive 3D Viewport:**
   - Clicking ANY 3D object (`Water Pump`, `Air Bubbler`, `Water Tank`, `pH/EC Sensor`, `Greenhouse`) focuses the camera on it and lets you inspect its health or trigger a realistic fault on that specific component (`POST /api/v1/simulations/{id}/faults`):
     - `⚙️ Clog Water Pump (-65% Flow)`
     - `🫧 Cut Air Bubbler`
     - `📉 Drift pH Sensor (+0.8 Bias)`
     - `🌡️ Trigger Heatwave (+6°C)`
     - `💧 Puncture Tank Leak`
     - `✨ Clear All Faults`

### 4. Modular 3D Scene Architecture (Build Objects Separately Next)
Keep every 3D object in its own module:
- `scene/ReservoirRig.js` (Main Water Tank, Submersible Pump & Air Bubbles)
- `scene/NFTChannelBank.js` (Sloped White Hydroponic Gullies & Flowing Water Stream)
- `scene/BataviaCropInstancer.js` (Growing Batavia Lettuce Heads & Roots)
- `scene/DosingSkid.js` (Autonomous AI Dosing Bottles & Peristaltic Tubes)
- `scene/SensorProbeArray.js` (Clean Floating Sensor Pins & Probes)
- `scene/EnclosureStructure.js` (Greenhouse Frame, Sun/LED Lights & Gentle Airflow Lines)

Start by building the complete user-friendly UI shell, live API wiring to `http://localhost:8080`, built-in browser AI Autopilot loop (or external ML controller listener) that automatically doses and posts anomaly alerts when faults occur, and clean 3D placeholders for the 6 modules.
```

---

### Prompt 1 — Friendly 3D Water Tank, Pump & Bubbles (`ReservoirRig.js`)
```markdown
Now build `scene/ReservoirRig.js` (`res-1`, `pump-1`, `aer-1`) so it is visually clear and intuitive at a glance:
1. **Clear-View Water Tank (`res-1`):**
   - Frosted translucent white tank walls with easy-to-read volume lines (`25%`, `50%`, `75%`, `100%`) so the user can immediately see how full the tank is.
   - Animated, crystal-clear aqua water inside whose height smoothly rises when the AI refills it and lowers as plants drink water, with a gentle surface ripple.
2. **Submersible Water Pump & Pipe (`pump-1`):**
   - Clean dark-slate pump at the bottom of the tank with a clear supply pipe carrying water up to the lettuce gullies.
   - Show animated flowing water droplets/chevrons moving up the pipe at the current pump speed. When the user injects a Pump Clog fault (or when the AI flags a pump anomaly), pulse an amber/red warning halo around the pump with a floating badge: `"🚨 AI Alert: Pump Flow Degraded"`.
3. **Oxygen Bubbler (`aer-1`):**
   - Two air stones on the tank floor releasing a stream of rising white micro-bubbles that speed up or slow down with aeration health.
```

### Prompt 2 — Sloped Hydroponic Gullies & Visible Water Stream (`NFTChannelBank.js`)
```markdown
Now build `scene/NFTChannelBank.js` (`ch-1` .. `ch-N`):
1. **Clean White Hydroponic Channels:**
   - Smooth matte-white sloped NFT gullies resting on a clean brushed-aluminum table frame, with circular planting ports along the top and a return drain pipe pouring gently back into the main tank.
2. **Cutaway "X-Ray" Water & Oxygen View:**
   - Along the side of the gullies, include a subtle transparent cutaway window so the user can actually SEE the thin film of water flowing past the plant roots.
   - Color the flowing water stream naturally: bright oxygenated sky-blue at the inlet, smoothly shifting toward warm amber/red at the outlet when a pump failure slows the water down and roots consume all the oxygen (`c_do_ch_out_mg_l < 4.0`). This visually explains to the judges HOW the AI spots a pump failure just from the oxygen drop!
```

### Prompt 3 — Lifelike Growing Batavia Lettuce Plants (`BataviaCropInstancer.js`)
```markdown
Now build `scene/BataviaCropInstancer.js` so the plants are the hero of the screen:
1. **Lush, Leafy Batavia Rosettes:**
   - In every planting port, render a multi-layered Batavia lettuce plant sitting in a small net-cup with clay pebbles, plus white roots dipping into the water channel below.
2. **Visual Growth & Health Feedback:**
   - As the simulation advances from Day 0 to Day 30, smoothly grow the plants from tiny 3-leaf sprouts into full, ruffled, vibrant green lettuce heads (`200g`–`300g`).
   - Give instant visual feedback on plant health:
     - When healthy (`stress_factor > 0.85`): perky, vibrant emerald-green leaves.
     - When stressed (if a fault goes uncorrected): outer leaves visibly droop downward and tint slightly yellow at the edges, with a friendly floating pill above the canopy (`"💧 Low Root Oxygen"` or `"🌡️ Heat Stress"`).
```

### Prompt 4 — Autonomous AI Dosing Bottles & Smart Sensors (`DosingSkid.js` & `SensorProbeArray.js`)
```markdown
Now build `scene/DosingSkid.js`, `scene/SensorProbeArray.js`, and `scene/EnclosureStructure.js`:
1. **Autonomous AI Dosing Skid (`stock-a`, `stock-b`, `stock-acid`, `stock-base`):**
   - Place 4 clean, color-coded bottles beside the tank (`Nutrient A`, `Nutrient B`, `pH Down`, `pH Up`) connected by clear tubes to an automated peristaltic pump head labeled `"🤖 AI Auto-Doser"`.
   - The user does NOT click these to dose manually. Instead, whenever the AI Autopilot issues a `dose` command, automatically light up the active bottle, spin its peristaltic rotor, and animate glowing liquid droplets travelling through the tube into the tank with a floating callout (`"🤖 AI Dosing 15 mL pH Down"`).
2. **Clean Floating Sensor Badges (`sen-*`) & Greenhouse Frame (`enc-1`, `fans-1`):**
   - Attach neat floating pill badges to the tank and gullies showing live readings (`EC`, `pH`, `Tank DO` vs `Gully Outlet DO`). Clicking a sensor lets the user inject `Probe Drift` to test if the AI catches a lying sensor.
   - Frame the farm in a light, airy greenhouse arch with gently spinning circulation fans.
```

### Prompt 5 — Interactive 3D "Build / Layout Your Farm" Mode (`FarmBuilderMode.js`)
```markdown
Now build `scene/FarmBuilderMode.js` so the user can toggle into **"🛠️ Layout / Edit Farm Mode"** and visually design any NFT farm layout they want before (or between) simulations:

1. **Drag-and-Drop 3D Floor Placement + Auto-Routing Pipes:**
   - Let the user drag the **Main Water Tank (`res-1`)**, **AI Dosing Skid**, and **NFT Gully Table (`ch-1..N`)** anywhere on the 3D studio floor grid (or rotate them in `90°`/`45°` snaps), and dynamically regenerate the 3D PVC supply and return pipes using smooth Catmull-Rom / orthogonal pipe elbows so the plumbing always connects cleanly!
2. **Visual Parametric Sliders (Live 3D Resizing):**
   - When the user clicks a component in **Layout Mode**, show friendly visual sliders that resize the 3D geometry in real time:
     - **NFT Gullies:** Number of Channels (`+ Add Channel` / `- Remove`), Channel Length (`0.5m`–`15m`), Width (`0.05m`–`0.30m`), Slope Tilt (`0.5%`–`5%`), and Plants per Channel (`1`–`60`).
     - **Water Tank & Pump:** Tank Capacity (`20L`–`2000L`), Placement (`Indoors`, `Shaded`, `In Direct Sun`), and Pump Flow Rate (`L/min`).
     - **Greenhouse & Climate:** Switch between `Open Air`, `Shade Net`, `Greenhouse`, and `Indoor LED Rack`, and adjust Floor Area (`m²`) and Fan Placement (`Canopy Horizontal`, `Exhaust`, `Vertical`).
     - **Drag-and-Drop Sensors:** Let the user drag `pH`, `EC`, `DO`, and `Water Temp` sensors onto either the **Main Tank (`res-1`)** or **any NFT Gully (`ch-1`)**.
3. **Live Physics Validation (`POST /api/v1/farms/validate`):**
   - Every time the user adjusts the layout, call `POST /api/v1/farms/validate`.
   - If the layout breaks a real physical law (for example, `GEOMETRY_CONFLICT` if the gullies are wider than the greenhouse floor, or `HYDRAULIC_FILM_DEPTH_VIOLATION` if the pump flow overflows the 25mm gully depth), highlight the offending 3D part in coral-red with a friendly tooltip explaining how to fix it (e.g., *"⚠️ Gullies are larger than the greenhouse floor! Increase floor area to 4.5 m²"*).
   - When valid, show a green `"✅ Layout Physically Valid — Start Simulation"` button that saves the farm via `POST /api/v1/farms` and launches the 3D Digital Twin!
```


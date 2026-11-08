# Phase 1: Requirements Specification (`REQUIREMENTS.md`)

## 1. Project Overview
A configurable hydroponic digital twin ("virtual farm") for a recirculating **Nutrient Film Technique (NFT) lettuce (*Lactuca sativa* L.)** system, built for the **Sensor X Challenge (Egypt)** and designed as an open-source Go engineering showcase.

---

## 2. Actors & Trust Boundaries

| Actor | Role | Allowed Operations | Forbidden Operations |
| :--- | :--- | :--- | :--- |
| **Frontend / Operator** (Three.js + Demo User) | Designs farm JSON, controls simulation clock, injects demo faults, visualizes component alerts & sensor streams. | `POST /farms/validate`, `POST /farms`, `POST /simulations`, clock/step control, `POST .../faults`, `GET` readings/alerts/commands/ground-truth. | Sending actuation commands (`POST .../commands`) or raising ML alerts (`POST .../alerts`). |
| **ML Controller** (External Service) | Reads noisy sensor observations, diagnoses anomalies, raises component-tagged alerts, and issues actuation commands. | `GET .../readings`, `POST .../alerts` (with `HYDRO_ML_API_KEY`), `POST .../commands` (with `HYDRO_ML_API_KEY`, behind Go safety layer). | Bypassing the Go safety layer; reading hidden ground-truth state during live evaluation. |
| **End-User LLM** (via MCP Server) | Answers natural-language questions about the farm design, sensor readings, active alerts, and ML controller decisions. | Read-only MCP tools (`get_farm_spec`, `get_sensor_readings`, `get_alerts`, `get_ml_decisions`). | Any state mutation, fault injection, or actuation (enforced at Go compile time via a `ReadOnlyObserver` interface). |
| **Physics Engine** (`internal/physics`) | Pure Go black-box implementation of Modules 1–12 from `docs/physics/PHYSICS_SPEC.md`. | Advancing physical state by $\Delta t$ and projecting noisy sensor readings. | Direct I/O, network calls, global state, or unseeded randomness. |

---

## 3. Functional Requirements (MoSCoW Prioritized)

| ID | Priority | Requirement |
| :--- | :---: | :--- |
| **FR-01** | **MUST** | **Farm JSON Validation:** Validate structural schema and physics domain bounds (`PHYSICS_SPEC.md` Sec. 0.1 & Sec. 14.1), returning structured errors tagged with the offending `component_id` and JSON path. |
| **FR-02** | **MUST** | **12-Module Physics Engine:** Implement Modules 1–12 (`docs/physics/PHYSICS_SPEC.md`) in pure Go with `DECISIONS.md` defaults (`1A` two-state crop, `2A` Andriolo NFT salinity, `3A` analytical channel integral, `4A` dry-mass root respiration, `5A` hierarchical priors). |
| **FR-03** | **MUST** | **Noisy Sensor Observer Layer:** Emit readings only for sensors declared in the farm JSON, applying first-order probe lag, calibration drift, temperature cross-sensitivity, Gaussian noise, and dropouts (Module 11). Never leak hidden true state via `/readings`. |
| **FR-04** | **MUST** | **Dual-Mode Simulation Clock:** Support (a) an accelerated background ticker (`1x`, `60x`, `3600x`, pause/resume) for live polling and (b) synchronous deterministic fast-forwarding (`POST /simulations/{id}/advance` by $N$ steps) for ML training and demo jumps. |
| **FR-05** | **MUST** | **Physical Fault Injection:** Support all 6 physical fault perturbations (Module 12: pump degradation/stall, aeration loss, heat wave, probe drift, nutrient imbalance, reservoir orifice leak) via both pre-scheduled run timelines and live operator API triggers. |
| **FR-06** | **MUST** | **ML-Exclusive Actuation & Safety Interlock:** Authenticate ML requests via `HYDRO_ML_API_KEY`. Validate every dosing, refill, pump, aerator, and fan command against physical safety bounds (max dose volume per step, reservoir overflow limits, predicted pH/EC crash bounds, cooldown windows). Reject unsafe commands with `422` and persist both `accepted` and `rejected` commands in the audit log. |
| **FR-07** | **MUST** | **Component-Tagged Alerts:** Accept ML-generated alerts (`severity`, `component_id`, `code`, `message`) and expose them by `component_id` for Three.js visualization. |
| **FR-08** | **MUST** | **Read-Only MCP Server:** Expose MCP tools (`get_farm_spec`, `get_sensor_readings`, `get_alerts`, `get_ml_decisions`) wired strictly to a compile-time `ReadOnlyObserver` Go interface with zero actuation capability. |
| **FR-09** | **SHOULD** | **Ground-Truth Export Endpoint:** Provide an operator/training endpoint (`GET /simulations/{id}/ground-truth`) exposing true conserved variables ($V_{\text{res}}$, 10 ion concentrations $C_i$, dry/fresh biomass, active faults) for offline ML training labels and judge inspection. |
| **FR-10** | **SHOULD** | **Preset Demo Scenarios:** Ship ready-to-run JSON fixtures (valid baseline farm, invalid farm with component errors, leak vs. heatwave fault scenarios) for instant single-command reproducibility. |
| **FR-11** | **COULD** | ** Axial $M$-Segment Channel Mode:** Optional toggle for $M = N_{\text{pl,ch}}$ axial channel discretization under severe pump stall ($\eta_{\text{pump}} < 0.25$, `DECISIONS.md` Option 3B). |
| **FR-12** | **WON'T** | **Multi-Farm Concurrent Simulation Workers:** Only 1 active simulation runs in memory at a time (historical runs and multiple farm specs are stored in Postgres). |

---

## 4. Non-Functional Requirements

| Category | Priority | Target / Specification |
| :--- | :---: | :--- |
| **Performance & Speed** | **MUST** | Full 30-day simulation at $\Delta t = 5\text{ min}$ ($8{,}640$ steps) completes in **$< 50\text{ ms}$** in-memory CPU time. Live polling (`GET .../readings`) responds in **$< 5\text{ ms}$ p99** from the hot in-memory ring buffer. |
| **Determinism & Reproducibility** | **MUST** | Identical `{farm_json, seed, scheduled_faults, commands}` produces bit-identical physical trajectories and sensor noise across runs via an injected `Clock` and per-simulation seeded `math/rand/v2.Rand`. |
| **Reliability & Backpressure** | **MUST** | Single owner goroutine per simulation state; zero shared mutable state without synchronization; `errgroup`-managed lifecycle with graceful `SIGINT`/`SIGTERM` shutdown. High-frequency readings flush to Postgres via a bounded channel and `pgx.CopyFrom` batch writer (live ticker mode drops oldest unflushed telemetry batch with a logged warning if DB stalls; batch `/advance` mode flushes deterministically with context timeout). |
| **Security** | **MUST** | Constant-time bearer token check (`crypto/subtle.ConstantTimeCompare`) for `HYDRO_ML_API_KEY` on `/commands` and `/alerts`. Compile-time interface segregation prevents MCP from accessing state-mutating methods. |
| **Observability** | **MUST** | Structured logging via standard library `log/slog` (with `sim_id`, `component_id`, `request_id` context attributes) plus `/healthz` (liveness) and `/readyz` (Postgres connectivity ping). |
| **Testability** | **MUST** | Table-driven unit tests, `go test -race`, `uber-go/goleak` goroutine leak verification on lifecycle packages, golden physics tests matching `PHYSICS_SPEC.md` Section 15 (mass conservation, limiting cases, $1\times$ vs. $2\times$ scale invariance, literature tables), and HTTP API contract tests. |
| **Open-Source Readiness** | **MUST** | Honest `README.md` linking `LIMITATIONS.md` and `GAP_REGISTER.md`, `LICENSE` (MIT), `docker-compose.yml`, `Makefile`, and GitHub Actions CI (`go vet`, `golangci-lint`, `go test -race`, build). |

---

## 5. Constraints & Risks

### Constraints
1. **48-Hour Delivery Budget:** Every architectural choice must favor standard-library simplicity and vertical-slice testability over infrastructure bloat.
2. **Epistemic Honesty:** The physics engine is mechanistic and literature-anchored (`PHYSICS_SPEC.md`) but uncalibrated to site-specific sensor hardware (`GAP_REGISTER.md`); documentation and API metadata must state allowed vs. disallowed claims (`LIMITATIONS.md`).

### Key Risks & Mitigations
| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| **Stiff pH speciation or low-volume ODE instability** | NaN/Inf in pH or negative concentrations during extreme faults. | Solve Eq. (4.3) proton electroneutrality via bracketed bisection/Newton-Raphson on $\text{pH} \in [2.0, 11.0]$ (strictly monotone $F([\text{H}^+])$ guarantees a unique root) and clamp conserved masses at $\ge 0$. |
| **Postgres write bottleneck during 30-day fast-forward** | Fast-forward endpoint times out waiting on 70,000 individual `INSERT`s. | Buffer readings and bulk-insert via `pgx.CopyFrom` (Postgres wire-protocol `COPY`), keeping hot-window reads in memory. |
| **Runaway ML actuation loop** | ML model floods dosing endpoints or commands lethal acid doses. | Enforce deterministic safety interlocks (per-command dose caps, reservoir capacity checks, cooldown ticks, and predicted pH/EC range guards) before applying any command to physics state. |

---

## 6. Acceptance Criteria: The 5-Act Competition Demo Script

Our end-to-end automated integration test (`TestAcceptanceDemoFlow`) and live pitch must execute the following 5 acts cleanly:

1. **Act 1 — Component-Tagged Validation Failure:**
   - `POST /api/v1/farms/validate` with a broken farm JSON (`channel-2` slope $S_0 = 0.09 > 0.05$, `reservoir-1` invalid geometry).
   - **Expected:** `422 Unprocessable Entity` containing structured validation errors referencing `component_id: "channel-2"` and `component_id: "reservoir-1"`.
2. **Act 2 — Valid Farm Creation & Deterministic Fast-Forward:**
   - `POST /api/v1/farms` with the corrected farm JSON $\to$ `201 Created`.
   - `POST /api/v1/simulations` with `seed: 42` $\to$ `201 Created`.
   - `POST /api/v1/simulations/{id}/advance` by 15 simulated days ($4{,}320$ steps at $\Delta t = 5\text{ min}$) $\to$ completes in `< 50 ms`, returning noisy sensor readings (`EC`, `pH`, `DO`, `T_w`, `V_res`, `RGB`) tagged by sensor and target `component_id`.
3. **Act 3 — Coupled Physical Fault Disambiguation (Leak vs. Evapotranspiration):**
   - `POST /api/v1/simulations/{id}/faults` injects a physical orifice leak on `reservoir-1` (Module 12.1.6).
   - Advance 6 simulated hours $\to$ `/readings` shows `reservoir-1` water volume dropping while `EC` does **not** concentrate ($\dot{V}_{\text{res}} < 0, \dot{\text{EC}} \le 0$), distinguishing a pipe/tank leak from canopy transpiration.
4. **Act 4 — ML Alert & Safety Layer Interlock:**
   - Unauthenticated `POST .../commands` returns `401/403`.
   - Authenticated ML (`Bearer <HYDRO_ML_API_KEY>`) posts a critical alert on `reservoir-1` (`POST .../alerts` $\to$ `201 Created`, visible to Three.js by `component_id`).
   - Authenticated ML sends an *unsafe* acid dose command (exceeding max single-dose normality/volume bound) $\to$ Go safety layer rejects it with `422` and records status `rejected_safety` in Postgres.
   - Authenticated ML sends a *safe* refill + balanced nutrient dose command $\to$ accepted (`201 Created`), stabilizing reservoir volume and EC over subsequent steps.
5. **Act 5 — Read-Only MCP Inspection:**
   - MCP client calls `get_farm_spec`, `get_sensor_readings`, `get_alerts`, and `get_ml_decisions`.
   - **Expected:** Returns the full incident timeline (sensor drop, `reservoir-1` alert, rejected unsafe command, accepted safe command) while exposing zero actuation tools.

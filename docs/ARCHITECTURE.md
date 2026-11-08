# Phase 3: System Architecture (`ARCHITECTURE.md`)

## 1. High-Level Topology & Boundaries

```mermaid
flowchart LR
    subgraph Actors
        FE["Three.js Frontend / Operator"]
        ML["ML Controller (Bearer Key)"]
        LLM["End-User LLM (MCP Client)"]
    end

    subgraph GoBackend["Go Digital Twin Backend (cmd/hydro)"]
        API["REST API (net/http ServeMux)"]
        MCP["Read-Only MCP Server (internal/mcp)"]
        VAL["Farm Validator (internal/validate)"]
        SAFE["PLC Safety Guardian (internal/safety)"]
        SIM["Simulation Actor Loop (internal/sim)"]
        RING["Hot Ring Buffer & Atomic Snapshot"]
        PHYS["12-Module Physics Engine (internal/physics)"]
        FLUSH["Bounded Batch Writer (errgroup)"]
    end

    PG[("PostgreSQL 16 (JSONB + Time-Series)")]

    FE -->|"POST /farms, /simulations, /faults, GET /readings"| API
    ML -->|"GET /readings, POST /alerts, POST /commands"| API
    LLM -->|"JSON-RPC (stdio or POST /mcp)"| MCP

    API --> VAL
    API -->|"Mutations via cmdCh"| SIM
    API -->|"Lock-free reads"| RING
    MCP -->|"Compile-time ReadOnlyObserver"| RING
    MCP -->|"Historical read-only queries"| PG

    SIM --> SAFE
    SIM -->|"Pure Step(cfg, state, dt, rng)"| PHYS
    SIM -->|"Publishes *Snapshot"| RING
    SIM -->|"Bounded batchCh"| FLUSH
    FLUSH -->|"pgx.CopyFrom"| PG
    API -->|"Sync CRUD (farms, alerts, commands)"| PG
```

---

## 2. Package Layout & Consumer-Side Interfaces

Every package has a single responsibility and defines the narrow interfaces it consumes:

```text
hydro/
├── cmd/
│   ├── hydro/main.go          # Main HTTP + MCP server entrypoint, errgroup lifecycle, graceful shutdown
│   └── hydro-mcp/main.go      # Optional standalone stdio MCP proxy/runner for Claude Desktop / Inspector
├── internal/
│   ├── config/                # Env var parsing into immutable Config struct
│   ├── domain/                # Pure domain types: FarmSpec, SensorReading, Alert, Command, Fault
│   ├── validate/              # Structural + coupled physics-range validator (returns []ValidationIssue)
│   ├── physics/               # Pure Go implementation of Modules 1-12 (PHYSICS_SPEC.md)
│   ├── safety/                # 5-rule deterministic PLC safety guardian (including pH/EC dry-run)
│   ├── sim/                   # Single-owner actor goroutine, Clock interface, ring buffer, DB batch channel
│   ├── store/                 # PostgreSQL pgxpool repositories, embedded migrations, CopyFrom batch writer
│   ├── api/                   # Go 1.22+ net/http handlers, constant-time bearer auth, logging middleware
│   └── mcp/                   # Read-only MCP JSON-RPC 2.0 server wired strictly to ReadOnlyObserver
├── schema/
│   └── farm.schema.json       # JSON Schema (2020-12) for FarmSpec
├── docs/
│   ├── REQUIREMENTS.md
│   ├── ARCHITECTURE.md
│   ├── adr/                   # Architecture Decision Records
│   └── physics/               # PHYSICS_SPEC.md, PARAMETER_REGISTRY.md, LIMITATIONS.md, GAP_REGISTER.md
├── openapi.yaml               # OpenAPI 3.1 contract for REST endpoints
├── docker-compose.yml         # Postgres 16 + hydro backend
├── Makefile                   # Build, test -race, lint, demo targets
└── .github/workflows/ci.yml   # vet, golangci-lint, go test -race, build
```

---

## 3. Concurrency Model & Lifecycle Ownership

1. **Single-Owner Actor Loop (`internal/sim`):**
   - A single goroutine (`Runner.Run(ctx)`) owns the mutable `physics.State`, the seeded `math/rand/v2.Rand`, active faults, and the `Clock` ticker.
   - All state mutations (`Advance`, `SubmitCommand`, `InjectFault`, `SetClock`) are sent as typed messages carrying a 1-buffered reply channel (`reply chan<- Result`) over `cmdCh` using `select` with `ctx.Done()`.
   - Zero mutexes guard `physics.State` or `rng` because no other goroutine ever touches them.
2. **Lock-Free Read Snapshots (`atomic.Pointer[Snapshot]` + Ring Buffer):**
   - After each tick (or batch advance), the actor goroutine publishes an immutable `*Snapshot` via `sync/atomic.Pointer` and appends the tick's noisy `[]SensorReading` to a fixed-capacity ring buffer (last `1,000` ticks) guarded by a narrow `sync.RWMutex`.
   - `GET /readings` and MCP tools read from memory in `< 1 ms` without blocking the physics loop.
3. **Bounded Telemetry Persistence & Backpressure:**
   - The actor loop pushes reading batches to `flushCh` (`chan []SensorReading`, capacity `128`).
   - A dedicated writer goroutine (managed by `golang.org/x/sync/errgroup`) flushes batches to Postgres via `pgx.CopyFrom`.
   - **Backpressure policy:** In live ticker mode, if `flushCh` is full, the oldest unflushed telemetry batch is dropped, an atomic counter `dropped_batches` is incremented, and a `slog.Warn` event is emitted so the simulation clock never stalls. In synchronous `/advance` (training/demo) mode, batches flush deterministically with the request context timeout.
4. **Graceful Shutdown:**
   - `signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)` cancels the root `errgroup` context:
     1. `http.Server.Shutdown(shutdownCtx)` stops accepting new requests.
     2. `sim.Runner` stops its `Ticker`, closes `flushCh` (sender-closes rule), and exits.
     3. `store.BatchWriter` drains remaining items from `flushCh` to Postgres and exits.

---

## 4. The 5 Deterministic Safety Layer Rules (`internal/safety`)

Every `POST /api/v1/simulations/{id}/commands` request from the ML controller is evaluated against 5 rules before mutating state:
1. **Sanity & Finite Bounds:** Volume/throttle values must be finite (`!math.IsNaN`, `!math.IsInf`), non-negative, and throttles $\in [0, 1]$.
2. **Reservoir Overflow Interlock (Module 2):** $V_{\text{res}}(t) + V_{\text{refill}} + \sum_k V_{\text{dose},k} \le V_{\text{res,max}}$.
3. **Single-Dose Shock Cap:** A single chemical command cannot shift reservoir alkalinity $[\text{Alk}]$ by $> 0.50\text{ meq L}^{-1}$ or raise $\text{EC}_{25}$ by $> 0.40\text{ dS m}^{-1}$.
4. **Hydraulic Mixing Cooldown (Section 13):** Chemical dosing commands require $\Delta t_{\text{since\_last\_dose}} \ge \max(\Delta t, \, 0.5 \, \tau_{\text{loop}})$ where $\tau_{\text{loop}} = V_{\text{res}} / Q_{\text{pump}}$.
5. **Pre-Dose Equilibrium Speciation Dry-Run (Modules 3 & 4):** Runs the pure [Eq. 3.3](file:///home/abdelbaky/hydro/docs/physics/PHYSICS_SPEC.md#L232) EC and [Eq. 4.3](file:///home/abdelbaky/hydro/docs/physics/PHYSICS_SPEC.md#L288) electroneutrality pH solver on the hypothetical post-dose concentrations; rejects the command if predicted $\text{pH} \notin [4.5, 7.8]$ or $\text{EC}_{25} > 4.0\text{ dS m}^{-1}$.

Both `accepted` and `rejected_safety` commands are persisted in the `commands` table for MCP and operator auditing.

---

## 5. PostgreSQL Schema (`internal/store/migrations/001_init.sql`)

```sql
CREATE TABLE IF NOT EXISTS farms (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    schema_version  TEXT NOT NULL,
    spec            JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS simulations (
    id              TEXT PRIMARY KEY,
    farm_id         TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    seed            BIGINT NOT NULL,
    step_seconds    INTEGER NOT NULL,
    status          TEXT NOT NULL, -- 'running', 'paused', 'stopped'
    sim_time_sec    DOUBLE PRECISION NOT NULL DEFAULT 0,
    active_faults   JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensor_readings (
    simulation_id   TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
    tick_index      BIGINT NOT NULL,
    sim_time_sec    DOUBLE PRECISION NOT NULL,
    sensor_id       TEXT NOT NULL,
    component_id    TEXT NOT NULL,
    kind            TEXT NOT NULL,
    value           DOUBLE PRECISION NULL, -- NULL represents Module 11 sensor dropout
    unit            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings_sim_time ON sensor_readings (simulation_id, sim_time_sec DESC);
CREATE INDEX IF NOT EXISTS idx_readings_sim_comp ON sensor_readings (simulation_id, component_id, sim_time_sec DESC);

CREATE TABLE IF NOT EXISTS alerts (
    id              TEXT PRIMARY KEY,
    simulation_id   TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
    sim_time_sec    DOUBLE PRECISION NOT NULL,
    component_id    TEXT NOT NULL,
    severity        TEXT NOT NULL, -- 'info', 'warning', 'critical'
    code            TEXT NOT NULL,
    message         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_sim_comp ON alerts (simulation_id, component_id, sim_time_sec DESC);

CREATE TABLE IF NOT EXISTS commands (
    id                   TEXT PRIMARY KEY,
    simulation_id        TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
    sim_time_sec         DOUBLE PRECISION NOT NULL,
    target_component_id  TEXT NOT NULL,
    action               TEXT NOT NULL,
    payload              JSONB NOT NULL,
    reason               TEXT NOT NULL,
    status               TEXT NOT NULL CHECK (status IN ('accepted', 'rejected_safety')),
    rejection_code       TEXT NULL,
    rejection_message    TEXT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commands_sim_time ON commands (simulation_id, sim_time_sec DESC);
```

---

## 6. Configuration, Logging, Docker Compose, Makefile & CI

- **Environment Variables:**
  - `HYDRO_HTTP_ADDR` (default `":8080"`)
  - `HYDRO_DATABASE_URL` (default `"postgres://hydro:hydro@localhost:5432/hydro?sslmode=disable"`)
  - `HYDRO_ML_API_KEY` (default `"dev-ml-secret-key"` in local compose, required non-empty)
  - `HYDRO_LOG_LEVEL` (`"debug"`, `"info"`, `"warn"`, `"error"`)
- **Logging:** `log/slog` JSON handler with structured attributes (`sim_id`, `component_id`, `method`, `path`, `status`, `duration_ms`).
- **Docker Compose:** `postgres:16-alpine` (with `pg_isready` healthcheck) + multi-stage `Dockerfile` (`golang:1.23-alpine` builder $\to$ `alpine:3.20` non-root runtime).
- **Makefile & CI:** `make vet`, `make lint`, `make test` (`go test -race ./...`), `make build`, `make demo`.

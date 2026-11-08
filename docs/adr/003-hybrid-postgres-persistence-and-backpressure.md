# ADR 003: Hybrid Relational/JSONB PostgreSQL Schema & Bounded `CopyFrom` Telemetry Writer

## Status
Accepted

## Context
A 30-day fast-forward generates $\sim 70{,}000$ sensor readings in $< 50\text{ ms}$. Executing $70{,}000$ sequential SQL `INSERT` statements inside the physics tick loop would stall simulation speed by $200\times$, while spawning unbounded goroutines per tick would leak goroutines and exhaust database connections.

## Decision
1. **Hybrid Schema:** Store immutable hierarchical `FarmSpec` and command payloads as `JSONB`, while storing `sensor_readings`, `alerts`, and `commands` in typed relational tables indexed by `(simulation_id, sim_time_sec DESC)` and `(simulation_id, component_id, sim_time_sec DESC)`.
2. **Bounded Batch Writer (`pgx.CopyFrom`):** Send reading slices from the simulation actor over a bounded channel (`cap = 128`) to a single `errgroup`-managed writer goroutine that streams rows into Postgres using the `COPY` protocol (`pgx.CopyFrom`).
3. **Explicit Backpressure Policy:** In live ticker mode, if Postgres stalls and the bounded channel fills, drop the oldest unflushed telemetry batch and log a `slog.Warn` event so the real-time simulation loop never freezes. In synchronous `/advance` batch mode, flush deterministically with request context timeout.

## Consequences
- **Positive:** Sub-millisecond live reads from the hot ring buffer; $70{,}000$ rows persist in milliseconds via `COPY`; bounded memory and goroutine count under arbitrary DB latency.
- **Negative:** Live ticker mode trades telemetry durability under severe DB outage for simulation clock liveness (observable via `dropped_batches` counter and structured logs).

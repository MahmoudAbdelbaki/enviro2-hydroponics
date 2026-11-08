# ADR 001: Pure Go Physics Engine & Hybrid Actor/Atomic Concurrency

## Status
Accepted

## Context
A 30-day NFT lettuce cycle at $\Delta t = 5\text{ min}$ requires $8{,}640$ coupled ODE steps across 12 modules (`docs/physics/PHYSICS_SPEC.md`). Simultaneously, Three.js, the ML service, and the MCP server poll sensor telemetry concurrently while HTTP handlers inject faults, actuation commands, and clock changes.

## Decision
1. **Pure Go Physics Engine (`internal/physics`):** Implement Modules 1–12 directly in pure Go behind a consumer interface using fixed-size stack arrays (`[10]float64` for ions) and an injected `*rand/v2.Rand`.
2. **Single-Owner Actor Loop for Mutations (`internal/sim`):** A single goroutine owns `physics.State`, `rand/v2.Rand`, and the `Clock` ticker, multiplexing commands via `select` over `cmdCh`, `ticker.C`, and `ctx.Done()`.
3. **Lock-Free Read Snapshots:** After each tick, the actor publishes an immutable `*Snapshot` via `sync/atomic.Pointer` and appends to a bounded ring buffer guarded by `sync.RWMutex`.

## Consequences
- **Positive:** 30-day simulation runs in $< 50\text{ ms}$ (zero cross-language IPC overhead); zero mutex contention on `physics.State`; `GET /readings` never blocks behind fast-forward batches; passes `go test -race` and `goleak` deterministically.
- **Negative:** Requires disciplining `Snapshot` structs to be strictly immutable after publication.

# ADR 004: Stdlib-First Dependency Policy

## Status
Accepted

## Context
As an open-source Go showcase built under a 48-hour constraint, every third-party dependency increases supply-chain surface area, compile time, and framework lock-in. Go 1.22+ includes pattern-matching `net/http.ServeMux`, structured `log/slog`, deterministic `math/rand/v2`, and `embed.FS`.

## Decision
Limit `go.mod` to **3 direct external modules** and use the Go standard library for everything else:

| Capability | Chosen Package | Rejected Alternatives & Justification |
| :--- | :--- | :--- |
| **PostgreSQL Pool & Bulk Copy** | `github.com/jackc/pgx/v5` | **Rejected `lib/pq` & `gorm`:** `lib/pq` is in maintenance mode and `database/sql` does not expose Postgres's binary `CopyFrom` protocol required to stream 70,000 time-series readings in milliseconds; `gorm` adds reflection overhead and hides SQL. |
| **Goroutine Lifecycle Group** | `golang.org/x/sync/errgroup` | **Rejected raw `sync.WaitGroup`:** `errgroup.WithContext` automatically cancels sibling workers on first fatal error and propagates structured shutdown errors. |
| **Goroutine Leak Detection** | `go.uber.org/goleak` *(test-only)* | **Rejected `runtime.NumGoroutine()` polling:** `goleak.VerifyNone(t)` deterministically inspects stack traces to catch leaked tickers or blocked channels. |
| **HTTP Routing** | Stdlib `net/http.ServeMux` | **Rejected `gin`, `echo`, `chi`:** Go 1.22+ `ServeMux` supports `"POST /api/v1/simulations/{id}/commands"` and `r.PathValue("id")` natively. |
| **Logging** | Stdlib `log/slog` | **Rejected `zap`, `zerolog`:** `slog` provides structured JSON logging in the standard library. |
| **Seeded RNG** | Stdlib `math/rand/v2` | **Rejected global `math/rand`:** `rand/v2.NewPCG` provides isolated, deterministic per-simulation streams. |
| **Validation** | Stdlib pure Go (`internal/validate`) | **Rejected `go-playground/validator`:** Struct tags cannot evaluate coupled Manning hydraulic equations or attach sibling `component_id`s. |
| **MCP JSON-RPC 2.0** | Stdlib `encoding/json` (`internal/mcp`) | **Rejected unstable third-party MCP SDKs:** Implementing the 4 read-only MCP methods directly in stdlib keeps `ReadOnlyObserver` compile-time isolation air-tight. |

## Consequences
- **Positive:** Ultra-clean `go.mod`, fast builds, zero framework magic, idiomatic Go 1.22+ code.
- **Negative:** Requires writing ~30 lines of small helpers (e.g., JSON response writer, RFC 4122 UUIDv4 via `crypto/rand`) instead of importing convenience micro-libraries.

# ADR 002: Deterministic PLC Safety Interlock & Compile-Time MCP Read-Only Isolation

## Status
Accepted

## Context
The ML controller is the only actor permitted to send actuation commands (acid/base/nutrient dosing, water refill, pump/aerator/fan throttles). However, ML models can be misled by drifted sensors (Module 11) or emit out-of-distribution doses. Meanwhile, the MCP server exposes farm telemetry to end-user LLMs and must never actuate under any circumstances (including prompt injection).

## Decision
1. **Constant-Time Bearer Auth (`HYDRO_ML_API_KEY`):** Enforce `crypto/subtle.ConstantTimeCompare` middleware on `POST /alerts` and `POST /commands`.
2. **5-Rule Deterministic Safety Guardian (`internal/safety`):** Validate every ML command for (1) finite/non-negative bounds, (2) reservoir overflow ($V_{\text{res}} + V_{\text{add}} \le V_{\text{res,max}}$), (3) single-shot alkalinity/EC shock caps, (4) hydraulic mixing cooldown ($\ge 0.5\tau_{\text{loop}}$), and (5) pre-dose equilibrium pH/EC speciation dry-run ($\text{pH} \in [4.5, 7.8], \text{EC}_{25} \le 4.0\text{ dS m}^{-1}$). Persist both `accepted` and `rejected_safety` commands in Postgres.
3. **Compile-Time MCP Isolation (`internal/mcp`):** Wire the MCP server exclusively to a narrow `ReadOnlyObserver` Go interface that contains zero mutation or actuation methods.

## Consequences
- **Positive:** Prevents acid toxicity crashes, tank overflows, and mixing-lag double-dosing; guarantees at compile time that MCP cannot trigger actuation.
- **Negative:** Requires logging `rejected_safety` decisions clearly so ML developers can inspect why a command was blocked.

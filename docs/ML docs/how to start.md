# How to Start: Digital Twin & ML Agent (Docker Guide)

This guide explains how to build, run, and monitor the entire autonomous hydroponic digital twin ecosystem using Docker Compose.

---

## 1. System Architecture

Docker Compose manages three connected services:

| Service | Technology | Port | Description |
|---------|------------|------|-------------|
| **`postgres`** | PostgreSQL 16 Alpine | `5432` | Stores farms, simulations, sensor telemetry, ML alerts, and actuation command ledgers. |
| **`hydro`** | Go 1.22+ Core Backend | `8080` | Digital twin physics simulation engine, REST API, PLC safety guardian, and Web Dashboard UI. |
| **`hydro-agent`** | Python 3.11 Alpine | Internal | Autonomous ML agent running Models 1–6 (microclimate, DO, chemistry, crop, FDI diagnostics, and fertigation controller). |

---

## 2. Quick Start (Build & Run)

### Step 1: Start Docker Desktop
Make sure **Docker Desktop** is open and running on your system.

### Step 2: Build and Launch All Services
Run this command from the repository root:

```bash
docker compose up -d --build
```

> **Flags explained:**
> - `-d`: Runs containers in the background (detached mode).
> - `--build`: Rebuilds images to ensure latest code and tests are included.

### Step 3: Verify Running Services
Check that all 3 services are running and healthy:

```bash
docker compose ps
```

You should see:
```text
NAME                                     IMAGE                                  STATUS
enviro2-hydroponics-main-postgres-1      postgres:16-alpine                     Up (healthy)
enviro2-hydroponics-main-hydro-1         enviro2-hydroponics-main-hydro         Up
enviro2-hydroponics-main-hydro-agent-1   enviro2-hydroponics-main-hydro-agent   Up
```

---

## 3. How to View Logs

### Stream ML Agent Logs in Real-Time (Recommended)
To watch the ML Diagnostic & Control Agent ingest telemetry, evaluate Models 1–6, and issue fertigation commands:

```bash
docker compose logs -f hydro-agent
```

### Stream Go Core Backend Logs
To inspect simulation stepping, sensor generation, and PLC Safety Guardian validations:

```bash
docker compose logs -f hydro
```

### Stream All Services Combined
```bash
docker compose logs -f
```

### View Recent Log History (Last 50 Lines)
```bash
docker compose logs --tail=50 hydro-agent
```

---

## 4. Expected Log Output

When `hydro-agent` is successfully running, you will see output like this:

```text
hydro-agent-1  | [INFO] hydro_agent: Connecting to Go Core backend at http://hydro:8080...
hydro-agent-1  | [INFO] hydro_agent: Go Core backend is healthy: {'status': 'ok'}
hydro-agent-1  | [INFO] hydro_agent: Auto-attached to existing simulation ba3bf746-29d5-4f4e-a783-4dfc252bf1fe (mode: running, tick: 2045)
hydro-agent-1  | [INFO] hydro_agent: Hydro Autonomous Agent active on simulation 'ba3bf746-29d5-4f4e-a783-4dfc252bf1fe'...
hydro-agent-1  | [WARNING] hydro_agent.agent: Dispatched Alert [PH_PROBE_DRIFT_SUSPECTED]: Observed pH (5.54) diverges from speciation expectation (6.21) by |r_pH| = 0.67.
hydro-agent-1  | [INFO] hydro_agent.agent: Executed Fertigation Command: Replenish tank to 100.0L setpoint, adjust EC to 2.00 dS/m, and counter nitrate alkalinization.
hydro-agent-1  | [INFO] hydro_agent: Step completed at sim_time=613500.0s | Status=DEGRADED | Faults=['PH_PROBE_DRIFT_SUSPECTED'] | Command=Replenish tank to 100.0L setpoint...
```

---

## 5. Web Dashboard UI & Endpoints

Open your browser to:

- **Interactive Control Center:** [http://localhost:8080](http://localhost:8080)
  - Live charts for DO, EC, pH, VPD, Water Flow, and Water Level.
  - **Alerts & Detections** panel showing Model 5 FDI findings in real-time.
  - **AI Autopilot & PLC Safety Ledger** displaying Model 6 fertigation commands (APPLIED / REJECTED).
- **Backend Healthcheck:** [http://localhost:8080/healthz](http://localhost:8080/healthz)
- **Active Simulations List:** [http://localhost:8080/api/v1/simulations](http://localhost:8080/api/v1/simulations)

---

## 6. Restarting & Rebuilding

### Restart Only the ML Agent
If you want to restart the agent without touching the database or backend:
```bash
docker compose restart hydro-agent
```

### Rebuild After Code Edits
If you modify Python code inside `hydro_agent/`:
```bash
docker compose build hydro-agent
docker compose up -d hydro-agent
```

### Stop All Services
```bash
docker compose down
```

### Complete Reset (Wipe Database Volumes)
To reset PostgreSQL and start fresh:
```bash
docker compose down -v
docker compose up -d --build
```

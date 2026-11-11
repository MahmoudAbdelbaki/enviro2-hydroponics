# Hydro Agent: Autonomous ML Diagnostic & Control Suite

`hydro_agent` is the physics-informed digital twin observer, fault detection and isolation (FDI) engine, and safe fertigation controller for the recirculating NFT lettuce digital twin.

---

## 1. Directory Organization

```text
hydro_agent/
├── __init__.py                 # Package root
├── agent.py                    # Master orchestrator combining Models 1–6 with TwinClient
├── main.py                     # Production daemon entry point with auto-discovery & polling loop
├── ml_edits.md                 # Detailed release engineering log and REST flow endpoint matrix
├── README.md                   # Architecture, model registry, and execution guide
├── client/
│   ├── __init__.py
│   ├── ingestion.py            # Telemetry Ingestion Guard (Forward-fill, stall detection, dynamic ID)
│   └── twin_client.py          # Go Core REST API client (:8080) with ML bearer auth
├── models/
│   ├── __init__.py             # Unified exports for all 6 models and dataclass schemas
│   ├── model1_microclimate.py  # Enclosure microclimate thermal-vapor engine & NTU gully heat exchanger (RK4)
│   ├── model2_oxygen.py        # Dissolved oxygen & channel hydraulics soft-sensor (Benson-Krause / Manning)
│   ├── model3_chemistry.py     # 10-ion speciation, Kohlrausch-Onsager EC, Davies activity & Newton-Raphson pH
│   ├── model4_crop.py          # Stanghellini canopy transpiration & Van Henten 2-state crop biomass ODEs
│   ├── model5_diagnostics.py   # Multi-fault residual FDI engine & component-tagged alert dispatch
│   └── model6_controller.py    # Closed-loop fertigation controller protected by 5 deterministic PLC interlocks
└── tests/
    ├── __init__.py
    ├── test_ingestion.py       # Telemetry cleaning, forward-fill & stall detection tests (3 tests)
    ├── test_model1.py          # Model 1 microclimate & NTU tests (3 tests)
    ├── test_model2.py          # Model 2 USGS DO benchmarks & Manning hydraulics (12 tests)
    ├── test_model3.py          # Model 3 EC, pH speciation & buffer capacity (3 tests)
    ├── test_model4.py          # Model 4 transpiration & multi-stress growth (3 tests)
    ├── test_model5.py          # Model 5 FDI decoupling & leak/pump diagnosis (3 tests)
    ├── test_model6.py          # Model 6 dosing math & 5 PLC interlock rules (3 tests)
    └── test_agent_integration.py # Full autonomous loop integration tests (2 tests)
```

---

## 2. Models Overview

| Model | Primary Module | Scientific Physics Foundation | Key Outputs |
|---|---|---|---|
| **Model 1** | Microclimate & Thermal | Sensible heat balance, Magnus-Tetens psychrometrics, NTU heat exchanger | $T_{\text{air}}, \text{VPD}, T_{\text{ch,out}}$ |
| **Model 2** | DO & Hydraulics | Benson & Krause (1984) DO saturation, Manning open-channel hydraulics, Chun-Takakura (1994) root respiration | $C_{\text{DO,sat}}, h_{\text{ch}}, v_{\text{ch}}, C_{\text{DO,out}}$ |
| **Model 3** | Solution Chemistry | 10-ion molar balances, Kohlrausch-Onsager conductivity, Newton-Raphson electroneutrality pH solver, Van Slyke buffer capacity | $\text{EC}_{25}, \text{pH}, \beta_{\text{buf}}, \text{precipitation}$ |
| **Model 4** | Transpiration & Crop | Stanghellini combination transpiration, Van Henten 2-state biomass dry matter ODEs, Andriolo osmotic fresh weight hinge | $E_{\text{canopy}}, X_{\text{dry}}, Y_{\text{fresh,shoot}}, \Phi_{\text{stress}}$ |
| **Model 5** | Diagnostics (FDI) | Physics-guided innovation residuals ($r_s = \|y_{\text{obs}} - \hat{x}_{\text{twin}}\|$) with cross-state decoupling rules | Active faults, `DiagnosticAlert` dispatch |
| **Model 6** | Safety Controller | Closed-loop replenishment, 50/50 salt addition, buffer-capacity acid dosing, guarded by 5 deterministic zero-bypass PLC interlocks | `ActuationCommand` submitted to Go Core |

---

## 3. Configuration & Environment Variables

| Variable | Default Value | Description |
|---|---|---|
| `HYDRO_TWIN_URL` | `http://localhost:8080` | URL of the Go Core backend API (use `http://hydro:8080` in Docker). |
| `HYDRO_ML_API_KEY`| `sensor-x-dev-ml-key` | Bearer authentication key required for `/alerts` and `/commands`. |
| `HYDRO_SIM_ID` | `""` (auto-discover) | Target simulation UUID. If empty, the agent auto-attaches to the active running simulation. |
| `HYDRO_LOG_LEVEL` | `info` | Python logging level (`debug`, `info`, `warning`, `error`). |

---

## 4. Running the Test Suite

Run all 32 unit and integration tests (executes in $< 0.05$ seconds):

```bash
python -m unittest discover -s hydro_agent -p "test_*.py" -v
```

---

## 5. Running the Agent Standalone

To run the agent locally against an active Go Core backend:

```bash
# Continuous polling loop (default 5s interval)
python -m hydro_agent.main

# Single step evaluation
python -m hydro_agent.main --single-step

# Automated fault injection & closed-loop control demo scenario
python -m hydro_agent.main --demo
```


# End-to-End System Workflow, Payload Lifecycle & Architecture

**Document Version:** 1.0.0  
**Target Architecture:** Go Hydro Twin Core (`:8080`) $\longleftrightarrow$ Python ML Diagnostic & Control Agent  
**Operational Pattern:** Synchronous Telemetry Evaluation & Asynchronous Actuation Dispatches  

---

## 1. System Communication Sequence

The following diagram details the exact end-to-end communication lifecycle for a single simulation step. Telemetry moves from the Go backend into the ingestion pipeline, through the analytical physics observers, down into fault isolation (Model 5), through the safety guardian (Model 6), and finishes with validated commands posted back to the Go engine.

```mermaid
sequenceDiagram
    autonumber
    box rgb(30, 41, 59) "Go Core Backend (:8080)"
        participant B as Go Core Engine
        participant G as Deterministic PLC Guardian
    end

    box rgb(15, 23, 42) "Your ML Diagnostic & Control Layer"
        participant I as Ingestion & Preprocessing
        participant M14 as Models 1-4: Twin Observers
        participant M5 as Model 5: Fault Detector
        participant M6 as Model 6: Safe Dosing Controller
    end

    Note over B,M6: STEP 1: Telemetry Fetch / Push Cycle

    alt Polling Mode (GET /readings)
        I->>B: GET /api/v1/simulations/{id}/readings?limit=200
        Note right of B: Request Headers:<br/>Authorization: Bearer <KEY>
        B-->>I: 200 OK (Sensor Readings Array)
    else Push Mode (POST /twin/evaluate)
        B->>I: POST /api/v1/twin/evaluate
    end

    Note over I,M14: STEP 2: Ingestion & Forward Physics Simulation
    I->>I: Filter packet loss (value: null -> forward-fill)
    I->>M14: Forward states x(t) and boundary weather
    M14->>M14: Run Models 1-4 (Microclimate, DO, Chemistry, Crop Growth)
    M14-->>M5: Supply reference states x_hat(t)

    Note over M5,B: STEP 3: Model 5 Anomaly Isolation & Alert Dispatch
    M5->>M5: Compute residuals: r_s = |y_s - x_hat_s|
    M5->>M5: Evaluate Torricelli leak and DO spatial decoupling

    opt Confirmed Anomaly
        M5->>B: POST /api/v1/simulations/{id}/alerts
        Note right of M5: Request Headers:<br/>Authorization: Bearer <KEY><br/>Content-Type: application/json
        B-->>M5: 201 Created (Alert Logged in Audit Trail)
    end

    Note over M5,M6: STEP 4: State Reconciliation to Model 6
    M5->>M6: Forward Validated Telemetry & Sensor Health Matrix

    Note over M6,G: STEP 5: Model 6 Dosing Formulation & Safety Verification
    M6->>M6: Calculate replenishment volumes (Water, Stock A+B, Acid)
    M6->>M6: Run Internal 5 PLC Zero-Bypass Interlocks

    alt All PLC Rules Pass & Action Needed
        M6->>G: POST /api/v1/simulations/{id}/commands
        Note right of M6: Request Headers:<br/>Authorization: Bearer <KEY><br/>Content-Type: application/json
        G->>G: Execute internal/safety/guardian.go dry-run
        alt Guardian Verification Pass
            G-->>M6: 201 Created (Command Executed)
            M6->>M6: Update last_chemical_dose_sec = sim_time_sec
        else Guardian Violation
            G-->>M6: 422 Unprocessable Entity
        end
    else Interlock Active / No Dosing Needed
        M6->>M6: Log Safe Hold (Suppress Actuation)
    end

    Note over I,B: STEP 6: Direct Evaluate Sync Response (If Push Mode)
    opt Push Mode (POST /twin/evaluate)
        M6-->>B: 200 OK (Diagnostics, Prescribed Commands, Virtual States)
    end
```

---

## 2. Step-by-Step Data Flow Pipeline

### Step 1: Telemetry Ingestion & Packet Loss Compensation
* The Python agent requests raw readings via `GET /api/v1/simulations/{id}/readings?limit=200` or receives a push via `POST /api/v1/twin/evaluate`.
* Sensor readings may experience Bernoulli packet drops (`value: null`).
* **Handling Strategy:** A zero-order hold (forward-fill) buffer maintains continuity for missing variables. If an individual sensor flatlines across 20 consecutive ticks ($\text{Var}(y_s) \to 0$), the agent flags `SENSOR_HARDWARE_STALL`.

### Step 2: Digital Twin Forward State Simulation (Models 1–4)
* **Model 1:** Steps sensible heat, vapor mass, and $\text{CO}_2$ balances to generate baseline expected values $\hat{T}_{\text{air}}$, $\widehat{\text{VPD}}$, and $\hat{T}_{\text{res}}$.
* **Model 2:** Computes Benson & Krause theoretical saturation $C_{\text{DO,sat}}$ and integrates the 1D thin-film plug flow down the gully to predict outlet oxygen $\hat{C}_{\text{DO,ch,out}}$.
* **Model 3:** Propagates 10 ion molar balances, evaluates precipitation, and solves the electroneutrality speciation equation for $\widehat{\text{pH}}$ and buffer capacity $\beta_{\text{buf}}$.
* **Model 4:** Solves Stanghellini combination transpiration and Van Henten dry matter accumulation to yield baseline expected water uptake $\hat{E}_{\text{can}}$.

### Step 3: Residual Anomaly Detection & Isolation (Model 5)
1. Innovation residuals are calculated for all measurable states:
   $$r_s(t) = |y_{s,\text{observed}}(t) - \hat{x}_{s,\text{twin}}(t)|$$
2. **Torricelli Orifice Leak Check:**
   $$\frac{dV_{\text{res}}}{dt} < -0.85\text{ L h}^{-1} \quad \text{AND} \quad \frac{d\text{EC}_{25}}{dt} \le 0 \implies \text{RESERVOIR\_LEAK\_SUSPECTED}$$
3. **Spatial DO Cross-Check:**
   $$r_{\text{DO,ch,out}} < -0.32\text{ mg L}^{-1} \quad \text{AND} \quad r_{\text{DO,res}} \approx 0 \implies \text{IMPLIED\_PUMP\_OR\_AERATION\_FAULT}$$
4. **Alkalinity / pH Divergence:**
   $$r_{\text{pH}} > 0.40 \quad \text{AND} \quad Q_{\text{dose,acid}} = 0 \implies \text{PH\_PROBE\_DRIFT\_SUSPECTED}$$
5. Confirmed anomalies trigger an immediate alert to the Go backend via `POST /api/v1/simulations/{id}/alerts`.

### Step 4: Dosing Formulation & Safety Verification (Model 6)
1. **Deficit Determination:**
   * Water refill: $\Delta V_{\text{src}} = \min(V_{\text{target}} - V_{\text{res}}, \, 120.0 - V_{\text{res}})$.
   * Nutrient dosing: $\Delta V_{\text{dose,stock}}$ calculated and split $50/50$ into Stock A and Stock B.
   * Acid dosing: Calculated using the Van Slyke buffer capacity $\beta_{\text{buf}}$.
2. **Zero-Bypass Interlocks Evaluation:**
   * **Rule 1:** Validate non-negative, finite numbers with no `NaN`s.
   * **Rule 2:** Ensure $V_{\text{res}} > 15.0\text{ L}$ before operating pumps.
   * **Rule 3:** Clamp total volume to satisfy $V_{\text{res}} + \Delta V_{\text{src}} + \sum \Delta V_{\text{chem}} \le 120.0\text{ L}$.
   * **Rule 4:** Enforce hydraulic turnover cooldown ($\Delta t \ge 7200\text{ s} \approx 2\text{ hours}$).
   * **Rule 5:** Clamp doses so that single EC jump $\le +0.40\text{ dS m}^{-1}$ and single alkalinity shift $\le 0.50\text{ meq L}^{-1}$.
3. Dispatch the validated payload via `POST /api/v1/simulations/{id}/commands`.

---

## 3. Complete JSON Payload Specifications

### 3.1 Inbound Telemetry Payload (`GET /readings` Response)
```json
[
  {
    "tick_index": 288,
    "sim_time_sec": 86400.0,
    "sensor_id": "sen-ec-1",
    "component_id": "res-1",
    "kind": "EC",
    "value": 2.38,
    "unit": "dS/m"
  },
  {
    "tick_index": 288,
    "sim_time_sec": 86400.0,
    "sensor_id": "sen-ph-1",
    "component_id": "res-1",
    "kind": "pH",
    "value": 6.72,
    "unit": "pH"
  },
  {
    "tick_index": 288,
    "sim_time_sec": 86400.0,
    "sensor_id": "sen-tw-1",
    "component_id": "res-1",
    "kind": "T_w",
    "value": 23.4,
    "unit": "C"
  },
  {
    "tick_index": 288,
    "sim_time_sec": 86400.0,
    "sensor_id": "sen-vres-1",
    "component_id": "res-1",
    "kind": "V_res",
    "value": 81.2,
    "unit": "L"
  },
  {
    "tick_index": 288,
    "sim_time_sec": 86400.0,
    "sensor_id": "sen-do-1",
    "component_id": "ch-1",
    "kind": "DO",
    "value": 5.12,
    "unit": "mg/L"
  },
  {
    "tick_index": 288,
    "sim_time_sec": 86400.0,
    "sensor_id": "sen-tair-1",
    "component_id": "enc-1",
    "kind": "T_air",
    "value": 28.1,
    "unit": "C"
  },
  {
    "tick_index": 288,
    "sim_time_sec": 86400.0,
    "sensor_id": "sen-rh-1",
    "component_id": "enc-1",
    "kind": "RH",
    "value": 54.0,
    "unit": "%"
  },
  {
    "tick_index": 288,
    "sim_time_sec": 86400.0,
    "sensor_id": "sen-co2-1",
    "component_id": "enc-1",
    "kind": "CO2",
    "value": 420.0,
    "unit": "ppm"
  }
]
```

---

### 3.2 Diagnostic Alert Payload (`POST /alerts`)
* **Endpoint:** `POST /api/v1/simulations/{id}/alerts`
* **Headers:**
  ```http
  Authorization: Bearer test-ml-secret-key-12345
  Content-Type: application/json
  ```

```json
{
  "component_id": "pump-1",
  "severity": "critical",
  "code": "IMPLIED_PUMP_OR_AERATION_FAULT",
  "message": "Outlet DO dropped to 5.12 mg/L while reservoir DO remains saturated at 8.12 mg/L. Pump mechanical degradation or root obstruction diagnosed."
}
```

* **Response (`201 Created`):**
```json
{
  "id": "alt-382941",
  "simulation_id": "sim-894a0f04-f37d-4889",
  "sim_time_sec": 86400.0,
  "component_id": "pump-1",
  "severity": "critical",
  "code": "IMPLIED_PUMP_OR_AERATION_FAULT",
  "message": "Outlet DO dropped to 5.12 mg/L...",
  "created_at": "2026-11-08T14:15:00Z"
}
```

---

### 3.3 Validated Actuation Command Payload (`POST /commands`)
* **Endpoint:** `POST /api/v1/simulations/{id}/commands`
* **Headers:**
  ```http
  Authorization: Bearer test-ml-secret-key-12345
  Content-Type: application/json
  ```

```json
{
  "target_component_id": "res-1",
  "action": "dose",
  "refill_water_l": 18.8,
  "dose_stock_a_ml": 0.0,
  "dose_stock_b_ml": 0.0,
  "dose_acid_ml": 0.0,
  "reason": "Replenish tank to 100.0 L setpoint and dilute EC from 2.38 dS/m to 1.95 dS/m."
}
```

* **Response (`201 Created`):**
```json
{
  "id": "cmd-781920",
  "simulation_id": "sim-894a0f04-f37d-4889",
  "sim_time_sec": 86400.0,
  "target_component_id": "res-1",
  "action": "dose",
  "status": "accepted",
  "created_at": "2026-11-08T14:20:00Z"
}
```

---

### 3.4 Direct Evaluation Response Payload (For `POST /twin/evaluate`)
* **Status:** `200 OK`
* **Headers:** `Content-Type: application/json`

```json
{
  "evaluation_id": "eval-883921049-20261108",
  "simulation_id": "sim-894a0f04-f37d-4889",
  "sim_time_sec": 86400.0,
  "system_health": "DEGRADED",
  "diagnostics": {
    "anomalies_detected": [
      {
        "id": "ANOM-01",
        "component_id": "dose-acid",
        "severity": "critical",
        "code": "PUMP_NON_RESPONSIVE",
        "message": "Acid dosing pump commanded 25.0 mL at T=82800s, but pH change was 0.00. Motor jam or empty carboy diagnosed.",
        "confidence_pct": 98.4
      },
      {
        "id": "ANOM-02",
        "component_id": "pump-1",
        "severity": "critical",
        "code": "IMPLIED_PUMP_OR_AERATION_FAULT",
        "message": "Outlet DO is 5.12 mg/L, below physical expectation (7.65 mg/L). Mechanical pump degradation diagnosed.",
        "confidence_pct": 91.2
      }
    ],
    "sensor_health_matrix": {
      "sen-ec-1": "HEALTHY",
      "sen-ph-1": "HEALTHY",
      "sen-tw-1": "HEALTHY",
      "sen-vres-1": "HEALTHY",
      "sen-do-1": "DEGRADED",
      "sen-tair-1": "HEALTHY",
      "sen-rh-1": "HEALTHY",
      "sen-co2-1": "HEALTHY"
    }
  },
  "prescribed_commands": [
    {
      "target_component_id": "res-1",
      "action": "dose",
      "refill_water_l": 18.8,
      "dose_stock_a_ml": 0.0,
      "dose_stock_b_ml": 0.0,
      "dose_acid_ml": 0.0,
      "reason": "Replenish tank to 100.0 L setpoint and dilute EC from 2.38 dS/m to 1.95 dS/m."
    }
  ],
  "soft_sensed_virtual_states": {
    "estimated_channel_outlet_do_mg_l": 5.15,
    "instantaneous_transpiration_l_hr": 1.82,
    "cumulative_transpiration_l": 14.8,
    "estimated_shoot_fw_g_plant": 188.4,
    "days_to_harvest": 12
  }
}
```
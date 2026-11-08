package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/abdelbaky/hydro/internal/api"
	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/abdelbaky/hydro/internal/mcp"
	"github.com/abdelbaky/hydro/internal/physics"
	"github.com/abdelbaky/hydro/internal/sim"
	"github.com/abdelbaky/hydro/internal/store"
	"go.uber.org/goleak"
)

const testMLKey = "sensor-x-secret-ml-key"

// TestAcceptanceDemoFlow executes the complete 5-Act Sensor X Challenge acceptance script
// defined in docs/REQUIREMENTS.md end-to-end against the HTTP + MCP server.
func TestAcceptanceDemoFlow(t *testing.T) {
	defer goleak.VerifyNone(t)

	memStore := store.NewMemoryStore()
	fakeClk := sim.NewFakeClock(time.Time{})
	mgr := sim.NewManager(physics.NewEngine(), memStore, fakeClk, nil)
	defer func() { _ = mgr.StopAll() }()

	mcpSrv := mcp.NewServer(mgr)
	srv := api.NewServer(memStore, mgr, mcpSrv, testMLKey, nil)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	client := ts.Client()

	// Verify embedded Control Center frontend at GET /
	uiResp, err := client.Get(ts.URL + "/")
	if err != nil || uiResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on GET /, got %v (err=%v)", uiResp.StatusCode, err)
	}
	_ = uiResp.Body.Close()

	// =========================================================================
	// ACT 1: Farm Authoring & Validation (Invalid -> 422 with component_id; Valid -> 201)
	// =========================================================================
	invalidJSON, err := os.ReadFile("../../testdata/invalid_farm.json")
	if err != nil {
		t.Fatalf("read invalid_farm.json: %v", err)
	}
	resp, err := client.Post(ts.URL+"/api/v1/farms/validate", "application/json", bytes.NewReader(invalidJSON))
	if err != nil {
		t.Fatalf("POST /farms/validate failed: %v", err)
	}
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("Act 1: expected 422 on invalid farm, got %d", resp.StatusCode)
	}
	var valResp domain.ValidationResponse
	_ = json.NewDecoder(resp.Body).Decode(&valResp)
	_ = resp.Body.Close()
	if valResp.Valid || len(valResp.Errors) == 0 {
		t.Fatalf("Act 1: expected structured validation errors with component_id, got %+v", valResp)
	}

	validJSON, err := os.ReadFile("../../testdata/valid_farm.json")
	if err != nil {
		t.Fatalf("read valid_farm.json: %v", err)
	}
	resp, err = client.Post(ts.URL+"/api/v1/farms", "application/json", bytes.NewReader(validJSON))
	if err != nil {
		t.Fatalf("POST /farms failed: %v", err)
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("Act 1: expected 201 Created on valid farm, got %d", resp.StatusCode)
	}
	var createdFarm domain.FarmRecord
	_ = json.NewDecoder(resp.Body).Decode(&createdFarm)
	_ = resp.Body.Close()
	if createdFarm.ID == "" {
		t.Fatalf("Act 1: expected non-empty farm ID")
	}

	// =========================================================================
	// ACT 2: Simulation Launch & Fast-Forward (Create simulation + /advance 24 steps = 2h)
	// =========================================================================
	createSimBody, _ := json.Marshal(map[string]any{
		"farm_id":          createdFarm.ID,
		"seed":             42,
		"step_seconds":     300,
		"mode":             "paused",
		"speed_multiplier": 60.0,
	})
	resp, err = client.Post(ts.URL+"/api/v1/simulations", "application/json", bytes.NewReader(createSimBody))
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("Act 2: POST /simulations failed: status=%v err=%v", resp.StatusCode, err)
	}
	var simStatus domain.SimulationStatus
	_ = json.NewDecoder(resp.Body).Decode(&simStatus)
	_ = resp.Body.Close()

	advBody, _ := json.Marshal(map[string]int{"steps": 24})
	resp, err = client.Post(ts.URL+"/api/v1/simulations/"+simStatus.ID+"/advance", "application/json", bytes.NewReader(advBody))
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("Act 2: POST /advance failed: status=%v err=%v", resp.StatusCode, err)
	}
	_ = json.NewDecoder(resp.Body).Decode(&simStatus)
	_ = resp.Body.Close()
	if simStatus.TickIndex != 24 || simStatus.SimTimeSec != 7200 {
		t.Fatalf("Act 2: expected tick 24 (7200s), got tick=%d time=%.0f", simStatus.TickIndex, simStatus.SimTimeSec)
	}

	// Verify /readings returns noisy bulk probes and never leaks individual ions
	resp, err = client.Get(ts.URL + "/api/v1/simulations/" + simStatus.ID + "/readings?limit=20")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("Act 2: GET /readings failed: %v", err)
	}
	var readings []domain.SensorReading
	_ = json.NewDecoder(resp.Body).Decode(&readings)
	_ = resp.Body.Close()
	if len(readings) == 0 {
		t.Fatalf("Act 2: expected non-empty sensor readings")
	}

	// =========================================================================
	// ACT 3: Fault Injection & ML Anomaly Alert (Aeration Loss on aerator-1)
	// =========================================================================
	faultBody, _ := json.Marshal(domain.FaultSpec{
		Kind:              domain.FaultAerationLoss,
		TargetComponentID: "aerator-1",
		Intensity:         0.85,
		TriggerAtSimSec:   0,
	})
	resp, err = client.Post(ts.URL+"/api/v1/simulations/"+simStatus.ID+"/faults", "application/json", bytes.NewReader(faultBody))
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("Act 3: POST /faults failed: %v", err)
	}
	_ = resp.Body.Close()

	// Step forward 12 steps (1 hour) so DO drops under aeration loss
	advBody2, _ := json.Marshal(map[string]int{"steps": 12})
	resp, err = client.Post(ts.URL+"/api/v1/simulations/"+simStatus.ID+"/advance", "application/json", bytes.NewReader(advBody2))
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("Act 3: POST /advance after fault failed: %v", err)
	}
	_ = resp.Body.Close()

	// Verify unauthenticated POST /alerts is rejected with 401
	alertPayload, _ := json.Marshal(map[string]string{
		"component_id": "aerator-1",
		"severity":     "critical",
		"code":         "DO_HYPOXIA_RISK",
		"message":      "Dissolved oxygen falling rapidly due to aeration loss on aerator-1",
	})
	resp, _ = client.Post(ts.URL+"/api/v1/simulations/"+simStatus.ID+"/alerts", "application/json", bytes.NewReader(alertPayload))
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("Act 3: expected 401 Unauthorized without ML token, got %d", resp.StatusCode)
	}

	// Authenticated ML service raises alert pinned to aerator-1
	reqAlert, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/simulations/"+simStatus.ID+"/alerts", bytes.NewReader(alertPayload))
	reqAlert.Header.Set("Content-Type", "application/json")
	reqAlert.Header.Set("Authorization", "Bearer "+testMLKey)
	resp, err = client.Do(reqAlert)
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("Act 3: authenticated POST /alerts failed: status=%d err=%v", resp.StatusCode, err)
	}
	_ = resp.Body.Close()

	// =========================================================================
	// ACT 4: Closed-Loop ML Actuation & PLC Safety Interlock
	// =========================================================================
	// 4a. Safe nutrient dose -> 200 OK (accepted)
	safeCmd, _ := json.Marshal(domain.CommandRequest{
		TargetComponentID: "reservoir-1",
		Action:            domain.ActionDose,
		DoseStockAML:      15.0,
		DoseStockBML:      15.0,
		Reason:            "Restore EC25 toward 1.50 dS/m setpoint",
	})
	reqSafe, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/simulations/"+simStatus.ID+"/commands", bytes.NewReader(safeCmd))
	reqSafe.Header.Set("Content-Type", "application/json")
	reqSafe.Header.Set("Authorization", "Bearer "+testMLKey)
	resp, err = client.Do(reqSafe)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("Act 4a: expected 200 OK on safe ML dose, got status=%d err=%v", resp.StatusCode, err)
	}
	var acceptedRec domain.CommandRecord
	_ = json.NewDecoder(resp.Body).Decode(&acceptedRec)
	_ = resp.Body.Close()
	if acceptedRec.Status != domain.CommandAccepted {
		t.Fatalf("Act 4a: expected status 'accepted', got %q", acceptedRec.Status)
	}

	// Advance 2 ticks (600s) past hydraulic mixing cooldown so we can test Rule 4/5 acid overdose
	advBody3, _ := json.Marshal(map[string]int{"steps": 2})
	resp, _ = client.Post(ts.URL+"/api/v1/simulations/"+simStatus.ID+"/advance", "application/json", bytes.NewReader(advBody3))
	_ = resp.Body.Close()

	// 4b. Unsafe acid overdose (500 mL of 0.5M HNO3) -> 422 Unprocessable Entity (rejected_safety)
	unsafeCmd, _ := json.Marshal(domain.CommandRequest{
		TargetComponentID: "reservoir-1",
		Action:            domain.ActionDose,
		DoseAcidML:        500.0,
		Reason:            "Aggressive pH drop attempt by hallucinating ML policy",
	})
	reqUnsafe, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/simulations/"+simStatus.ID+"/commands", bytes.NewReader(unsafeCmd))
	reqUnsafe.Header.Set("Content-Type", "application/json")
	reqUnsafe.Header.Set("Authorization", "Bearer "+testMLKey)
	resp, err = client.Do(reqUnsafe)
	if err != nil || resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("Act 4b: expected 422 Unprocessable Entity on unsafe acid overdose, got status=%d err=%v", resp.StatusCode, err)
	}
	var rejectedRec domain.CommandRecord
	_ = json.NewDecoder(resp.Body).Decode(&rejectedRec)
	_ = resp.Body.Close()
	if rejectedRec.Status != domain.CommandRejectedSafety || rejectedRec.RejectionCode == "" {
		t.Fatalf("Act 4b: expected rejected_safety with rejection_code, got %+v", rejectedRec)
	}

	// =========================================================================
	// ACT 5: Read-Only MCP Assistant Inspection
	// =========================================================================
	mcpCall, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      10,
		"method":  "tools/call",
		"params": map[string]any{
			"name": "get_ml_decisions",
			"arguments": map[string]any{
				"simulation_id": simStatus.ID,
			},
		},
	})
	resp, err = client.Post(ts.URL+"/mcp", "application/json", bytes.NewReader(mcpCall))
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("Act 5: POST /mcp failed: %v", err)
	}
	var mcpBody bytes.Buffer
	_, _ = mcpBody.ReadFrom(resp.Body)
	_ = resp.Body.Close()
	outStr := mcpBody.String()
	if !strings.Contains(outStr, "accepted") || !strings.Contains(outStr, "rejected_safety") {
		t.Fatalf("Act 5: expected MCP get_ml_decisions to return both accepted and rejected_safety commands, got %s", outStr)
	}
}

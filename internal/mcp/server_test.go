package mcp_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/abdelbaky/hydro/internal/config"
	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/abdelbaky/hydro/internal/mcp"
	"github.com/abdelbaky/hydro/internal/physics"
	"github.com/abdelbaky/hydro/internal/sim"
	"github.com/abdelbaky/hydro/internal/store"
)

func TestMCPServer_ReadOnlyToolsAndZeroActuation(t *testing.T) {
	ctx := context.Background()
	memStore := store.NewMemoryStore()
	fakeClk := sim.NewFakeClock(time.Time{})
	mgr := sim.NewManager(physics.NewEngine(), memStore, fakeClk, nil)
	defer func() { _ = mgr.StopAll() }()

	farmID := config.NewID()
	_ = memStore.CreateFarm(ctx, domain.FarmRecord{
		ID:            farmID,
		Name:          "MCP Test Farm",
		SchemaVersion: domain.SchemaVersionV1,
		Spec:          domain.DefaultDemoFarm(),
		CreatedAt:     fakeClk.Now(),
	})

	simStatus, err := mgr.CreateSimulation(ctx, farmID, 99, 300, domain.ClockPaused, 60.0)
	if err != nil {
		t.Fatalf("CreateSimulation failed: %v", err)
	}

	mcpSrv := mcp.NewServer(mgr)

	// 1. Verify tools/list returns strictly the 4 read-only tools.
	listReq := `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
	rec := httptest.NewRecorder()
	httpReq := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(listReq))
	mcpSrv.ServeHTTP(rec, httpReq)

	var listResp mcp.JSONRPCResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("unmarshal tools/list response: %v", err)
	}
	if listResp.Error != nil {
		t.Fatalf("unexpected RPC error: %+v", listResp.Error)
	}
	rawResult, _ := json.Marshal(listResp.Result)
	if !strings.Contains(string(rawResult), "get_sensor_readings") ||
		!strings.Contains(string(rawResult), "get_ml_decisions") {
		t.Fatalf("missing expected read-only tools in %s", string(rawResult))
	}
	if strings.Contains(string(rawResult), "submit_command") || strings.Contains(string(rawResult), "dose") {
		t.Fatalf("MCP tools/list must never expose actuation tools: %s", string(rawResult))
	}

	// 2. Verify calling get_sensor_readings returns noisy probe readings and never exposes ion concentrations.
	callReadings := map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "tools/call",
		"params": map[string]any{
			"name": "get_sensor_readings",
			"arguments": map[string]any{
				"simulation_id": simStatus.ID,
			},
		},
	}
	bodyBytes, _ := json.Marshal(callReadings)
	rec2 := httptest.NewRecorder()
	mcpSrv.ServeHTTP(rec2, httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(bodyBytes)))

	if strings.Contains(rec2.Body.String(), "NO3") || strings.Contains(rec2.Body.String(), "ions_mmol_l") {
		t.Fatalf("MCP get_sensor_readings leaked individual ion concentrations: %s", rec2.Body.String())
	}
	if !strings.Contains(rec2.Body.String(), "sen-ec-1") {
		t.Fatalf("expected sen-ec-1 in MCP get_sensor_readings output: %s", rec2.Body.String())
	}

	// 3. Verify attempting to call a non-existent actuation tool returns JSON-RPC error -32601.
	callForbidden := `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"submit_command","arguments":{}}}`
	var stdioOut bytes.Buffer
	if err := mcpSrv.ServeStdio(ctx, strings.NewReader(callForbidden+"\n"), &stdioOut); err != nil {
		t.Fatalf("ServeStdio failed: %v", err)
	}
	if !strings.Contains(stdioOut.String(), "-32601") || !strings.Contains(stdioOut.String(), "strictly read-only") {
		t.Fatalf("expected -32601 read-only rejection on forbidden tool call, got %s", stdioOut.String())
	}
}

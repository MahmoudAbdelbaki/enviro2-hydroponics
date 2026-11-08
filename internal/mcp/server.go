package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/abdelbaky/hydro/internal/domain"
)

// ReadOnlyObserver is the consumer-side interface injected into the MCP server.
// By design (ADR-002), it contains zero state-mutation or actuation methods,
// guaranteeing at compile time that LLM assistants cannot actuate the farm.
type ReadOnlyObserver interface {
	GetFarm(ctx context.Context, farmID string) (domain.FarmRecord, error)
	GetLatestReadings(ctx context.Context, simID, componentID, kind string, limit int) ([]domain.SensorReading, error)
	ListAlerts(ctx context.Context, simID string, limit int) ([]domain.Alert, error)
	ListCommands(ctx context.Context, simID string, limit int) ([]domain.CommandRecord, error)
}

// JSONRPCRequest represents an incoming JSON-RPC 2.0 request or notification.
type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// JSONRPCResponse represents an outgoing JSON-RPC 2.0 response.
type JSONRPCResponse struct {
	JSONRPC string        `json:"jsonrpc"`
	ID      any           `json:"id"`
	Result  any           `json:"result,omitempty"`
	Error   *JSONRPCError `json:"error,omitempty"`
}

// JSONRPCError represents a standard JSON-RPC 2.0 error object.
type JSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// ToolDefinition describes an MCP tool returned by tools/list.
type ToolDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

// ToolCallParams holds parameters for tools/call.
type ToolCallParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// ContentBlock represents an MCP text content block.
type ContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// ToolCallResult represents the result of tools/call.
type ToolCallResult struct {
	Content []ContentBlock `json:"content"`
	IsError bool           `json:"isError,omitempty"`
}

// Server implements a read-only Model Context Protocol (MCP) JSON-RPC 2.0 server.
type Server struct {
	obs ReadOnlyObserver
}

// NewServer constructs a read-only MCP server bound to obs.
func NewServer(obs ReadOnlyObserver) *Server {
	return &Server{obs: obs}
}

// ServeHTTP handles HTTP POST /mcp JSON-RPC 2.0 requests.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req JSONRPCRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSONRPC(w, JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      nil,
			Error:   &JSONRPCError{Code: -32700, Message: "parse error: " + err.Error()},
		})
		return
	}

	resp, isNotification := s.HandleRequest(r.Context(), req)
	if isNotification {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	writeJSONRPC(w, resp)
}

// ServeStdio serves newline-delimited JSON-RPC 2.0 over stdin/stdout until EOF or ctx cancellation.
func (s *Server) ServeStdio(ctx context.Context, in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
	enc := json.NewEncoder(out)

	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return err
		}
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var req JSONRPCRequest
		if err := json.Unmarshal(line, &req); err != nil {
			_ = enc.Encode(JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      nil,
				Error:   &JSONRPCError{Code: -32700, Message: "parse error: " + err.Error()},
			})
			continue
		}
		resp, isNotification := s.HandleRequest(ctx, req)
		if isNotification {
			continue
		}
		if err := enc.Encode(resp); err != nil {
			return fmt.Errorf("encode stdio response: %w", err)
		}
	}
	return scanner.Err()
}

// HandleRequest processes a single JSON-RPC 2.0 request.
func (s *Server) HandleRequest(ctx context.Context, req JSONRPCRequest) (JSONRPCResponse, bool) {
	if req.JSONRPC != "2.0" {
		return JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &JSONRPCError{Code: -32600, Message: "invalid request: jsonrpc must be '2.0'"},
		}, false
	}

	switch req.Method {
	case "notifications/initialized":
		return JSONRPCResponse{}, true

	case "initialize":
		return JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"protocolVersion": "2024-11-05",
				"serverInfo": map[string]any{
					"name":    "hydro-mcp-readonly",
					"version": "1.0.0",
				},
				"capabilities": map[string]any{
					"tools": map[string]any{},
				},
			},
		}, false

	case "ping":
		return JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result:  map[string]any{},
		}, false

	case "tools/list":
		return JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"tools": readOnlyToolDefinitions(),
			},
		}, false

	case "tools/call":
		var params ToolCallParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Error:   &JSONRPCError{Code: -32602, Message: "invalid params: " + err.Error()},
			}, false
		}
		res, rpcErr := s.callTool(ctx, params)
		if rpcErr != nil {
			return JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Error:   rpcErr,
			}, false
		}
		return JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result:  res,
		}, false

	default:
		return JSONRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &JSONRPCError{Code: -32601, Message: fmt.Sprintf("method not found: %s", req.Method)},
		}, false
	}
}

func (s *Server) callTool(ctx context.Context, params ToolCallParams) (ToolCallResult, *JSONRPCError) {
	switch params.Name {
	case "get_farm_spec":
		var args struct {
			FarmID string `json:"farm_id"`
		}
		if err := json.Unmarshal(params.Arguments, &args); err != nil || args.FarmID == "" {
			return ToolCallResult{}, &JSONRPCError{Code: -32602, Message: "farm_id is required"}
		}
		farm, err := s.obs.GetFarm(ctx, args.FarmID)
		if err != nil {
			return toolErrorResult(err.Error()), nil
		}
		return toolJSONResult(farm), nil

	case "get_sensor_readings":
		var args struct {
			SimulationID string `json:"simulation_id"`
			ComponentID  string `json:"component_id"`
			Kind         string `json:"kind"`
			Limit        int    `json:"limit"`
		}
		if err := json.Unmarshal(params.Arguments, &args); err != nil || args.SimulationID == "" {
			return ToolCallResult{}, &JSONRPCError{Code: -32602, Message: "simulation_id is required"}
		}
		if args.Limit <= 0 {
			args.Limit = 50
		}
		readings, err := s.obs.GetLatestReadings(ctx, args.SimulationID, args.ComponentID, args.Kind, args.Limit)
		if err != nil {
			return toolErrorResult(err.Error()), nil
		}
		return toolJSONResult(readings), nil

	case "get_alerts":
		var args struct {
			SimulationID string `json:"simulation_id"`
			Limit        int    `json:"limit"`
		}
		if err := json.Unmarshal(params.Arguments, &args); err != nil || args.SimulationID == "" {
			return ToolCallResult{}, &JSONRPCError{Code: -32602, Message: "simulation_id is required"}
		}
		if args.Limit <= 0 {
			args.Limit = 50
		}
		alerts, err := s.obs.ListAlerts(ctx, args.SimulationID, args.Limit)
		if err != nil {
			return toolErrorResult(err.Error()), nil
		}
		return toolJSONResult(alerts), nil

	case "get_ml_decisions":
		var args struct {
			SimulationID string `json:"simulation_id"`
			Limit        int    `json:"limit"`
		}
		if err := json.Unmarshal(params.Arguments, &args); err != nil || args.SimulationID == "" {
			return ToolCallResult{}, &JSONRPCError{Code: -32602, Message: "simulation_id is required"}
		}
		if args.Limit <= 0 {
			args.Limit = 50
		}
		cmds, err := s.obs.ListCommands(ctx, args.SimulationID, args.Limit)
		if err != nil {
			return toolErrorResult(err.Error()), nil
		}
		return toolJSONResult(cmds), nil

	default:
		return ToolCallResult{}, &JSONRPCError{
			Code:    -32601,
			Message: fmt.Sprintf("unknown or forbidden tool %q (MCP server is strictly read-only)", params.Name),
		}
	}
}

func toolJSONResult(v any) ToolCallResult {
	b, _ := json.MarshalIndent(v, "", "  ")
	return ToolCallResult{
		Content: []ContentBlock{{Type: "text", Text: string(b)}},
	}
}

func toolErrorResult(msg string) ToolCallResult {
	return ToolCallResult{
		Content: []ContentBlock{{Type: "text", Text: msg}},
		IsError: true,
	}
}

func writeJSONRPC(w http.ResponseWriter, resp JSONRPCResponse) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func readOnlyToolDefinitions() []ToolDefinition {
	return []ToolDefinition{
		{
			Name:        "get_farm_spec",
			Description: "Returns the read-only FarmSpec JSON configuration and 3D component IDs for a farm.",
			InputSchema: map[string]any{
				"type":     "object",
				"required": []string{"farm_id"},
				"properties": map[string]any{
					"farm_id": map[string]any{"type": "string", "description": "UUID of the farm"},
				},
			},
		},
		{
			Name:        "get_sensor_readings",
			Description: "Returns noisy bulk probe observations (EC, pH, T_w, DO, V_res, T_air, RH, CO2, RGB) for a simulation. Never exposes individual ion concentrations.",
			InputSchema: map[string]any{
				"type":     "object",
				"required": []string{"simulation_id"},
				"properties": map[string]any{
					"simulation_id": map[string]any{"type": "string", "description": "UUID of the simulation"},
					"component_id":  map[string]any{"type": "string", "description": "Optional 3D component_id filter"},
					"kind":          map[string]any{"type": "string", "description": "Optional probe kind filter (e.g., EC, pH, DO)"},
					"limit":         map[string]any{"type": "integer", "description": "Max readings to return (default 50)"},
				},
			},
		},
		{
			Name:        "get_alerts",
			Description: "Returns ML-generated anomaly alerts pinned to specific 3D farm component IDs.",
			InputSchema: map[string]any{
				"type":     "object",
				"required": []string{"simulation_id"},
				"properties": map[string]any{
					"simulation_id": map[string]any{"type": "string", "description": "UUID of the simulation"},
					"limit":         map[string]any{"type": "integer", "description": "Max alerts to return (default 50)"},
				},
			},
		},
		{
			Name:        "get_ml_decisions",
			Description: "Returns the audit log of ML actuation commands and deterministic Go safety guardian decisions (accepted or rejected_safety).",
			InputSchema: map[string]any{
				"type":     "object",
				"required": []string{"simulation_id"},
				"properties": map[string]any{
					"simulation_id": map[string]any{"type": "string", "description": "UUID of the simulation"},
					"limit":         map[string]any{"type": "integer", "description": "Max commands to return (default 50)"},
				},
			},
		},
	}
}

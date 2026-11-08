package api

import (
	"crypto/subtle"
	_ "embed"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/abdelbaky/hydro/internal/config"
	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/abdelbaky/hydro/internal/mcp"
	"github.com/abdelbaky/hydro/internal/sim"
	"github.com/abdelbaky/hydro/internal/store"
	"github.com/abdelbaky/hydro/internal/validate"
)

//go:embed ui/index.html
var controlDashboardHTML []byte

// Server wires the Go 1.22+ stdlib net/http.ServeMux routes, ML bearer auth middleware,
// structured slog request logging, and the read-only MCP endpoint.
type Server struct {
	store    store.Store
	mgr      *sim.Manager
	mcpSrv   *mcp.Server
	mlAPIKey string
	logger   *slog.Logger
	handler  http.Handler
}

// NewServer constructs the HTTP API server and registers all OpenAPI 3.1 routes.
func NewServer(st store.Store, mgr *sim.Manager, mcpSrv *mcp.Server, mlAPIKey string, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Server{
		store:    st,
		mgr:      mgr,
		mcpSrv:   mcpSrv,
		mlAPIKey: mlAPIKey,
		logger:   logger,
	}

	mux := http.NewServeMux()

	// Embedded Interactive Control Center UI
	mux.HandleFunc("GET /{$}", s.handleDashboardUI)

	// Health & Readiness
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /readyz", s.handleReadyz)

	// Farm Validation & CRUD
	mux.HandleFunc("POST /api/v1/farms/validate", s.handleValidateFarm)
	mux.HandleFunc("POST /api/v1/farms", s.handleCreateFarm)
	mux.HandleFunc("GET /api/v1/farms", s.handleListFarms)
	mux.HandleFunc("GET /api/v1/farms/{id}", s.handleGetFarm)

	// Simulation Lifecycle, Clock, Advance & Faults
	mux.HandleFunc("POST /api/v1/simulations", s.handleCreateSimulation)
	mux.HandleFunc("GET /api/v1/simulations", s.handleListSimulations)
	mux.HandleFunc("GET /api/v1/simulations/{id}", s.handleGetSimulation)
	mux.HandleFunc("POST /api/v1/simulations/{id}/clock", s.handleSetClock)
	mux.HandleFunc("POST /api/v1/simulations/{id}/advance", s.handleAdvanceSimulation)
	mux.HandleFunc("POST /api/v1/simulations/{id}/faults", s.handleInjectFault)

	// Telemetry & Ground Truth
	mux.HandleFunc("GET /api/v1/simulations/{id}/readings", s.handleGetReadings)
	mux.HandleFunc("GET /api/v1/simulations/{id}/ground-truth", s.handleGetGroundTruth)

	// Alerts (GET public; POST restricted to ML service bearer token)
	mux.HandleFunc("GET /api/v1/simulations/{id}/alerts", s.handleListAlerts)
	mux.HandleFunc("POST /api/v1/simulations/{id}/alerts", s.requireMLAuth(s.handleCreateAlert))

	// Actuation Commands (GET public; POST restricted to ML service bearer token + 5-rule safety guardian)
	mux.HandleFunc("GET /api/v1/simulations/{id}/commands", s.handleListCommands)
	mux.HandleFunc("POST /api/v1/simulations/{id}/commands", s.requireMLAuth(s.handleSubmitCommand))

	// Read-only Model Context Protocol (MCP) JSON-RPC 2.0 endpoint
	if mcpSrv != nil {
		mux.Handle("POST /mcp", mcpSrv)
	}

	s.handler = s.withMiddleware(mux)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.handler.ServeHTTP(w, r)
}

func (s *Server) handleDashboardUI(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(controlDashboardHTML)
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "STORE_UNAVAILABLE", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) handleValidateFarm(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "READ_BODY_ERROR", err.Error())
		return
	}
	_, valResp := validate.ValidateFarmJSON(body)
	if !valResp.Valid {
		writeJSON(w, http.StatusUnprocessableEntity, valResp)
		return
	}
	writeJSON(w, http.StatusOK, valResp)
}

func (s *Server) handleCreateFarm(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "READ_BODY_ERROR", err.Error())
		return
	}
	spec, valResp := validate.ValidateFarmJSON(body)
	if !valResp.Valid {
		writeJSON(w, http.StatusUnprocessableEntity, valResp)
		return
	}
	rec := domain.FarmRecord{
		ID:            config.NewID(),
		Name:          spec.Name,
		SchemaVersion: spec.SchemaVersion,
		Spec:          spec,
		CreatedAt:     time.Now().UTC(),
	}
	if err := s.store.CreateFarm(r.Context(), rec); err != nil {
		writeError(w, http.StatusInternalServerError, "CREATE_FARM_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, rec)
}

func (s *Server) handleListFarms(w http.ResponseWriter, r *http.Request) {
	farms, err := s.store.ListFarms(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "LIST_FARMS_FAILED", err.Error())
		return
	}
	if farms == nil {
		farms = []domain.FarmRecord{}
	}
	writeJSON(w, http.StatusOK, farms)
}

func (s *Server) handleGetFarm(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	rec, err := s.store.GetFarm(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "FARM_NOT_FOUND", "farm not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "GET_FARM_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (s *Server) handleCreateSimulation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		FarmID          string           `json:"farm_id"`
		Seed            int64            `json:"seed"`
		StepSeconds     int              `json:"step_seconds"`
		Mode            domain.ClockMode `json:"mode"`
		SpeedMultiplier float64          `json:"speed_multiplier"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	if req.FarmID == "" {
		writeError(w, http.StatusBadRequest, "MISSING_FARM_ID", "farm_id is required")
		return
	}
	if req.Seed == 0 {
		req.Seed = 42
	}
	if req.StepSeconds == 0 {
		req.StepSeconds = 300
	}
	if req.Mode == "" {
		req.Mode = domain.ClockPaused
	}
	if req.SpeedMultiplier == 0 {
		req.SpeedMultiplier = 60.0
	}

	status, err := s.mgr.CreateSimulation(r.Context(), req.FarmID, req.Seed, req.StepSeconds, req.Mode, req.SpeedMultiplier)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "FARM_NOT_FOUND", "referenced farm_id does not exist")
			return
		}
		if errors.Is(err, sim.ErrInvalidSpeedMultiplier) {
			writeError(w, http.StatusBadRequest, "INVALID_SPEED_MULTIPLIER", err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "CREATE_SIMULATION_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, status)
}

func (s *Server) handleListSimulations(w http.ResponseWriter, r *http.Request) {
	sims, err := s.store.ListSimulations(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "LIST_SIMULATIONS_FAILED", err.Error())
		return
	}
	if sims == nil {
		sims = []domain.SimulationStatus{}
	}
	writeJSON(w, http.StatusOK, sims)
}

func (s *Server) handleGetSimulation(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	st, err := s.mgr.GetSimulation(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "SIMULATION_NOT_FOUND", "simulation not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "GET_SIMULATION_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleSetClock(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	runner, ok := s.mgr.ActiveRunner(id)
	if !ok {
		writeError(w, http.StatusNotFound, "ACTIVE_SIMULATION_NOT_FOUND", "simulation is not currently active in memory")
		return
	}
	var req struct {
		Mode            domain.ClockMode `json:"mode"`
		SpeedMultiplier *float64         `json:"speed_multiplier"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	if req.Mode != domain.ClockPaused && req.Mode != domain.ClockRunning {
		writeError(w, http.StatusBadRequest, "INVALID_CLOCK_MODE", "mode must be 'paused' or 'running'")
		return
	}
	st, err := runner.SetClock(r.Context(), req.Mode, req.SpeedMultiplier)
	if err != nil {
		writeError(w, http.StatusBadRequest, "SET_CLOCK_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleAdvanceSimulation(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	runner, ok := s.mgr.ActiveRunner(id)
	if !ok {
		writeError(w, http.StatusNotFound, "ACTIVE_SIMULATION_NOT_FOUND", "simulation is not currently active in memory")
		return
	}
	var req struct {
		Steps int `json:"steps"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	st, err := runner.Advance(r.Context(), req.Steps)
	if err != nil {
		if errors.Is(err, sim.ErrInvalidStepCount) {
			writeError(w, http.StatusBadRequest, "INVALID_STEPS", err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "ADVANCE_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleInjectFault(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	runner, ok := s.mgr.ActiveRunner(id)
	if !ok {
		writeError(w, http.StatusNotFound, "ACTIVE_SIMULATION_NOT_FOUND", "simulation is not currently active in memory")
		return
	}
	var fault domain.FaultSpec
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&fault); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	if fault.Kind == "" {
		writeError(w, http.StatusBadRequest, "INVALID_FAULT_KIND", "fault kind is required")
		return
	}
	st, err := runner.InjectFault(r.Context(), fault)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INJECT_FAULT_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleGetReadings(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	q := r.URL.Query()
	filter := store.ReadingsFilter{
		SimulationID: id,
		ComponentID:  q.Get("component_id"),
		Kind:         q.Get("kind"),
		Limit:        500,
	}
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			filter.Limit = n
		}
	}
	if v := q.Get("from_sim_sec"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			filter.FromSimSec = &f
		}
	}
	if v := q.Get("to_sim_sec"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			filter.ToSimSec = &f
		}
	}

	if runner, ok := s.mgr.ActiveRunner(id); ok {
		rds := runner.RecentReadings(filter)
		if len(rds) > 0 {
			writeJSON(w, http.StatusOK, rds)
			return
		}
	}
	if _, err := s.mgr.GetSimulation(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "SIMULATION_NOT_FOUND", "simulation not found")
			return
		}
	}
	rds, err := s.store.QueryReadings(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_READINGS_FAILED", err.Error())
		return
	}
	if rds == nil {
		rds = []domain.SensorReading{}
	}
	writeJSON(w, http.StatusOK, rds)
}

func (s *Server) handleGetGroundTruth(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	gt, err := s.mgr.GetGroundTruth(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "ACTIVE_SIMULATION_NOT_FOUND", "ground-truth is available for the active simulation")
		return
	}
	writeJSON(w, http.StatusOK, gt)
}

func (s *Server) handleCreateAlert(w http.ResponseWriter, r *http.Request) {
	simID := r.PathValue("id")
	simStatus, err := s.mgr.GetSimulation(r.Context(), simID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "SIMULATION_NOT_FOUND", "simulation not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "GET_SIMULATION_FAILED", err.Error())
		return
	}
	var req struct {
		ComponentID string `json:"component_id"`
		Severity    string `json:"severity"`
		Code        string `json:"code"`
		Message     string `json:"message"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	if req.ComponentID == "" || req.Code == "" || req.Message == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ALERT", "component_id, code, and message are required")
		return
	}
	if req.Severity != "info" && req.Severity != "warning" && req.Severity != "critical" {
		writeError(w, http.StatusBadRequest, "INVALID_SEVERITY", "severity must be 'info', 'warning', or 'critical'")
		return
	}
	alert := domain.Alert{
		ID:           config.NewID(),
		SimulationID: simID,
		SimTimeSec:   simStatus.SimTimeSec,
		ComponentID:  req.ComponentID,
		Severity:     req.Severity,
		Code:         req.Code,
		Message:      req.Message,
		CreatedAt:    time.Now().UTC(),
	}
	if err := s.store.CreateAlert(r.Context(), alert); err != nil {
		writeError(w, http.StatusInternalServerError, "CREATE_ALERT_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, alert)
}

func (s *Server) handleListAlerts(w http.ResponseWriter, r *http.Request) {
	simID := r.PathValue("id")
	alerts, err := s.mgr.ListAlerts(r.Context(), simID, 100)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "SIMULATION_NOT_FOUND", "simulation not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "LIST_ALERTS_FAILED", err.Error())
		return
	}
	if alerts == nil {
		alerts = []domain.Alert{}
	}
	writeJSON(w, http.StatusOK, alerts)
}

func (s *Server) handleSubmitCommand(w http.ResponseWriter, r *http.Request) {
	simID := r.PathValue("id")
	runner, ok := s.mgr.ActiveRunner(simID)
	if !ok {
		writeError(w, http.StatusNotFound, "ACTIVE_SIMULATION_NOT_FOUND", "simulation is not currently active in memory")
		return
	}
	var req domain.CommandRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	if req.TargetComponentID == "" || req.Reason == "" {
		writeError(w, http.StatusBadRequest, "INVALID_COMMAND", "target_component_id and reason are required")
		return
	}
	rec, err := runner.SubmitCommand(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "SUBMIT_COMMAND_FAILED", err.Error())
		return
	}
	if rec.Status == domain.CommandRejectedSafety {
		writeJSON(w, http.StatusUnprocessableEntity, rec)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (s *Server) handleListCommands(w http.ResponseWriter, r *http.Request) {
	simID := r.PathValue("id")
	cmds, err := s.mgr.ListCommands(r.Context(), simID, 100)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "SIMULATION_NOT_FOUND", "simulation not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "LIST_COMMANDS_FAILED", err.Error())
		return
	}
	if cmds == nil {
		cmds = []domain.CommandRecord{}
	}
	writeJSON(w, http.StatusOK, cmds)
}

// requireMLAuth enforces constant-time bearer token verification for ML-only endpoints.
func (s *Server) requireMLAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		const prefix = "Bearer "
		if !strings.HasPrefix(auth, prefix) {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing Bearer token for ML controller endpoint")
			return
		}
		provided := strings.TrimPrefix(auth, prefix)
		if len(s.mlAPIKey) == 0 || subtle.ConstantTimeCompare([]byte(provided), []byte(s.mlAPIKey)) != 1 {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid ML controller API key")
			return
		}
		next(w, r)
	}
}

func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// CORS headers for the Three.js 3D web frontend
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		start := time.Now()
		rw := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		s.logger.Debug("http request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", rw.status),
			slog.Duration("duration", time.Since(start)),
		)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.status = code
	sr.ResponseWriter.WriteHeader(code)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]string{
		"code":    code,
		"message": msg,
	})
}

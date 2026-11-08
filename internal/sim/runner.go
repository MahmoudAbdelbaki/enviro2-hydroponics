package sim

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"

	"github.com/abdelbaky/hydro/internal/config"
	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/abdelbaky/hydro/internal/physics"
	"github.com/abdelbaky/hydro/internal/safety"
	"github.com/abdelbaky/hydro/internal/store"
	"golang.org/x/sync/errgroup"
)

const (
	ringBufferCap = 1000
	flushChanCap  = 128
)

var (
	// ErrInvalidStepCount is returned when /advance steps is outside [1, 8640].
	ErrInvalidStepCount = errors.New("steps must be between 1 and 8640")
	// ErrInvalidSpeedMultiplier is returned when speed_multiplier is outside [0.1, 3600].
	ErrInvalidSpeedMultiplier = errors.New("speed_multiplier must be between 0.1 and 3600.0")
)

// PhysicsEngine is the consumer-side interface required by the simulation actor loop.
type PhysicsEngine interface {
	InitState(cfg physics.Config) physics.State
	ObserveInitial(cfg physics.Config, st physics.State) []domain.SensorReading
	Step(
		cfg physics.Config,
		prev physics.State,
		act domain.Actuation,
		faults []domain.FaultSpec,
		dtSec float64,
		rng *rand.Rand,
	) (physics.State, []domain.SensorReading)
}

// Snapshot holds an immutable point-in-time view of the active simulation for lock-free reads.
type Snapshot struct {
	Status         domain.SimulationStatus
	LatestReadings []domain.SensorReading
	GroundTruth    domain.GroundTruthState
}

type actorMsg interface {
	isActorMsg()
}

type msgAdvance struct {
	ctx   context.Context
	steps int
	reply chan advanceResult
}

func (msgAdvance) isActorMsg() {}

type advanceResult struct {
	status domain.SimulationStatus
	err    error
}

type msgClock struct {
	mode            domain.ClockMode
	speedMultiplier *float64
	reply           chan clockResult
}

func (msgClock) isActorMsg() {}

type clockResult struct {
	status domain.SimulationStatus
	err    error
}

type msgFault struct {
	fault domain.FaultSpec
	reply chan domain.SimulationStatus
}

func (msgFault) isActorMsg() {}

type msgCommand struct {
	ctx   context.Context
	req   domain.CommandRequest
	reply chan commandResult
}

func (msgCommand) isActorMsg() {}

type commandResult struct {
	rec domain.CommandRecord
	err error
}

type flushBatch struct {
	status   domain.SimulationStatus
	readings []domain.SensorReading
}

// Runner manages the single-owner actor loop and asynchronous persistence writer
// for one active simulation run.
type Runner struct {
	id       string
	farm     domain.FarmSpec
	physCfg  physics.Config
	engine   PhysicsEngine
	store    store.Store
	clock    Clock
	logger   *slog.Logger

	cmdCh    chan actorMsg
	flushCh  chan flushBatch
	snapshot atomic.Pointer[Snapshot]

	ringMu   sync.RWMutex
	ring     [][]domain.SensorReading
	ringHead int
	ringSize int

	droppedBatches atomic.Uint64

	cancel context.CancelFunc
	eg     *errgroup.Group
}

// StartRunner initializes a new simulation Runner and starts its actor loop and batch writer goroutines.
func StartRunner(
	parentCtx context.Context,
	status domain.SimulationStatus,
	farm domain.FarmSpec,
	engine PhysicsEngine,
	st store.Store,
	clk Clock,
	logger *slog.Logger,
) *Runner {
	if logger == nil {
		logger = slog.Default()
	}
	if clk == nil {
		clk = NewRealClock()
	}
	physCfg := physics.FromFarmSpec(farm)
	initState := engine.InitState(physCfg)
	initReadings := engine.ObserveInitial(physCfg, initState)
	for i := range initReadings {
		initReadings[i].SimulationID = status.ID
	}

	ctx, cancel := context.WithCancel(parentCtx)
	eg, egCtx := errgroup.WithContext(ctx)

	r := &Runner{
		id:      status.ID,
		farm:    farm,
		physCfg: physCfg,
		engine:  engine,
		store:   st,
		clock:   clk,
		logger:  logger,
		cmdCh:   make(chan actorMsg, 64),
		flushCh: make(chan flushBatch, flushChanCap),
		ring:    make([][]domain.SensorReading, ringBufferCap),
		cancel:  cancel,
		eg:      eg,
	}

	r.appendRing(initReadings)
	r.publishSnapshot(status, initState, initReadings)

	// Persist initial t=0 readings asynchronously via flushCh.
	r.enqueueFlush(flushBatch{
		status:   status,
		readings: initReadings,
	})

	eg.Go(func() error {
		return r.loop(egCtx, status, initState)
	})
	eg.Go(func() error {
		return r.batchWriter(egCtx)
	})

	return r
}

// Stop cancels the runner context and waits for both the actor loop and batch writer to exit cleanly.
func (r *Runner) Stop() error {
	r.cancel()
	return r.eg.Wait()
}

// ID returns the simulation ID owned by this Runner.
func (r *Runner) ID() string {
	return r.id
}

// LatestSnapshot returns the latest lock-free immutable Snapshot.
func (r *Runner) LatestSnapshot() *Snapshot {
	return r.snapshot.Load()
}

// RecentReadings queries the in-memory ring buffer of the last 1,000 ticks.
func (r *Runner) RecentReadings(filter store.ReadingsFilter) []domain.SensorReading {
	r.ringMu.RLock()
	defer r.ringMu.RUnlock()

	limit := filter.Limit
	if limit <= 0 || limit > 5000 {
		limit = 500
	}
	var out []domain.SensorReading
	// Traverse newest tick to oldest tick in the ring buffer.
	for i := 0; i < r.ringSize; i++ {
		idx := (r.ringHead - 1 - i + ringBufferCap) % ringBufferCap
		tickBatch := r.ring[idx]
		for _, rd := range tickBatch {
			if filter.ComponentID != "" && rd.ComponentID != filter.ComponentID {
				continue
			}
			if filter.Kind != "" && rd.Kind != filter.Kind {
				continue
			}
			if filter.FromSimSec != nil && rd.SimTimeSec < *filter.FromSimSec {
				continue
			}
			if filter.ToSimSec != nil && rd.SimTimeSec > *filter.ToSimSec {
				continue
			}
			cp := rd
			if rd.Value != nil {
				v := *rd.Value
				cp.Value = &v
			}
			out = append(out, cp)
			if len(out) >= limit {
				return out
			}
		}
	}
	return out
}

// Advance steps the simulation forward deterministically by steps ticks.
func (r *Runner) Advance(ctx context.Context, steps int) (domain.SimulationStatus, error) {
	if steps < 1 || steps > 8640 {
		return domain.SimulationStatus{}, ErrInvalidStepCount
	}
	reply := make(chan advanceResult, 1)
	select {
	case r.cmdCh <- msgAdvance{ctx: ctx, steps: steps, reply: reply}:
	case <-ctx.Done():
		return domain.SimulationStatus{}, ctx.Err()
	}
	select {
	case res := <-reply:
		return res.status, res.err
	case <-ctx.Done():
		return domain.SimulationStatus{}, ctx.Err()
	}
}

// SetClock updates the simulation clock mode and optional speed multiplier.
func (r *Runner) SetClock(ctx context.Context, mode domain.ClockMode, speedMultiplier *float64) (domain.SimulationStatus, error) {
	if speedMultiplier != nil && (*speedMultiplier < 0.1 || *speedMultiplier > 3600.0) {
		return domain.SimulationStatus{}, ErrInvalidSpeedMultiplier
	}
	reply := make(chan clockResult, 1)
	select {
	case r.cmdCh <- msgClock{mode: mode, speedMultiplier: speedMultiplier, reply: reply}:
	case <-ctx.Done():
		return domain.SimulationStatus{}, ctx.Err()
	}
	select {
	case res := <-reply:
		return res.status, res.err
	case <-ctx.Done():
		return domain.SimulationStatus{}, ctx.Err()
	}
}

// InjectFault injects or clears a fault scenario inside the actor loop.
func (r *Runner) InjectFault(ctx context.Context, fault domain.FaultSpec) (domain.SimulationStatus, error) {
	reply := make(chan domain.SimulationStatus, 1)
	select {
	case r.cmdCh <- msgFault{fault: fault, reply: reply}:
	case <-ctx.Done():
		return domain.SimulationStatus{}, ctx.Err()
	}
	select {
	case st := <-reply:
		return st, nil
	case <-ctx.Done():
		return domain.SimulationStatus{}, ctx.Err()
	}
}

// SubmitCommand evaluates an ML actuation command against the 5-rule safety guardian inside the actor loop.
func (r *Runner) SubmitCommand(ctx context.Context, req domain.CommandRequest) (domain.CommandRecord, error) {
	reply := make(chan commandResult, 1)
	select {
	case r.cmdCh <- msgCommand{ctx: ctx, req: req, reply: reply}:
	case <-ctx.Done():
		return domain.CommandRecord{}, ctx.Err()
	}
	select {
	case res := <-reply:
		return res.rec, res.err
	case <-ctx.Done():
		return domain.CommandRecord{}, ctx.Err()
	}
}

func (r *Runner) loop(ctx context.Context, status domain.SimulationStatus, state physics.State) error {
	// Sender closes flushCh when actor loop exits so batchWriter drains and terminates cleanly.
	defer close(r.flushCh)

	seedU64 := uint64(status.Seed)
	rng := rand.New(rand.NewPCG(seedU64, seedU64^0x9e3779b97f4a7c15))

	ticker := r.clock.NewTicker(computeTickDuration(status.StepSeconds, status.SpeedMultiplier))
	defer ticker.Stop()

	var pendingAct domain.Actuation
	var lastChemDoseSimSec *float64

	stepOnce := func() []domain.SensorReading {
		dtSec := float64(status.StepSeconds)
		nextState, readings := r.engine.Step(r.physCfg, state, pendingAct, status.ActiveFaults, dtSec, rng)
		state = nextState
		// Reset one-shot volumetric doses after applying them over the step; throttles persist in state.
		pendingAct = domain.Actuation{}

		for i := range readings {
			readings[i].SimulationID = status.ID
		}
		status.TickIndex = state.TickIndex
		status.SimTimeSec = state.SimTimeSec
		status.SimDays = state.SimTimeSec / 86400.0
		status.DroppedBatches = r.droppedBatches.Load()
		status.UpdatedAt = r.clock.Now()

		r.appendRing(readings)
		r.publishSnapshot(status, state, readings)
		return readings
	}

	for {
		var tickCh <-chan time.Time
		if status.Mode == domain.ClockRunning {
			tickCh = ticker.C()
		}

		select {
		case <-ctx.Done():
			return nil

		case <-tickCh:
			readings := stepOnce()
			r.enqueueFlush(flushBatch{
				status:   cloneStatus(status),
				readings: readings,
			})

		case rawMsg := <-r.cmdCh:
			switch msg := rawMsg.(type) {
			case msgAdvance:
				allReadings := make([]domain.SensorReading, 0, msg.steps*len(r.physCfg.Sensors))
				for i := 0; i < msg.steps; i++ {
					if err := msg.ctx.Err(); err != nil {
						msg.reply <- advanceResult{status: cloneStatus(status), err: err}
						goto nextIter
					}
					rds := stepOnce()
					allReadings = append(allReadings, rds...)
				}
				// Synchronous context-bounded flush in /advance mode so fast-forward datasets are lossless.
				flushCtx, cancel := context.WithTimeout(msg.ctx, 10*time.Second)
				err := r.store.AppendReadingsBatch(flushCtx, allReadings)
				if err == nil {
					err = r.store.UpdateSimulationStatus(flushCtx, status)
				}
				cancel()
				msg.reply <- advanceResult{status: cloneStatus(status), err: err}

			case msgClock:
				status.Mode = msg.mode
				if msg.speedMultiplier != nil {
					status.SpeedMultiplier = *msg.speedMultiplier
				}
				status.UpdatedAt = r.clock.Now()
				ticker.Reset(computeTickDuration(status.StepSeconds, status.SpeedMultiplier))
				r.publishSnapshot(status, state, r.LatestSnapshot().LatestReadings)
				_ = r.store.UpdateSimulationStatus(ctx, status)
				msg.reply <- clockResult{status: cloneStatus(status)}

			case msgFault:
				if msg.fault.Clear {
					filtered := make([]domain.FaultSpec, 0, len(status.ActiveFaults))
					for _, f := range status.ActiveFaults {
						if f.Kind == msg.fault.Kind && (msg.fault.TargetComponentID == "" || f.TargetComponentID == msg.fault.TargetComponentID) {
							continue
						}
						filtered = append(filtered, f)
					}
					status.ActiveFaults = filtered
				} else {
					replaced := false
					for i := range status.ActiveFaults {
						if status.ActiveFaults[i].Kind == msg.fault.Kind && status.ActiveFaults[i].TargetComponentID == msg.fault.TargetComponentID {
							status.ActiveFaults[i] = msg.fault
							replaced = true
							break
						}
					}
					if !replaced {
						status.ActiveFaults = append(status.ActiveFaults, msg.fault)
					}
				}
				status.UpdatedAt = r.clock.Now()
				r.publishSnapshot(status, state, r.LatestSnapshot().LatestReadings)
				_ = r.store.UpdateSimulationStatus(ctx, status)
				msg.reply <- cloneStatus(status)

			case msgCommand:
				act, violation := safety.CheckCommand(r.physCfg, state, msg.req, lastChemDoseSimSec, float64(status.StepSeconds))
				rec := domain.CommandRecord{
					ID:                config.NewID(),
					SimulationID:      status.ID,
					SimTimeSec:        state.SimTimeSec,
					TargetComponentID: msg.req.TargetComponentID,
					Action:            msg.req.Action,
					Payload:           msg.req,
					Reason:            msg.req.Reason,
					CreatedAt:         r.clock.Now(),
				}
				if violation == nil {
					rec.Status = domain.CommandAccepted
					mergeActuation(&pendingAct, act)
					if act.DoseStockAM3+act.DoseStockBM3+act.DoseAcidM3+act.DoseBaseM3 > 0 {
						tDose := state.SimTimeSec
						lastChemDoseSimSec = &tDose
					}
				} else {
					rec.Status = domain.CommandRejectedSafety
					rec.RejectionCode = violation.Code
					rec.RejectionMessage = violation.Message
				}
				err := r.store.CreateCommand(msg.ctx, rec)
				msg.reply <- commandResult{rec: rec, err: err}
			}
		}
	nextIter:
	}
}

func (r *Runner) enqueueFlush(batch flushBatch) {
	select {
	case r.flushCh <- batch:
	default:
		// Live ticker backpressure policy: drop oldest batch so the physics actor never stalls on slow I/O.
		select {
		case <-r.flushCh:
			dropped := r.droppedBatches.Add(1)
			r.logger.Warn("telemetry flush channel full; dropped oldest batch",
				slog.String("simulation_id", r.id),
				slog.Uint64("dropped_batches", dropped),
			)
		default:
		}
		select {
		case r.flushCh <- batch:
		default:
		}
	}
}

func (r *Runner) batchWriter(ctx context.Context) error {
	for batch := range r.flushCh {
		writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		if err := r.store.AppendReadingsBatch(writeCtx, batch.readings); err != nil {
			r.logger.Warn("failed to persist sensor readings batch",
				slog.String("simulation_id", r.id),
				slog.String("error", err.Error()),
			)
		}
		batch.status.DroppedBatches = r.droppedBatches.Load()
		if err := r.store.UpdateSimulationStatus(writeCtx, batch.status); err != nil {
			r.logger.Warn("failed to update simulation status",
				slog.String("simulation_id", r.id),
				slog.String("error", err.Error()),
			)
		}
		cancel()
	}
	return nil
}

func (r *Runner) appendRing(readings []domain.SensorReading) {
	cp := make([]domain.SensorReading, len(readings))
	for i, rd := range readings {
		cp[i] = rd
		if rd.Value != nil {
			v := *rd.Value
			cp[i].Value = &v
		}
	}
	r.ringMu.Lock()
	r.ring[r.ringHead] = cp
	r.ringHead = (r.ringHead + 1) % ringBufferCap
	if r.ringSize < ringBufferCap {
		r.ringSize++
	}
	r.ringMu.Unlock()
}

func (r *Runner) publishSnapshot(status domain.SimulationStatus, st physics.State, readings []domain.SensorReading) {
	stCopy := cloneStatus(status)
	stCopy.SimDays = st.SimTimeSec / 86400.0
	stCopy.DroppedBatches = r.droppedBatches.Load()

	rdCopy := make([]domain.SensorReading, len(readings))
	for i, rd := range readings {
		rdCopy[i] = rd
		if rd.Value != nil {
			v := *rd.Value
			rdCopy[i].Value = &v
		}
	}

	snap := &Snapshot{
		Status:         stCopy,
		LatestReadings: rdCopy,
		GroundTruth:    st.ToGroundTruth(stCopy.ActiveFaults),
	}
	r.snapshot.Store(snap)
}

func mergeActuation(dst *domain.Actuation, src domain.Actuation) {
	dst.DoseStockAM3 += src.DoseStockAM3
	dst.DoseStockBM3 += src.DoseStockBM3
	dst.DoseAcidM3 += src.DoseAcidM3
	dst.DoseBaseM3 += src.DoseBaseM3
	dst.RefillWaterM3 += src.RefillWaterM3
	if src.PumpThrottle != nil {
		v := *src.PumpThrottle
		dst.PumpThrottle = &v
	}
	if src.AeratorThrottle != nil {
		v := *src.AeratorThrottle
		dst.AeratorThrottle = &v
	}
	if src.FanThrottle != nil {
		v := *src.FanThrottle
		dst.FanThrottle = &v
	}
}

func computeTickDuration(stepSeconds int, speedMultiplier float64) time.Duration {
	if stepSeconds <= 0 {
		stepSeconds = 300
	}
	if speedMultiplier <= 0 {
		speedMultiplier = 1.0
	}
	sec := float64(stepSeconds) / speedMultiplier
	d := time.Duration(sec * float64(time.Second))
	if d < time.Millisecond {
		d = time.Millisecond
	}
	return d
}

func cloneStatus(st domain.SimulationStatus) domain.SimulationStatus {
	cp := st
	if st.ActiveFaults != nil {
		cp.ActiveFaults = append([]domain.FaultSpec(nil), st.ActiveFaults...)
	} else {
		cp.ActiveFaults = []domain.FaultSpec{}
	}
	return cp
}

// Manager coordinates the single active in-memory simulation Runner and persistence Store.
// It also implements mcp.ReadOnlyObserver so the MCP server can query state without mutation access.
type Manager struct {
	mu     sync.RWMutex
	active *Runner
	engine PhysicsEngine
	store  store.Store
	clock  Clock
	logger *slog.Logger
}

func NewManager(engine PhysicsEngine, st store.Store, clk Clock, logger *slog.Logger) *Manager {
	if logger == nil {
		logger = slog.Default()
	}
	if clk == nil {
		clk = NewRealClock()
	}
	return &Manager{
		engine: engine,
		store:  st,
		clock:  clk,
		logger: logger,
	}
}

// CreateSimulation stops any previous active simulation runner, persists the new simulation row,
// and launches its single-owner actor loop.
func (m *Manager) CreateSimulation(
	ctx context.Context,
	farmID string,
	seed int64,
	stepSeconds int,
	mode domain.ClockMode,
	speedMultiplier float64,
) (domain.SimulationStatus, error) {
	farmRec, err := m.store.GetFarm(ctx, farmID)
	if err != nil {
		return domain.SimulationStatus{}, err
	}
	if stepSeconds <= 0 {
		stepSeconds = 300
	}
	if mode == "" {
		mode = domain.ClockPaused
	}
	if speedMultiplier <= 0 {
		speedMultiplier = 60.0
	}
	if speedMultiplier < 0.1 || speedMultiplier > 3600.0 {
		return domain.SimulationStatus{}, ErrInvalidSpeedMultiplier
	}

	now := m.clock.Now()
	status := domain.SimulationStatus{
		ID:              config.NewID(),
		FarmID:          farmID,
		Seed:            seed,
		StepSeconds:     stepSeconds,
		Mode:            mode,
		SpeedMultiplier: speedMultiplier,
		TickIndex:       0,
		SimTimeSec:      0,
		SimDays:         0,
		ActiveFaults:    []domain.FaultSpec{},
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if err := m.store.CreateSimulation(ctx, status); err != nil {
		return domain.SimulationStatus{}, fmt.Errorf("create simulation in store: %w", err)
	}

	m.mu.Lock()
	prev := m.active
	m.active = nil
	m.mu.Unlock()

	if prev != nil {
		_ = prev.Stop()
	}

	runner := StartRunner(context.Background(), status, farmRec.Spec, m.engine, m.store, m.clock, m.logger)

	m.mu.Lock()
	m.active = runner
	m.mu.Unlock()

	return runner.LatestSnapshot().Status, nil
}

// StopAll stops the active simulation runner cleanly on server shutdown.
func (m *Manager) StopAll() error {
	m.mu.Lock()
	active := m.active
	m.active = nil
	m.mu.Unlock()
	if active != nil {
		return active.Stop()
	}
	return nil
}

// ActiveRunner returns the active simulation Runner if its ID matches simID.
func (m *Manager) ActiveRunner(simID string) (*Runner, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.active != nil && m.active.ID() == simID {
		return m.active, true
	}
	return nil, false
}

// GetSimulation returns the lock-free snapshot status if active, or queries the persistence Store.
func (m *Manager) GetSimulation(ctx context.Context, simID string) (domain.SimulationStatus, error) {
	if r, ok := m.ActiveRunner(simID); ok {
		return r.LatestSnapshot().Status, nil
	}
	return m.store.GetSimulation(ctx, simID)
}

// GetGroundTruth returns the true conserved state for the active simulation.
func (m *Manager) GetGroundTruth(simID string) (domain.GroundTruthState, error) {
	r, ok := m.ActiveRunner(simID)
	if !ok {
		return domain.GroundTruthState{}, store.ErrNotFound
	}
	return r.LatestSnapshot().GroundTruth, nil
}

// GetFarm satisfies mcp.ReadOnlyObserver.
func (m *Manager) GetFarm(ctx context.Context, farmID string) (domain.FarmRecord, error) {
	return m.store.GetFarm(ctx, farmID)
}

// GetLatestReadings satisfies mcp.ReadOnlyObserver and serves GET /readings.
func (m *Manager) GetLatestReadings(ctx context.Context, simID, componentID, kind string, limit int) ([]domain.SensorReading, error) {
	filter := store.ReadingsFilter{
		SimulationID: simID,
		ComponentID:  componentID,
		Kind:         kind,
		Limit:        limit,
	}
	if r, ok := m.ActiveRunner(simID); ok {
		rds := r.RecentReadings(filter)
		if len(rds) > 0 {
			return rds, nil
		}
	}
	if _, err := m.store.GetSimulation(ctx, simID); err != nil {
		return nil, err
	}
	return m.store.QueryReadings(ctx, filter)
}

// ListAlerts satisfies mcp.ReadOnlyObserver.
func (m *Manager) ListAlerts(ctx context.Context, simID string, limit int) ([]domain.Alert, error) {
	if _, err := m.GetSimulation(ctx, simID); err != nil {
		return nil, err
	}
	return m.store.ListAlerts(ctx, simID, limit)
}

// ListCommands satisfies mcp.ReadOnlyObserver.
func (m *Manager) ListCommands(ctx context.Context, simID string, limit int) ([]domain.CommandRecord, error) {
	if _, err := m.GetSimulation(ctx, simID); err != nil {
		return nil, err
	}
	return m.store.ListCommands(ctx, simID, limit)
}

package store

import (
	"context"
	"errors"
	"sort"
	"sync"

	"github.com/abdelbaky/hydro/internal/domain"
)

// ErrNotFound is returned when a requested farm or simulation ID does not exist.
var ErrNotFound = errors.New("resource not found")

// ReadingsFilter defines query criteria for historical sensor readings.
type ReadingsFilter struct {
	SimulationID string
	ComponentID  string
	Kind         string
	FromSimSec   *float64
	ToSimSec     *float64
	Limit        int
}

// Store defines the persistence contract for farms, simulations, telemetry, alerts, and ML commands.
type Store interface {
	Ping(ctx context.Context) error

	CreateFarm(ctx context.Context, farm domain.FarmRecord) error
	GetFarm(ctx context.Context, id string) (domain.FarmRecord, error)
	ListFarms(ctx context.Context) ([]domain.FarmRecord, error)

	CreateSimulation(ctx context.Context, status domain.SimulationStatus) error
	UpdateSimulationStatus(ctx context.Context, status domain.SimulationStatus) error
	GetSimulation(ctx context.Context, id string) (domain.SimulationStatus, error)
	ListSimulations(ctx context.Context) ([]domain.SimulationStatus, error)

	AppendReadingsBatch(ctx context.Context, batch []domain.SensorReading) error
	QueryReadings(ctx context.Context, filter ReadingsFilter) ([]domain.SensorReading, error)

	CreateAlert(ctx context.Context, alert domain.Alert) error
	ListAlerts(ctx context.Context, simID string, limit int) ([]domain.Alert, error)

	CreateCommand(ctx context.Context, cmd domain.CommandRecord) error
	ListCommands(ctx context.Context, simID string, limit int) ([]domain.CommandRecord, error)
}

// MemoryStore is a thread-safe in-memory Store implementation for unit tests,
// CI pipelines, and zero-dependency local runs without Postgres.
type MemoryStore struct {
	mu          sync.RWMutex
	farms       map[string]domain.FarmRecord
	simulations map[string]domain.SimulationStatus
	readings    map[string][]domain.SensorReading
	alerts      map[string][]domain.Alert
	commands    map[string][]domain.CommandRecord
}

// NewMemoryStore initializes an empty thread-safe in-memory store.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		farms:       make(map[string]domain.FarmRecord),
		simulations: make(map[string]domain.SimulationStatus),
		readings:    make(map[string][]domain.SensorReading),
		alerts:      make(map[string][]domain.Alert),
		commands:    make(map[string][]domain.CommandRecord),
	}
}

func (m *MemoryStore) Ping(ctx context.Context) error {
	return ctx.Err()
}

func (m *MemoryStore) CreateFarm(ctx context.Context, farm domain.FarmRecord) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.farms[farm.ID] = cloneFarmRecord(farm)
	return nil
}

func (m *MemoryStore) GetFarm(ctx context.Context, id string) (domain.FarmRecord, error) {
	if err := ctx.Err(); err != nil {
		return domain.FarmRecord{}, err
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	rec, ok := m.farms[id]
	if !ok {
		return domain.FarmRecord{}, ErrNotFound
	}
	return cloneFarmRecord(rec), nil
}

func (m *MemoryStore) ListFarms(ctx context.Context) ([]domain.FarmRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]domain.FarmRecord, 0, len(m.farms))
	for _, f := range m.farms {
		out = append(out, cloneFarmRecord(f))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}

func (m *MemoryStore) CreateSimulation(ctx context.Context, status domain.SimulationStatus) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.farms[status.FarmID]; !ok {
		return ErrNotFound
	}
	m.simulations[status.ID] = cloneSimStatus(status)
	return nil
}

func (m *MemoryStore) UpdateSimulationStatus(ctx context.Context, status domain.SimulationStatus) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.simulations[status.ID]; !ok {
		return ErrNotFound
	}
	m.simulations[status.ID] = cloneSimStatus(status)
	return nil
}

func (m *MemoryStore) GetSimulation(ctx context.Context, id string) (domain.SimulationStatus, error) {
	if err := ctx.Err(); err != nil {
		return domain.SimulationStatus{}, err
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	st, ok := m.simulations[id]
	if !ok {
		return domain.SimulationStatus{}, ErrNotFound
	}
	return cloneSimStatus(st), nil
}

func (m *MemoryStore) ListSimulations(ctx context.Context) ([]domain.SimulationStatus, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]domain.SimulationStatus, 0, len(m.simulations))
	for _, s := range m.simulations {
		out = append(out, cloneSimStatus(s))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}

func (m *MemoryStore) AppendReadingsBatch(ctx context.Context, batch []domain.SensorReading) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(batch) == 0 {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range batch {
		cp := r
		if r.Value != nil {
			v := *r.Value
			cp.Value = &v
		}
		m.readings[r.SimulationID] = append(m.readings[r.SimulationID], cp)
	}
	return nil
}

func (m *MemoryStore) QueryReadings(ctx context.Context, filter ReadingsFilter) ([]domain.SensorReading, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	src := m.readings[filter.SimulationID]
	limit := filter.Limit
	if limit <= 0 || limit > 5000 {
		limit = 500
	}
	var out []domain.SensorReading
	// Iterate newest to oldest so limit returns the most recent matching readings.
	for i := len(src) - 1; i >= 0; i-- {
		r := src[i]
		if filter.ComponentID != "" && r.ComponentID != filter.ComponentID {
			continue
		}
		if filter.Kind != "" && r.Kind != filter.Kind {
			continue
		}
		if filter.FromSimSec != nil && r.SimTimeSec < *filter.FromSimSec {
			continue
		}
		if filter.ToSimSec != nil && r.SimTimeSec > *filter.ToSimSec {
			continue
		}
		cp := r
		if r.Value != nil {
			v := *r.Value
			cp.Value = &v
		}
		out = append(out, cp)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (m *MemoryStore) CreateAlert(ctx context.Context, alert domain.Alert) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alerts[alert.SimulationID] = append(m.alerts[alert.SimulationID], alert)
	return nil
}

func (m *MemoryStore) ListAlerts(ctx context.Context, simID string, limit int) ([]domain.Alert, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	src := m.alerts[simID]
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	out := make([]domain.Alert, 0, min(len(src), limit))
	for i := len(src) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, src[i])
	}
	return out, nil
}

func (m *MemoryStore) CreateCommand(ctx context.Context, cmd domain.CommandRecord) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := cmd
	if cmd.Payload.Throttle != nil {
		t := *cmd.Payload.Throttle
		cp.Payload.Throttle = &t
	}
	m.commands[cmd.SimulationID] = append(m.commands[cmd.SimulationID], cp)
	return nil
}

func (m *MemoryStore) ListCommands(ctx context.Context, simID string, limit int) ([]domain.CommandRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	src := m.commands[simID]
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	out := make([]domain.CommandRecord, 0, min(len(src), limit))
	for i := len(src) - 1; i >= 0 && len(out) < limit; i-- {
		cp := src[i]
		if cp.Payload.Throttle != nil {
			t := *cp.Payload.Throttle
			cp.Payload.Throttle = &t
		}
		out = append(out, cp)
	}
	return out, nil
}

func cloneFarmRecord(rec domain.FarmRecord) domain.FarmRecord {
	cp := rec
	cp.Spec.Channels = append([]domain.ChannelSpec(nil), rec.Spec.Channels...)
	cp.Spec.Sensors = append([]domain.SensorSpec(nil), rec.Spec.Sensors...)
	return cp
}

func cloneSimStatus(st domain.SimulationStatus) domain.SimulationStatus {
	cp := st
	if st.ActiveFaults != nil {
		cp.ActiveFaults = append([]domain.FaultSpec(nil), st.ActiveFaults...)
	} else {
		cp.ActiveFaults = []domain.FaultSpec{}
	}
	return cp
}

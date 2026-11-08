package store

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// PostgresStore implements Store backed by a PostgreSQL connection pool (pgx/v5).
type PostgresStore struct {
	pool *pgxpool.Pool
}

// NewPostgresStore connects to PostgreSQL and runs embedded SQL migrations.
func NewPostgresStore(ctx context.Context, dsn string) (*PostgresStore, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("create pgxpool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	s := &PostgresStore{pool: pool}
	if err := s.RunMigrations(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}
	return s, nil
}

// Close closes the underlying connection pool.
func (s *PostgresStore) Close() {
	if s.pool != nil {
		s.pool.Close()
	}
}

// RunMigrations executes embedded idempotent schema creation SQL.
func (s *PostgresStore) RunMigrations(ctx context.Context) error {
	sqlBytes, err := migrationFS.ReadFile("migrations/001_init.sql")
	if err != nil {
		return fmt.Errorf("read migration 001_init.sql: %w", err)
	}
	if _, err := s.pool.Exec(ctx, string(sqlBytes)); err != nil {
		return fmt.Errorf("exec migration 001_init.sql: %w", err)
	}
	return nil
}

func (s *PostgresStore) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *PostgresStore) CreateFarm(ctx context.Context, farm domain.FarmRecord) error {
	specJSON, err := json.Marshal(farm.Spec)
	if err != nil {
		return fmt.Errorf("marshal farm spec: %w", err)
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO farms (id, name, schema_version, spec, created_at)
		VALUES ($1, $2, $3, $4, $5)
	`, farm.ID, farm.Name, farm.SchemaVersion, specJSON, farm.CreatedAt)
	if err != nil {
		return fmt.Errorf("insert farm: %w", err)
	}
	return nil
}

func (s *PostgresStore) GetFarm(ctx context.Context, id string) (domain.FarmRecord, error) {
	var rec domain.FarmRecord
	var specJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, schema_version, spec, created_at
		FROM farms WHERE id = $1
	`, id).Scan(&rec.ID, &rec.Name, &rec.SchemaVersion, &specJSON, &rec.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.FarmRecord{}, ErrNotFound
		}
		return domain.FarmRecord{}, fmt.Errorf("select farm: %w", err)
	}
	if err := json.Unmarshal(specJSON, &rec.Spec); err != nil {
		return domain.FarmRecord{}, fmt.Errorf("unmarshal farm spec: %w", err)
	}
	return rec, nil
}

func (s *PostgresStore) ListFarms(ctx context.Context) ([]domain.FarmRecord, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, schema_version, spec, created_at
		FROM farms ORDER BY created_at DESC LIMIT 200
	`)
	if err != nil {
		return nil, fmt.Errorf("query farms: %w", err)
	}
	defer rows.Close()

	var out []domain.FarmRecord
	for rows.Next() {
		var rec domain.FarmRecord
		var specJSON []byte
		if err := rows.Scan(&rec.ID, &rec.Name, &rec.SchemaVersion, &specJSON, &rec.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan farm row: %w", err)
		}
		if err := json.Unmarshal(specJSON, &rec.Spec); err != nil {
			return nil, fmt.Errorf("unmarshal farm spec: %w", err)
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *PostgresStore) CreateSimulation(ctx context.Context, status domain.SimulationStatus) error {
	faultsJSON, err := json.Marshal(status.ActiveFaults)
	if err != nil {
		return fmt.Errorf("marshal active faults: %w", err)
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO simulations (
			id, farm_id, seed, step_seconds, mode, speed_multiplier,
			tick_index, sim_time_sec, active_faults, dropped_batches, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, status.ID, status.FarmID, status.Seed, status.StepSeconds, string(status.Mode),
		status.SpeedMultiplier, status.TickIndex, status.SimTimeSec, faultsJSON,
		status.DroppedBatches, status.CreatedAt, status.UpdatedAt)
	if err != nil {
		return fmt.Errorf("insert simulation: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateSimulationStatus(ctx context.Context, status domain.SimulationStatus) error {
	faultsJSON, err := json.Marshal(status.ActiveFaults)
	if err != nil {
		return fmt.Errorf("marshal active faults: %w", err)
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE simulations
		SET mode = $2, speed_multiplier = $3, tick_index = $4, sim_time_sec = $5,
		    active_faults = $6, dropped_batches = $7, updated_at = $8
		WHERE id = $1
	`, status.ID, string(status.Mode), status.SpeedMultiplier, status.TickIndex,
		status.SimTimeSec, faultsJSON, status.DroppedBatches, status.UpdatedAt)
	if err != nil {
		return fmt.Errorf("update simulation: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) GetSimulation(ctx context.Context, id string) (domain.SimulationStatus, error) {
	var st domain.SimulationStatus
	var mode string
	var faultsJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, farm_id, seed, step_seconds, mode, speed_multiplier,
		       tick_index, sim_time_sec, active_faults, dropped_batches, created_at, updated_at
		FROM simulations WHERE id = $1
	`, id).Scan(&st.ID, &st.FarmID, &st.Seed, &st.StepSeconds, &mode, &st.SpeedMultiplier,
		&st.TickIndex, &st.SimTimeSec, &faultsJSON, &st.DroppedBatches, &st.CreatedAt, &st.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.SimulationStatus{}, ErrNotFound
		}
		return domain.SimulationStatus{}, fmt.Errorf("select simulation: %w", err)
	}
	st.Mode = domain.ClockMode(mode)
	st.SimDays = st.SimTimeSec / 86400.0
	if err := json.Unmarshal(faultsJSON, &st.ActiveFaults); err != nil {
		return domain.SimulationStatus{}, fmt.Errorf("unmarshal active faults: %w", err)
	}
	return st, nil
}

func (s *PostgresStore) ListSimulations(ctx context.Context) ([]domain.SimulationStatus, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, farm_id, seed, step_seconds, mode, speed_multiplier,
		       tick_index, sim_time_sec, active_faults, dropped_batches, created_at, updated_at
		FROM simulations ORDER BY created_at DESC LIMIT 200
	`)
	if err != nil {
		return nil, fmt.Errorf("query simulations: %w", err)
	}
	defer rows.Close()

	var out []domain.SimulationStatus
	for rows.Next() {
		var st domain.SimulationStatus
		var mode string
		var faultsJSON []byte
		if err := rows.Scan(&st.ID, &st.FarmID, &st.Seed, &st.StepSeconds, &mode, &st.SpeedMultiplier,
			&st.TickIndex, &st.SimTimeSec, &faultsJSON, &st.DroppedBatches, &st.CreatedAt, &st.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan simulation: %w", err)
		}
		st.Mode = domain.ClockMode(mode)
		st.SimDays = st.SimTimeSec / 86400.0
		if err := json.Unmarshal(faultsJSON, &st.ActiveFaults); err != nil {
			return nil, fmt.Errorf("unmarshal active faults: %w", err)
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

// AppendReadingsBatch uses pgx.CopyFrom for high-throughput bulk telemetry ingestion.
func (s *PostgresStore) AppendReadingsBatch(ctx context.Context, batch []domain.SensorReading) error {
	if len(batch) == 0 {
		return nil
	}
	_, err := s.pool.CopyFrom(
		ctx,
		pgx.Identifier{"sensor_readings"},
		[]string{"simulation_id", "tick_index", "sim_time_sec", "sensor_id", "component_id", "kind", "value", "unit"},
		pgx.CopyFromSlice(len(batch), func(i int) ([]any, error) {
			r := batch[i]
			return []any{
				r.SimulationID,
				r.TickIndex,
				r.SimTimeSec,
				r.SensorID,
				r.ComponentID,
				r.Kind,
				r.Value,
				r.Unit,
			}, nil
		}),
	)
	if err != nil {
		return fmt.Errorf("copyfrom sensor_readings: %w", err)
	}
	return nil
}

func (s *PostgresStore) QueryReadings(ctx context.Context, filter ReadingsFilter) ([]domain.SensorReading, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 5000 {
		limit = 500
	}
	rows, err := s.pool.Query(ctx, `
		SELECT simulation_id, tick_index, sim_time_sec, sensor_id, component_id, kind, value, unit
		FROM sensor_readings
		WHERE simulation_id = $1
		  AND ($2 = '' OR component_id = $2)
		  AND ($3 = '' OR kind = $3)
		  AND ($4::double precision IS NULL OR sim_time_sec >= $4)
		  AND ($5::double precision IS NULL OR sim_time_sec <= $5)
		ORDER BY sim_time_sec DESC, sensor_id ASC
		LIMIT $6
	`, filter.SimulationID, filter.ComponentID, filter.Kind, filter.FromSimSec, filter.ToSimSec, limit)
	if err != nil {
		return nil, fmt.Errorf("query sensor_readings: %w", err)
	}
	defer rows.Close()

	var out []domain.SensorReading
	for rows.Next() {
		var r domain.SensorReading
		if err := rows.Scan(&r.SimulationID, &r.TickIndex, &r.SimTimeSec, &r.SensorID, &r.ComponentID, &r.Kind, &r.Value, &r.Unit); err != nil {
			return nil, fmt.Errorf("scan sensor_reading: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *PostgresStore) CreateAlert(ctx context.Context, alert domain.Alert) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO alerts (id, simulation_id, sim_time_sec, component_id, severity, code, message, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, alert.ID, alert.SimulationID, alert.SimTimeSec, alert.ComponentID, alert.Severity, alert.Code, alert.Message, alert.CreatedAt)
	if err != nil {
		return fmt.Errorf("insert alert: %w", err)
	}
	return nil
}

func (s *PostgresStore) ListAlerts(ctx context.Context, simID string, limit int) ([]domain.Alert, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, simulation_id, sim_time_sec, component_id, severity, code, message, created_at
		FROM alerts WHERE simulation_id = $1
		ORDER BY created_at DESC LIMIT $2
	`, simID, limit)
	if err != nil {
		return nil, fmt.Errorf("query alerts: %w", err)
	}
	defer rows.Close()

	var out []domain.Alert
	for rows.Next() {
		var a domain.Alert
		if err := rows.Scan(&a.ID, &a.SimulationID, &a.SimTimeSec, &a.ComponentID, &a.Severity, &a.Code, &a.Message, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan alert: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *PostgresStore) CreateCommand(ctx context.Context, cmd domain.CommandRecord) error {
	payloadJSON, err := json.Marshal(cmd.Payload)
	if err != nil {
		return fmt.Errorf("marshal command payload: %w", err)
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO commands (
			id, simulation_id, sim_time_sec, target_component_id, action,
			payload, reason, status, rejection_code, rejection_message, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, cmd.ID, cmd.SimulationID, cmd.SimTimeSec, cmd.TargetComponentID, string(cmd.Action),
		payloadJSON, cmd.Reason, string(cmd.Status), cmd.RejectionCode, cmd.RejectionMessage, cmd.CreatedAt)
	if err != nil {
		return fmt.Errorf("insert command: %w", err)
	}
	return nil
}

func (s *PostgresStore) ListCommands(ctx context.Context, simID string, limit int) ([]domain.CommandRecord, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, simulation_id, sim_time_sec, target_component_id, action,
		       payload, reason, status, COALESCE(rejection_code, ''), COALESCE(rejection_message, ''), created_at
		FROM commands WHERE simulation_id = $1
		ORDER BY created_at DESC LIMIT $2
	`, simID, limit)
	if err != nil {
		return nil, fmt.Errorf("query commands: %w", err)
	}
	defer rows.Close()

	var out []domain.CommandRecord
	for rows.Next() {
		var c domain.CommandRecord
		var action, status string
		var payloadJSON []byte
		if err := rows.Scan(&c.ID, &c.SimulationID, &c.SimTimeSec, &c.TargetComponentID, &action,
			&payloadJSON, &c.Reason, &status, &c.RejectionCode, &c.RejectionMessage, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan command: %w", err)
		}
		c.Action = domain.CommandAction(action)
		c.Status = domain.CommandStatus(status)
		if err := json.Unmarshal(payloadJSON, &c.Payload); err != nil {
			return nil, fmt.Errorf("unmarshal command payload: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

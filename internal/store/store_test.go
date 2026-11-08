package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/abdelbaky/hydro/internal/config"
	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/abdelbaky/hydro/internal/store"
)

func TestMemoryStore_CRUDAndFiltering(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemoryStore()

	farmID := config.NewID()
	farmRec := domain.FarmRecord{
		ID:            farmID,
		Name:          "Test Farm",
		SchemaVersion: domain.SchemaVersionV1,
		Spec:          domain.DefaultDemoFarm(),
		CreatedAt:     time.Now().UTC(),
	}
	if err := st.CreateFarm(ctx, farmRec); err != nil {
		t.Fatalf("CreateFarm failed: %v", err)
	}

	gotFarm, err := st.GetFarm(ctx, farmID)
	if err != nil {
		t.Fatalf("GetFarm failed: %v", err)
	}
	if gotFarm.Name != "Test Farm" {
		t.Fatalf("expected farm name 'Test Farm', got %q", gotFarm.Name)
	}

	simID := config.NewID()
	simStatus := domain.SimulationStatus{
		ID:              simID,
		FarmID:          farmID,
		Seed:            42,
		StepSeconds:     300,
		Mode:            domain.ClockPaused,
		SpeedMultiplier: 60.0,
		ActiveFaults:    []domain.FaultSpec{},
		CreatedAt:       time.Now().UTC(),
		UpdatedAt:       time.Now().UTC(),
	}
	if err := st.CreateSimulation(ctx, simStatus); err != nil {
		t.Fatalf("CreateSimulation failed: %v", err)
	}

	v1 := 1.45
	v2 := 5.82
	batch := []domain.SensorReading{
		{
			SimulationID: simID,
			TickIndex:    1,
			SimTimeSec:   300,
			SensorID:     "sen-ec-1",
			ComponentID:  "reservoir-1",
			Kind:         "EC",
			Value:        &v1,
			Unit:         "dS/m",
		},
		{
			SimulationID: simID,
			TickIndex:    1,
			SimTimeSec:   300,
			SensorID:     "sen-ph-1",
			ComponentID:  "reservoir-1",
			Kind:         "pH",
			Value:        &v2,
			Unit:         "pH",
		},
	}
	if err := st.AppendReadingsBatch(ctx, batch); err != nil {
		t.Fatalf("AppendReadingsBatch failed: %v", err)
	}

	ecReadings, err := st.QueryReadings(ctx, store.ReadingsFilter{
		SimulationID: simID,
		Kind:         "EC",
		Limit:        10,
	})
	if err != nil {
		t.Fatalf("QueryReadings failed: %v", err)
	}
	if len(ecReadings) != 1 || *ecReadings[0].Value != 1.45 {
		t.Fatalf("unexpected EC readings: %+v", ecReadings)
	}

	_, err = st.GetFarm(ctx, "nonexistent")
	if !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

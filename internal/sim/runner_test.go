package sim_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/abdelbaky/hydro/internal/config"
	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/abdelbaky/hydro/internal/physics"
	"github.com/abdelbaky/hydro/internal/sim"
	"github.com/abdelbaky/hydro/internal/store"
	"go.uber.org/goleak"
)

func TestRunner_ConcurrencyAndGoleak(t *testing.T) {
	defer goleak.VerifyNone(t)

	ctx := context.Background()
	memStore := store.NewMemoryStore()
	fakeClk := sim.NewFakeClock(time.Time{})
	eng := physics.NewEngine()
	mgr := sim.NewManager(eng, memStore, fakeClk, nil)

	farmID := config.NewID()
	err := memStore.CreateFarm(ctx, domain.FarmRecord{
		ID:            farmID,
		Name:          "Concurrency Test Farm",
		SchemaVersion: domain.SchemaVersionV1,
		Spec:          domain.DefaultDemoFarm(),
		CreatedAt:     fakeClk.Now(),
	})
	if err != nil {
		t.Fatalf("CreateFarm failed: %v", err)
	}

	status, err := mgr.CreateSimulation(ctx, farmID, 42, 300, domain.ClockRunning, 60.0)
	if err != nil {
		t.Fatalf("CreateSimulation failed: %v", err)
	}

	runner, ok := mgr.ActiveRunner(status.ID)
	if !ok {
		t.Fatalf("expected active runner for simulation %s", status.ID)
	}

	var wg sync.WaitGroup
	// Spawn concurrent readers, clock toggles, fault injections, and ML commands.
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			for j := 0; j < 15; j++ {
				fakeClk.Tick(5 * time.Second)
				snap := runner.LatestSnapshot()
				if snap == nil {
					t.Errorf("nil snapshot")
					return
				}
				_, _ = mgr.GetLatestReadings(ctx, status.ID, "reservoir-1", "EC", 10)
				if j%5 == 0 {
					_, _ = runner.SubmitCommand(ctx, domain.CommandRequest{
						TargetComponentID: "reservoir-1",
						Action:            domain.ActionDose,
						DoseStockAML:      5.0,
						DoseStockBML:      5.0,
						Reason:            "concurrent test dose",
					})
				}
			}
		}(i)
	}
	wg.Wait()

	// Synchronous advance
	advStatus, err := runner.Advance(ctx, 12)
	if err != nil {
		t.Fatalf("Advance failed: %v", err)
	}
	if advStatus.TickIndex < 12 {
		t.Fatalf("expected TickIndex >= 12, got %d", advStatus.TickIndex)
	}

	if err := mgr.StopAll(); err != nil {
		t.Fatalf("StopAll failed: %v", err)
	}
}

package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/abdelbaky/hydro/internal/api"
	"github.com/abdelbaky/hydro/internal/config"
	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/abdelbaky/hydro/internal/mcp"
	"github.com/abdelbaky/hydro/internal/physics"
	"github.com/abdelbaky/hydro/internal/sim"
	"github.com/abdelbaky/hydro/internal/store"
	"golang.org/x/sync/errgroup"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server exited with error", slog.String("error", err.Error()))
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.FromEnv()
	if err != nil {
		return err
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: cfg.LogLevel,
	}))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	var st store.Store
	var pgStore *store.PostgresStore
	if cfg.DatabaseURL != "" {
		pgStore, err = store.NewPostgresStore(ctx, cfg.DatabaseURL)
		if err != nil {
			return err
		}
		defer pgStore.Close()
		st = pgStore
		logger.Info("connected to PostgreSQL store and verified schema migrations")
	} else {
		st = store.NewMemoryStore()
		logger.Info("HYDRO_DATABASE_URL not set; running with in-memory store")
	}

	// Ensure at least one baseline demo farm exists for immediate quickstart exploration.
	existingFarms, err := st.ListFarms(ctx)
	if err == nil && len(existingFarms) == 0 {
		demoFarm := domain.DefaultDemoFarm()
		demoRec := domain.FarmRecord{
			ID:            config.NewID(),
			Name:          demoFarm.Name,
			SchemaVersion: demoFarm.SchemaVersion,
			Spec:          demoFarm,
			CreatedAt:     time.Now().UTC(),
		}
		if err := st.CreateFarm(ctx, demoRec); err == nil {
			logger.Info("seeded baseline Egyptian NFT lettuce demo farm",
				slog.String("farm_id", demoRec.ID),
				slog.String("name", demoRec.Name),
			)
		}
	}

	engine := physics.NewEngine()
	mgr := sim.NewManager(engine, st, sim.NewRealClock(), logger)
	mcpSrv := mcp.NewServer(mgr)
	apiSrv := api.NewServer(st, mgr, mcpSrv, cfg.MLAPIKey, logger)

	httpSrv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           apiSrv,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	eg, egCtx := errgroup.WithContext(ctx)

	eg.Go(func() error {
		logger.Info("starting Hydro HTTP + MCP server", slog.String("addr", cfg.HTTPAddr))
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	})

	eg.Go(func() error {
		<-egCtx.Done()
		logger.Info("shutting down Hydro HTTP server and active simulation runner")
		shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutCtx)
		return mgr.StopAll()
	})

	return eg.Wait()
}

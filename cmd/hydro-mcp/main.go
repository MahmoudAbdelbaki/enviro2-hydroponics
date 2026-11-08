package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/abdelbaky/hydro/internal/config"
	"github.com/abdelbaky/hydro/internal/domain"
	"github.com/abdelbaky/hydro/internal/mcp"
	"github.com/abdelbaky/hydro/internal/physics"
	"github.com/abdelbaky/hydro/internal/sim"
	"github.com/abdelbaky/hydro/internal/store"
)

func main() {
	// Log to stderr so stdout remains clean for JSON-RPC 2.0 MCP frames.
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelWarn,
	}))

	cfg, err := config.FromEnv()
	if err != nil {
		logger.Error("invalid configuration", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	var st store.Store
	if cfg.DatabaseURL != "" {
		pgStore, err := store.NewPostgresStore(ctx, cfg.DatabaseURL)
		if err != nil {
			logger.Error("postgres connection failed", slog.String("error", err.Error()))
			os.Exit(1)
		}
		defer pgStore.Close()
		st = pgStore
	} else {
		mem := store.NewMemoryStore()
		demo := domain.DefaultDemoFarm()
		_ = mem.CreateFarm(ctx, domain.FarmRecord{
			ID:            "00000000-0000-4000-8000-000000000001",
			Name:          demo.Name,
			SchemaVersion: demo.SchemaVersion,
			Spec:          demo,
			CreatedAt:     time.Now().UTC(),
		})
		st = mem
	}

	mgr := sim.NewManager(physics.NewEngine(), st, sim.NewRealClock(), logger)
	defer func() { _ = mgr.StopAll() }()

	srv := mcp.NewServer(mgr)
	if err := srv.ServeStdio(ctx, os.Stdin, os.Stdout); err != nil {
		logger.Error("stdio MCP server exited with error", slog.String("error", err.Error()))
		os.Exit(1)
	}
}

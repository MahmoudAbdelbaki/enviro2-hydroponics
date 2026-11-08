package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
)

// Config holds immutable application configuration parsed at startup.
type Config struct {
	HTTPAddr    string
	DatabaseURL string
	MLAPIKey    string
	LogLevel    slog.Level
}

// FromEnv parses environment variables into a validated Config struct.
func FromEnv() (Config, error) {
	addr := strings.TrimSpace(os.Getenv("HYDRO_HTTP_ADDR"))
	if addr == "" {
		addr = ":8080"
	}

	dbURL := strings.TrimSpace(os.Getenv("HYDRO_DATABASE_URL"))

	mlKey := strings.TrimSpace(os.Getenv("HYDRO_ML_API_KEY"))
	if mlKey == "" {
		mlKey = "dev-ml-secret-key"
	}
	if len(mlKey) < 8 {
		return Config{}, errors.New("HYDRO_ML_API_KEY must be at least 8 characters")
	}

	lvlStr := strings.ToLower(strings.TrimSpace(os.Getenv("HYDRO_LOG_LEVEL")))
	lvl := slog.LevelInfo
	switch lvlStr {
	case "", "info":
		lvl = slog.LevelInfo
	case "debug":
		lvl = slog.LevelDebug
	case "warn", "warning":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		return Config{}, fmt.Errorf("invalid HYDRO_LOG_LEVEL %q", lvlStr)
	}

	return Config{
		HTTPAddr:    addr,
		DatabaseURL: dbURL,
		MLAPIKey:    mlKey,
		LogLevel:    lvl,
	}, nil
}

// NewID generates an RFC 4122 v4 UUID string using crypto/rand without external dependencies.
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	)
}

package server

import (
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/langgenius/dify/dify-agent-runtime/internal/landlock"
)

const (
	DefaultListen                        = "127.0.0.1:8765"
	DefaultTimeoutSeconds                = 30.0
	DefaultMaxWaitTimeoutSeconds         = 600.0
	DefaultIdleFlushSeconds              = 0.5
	DefaultTerminalCols                  = 200
	DefaultTerminalRows                  = 50
	DefaultOutputLimitBytes              = 16 * 1024
	MaxOutputLimitBytes                  = 512 * 1024
	DefaultListLimit                     = 50
	MaxListLimit                         = 200
	DefaultTerminateGraceSeconds         = 10.0
	DefaultGCIntervalSeconds             = 60.0
	DefaultGCFinishedJobRetentionSeconds = 300.0
	DefaultPollInterval                  = 50 * time.Millisecond
	DefaultPipeMonitorInterval           = 1 * time.Second
	DefaultPipeReadyTimeout              = 10 * time.Second
	DefaultSQLiteBusyTimeoutMs           = 5000
	DefaultAuthTokenEnv                  = "SHELLCTL_AUTH_TOKEN"
	HealthStatus                         = "ok"
)

// Config holds runtime configuration for the shellctl server.
type Config struct {
	Listen                       string
	AuthToken                    string
	StateDir                     string
	RuntimeDir                   string
	GCInterval                   time.Duration
	GCFinishedJobRetention       time.Duration
	DefaultTimeout               time.Duration
	MaxWaitTimeout               time.Duration
	IdleFlushDuration            time.Duration
	DefaultCwd                   string
	DefaultTerminalCols          int
	DefaultTerminalRows          int
	DefaultListLimit             int
	MaxListLimit                 int
	DefaultOutputLimitBytes      int
	MaxOutputLimitBytes          int
	DefaultTerminateGraceSeconds float64
	PollInterval                 time.Duration
	PipeMonitorInterval          time.Duration
	PipeReadyTimeout             time.Duration
	SQLiteBusyTimeoutMs          int
	SanitizePtyCommand           []string
	RunnerExitCommand            []string
	EnablePathIsolation          bool
}

func isPathIsolationEnabled() bool {
	v, ok := os.LookupEnv(landlock.EnvEnablePathIsolation)
	if !ok {
		return true
	}
	return v == "true"
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() *Config {
	homeDir, _ := os.UserHomeDir()
	stateDir := defaultStateDir()
	runtimeDir := filepath.Join(stateDir, "runtime")

	cfg := &Config{
		Listen:                       DefaultListen,
		StateDir:                     stateDir,
		RuntimeDir:                   runtimeDir,
		GCInterval:                   time.Duration(DefaultGCIntervalSeconds * float64(time.Second)),
		GCFinishedJobRetention:       time.Duration(DefaultGCFinishedJobRetentionSeconds * float64(time.Second)),
		DefaultTimeout:               time.Duration(DefaultTimeoutSeconds * float64(time.Second)),
		MaxWaitTimeout:               time.Duration(DefaultMaxWaitTimeoutSeconds * float64(time.Second)),
		IdleFlushDuration:            time.Duration(DefaultIdleFlushSeconds * float64(time.Second)),
		DefaultCwd:                   homeDir,
		DefaultTerminalCols:          DefaultTerminalCols,
		DefaultTerminalRows:          DefaultTerminalRows,
		DefaultListLimit:             DefaultListLimit,
		MaxListLimit:                 MaxListLimit,
		DefaultOutputLimitBytes:      DefaultOutputLimitBytes,
		MaxOutputLimitBytes:          MaxOutputLimitBytes,
		DefaultTerminateGraceSeconds: DefaultTerminateGraceSeconds,
		PollInterval:                 DefaultPollInterval,
		PipeMonitorInterval:          DefaultPipeMonitorInterval,
		PipeReadyTimeout:             DefaultPipeReadyTimeout,
		SQLiteBusyTimeoutMs:          DefaultSQLiteBusyTimeoutMs,
		SanitizePtyCommand:           []string{"shellctl-sanitize-pty"},
		RunnerExitCommand:            []string{"shellctl-runner-exit"},
	}

	// Auth token from environment if not set explicitly
	if cfg.AuthToken == "" {
		cfg.AuthToken = os.Getenv(DefaultAuthTokenEnv)
	}

	// Path isolation (Landlock) is enabled by default; set
	// ENABLE_PATH_ISOLATION=false to disable.
	cfg.EnablePathIsolation = isPathIsolationEnabled()

	return cfg
}

// JobsDir returns the path to the jobs artifact directory.
func (c *Config) JobsDir() string {
	return filepath.Join(c.StateDir, "jobs")
}

// DBPath returns the path to the SQLite database.
func (c *Config) DBPath() string {
	return filepath.Join(c.StateDir, "shellctl.db")
}

// TmuxSocket returns the path to the dedicated tmux socket.
func (c *Config) TmuxSocket() string {
	return filepath.Join(c.RuntimeDir, "tmux.sock")
}

// RunnerPath returns the path to the installed runner script.
func (c *Config) RunnerPath() string {
	return filepath.Join(c.RuntimeDir, "bin", "shellctl-runner")
}

func defaultStateDir() string {
	if runtime.GOOS == "darwin" {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".local", "share", "shellctl")
	}
	if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
		return filepath.Join(xdg, "shellctl")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "shellctl")
}

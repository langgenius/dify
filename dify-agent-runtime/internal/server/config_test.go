package server

import (
	"os"
	"strings"
	"testing"
	"time"
)

func mustDefaultConfig(t *testing.T) *Config {
	t.Helper()
	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
	}
	return cfg
}

func TestDefaultConfig(t *testing.T) {
	cfg := mustDefaultConfig(t)
	if cfg.Listen != DefaultListen {
		t.Errorf("expected Listen=%s, got %s", DefaultListen, cfg.Listen)
	}
	if cfg.DefaultTerminalCols != DefaultTerminalCols {
		t.Errorf("expected cols=%d, got %d", DefaultTerminalCols, cfg.DefaultTerminalCols)
	}
	if cfg.DefaultTerminalRows != DefaultTerminalRows {
		t.Errorf("expected rows=%d, got %d", DefaultTerminalRows, cfg.DefaultTerminalRows)
	}
	if cfg.SQLiteBusyTimeoutMs != DefaultSQLiteBusyTimeoutMs {
		t.Errorf("expected busy_timeout=%d, got %d", DefaultSQLiteBusyTimeoutMs, cfg.SQLiteBusyTimeoutMs)
	}
}

func TestConfigPaths(t *testing.T) {
	cfg := mustDefaultConfig(t)
	cfg.StateDir = "/tmp/shellctl-test"
	cfg.RuntimeDir = "/tmp/shellctl-test/runtime"

	if cfg.JobsDir() != "/tmp/shellctl-test/jobs" {
		t.Errorf("unexpected JobsDir: %s", cfg.JobsDir())
	}
	if cfg.DBPath() != "/tmp/shellctl-test/shellctl.db" {
		t.Errorf("unexpected DBPath: %s", cfg.DBPath())
	}
	if cfg.TmuxSocket() != "/tmp/shellctl-test/runtime/tmux.sock" {
		t.Errorf("unexpected TmuxSocket: %s", cfg.TmuxSocket())
	}
	if cfg.RunnerPath() != "/tmp/shellctl-test/runtime/bin/shellctl-runner" {
		t.Errorf("unexpected RunnerPath: %s", cfg.RunnerPath())
	}
}

func TestConfigAuthTokenFromEnv(t *testing.T) {
	t.Setenv("SHELLCTL_AUTH_TOKEN", "my-secret-token")
	cfg := mustDefaultConfig(t)
	if cfg.AuthToken != "my-secret-token" {
		t.Errorf("expected auth token from env, got %q", cfg.AuthToken)
	}
}

func TestConfigNoAuthToken(t *testing.T) {
	t.Setenv("SHELLCTL_AUTH_TOKEN", "")
	cfg := mustDefaultConfig(t)
	if cfg.AuthToken != "" {
		t.Errorf("expected empty auth token, got %q", cfg.AuthToken)
	}
}

func TestDefaultConfigSnapshotFields(t *testing.T) {
	cfg := mustDefaultConfig(t)
	if cfg.SnapshotTimeout != 45*time.Second {
		t.Errorf("SnapshotTimeout = %v, want 45s", cfg.SnapshotTimeout)
	}
}

func TestSnapshotTimeoutDefaultsWhenEnvUnset(t *testing.T) {
	t.Setenv(SnapshotTimeoutEnv, "")
	_ = os.Unsetenv(SnapshotTimeoutEnv)
	cfg := mustDefaultConfig(t)
	if cfg.SnapshotTimeout != 45*time.Second {
		t.Errorf("SnapshotTimeout = %v, want 45s", cfg.SnapshotTimeout)
	}
}

func TestSnapshotTimeoutDefaultsWhenEnvEmpty(t *testing.T) {
	t.Setenv(SnapshotTimeoutEnv, "")
	cfg := mustDefaultConfig(t)
	if cfg.SnapshotTimeout != 45*time.Second {
		t.Errorf("SnapshotTimeout = %v, want 45s", cfg.SnapshotTimeout)
	}
}

func TestSnapshotTimeoutFromEnv(t *testing.T) {
	cases := []struct {
		raw  string
		want time.Duration
	}{
		{"900s", 900 * time.Second},
		{"15m", 15 * time.Minute},
		{"15m30s", 15*time.Minute + 30*time.Second},
		{"  15m  ", 15 * time.Minute},
	}
	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			t.Setenv(SnapshotTimeoutEnv, tc.raw)
			cfg := mustDefaultConfig(t)
			if cfg.SnapshotTimeout != tc.want {
				t.Errorf("SnapshotTimeout = %v, want %v", cfg.SnapshotTimeout, tc.want)
			}
		})
	}
}

func TestSnapshotTimeoutRejectsUnusableEnv(t *testing.T) {
	for _, raw := range []string{"fifteen minutes", "600", "10 m", "0", "0s", "-1s", "-5m"} {
		t.Run(raw, func(t *testing.T) {
			t.Setenv(SnapshotTimeoutEnv, raw)
			cfg, err := DefaultConfig()
			if err == nil {
				t.Fatalf("%q must fail startup, not run with a substituted timeout", raw)
			}
			if !strings.Contains(err.Error(), SnapshotTimeoutEnv) {
				t.Errorf("error %q must name %s so the operator knows what to fix", err, SnapshotTimeoutEnv)
			}
			if cfg != nil {
				t.Errorf("%q yielded a usable config; an unusable timeout must yield none", raw)
			}
		})
	}
}

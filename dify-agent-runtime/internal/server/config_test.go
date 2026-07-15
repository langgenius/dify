package server

import (
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()
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
	cfg := DefaultConfig()
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
	cfg := DefaultConfig()
	if cfg.AuthToken != "my-secret-token" {
		t.Errorf("expected auth token from env, got %q", cfg.AuthToken)
	}
}

func TestConfigNoAuthToken(t *testing.T) {
	t.Setenv("SHELLCTL_AUTH_TOKEN", "")
	cfg := DefaultConfig()
	if cfg.AuthToken != "" {
		t.Errorf("expected empty auth token, got %q", cfg.AuthToken)
	}
}

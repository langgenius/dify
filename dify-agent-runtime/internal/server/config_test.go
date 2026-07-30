package server

import (
	"testing"

	"github.com/langgenius/dify/dify-agent-runtime/internal/envvar"
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
	t.Setenv(envvar.EnvShellctlAuthToken, "my-secret-token")
	cfg := DefaultConfig()
	if cfg.AuthToken != "my-secret-token" {
		t.Errorf("expected auth token from env, got %q", cfg.AuthToken)
	}
}

func TestConfigNoAuthToken(t *testing.T) {
	t.Setenv(envvar.EnvShellctlAuthToken, "")
	cfg := DefaultConfig()
	if cfg.AuthToken != "" {
		t.Errorf("expected empty auth token, got %q", cfg.AuthToken)
	}
}

func TestConfigEgressProxySystemCredentialsFromEnv(t *testing.T) {
	t.Setenv(envvar.EnvEgressProxySystemCredentialsFile, "/etc/shellctl/system-credentials.json")
	cfg := DefaultConfig()
	if cfg.EgressProxySystemCredentials != "/etc/shellctl/system-credentials.json" {
		t.Errorf("expected system credentials path from env, got %q", cfg.EgressProxySystemCredentials)
	}
}

func TestConfigNoEgressProxySystemCredentials(t *testing.T) {
	t.Setenv(envvar.EnvEgressProxySystemCredentialsFile, "")
	cfg := DefaultConfig()
	if cfg.EgressProxySystemCredentials != "" {
		t.Errorf("expected empty system credentials path, got %q", cfg.EgressProxySystemCredentials)
	}
}

func TestConfigEgressProxySystemCredentialsDirFromEnv(t *testing.T) {
	t.Setenv(envvar.EnvEgressProxySystemCredentialsDir, "/etc/shellctl/credentials")
	cfg := DefaultConfig()
	if cfg.EgressProxySystemCredentialsDir != "/etc/shellctl/credentials" {
		t.Errorf("expected system credentials dir from env, got %q", cfg.EgressProxySystemCredentialsDir)
	}
}

func TestConfigNoEgressProxySystemCredentialsDir(t *testing.T) {
	t.Setenv(envvar.EnvEgressProxySystemCredentialsDir, "")
	cfg := DefaultConfig()
	if cfg.EgressProxySystemCredentialsDir != "" {
		t.Errorf("expected empty system credentials dir, got %q", cfg.EgressProxySystemCredentialsDir)
	}
}

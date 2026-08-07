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

// TestConfigEgressProxyUpstreamFromEnv is a regression test: without wiring
// SHELLCTL_EGRESSPROXY_UPSTREAM into Config.EgressProxyUpstream, the credproxy
// silently falls back to direct dialing (no upstream chaining), which breaks
// resolution of hostnames only reachable through the upstream SSRF proxy.
func TestConfigEgressProxyUpstreamFromEnv(t *testing.T) {
	t.Setenv(envvar.EnvEgressProxyUpstream, "http://agent_ssrf_proxy:3128")
	cfg := DefaultConfig()
	if cfg.EgressProxyUpstream != "http://agent_ssrf_proxy:3128" {
		t.Errorf("expected upstream proxy from env, got %q", cfg.EgressProxyUpstream)
	}
}

func TestConfigNoEgressProxyUpstream(t *testing.T) {
	t.Setenv(envvar.EnvEgressProxyUpstream, "")
	cfg := DefaultConfig()
	if cfg.EgressProxyUpstream != "" {
		t.Errorf("expected empty upstream proxy, got %q", cfg.EgressProxyUpstream)
	}
}

func TestConfigEgressProxyAddrFromEnv(t *testing.T) {
	t.Setenv(envvar.EnvEgressProxyAddr, "127.0.0.1:19090")
	cfg := DefaultConfig()
	if cfg.EgressProxyAddr != "127.0.0.1:19090" {
		t.Errorf("expected egress proxy addr from env, got %q", cfg.EgressProxyAddr)
	}
}

func TestConfigEgressProxyCADirFromEnv(t *testing.T) {
	t.Setenv(envvar.EnvEgressProxyCADir, "/etc/shellctl/ca")
	cfg := DefaultConfig()
	if cfg.EgressProxyCADir != "/etc/shellctl/ca" {
		t.Errorf("expected egress proxy CA dir from env, got %q", cfg.EgressProxyCADir)
	}
}

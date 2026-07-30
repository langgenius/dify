// Package envvar centralizes all environment variable constants used by the
// dify-agent-runtime binaries (shellctl, shellctl-runner, dify-agent CLI).
package envvar

import "os"

// --- Path Isolation (Landlock) ---

const (
	// EnvEnablePathIsolation controls whether Landlock is applied at all.
	EnvEnablePathIsolation = "SHELLCTL_ENABLE_PATH_ISOLATION"

	// EnvRWPaths overrides the default RW directories (comma-separated).
	EnvRWPaths = "SHELLCTL_LANDLOCK_RW_PATHS"

	// EnvROPaths overrides the default RO+exec directories (comma-separated).
	EnvROPaths = "SHELLCTL_LANDLOCK_RO_PATHS"

	// EnvRWDevPaths overrides the default device files (comma-separated).
	EnvRWDevPaths = "SHELLCTL_LANDLOCK_RW_DEV_PATHS"
)

// --- Agent Stub ---

const (
	// EnvAgentStubAPIBaseURL is the Agent Stub HTTP/gRPC endpoint.
	EnvAgentStubAPIBaseURL = "DIFY_AGENT_STUB_API_BASE_URL"

	// EnvAgentStubAuthJWE is the per-request JWE token for Agent Stub auth.
	EnvAgentStubAuthJWE = "DIFY_AGENT_STUB_AUTH_JWE"

	// EnvAgentStubDriveBase is the sandbox-local drive directory for the agent.
	EnvAgentStubDriveBase = "DIFY_AGENT_STUB_DRIVE_BASE"

	// DefaultDriveBase is the default Agent Stub drive mount point.
	// currently unused.
	DefaultDriveBase = "/mnt/drive"
)

// --- Egress Proxy ---

const (
	// EnvEgressProxyEnabled controls whether the in-process egress proxy is started.
	EnvEgressProxyEnabled = "SHELLCTL_EGRESSPROXY_ENABLED"

	// EnvEgressProxyAddr overrides the egress proxy listen address (default: 127.0.0.1:18080).
	EnvEgressProxyAddr = "SHELLCTL_EGRESSPROXY_ADDR"

	// EnvEgressProxyCADir overrides the directory for the auto-generated CA cert/key.
	EnvEgressProxyCADir = "SHELLCTL_EGRESSPROXY_CA_DIR"

	// EnvEgressProxyCACert is set per-job to the CA cert path for TLS trust.
	EnvEgressProxyCACert = "SHELLCTL_EGRESSPROXY_CA_CERT"

	// EnvEgressProxyUpstream overrides the upstream proxy URL (empty = direct).
	EnvEgressProxyUpstream = "SHELLCTL_EGRESSPROXY_UPSTREAM"

	// EnvEgressProxySystemCredentialsFile points to a JSON manifest of
	// system-level credentials (same shape as the PUT /v1/prepare body:
	// {"credentials": [...]}) that gets registered with the resolver at
	// startup, before any agent-backend-supplied credentials. Credentials
	// supplied later by agent-backend (via /v1/prepare or /v1/jobs/run)
	// override system entries that share the same "provider/name" ref.
	EnvEgressProxySystemCredentialsFile = "SHELLCTL_EGRESSPROXY_SYSTEM_CREDENTIALS_FILE"
)

// Legacy env var aliases for backward compatibility.
const (
	EnvCredProxyEnabled  = "SHELLCTL_CREDPROXY_ENABLED"
	EnvCredProxyAddr     = "SHELLCTL_CREDPROXY_ADDR"
	EnvCredProxyCADir    = "SHELLCTL_CREDPROXY_CA_DIR"
	EnvCredProxyCACert   = "SHELLCTL_CREDPROXY_CA_CERT"
	EnvCredProxyUpstream = "SHELLCTL_CREDPROXY_UPSTREAM"
)

// PathIsolationEnabled returns whether Landlock filesystem isolation is active.
func PathIsolationEnabled() bool {
	v, ok := os.LookupEnv(EnvEnablePathIsolation)
	if !ok {
		return true
	}
	return v == "true"
}

// SetPathIsolation explicitly enables or disables path isolation via env.
func SetPathIsolation(enabled bool) {
	if enabled {
		_ = os.Setenv(EnvEnablePathIsolation, "true")
	} else {
		_ = os.Setenv(EnvEnablePathIsolation, "false")
	}
}

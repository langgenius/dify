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
	// EnvAgentStubAPIBaseURL is the Agent Stub HTTP endpoint.
	EnvAgentStubAPIBaseURL = "DIFY_AGENT_STUB_API_BASE_URL"

	// EnvAgentStubAuthJWE is the per-request JWE token for Agent Stub auth.
	EnvAgentStubAuthJWE = "DIFY_AGENT_STUB_AUTH_JWE"
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

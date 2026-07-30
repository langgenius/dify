package server

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// RunJobRequest is the HTTP request body for POST /v1/jobs/run.
//
// Credentials are never passed here. Callers must first register them for a
// sandbox_id via PUT /v1/prepare, then reference them from the script/env
// using __secret:provider/name__ placeholders (resolved by the egress proxy
// at request time) or rely on the proxy's proactive header injection.
type RunJobRequest struct {
	Script string            `json:"script"`
	Cwd    *string           `json:"cwd,omitempty"`
	Env    map[string]string `json:"env,omitempty"`
	// SandboxID identifies which sandbox session's credentials (registered
	// via PUT /v1/prepare) apply to this job's egress traffic. Required when
	// the egress proxy is enabled; ignored otherwise.
	SandboxID        string        `json:"sandbox_id,omitempty"`
	Terminal         *TerminalSize `json:"terminal,omitempty"`
	Timeout          float64       `json:"timeout,omitempty"`
	OutputLimit      int           `json:"output_limit,omitempty"`
	IdleFlushSeconds float64       `json:"idle_flush_seconds,omitempty"`
}

// TerminalSize specifies the initial PTY geometry.
type TerminalSize struct {
	Cols int `json:"cols"`
	Rows int `json:"rows"`
}

// WaitJobRequest is the HTTP request body for POST /v1/jobs/{job_id}/wait.
type WaitJobRequest struct {
	Timeout          float64 `json:"timeout"`
	Offset           int     `json:"offset"`
	OutputLimit      int     `json:"output_limit,omitempty"`
	IdleFlushSeconds float64 `json:"idle_flush_seconds,omitempty"`
}

// InputJobRequest is the HTTP request body for POST /v1/jobs/{job_id}/input.
type InputJobRequest struct {
	Text             string  `json:"text"`
	Timeout          float64 `json:"timeout,omitempty"`
	Offset           int     `json:"offset"`
	OutputLimit      int     `json:"output_limit,omitempty"`
	IdleFlushSeconds float64 `json:"idle_flush_seconds,omitempty"`
}

// TerminateJobRequest is the HTTP request body for POST /v1/jobs/{job_id}/terminate.
type TerminateJobRequest struct {
	GraceSeconds *float64 `json:"grace_seconds,omitempty"`
}

// JobResult is the unified response for output-oriented job APIs.
type JobResult struct {
	JobID      string        `json:"job_id"`
	Done       bool          `json:"done"`
	Status     JobStatusName `json:"status"`
	ExitCode   *int          `json:"exit_code"`
	OutputPath string        `json:"output_path"`
	Output     string        `json:"output"`
	Offset     int           `json:"offset"`
	Truncated  bool          `json:"truncated"`
}

// JobStatusView is the materialized lifecycle view.
type JobStatusView struct {
	JobID     string        `json:"job_id"`
	Status    JobStatusName `json:"status"`
	Done      bool          `json:"done"`
	ExitCode  *int          `json:"exit_code"`
	CreatedAt string        `json:"created_at"`
	StartedAt *string       `json:"started_at"`
	EndedAt   *string       `json:"ended_at"`
	Offset    int           `json:"offset"`
}

// JobInfo is a compact job listing record.
type JobInfo struct {
	JobID     string        `json:"job_id"`
	Status    JobStatusName `json:"status"`
	CreatedAt string        `json:"created_at"`
	StartedAt *string       `json:"started_at,omitempty"`
	EndedAt   *string       `json:"ended_at,omitempty"`
}

// ListJobsResponse is the response for GET /v1/jobs.
type ListJobsResponse struct {
	Jobs []JobInfo `json:"jobs"`
}

// DeleteJobResponse is the response for DELETE /v1/jobs/{job_id}.
type DeleteJobResponse struct {
	JobID   string `json:"job_id"`
	Deleted bool   `json:"deleted"`
}

// HealthResponse is the health check response.
type HealthResponse struct {
	Status string `json:"status"`
}

// Credential represents a secret with its identity and injection policy.
type Credential struct {
	// Provider identifies the credential source (e.g. "github", "dify_agent_stub").
	Provider string `json:"provider" yaml:"provider"`
	// Name identifies the credential within the provider (e.g. "token", "auth_jwe").
	Name string `json:"name" yaml:"name"`
	// Value is the actual secret.
	Value string `json:"value" yaml:"value"`
	// Inject defines how the credential is automatically injected into HTTP requests.
	// If nil, the credential is only resolved via __secret:provider/name__ placeholders.
	Inject *InjectPolicy `json:"inject,omitempty" yaml:"inject,omitempty"`
	// EnvName overrides the environment variable name used to expose this
	// credential's __secret:provider/name__ placeholder to system-tier jobs
	// (see Service.systemCredentialPlaceholderEnv). If empty, a name is
	// derived from Provider and Name (e.g. "github"/"token" -> "GITHUB_TOKEN").
	// Only meaningful for system-tier credentials loaded via
	// LoadCredentialManifest; ignored for session credentials set via
	// PUT /v1/prepare.
	EnvName string `json:"env_name,omitempty" yaml:"env_name,omitempty"`
}

// InjectType enumerates supported credential injection strategies.
type InjectType string

const (
	// InjectTypeHTTPHeader injects the credential as an HTTP request header.
	InjectTypeHTTPHeader InjectType = "http-header"
)

// InjectPolicy defines how a credential is proactively injected into outbound HTTP requests.
// The Type field selects the strategy; exactly one corresponding payload field should be set.
type InjectPolicy struct {
	Type       InjectType        `json:"type" yaml:"type"`
	HTTPHeader *HTTPHeaderInject `json:"http_header,omitempty" yaml:"http_header,omitempty"`
}

// HTTPHeaderInject injects a credential value as an HTTP request header.
type HTTPHeaderInject struct {
	// Name is the HTTP header name (e.g. "Authorization", "X-API-Key").
	Name string `json:"name" yaml:"name"`
	// Expr is a Go text/template rendered with the credential value
	// available as {{.Value}} (e.g. "Bearer {{.Value}}").
	Expr string `json:"expr,omitempty" yaml:"expr,omitempty"`
	// Domains restricts injection to requests matching these host patterns.
	// Supports wildcard prefix (e.g. "*.github.com", "api.example.com").
	// Empty means inject on all domains.
	Domains []string `json:"domains,omitempty" yaml:"domains,omitempty"`
}

// Ref returns the canonical credential reference used in placeholders: "provider/name".
func (c *Credential) Ref() string {
	return c.Provider + "/" + c.Name
}

// PrepareRequest is the HTTP request body for PUT /v1/prepare.
//
// SandboxID scopes these credentials to one sandbox session: they are
// persisted to a session-specific file and made visible only to egress
// traffic from jobs run with the same sandbox_id (see RunJobRequest). They
// never affect the system tier or any other session.
type PrepareRequest struct {
	SandboxID   string       `json:"sandbox_id" yaml:"sandbox_id"`
	Credentials []Credential `json:"credentials" yaml:"credentials"`
}

// LoadCredentialManifest reads a credential manifest file (same shape as
// PrepareRequest: {"credentials": [...]}) and returns its credentials. It is
// used to seed the resolver with system-level credentials at startup, before
// any sandbox session credentials are registered.
//
// The format is chosen by the file extension: ".yaml"/".yml" is parsed as
// YAML, everything else (including ".json") is parsed as JSON.
func LoadCredentialManifest(path string) ([]Credential, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read credential manifest %s: %w", path, err)
	}
	var req PrepareRequest
	switch strings.ToLower(filepath.Ext(path)) {
	case ".yaml", ".yml":
		if err := yaml.Unmarshal(data, &req); err != nil {
			return nil, fmt.Errorf("parse credential manifest %s: %w", path, err)
		}
	default:
		if err := json.Unmarshal(data, &req); err != nil {
			return nil, fmt.Errorf("parse credential manifest %s: %w", path, err)
		}
	}
	return req.Credentials, nil
}

// LoadCredentialManifestDir reads all credential manifest files from a
// directory and returns the merged credentials. Files are sorted by name for
// deterministic load order. Only files with ".yaml", ".yml", or ".json"
// extensions are processed; all other files (including dotfiles, READMEs,
// .gitignore, etc.) are silently skipped.
//
// Later files override earlier ones on provider/name conflicts (last-wins),
// mirroring the session-shadows-system precedence used by the resolver.
func LoadCredentialManifestDir(dir string) ([]Credential, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read credential manifest dir %s: %w", dir, err)
	}

	var all []Credential
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if ext != ".yaml" && ext != ".yml" && ext != ".json" {
			continue
		}
		creds, err := LoadCredentialManifest(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		all = append(all, creds...)
	}
	return all, nil
}

// PrepareResponse is the response for PUT /v1/prepare.
type PrepareResponse struct {
	Registered int `json:"registered"`
}

// ErrorDetail is the machine-readable API error payload.
type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ErrorResponse is the error envelope.
type ErrorResponse struct {
	Error ErrorDetail `json:"error"`
}

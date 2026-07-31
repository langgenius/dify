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
// sandbox_id via PUT /v1/prepare; the egress proxy then proactively injects
// them into outbound HTTP requests based on each credential's inject policy.
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

// CredentialValue is the credential's secret value. For simple credentials
// this is a string; for structured credentials (e.g. AWS) this is a JSON
// object. It wraps json.RawMessage so the raw bytes are preserved and
// decoded by the injection policy at request time. It also implements
// yaml.Unmarshaler so YAML manifests can use plain strings or nested maps.
type CredentialValue json.RawMessage

// UnmarshalJSON implements json.Unmarshaler. It accepts the raw JSON bytes
// directly (string or object), preserving them for later decoding by the
// injection policy.
func (c *CredentialValue) UnmarshalJSON(data []byte) error {
	*c = CredentialValue(data)
	return nil
}

// UnmarshalYAML allows CredentialValue to be set from a YAML string or map.
// YAML strings are wrapped as JSON strings; YAML maps are re-encoded as JSON.
func (c *CredentialValue) UnmarshalYAML(node *yaml.Node) error {
	// Try string first.
	var s string
	if err := node.Decode(&s); err == nil {
		b, _ := json.Marshal(s)
		*c = CredentialValue(b)
		return nil
	}
	// Fall back to a generic map (structured credential).
	var m map[string]any
	if err := node.Decode(&m); err != nil {
		return fmt.Errorf("credential value: expected string or map, got %v", err)
	}
	b, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("credential value: marshal map: %w", err)
	}
	*c = CredentialValue(b)
	return nil
}

// Credential represents a secret with its identity and injection policy.
type Credential struct {
	// Provider identifies the credential source (e.g. "github", "dify_agent_stub").
	Provider string `json:"provider" yaml:"provider"`
	// Name identifies the credential within the provider (e.g. "token", "auth_jwe").
	Name string `json:"name" yaml:"name"`
	// Value is the actual secret. For simple credentials this is a string;
	// for structured credentials (e.g. AWS) this is a JSON object.
	Value CredentialValue `json:"value" yaml:"value"`
	// Inject defines how the credential is automatically injected into HTTP
	// requests by the egress proxy. Required for the credential to take effect
	// at the network layer.
	Inject *InjectPolicy `json:"inject,omitempty" yaml:"inject,omitempty"`
	// EnvName overrides the environment variable name used to expose this
	// credential's __secret:provider/name__ placeholder to jobs. If empty,
	// a name is derived from Provider and Name.
	EnvName string `json:"env_name,omitempty" yaml:"env_name,omitempty"`
	// EnvNames exposes the credential's __secret:provider/name__ placeholder
	// under multiple environment variable names. This is useful for
	// structured credentials that need to populate several standard env vars
	// (e.g. AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN all
	// pointing to the same placeholder). If both EnvName and EnvNames are
	// set, all names are used.
	EnvNames []string `json:"env_names,omitempty" yaml:"env_names,omitempty"`
}

// InjectType enumerates supported credential injection strategies.
// The actual set of supported types is determined at runtime by the
// providers registry.
type InjectType string

// InjectPolicy defines how a credential is proactively injected into
// outbound HTTP requests. Type selects the strategy; Config holds the
// raw JSON payload that the corresponding provider package decodes.
type InjectPolicy struct {
	Type   InjectType      `json:"type" yaml:"type"`
	Config json.RawMessage `json:"config,omitempty" yaml:"config,omitempty"`
}

// UnmarshalYAML decodes Type and converts the config map to JSON bytes,
// since json.RawMessage cannot be populated directly from YAML.
func (i *InjectPolicy) UnmarshalYAML(node *yaml.Node) error {
	// Walk the mapping nodes manually — yaml.v3 doesn't reliably populate
	// *yaml.Node fields via struct decode.
	var cfgNode *yaml.Node
	for j := 0; j < len(node.Content)-1; j += 2 {
		key := node.Content[j].Value
		val := node.Content[j+1]
		switch key {
		case "type":
			if err := val.Decode(&i.Type); err != nil {
				return fmt.Errorf("inject: parse type: %w", err)
			}
		case "config":
			cfgNode = val
		}
	}
	if cfgNode == nil {
		return nil
	}
	var v any
	if err := cfgNode.Decode(&v); err != nil {
		return fmt.Errorf("inject: decode config: %w", err)
	}
	jb, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("inject: marshal config to json: %w", err)
	}
	i.Config = jb
	return nil
}

// Ref returns the canonical credential reference: "provider/name".
func (c *Credential) Ref() string {
	return c.Provider + "/" + c.Name
}

// PrepareRequest is the HTTP request body for PUT /v1/prepare.
// SandboxID scopes these credentials to one sandbox session.
type PrepareRequest struct {
	SandboxID   string       `json:"sandbox_id" yaml:"sandbox_id"`
	Credentials []Credential `json:"credentials" yaml:"credentials"`
}

// LoadCredentialManifest reads a credential manifest file and returns its
// credentials. Format is chosen by file extension: .yaml/.yml as YAML,
// everything else as JSON.
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
// directory and returns the merged credentials. Only .yaml/.yml/.json files
// are processed. Later files override earlier ones on provider/name conflicts.
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

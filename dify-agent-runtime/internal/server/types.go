package server

// RunJobRequest is the HTTP request body for POST /v1/jobs/run.
type RunJobRequest struct {
	Script           string            `json:"script"`
	Cwd              *string           `json:"cwd,omitempty"`
	Env              map[string]string `json:"env,omitempty"`
	Credentials      []Credential      `json:"credentials,omitempty"`
	Terminal         *TerminalSize     `json:"terminal,omitempty"`
	Timeout          float64           `json:"timeout,omitempty"`
	OutputLimit      int               `json:"output_limit,omitempty"`
	IdleFlushSeconds float64           `json:"idle_flush_seconds,omitempty"`
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
	Provider string `json:"provider"`
	// Name identifies the credential within the provider (e.g. "token", "auth_jwe").
	Name string `json:"name"`
	// Value is the actual secret.
	Value string `json:"value"`
	// Inject defines how the credential is automatically injected into HTTP requests.
	// If nil, the credential is only resolved via __secret:provider/name__ placeholders.
	Inject *InjectPolicy `json:"inject,omitempty"`
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
	Type       InjectType        `json:"type"`
	HTTPHeader *HTTPHeaderInject `json:"http_header,omitempty"`
}

// HTTPHeaderInject injects a credential value as an HTTP request header.
type HTTPHeaderInject struct {
	// Name is the HTTP header name (e.g. "Authorization", "X-API-Key").
	Name string `json:"name"`
	// Prefix is prepended to the credential value (e.g. "Bearer ", "token ").
	Prefix string `json:"prefix,omitempty"`
	// Domains restricts injection to requests matching these host patterns.
	// Supports wildcard prefix (e.g. "*.github.com", "api.example.com").
	// Empty means inject on all domains.
	Domains []string `json:"domains,omitempty"`
}

// Ref returns the canonical credential reference used in placeholders: "provider/name".
func (c *Credential) Ref() string {
	return c.Provider + "/" + c.Name
}

// PrepareRequest is the HTTP request body for PUT /v1/prepare.
type PrepareRequest struct {
	Credentials []Credential `json:"credentials"`
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

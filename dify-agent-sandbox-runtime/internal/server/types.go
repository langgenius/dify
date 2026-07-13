package server

// RunJobRequest is the HTTP request body for POST /v1/jobs/run.
type RunJobRequest struct {
	Script           string            `json:"script"`
	Cwd              *string           `json:"cwd,omitempty"`
	Env              map[string]string `json:"env,omitempty"`
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
	GraceSeconds float64 `json:"grace_seconds,omitempty"`
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

// ErrorDetail is the machine-readable API error payload.
type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ErrorResponse is the error envelope.
type ErrorResponse struct {
	Error ErrorDetail `json:"error"`
}

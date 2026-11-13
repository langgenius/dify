package server

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"
)

// JobID is a validated shellctl job identifier (16 lowercase hexadecimal characters).
// Use ParseJobID for caller-supplied strings and GenerateJobID for new jobs.
type JobID string

// GenerateJobID produces a random job identifier with 16 lowercase hexadecimal characters.
func GenerateJobID() JobID {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return JobID(hex.EncodeToString(b))
}

// ParseJobID validates an external job identifier without normalizing it.
// Malformed IDs return a 400 invalid_job_id ServerError.
func ParseJobID(raw string) (JobID, error) {
	if len(raw) != 16 {
		return "", NewServerError(http.StatusBadRequest, "invalid_job_id", "job id must be 16 lowercase hexadecimal characters")
	}
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return "", NewServerError(http.StatusBadRequest, "invalid_job_id", "job id must be 16 lowercase hexadecimal characters")
		}
	}
	return JobID(raw), nil
}

// FormatTimestamp returns an ISO-8601 UTC timestamp string.
func FormatTimestamp(t time.Time) string {
	return t.UTC().Truncate(time.Second).Format("2006-01-02T15:04:05Z")
}

// ParseTimestamp parses an ISO-8601 UTC timestamp.
func ParseTimestamp(s string) (time.Time, error) {
	return time.Parse("2006-01-02T15:04:05Z", s)
}

// JobSessionName returns the tmux session name for a job.
func JobSessionName(jobID JobID) string {
	return fmt.Sprintf("shellctl-%s", jobID)
}

// JobPaneTarget returns the tmux pane target for a job.
func JobPaneTarget(jobID JobID) string {
	return fmt.Sprintf("%s:0.0", JobSessionName(jobID))
}

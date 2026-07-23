package server

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"regexp"
	"time"
)

var jobIDPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)

// GenerateJobID produces a short random hex job identifier.
func GenerateJobID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ValidateJobID enforces the exact lowercase hexadecimal format produced by
// GenerateJobID before a caller can use the value in tmux targets or paths.
func ValidateJobID(jobID string) error {
	if !jobIDPattern.MatchString(jobID) {
		return NewServerError(400, "invalid_job_id", "job id must be exactly 16 lowercase hexadecimal characters")
	}
	return nil
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
func JobSessionName(jobID string) string {
	return fmt.Sprintf("shellctl-%s", jobID)
}

// JobPaneTarget returns the tmux pane target for a job.
func JobPaneTarget(jobID string) string {
	return fmt.Sprintf("%s:0.0", JobSessionName(jobID))
}

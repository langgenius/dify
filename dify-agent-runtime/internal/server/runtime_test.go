package server

import (
	"net/http"
	"testing"
	"time"
)

func TestGenerateJobID(t *testing.T) {
	id1 := GenerateJobID()
	id2 := GenerateJobID()
	if id1 == id2 {
		t.Error("expected different job IDs")
	}
	if len(id1) != 16 {
		t.Errorf("expected 16-char hex ID, got %d chars: %s", len(id1), id1)
	}
}

func TestGenerateJobIDUniqueness(t *testing.T) {
	seen := make(map[string]bool, 1000)
	for i := 0; i < 1000; i++ {
		id := GenerateJobID()
		if seen[id] {
			t.Fatalf("collision at iteration %d: %s", i, id)
		}
		seen[id] = true
	}
}

func TestValidateJobID(t *testing.T) {
	tests := []struct {
		name    string
		jobID   string
		wantErr bool
	}{
		{name: "generated", jobID: GenerateJobID()},
		{name: "known valid", jobID: "0123456789abcdef"},
		{name: "empty", jobID: "", wantErr: true},
		{name: "too short", jobID: "0123456789abcde", wantErr: true},
		{name: "too long", jobID: "0123456789abcdef0", wantErr: true},
		{name: "uppercase", jobID: "0123456789ABCDEf", wantErr: true},
		{name: "path separator", jobID: "0123456789abc/de", wantErr: true},
		{name: "backslash", jobID: `0123456789abc\de`, wantErr: true},
		{name: "dot dot", jobID: "../../etc/passwd", wantErr: true},
		{name: "absolute path", jobID: "/tmp/shellctl-job", wantErr: true},
		{name: "whitespace", jobID: "0123456789abcde ", wantErr: true},
		{name: "shell metacharacter", jobID: "0123456789abcde;", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateJobID(tt.jobID)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ValidateJobID(%q) error = %v, wantErr %v", tt.jobID, err, tt.wantErr)
			}
			if tt.wantErr {
				serverErr, ok := err.(*ServerError)
				if !ok {
					t.Fatalf("expected *ServerError, got %T", err)
				}
				if serverErr.StatusCode != http.StatusBadRequest || serverErr.Code != "invalid_job_id" {
					t.Fatalf("unexpected error: %#v", serverErr)
				}
			}
		})
	}
}

func TestFormatTimestamp(t *testing.T) {
	ts := time.Date(2025, 1, 15, 12, 30, 45, 0, time.UTC)
	formatted := FormatTimestamp(ts)
	expected := "2025-01-15T12:30:45Z"
	if formatted != expected {
		t.Errorf("expected %q, got %q", expected, formatted)
	}
}

func TestParseTimestamp(t *testing.T) {
	parsed, err := ParseTimestamp("2025-01-15T12:30:45Z")
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	if parsed.Year() != 2025 || parsed.Month() != 1 || parsed.Day() != 15 {
		t.Errorf("unexpected parsed time: %v", parsed)
	}
	if parsed.Hour() != 12 || parsed.Minute() != 30 || parsed.Second() != 45 {
		t.Errorf("unexpected parsed time: %v", parsed)
	}
}

func TestParseTimestampInvalid(t *testing.T) {
	_, err := ParseTimestamp("not-a-timestamp")
	if err == nil {
		t.Error("expected error for invalid timestamp")
	}
}

func TestJobSessionName(t *testing.T) {
	name := JobSessionName("abc123")
	if name != "shellctl-abc123" {
		t.Errorf("expected 'shellctl-abc123', got %q", name)
	}
}

func TestJobPaneTarget(t *testing.T) {
	target := JobPaneTarget("abc123")
	if target != "shellctl-abc123:0.0" {
		t.Errorf("expected 'shellctl-abc123:0.0', got %q", target)
	}
}

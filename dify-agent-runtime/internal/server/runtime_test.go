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
	seen := make(map[JobID]bool, 1000)
	for i := 0; i < 1000; i++ {
		id := GenerateJobID()
		parsed, err := ParseJobID(string(id))
		if err != nil || parsed != id {
			t.Fatalf("generated ID %q did not round-trip: parsed=%q err=%v", id, parsed, err)
		}
		if seen[id] {
			t.Fatalf("collision at iteration %d: %s", i, id)
		}
		seen[id] = true
	}
}

func TestParseJobID(t *testing.T) {
	for _, raw := range []string{"0000000000000000", "0123456789012345", "abcdefabcdefabcd", "0123456789abcdef", "ffffffffffffffff"} {
		t.Run(raw, func(t *testing.T) {
			id, err := ParseJobID(raw)
			if err != nil {
				t.Fatalf("ParseJobID(%q): %v", raw, err)
			}
			if string(id) != raw {
				t.Errorf("ParseJobID(%q) = %q", raw, id)
			}
		})
	}
}

func TestParseJobIDRejectsMalformedIDs(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{"empty", ""},
		{"short", "0123456789abcde"},
		{"long", "0123456789abcdef0"},
		{"uppercase", "0123456789abcdeF"},
		{"non-hex", "0123456789abcdeg"},
		{"slash", "0123456789abcde/"},
		{"backslash", "0123456789abcde\\"},
		{"traversal", "../../etc/passwd"},
		{"absolute-path", "/tmp/shellctl-job"},
		{"leading-dash", "-123456789abcdef"},
		{"leading-space", " 123456789abcdef"},
		{"trailing-space", "0123456789abcde "},
		{"tab", "0123456789abcde\t"},
		{"newline", "0123456789abcde\n"},
		{"nul", "0123456789abcde\x00"},
		{"control", "0123456789abcde\x01"},
		{"semicolon", "0123456789abcde;"},
		{"colon", "0123456789abcde:"},
		{"dot", "0123456789abcde."},
		{"dollar", "0123456789abcde$"},
		{"single-quote", "0123456789abcde'"},
		{"double-quote", "0123456789abcde\""},
		{"non-ascii", "0123456789abcdé"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, err := ParseJobID(tt.raw)
			if id != "" {
				t.Errorf("expected empty ID on failure, got %q", id)
			}
			se, ok := err.(*ServerError)
			if !ok {
				t.Fatalf("expected ServerError, got %v", err)
			}
			if se.StatusCode != http.StatusBadRequest || se.Code != "invalid_job_id" {
				t.Errorf("expected 400 invalid_job_id, got %v", se)
			}
			if se.Message != "job id must be 16 lowercase hexadecimal characters" {
				t.Errorf("unexpected error message: %q", se.Message)
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

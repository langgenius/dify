package server

import (
	"testing"
)

func TestShellQuote(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"hello", "'hello'"},
		{"", "''"},
		{"a b c", "'a b c'"},
		{"it's", "'it'\\''s'"},
		{"/path/to/file", "'/path/to/file'"},
	}

	for _, tc := range tests {
		got := shellQuote(tc.input)
		if got != tc.expected {
			t.Errorf("shellQuote(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestShellJoin(t *testing.T) {
	got := shellJoin([]string{"echo", "hello world", "it's"})
	expected := "'echo' 'hello world' 'it'\\''s'"
	if got != expected {
		t.Errorf("shellJoin = %q, want %q", got, expected)
	}
}

func TestIsTmuxTargetMissing(t *testing.T) {
	missingMsgs := []string{
		"can't find pane: shellctl-abc",
		"can't find session: shellctl-abc",
		"no server running on /tmp/tmux.sock",
		"failed to connect to server",
		"server exited unexpectedly",
	}
	for _, msg := range missingMsgs {
		if !isTmuxTargetMissing(msg) {
			t.Errorf("expected %q to be detected as target missing", msg)
		}
	}

	validMsgs := []string{
		"some other error",
		"permission denied",
		"",
	}
	for _, msg := range validMsgs {
		if isTmuxTargetMissing(msg) {
			t.Errorf("expected %q to NOT be detected as target missing", msg)
		}
	}
}

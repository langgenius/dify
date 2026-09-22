package server

import (
	"os/exec"
	"strings"
	"testing"
)

func newTestTmuxController(t *testing.T) *TmuxController {
	t.Helper()

	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux is not installed")
	}

	config := mustDefaultConfig(t)
	config.RuntimeDir = t.TempDir()
	controller := NewTmuxController(config)
	t.Cleanup(func() {
		_, _ = controller.runTmuxNoCheck("kill-server")
	})

	return controller
}

func assertTmuxServerRunning(t *testing.T, controller *TmuxController) {
	t.Helper()

	exitEmpty, err := controller.runTmux("show-options", "-gv", "exit-empty")
	if err != nil {
		t.Fatalf("tmux server is not running: %v", err)
	}
	if got := strings.TrimSpace(exitEmpty); got != "off" {
		t.Fatalf("exit-empty = %q, want %q", got, "off")
	}
}

func TestStartServerKeepsTmuxServerRunningWithoutSessions(t *testing.T) {
	controller := newTestTmuxController(t)

	if err := controller.StartServer(); err != nil {
		t.Fatalf("StartServer() error = %v", err)
	}

	assertTmuxServerRunning(t, controller)

	sessions, err := controller.ListSessions()
	if err != nil {
		t.Fatalf("ListSessions() error = %v", err)
	}
	if len(sessions) != 0 {
		t.Fatalf("ListSessions() = %v, want no sessions", sessions)
	}
}

func TestTmuxServerRemainsRunningAfterLastSessionIsDeleted(t *testing.T) {
	controller := newTestTmuxController(t)

	if err := controller.StartServer(); err != nil {
		t.Fatalf("StartServer() error = %v", err)
	}

	const jobID = "last-session"
	sessionName := JobSessionName(jobID)
	if _, err := controller.runTmux("new-session", "-d", "-s", sessionName); err != nil {
		t.Fatalf("create tmux session: %v", err)
	}

	sessions, err := controller.ListSessions()
	if err != nil {
		t.Fatalf("ListSessions() before cleanup error = %v", err)
	}
	if !sessions[sessionName] {
		t.Fatalf("ListSessions() = %v, want session %q", sessions, sessionName)
	}

	controller.CleanupSession(jobID)
	assertTmuxServerRunning(t, controller)

	sessions, err = controller.ListSessions()
	if err != nil {
		t.Fatalf("ListSessions() after cleanup error = %v", err)
	}
	if len(sessions) != 0 {
		t.Fatalf("ListSessions() after cleanup = %v, want no sessions", sessions)
	}
}

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

package server

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// TmuxController manages tmux sessions for shellctl jobs via a dedicated socket.
type TmuxController struct {
	config *Config
}

// NewTmuxController creates a new tmux controller.
func NewTmuxController(config *Config) *TmuxController {
	return &TmuxController{config: config}
}

// StartServer ensures the tmux server is running.
func (t *TmuxController) StartServer() error {
	_, err := t.runTmux("start-server")
	return err
}

// ListSessions returns the set of active tmux session names.
func (t *TmuxController) ListSessions() (map[string]bool, error) {
	result, err := t.runTmuxNoCheck("list-sessions", "-F", "#{session_name}")
	if err != nil {
		return nil, err
	}
	if result.exitCode != 0 {
		stderr := strings.TrimSpace(result.stderr)
		if isTmuxTargetMissing(stderr) {
			return make(map[string]bool), nil
		}
		return nil, NewServerError(500, "tmux_error", stderr)
	}
	sessions := make(map[string]bool)
	for _, line := range strings.Split(strings.TrimSpace(result.stdout), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			sessions[line] = true
		}
	}
	return sessions, nil
}

// SessionExists checks if a tmux session exists by name.
func (t *TmuxController) SessionExists(sessionName string) (bool, error) {
	sessions, err := t.ListSessions()
	if err != nil {
		return false, err
	}
	return sessions[sessionName], nil
}

// IsOutputPipeActive checks the #{pane_pipe} format variable for a job pane.
// Returns: true=active, false=inactive, error with nil bool if pane missing.
func (t *TmuxController) IsOutputPipeActive(jobID string) (*bool, error) {
	result, err := t.runTmuxNoCheck(
		"display-message", "-p", "-t", JobPaneTarget(jobID), "#{pane_pipe}",
	)
	if err != nil {
		return nil, err
	}
	if result.exitCode != 0 {
		stderr := strings.TrimSpace(result.stderr)
		if isTmuxTargetMissing(stderr) {
			return nil, nil // pane missing
		}
		return nil, NewServerError(500, "tmux_error", stderr)
	}
	active := strings.TrimSpace(result.stdout) == "1"
	return &active, nil
}

// CreateJobSession creates a new tmux session for a job.
func (t *TmuxController) CreateJobSession(jobID, jobDir, cwd string, cols, rows int) error {
	runnerCmd := shellJoin([]string{
		t.config.RunnerPath(), jobDir, jobID, cwd,
	})
	result, err := t.runTmuxNoCheck(
		"-f", "/dev/null",
		"new-session", "-d",
		"-s", JobSessionName(jobID),
		"-x", fmt.Sprintf("%d", cols),
		"-y", fmt.Sprintf("%d", rows),
		runnerCmd,
	)
	if err != nil {
		return err
	}
	if result.exitCode != 0 {
		return NewServerError(500, "tmux_new_session_failed",
			strings.TrimSpace(result.stderr))
	}
	return nil
}

// EnableOutputPipe attaches the sanitize→output pipeline via tmux pipe-pane.
func (t *TmuxController) EnableOutputPipe(jobID, jobDir string, readyFile string) error {
	pipeCmd := t.buildPipeCommand(jobID, jobDir, readyFile)
	result, err := t.runTmuxNoCheck(
		"pipe-pane", "-o", "-t", JobPaneTarget(jobID), pipeCmd,
	)
	if err != nil {
		return err
	}
	if result.exitCode != 0 {
		return NewServerError(500, "pipe_failed",
			strings.TrimSpace(result.stderr))
	}
	return nil
}

// SendInput sends text to a job's tmux pane via load-buffer + paste-buffer.
func (t *TmuxController) SendInput(jobID, text string) error {
	bufferName := fmt.Sprintf("shellctl-in-%s", jobID)

	// Write input to a temp file
	tmpFile, err := os.CreateTemp(t.config.RuntimeDir, fmt.Sprintf("shellctl-input-%s-", jobID))
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer func() { _ = os.Remove(tmpPath) }()

	if _, err := tmpFile.WriteString(text); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	// Load buffer
	result, err := t.runTmuxNoCheck("load-buffer", "-b", bufferName, tmpPath)
	if err != nil {
		return err
	}
	if result.exitCode != 0 {
		stderr := strings.TrimSpace(result.stderr)
		if isTmuxTargetMissing(stderr) {
			return NewServerError(409, "tmux_target_missing", stderr)
		}
		return NewServerError(500, "tmux_input_failed", stderr)
	}

	// Paste buffer
	result, err = t.runTmuxNoCheck(
		"paste-buffer", "-t", JobPaneTarget(jobID), "-b", bufferName,
	)
	// Always clean up buffer
	_, _ = t.runTmuxNoCheck("delete-buffer", "-b", bufferName)

	if err != nil {
		return err
	}
	if result.exitCode != 0 {
		stderr := strings.TrimSpace(result.stderr)
		if isTmuxTargetMissing(stderr) {
			return NewServerError(409, "tmux_target_missing", stderr)
		}
		return NewServerError(500, "tmux_input_failed", stderr)
	}
	return nil
}

// SendInterrupt sends C-c to a job's pane.
func (t *TmuxController) SendInterrupt(jobID string) error {
	_, _ = t.runTmuxNoCheck("send-keys", "-t", JobPaneTarget(jobID), "C-c")
	return nil
}

// CleanupSession kills the tmux session for a job (best-effort).
func (t *TmuxController) CleanupSession(jobID string) {
	_, _ = t.runTmuxNoCheck("kill-session", "-t", JobSessionName(jobID))
}

func (t *TmuxController) buildPipeCommand(jobID, jobDir, readyFile string) string {
	sanitizeCmd := shellJoin(append(t.config.SanitizePtyCommand, "--ready-file", readyFile))
	runnerExitCmd := shellJoin(append(t.config.RunnerExitCommand,
		"--state-dir", t.config.StateDir,
		"--job-id", jobID,
		"--sqlite-busy-timeout-ms", fmt.Sprintf("%d", t.config.SQLiteBusyTimeoutMs),
	))

	outputPath := shellQuote(filepath.Join(jobDir, "output.log"))
	drainedPath := shellQuote(filepath.Join(jobDir, ".pipe-drained"))
	errorLogPath := shellQuote(filepath.Join(jobDir, "pipe-error.log"))
	failedPath := shellQuote(filepath.Join(jobDir, ".pipe-failed"))
	exitCodePath := shellQuote(filepath.Join(jobDir, "runner-exit-code"))
	endedAtPath := shellQuote(filepath.Join(jobDir, "runner-ended-at"))

	parts := []string{
		fmt.Sprintf("%s >> %s 2> %s", sanitizeCmd, outputPath, errorLogPath),
		"sanitize_status=$?",
		"runner_exit_status=0",
		fmt.Sprintf(
			`if [ "$sanitize_status" -eq 0 ]; then : > %s; if [ -s %s ] && [ -s %s ]; then %s --exit-code "$(cat %s)" --ended-at "$(cat %s)" 2>> %s; runner_exit_status=$?; if [ "$runner_exit_status" -ne 0 ]; then printf 'runner-exit failed with status %%s\n' "$runner_exit_status" >> %s; fi; fi; else : > %s; fi`,
			drainedPath, exitCodePath, endedAtPath, runnerExitCmd,
			exitCodePath, endedAtPath, errorLogPath, errorLogPath, failedPath,
		),
		`if [ "$sanitize_status" -ne 0 ]; then exit "$sanitize_status"; fi`,
		`exit "$sanitize_status"`,
	}
	return strings.Join(parts, " ; ")
}

type tmuxResult struct {
	stdout   string
	stderr   string
	exitCode int
}

func (t *TmuxController) runTmux(args ...string) (string, error) {
	result, err := t.runTmuxNoCheck(args...)
	if err != nil {
		return "", err
	}
	if result.exitCode != 0 {
		stderr := strings.TrimSpace(result.stderr)
		if stderr == "" {
			stderr = "tmux command failed"
		}
		return "", NewServerError(500, "tmux_error", stderr)
	}
	return result.stdout, nil
}

func (t *TmuxController) runTmuxNoCheck(args ...string) (*tmuxResult, error) {
	cmdArgs := append([]string{"-S", t.config.TmuxSocket()}, args...)
	cmd := exec.Command("tmux", cmdArgs...)

	// Clear TMUX env to avoid nesting
	env := os.Environ()
	filtered := env[:0]
	for _, e := range env {
		if !strings.HasPrefix(e, "TMUX=") {
			filtered = append(filtered, e)
		}
	}
	cmd.Env = filtered

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return nil, fmt.Errorf("exec tmux: %w", err)
		}
	}

	return &tmuxResult{
		stdout:   stdout.String(),
		stderr:   stderr.String(),
		exitCode: exitCode,
	}, nil
}

func isTmuxTargetMissing(stderr string) bool {
	lower := strings.ToLower(stderr)
	return strings.Contains(lower, "can't find pane") ||
		strings.Contains(lower, "can't find session") ||
		strings.Contains(lower, "no server running") ||
		strings.Contains(lower, "failed to connect") ||
		strings.Contains(lower, "server exited unexpectedly")
}

func shellJoin(parts []string) string {
	quoted := make([]string, len(parts))
	for i, p := range parts {
		quoted[i] = shellQuote(p)
	}
	return strings.Join(quoted, " ")
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

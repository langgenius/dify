package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/langgenius/dify/dify-agent-runtime/internal/jobmode"
)

func TestMaterializeStdioStatusDoesNotRequirePanePipe(t *testing.T) {
	service, row := setupModeTestService(t, jobmode.Stdio, StatusRunning)
	pipeInactive := false

	view, err := service.materializeStatusView(row, true, &pipeInactive)
	if err != nil {
		t.Fatalf("materializeStatusView: %v", err)
	}
	if view.Status != StatusRunning {
		t.Errorf("status = %q, want %q", view.Status, StatusRunning)
	}
}

func TestMaterializeStdioStatusUsesExitArtifactsWithoutPipeDrainMarker(t *testing.T) {
	service, row := setupModeTestService(t, jobmode.Stdio, StatusRunning)
	jobDir := filepath.Join(service.config.JobsDir(), row.JobID)
	if err := os.WriteFile(filepath.Join(jobDir, "runner-exit-code"), []byte("7\n"), 0600); err != nil {
		t.Fatal(err)
	}
	const endedAt = "2026-08-04T10:00:00Z"
	if err := os.WriteFile(filepath.Join(jobDir, "runner-ended-at"), []byte(endedAt+"\n"), 0600); err != nil {
		t.Fatal(err)
	}

	view, err := service.materializeStatusView(row, false, nil)
	if err != nil {
		t.Fatalf("materializeStatusView: %v", err)
	}
	if view.Status != StatusExited || !view.Done {
		t.Errorf("view = status %q done %v, want exited and done", view.Status, view.Done)
	}
	if view.ExitCode == nil || *view.ExitCode != 7 {
		t.Errorf("exit code = %v, want 7", view.ExitCode)
	}
	if view.EndedAt == nil || *view.EndedAt != endedAt {
		t.Errorf("ended_at = %v, want %s", view.EndedAt, endedAt)
	}
}

func TestMaterializeStdioStatusMarksMissingSessionWithIncompleteArtifactsLost(t *testing.T) {
	service, row := setupModeTestService(t, jobmode.Stdio, StatusRunning)
	jobDir := filepath.Join(service.config.JobsDir(), row.JobID)
	if err := os.WriteFile(filepath.Join(jobDir, "runner-exit-code"), []byte("0\n"), 0600); err != nil {
		t.Fatal(err)
	}

	view, err := service.materializeStatusView(row, false, nil)
	if err != nil {
		t.Fatalf("materializeStatusView: %v", err)
	}
	if view.Status != StatusLost {
		t.Errorf("status = %q, want %q", view.Status, StatusLost)
	}
}

func setupModeTestService(t *testing.T, mode jobmode.Mode, status JobStatusName) (*Service, *JobRow) {
	t.Helper()
	stateDir := t.TempDir()
	config := mustDefaultConfig(t)
	config.StateDir = stateDir
	config.RuntimeDir = filepath.Join(stateDir, "runtime")
	if err := os.MkdirAll(config.JobsDir(), 0700); err != nil {
		t.Fatal(err)
	}
	db := setupTestDB(t, stateDir)
	t.Cleanup(func() { _ = db.Close() })
	service := NewService(config)
	service.db = db

	const jobID = "mode-test-job"
	jobDir := filepath.Join(config.JobsDir(), jobID)
	if err := os.MkdirAll(jobDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(jobDir, "output.log"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	row := &JobRow{
		JobID:        jobID,
		ScriptPath:   "jobs/mode-test-job/script",
		OutputPath:   "jobs/mode-test-job/output.log",
		Mode:         mode,
		Cwd:          "/tmp",
		TerminalCols: 80,
		TerminalRows: 24,
		Status:       status,
		SessionName:  JobSessionName(jobID),
		PaneTarget:   JobPaneTarget(jobID),
		CreatedAt:    "2026-08-04T09:00:00Z",
		UpdatedAt:    "2026-08-04T09:00:00Z",
	}
	inserted, err := db.InsertJob(row)
	if err != nil || !inserted {
		t.Fatalf("InsertJob: inserted=%v err=%v", inserted, err)
	}
	persisted, err := db.GetJob(jobID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	return service, persisted
}

func TestNativeOutputViolationCannotReturnSuccessfulResult(t *testing.T) {
	service, row := setupModeTestService(t, jobmode.Stdio, StatusExited)
	scopeDir := t.TempDir()
	service.config.NativeScopeConfigPath = filepath.Join(scopeDir, "worker.json")
	service.config.NativeOutputBytes = 4096
	if err := os.WriteFile(filepath.Join(scopeDir, "violation"), []byte("native_scope_output_limit_exceeded"), 0600); err != nil {
		t.Fatal(err)
	}
	zero := 0
	result := service.jobResultFromView(&JobStatusView{JobID: row.JobID, Status: StatusExited, Done: true, ExitCode: &zero}, row, &OutputWindow{})
	if result.Status != StatusFailed || result.ExitCode == nil || *result.ExitCode != 125 {
		t.Fatalf("durable budget refusal reported success: %+v", result)
	}
}

// A confirmed tool approval can outlast the old five-minute GC window. Keep
// the same real HTTP server, SQLite database and job; only age terminal time.
func TestAsyncJobResultSurvivesApprovalDelay(t *testing.T) {
	service, endpoint := newAsyncGCTestServer(t)
	status, body := asyncGCRequest(t, endpoint, "/v1/jobs/run", map[string]any{
		"script": "printf early; while [ ! -e release ]; do sleep 0.01; done; printf final; exit 7", "mode": "stdio", "timeout": 0.5, "idle_flush_seconds": 0.01,
	})
	if status != http.StatusOK {
		t.Fatalf("run: HTTP %d: %s", status, body)
	}
	var initial JobResult
	if err := json.Unmarshal(body, &initial); err != nil {
		t.Fatal(err)
	}
	if initial.Done || initial.JobID == "" || initial.Output != "early" {
		stderr, _ := os.ReadFile(filepath.Join(service.config.JobsDir(), initial.JobID, "stderr.log"))
		t.Fatalf("expected asynchronous job ACK, got %+v; stderr=%s", initial, stderr)
	}
	if err := os.WriteFile(filepath.Join(service.config.DefaultCwd, "release"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	status, body = asyncGCRequest(t, endpoint, "/v1/jobs/"+initial.JobID+"/wait", map[string]any{"offset": 0, "timeout": 5, "idle_flush_seconds": 5})
	var completed JobResult
	if err := json.Unmarshal(body, &completed); err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK || !completed.Done || completed.ExitCode == nil || *completed.ExitCode != 7 || completed.Output != "earlyfinal" {
		t.Fatalf("original job did not finish: HTTP %d: %s", status, body)
	}
	// Model and human approval latency is represented by persisted terminal time,
	// without replacing the service, faking its clock, or waiting six real minutes.
	if _, err := service.db.db.Exec("UPDATE jobs SET ended_at = ? WHERE job_id = ?", FormatTimestamp(time.Now().Add(-6*time.Minute)), initial.JobID); err != nil {
		t.Fatal(err)
	}
	if err := service.GCOnce(); err != nil {
		t.Fatal(err)
	}
	status, body = asyncGCRequest(t, endpoint, "/v1/jobs/"+initial.JobID+"/wait", map[string]any{"offset": 0, "timeout": 0})
	var resumed JobResult
	if err := json.Unmarshal(body, &resumed); err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK || resumed.JobID != initial.JobID || !resumed.Done || resumed.ExitCode == nil || *resumed.ExitCode != 7 || resumed.Output != "earlyfinal" {
		t.Errorf("same-job result lost after six-minute approval delay: HTTP %d: %s", status, body)
	}
	// Retention stays bounded: the established 24-hour result horizon does not
	// preserve terminal jobs indefinitely.
	if _, err := service.db.db.Exec("UPDATE jobs SET ended_at = ? WHERE job_id = ?", FormatTimestamp(time.Now().Add(-25*time.Hour)), initial.JobID); err != nil {
		t.Fatal(err)
	}
	if err := service.GCOnce(); err != nil {
		t.Fatal(err)
	}
	status, body = asyncGCRequest(t, endpoint, "/v1/jobs/"+initial.JobID+"/wait", map[string]any{"offset": 0, "timeout": 0})
	if status != http.StatusNotFound {
		t.Errorf("expired job still readable: HTTP %d: %s", status, body)
	}
	if _, err := os.Stat(filepath.Join(service.config.JobsDir(), initial.JobID)); !os.IsNotExist(err) {
		t.Errorf("expired job artifacts remain: %v", err)
	}
}

func TestAsyncGCDoesNotDeleteUnfinishedJob(t *testing.T) {
	service, endpoint := newAsyncGCTestServer(t)
	status, body := asyncGCRequest(t, endpoint, "/v1/jobs/run", map[string]any{
		"script": "printf early; while [ ! -e release ]; do sleep 0.01; done", "mode": "stdio", "timeout": 0.5, "idle_flush_seconds": 0.01,
	})
	var initial JobResult
	if err := json.Unmarshal(body, &initial); err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK || initial.Done || initial.JobID == "" || initial.Output != "early" {
		stderr, _ := os.ReadFile(filepath.Join(service.config.JobsDir(), initial.JobID, "stderr.log"))
		t.Fatalf("expected running job: HTTP %d: %s; stderr=%s", status, body, stderr)
	}
	if _, err := service.db.db.Exec("UPDATE jobs SET created_at = ?, updated_at = ? WHERE job_id = ?", FormatTimestamp(time.Now().Add(-25*time.Hour)), FormatTimestamp(time.Now().Add(-25*time.Hour)), initial.JobID); err != nil {
		t.Fatal(err)
	}
	if err := service.GCOnce(); err != nil {
		t.Fatal(err)
	}
	status, body = asyncGCRequest(t, endpoint, "/v1/jobs/"+initial.JobID+"/wait", map[string]any{"offset": 0, "timeout": 0})
	var result JobResult
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK || result.JobID != initial.JobID || result.Done || result.Output != "early" {
		t.Fatalf("unfinished job was not preserved: HTTP %d: %s", status, body)
	}
}

func newAsyncGCTestServer(t *testing.T) (*Service, string) {
	t.Helper()
	// Short path keeps the real tmux Unix socket below the OS path limit.
	directory, err := os.MkdirTemp("", "shellctl-gc-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	config := mustDefaultConfig(t)
	config.StateDir = directory
	config.RuntimeDir = filepath.Join(directory, "runtime")
	config.DefaultCwd = directory
	service := NewService(config)
	if err := service.Initialize(); err != nil {
		t.Fatalf("real shellctl initialization: %v", err)
	}
	t.Cleanup(func() { _, _ = service.tmux.runTmuxNoCheck("kill-server"); service.Shutdown() })
	server := httptest.NewServer(Handler(service, config))
	t.Cleanup(server.Close)
	return service, server.URL
}

func asyncGCRequest(t *testing.T, endpoint, path string, payload map[string]any) (int, []byte) {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.Post(endpoint+path, "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, body
}

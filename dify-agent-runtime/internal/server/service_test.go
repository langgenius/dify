package server

import (
	"os"
	"path/filepath"
	"testing"

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

package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestJobStatusIsTerminal(t *testing.T) {
	terminal := []JobStatusName{StatusExited, StatusTerminated, StatusFailed, StatusLost}
	for _, s := range terminal {
		if !s.IsTerminal() {
			t.Errorf("%s should be terminal", s)
		}
	}
	nonTerminal := []JobStatusName{StatusCreated, StatusStarting, StatusRunning}
	for _, s := range nonTerminal {
		if s.IsTerminal() {
			t.Errorf("%s should not be terminal", s)
		}
	}
}

func TestOpenDBAndInitSchema(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "shellctl.db")

	db, err := OpenDB(dbPath, 5000)
	if err != nil {
		t.Fatalf("OpenDB: %v", err)
	}
	defer func() { _ = db.Close() }()

	if err := db.InitSchema(); err != nil {
		t.Fatalf("InitSchema: %v", err)
	}

	// Verify table exists by inserting and reading back
	row := &JobRow{
		JobID:        "test-job-1",
		ScriptPath:   "jobs/test-job-1/script",
		OutputPath:   "jobs/test-job-1/output.log",
		Cwd:          "/tmp",
		TerminalCols: 80,
		TerminalRows: 24,
		Status:       StatusCreated,
		SessionName:  "shellctl-test-job-1",
		PaneTarget:   "shellctl-test-job-1:0.0",
		CreatedAt:    "2025-01-01T00:00:00Z",
		UpdatedAt:    "2025-01-01T00:00:00Z",
	}

	ok, err := db.InsertJob(row)
	if err != nil {
		t.Fatalf("InsertJob: %v", err)
	}
	if !ok {
		t.Error("expected insert to succeed (ok=true)")
	}

	// Duplicate insert should return ok=false
	ok, err = db.InsertJob(row)
	if err != nil {
		t.Fatalf("InsertJob duplicate: %v", err)
	}
	if ok {
		t.Error("expected duplicate insert to return ok=false")
	}
}

func TestGetJob(t *testing.T) {
	dir := t.TempDir()
	db := setupTestDB(t, dir)
	defer func() { _ = db.Close() }()

	insertTestJob(t, db, "job-get-1", StatusCreated)

	row, err := db.GetJob("job-get-1")
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if row.JobID != "job-get-1" {
		t.Errorf("expected job_id=job-get-1, got %s", row.JobID)
	}
	if row.Status != StatusCreated {
		t.Errorf("expected status=created, got %s", row.Status)
	}
	if row.TerminalCols != 80 {
		t.Errorf("expected cols=80, got %d", row.TerminalCols)
	}
}

func TestGetJobNotFound(t *testing.T) {
	dir := t.TempDir()
	db := setupTestDB(t, dir)
	defer func() { _ = db.Close() }()

	_, err := db.GetJob("nonexistent")
	if err != ErrJobNotFound {
		t.Errorf("expected ErrJobNotFound, got %v", err)
	}
}

func TestListJobs(t *testing.T) {
	dir := t.TempDir()
	db := setupTestDB(t, dir)
	defer func() { _ = db.Close() }()

	insertTestJob(t, db, "job-list-1", StatusRunning)
	insertTestJob(t, db, "job-list-2", StatusExited)
	insertTestJob(t, db, "job-list-3", StatusCreated)

	// List all
	rows, err := db.ListJobs(nil)
	if err != nil {
		t.Fatalf("ListJobs: %v", err)
	}
	if len(rows) != 3 {
		t.Errorf("expected 3 jobs, got %d", len(rows))
	}

	// List by status
	rows, err = db.ListJobs([]JobStatusName{StatusRunning})
	if err != nil {
		t.Fatalf("ListJobs filtered: %v", err)
	}
	if len(rows) != 1 {
		t.Errorf("expected 1 running job, got %d", len(rows))
	}
	if rows[0].JobID != "job-list-1" {
		t.Errorf("expected job-list-1, got %s", rows[0].JobID)
	}
}

func TestDeleteJob(t *testing.T) {
	dir := t.TempDir()
	db := setupTestDB(t, dir)
	defer func() { _ = db.Close() }()

	insertTestJob(t, db, "job-del-1", StatusExited)

	if err := db.DeleteJob("job-del-1"); err != nil {
		t.Fatalf("DeleteJob: %v", err)
	}

	_, err := db.GetJob("job-del-1")
	if err != ErrJobNotFound {
		t.Errorf("expected ErrJobNotFound after delete, got %v", err)
	}
}

func TestDeleteJobNotFound(t *testing.T) {
	dir := t.TempDir()
	db := setupTestDB(t, dir)
	defer func() { _ = db.Close() }()

	err := db.DeleteJob("nonexistent")
	if err != ErrJobNotFound {
		t.Errorf("expected ErrJobNotFound, got %v", err)
	}
}

func TestTransitionStatus(t *testing.T) {
	dir := t.TempDir()
	db := setupTestDB(t, dir)
	defer func() { _ = db.Close() }()

	insertTestJob(t, db, "job-trans-1", StatusCreated)

	// Transition created → starting
	row, err := db.TransitionStatus("job-trans-1", TransitionOpts{
		AllowedFrom: []JobStatusName{StatusCreated},
		Target:      StatusStarting,
	})
	if err != nil {
		t.Fatalf("TransitionStatus: %v", err)
	}
	if row.Status != StatusStarting {
		t.Errorf("expected starting, got %s", row.Status)
	}

	// Transition starting → running
	row, err = db.TransitionStatus("job-trans-1", TransitionOpts{
		AllowedFrom:         []JobStatusName{StatusStarting},
		Target:              StatusRunning,
		RequireExitCodeNull: true,
	})
	if err != nil {
		t.Fatalf("TransitionStatus: %v", err)
	}
	if row.Status != StatusRunning {
		t.Errorf("expected running, got %s", row.Status)
	}

	// Transition running → exited
	exitCode := 0
	row, err = db.TransitionStatus("job-trans-1", TransitionOpts{
		AllowedFrom: []JobStatusName{StatusRunning},
		Target:      StatusExited,
	})
	if err != nil {
		t.Fatalf("TransitionStatus: %v", err)
	}
	if row.Status != StatusExited {
		t.Errorf("expected exited, got %s", row.Status)
	}
	if row.ExitCode == nil {
		t.Error("expected exit_code to be set after exited transition")
	} else if *row.ExitCode != exitCode {
		t.Errorf("expected exit_code=0, got %d", *row.ExitCode)
	}
	if row.EndedAt == nil {
		t.Error("expected ended_at to be set after terminal transition")
	}
}

func TestRecordRunnerExit(t *testing.T) {
	dir := t.TempDir()
	db := setupTestDB(t, dir)
	defer func() { _ = db.Close() }()

	insertTestJob(t, db, "job-exit-1", StatusRunning)

	if err := db.RecordRunnerExit("job-exit-1", 42, "2025-01-15T12:00:00Z"); err != nil {
		t.Fatalf("RecordRunnerExit: %v", err)
	}

	row, _ := db.GetJob("job-exit-1")
	if row.Status != StatusExited {
		t.Errorf("expected exited, got %s", row.Status)
	}
	if row.ExitCode == nil || *row.ExitCode != 42 {
		t.Errorf("expected exit_code=42, got %v", row.ExitCode)
	}
}

func TestRecordRunnerExitIdempotent(t *testing.T) {
	dir := t.TempDir()
	db := setupTestDB(t, dir)
	defer func() { _ = db.Close() }()

	insertTestJob(t, db, "job-exit-2", StatusExited)
	exitCode := 10
	row := &JobRow{
		JobID: "job-exit-2", ScriptPath: "x", OutputPath: "y", Cwd: "/tmp",
		TerminalCols: 80, TerminalRows: 24, Status: StatusExited,
		SessionName: "s", PaneTarget: "p", ExitCode: &exitCode,
		CreatedAt: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z",
		EndedAt: strPtr("2025-01-01T00:01:00Z"),
	}
	_, _ = db.db.Exec(`UPDATE jobs SET exit_code=?, ended_at=? WHERE job_id=?`,
		exitCode, "2025-01-01T00:01:00Z", "job-exit-2")
	_ = row

	// Should not overwrite existing terminal state
	err := db.RecordRunnerExit("job-exit-2", 99, "2025-01-01T00:02:00Z")
	if err != nil {
		t.Fatalf("RecordRunnerExit on terminal: %v", err)
	}

	got, _ := db.GetJob("job-exit-2")
	if got.ExitCode != nil && *got.ExitCode != 10 {
		t.Errorf("expected exit_code=10 (preserved), got %d", *got.ExitCode)
	}
}

// Helpers

func setupTestDB(t *testing.T, dir string) *DB {
	t.Helper()
	dbPath := filepath.Join(dir, "shellctl.db")
	db, err := OpenDB(dbPath, 5000)
	if err != nil {
		t.Fatalf("OpenDB: %v", err)
	}
	if err := db.InitSchema(); err != nil {
		t.Fatalf("InitSchema: %v", err)
	}
	return db
}

func insertTestJob(t *testing.T, db *DB, jobID string, status JobStatusName) {
	t.Helper()
	row := &JobRow{
		JobID:        jobID,
		ScriptPath:   "jobs/" + jobID + "/script",
		OutputPath:   "jobs/" + jobID + "/output.log",
		Cwd:          "/tmp",
		TerminalCols: 80,
		TerminalRows: 24,
		Status:       status,
		SessionName:  "shellctl-" + jobID,
		PaneTarget:   "shellctl-" + jobID + ":0.0",
		CreatedAt:    "2025-01-01T00:00:00Z",
		UpdatedAt:    "2025-01-01T00:00:00Z",
	}
	ok, err := db.InsertJob(row)
	if err != nil || !ok {
		t.Fatalf("InsertJob(%s): err=%v ok=%v", jobID, err, ok)
	}
}

func strPtr(s string) *string {
	return &s
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}

package runner_exit

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func setupTestDB(t *testing.T, dir string) string {
	t.Helper()
	dbPath := filepath.Join(dir, "shellctl.db")
	db, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer func() { _ = db.Close() }()

	_, err = db.Exec(`
		CREATE TABLE jobs (
			job_id       TEXT PRIMARY KEY,
			script_path  TEXT NOT NULL,
			output_path  TEXT NOT NULL,
			cwd          TEXT NOT NULL,
			terminal_cols INTEGER NOT NULL DEFAULT 200,
			terminal_rows INTEGER NOT NULL DEFAULT 50,
			status       TEXT NOT NULL DEFAULT 'created',
			session_name TEXT NOT NULL,
			pane_target  TEXT NOT NULL,
			exit_code    INTEGER,
			reason       TEXT,
			message      TEXT,
			created_at   TEXT NOT NULL,
			started_at   TEXT,
			ended_at     TEXT,
			updated_at   TEXT NOT NULL
		)
	`)
	if err != nil {
		t.Fatalf("create table: %v", err)
	}

	_, err = db.Exec(`INSERT INTO jobs (job_id, script_path, output_path, cwd, status, session_name, pane_target, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"test-job", "s", "o", "/tmp", "running", "sess", "pane", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z")
	if err != nil {
		t.Fatalf("insert job: %v", err)
	}

	return dbPath
}

func TestRecordRunnerExitRunning(t *testing.T) {
	dir := t.TempDir()
	stateDir := dir
	setupTestDB(t, dir)

	err := RecordRunnerExit(stateDir, "test-job", 0, "2025-01-15T12:00:00Z", 5000)
	if err != nil {
		t.Fatalf("RecordRunnerExit: %v", err)
	}

	// Verify the row was updated
	db, err := sql.Open("sqlite", "file:"+filepath.Join(dir, "shellctl.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	var status string
	var exitCode int
	if err := db.QueryRow("SELECT status, exit_code FROM jobs WHERE job_id = ?", "test-job").Scan(&status, &exitCode); err != nil {
		t.Fatal(err)
	}

	if status != "exited" {
		t.Errorf("expected status=exited, got %s", status)
	}
	if exitCode != 0 {
		t.Errorf("expected exit_code=0, got %d", exitCode)
	}
}

func TestRecordRunnerExitNonZeroCode(t *testing.T) {
	dir := t.TempDir()
	setupTestDB(t, dir)

	err := RecordRunnerExit(dir, "test-job", 42, "2025-01-15T12:00:00Z", 5000)
	if err != nil {
		t.Fatalf("RecordRunnerExit: %v", err)
	}

	db, err := sql.Open("sqlite", "file:"+filepath.Join(dir, "shellctl.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	var exitCode int
	if err := db.QueryRow("SELECT exit_code FROM jobs WHERE job_id = ?", "test-job").Scan(&exitCode); err != nil {
		t.Fatal(err)
	}

	if exitCode != 42 {
		t.Errorf("expected exit_code=42, got %d", exitCode)
	}
}

func TestRecordRunnerExitJobNotFound(t *testing.T) {
	dir := t.TempDir()
	setupTestDB(t, dir)

	err := RecordRunnerExit(dir, "nonexistent-job", 0, "2025-01-15T12:00:00Z", 5000)
	if err == nil {
		t.Error("expected error for nonexistent job")
	}
}

func TestRecordRunnerExitDBNotFound(t *testing.T) {
	dir := t.TempDir()

	err := RecordRunnerExit(dir, "test-job", 0, "2025-01-15T12:00:00Z", 5000)
	if err == nil {
		t.Error("expected error when database doesn't exist")
	}
}

func TestRecordRunnerExitTerminalIdempotent(t *testing.T) {
	dir := t.TempDir()
	dbPath := setupTestDB(t, dir)

	// Manually set job to terminal state
	db, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE jobs SET status='terminated', exit_code=137, ended_at='2025-01-01T00:01:00Z' WHERE job_id='test-job'`); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()

	// Should not overwrite
	err = RecordRunnerExit(dir, "test-job", 0, "2025-01-15T12:00:00Z", 5000)
	if err != nil {
		t.Fatalf("RecordRunnerExit on terminal: %v", err)
	}

	db, err = sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	var status string
	var exitCode int
	if err := db.QueryRow("SELECT status, exit_code FROM jobs WHERE job_id = ?", "test-job").Scan(&status, &exitCode); err != nil {
		t.Fatal(err)
	}

	if status != "terminated" {
		t.Errorf("expected status=terminated (preserved), got %s", status)
	}
	if exitCode != 137 {
		t.Errorf("expected exit_code=137 (preserved), got %d", exitCode)
	}
}

func TestIsTerminal(t *testing.T) {
	terminal := []string{"exited", "terminated", "failed", "lost"}
	for _, s := range terminal {
		if !isTerminal(s) {
			t.Errorf("%s should be terminal", s)
		}
	}
	nonTerminal := []string{"created", "starting", "running"}
	for _, s := range nonTerminal {
		if isTerminal(s) {
			t.Errorf("%s should not be terminal", s)
		}
	}
}

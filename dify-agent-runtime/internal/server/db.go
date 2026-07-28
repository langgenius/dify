package server

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// JobStatusName represents the lifecycle states of a shellctl job.
type JobStatusName string

const (
	StatusCreated    JobStatusName = "created"
	StatusStarting   JobStatusName = "starting"
	StatusRunning    JobStatusName = "running"
	StatusExited     JobStatusName = "exited"
	StatusTerminated JobStatusName = "terminated"
	StatusFailed     JobStatusName = "failed"
	StatusLost       JobStatusName = "lost"
)

// IsTerminal returns true if the status represents a final job state.
func (s JobStatusName) IsTerminal() bool {
	switch s {
	case StatusExited, StatusTerminated, StatusFailed, StatusLost:
		return true
	}
	return false
}

// JobRow represents a row in the jobs SQLite table.
type JobRow struct {
	JobID        string
	ScriptPath   string
	OutputPath   string
	Cwd          string
	TerminalCols int
	TerminalRows int
	Status       JobStatusName
	SessionName  string
	PaneTarget   string
	ExitCode     *int
	Reason       *string
	Message      *string
	CreatedAt    string
	StartedAt    *string
	EndedAt      *string
	UpdatedAt    string
}

// DB wraps the SQLite database for shellctl job persistence.
type DB struct {
	db *sql.DB
}

// OpenDB opens (or creates) the shellctl SQLite database.
func OpenDB(dbPath string, busyTimeoutMs int) (*DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(%d)&_pragma=journal_mode(WAL)", dbPath, busyTimeoutMs)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetConnMaxLifetime(0)
	return &DB{db: db}, nil
}

// Close closes the database connection.
func (d *DB) Close() error {
	return d.db.Close()
}

// InitSchema creates the jobs table if it does not exist.
func (d *DB) InitSchema() error {
	_, err := d.db.Exec(`
		CREATE TABLE IF NOT EXISTS jobs (
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
	return err
}

// InsertJob inserts a new job row. Returns false if the job_id already exists.
func (d *DB) InsertJob(row *JobRow) (bool, error) {
	_, err := d.db.Exec(`
		INSERT INTO jobs (job_id, script_path, output_path, cwd, terminal_cols, terminal_rows,
			status, session_name, pane_target, exit_code, reason, message,
			created_at, started_at, ended_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		row.JobID, row.ScriptPath, row.OutputPath, row.Cwd,
		row.TerminalCols, row.TerminalRows,
		string(row.Status), row.SessionName, row.PaneTarget,
		row.ExitCode, row.Reason, row.Message,
		row.CreatedAt, row.StartedAt, row.EndedAt, row.UpdatedAt,
	)
	if err != nil {
		// SQLite UNIQUE constraint violation
		if isUniqueViolation(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// GetJob retrieves a single job row by ID.
func (d *DB) GetJob(jobID string) (*JobRow, error) {
	row := d.db.QueryRow(`
		SELECT job_id, script_path, output_path, cwd, terminal_cols, terminal_rows,
			status, session_name, pane_target, exit_code, reason, message,
			created_at, started_at, ended_at, updated_at
		FROM jobs WHERE job_id = ?`, jobID)
	return scanJobRow(row)
}

// ListJobs returns all jobs ordered by created_at descending, optionally filtered by status.
func (d *DB) ListJobs(statuses []JobStatusName) ([]*JobRow, error) {
	var rows *sql.Rows
	var err error

	if len(statuses) == 0 {
		rows, err = d.db.Query(`SELECT job_id, script_path, output_path, cwd,
			terminal_cols, terminal_rows, status, session_name, pane_target,
			exit_code, reason, message, created_at, started_at, ended_at, updated_at
			FROM jobs ORDER BY created_at DESC`)
	} else {
		args := make([]any, len(statuses))
		placeholders := ""
		for i, s := range statuses {
			args[i] = string(s)
			if i > 0 {
				placeholders += ","
			}
			placeholders += "?"
		}
		query := fmt.Sprintf(`SELECT job_id, script_path, output_path, cwd,
			terminal_cols, terminal_rows, status, session_name, pane_target,
			exit_code, reason, message, created_at, started_at, ended_at, updated_at
			FROM jobs WHERE status IN (%s) ORDER BY created_at DESC`, placeholders)
		rows, err = d.db.Query(query, args...)
	}
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var result []*JobRow
	for rows.Next() {
		jr, err := scanJobRows(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, jr)
	}
	return result, rows.Err()
}

// DeleteJob removes a job row by ID. Returns error if not found.
func (d *DB) DeleteJob(jobID string) error {
	result, err := d.db.Exec("DELETE FROM jobs WHERE job_id = ?", jobID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return ErrJobNotFound
	}
	return nil
}

// TransitionStatus performs a conditional CAS update on a job row.
func (d *DB) TransitionStatus(jobID string, opts TransitionOpts) (*JobRow, error) {
	now := FormatTimestamp(time.Now())

	// Build WHERE clause
	allowedList := make([]any, 0, len(opts.AllowedFrom)+len(opts.AllowOverrideFrom))
	placeholders := ""
	all := append(opts.AllowedFrom, opts.AllowOverrideFrom...)
	for i, s := range all {
		allowedList = append(allowedList, string(s))
		if i > 0 {
			placeholders += ","
		}
		placeholders += "?"
	}

	setClauses := `
		status = ?,
		updated_at = ?,
		reason = ?,
		message = ?`

	args := []any{string(opts.Target), now, opts.Reason, opts.Message}

	// started_at: set on first transition to starting/running
	if opts.Target == StatusStarting || opts.Target == StatusRunning {
		setClauses += `, started_at = CASE WHEN started_at IS NULL THEN ? ELSE started_at END`
		args = append(args, now)
	}

	// ended_at + exit_code: set on terminal transitions
	if opts.Target.IsTerminal() {
		endedAt := opts.EndedAt
		if endedAt == "" {
			endedAt = now
		}
		setClauses += `, ended_at = CASE WHEN ended_at IS NULL THEN ? ELSE ended_at END`
		args = append(args, endedAt)
		// Set exit_code to 0 if not already set (normal exit without runner-exit callback)
		setClauses += `, exit_code = CASE WHEN exit_code IS NULL THEN 0 ELSE exit_code END`
	}

	whereClause := fmt.Sprintf("job_id = ? AND status IN (%s)", placeholders)
	args = append(args, jobID)
	args = append(args, allowedList...)

	if opts.RequireExitCodeNull {
		whereClause += " AND exit_code IS NULL"
	}

	query := fmt.Sprintf("UPDATE jobs SET %s WHERE %s", setClauses, whereClause)
	result, err := d.db.Exec(query, args...)
	if err != nil {
		return nil, fmt.Errorf("transition status: %w", err)
	}

	n, _ := result.RowsAffected()
	_ = n // If 0 rows affected, we just return current state

	return d.GetJob(jobID)
}

// RecordRunnerExit persists exit_code and ended_at for a drained job.
// The update is idempotent for terminal rows: once a job reaches a terminal
// state, this method returns nil without rewriting the row.
func (d *DB) RecordRunnerExit(jobID string, exitCode int, endedAt string) error {
	// Check if job exists and is already terminal
	var status string
	err := d.db.QueryRow("SELECT status FROM jobs WHERE job_id = ?", jobID).Scan(&status)
	if err == sql.ErrNoRows {
		return ErrJobNotFound
	}
	if err != nil {
		return err
	}
	if JobStatusName(status).IsTerminal() {
		return nil
	}

	nonterminal := []any{"created", "starting", "running"}

	result, err := d.db.Exec(`
		UPDATE jobs
		SET status = CASE WHEN status IN (?, ?, ?) THEN ? ELSE status END,
			exit_code = CASE WHEN status IN (?, ?, ?) THEN ? ELSE exit_code END,
			ended_at = CASE WHEN status IN (?, ?, ?) AND ended_at IS NULL THEN ? ELSE ended_at END,
			updated_at = CASE WHEN status IN (?, ?, ?) THEN ? ELSE updated_at END,
			reason = CASE WHEN status IN (?, ?, ?) THEN NULL ELSE reason END,
			message = CASE WHEN status IN (?, ?, ?) THEN NULL ELSE message END
		WHERE job_id = ? AND status IN (?, ?, ?)`,
		nonterminal[0], nonterminal[1], nonterminal[2], string(StatusExited),
		// exit_code
		nonterminal[0], nonterminal[1], nonterminal[2], exitCode,
		// ended_at
		nonterminal[0], nonterminal[1], nonterminal[2], endedAt,
		// updated_at
		nonterminal[0], nonterminal[1], nonterminal[2], endedAt,
		// reason
		nonterminal[0], nonterminal[1], nonterminal[2],
		// message
		nonterminal[0], nonterminal[1], nonterminal[2],
		// WHERE
		jobID,
		nonterminal[0], nonterminal[1], nonterminal[2],
	)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return ErrJobNotFound
	}
	return nil
}

// TransitionOpts holds parameters for a CAS state transition.
type TransitionOpts struct {
	AllowedFrom         []JobStatusName
	AllowOverrideFrom   []JobStatusName
	Target              JobStatusName
	RequireExitCodeNull bool
	Reason              *string
	Message             *string
	EndedAt             string
}

func scanJobRow(row *sql.Row) (*JobRow, error) {
	var jr JobRow
	var status string
	err := row.Scan(
		&jr.JobID, &jr.ScriptPath, &jr.OutputPath, &jr.Cwd,
		&jr.TerminalCols, &jr.TerminalRows,
		&status, &jr.SessionName, &jr.PaneTarget,
		&jr.ExitCode, &jr.Reason, &jr.Message,
		&jr.CreatedAt, &jr.StartedAt, &jr.EndedAt, &jr.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, ErrJobNotFound
	}
	if err != nil {
		return nil, err
	}
	jr.Status = JobStatusName(status)
	return &jr, nil
}

func scanJobRows(rows *sql.Rows) (*JobRow, error) {
	var jr JobRow
	var status string
	err := rows.Scan(
		&jr.JobID, &jr.ScriptPath, &jr.OutputPath, &jr.Cwd,
		&jr.TerminalCols, &jr.TerminalRows,
		&status, &jr.SessionName, &jr.PaneTarget,
		&jr.ExitCode, &jr.Reason, &jr.Message,
		&jr.CreatedAt, &jr.StartedAt, &jr.EndedAt, &jr.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	jr.Status = JobStatusName(status)
	return &jr, nil
}

func isUniqueViolation(err error) bool {
	// modernc.org/sqlite returns error messages containing "UNIQUE constraint failed"
	return err != nil && contains(err.Error(), "UNIQUE constraint failed")
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		(len(s) > 0 && len(substr) > 0 && searchString(s, substr)))
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

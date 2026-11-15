// Package runner_exit persists a drained shellctl job exit into SQLite.
//
// This runs out-of-process from the main shellctl server, after the tmux
// output pipe reaches EOF. It uses the same CAS semantics as the Python
// shellctl_runtime/runner_exit.py: only non-terminal rows are updated.
package runner_exit

import (
	"database/sql"
	"fmt"
	"path/filepath"

	_ "modernc.org/sqlite"
)

var (
	nonterminalStatuses = []string{"created", "starting", "running"}
	terminalStatuses    = []string{"exited", "terminated", "failed", "lost"}
)

// RecordRunnerExit persists exit_code and ended_at into the shellctl SQLite DB.
// The update is idempotent for terminal rows.
func RecordRunnerExit(stateDir, jobID string, exitCode int, endedAt string, busyTimeoutMs int) error {
	dbPath := filepath.Join(stateDir, "shellctl.db")

	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(%d)&_pragma=journal_mode(WAL)", dbPath, busyTimeoutMs)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() { _ = db.Close() }()
	db.SetMaxOpenConns(1)

	// Check current status
	var status string
	err = db.QueryRow("SELECT status FROM jobs WHERE job_id = ?", jobID).Scan(&status)
	if err == sql.ErrNoRows {
		return fmt.Errorf("unknown job id: %s", jobID)
	}
	if err != nil {
		return fmt.Errorf("query job status: %w", err)
	}

	if isTerminal(status) {
		return nil
	}

	// CAS update: only transition non-terminal rows
	result, err := db.Exec(`
		UPDATE jobs
		SET status = CASE
				WHEN status IN (?, ?, ?) THEN ?
				ELSE status
			END,
			exit_code = CASE
				WHEN status IN (?, ?, ?) THEN ?
				ELSE exit_code
			END,
			ended_at = CASE
				WHEN status IN (?, ?, ?) THEN ?
				ELSE ended_at
			END,
			updated_at = CASE
				WHEN status IN (?, ?, ?) THEN ?
				ELSE updated_at
			END,
			reason = CASE
				WHEN status IN (?, ?, ?) THEN NULL
				ELSE reason
			END,
			message = CASE
				WHEN status IN (?, ?, ?) THEN NULL
				ELSE message
			END
		WHERE job_id = ?`,
		// status
		nonterminalStatuses[0], nonterminalStatuses[1], nonterminalStatuses[2], "exited",
		// exit_code
		nonterminalStatuses[0], nonterminalStatuses[1], nonterminalStatuses[2], exitCode,
		// ended_at
		nonterminalStatuses[0], nonterminalStatuses[1], nonterminalStatuses[2], endedAt,
		// updated_at
		nonterminalStatuses[0], nonterminalStatuses[1], nonterminalStatuses[2], endedAt,
		// reason
		nonterminalStatuses[0], nonterminalStatuses[1], nonterminalStatuses[2],
		// message
		nonterminalStatuses[0], nonterminalStatuses[1], nonterminalStatuses[2],
		// WHERE
		jobID,
	)
	if err != nil {
		return fmt.Errorf("update job: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("unknown job id: %s", jobID)
	}
	return nil
}

func isTerminal(status string) bool {
	for _, s := range terminalStatuses {
		if status == s {
			return true
		}
	}
	return false
}

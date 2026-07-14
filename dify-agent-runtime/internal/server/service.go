package server

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Service is the core job lifecycle manager backed by SQLite and tmux.
type Service struct {
	config       *Config
	db           *DB
	tmux         *TmuxController
	startingJobs map[string]bool
	mu           sync.Mutex
	cancelGC     context.CancelFunc
	cancelMon    context.CancelFunc
}

// NewService creates a new shellctl service.
func NewService(config *Config) *Service {
	return &Service{
		config:       config,
		tmux:         NewTmuxController(config),
		startingJobs: make(map[string]bool),
	}
}

// Initialize performs the full server startup (prepare + reconcile + gc).
func (s *Service) Initialize() error {
	if err := s.PrepareRuntime(); err != nil {
		return err
	}
	if err := s.Reconcile(); err != nil {
		return err
	}
	return s.GCOnce()
}

// PrepareRuntime sets up directories, DB schema, runner script, and tmux server.
func (s *Service) PrepareRuntime() error {
	if err := os.MkdirAll(s.config.StateDir, 0700); err != nil {
		return err
	}
	if err := os.MkdirAll(s.config.RuntimeDir, 0700); err != nil {
		return err
	}
	if err := os.MkdirAll(s.config.JobsDir(), 0700); err != nil {
		return err
	}
	runnerDir := filepath.Dir(s.config.RunnerPath())
	if err := os.MkdirAll(runnerDir, 0700); err != nil {
		return err
	}

	db, err := OpenDB(s.config.DBPath(), s.config.SQLiteBusyTimeoutMs)
	if err != nil {
		return err
	}
	s.db = db

	if err := s.db.InitSchema(); err != nil {
		return err
	}

	s.installRunner()
	return s.tmux.StartServer()
}

// Shutdown stops background goroutines and closes the database.
func (s *Service) Shutdown() {
	if s.cancelGC != nil {
		s.cancelGC()
	}
	if s.cancelMon != nil {
		s.cancelMon()
	}
	if s.db != nil {
		_ = s.db.Close()
	}
}

// StartBackgroundGC starts the periodic GC goroutine.
func (s *Service) StartBackgroundGC() {
	ctx, cancel := context.WithCancel(context.Background())
	s.cancelGC = cancel
	go func() {
		ticker := time.NewTicker(s.config.GCInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = s.GCOnce()
			}
		}
	}()
}

// StartBackgroundPipeMonitor starts the periodic pipe health check goroutine.
func (s *Service) StartBackgroundPipeMonitor() {
	ctx, cancel := context.WithCancel(context.Background())
	s.cancelMon = cancel
	go func() {
		ticker := time.NewTicker(s.config.PipeMonitorInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.CheckRunningJobsPipeHealth()
			}
		}
	}()
}

// RunJob creates and starts a new tmux-backed job, then waits for initial output.
func (s *Service) RunJob(req *RunJobRequest) (*JobResult, error) {
	log.Printf("RunJob: script=%d bytes, cwd=%v, env_keys=%d", len(req.Script), req.Cwd, len(req.Env))
	cwd, err := s.resolveCwd(req.Cwd)
	if err != nil {
		log.Printf("RunJob: resolveCwd failed: %v", err)
		return nil, err
	}

	cols := s.config.DefaultTerminalCols
	rows := s.config.DefaultTerminalRows
	if req.Terminal != nil {
		cols = req.Terminal.Cols
		rows = req.Terminal.Rows
	}

	timeout := s.config.DefaultTimeout
	if req.Timeout > 0 {
		timeout = time.Duration(req.Timeout * float64(time.Second))
	}
	outputLimit := s.config.DefaultOutputLimitBytes
	if req.OutputLimit > 0 {
		outputLimit = req.OutputLimit
	}
	idleFlush := s.config.IdleFlushDuration
	if req.IdleFlushSeconds > 0 {
		idleFlush = time.Duration(req.IdleFlushSeconds * float64(time.Second))
	}

	createdAt := FormatTimestamp(time.Now())

	// Allocate job directory and insert DB row
	jobID, jobDir, err := s.allocateJobDir()
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.startingJobs[jobID] = true
	s.mu.Unlock()

	// Write script and env files
	scriptPath := filepath.Join(jobDir, "script")
	outputPath := filepath.Join(jobDir, "output.log")
	envPath := filepath.Join(jobDir, ".job-env.json")

	if err := os.WriteFile(scriptPath, []byte(req.Script), 0600); err != nil {
		s.cleanupStarting(jobID, jobDir)
		return nil, err
	}
	envJSON := "{}"
	if req.Env != nil {
		pairs := make([]string, 0, len(req.Env))
		for k, v := range req.Env {
			pairs = append(pairs, fmt.Sprintf("%q:%q", k, v))
		}
		envJSON = "{" + strings.Join(pairs, ",") + "}"
	}
	if err := os.WriteFile(envPath, []byte(envJSON), 0600); err != nil {
		s.cleanupStarting(jobID, jobDir)
		return nil, err
	}
	if err := os.WriteFile(outputPath, []byte{}, 0600); err != nil {
		s.cleanupStarting(jobID, jobDir)
		return nil, err
	}

	row := &JobRow{
		JobID:        jobID,
		ScriptPath:   fmt.Sprintf("jobs/%s/script", jobID),
		OutputPath:   fmt.Sprintf("jobs/%s/output.log", jobID),
		Cwd:          cwd,
		TerminalCols: cols,
		TerminalRows: rows,
		Status:       StatusCreated,
		SessionName:  JobSessionName(jobID),
		PaneTarget:   JobPaneTarget(jobID),
		CreatedAt:    createdAt,
		UpdatedAt:    createdAt,
	}

	ok, err := s.db.InsertJob(row)
	if err != nil {
		s.cleanupStarting(jobID, jobDir)
		return nil, err
	}
	if !ok {
		s.cleanupStarting(jobID, jobDir)
		return nil, NewServerError(500, "job_id_collision", "Failed to allocate a unique job id")
	}

	// Transition to starting
	_, _ = s.db.TransitionStatus(jobID, TransitionOpts{
		AllowedFrom: []JobStatusName{StatusCreated},
		Target:      StatusStarting,
	})

	// Create tmux session and enable output pipe
	log.Printf("RunJob [%s]: starting job, cwd=%s", jobID, cwd)
	startErr := s.startJob(jobID, jobDir, cwd, cols, rows)
	if startErr != nil {
		log.Printf("RunJob [%s]: start failed: %v", jobID, startErr)
		reason := "start_failed"
		msg := startErr.Error()
		_, _ = s.db.TransitionStatus(jobID, TransitionOpts{
			AllowedFrom: []JobStatusName{StatusCreated, StatusStarting, StatusRunning},
			Target:      StatusFailed,
			Reason:      &reason,
			Message:     &msg,
		})
		s.tmux.CleanupSession(jobID)
	} else {
		log.Printf("RunJob [%s]: started successfully", jobID)
	}

	s.mu.Lock()
	delete(s.startingJobs, jobID)
	s.mu.Unlock()

	// Wait for initial output
	return s.WaitJob(jobID, &WaitJobRequest{
		Offset:           0,
		Timeout:          timeout.Seconds(),
		OutputLimit:      outputLimit,
		IdleFlushSeconds: idleFlush.Seconds(),
	})
}

func (s *Service) startJob(jobID, jobDir, cwd string, cols, rows int) error {
	log.Printf("startJob [%s]: creating tmux session", jobID)
	if err := s.tmux.CreateJobSession(jobID, jobDir, cwd, cols, rows); err != nil {
		log.Printf("startJob [%s]: tmux session failed: %v", jobID, err)
		return err
	}

	pipeReadyPath := filepath.Join(jobDir, ".pipe-ready")
	log.Printf("startJob [%s]: enabling output pipe", jobID)
	if err := s.tmux.EnableOutputPipe(jobID, jobDir, pipeReadyPath); err != nil {
		log.Printf("startJob [%s]: pipe-pane failed: %v", jobID, err)
		return err
	}

	// Wait for pipe ready handshake
	if err := s.waitForPipeReady(jobID, pipeReadyPath); err != nil {
		log.Printf("startJob [%s]: pipe-ready timeout: %v", jobID, err)
		return err
	}

	// Open start gate
	log.Printf("startJob [%s]: opening start gate", jobID)
	gateFile := filepath.Join(jobDir, "start-gate")
	if err := os.WriteFile(gateFile, []byte{}, 0600); err != nil {
		return err
	}

	// Transition to running
	_, _ = s.db.TransitionStatus(jobID, TransitionOpts{
		AllowedFrom:         []JobStatusName{StatusStarting},
		Target:              StatusRunning,
		RequireExitCodeNull: true,
	})

	// Clean up ready file
	_ = os.Remove(pipeReadyPath)
	return nil
}

func (s *Service) waitForPipeReady(jobID, readyFile string) error {
	deadline := time.Now().Add(s.config.PipeReadyTimeout)
	for {
		if _, err := os.Stat(readyFile); err == nil {
			// Ready file exists, verify pipe is active
			active, err := s.tmux.IsOutputPipeActive(jobID)
			if err != nil {
				return err
			}
			if active == nil {
				return NewServerError(500, "pipe_failed",
					"tmux pane disappeared after ready-file handshake")
			}
			if *active {
				return nil
			}
		}

		if time.Now().After(deadline) {
			return NewServerError(500, "pipe_failed",
				fmt.Sprintf("timed out waiting for pipe ready (%v)", s.config.PipeReadyTimeout))
		}
		time.Sleep(s.config.PollInterval)
	}
}

// WaitJob blocks until output, completion, truncation, or timeout.
func (s *Service) WaitJob(jobID string, req *WaitJobRequest) (*JobResult, error) {
	row, err := s.db.GetJob(jobID)
	if err != nil {
		return nil, err
	}

	outputPath := s.outputLogPath(row)
	timeout := time.Duration(req.Timeout * float64(time.Second))
	outputLimit := req.OutputLimit
	if outputLimit <= 0 {
		outputLimit = s.config.DefaultOutputLimitBytes
	}
	idleFlush := time.Duration(req.IdleFlushSeconds * float64(time.Second))

	deadline := time.Now().Add(timeout)
	lastSize := fileSize(outputPath)
	sawOutput := lastSize > int64(req.Offset)
	var lastGrowthAt *time.Time
	if sawOutput {
		now := time.Now()
		lastGrowthAt = &now
	}

	for {
		view, err := s.GetJobStatus(jobID)
		if err != nil {
			return nil, err
		}

		currentSize := fileSize(outputPath)

		// Validate offset against current file size (mirror Python behavior).
		if int64(req.Offset) > currentSize {
			return nil, NewServerError(400, "invalid_offset",
				fmt.Sprintf("offset %d exceeds current file size %d", req.Offset, currentSize))
		}

		// Only update lastGrowthAt when the file actually grows (not just
		// when currentSize > offset).  Without this, lastGrowthAt resets on
		// every poll and idle-flush can never fire.
		if currentSize > lastSize {
			lastSize = currentSize
			if currentSize > int64(req.Offset) {
				sawOutput = true
				now := time.Now()
				lastGrowthAt = &now
			}
		}

		if view.Done {
			window, err := ReadOutputWindow(outputPath, req.Offset, outputLimit)
			if err != nil {
				return nil, err
			}
			return s.jobResultFromView(view, row, window), nil
		}

		if currentSize > int64(req.Offset) {
			window, err := ReadOutputWindow(outputPath, req.Offset, outputLimit)
			if err != nil {
				return nil, err
			}
			if window.Truncated {
				return s.jobResultFromView(view, row, window), nil
			}
			if sawOutput && lastGrowthAt != nil {
				if time.Since(*lastGrowthAt) >= idleFlush {
					return s.jobResultFromView(view, row, window), nil
				}
			}
		}

		if time.Now().After(deadline) {
			var window *OutputWindow
			if currentSize > int64(req.Offset) {
				window, err = ReadOutputWindow(outputPath, req.Offset, outputLimit)
				if err != nil {
					return nil, err
				}
			} else {
				window = &OutputWindow{Output: "", Offset: req.Offset, Truncated: false}
			}
			return s.jobResultFromView(view, row, window), nil
		}

		time.Sleep(s.config.PollInterval)
	}
}

// TailJob returns the tail of a job's output.
func (s *Service) TailJob(jobID string, outputLimit int) (*JobResult, error) {
	row, err := s.db.GetJob(jobID)
	if err != nil {
		return nil, err
	}
	view, err := s.GetJobStatus(jobID)
	if err != nil {
		return nil, err
	}
	window, err := TailOutputWindow(s.outputLogPath(row), outputLimit)
	if err != nil {
		return nil, err
	}
	return s.jobResultFromView(view, row, window), nil
}

// GetJobStatus materializes the current status from SQLite + live tmux state.
func (s *Service) GetJobStatus(jobID string) (*JobStatusView, error) {
	sessionExists, pipeActive, err := s.liveRuntimeState(jobID)
	if err != nil {
		return nil, err
	}
	return s.materializeStatusView(jobID, sessionExists, pipeActive)
}

// ListJobs returns recent jobs, optionally filtered by status.
func (s *Service) ListJobs(status *JobStatusName, limit int) (*ListJobsResponse, error) {
	rows, err := s.db.ListJobs(nil)
	if err != nil {
		return nil, err
	}

	var items []JobInfo
	for _, row := range rows {
		view, err := s.GetJobStatus(row.JobID)
		if err != nil {
			if isNotFound(err) {
				continue
			}
			return nil, err
		}
		if status != nil && view.Status != *status {
			continue
		}
		items = append(items, JobInfo{
			JobID:     view.JobID,
			Status:    view.Status,
			CreatedAt: view.CreatedAt,
			StartedAt: view.StartedAt,
			EndedAt:   view.EndedAt,
		})
		if len(items) >= limit {
			break
		}
	}
	return &ListJobsResponse{Jobs: items}, nil
}

// SendInput sends input to a running job and waits.
func (s *Service) SendInput(jobID string, req *InputJobRequest) (*JobResult, error) {
	view, err := s.GetJobStatus(jobID)
	if err != nil {
		return nil, err
	}
	if view.Done {
		return nil, NewServerError(409, "job_not_running", fmt.Sprintf("Job %s is already terminal", jobID))
	}

	if err := s.tmux.SendInput(jobID, req.Text); err != nil {
		// Check if job became terminal in the meantime
		if se, ok := err.(*ServerError); ok && se.Code == "tmux_target_missing" {
			view, _ = s.GetJobStatus(jobID)
			if view != nil && view.Done {
				return nil, NewServerError(409, "job_not_running", fmt.Sprintf("Job %s is already terminal", jobID))
			}
		}
		return nil, err
	}

	return s.WaitJob(jobID, &WaitJobRequest{
		Offset:           req.Offset,
		Timeout:          req.Timeout,
		OutputLimit:      req.OutputLimit,
		IdleFlushSeconds: req.IdleFlushSeconds,
	})
}

// TerminateJob terminates a running job.
func (s *Service) TerminateJob(jobID string, graceSeconds float64) (*JobStatusView, error) {
	view, err := s.GetJobStatus(jobID)
	if err != nil {
		return nil, err
	}
	if view.Done {
		s.tmux.CleanupSession(jobID)
		return view, nil
	}

	_, _ = s.db.TransitionStatus(jobID, TransitionOpts{
		AllowedFrom:       []JobStatusName{StatusCreated, StatusStarting, StatusRunning},
		AllowOverrideFrom: []JobStatusName{StatusExited},
		Target:            StatusTerminated,
	})

	_ = s.tmux.SendInterrupt(jobID)
	if graceSeconds > 0 {
		time.Sleep(time.Duration(graceSeconds * float64(time.Second)))
	}
	s.tmux.CleanupSession(jobID)

	return s.GetJobStatus(jobID)
}

// DeleteJob deletes a job and its artifacts.
func (s *Service) DeleteJob(jobID string, force bool, graceSeconds float64) (*DeleteJobResponse, error) {
	view, err := s.GetJobStatus(jobID)
	if err != nil {
		return nil, err
	}
	if !view.Done {
		if !force {
			return nil, NewServerError(409, "job_running", fmt.Sprintf("Job %s is still running", jobID))
		}
		_, _ = s.TerminateJob(jobID, graceSeconds)
	}

	s.tmux.CleanupSession(jobID)
	if err := s.db.DeleteJob(jobID); err != nil {
		return nil, err
	}
	_ = os.RemoveAll(filepath.Join(s.config.JobsDir(), jobID))
	return &DeleteJobResponse{JobID: jobID, Deleted: true}, nil
}

// Reconcile synchronizes SQLite rows with live tmux state.
func (s *Service) Reconcile() error {
	rows, err := s.db.ListJobs(nil)
	if err != nil {
		return err
	}
	for _, row := range rows {
		view, err := s.GetJobStatus(row.JobID)
		if err != nil {
			if isNotFound(err) {
				continue
			}
			return err
		}
		if view.Done {
			s.tmux.CleanupSession(row.JobID)
		}
	}
	return nil
}

// GCOnce removes expired terminal jobs.
func (s *Service) GCOnce() error {
	cutoff := time.Now().Add(-s.config.GCFinishedJobRetention)
	rows, err := s.db.ListJobs(nil)
	if err != nil {
		return err
	}
	for _, row := range rows {
		view, err := s.GetJobStatus(row.JobID)
		if err != nil {
			if isNotFound(err) {
				continue
			}
			return err
		}
		if !view.Done || view.EndedAt == nil {
			continue
		}
		endedAt, err := ParseTimestamp(*view.EndedAt)
		if err != nil {
			continue
		}
		if endedAt.After(cutoff) {
			continue
		}
		s.tmux.CleanupSession(row.JobID)
		_ = s.db.DeleteJob(row.JobID)
		_ = os.RemoveAll(filepath.Join(s.config.JobsDir(), row.JobID))
	}
	return nil
}

// CheckRunningJobsPipeHealth fails running jobs whose pipe died.
func (s *Service) CheckRunningJobsPipeHealth() {
	rows, _ := s.db.ListJobs([]JobStatusName{StatusRunning})
	for _, row := range rows {
		_, _ = s.GetJobStatus(row.JobID)
	}
}

func (s *Service) materializeStatusView(jobID string, sessionExists bool, pipeActive *bool) (*JobStatusView, error) {
	row, err := s.db.GetJob(jobID)
	if err != nil {
		return nil, err
	}

	status := row.Status

	if status.IsTerminal() {
		// Ensure ended_at is set
		if row.EndedAt == nil {
			now := FormatTimestamp(time.Now())
			_, _ = s.db.TransitionStatus(jobID, TransitionOpts{
				AllowedFrom: []JobStatusName{status},
				Target:      status,
				EndedAt:     now,
			})
			if r, err := s.db.GetJob(jobID); err == nil {
				row = r
			}
		}
	} else if row.ExitCode != nil {
		// Already has exit code, transition to exited
		if r, err := s.db.TransitionStatus(jobID, TransitionOpts{
			AllowedFrom: []JobStatusName{StatusCreated, StatusStarting, StatusRunning},
			Target:      StatusExited,
		}); err == nil {
			row = r
		}
	} else if exit := s.drainedNormalExitMetadata(jobID); exit != nil {
		// Recover from drained exit artifacts
		_ = s.db.RecordRunnerExit(jobID, exit.exitCode, exit.endedAt)
		if r, err := s.db.GetJob(jobID); err == nil {
			row = r
		}
	} else if sessionExists {
		if pipeActive != nil && !*pipeActive {
			s.mu.Lock()
			isStarting := s.startingJobs[jobID]
			s.mu.Unlock()
			if !isStarting {
				reason := "pipe_failed"
				msg := "The tmux output pipe stopped while the job was still running."
				if r, err := s.db.TransitionStatus(jobID, TransitionOpts{
					AllowedFrom: []JobStatusName{StatusCreated, StatusStarting, StatusRunning},
					Target:      StatusFailed,
					Reason:      &reason,
					Message:     &msg,
				}); err == nil {
					row = r
				}
			}
		} else if status == StatusCreated || status == StatusStarting {
			s.mu.Lock()
			isStarting := s.startingJobs[jobID]
			s.mu.Unlock()
			if !isStarting {
				if r, err := s.db.TransitionStatus(jobID, TransitionOpts{
					AllowedFrom:         []JobStatusName{StatusCreated, StatusStarting},
					Target:              StatusRunning,
					RequireExitCodeNull: true,
				}); err == nil {
					row = r
				}
			}
		}
	} else {
		// No session
		if s.normalExitCommitPending(jobID) {
			// Wait for pipe drain finalizer
		} else {
			s.mu.Lock()
			isStarting := s.startingJobs[jobID]
			s.mu.Unlock()
			if !isStarting || (status != StatusCreated && status != StatusStarting) {
				reason := "tmux_session_missing"
				msg := "The dedicated tmux session is no longer present."
				if r, err := s.db.TransitionStatus(jobID, TransitionOpts{
					AllowedFrom: []JobStatusName{StatusCreated, StatusStarting, StatusRunning},
					Target:      StatusLost,
					Reason:      &reason,
					Message:     &msg,
				}); err == nil {
					row = r
				}
			}
		}
	}

	return s.statusViewFromRow(row), nil
}

func (s *Service) liveRuntimeState(jobID string) (bool, *bool, error) {
	exists, err := s.tmux.SessionExists(JobSessionName(jobID))
	if err != nil {
		return false, nil, err
	}
	if !exists {
		return false, nil, nil
	}
	active, err := s.tmux.IsOutputPipeActive(jobID)
	if err != nil {
		return false, nil, err
	}
	if active == nil {
		return false, nil, nil
	}
	return true, active, nil
}

type exitMetadata struct {
	exitCode int
	endedAt  string
}

func (s *Service) drainedNormalExitMetadata(jobID string) *exitMetadata {
	jobDir := filepath.Join(s.config.JobsDir(), jobID)
	drainedPath := filepath.Join(jobDir, ".pipe-drained")
	exitCodePath := filepath.Join(jobDir, "runner-exit-code")
	endedAtPath := filepath.Join(jobDir, "runner-ended-at")

	if !fileExists(drainedPath) || !fileExists(exitCodePath) || !fileExists(endedAtPath) {
		return nil
	}

	exitCodeRaw, err := os.ReadFile(exitCodePath)
	if err != nil {
		return nil
	}
	endedAtRaw, err := os.ReadFile(endedAtPath)
	if err != nil {
		return nil
	}

	exitCodeStr := strings.TrimSpace(string(exitCodeRaw))
	endedAtStr := strings.TrimSpace(string(endedAtRaw))
	if exitCodeStr == "" || endedAtStr == "" {
		return nil
	}

	code, err := strconv.Atoi(exitCodeStr)
	if err != nil {
		return nil
	}

	return &exitMetadata{exitCode: code, endedAt: endedAtStr}
}

func (s *Service) normalExitCommitPending(jobID string) bool {
	jobDir := filepath.Join(s.config.JobsDir(), jobID)
	return fileExists(filepath.Join(jobDir, "runner-exit-code")) &&
		fileExists(filepath.Join(jobDir, "runner-ended-at")) &&
		!fileExists(filepath.Join(jobDir, ".pipe-drained")) &&
		!fileExists(filepath.Join(jobDir, ".pipe-failed"))
}

func (s *Service) outputLogPath(row *JobRow) string {
	return filepath.Join(s.config.StateDir, row.OutputPath)
}

func (s *Service) statusViewFromRow(row *JobRow) *JobStatusView {
	outputPath := s.outputLogPath(row)
	offset := int(fileSize(outputPath))
	return &JobStatusView{
		JobID:     row.JobID,
		Status:    row.Status,
		Done:      row.Status.IsTerminal(),
		ExitCode:  row.ExitCode,
		CreatedAt: row.CreatedAt,
		StartedAt: row.StartedAt,
		EndedAt:   row.EndedAt,
		Offset:    offset,
	}
}

func (s *Service) jobResultFromView(view *JobStatusView, row *JobRow, window *OutputWindow) *JobResult {
	outputPath := s.outputLogPath(row)
	absPath, _ := filepath.Abs(outputPath)
	return &JobResult{
		JobID:      view.JobID,
		Done:       view.Done,
		Status:     view.Status,
		ExitCode:   view.ExitCode,
		OutputPath: absPath,
		Output:     window.Output,
		Offset:     window.Offset,
		Truncated:  window.Truncated,
	}
}

func (s *Service) resolveCwd(rawCwd *string) (string, error) {
	var cwd string
	if rawCwd != nil && *rawCwd != "" {
		cwd = *rawCwd
	} else {
		cwd = s.config.DefaultCwd
	}

	info, err := os.Stat(cwd)
	if err != nil || !info.IsDir() {
		return "", NewServerError(400, "invalid_cwd", fmt.Sprintf("cwd is not a directory: %s", cwd))
	}
	abs, _ := filepath.Abs(cwd)
	return abs, nil
}

func (s *Service) allocateJobDir() (string, string, error) {
	for i := 0; i < 20; i++ {
		jobID := GenerateJobID()
		jobDir := filepath.Join(s.config.JobsDir(), jobID)
		if err := os.Mkdir(jobDir, 0700); err == nil {
			return jobID, jobDir, nil
		}
	}
	return "", "", NewServerError(500, "job_id_collision", "Failed to allocate a unique job id")
}

func (s *Service) cleanupStarting(jobID, jobDir string) {
	s.mu.Lock()
	delete(s.startingJobs, jobID)
	s.mu.Unlock()
	_ = os.RemoveAll(jobDir)
}

func (s *Service) installRunner() {
	script := s.runnerScriptSource()
	_ = os.WriteFile(s.config.RunnerPath(), []byte(script), 0755)
}

func (s *Service) runnerScriptSource() string {
	// The runner script is a bash wrapper that waits for the start-gate,
	// then delegates env loading + exec to a Python bootstrap so that
	// JSON env values (including multi-line strings) are applied verbatim.
	// The Python helper exec's the target process so SIGINT semantics
	// match running the script directly in the tmux pane.
	return `#!/usr/bin/env bash
set -uo pipefail

JOB_DIR="$1"
JOB_ID="$2"
CWD="$3"
SCRIPT_PATH="$JOB_DIR/script"
ENV_PATH="$JOB_DIR/.job-env.json"
START_GATE="$JOB_DIR/start-gate"
RUNNER_EXIT_CODE_PATH="$JOB_DIR/runner-exit-code"
RUNNER_ENDED_AT_PATH="$JOB_DIR/runner-ended-at"

write_atomic() {
  local dest="$1"
  local value="$2"
  local tmp="${dest}.tmp.$$"
  printf '%s\n' "$value" > "$tmp"
  mv "$tmp" "$dest"
}

while [ ! -e "$START_GATE" ]; do
  sleep 0.05
done

unset TMUX
unset SHELLCTL_STATE_DIR
unset SHELLCTL_RUNTIME_DIR
unset SHELLCTL_TMUX_SOCKET
unset SHELLCTL_RUNNER
unset SHELLCTL_AUTH_TOKEN

# Use Python bootstrap to load JSON env verbatim and exec the target.
# This avoids depending on jq and correctly handles multi-line values.
python3 -c '
import json, os, stat, sys
from pathlib import Path

script_path = Path(sys.argv[1])
cwd = sys.argv[2]
env_path = Path(sys.argv[3])

env = os.environ.copy()
if env_path.exists():
    env.update(json.loads(env_path.read_text(encoding="utf-8")))

try:
    os.chdir(cwd)
except OSError:
    raise SystemExit(111)

# Ensure HOME directory exists (agent backend may set a per-agent HOME).
home = env.get("HOME", "")
if home and not os.path.isdir(home):
    os.makedirs(home, exist_ok=True)

with script_path.open("r", encoding="utf-8") as handle:
    first_line = handle.readline()

if first_line.startswith("#!"):
    script_path.chmod(script_path.stat().st_mode | stat.S_IXUSR)
    argv = [str(script_path)]
else:
    argv = ["sh", str(script_path)]

try:
    os.execvpe(argv[0], argv, env)
except FileNotFoundError as exc:
    print(f"{argv[0]}: {exc.strerror}", file=sys.stderr)
    raise SystemExit(127) from exc
except OSError as exc:
    print(f"{argv[0]}: {exc.strerror}", file=sys.stderr)
    raise SystemExit(126) from exc
' "$SCRIPT_PATH" "$CWD" "$ENV_PATH"
EXIT_CODE=$?

ENDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

write_atomic "$RUNNER_EXIT_CODE_PATH" "$EXIT_CODE"
write_atomic "$RUNNER_ENDED_AT_PATH" "$ENDED_AT"

exit "$EXIT_CODE"
`
}

// Helpers

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func isNotFound(err error) bool {
	if se, ok := err.(*ServerError); ok {
		return se.Code == "job_not_found"
	}
	return false
}

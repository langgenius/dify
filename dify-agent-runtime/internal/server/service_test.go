package server

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langgenius/dify/dify-agent-runtime/internal/jobmode"
)

func TestResolveCwd(t *testing.T) {
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	workspace := filepath.Join(base, "workspace")
	nested := filepath.Join(workspace, "projects", "demo")
	outside := filepath.Join(base, "outside")
	outsideChild := filepath.Join(outside, "child")
	sibling := workspace + "-evil"
	secondRoot := filepath.Join(base, "second-workspace")
	for _, dir := range []string{nested, outsideChild, sibling, secondRoot} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	file := filepath.Join(workspace, "file")
	if err := os.WriteFile(file, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	rootLink := filepath.Join(base, "workspace-link")
	insideLink := filepath.Join(workspace, "inside-link")
	outsideLink := filepath.Join(workspace, "outside-link")
	brokenLink := filepath.Join(workspace, "broken-link")
	missing := filepath.Join(base, "missing")
	for _, link := range []struct{ path, target string }{
		{rootLink, workspace},
		{insideLink, nested},
		{outsideLink, outsideChild},
		{brokenLink, missing},
	} {
		if err := os.Symlink(link.target, link.path); err != nil {
			t.Fatal(err)
		}
	}
	// Keep outside fixtures outside every allowed root, regardless of TMPDIR.
	baseConfig := &Config{DefaultCwd: rootLink, AllowedCwdRoots: []string{rootLink}}
	restrictedConfig := &Config{DefaultCwd: outside, AllowedCwdRoots: []string{workspace}}
	cases := []struct {
		name        string
		config      *Config
		cwd         *string
		want        string
		wantMessage string // Non-empty means HTTP 400 invalid_cwd with this diagnostic.
	}{
		{name: "omitted uses canonical default", want: workspace},
		{name: "empty uses canonical default", cwd: strPtr(""), want: workspace},
		{name: "dynamic default root", config: &Config{DefaultCwd: rootLink, AllowedCwdRoots: nil}, want: workspace},
		{name: "root itself", cwd: strPtr(workspace), want: workspace},
		{name: "nested directory", cwd: strPtr(nested), want: nested},
		{name: "relative nested directory", cwd: strPtr("projects/demo"), want: nested},
		{name: "relative current directory", cwd: strPtr("."), want: workspace},
		{name: "relative parent within root", cwd: strPtr("projects/../projects/demo"), want: nested},
		{name: "relative parent outside root", cwd: strPtr("../outside"), wantMessage: "outside allowed workspace roots"},
		{name: "absolute parent outside root", cwd: strPtr(workspace + "/../outside"), wantMessage: "outside allowed workspace roots"},
		{name: "symlink inside root", cwd: strPtr(insideLink), want: nested},
		{name: "symlink outside root", cwd: strPtr(outsideLink), wantMessage: "outside allowed workspace roots"},
		{name: "absolute symlink parent outside root", cwd: strPtr(outsideLink + "/.."), wantMessage: "outside allowed workspace roots"},
		{name: "relative symlink parent outside root", cwd: strPtr("outside-link/.."), wantMessage: "outside allowed workspace roots"},
		{name: "symlinked root", cwd: strPtr(rootLink), want: workspace},
		{name: "symlinked explicit root", config: &Config{AllowedCwdRoots: []string{rootLink}}, cwd: strPtr(nested), want: nested},
		{name: "sibling prefix collision", cwd: strPtr(sibling), wantMessage: "outside allowed workspace roots"},
		{name: "missing directory", cwd: strPtr(missing), wantMessage: "not a directory"},
		{name: "regular file", cwd: strPtr(file), wantMessage: "not a directory"},
		{name: "file parent traversal", cwd: strPtr(file + "/.."), wantMessage: "not a directory"},
		{name: "broken symlink", cwd: strPtr(brokenLink), wantMessage: "not a directory"},
		{name: "NUL byte", cwd: strPtr(workspace + "\x00"), wantMessage: "not a directory"},
		{name: "outside default omitted", config: restrictedConfig, wantMessage: "outside allowed workspace roots"},
		{name: "outside default empty", config: restrictedConfig, cwd: strPtr(""), wantMessage: "outside allowed workspace roots"},
		{name: "explicit roots replace defaults", config: &Config{DefaultCwd: workspace, AllowedCwdRoots: []string{secondRoot}}, cwd: strPtr(workspace), wantMessage: "outside allowed workspace roots"},
		{name: "second explicit root", config: &Config{DefaultCwd: workspace, AllowedCwdRoots: []string{workspace, secondRoot}}, cwd: strPtr(secondRoot), want: secondRoot},
		{name: "absent root skipped", config: &Config{AllowedCwdRoots: []string{missing, workspace}}, cwd: strPtr(nested), want: nested},
		{name: "invalid roots fail closed", config: &Config{AllowedCwdRoots: []string{missing, file, brokenLink, "relative", ""}}, cwd: strPtr(workspace), wantMessage: "outside allowed workspace roots"},
		{name: "filesystem root allowed", config: &Config{AllowedCwdRoots: []string{string(filepath.Separator)}}, cwd: strPtr(nested), want: nested},
		{name: "empty default omitted", config: &Config{}, wantMessage: "not a directory"},
		{name: "relative default omitted", config: &Config{DefaultCwd: "workspace"}, wantMessage: "not a directory"},
		{name: "relative cwd without default", config: &Config{AllowedCwdRoots: []string{workspace}}, cwd: strPtr("projects/demo"), wantMessage: "not a directory"},
		{name: "relative cwd with relative default", config: &Config{DefaultCwd: "workspace", AllowedCwdRoots: []string{workspace}}, cwd: strPtr("projects/demo"), wantMessage: "not a directory"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			config := tc.config
			if config == nil {
				config = baseConfig
			}
			service := NewService(config)
			got, err := service.resolveCwd(tc.cwd)
			if tc.wantMessage != "" {
				var serverErr *ServerError
				if !errors.As(err, &serverErr) || serverErr.StatusCode != 400 || serverErr.Code != "invalid_cwd" {
					t.Fatalf("resolveCwd = %q, %v, want HTTP 400 invalid_cwd", got, err)
				}
				if !strings.Contains(serverErr.Message, tc.wantMessage) {
					t.Errorf("error message = %q, want diagnostic containing %q", serverErr.Message, tc.wantMessage)
				}
				if got != "" {
					t.Errorf("invalid cwd returned usable path %q", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Errorf("resolveCwd = %q, want canonical path %q", got, tc.want)
			}
		})
	}
}

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

package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	"github.com/langgenius/dify/dify-agent-runtime/internal/jobmode"
)

func TestRunStdioCapturesCompleteSeparatedStreams(t *testing.T) {
	jobDir := t.TempDir()
	cmd := exec.Command(os.Args[0], "-test.run=^TestStdioHelperProcess$")
	cmd.Env = append(os.Environ(), "SHELLCTL_STDIO_HELPER=large-output")

	if exitCode := runStdio(cmd, jobDir); exitCode != 0 {
		t.Fatalf("runStdio exit code = %d, want 0", exitCode)
	}

	wantStdout := bytes.Repeat([]byte("stdout-payload\n"), 16*1024)
	wantStderr := bytes.Repeat([]byte("stderr-payload\n"), 16*1024)
	gotStdout, err := os.ReadFile(filepath.Join(jobDir, "output.log"))
	if err != nil {
		t.Fatalf("read output.log: %v", err)
	}
	gotStderr, err := os.ReadFile(filepath.Join(jobDir, "stderr.log"))
	if err != nil {
		t.Fatalf("read stderr.log: %v", err)
	}
	if !bytes.Equal(gotStdout, wantStdout) {
		t.Errorf("stdout capture length = %d, want %d", len(gotStdout), len(wantStdout))
	}
	if !bytes.Equal(gotStderr, wantStderr) {
		t.Errorf("stderr capture length = %d, want %d", len(gotStderr), len(wantStderr))
	}
	for _, name := range []string{"output.log", "stderr.log"} {
		info, err := os.Stat(filepath.Join(jobDir, name))
		if err != nil {
			t.Fatalf("stat %s: %v", name, err)
		}
		if got := info.Mode().Perm(); got != 0600 {
			t.Errorf("%s permissions = %#o, want 0600", name, got)
		}
	}
}

func TestRunStdioUsesNonTTYStreams(t *testing.T) {
	jobDir := t.TempDir()
	cmd := exec.Command("sh", "-c", `if [ -t 0 ] || [ -t 1 ] || [ -t 2 ]; then exit 1; fi; printf 'stdout-only'; printf 'warning' >&2`)

	if exitCode := runStdio(cmd, jobDir); exitCode != 0 {
		t.Fatalf("runStdio exit code = %d, want 0", exitCode)
	}
	stdout, err := os.ReadFile(filepath.Join(jobDir, "output.log"))
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := os.ReadFile(filepath.Join(jobDir, "stderr.log"))
	if err != nil {
		t.Fatal(err)
	}
	if string(stdout) != "stdout-only" {
		t.Errorf("stdout = %q, want stdout-only", stdout)
	}
	if string(stderr) != "warning" {
		t.Errorf("stderr = %q, want warning", stderr)
	}
}

func TestRunStdioWaitsForBothDescendantStreamsBeforePublishingExit(t *testing.T) {
	jobDir := t.TempDir()
	cmd := exec.Command(os.Args[0], "-test.run=^TestStdioHelperProcess$")
	cmd.Env = mergeEnv(os.Environ(), map[string]string{
		"SHELLCTL_STDIO_HELPER":  "spawn-descendants",
		"SHELLCTL_STDIO_JOB_DIR": jobDir,
	})
	done := make(chan struct{})
	var exitCode int
	go func() {
		exitCode = runCommandAndRecordExit(cmd, jobDir, jobmode.Stdio)
		close(done)
	}()

	stdoutRelease := filepath.Join(jobDir, "release-stdout")
	stderrRelease := filepath.Join(jobDir, "release-stderr")
	t.Cleanup(func() {
		_ = os.WriteFile(stdoutRelease, nil, 0600)
		_ = os.WriteFile(stderrRelease, nil, 0600)
		for _, name := range []string{"stdout-closed", "stderr-closed"} {
			if !waitForPath(filepath.Join(jobDir, name), 5*time.Second) {
				t.Errorf("cleanup timed out waiting for %s", name)
			}
		}
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("cleanup timed out waiting for runner completion")
		}
	})

	waitForTestFile(t, filepath.Join(jobDir, "direct-child-exited"))
	assertRunnerRemainsIncomplete(t, done)
	assertExitArtifactsAbsent(t, jobDir)

	if err := os.WriteFile(stdoutRelease, nil, 0600); err != nil {
		t.Fatal(err)
	}
	waitForTestFile(t, filepath.Join(jobDir, "stdout-closed"))
	assertRunnerRemainsIncomplete(t, done)
	assertExitArtifactsAbsent(t, jobDir)

	if err := os.WriteFile(stderrRelease, nil, 0600); err != nil {
		t.Fatal(err)
	}
	waitForTestFile(t, filepath.Join(jobDir, "stderr-closed"))

	select {
	case <-done:
		if exitCode != 0 {
			t.Fatalf("exit code = %d, want 0", exitCode)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("runner did not complete after both descendant streams reached EOF")
	}
	waitForTestFile(t, filepath.Join(jobDir, "runner-exit-code"))
	waitForTestFile(t, filepath.Join(jobDir, "runner-ended-at"))

	stdout, err := os.ReadFile(filepath.Join(jobDir, "output.log"))
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := os.ReadFile(filepath.Join(jobDir, "stderr.log"))
	if err != nil {
		t.Fatal(err)
	}
	if string(stdout) != "stdout-tail" {
		t.Errorf("stdout = %q, want stdout-tail", stdout)
	}
	if string(stderr) != "stderr-tail" {
		t.Errorf("stderr = %q, want stderr-tail", stderr)
	}
}

func TestRunStdioPreservesNonZeroExitCode(t *testing.T) {
	jobDir := t.TempDir()
	cmd := exec.Command("sh", "-c", "exit 23")

	if exitCode := runCommandAndRecordExit(cmd, jobDir, jobmode.Stdio); exitCode != 23 {
		t.Fatalf("exit code = %d, want 23", exitCode)
	}
	exitCodeArtifact, err := os.ReadFile(filepath.Join(jobDir, "runner-exit-code"))
	if err != nil {
		t.Fatal(err)
	}
	if string(exitCodeArtifact) != "23\n" {
		t.Errorf("runner-exit-code = %q, want 23", exitCodeArtifact)
	}
}

func TestStdioHelperProcess(t *testing.T) {
	switch os.Getenv("SHELLCTL_STDIO_HELPER") {
	case "":
		return
	case "large-output":
		stdout := bytes.Repeat([]byte("stdout-payload\n"), 16*1024)
		stderr := bytes.Repeat([]byte("stderr-payload\n"), 16*1024)
		_, _ = os.Stdout.Write(stdout)
		_, _ = os.Stderr.Write(stderr)
		os.Exit(0)
	case "spawn-descendants":
		spawnStdioDescendants()
	case "hold-stdout", "hold-stderr":
		holdStdioStream(os.Getenv("SHELLCTL_STDIO_HELPER"))
	default:
		os.Exit(125)
	}
}

func spawnStdioDescendants() {
	jobDir := os.Getenv("SHELLCTL_STDIO_JOB_DIR")
	parentPID := strconv.Itoa(os.Getpid())
	stdoutHolder := exec.Command(os.Args[0], "-test.run=^TestStdioHelperProcess$")
	stdoutHolder.Env = mergeEnv(os.Environ(), map[string]string{
		"SHELLCTL_STDIO_HELPER":     "hold-stdout",
		"SHELLCTL_STDIO_JOB_DIR":    jobDir,
		"SHELLCTL_STDIO_PARENT_PID": parentPID,
	})
	stdoutHolder.Stdout = os.Stdout
	if err := stdoutHolder.Start(); err != nil {
		os.Exit(125)
	}

	stderrHolder := exec.Command(os.Args[0], "-test.run=^TestStdioHelperProcess$")
	stderrHolder.Env = mergeEnv(os.Environ(), map[string]string{
		"SHELLCTL_STDIO_HELPER":  "hold-stderr",
		"SHELLCTL_STDIO_JOB_DIR": jobDir,
	})
	stderrHolder.Stderr = os.Stderr
	if err := stderrHolder.Start(); err != nil {
		os.Exit(125)
	}

	if !waitForPath(filepath.Join(jobDir, "stdout-ready"), 5*time.Second) ||
		!waitForPath(filepath.Join(jobDir, "stderr-ready"), 5*time.Second) {
		os.Exit(125)
	}
	os.Exit(0)
}

func holdStdioStream(mode string) {
	jobDir := os.Getenv("SHELLCTL_STDIO_JOB_DIR")
	streamName := mode[len("hold-"):]
	if err := os.WriteFile(filepath.Join(jobDir, streamName+"-ready"), nil, 0600); err != nil {
		os.Exit(125)
	}
	if mode == "hold-stdout" {
		parentPID, err := strconv.Atoi(os.Getenv("SHELLCTL_STDIO_PARENT_PID"))
		if err != nil || !waitForProcessExit(parentPID, 5*time.Second) {
			os.Exit(125)
		}
		if err := os.WriteFile(filepath.Join(jobDir, "direct-child-exited"), nil, 0600); err != nil {
			os.Exit(125)
		}
	}

	if !waitForPath(filepath.Join(jobDir, "release-"+streamName), 5*time.Second) {
		os.Exit(125)
	}
	if mode == "hold-stdout" {
		_, _ = os.Stdout.WriteString("stdout-tail")
		_ = os.Stdout.Close()
	} else {
		_, _ = os.Stderr.WriteString("stderr-tail")
		_ = os.Stderr.Close()
	}
	if err := os.WriteFile(filepath.Join(jobDir, streamName+"-closed"), nil, 0600); err != nil {
		os.Exit(125)
	}
	os.Exit(0)
}

func waitForProcessExit(pid int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if err := syscall.Kill(pid, 0); err == syscall.ESRCH {
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	return false
}

func waitForPath(path string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	return false
}

func waitForTestFile(t *testing.T, path string) {
	t.Helper()
	if !waitForPath(path, 5*time.Second) {
		t.Fatalf("timed out waiting for %s", filepath.Base(path))
	}
}

func assertRunnerRemainsIncomplete(t *testing.T, done <-chan struct{}) {
	t.Helper()
	timer := time.NewTimer(100 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-done:
		t.Fatal("runner completed before both streams reached EOF")
	case <-timer.C:
	}
}

func assertExitArtifactsAbsent(t *testing.T, jobDir string) {
	t.Helper()
	for _, name := range []string{"runner-exit-code", "runner-ended-at"} {
		if _, err := os.Stat(filepath.Join(jobDir, name)); !os.IsNotExist(err) {
			t.Fatalf("%s became visible before both streams reached EOF: %v", name, err)
		}
	}
}

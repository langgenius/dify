//go:build linux && (amd64 || arm64)

package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

func TestRunnerMissingKernelLandlockSupportDoesNotExecuteScript(t *testing.T) {
	runnerPath := filepath.Join(t.TempDir(), "shellctl-runner")
	build := exec.Command("go", "build", "-o", runnerPath, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build runner: %v\n%s", err, output)
	}

	for _, mode := range []string{"pty", "stdio"} {
		for _, isolation := range []string{"true", "false"} {
			t.Run(mode+"/isolation="+isolation, func(t *testing.T) {
				jobDir, home, cwd := t.TempDir(), t.TempDir(), t.TempDir()
				for name, content := range map[string]string{
					"script":     "printf executed > script-executed",
					"start-gate": "",
				} {
					if err := os.WriteFile(filepath.Join(jobDir, name), []byte(content), 0600); err != nil {
						t.Fatal(err)
					}
				}
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestRunnerMissingLandlockHelperProcess$",
					"--", runnerPath, jobDir, "test-job", cwd, mode)
				// All rule paths are valid: only missing kernel support can cause
				// setup to fail. BestEffort would silently run the script instead.
				cmd.Env = mergeEnv(os.Environ(), map[string]string{
					"HOME":                             home,
					"SHELLCTL_MISSING_LANDLOCK_HELPER": "1",
					"SHELLCTL_ENABLE_PATH_ISOLATION":   isolation,
					"SHELLCTL_LANDLOCK_RW_PATHS":       t.TempDir(),
					"SHELLCTL_LANDLOCK_RO_PATHS":       t.TempDir(),
					"SHELLCTL_LANDLOCK_RW_DEV_PATHS":   "/dev/null",
				})
				output, err := cmd.CombinedOutput()
				wantExitCode := 125
				if isolation == "false" {
					wantExitCode = 0
				}
				if got := commandExitCode(err); got != wantExitCode {
					t.Fatalf("exit code = %d, want %d: %s", got, wantExitCode, output)
				}
				exitArtifact, err := os.ReadFile(filepath.Join(jobDir, "runner-exit-code"))
				if err != nil || strings.TrimSpace(string(exitArtifact)) != strconv.Itoa(wantExitCode) {
					t.Fatalf("exit artifact = %q, err = %v", exitArtifact, err)
				}
				endedAt, err := os.ReadFile(filepath.Join(jobDir, "runner-ended-at"))
				if err != nil {
					t.Fatal(err)
				}
				if _, err := time.Parse(time.RFC3339, strings.TrimSpace(string(endedAt))); err != nil {
					t.Fatalf("invalid runner-ended-at %q: %v", endedAt, err)
				}
				marker, markerErr := os.ReadFile(filepath.Join(cwd, "script-executed"))
				if isolation == "false" {
					if markerErr != nil || string(marker) != "executed" {
						t.Fatalf("disabled isolation did not execute script: marker = %q, err = %v", marker, markerErr)
					}
					return
				}
				if !os.IsNotExist(markerErr) {
					t.Fatalf("user script side effect exists: %v", markerErr)
				}
				if mode == "stdio" {
					output, err = os.ReadFile(filepath.Join(jobDir, "stderr.log"))
					if err != nil {
						t.Fatal(err)
					}
				}
				for _, diagnostic := range []string{"apply Landlock restrictions", "missing kernel Landlock support"} {
					if !strings.Contains(string(output), diagnostic) {
						t.Errorf("missing diagnostic %q: %s", diagnostic, output)
					}
				}
			})
		}
	}
}

func TestRunnerMissingLandlockHelperProcess(t *testing.T) {
	if os.Getenv("SHELLCTL_MISSING_LANDLOCK_HELPER") != "1" {
		return
	}
	if len(os.Args) != 8 || os.Args[2] != "--" {
		t.Fatalf("unexpected helper arguments: %q", os.Args)
	}
	// Seccomp is thread-local. Exec on this locked thread makes the runner
	// and all its children inherit the filter without restricting the test host.
	runtime.LockOSThread()
	const (
		prSetNoNewPrivs          = 38
		seccompModeFilter        = 2
		seccompRetErrno          = 0x00050000
		seccompRetAllow          = 0x7fff0000
		sysLandlockCreateRuleset = 444 // Linux amd64 and arm64.
	)
	if _, _, errno := syscall.Syscall6(syscall.SYS_PRCTL, prSetNoNewPrivs, 1, 0, 0, 0, 0); errno != 0 {
		t.Fatalf("set no_new_privs: %v", errno)
	}
	filters := []syscall.SockFilter{
		{Code: syscall.BPF_LD | syscall.BPF_W | syscall.BPF_ABS, K: 0}, // seccomp_data.nr
		{Code: syscall.BPF_JMP | syscall.BPF_JEQ | syscall.BPF_K, K: sysLandlockCreateRuleset, Jf: 1},
		{Code: syscall.BPF_RET | syscall.BPF_K, K: seccompRetErrno | uint32(syscall.EOPNOTSUPP)},
		{Code: syscall.BPF_RET | syscall.BPF_K, K: seccompRetAllow},
	}
	program := syscall.SockFprog{Len: uint16(len(filters)), Filter: &filters[0]}
	if _, _, errno := syscall.Syscall6(syscall.SYS_PRCTL, syscall.PR_SET_SECCOMP, seccompModeFilter,
		uintptr(unsafe.Pointer(&program)), 0, 0, 0); errno != 0 {
		t.Fatalf("install Landlock seccomp filter: %v", errno)
	}
	runtime.KeepAlive(filters)
	if err := syscall.Exec(os.Args[3], os.Args[3:], os.Environ()); err != nil {
		t.Fatalf("exec runner: %v", err)
	}
}

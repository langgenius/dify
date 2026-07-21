// shellctl-runner is the Go replacement for the previously generated bash+python
// runner script.  It is invoked by tmux as:
//
//	shellctl-runner <job_dir> <job_id> <cwd>
//
// The binary operates in two modes:
//
//  1. Parent mode (default): waits for start-gate, loads env, forks child,
//     waits for exit, writes exit artifacts.
//  2. Child mode (--exec flag): applies Landlock restrictions, then exec's
//     the user script.
//
// This eliminates the bash/python dependency chain and integrates Landlock
// directly.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/langgenius/dify/dify-agent-runtime/internal/cmdutil"
	"github.com/langgenius/dify/dify-agent-runtime/internal/envvar"
	"github.com/langgenius/dify/dify-agent-runtime/internal/landlock"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--exec" {
		childMode()
		return
	}
	parentMode()
}

// parentMode is the entry point when called by tmux.
// Args: shellctl-runner <job_dir> <job_id> <cwd>
func parentMode() {
	if len(os.Args) < 4 {
		cmdutil.HandleError(fmt.Errorf("bad args"), 125, "usage: shellctl-runner <job_dir> <job_id> <cwd>")
	}

	jobDir := os.Args[1]
	// jobID := os.Args[2] // unused in parent but passed for compat
	cwd := os.Args[3]

	scriptPath := filepath.Join(jobDir, "script")
	envPath := filepath.Join(jobDir, ".job-env.json")
	startGate := filepath.Join(jobDir, "start-gate")
	exitCodePath := filepath.Join(jobDir, "runner-exit-code")
	endedAtPath := filepath.Join(jobDir, "runner-ended-at")

	// Wait for start-gate.
	for {
		if _, err := os.Stat(startGate); err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Load environment overlay from JSON.
	env := os.Environ()
	// Remove internal shellctl vars from inherited env.
	env = filterEnv(env, []string{
		"TMUX",
		"SHELLCTL_STATE_DIR",
		"SHELLCTL_RUNTIME_DIR",
		"SHELLCTL_TMUX_SOCKET",
		"SHELLCTL_RUNNER",
		"SHELLCTL_AUTH_TOKEN",
	})

	envOverlay := loadEnvJSON(envPath)
	env = mergeEnv(env, envOverlay)

	// Ensure HOME exists.
	home := envGet(env, "HOME")
	if home != "" {
		cmdutil.HandleError(os.MkdirAll(home, 0755), 125, "mkdir HOME %s", home)
	}

	// Create a per-workspace temp directory under cwd and inject TMPDIR.
	// This avoids granting RW access to the shared /tmp.
	agentTmp := filepath.Join(cwd, ".tmp")
	cmdutil.HandleError(os.MkdirAll(agentTmp, 0755), 125, "mkdir TMPDIR %s", agentTmp)
	env = setEnvIfEmpty(env, "TMPDIR", agentTmp)
	env = setEnvIfEmpty(env, "TMP", agentTmp)
	env = setEnvIfEmpty(env, "TEMP", agentTmp)

	// Determine if path isolation is enabled.
	enableIsolation := envvar.PathIsolationEnabled()

	// Build child command: re-exec self in --exec mode.
	self, _ := os.Executable()
	childArgs := []string{"--exec", scriptPath, cwd}
	if enableIsolation {
		childArgs = append([]string{"--exec", "--landlock"}, childArgs[1:]...)
	}

	cmd := exec.Command(self, childArgs...)
	cmd.Env = env
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = cwd

	// Forward signals to child.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		for sig := range sigCh {
			if cmd.Process != nil {
				_ = cmd.Process.Signal(sig)
			}
		}
	}()

	err := cmd.Run()

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 125
		}
	}

	endedAt := time.Now().UTC().Format("2006-01-02T15:04:05Z")

	writeAtomic(exitCodePath, fmt.Sprintf("%d", exitCode))
	writeAtomic(endedAtPath, endedAt)

	os.Exit(exitCode)
}

// childMode applies Landlock (if --landlock flag) and exec's the user script.
// Args: shellctl-runner --exec [--landlock] <script_path> <cwd>
func childMode() {
	args := os.Args[2:] // skip program name and "--exec"
	applyLandlockFlag := false

	if len(args) > 0 && args[0] == "--landlock" {
		applyLandlockFlag = true
		args = args[1:]
	}

	if len(args) < 2 {
		cmdutil.HandleError(fmt.Errorf("bad args"), 125, "--exec: missing script_path and cwd")
	}

	scriptPath := args[0]
	cwd := args[1]

	// chdir
	cmdutil.HandleError(os.Chdir(cwd), 111, "chdir %s", cwd)

	// Determine argv for exec.
	argv := buildExecArgv(scriptPath)

	// Resolve binary before Landlock (PATH search).
	binary, err := exec.LookPath(argv[0])
	cmdutil.HandleError(err, 127, "%s: not found", argv[0])

	// Apply Landlock if requested.
	if applyLandlockFlag {
		home := os.Getenv("HOME")
		jobDir := filepath.Dir(scriptPath)
		cfg := landlock.ConfigFromEnv(home, cwd, jobDir)
		if err := landlock.Restrict(cfg); err != nil {
			// the landlock is best-effort, so we just log the error whatever it is
			fmt.Fprintf(os.Stderr, "shellctl-runner: WARNING: %v — running without filesystem isolation\n", err)
		}
	}

	// exec replaces the current process.
	cmdutil.HandleError(syscall.Exec(binary, argv, os.Environ()), 126, "exec %s", binary)
}

// buildExecArgv determines whether the script has a shebang or needs sh.
func buildExecArgv(scriptPath string) []string {
	f, err := os.Open(scriptPath)
	if err != nil {
		return []string{"sh", scriptPath}
	}
	defer func() { _ = f.Close() }()

	buf := make([]byte, 2)
	n, _ := f.Read(buf)
	if n == 2 && string(buf) == "#!" {
		// Has shebang — make executable and run directly.
		_ = os.Chmod(scriptPath, 0755)
		return []string{scriptPath}
	}
	return []string{"sh", scriptPath}
}

// loadEnvJSON reads a JSON object from path and returns key=value pairs.
func loadEnvJSON(path string) map[string]string {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		cmdutil.HandleError(err, 125, "read env json %s", path)
	}
	var m map[string]string
	if err := json.Unmarshal(data, &m); err != nil {
		cmdutil.HandleError(err, 125, "parse env json %s", path)
	}
	return m
}

// filterEnv removes entries with the given key prefixes from env.
func filterEnv(env []string, remove []string) []string {
	result := env[:0]
	for _, e := range env {
		skip := false
		for _, r := range remove {
			if strings.HasPrefix(e, r+"=") {
				skip = true
				break
			}
		}
		if !skip {
			result = append(result, e)
		}
	}
	return result
}

// mergeEnv applies overlay key=value pairs onto the env slice.
func mergeEnv(env []string, overlay map[string]string) []string {
	for k, v := range overlay {
		found := false
		prefix := k + "="
		for i, e := range env {
			if strings.HasPrefix(e, prefix) {
				env[i] = prefix + v
				found = true
				break
			}
		}
		if !found {
			env = append(env, prefix+v)
		}
	}
	return env
}

// envGet retrieves a value from a []string env slice.
func envGet(env []string, key string) string {
	prefix := key + "="
	for _, e := range env {
		if strings.HasPrefix(e, prefix) {
			return e[len(prefix):]
		}
	}
	return ""
}

// setEnvIfEmpty sets key=value in the env slice only if the key is not already present.
func setEnvIfEmpty(env []string, key, value string) []string {
	if envGet(env, key) != "" {
		return env
	}
	return append(env, key+"="+value)
}

// writeAtomic writes value to dest via a temp file + rename.
func writeAtomic(dest, value string) {
	tmp := fmt.Sprintf("%s.tmp.%d", dest, os.Getpid())
	if err := os.WriteFile(tmp, []byte(value+"\n"), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "shellctl-runner: write %s: %v\n", tmp, err)
		return
	}
	if err := os.Rename(tmp, dest); err != nil {
		fmt.Fprintf(os.Stderr, "shellctl-runner: rename %s -> %s: %v\n", tmp, dest, err)
	}
}

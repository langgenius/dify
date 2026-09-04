// End-to-end benchmarks that drive the real shellctl HTTP API in-process.
//
// Unlike perf_test.go (which isolates single techniques), this boots an actual
// *server.Service + Handler over httptest and fires real POST /v1/jobs/run
// requests, so it exercises the full path: job-dir mkdir, script/env writes,
// SQLite commits, tmux fork/exec, the WaitJob poll loop, and the background
// pipe monitor. It only uses stable exported APIs so it compiles unchanged
// against both the optimized and pre-optimization ("git stash") server code.
//
// Because it lives in an untracked file, `git stash` does NOT remove it — so
// the before/after workflow is:
//
//	go test ./benchmarks/ -bench E2E -run '^$' -benchtime 200x | tee after.txt
//	git stash
//	go test ./benchmarks/ -bench E2E -run '^$' -benchtime 200x | tee before.txt
//	git stash pop
//	benchstat before.txt after.txt   # optional
//
// Requires tmux on PATH. The shellctl helper binaries are built automatically
// into a temp dir the first time a benchmark runs.
package benchmarks

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"

	"github.com/langgenius/dify/dify-agent-runtime/internal/server"
)

const modulePath = "github.com/langgenius/dify/dify-agent-runtime"

var (
	buildOnce sync.Once
	buildErr  error
	binDir    string
)

// ensureBinaries builds the shellctl helper binaries the server shells out to
// (runner, sanitize-pty, runner-exit) once per test process and prepends their
// directory to PATH so both installRunner's LookPath and the tmux-invoked
// sanitize/runner-exit commands resolve.
func ensureBinaries(tb testing.TB) {
	tb.Helper()
	buildOnce.Do(func() {
		// Silence the server's request/lifecycle logging so it neither skews
		// timings with I/O nor interleaves with benchmark output.
		log.SetOutput(io.Discard)
		if _, err := exec.LookPath("tmux"); err != nil {
			buildErr = fmt.Errorf("tmux not found in PATH")
			return
		}
		dir, err := os.MkdirTemp("/tmp", "agbench-bin")
		if err != nil {
			buildErr = err
			return
		}
		binDir = dir
		targets := map[string]string{
			"shellctl-runner":       modulePath + "/cmd/runner",
			"shellctl-sanitize-pty": modulePath + "/cmd/sanitize-pty",
			"shellctl-runner-exit":  modulePath + "/cmd/runner-exit",
		}
		for name, pkg := range targets {
			out := filepath.Join(dir, name)
			cmd := exec.Command("go", "build", "-o", out, pkg)
			if b, err := cmd.CombinedOutput(); err != nil {
				buildErr = fmt.Errorf("build %s: %v: %s", name, err, b)
				return
			}
		}
		_ = os.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	})
	if buildErr != nil {
		tb.Skipf("cannot build shellctl binaries: %v", buildErr)
	}
}

// startServer boots a fresh in-process shellctl server with background GC and
// the pipe monitor running (matching production wiring). Returns the base URL,
// auth token, and a cleanup func.
func startServer(tb testing.TB) (string, string, func()) {
	tb.Helper()
	ensureBinaries(tb)

	stateDir, err := os.MkdirTemp("/tmp", "agbench-state")
	if err != nil {
		tb.Fatalf("mkdtemp state: %v", err)
	}
	cwd, err := os.MkdirTemp("/tmp", "agbench-cwd")
	if err != nil {
		tb.Fatalf("mkdtemp cwd: %v", err)
	}

	cfg, err := server.DefaultConfig()
	if err != nil {
		tb.Fatalf("default config: %v", err)
	}
	cfg.StateDir = stateDir
	cfg.RuntimeDir = filepath.Join(stateDir, "runtime")
	cfg.DefaultCwd = cwd
	cfg.AuthToken = "bench-token"

	svc := server.NewService(cfg)
	if err := svc.Initialize(); err != nil {
		tb.Fatalf("service initialize: %v", err)
	}
	svc.StartBackgroundGC()
	svc.StartBackgroundPipeMonitor()

	ts := httptest.NewServer(server.Handler(svc, cfg))

	cleanup := func() {
		ts.Close()
		svc.Shutdown()
		// Kill the dedicated tmux server so background sleep jobs don't leak.
		kill := exec.Command("tmux", "-S", cfg.TmuxSocket(), "kill-server")
		_ = kill.Run()
		_ = os.RemoveAll(stateDir)
		_ = os.RemoveAll(cwd)
	}
	return ts.URL, cfg.AuthToken, cleanup
}

func runJob(tb testing.TB, client *http.Client, baseURL, token, script string, timeout float64) {
	tb.Helper()
	payload, _ := json.Marshal(map[string]any{"script": script, "timeout": timeout})
	req, _ := http.NewRequest("POST", baseURL+"/v1/jobs/run", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		tb.Fatalf("run job: %v", err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		tb.Fatalf("run job status = %d", resp.StatusCode)
	}
}

// BenchmarkE2E_RunEcho measures full request latency for a trivial job that
// creates, starts, runs, and completes: the RunJob write path (3 SQLite
// commits) plus the WaitJob poll loop's per-poll runtime-state tmux calls.
func BenchmarkE2E_RunEcho(b *testing.B) {
	baseURL, token, cleanup := startServer(b)
	defer cleanup()
	client := &http.Client{}

	// Prime tmux/server lazy init.
	runJob(b, client, baseURL, token, "echo warmup", 5)

	b.ResetTimer()
	for b.Loop() {
		runJob(b, client, baseURL, token, "echo hi", 5)
	}
}

// BenchmarkE2E_RunEchoParallel drives many concurrent run requests. This is
// where the optimizations bite: the single-writer SQLite connection serializes
// commits (so per-commit fsync cost is on the critical path) and concurrent
// tmux fork/exec competes for CPU, so halving forks + dropping fsync raises
// sustained throughput even though single-request latency is gated by fixed
// poll/handshake waits.
func BenchmarkE2E_RunEchoParallel(b *testing.B) {
	baseURL, token, cleanup := startServer(b)
	defer cleanup()

	runJob(b, &http.Client{}, baseURL, token, "echo warmup", 5)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		client := &http.Client{}
		for pb.Next() {
			runJob(b, client, baseURL, token, "echo hi", 5)
		}
	})
}

// BenchmarkE2E_RunEchoUnderMonitorLoad keeps N long-running jobs alive so the
// 1s background pipe monitor reconciles them every tick (2N tmux forks before,
// 1 after), then measures echo-job latency under that contention on the shared
// single-writer SQLite connection and CPU.
func BenchmarkE2E_RunEchoUnderMonitorLoad(b *testing.B) {
	for _, n := range []int{8, 32} {
		b.Run(fmt.Sprintf("running=%d", n), func(b *testing.B) {
			baseURL, token, cleanup := startServer(b)
			defer cleanup()
			client := &http.Client{}

			// Seed N background jobs: sleep long, but return the run call
			// quickly via a short wait timeout so the job stays running.
			for i := 0; i < n; i++ {
				runJob(b, client, baseURL, token, "sleep 600", 0.3)
			}

			b.ResetTimer()
			for b.Loop() {
				runJob(b, client, baseURL, token, "echo hi", 5)
			}
		})
	}
}

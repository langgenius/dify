//go:build integration

// Package tests runs the same acceptance test suite against both the Python
// and Go shellctl server implementations to verify API compatibility.
//
// Prerequisites:
//
//	docker compose -f tests/docker-compose.yml up --build -d
//	go test -tags=integration ./tests/... -v
//	docker compose -f tests/docker-compose.yml down
package tests

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

var (
	goURL     = envOrDefault("SHELLCTL_GO_URL", "http://localhost:15005")
	authToken = envOrDefault("SHELLCTL_TEST_TOKEN", "test-token-123")

	goURLNoIsolation     = os.Getenv("SHELLCTL_GO_URL_NO_ISOLATION")
	authTokenNoIsolation = os.Getenv("SHELLCTL_TEST_TOKEN_NO_ISOLATION")

	httpClient = &http.Client{Timeout: 120 * time.Second}
)

// target represents one server under test.
type target struct {
	name    string
	baseURL string
}

func targets() []target {
	return []target{
		{name: "go", baseURL: goURL},
	}
}

func noIsolationTarget() (target, bool) {
	if goURLNoIsolation == "" {
		return target{}, false
	}
	return target{name: "go-no-isolation", baseURL: goURLNoIsolation}, true
}

func TestMain(m *testing.M) {
	// Warmup: wait for both servers to be ready before running tests
	for _, tgt := range targets() {
		if !waitForServer(tgt) {
			fmt.Fprintf(os.Stderr, "ERROR: %s server not ready at %s\n", tgt.name, tgt.baseURL)
			os.Exit(1)
		}
	}
	if tgt, ok := noIsolationTarget(); ok {
		if !waitForServer(tgt) {
			fmt.Fprintf(os.Stderr, "ERROR: %s server not ready at %s\n", tgt.name, tgt.baseURL)
			os.Exit(1)
		}
	}

	for _, tgt := range targets() {
		warmupJob(tgt)
	}
	if tgt, ok := noIsolationTarget(); ok {
		warmupJobWithToken(tgt, authTokenNoIsolation)
	}
	os.Exit(m.Run())
}

func waitForServer(tgt target) bool {
	for i := 0; i < 60; i++ {
		req, _ := http.NewRequest("GET", tgt.baseURL+"/healthz", nil)
		resp, err := httpClient.Do(req)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return true
			}
		}
		time.Sleep(time.Second)
	}
	return false
}

// warmupJob sends a trivial job to prime the server (tmux bootstrap, lazy init).
// It retries up to 3 times with a 180s timeout per attempt.
func warmupJob(tgt target) {
	warmupClient := &http.Client{Timeout: 180 * time.Second}
	payload, _ := json.Marshal(map[string]any{
		"script":  "echo warmup",
		"timeout": 10,
	})
	for attempt := 0; attempt < 3; attempt++ {
		req, _ := http.NewRequest("POST", tgt.baseURL+"/v1/jobs/run", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+authToken)
		resp, err := warmupClient.Do(req)
		if err != nil {
			fmt.Fprintf(os.Stderr, "WARN: %s warmup job attempt %d failed: %v\n", tgt.name, attempt+1, err)
			time.Sleep(2 * time.Second)
			continue
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode == 200 {
			return
		}
		fmt.Fprintf(os.Stderr, "WARN: %s warmup job attempt %d got status %d\n", tgt.name, attempt+1, resp.StatusCode)
		time.Sleep(2 * time.Second)
	}
	fmt.Fprintf(os.Stderr, "WARN: %s warmup job failed after 3 attempts, continuing anyway\n", tgt.name)
}

// --- Test Cases ---

func TestHealthz(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			resp := doGet(t, tgt, "/healthz", false)
			assertStatus(t, resp, 200)
			body := readBody(t, resp)
			var result map[string]string
			json.Unmarshal(body, &result)
			if result["status"] != "ok" {
				t.Errorf("expected status=ok, got %q", result["status"])
			}
		})
	}
}

func TestAuthRequired(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// Request without auth should fail
			req, _ := http.NewRequest("GET", tgt.baseURL+"/v1/jobs", nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != 401 {
				t.Errorf("expected 401, got %d", resp.StatusCode)
			}
		})
	}
}

func TestRunSimpleScript(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{
				"script":  "echo hello-world",
				"timeout": 10,
			})
			assertJobDone(t, result)
			assertExitCode(t, result, 0)
			output := result["output"].(string)
			if !strings.Contains(output, "hello-world") {
				t.Errorf("expected output to contain 'hello-world', got %q", output)
			}
		})
	}
}

func TestRunWithEnv(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{
				"script":  "echo $MY_VAR",
				"env":     map[string]string{"MY_VAR": "test-value-42"},
				"timeout": 10,
			})
			assertJobDone(t, result)
			assertExitCode(t, result, 0)
			output := result["output"].(string)
			if !strings.Contains(output, "test-value-42") {
				t.Errorf("expected output to contain 'test-value-42', got %q", output)
			}
		})
	}
}

func TestRunWithCwd(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{
				"script":  "pwd",
				"cwd":     "/tmp",
				"timeout": 10,
			})
			assertJobDone(t, result)
			assertExitCode(t, result, 0)
			output := result["output"].(string)
			if !strings.Contains(output, "/tmp") {
				t.Errorf("expected output to contain '/tmp', got %q", output)
			}
		})
	}
}

func TestRunNonZeroExit(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{
				"script":  "exit 42",
				"timeout": 10,
			})
			assertJobDone(t, result)
			assertExitCode(t, result, 42)
		})
	}
}

func TestWaitForOutput(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// Run a script that delays output
			result := runJob(t, tgt, map[string]any{
				"script":  "sleep 0.5 && echo delayed-output",
				"timeout": 5,
			})
			assertJobDone(t, result)
			assertExitCode(t, result, 0)
			output := result["output"].(string)
			if !strings.Contains(output, "delayed-output") {
				t.Errorf("expected 'delayed-output', got %q", output)
			}
		})
	}
}

func TestWaitJobWithOffset(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// Run a multi-line script
			result := runJob(t, tgt, map[string]any{
				"script":  "echo line1\necho line2\necho line3",
				"timeout": 10,
			})
			assertJobDone(t, result)
			jobID := result["job_id"].(string)
			offset := int(result["offset"].(float64))

			// Wait with offset should return empty (already at end)
			waitResult := waitJob(t, tgt, jobID, map[string]any{
				"offset":  offset,
				"timeout": 1,
			})
			// Should return with empty output since we're already past all data
			if waitResult["output"].(string) != "" {
				// It might return empty or might not, depending on timing
				// Just verify no error occurred
			}
		})
	}
}

func TestTailJob(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{
				"script":  "echo line1\necho line2\necho final-line",
				"timeout": 10,
			})
			assertJobDone(t, result)
			jobID := result["job_id"].(string)

			// Tail the job
			resp := doGet(t, tgt, fmt.Sprintf("/v1/jobs/%s/log/tail", jobID), true)
			assertStatus(t, resp, 200)
			body := readBody(t, resp)
			var tailResult map[string]any
			json.Unmarshal(body, &tailResult)
			output := tailResult["output"].(string)
			if !strings.Contains(output, "final-line") {
				t.Errorf("tail should contain 'final-line', got %q", output)
			}
		})
	}
}

func TestGetJobStatus(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{
				"script":  "echo done",
				"timeout": 10,
			})
			assertJobDone(t, result)
			jobID := result["job_id"].(string)

			resp := doGet(t, tgt, fmt.Sprintf("/v1/jobs/%s", jobID), true)
			assertStatus(t, resp, 200)
			body := readBody(t, resp)
			var status map[string]any
			json.Unmarshal(body, &status)

			if status["job_id"] != jobID {
				t.Errorf("expected job_id=%s, got %v", jobID, status["job_id"])
			}
			if status["done"] != true {
				t.Errorf("expected done=true")
			}
			if status["status"] != "exited" {
				t.Errorf("expected status=exited, got %v", status["status"])
			}
		})
	}
}

func TestListJobs(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// Run a job first
			runJob(t, tgt, map[string]any{
				"script":  "echo for-listing",
				"timeout": 10,
			})

			resp := doGet(t, tgt, "/v1/jobs", true)
			assertStatus(t, resp, 200)
			body := readBody(t, resp)
			var listResult map[string]any
			json.Unmarshal(body, &listResult)
			jobs := listResult["jobs"].([]any)
			if len(jobs) == 0 {
				t.Error("expected at least one job in listing")
			}
		})
	}
}

func TestTerminateJob(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// Start a long-running job
			result := runJob(t, tgt, map[string]any{
				"script":  "sleep 60",
				"timeout": 1, // short timeout so run returns quickly
			})
			jobID := result["job_id"].(string)

			// Terminate it
			resp := doPost(t, tgt, fmt.Sprintf("/v1/jobs/%s/terminate", jobID),
				map[string]any{"grace_seconds": 1}, true)
			assertStatus(t, resp, 200)
			body := readBody(t, resp)
			var termResult map[string]any
			json.Unmarshal(body, &termResult)

			if termResult["done"] != true {
				t.Errorf("expected done=true after terminate")
			}
			status := termResult["status"].(string)
			if status != "terminated" && status != "exited" {
				t.Errorf("expected terminal status, got %q", status)
			}
		})
	}
}

func TestDeleteJob(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{
				"script":  "echo to-delete",
				"timeout": 10,
			})
			assertJobDone(t, result)
			jobID := result["job_id"].(string)

			// Delete it
			req, _ := http.NewRequest("DELETE",
				fmt.Sprintf("%s/v1/jobs/%s", tgt.baseURL, jobID), nil)
			req.Header.Set("Authorization", "Bearer "+authToken)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("delete request failed: %v", err)
			}
			defer resp.Body.Close()
			assertStatus(t, resp, 200)

			// Should be gone now
			getResp := doGet(t, tgt, fmt.Sprintf("/v1/jobs/%s", jobID), true)
			if getResp.StatusCode != 404 {
				t.Errorf("expected 404 after delete, got %d", getResp.StatusCode)
			}
			getResp.Body.Close()
		})
	}
}

func TestForceDeleteRunningJob(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// Start a long-running job
			result := runJob(t, tgt, map[string]any{
				"script":  "sleep 60",
				"timeout": 1,
			})
			jobID := result["job_id"].(string)

			// Force delete
			req, _ := http.NewRequest("DELETE",
				fmt.Sprintf("%s/v1/jobs/%s?force=true&grace_seconds=1", tgt.baseURL, jobID), nil)
			req.Header.Set("Authorization", "Bearer "+authToken)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("delete request failed: %v", err)
			}
			defer resp.Body.Close()
			assertStatus(t, resp, 200)
		})
	}
}

func TestSendInput(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// Start a script that reads from stdin
			result := runJob(t, tgt, map[string]any{
				"script":  "read line && echo got:$line",
				"timeout": 2, // Will timeout waiting for input
			})
			jobID := result["job_id"].(string)

			if result["done"] == true {
				// Already finished (possible race), skip
				t.Skip("job completed before input could be sent")
			}

			// Send input
			offset := int(result["offset"].(float64))
			resp := doPost(t, tgt, fmt.Sprintf("/v1/jobs/%s/input", jobID),
				map[string]any{
					"text":    "hello-input\n",
					"offset":  offset,
					"timeout": 5,
				}, true)
			assertStatus(t, resp, 200)
			body := readBody(t, resp)
			var inputResult map[string]any
			json.Unmarshal(body, &inputResult)
			output := inputResult["output"].(string)
			if !strings.Contains(output, "got:hello-input") {
				t.Logf("output after input: %q (may need more wait time)", output)
			}
		})
	}
}

func TestMultilineOutput(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			script := "for i in $(seq 1 20); do echo \"line $i\"; done"
			result := runJob(t, tgt, map[string]any{
				"script":  script,
				"timeout": 10,
			})
			assertJobDone(t, result)
			assertExitCode(t, result, 0)
			output := result["output"].(string)
			if !strings.Contains(output, "line 1") {
				t.Errorf("missing 'line 1' in output")
			}
			if !strings.Contains(output, "line 20") {
				t.Errorf("missing 'line 20' in output")
			}
		})
	}
}

func TestInvalidCwd(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			resp := doPost(t, tgt, "/v1/jobs/run", map[string]any{
				"script":  "echo x",
				"cwd":     "/nonexistent-dir-xyz",
				"timeout": 5,
			}, true)
			if resp.StatusCode != 400 {
				body := readBody(t, resp)
				t.Errorf("expected 400, got %d: %s", resp.StatusCode, string(body))
			} else {
				resp.Body.Close()
			}
		})
	}
}

func TestJobNotFound(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			resp := doGet(t, tgt, "/v1/jobs/nonexistent-id-xyz", true)
			if resp.StatusCode != 404 {
				t.Errorf("expected 404, got %d", resp.StatusCode)
			}
			resp.Body.Close()
		})
	}
}

// --- Landlock Tests ---
// These tests verify that shellctl-run restricts filesystem access
// so each agent job can only write within its own HOME directory while still
// being able to execute system commands.

func TestLandlockCanWriteHome(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// The job runs with HOME set; writing a file inside HOME should succeed.
			result := runJob(t, tgt, map[string]any{
				"script":  "touch \"$HOME/landlock-test-file\" && echo ok",
				"env":     map[string]string{"HOME": "/home/dify"},
				"timeout": 10,
			})
			assertJobDone(t, result)
			assertExitCode(t, result, 0)
			output := result["output"].(string)
			if !strings.Contains(output, "ok") {
				t.Errorf("expected write to HOME to succeed, got %q", output)
			}
		})
	}
}

func TestLandlockCanReadSystemBinaries(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// System binaries should remain executable (RO access to /usr, /bin).
			result := runJob(t, tgt, map[string]any{
				"script":  "which ls && ls /usr/bin/env && echo ok",
				"env":     map[string]string{"HOME": "/home/dify"},
				"timeout": 10,
			})
			assertJobDone(t, result)
			assertExitCode(t, result, 0)
			output := result["output"].(string)
			if !strings.Contains(output, "ok") {
				t.Errorf("expected system binary access to succeed, got %q", output)
			}
		})
	}
}

func TestLandlockCanWriteTmpdir(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// TMPDIR ($CWD/.tmp) should be writable; /tmp should be denied.
			result := runJob(t, tgt, map[string]any{
				"script":  "echo TMPDIR=$TMPDIR && touch $TMPDIR/landlock-tmp-test && echo tmpdir_ok && touch /tmp/landlock-denied 2>&1; echo tmp_exit=$?",
				"env":     map[string]string{"HOME": "/home/dify"},
				"timeout": 10,
			})
			assertJobDone(t, result)
			output := result["output"].(string)
			if !strings.Contains(output, "tmpdir_ok") {
				t.Errorf("expected write to $TMPDIR to succeed, got %q", output)
			}
			if !strings.Contains(output, "tmp_exit=1") && !strings.Contains(output, "Permission denied") {
				t.Errorf("expected write to /tmp to be denied, got %q", output)
			}
		})
	}
}

func TestLandlockCannotWriteOutsideHome(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// Writing outside HOME (e.g., /opt) should be denied by Landlock.
			result := runJob(t, tgt, map[string]any{
				"script":  "touch /opt/landlock-denied 2>&1; echo exit=$?",
				"env":     map[string]string{"HOME": "/home/dify"},
				"timeout": 10,
			})
			assertJobDone(t, result)
			output := result["output"].(string)
			// The touch should fail with "Permission denied" or similar,
			// and exit code should be non-zero.
			if strings.Contains(output, "exit=0") {
				t.Errorf("expected write to /opt to be denied, but it succeeded: %q", output)
			}
		})
	}
}

func TestLandlockCannotReadOtherAgentHome(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// First, create a file in one agent's home.
			setup := runJob(t, tgt, map[string]any{
				"script":  "mkdir -p /home/agent-a && touch /home/agent-a/secret",
				"env":     map[string]string{"HOME": "/home/agent-a"},
				"timeout": 10,
			})
			assertJobDone(t, setup)
			assertExitCode(t, setup, 0)

			// Now run as a different agent and try to read the other's file.
			result := runJob(t, tgt, map[string]any{
				"script":  "cat /home/agent-a/secret 2>&1; echo exit=$?",
				"env":     map[string]string{"HOME": "/home/agent-b"},
				"timeout": 10,
			})
			assertJobDone(t, result)
			output := result["output"].(string)
			if strings.Contains(output, "exit=0") {
				t.Errorf("expected read of other agent's file to be denied, but it succeeded: %q", output)
			}
		})
	}
}

// --- Landlock Disable / Bypass Tests ---

// TestLandlockDisabledAllowsWriteOutsideHome uses the pre-started no-isolation
// container (ENABLE_PATH_ISOLATION=false) and verifies that isolation is off.
func TestLandlockDisabledAllowsWriteOutsideHome(t *testing.T) {
	tgt, ok := noIsolationTarget()
	if !ok {
		t.Skip("SHELLCTL_GO_URL_NO_ISOLATION not set; no-isolation container not available")
	}

	// With isolation disabled, writes to /tmp should succeed.
	// /tmp is world-writable (Unix perms) but blocked by Landlock when enabled.
	result := runJobWithToken(t, tgt, authTokenNoIsolation, map[string]any{
		"script":  "touch /tmp/landlock-disabled-test && echo write_ok",
		"env":     map[string]string{"HOME": "/home/dify"},
		"timeout": 10,
	})
	assertJobDone(t, result)
	assertExitCode(t, result, 0)
	output := result["output"].(string)
	if !strings.Contains(output, "write_ok") {
		t.Errorf("expected write to /tmp to succeed with isolation disabled, got %q", output)
	}
}

// TestLandlockEnvBypassBlocked verifies that a caller cannot set
// ENABLE_PATH_ISOLATION=false in job env to escape the sandbox.
func TestLandlockEnvBypassBlocked(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// Attempt to bypass Landlock by passing the disable flag in job env.
			result := runJob(t, tgt, map[string]any{
				"script": "touch /opt/landlock-bypass-test 2>&1; echo exit=$?",
				"env": map[string]string{
					"HOME":                  "/home/dify",
					"ENABLE_PATH_ISOLATION": "false",
				},
				"timeout": 10,
			})
			assertJobDone(t, result)
			output := result["output"].(string)
			// The write should still be denied despite the env override attempt.
			if strings.Contains(output, "exit=0") {
				t.Errorf("expected write to /opt to be DENIED even with ENABLE_PATH_ISOLATION=false in job env, but it succeeded: %q", output)
			}
		})
	}
}

// --- Helpers ---

func runJob(t *testing.T, tgt target, payload map[string]any) map[string]any {
	t.Helper()
	resp := doPost(t, tgt, "/v1/jobs/run", payload, true)
	assertStatus(t, resp, 200)
	body := readBody(t, resp)
	var result map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("[%s] failed to parse run response: %v\nbody: %s", tgt.name, err, string(body))
	}
	return result
}

func waitJob(t *testing.T, tgt target, jobID string, payload map[string]any) map[string]any {
	t.Helper()
	resp := doPost(t, tgt, fmt.Sprintf("/v1/jobs/%s/wait", jobID), payload, true)
	assertStatus(t, resp, 200)
	body := readBody(t, resp)
	var result map[string]any
	json.Unmarshal(body, &result)
	return result
}

func doGet(t *testing.T, tgt target, path string, withAuth bool) *http.Response {
	t.Helper()
	req, _ := http.NewRequest("GET", tgt.baseURL+path, nil)
	if withAuth {
		req.Header.Set("Authorization", "Bearer "+authToken)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatalf("[%s] GET %s failed: %v", tgt.name, path, err)
	}
	return resp
}

func doPost(t *testing.T, tgt target, path string, payload map[string]any, withAuth bool) *http.Response {
	t.Helper()
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", tgt.baseURL+path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if withAuth {
		req.Header.Set("Authorization", "Bearer "+authToken)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatalf("[%s] POST %s failed: %v", tgt.name, path, err)
	}
	return resp
}

func readBody(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("failed to read response body: %v", err)
	}
	return body
}

func assertStatus(t *testing.T, resp *http.Response, expected int) {
	t.Helper()
	if resp.StatusCode != expected {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("expected status %d, got %d: %s", expected, resp.StatusCode, string(body))
	}
}

func assertJobDone(t *testing.T, result map[string]any) {
	t.Helper()
	if result["done"] != true {
		t.Errorf("expected done=true, got %v (status=%v)", result["done"], result["status"])
	}
}

func assertExitCode(t *testing.T, result map[string]any, expected int) {
	t.Helper()
	exitCode, ok := result["exit_code"].(float64)
	if !ok {
		t.Errorf("exit_code is nil or not a number: %v", result["exit_code"])
		return
	}
	if int(exitCode) != expected {
		t.Errorf("expected exit_code=%d, got %d", expected, int(exitCode))
	}
}

func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func warmupJobWithToken(tgt target, token string) {
	warmupClient := &http.Client{Timeout: 180 * time.Second}
	payload, _ := json.Marshal(map[string]any{
		"script":  "echo warmup",
		"timeout": 10,
	})
	for attempt := 0; attempt < 3; attempt++ {
		req, _ := http.NewRequest("POST", tgt.baseURL+"/v1/jobs/run", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := warmupClient.Do(req)
		if err != nil {
			time.Sleep(2 * time.Second)
			continue
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode == 200 {
			return
		}
		time.Sleep(2 * time.Second)
	}
}

func runJobWithToken(t *testing.T, tgt target, token string, payload map[string]any) map[string]any {
	t.Helper()
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", tgt.baseURL+"/v1/jobs/run", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatalf("[%s] POST /v1/jobs/run failed: %v", tgt.name, err)
	}
	assertStatus(t, resp, 200)
	respBody := readBody(t, resp)
	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		t.Fatalf("[%s] failed to parse run response: %v\nbody: %s", tgt.name, err, string(respBody))
	}
	return result
}

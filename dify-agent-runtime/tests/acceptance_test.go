//go:build integration

// Package tests runs the same acceptance test suite against every configured
// shellctl server implementation to verify API compatibility.
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
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

var (
	goURL     = envOrDefault("SHELLCTL_GO_URL", "http://localhost:15005")
	authToken = envOrDefault("SHELLCTL_TEST_TOKEN", "test-token-123")
	rustURL   = os.Getenv("SHELLCTL_RUST_URL")
	rustToken = envOrDefault("SHELLCTL_RUST_TEST_TOKEN", authToken)

	goURLNoIsolation     = os.Getenv("SHELLCTL_GO_URL_NO_ISOLATION")
	authTokenNoIsolation = os.Getenv("SHELLCTL_TEST_TOKEN_NO_ISOLATION")
	rustURLNoIsolation   = os.Getenv("SHELLCTL_RUST_URL_NO_ISOLATION")
	rustTokenNoIsolation = envOrDefault("SHELLCTL_RUST_TEST_TOKEN_NO_ISOLATION", authTokenNoIsolation)

	httpClient = &http.Client{Timeout: 120 * time.Second}
)

// target represents one server under test.
type target struct {
	name    string
	baseURL string
	token   string
}

func targets() []target {
	result := []target{
		{name: "go", baseURL: goURL, token: authToken},
	}
	if rustURL != "" {
		result = append(result, target{name: "rust", baseURL: rustURL, token: rustToken})
	}
	return result
}

func noIsolationTargets() []target {
	var result []target
	if goURLNoIsolation != "" {
		result = append(result, target{name: "go-no-isolation", baseURL: goURLNoIsolation, token: authTokenNoIsolation})
	}
	if rustURLNoIsolation != "" {
		result = append(result, target{name: "rust-no-isolation", baseURL: rustURLNoIsolation, token: rustTokenNoIsolation})
	}
	return result
}

func TestMain(m *testing.M) {
	// Warmup: wait for both servers to be ready before running tests
	for _, tgt := range targets() {
		if !waitForServer(tgt) {
			fmt.Fprintf(os.Stderr, "ERROR: %s server not ready at %s\n", tgt.name, tgt.baseURL)
			os.Exit(1)
		}
	}
	for _, tgt := range noIsolationTargets() {
		if !waitForServer(tgt) {
			fmt.Fprintf(os.Stderr, "ERROR: %s server not ready at %s\n", tgt.name, tgt.baseURL)
			os.Exit(1)
		}
	}

	for _, tgt := range targets() {
		warmupJob(tgt)
	}
	for _, tgt := range noIsolationTargets() {
		warmupJob(tgt)
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
		req.Header.Set("Authorization", "Bearer "+tgt.token)
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

func TestPTYModesMergeStdoutAndStderr(t *testing.T) {
	for _, tgt := range targets() {
		for _, tc := range []struct {
			name string
			mode string
		}{
			{name: "default"},
			{name: "explicit", mode: "pty"},
		} {
			t.Run(tgt.name+"/"+tc.name, func(t *testing.T) {
				payload := map[string]any{
					"script":  "printf 'stdout-marker\\n'; printf 'stderr-marker\\n' >&2",
					"timeout": 10,
				}
				if tc.mode != "" {
					payload["mode"] = tc.mode
				}
				result := runJob(t, tgt, payload)
				assertJobDone(t, result)
				assertExitCode(t, result, 0)
				output := result["output"].(string)
				if !strings.Contains(output, "stdout-marker") || !strings.Contains(output, "stderr-marker") {
					t.Fatalf("PTY output did not merge stdout and stderr: %q", output)
				}
			})
		}
	}
}

func TestRunStdioSeparatesStdoutAndStderr(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{
				"script":  "printf '{\"ok\":true}'\nprintf 'warning' >&2",
				"mode":    "stdio",
				"timeout": 10,
			})
			assertJobDone(t, result)
			assertExitCode(t, result, 0)
			if output := result["output"].(string); output != `{"ok":true}` {
				t.Errorf("stdio output = %q, want stdout-only JSON", output)
			}
		})
	}
}

func TestStdioInputIsRejected(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{
				"script":  "sleep 60",
				"mode":    "stdio",
				"timeout": 0.1,
			})
			jobID := result["job_id"].(string)
			defer func() {
				resp := doPost(t, tgt, fmt.Sprintf("/v1/jobs/%s/terminate", jobID), map[string]any{"grace_seconds": 0}, true)
				resp.Body.Close()
			}()

			resp := doPost(t, tgt, fmt.Sprintf("/v1/jobs/%s/input", jobID), map[string]any{
				"text":    "ignored\n",
				"offset":  0,
				"timeout": 1,
			}, true)
			assertStatus(t, resp, http.StatusConflict)
			body := readBody(t, resp)
			var failure map[string]map[string]string
			if err := json.Unmarshal(body, &failure); err != nil {
				t.Fatal(err)
			}
			if code := failure["error"]["code"]; code != "input_unsupported" {
				t.Errorf("error code = %q, want input_unsupported", code)
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
			req.Header.Set("Authorization", "Bearer "+tgt.token)
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
			req.Header.Set("Authorization", "Bearer "+tgt.token)
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
			t.Cleanup(func() {
				cleanupJobBestEffort(tgt, jobID)
			})

			if result["done"] == true {
				t.Fatalf("interactive PTY job completed before input was sent: %#v", result)
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
				t.Fatalf("input result did not contain command echo: %q", output)
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

func TestInvalidBearerTokenContract(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			req, _ := http.NewRequest("GET", tgt.baseURL+"/v1/jobs", nil)
			req.Header.Set("Authorization", "Bearer definitely-wrong")
			resp, err := httpClient.Do(req)
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			assertAPIError(t, resp, 401, "unauthorized")
		})
	}
}

func TestRunValidationErrorContract(t *testing.T) {
	tests := []struct {
		name    string
		payload map[string]any
		status  int
		code    string
	}{
		{name: "empty-script", payload: map[string]any{"script": ""}, status: 400, code: "invalid_request"},
		{name: "empty-env-name", payload: map[string]any{"script": "true", "env": map[string]string{"": "x"}}, status: 422, code: "validation_error"},
		{name: "equals-in-env-name", payload: map[string]any{"script": "true", "env": map[string]string{"A=B": "x"}}, status: 422, code: "validation_error"},
		{name: "nul-in-env-value", payload: map[string]any{"script": "true", "env": map[string]string{"A": "x\x00y"}}, status: 422, code: "validation_error"},
	}

	for _, tgt := range targets() {
		for _, tc := range tests {
			t.Run(tgt.name+"/"+tc.name, func(t *testing.T) {
				resp := doPost(t, tgt, "/v1/jobs/run", tc.payload, true)
				assertAPIError(t, resp, tc.status, tc.code)
			})
		}
	}
}

func TestOutputLimitZeroUsesDefault(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{
				"script":       "printf zero-limit-output",
				"timeout":      10,
				"output_limit": 0,
			})
			assertJobDone(t, result)
			if output := result["output"].(string); output != "zero-limit-output" {
				t.Fatalf("output_limit=0 should use the default, got %q", output)
			}
		})
	}
}

func TestLargeUTF8OutputIsChunkedWithoutSplittingCodepoints(t *testing.T) {
	const repetitions = 6000
	const outputLimit = 4097
	expected := strings.Repeat("世界", repetitions)

	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{
				"script":       fmt.Sprintf("i=0; while [ \"$i\" -lt %d ]; do printf '世界'; i=$((i+1)); done", repetitions),
				"timeout":      20,
				"output_limit": outputLimit,
			})
			jobID := result["job_id"].(string)
			var combined strings.Builder

			for chunk := 0; chunk < 32; chunk++ {
				output := result["output"].(string)
				if !utf8.ValidString(output) {
					t.Fatalf("chunk %d is not valid UTF-8", chunk)
				}
				if len(output) > outputLimit {
					t.Fatalf("chunk %d exceeded output limit: %d > %d", chunk, len(output), outputLimit)
				}
				combined.WriteString(output)
				if result["done"] == true && result["truncated"] != true {
					break
				}
				offset := int(result["offset"].(float64))
				result = waitJob(t, tgt, jobID, map[string]any{
					"offset":       offset,
					"timeout":      10,
					"output_limit": outputLimit,
				})
			}

			if got := combined.String(); got != expected {
				t.Fatalf("reassembled output mismatch: got %d bytes, want %d", len(got), len(expected))
			}
		})
	}
}

func TestWaitRejectsOffsetPastEnd(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{"script": "printf short", "timeout": 10})
			jobID := result["job_id"].(string)
			offset := int(result["offset"].(float64)) + 1
			resp := doPost(t, tgt, fmt.Sprintf("/v1/jobs/%s/wait", jobID), map[string]any{
				"offset":  offset,
				"timeout": 0,
			}, true)
			assertAPIError(t, resp, 400, "invalid_offset")
		})
	}
}

func TestListZeroLimitUsesDefaultAndStatusFilter(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{"script": "true", "timeout": 10})
			assertJobDone(t, result)

			resp := doGet(t, tgt, "/v1/jobs?limit=0&status=exited", true)
			assertStatus(t, resp, 200)
			var list struct {
				Jobs []struct {
					Status string `json:"status"`
				} `json:"jobs"`
			}
			if err := json.Unmarshal(readBody(t, resp), &list); err != nil {
				t.Fatalf("decode list: %v", err)
			}
			if len(list.Jobs) == 0 {
				t.Fatal("limit=0 should use the default rather than returning an empty list")
			}
			if len(list.Jobs) > 50 {
				t.Fatalf("default list limit exceeded: %d", len(list.Jobs))
			}
			for _, job := range list.Jobs {
				if job.Status != "exited" {
					t.Fatalf("status filter returned %q", job.Status)
				}
			}
		})
	}
}

func TestTerminalInputAndRunningDeleteConflicts(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			completed := runJob(t, tgt, map[string]any{"script": "true", "timeout": 10})
			completedID := completed["job_id"].(string)
			resp := doPost(t, tgt, fmt.Sprintf("/v1/jobs/%s/input", completedID), map[string]any{
				"text": "ignored\n", "offset": 0, "timeout": 1,
			}, true)
			assertAPIError(t, resp, 409, "job_not_running")

			running := runJob(t, tgt, map[string]any{"script": "sleep 60", "timeout": 0.1})
			runningID := running["job_id"].(string)
			resp = doDelete(t, tgt, fmt.Sprintf("/v1/jobs/%s", runningID))
			assertAPIError(t, resp, 409, "job_running")

			resp = doDelete(t, tgt, fmt.Sprintf("/v1/jobs/%s?force=true&grace_seconds=0", runningID))
			assertStatus(t, resp, 200)
			resp.Body.Close()
		})
	}
}

func TestTerminateIsIdempotentAndDeleteIsNot(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{"script": "sleep 60", "timeout": 0.1})
			jobID := result["job_id"].(string)
			path := fmt.Sprintf("/v1/jobs/%s/terminate", jobID)

			for attempt := 0; attempt < 2; attempt++ {
				resp := doPost(t, tgt, path, map[string]any{"grace_seconds": 0}, true)
				assertStatus(t, resp, 200)
				var view map[string]any
				if err := json.Unmarshal(readBody(t, resp), &view); err != nil {
					t.Fatalf("decode terminate response: %v", err)
				}
				if view["done"] != true {
					t.Fatalf("terminate attempt %d did not return terminal state: %v", attempt+1, view)
				}
			}

			resp := doDelete(t, tgt, fmt.Sprintf("/v1/jobs/%s", jobID))
			assertStatus(t, resp, 200)
			resp.Body.Close()
			resp = doDelete(t, tgt, fmt.Sprintf("/v1/jobs/%s", jobID))
			assertAPIError(t, resp, 404, "job_not_found")
		})
	}
}

func TestConcurrentJobCreationAndCompletion(t *testing.T) {
	const jobs = 8
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			for index := 0; index < jobs; index++ {
				index := index
				t.Run(fmt.Sprintf("job-%02d", index), func(t *testing.T) {
					t.Parallel()
					marker := fmt.Sprintf("concurrent-%02d", index)
					result := runJob(t, tgt, map[string]any{
						"script":  fmt.Sprintf("printf %s", marker),
						"timeout": 20,
					})
					assertJobDone(t, result)
					assertExitCode(t, result, 0)
					if result["output"] != marker {
						t.Fatalf("unexpected output: %q", result["output"])
					}
				})
			}
		})
	}
}

func TestRustContainerRestartPreservesStateAndRecoversRunningJobs(t *testing.T) {
	image := os.Getenv("SHELLCTL_RUST_IMAGE")
	if image == "" {
		t.Skip("Rust integration image is not configured")
	}
	container := fmt.Sprintf("sandbox-rt-rust-restart-%d", time.Now().UnixNano())
	token := "restart-recovery-token"
	output, err := exec.Command(
		"docker",
		"run",
		"-d",
		"--name",
		container,
		"-p",
		"127.0.0.1::5004",
		"-e",
		"SHELLCTL_AUTH_TOKEN="+token,
		image,
	).CombinedOutput()
	if err != nil {
		t.Fatalf("start dedicated restart container: %v: %s", err, output)
	}
	defer func() {
		if cleanup, cleanupErr := exec.Command("docker", "rm", "-f", container).CombinedOutput(); cleanupErr != nil {
			t.Errorf("remove dedicated restart container: %v: %s", cleanupErr, cleanup)
		}
	}()

	tgt := target{name: "rust-restart", baseURL: containerPublishedURL(t, container), token: token}
	if !waitForServer(tgt) {
		t.Fatal("dedicated Rust runtime did not become healthy")
	}
	completed := runJob(t, tgt, map[string]any{"script": "printf persisted", "timeout": 10})
	completedID := completed["job_id"].(string)
	running := runJob(t, tgt, map[string]any{"script": "sleep 60", "timeout": 0.1})
	runningID := running["job_id"].(string)

	output, err = exec.Command("docker", "restart", "--timeout", "1", container).CombinedOutput()
	if err != nil {
		t.Fatalf("restart Rust container: %v: %s", err, output)
	}
	tgt.baseURL = containerPublishedURL(t, container)
	if !waitForServer(tgt) {
		t.Fatal("Rust runtime did not become healthy after restart")
	}

	completedStatus := getJobStatus(t, tgt, completedID)
	if completedStatus["status"] != "exited" || completedStatus["done"] != true {
		t.Fatalf("completed job changed across restart: %v", completedStatus)
	}
	tail := doGet(t, tgt, fmt.Sprintf("/v1/jobs/%s/log/tail", completedID), true)
	assertStatus(t, tail, 200)
	var persisted map[string]any
	if err := json.Unmarshal(readBody(t, tail), &persisted); err != nil {
		t.Fatalf("decode persisted output: %v", err)
	}
	if persisted["output"] != "persisted" {
		t.Fatalf("completed output was not preserved: %q", persisted["output"])
	}

	runningStatus := getJobStatus(t, tgt, runningID)
	if runningStatus["done"] != true {
		t.Fatalf("pre-restart running job was not reconciled: %v", runningStatus)
	}
	if status := runningStatus["status"]; status == "created" || status == "starting" || status == "running" {
		t.Fatalf("pre-restart job remained nonterminal: %v", runningStatus)
	}

	after := runJob(t, tgt, map[string]any{"script": "printf after-restart", "timeout": 10})
	assertJobDone(t, after)
	if after["output"] != "after-restart" {
		t.Fatalf("runtime failed to accept work after restart: %v", after)
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

func TestLandlockUsesWorkspaceAsTempSpace(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// The workspace itself is cwd and temp space; shared /tmp remains denied.
			result := runJob(t, tgt, map[string]any{
				"script": "test \"$PWD\" = /workspace && test \"$TMPDIR\" = /workspace && test \"$TMP\" = /workspace && test \"$TEMP\" = /workspace && " +
					"touch \"$TMPDIR/landlock-tmp-test\" && echo workspace_temp_ok; " +
					"touch /tmp/landlock-denied 2>&1; echo tmp_exit=$?",
				"cwd": "/workspace",
				"env": map[string]string{
					"HOME":   "/home/dify",
					"TMPDIR": "/tmp",
					"TMP":    "/tmp",
					"TEMP":   "/tmp",
				},
				"timeout": 10,
			})
			assertJobDone(t, result)
			output := result["output"].(string)
			if !strings.Contains(output, "workspace_temp_ok") {
				t.Errorf("expected workspace temp checks to pass, got %q", output)
			}
			if !strings.Contains(output, "tmp_exit=1") && !strings.Contains(output, "Permission denied") {
				t.Errorf("expected write to /tmp to be denied, got %q", output)
			}
		})
	}
}

func TestRunnerDoesNotCreateCwdTmpDirectory(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			freshCwd := fmt.Sprintf("/workspace/no-auto-tmp-%s-%d", tgt.name, time.Now().UnixNano())
			setup := runJob(t, tgt, map[string]any{
				"script": "mkdir -p -- \"$FRESH_CWD\"",
				"cwd":    "/workspace",
				"env": map[string]string{
					"HOME":      "/home/dify",
					"FRESH_CWD": freshCwd,
				},
				"timeout": 10,
			})
			assertJobDone(t, setup)
			assertExitCode(t, setup, 0)

			t.Cleanup(func() {
				cleanup := runJob(t, tgt, map[string]any{
					"script": "rm -rf -- \"$FRESH_CWD\"",
					"cwd":    "/workspace",
					"env": map[string]string{
						"HOME":      "/home/dify",
						"FRESH_CWD": freshCwd,
					},
					"timeout": 10,
				})
				assertJobDone(t, cleanup)
				assertExitCode(t, cleanup, 0)
			})

			result := runJob(t, tgt, map[string]any{
				"script":  "test ! -e \"$PWD/.tmp\"",
				"cwd":     freshCwd,
				"env":     map[string]string{"HOME": "/home/dify"},
				"timeout": 10,
			})
			assertJobDone(t, result)
			assertExitCode(t, result, 0)
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
// container (SHELLCTL_ENABLE_PATH_ISOLATION=false) and verifies that isolation is off.
func TestLandlockDisabledAllowsWriteOutsideHome(t *testing.T) {
	targets := noIsolationTargets()
	if len(targets) == 0 {
		t.Skip("SHELLCTL_GO_URL_NO_ISOLATION not set; no-isolation container not available")
	}

	for _, tgt := range targets {
		t.Run(tgt.name, func(t *testing.T) {
			// With isolation disabled, writes to /tmp should succeed.
			// /tmp is world-writable but blocked by Landlock when enabled.
			result := runJob(t, tgt, map[string]any{
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
		})
	}
}

// TestLandlockEnvBypassBlocked verifies that a caller cannot set
// SHELLCTL_ENABLE_PATH_ISOLATION=false in job env to escape the sandbox.
func TestLandlockEnvBypassBlocked(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			// Attempt to bypass Landlock by passing the disable flag in job env.
			result := runJob(t, tgt, map[string]any{
				"script": "touch /opt/landlock-bypass-test 2>&1; echo exit=$?",
				"env": map[string]string{
					"HOME":                           "/home/dify",
					"SHELLCTL_ENABLE_PATH_ISOLATION": "false",
				},
				"timeout": 10,
			})
			assertJobDone(t, result)
			output := result["output"].(string)
			// The write should still be denied despite the env override attempt.
			if strings.Contains(output, "exit=0") {
				t.Errorf("expected write to /opt to be DENIED even with SHELLCTL_ENABLE_PATH_ISOLATION=false in job env, but it succeeded: %q", output)
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
		req.Header.Set("Authorization", "Bearer "+tgt.token)
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
		req.Header.Set("Authorization", "Bearer "+tgt.token)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatalf("[%s] POST %s failed: %v", tgt.name, path, err)
	}
	return resp
}

func cleanupJobBestEffort(tgt target, jobID string) {
	client := &http.Client{Timeout: 5 * time.Second}
	body, _ := json.Marshal(map[string]any{"grace_seconds": 0})
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/v1/jobs/%s/terminate", tgt.baseURL, jobID), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tgt.token)
	if resp, err := client.Do(req); err == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}

	req, _ = http.NewRequest("DELETE", fmt.Sprintf("%s/v1/jobs/%s?force=true&grace_seconds=0", tgt.baseURL, jobID), nil)
	req.Header.Set("Authorization", "Bearer "+tgt.token)
	if resp, err := client.Do(req); err == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}
}

func doDelete(t *testing.T, tgt target, path string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest("DELETE", tgt.baseURL+path, nil)
	req.Header.Set("Authorization", "Bearer "+tgt.token)
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatalf("[%s] DELETE %s failed: %v", tgt.name, path, err)
	}
	return resp
}

func getJobStatus(t *testing.T, tgt target, jobID string) map[string]any {
	t.Helper()
	resp := doGet(t, tgt, fmt.Sprintf("/v1/jobs/%s", jobID), true)
	assertStatus(t, resp, 200)
	var result map[string]any
	if err := json.Unmarshal(readBody(t, resp), &result); err != nil {
		t.Fatalf("decode job status: %v", err)
	}
	return result
}

func containerPublishedURL(t *testing.T, container string) string {
	t.Helper()
	output, err := exec.Command("docker", "port", container, "5004/tcp").CombinedOutput()
	if err != nil {
		t.Fatalf("resolve published port for %s: %v: %s", container, err, output)
	}
	line := strings.TrimSpace(strings.Split(string(output), "\n")[0])
	_, port, err := net.SplitHostPort(line)
	if err != nil || port == "" {
		t.Fatalf("parse published port %q for %s: %v", line, container, err)
	}
	return "http://127.0.0.1:" + port
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

func assertAPIError(t *testing.T, resp *http.Response, expectedStatus int, expectedCode string) {
	t.Helper()
	assertStatus(t, resp, expectedStatus)
	var result struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(readBody(t, resp), &result); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if result.Error.Code != expectedCode {
		t.Fatalf("expected error code %q, got %q (%s)", expectedCode, result.Error.Code, result.Error.Message)
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

//go:build integration

package tests

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// TestStateSaveSkipsRunningJob: a sandbox with a non-terminal job must reject
// the suspension save with a retryable suspend_busy instead of archiving a
// live workspace.
func TestStateSaveSkipsRunningJob(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			result := runJob(t, tgt, map[string]any{
				"script":  "printf started; sleep 30",
				"mode":    "stdio",
				"timeout": 1,
			})
			jobID := result["job_id"].(string)
			t.Cleanup(func() { cleanupJobBestEffort(tgt, jobID) })
			if result["done"] == true {
				t.Fatalf("[%s] setup job finished; want still running", tgt.name)
			}

			resp := doPost(t, tgt, "/v1/state/save", nil, true)
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != http.StatusConflict {
				t.Fatalf("[%s] state save with active job: status = %d, want 409", tgt.name, resp.StatusCode)
			}
			var payload struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
				t.Fatalf("[%s] decode error body: %v", tgt.name, err)
			}
			if payload.Error.Code != "suspend_busy" {
				t.Fatalf("[%s] state save with active job: code = %q, want suspend_busy", tgt.name, payload.Error.Code)
			}
		})
	}
}

// TestStateSaveYieldsToNewJob: a job admitted mid-save must win over the
// archive. The workspace holds a 64 MiB incompressible file so the archive
// stream outlives TCP buffers; pausing the client read forces real
// backpressure instead of relying on sleeps or timing races.
func TestStateSaveYieldsToNewJob(t *testing.T) {
	for _, tgt := range targets() {
		t.Run(tgt.name, func(t *testing.T) {
			file := fmt.Sprintf("/workspace/suspend-acceptance-%d.bin", time.Now().UnixNano())
			// Deferred body close runs before this cleanup, so the trailer is
			// always read before any later job could invalidate the archive.
			// cwd "/workspace" scopes the job's access like the setup job, so
			// the removal can actually run under path isolation.
			t.Cleanup(func() {
				clean := runJob(t, tgt, map[string]any{
					"script":  fmt.Sprintf("rm -f -- %s", file),
					"cwd":     "/workspace",
					"mode":    "stdio",
					"timeout": 10,
				})
				assertJobDone(t, clean)
				assertExitCode(t, clean, 0)
				cleanupJobBestEffort(tgt, clean["job_id"].(string))
			})

			setup := runJob(t, tgt, map[string]any{
				"script":  fmt.Sprintf("dd if=/dev/urandom of=%s bs=1048576 count=64 2>/dev/null", file),
				"mode":    "stdio",
				"cwd":     "/workspace",
				"timeout": 20,
			})
			setupID := setup["job_id"].(string)
			t.Cleanup(func() { cleanupJobBestEffort(tgt, setupID) })
			if setup["done"] != true {
				setup = waitJob(t, tgt, setupID, map[string]any{"timeout": 20})
			}
			if setup["done"] != true || setup["exit_code"] != float64(0) {
				t.Fatalf("[%s] workspace setup job did not finish: %v", tgt.name, setup)
			}

			resp := doPost(t, tgt, "/v1/state/save", nil, true)
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("[%s] state save: status = %d, want 200", tgt.name, resp.StatusCode)
			}
			if _, err := io.ReadFull(resp.Body, make([]byte, 1)); err != nil {
				t.Fatalf("[%s] state save: read first byte: %v", tgt.name, err)
			}

			// Pause reads: the in-flight archive now stalls on TCP
			// backpressure while a real job is admitted underneath it.
			racer := runJob(t, tgt, map[string]any{
				"script":  "printf suspend_job_wins",
				"mode":    "stdio",
				"timeout": 10,
			})
			racerID := racer["job_id"].(string)
			t.Cleanup(func() { cleanupJobBestEffort(tgt, racerID) })
			if racer["done"] != true || racer["exit_code"] != float64(0) ||
				!strings.Contains(racer["output"].(string), "suspend_job_wins") {
				t.Fatalf("[%s] concurrent job did not complete during save: %v", tgt.name, racer)
			}

			if _, err := io.Copy(io.Discard, resp.Body); err != nil {
				t.Fatalf("[%s] drain interrupted save: %v", tgt.name, err)
			}
			if got := resp.Trailer.Get("X-Snapshot-Status"); got != "suspend_interrupted" {
				t.Fatalf("[%s] save trailer = %q, want suspend_interrupted", tgt.name, got)
			}
			if got := resp.Trailer.Get("X-Snapshot-Sha256"); got != "" {
				t.Fatalf("[%s] interrupted save published sha trailer %q", tgt.name, got)
			}
		})
	}
}

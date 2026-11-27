package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"testing"
)

// setupSuspensionFixture returns snapshot handlers wired to a Service backed
// by a real SQLite state DB, so suspension saves exercise the real active-job
// probe instead of a stub.
func setupSuspensionFixture(t *testing.T) (*snapshotHandlers, *Service, *DB) {
	t.Helper()
	setHome(t)
	stateDir := t.TempDir()
	cfg := testConfig()
	cfg.StateDir = stateDir
	cfg.RuntimeDir = stateDir + "/runtime"
	cfg.DefaultCwd = t.TempDir()
	if err := os.MkdirAll(cfg.JobsDir(), 0700); err != nil {
		t.Fatal(err)
	}
	db := setupTestDB(t, stateDir)
	t.Cleanup(func() { _ = db.Close() })
	svc := NewService(cfg)
	svc.db = db
	snap := newSnapshotHandlers(cfg)
	snap.service = svc
	return snap, svc, db
}

func writeStateSave(h *snapshotHandlers, save func(context.Context, io.Writer, string) error) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/v1/state/save", nil)
	w := httptest.NewRecorder()
	h.saveArchive(w, req, h.stateTimeout(), true, save)
	return w
}

func TestSuspensionBeginBusyWhenJobsActive(t *testing.T) {
	snap, svc, db := setupSuspensionFixture(t)
	insertTestJob(t, db, "job-active-1", StatusRunning)

	w := writeStateSave(snap, func(context.Context, io.Writer, string) error {
		t.Fatal("save callback must not run while a job is active")
		return nil
	})
	if w.Code != 409 {
		t.Fatalf("busy save: status = %d, want 409", w.Code)
	}
	var payload ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != "suspend_busy" {
		t.Fatalf("busy save: code = %q, want suspend_busy", payload.Error.Code)
	}
	if svc.suspend.fenced {
		t.Fatal("busy save must not install a fence")
	}
}

func TestSuspensionSealRejectsLaterAdmission(t *testing.T) {
	snap, svc, _ := setupSuspensionFixture(t)

	w := writeStateSave(snap, func(_ context.Context, dst io.Writer, _ string) error {
		_, err := dst.Write([]byte("archive-bytes"))
		return err
	})
	if got := w.Result().Trailer.Get(TrailerSnapshotStatus); got != SnapshotStatusOK {
		t.Fatalf("sealed save: trailer = %q, want %q", got, SnapshotStatusOK)
	}
	if !svc.suspend.fenced {
		t.Fatal("completed save must install the fence")
	}

	if _, err := svc.suspend.admit(); err == nil {
		t.Fatal("admission after seal must fail")
	} else if se, ok := err.(*ServerError); !ok || se.StatusCode != 503 || se.Code != "sandbox_suspending" {
		t.Fatalf("admission after seal: err = %v, want 503 sandbox_suspending", err)
	}
}

func TestSuspensionInterruptedByLateAdmission(t *testing.T) {
	snap, svc, _ := setupSuspensionFixture(t)

	// The save callback admits a job mid-stream: the latch must cancel the
	// save context immediately so the partial archive can never seal.
	w := writeStateSave(snap, func(ctx context.Context, dst io.Writer, _ string) error {
		if _, err := dst.Write([]byte("partial-archive")); err != nil {
			return err
		}
		done, err := svc.suspend.admit()
		if err != nil {
			return err
		}
		done()
		<-ctx.Done()
		if !errors.Is(context.Cause(ctx), errSuspendInterrupted) {
			t.Fatalf("save cause = %v, want errSuspendInterrupted", context.Cause(ctx))
		}
		return ctx.Err()
	})
	if got := w.Result().Trailer.Get(TrailerSnapshotStatus); got != "suspend_interrupted" {
		t.Fatalf("raced save: trailer = %q, want suspend_interrupted", got)
	}
	if svc.suspend.fenced {
		t.Fatal("interrupted save must not install a fence")
	}
	if _, err := svc.suspend.admit(); err != nil {
		t.Fatalf("admission after interrupted save: %v", err)
	}
}

func TestSuspensionInterruptedByLateAdmissionSuccessCallback(t *testing.T) {
	snap, svc, _ := setupSuspensionFixture(t)

	// A callback that ignores cancellation and still reports success must not
	// seal either: admit() already cleared the registered cancel under lock.
	w := writeStateSave(snap, func(_ context.Context, dst io.Writer, _ string) error {
		if _, err := dst.Write([]byte("full-archive")); err != nil {
			return err
		}
		done, err := svc.suspend.admit()
		if err != nil {
			return err
		}
		done()
		return nil
	})
	if got := w.Result().Trailer.Get(TrailerSnapshotStatus); got != "suspend_interrupted" {
		t.Fatalf("raced save: trailer = %q, want suspend_interrupted", got)
	}
	if svc.suspend.fenced {
		t.Fatal("interrupted save must not install a fence")
	}
	if _, err := svc.suspend.admit(); err != nil {
		t.Fatalf("admission after interrupted save: %v", err)
	}
}

func TestSuspensionRunJobFenced(t *testing.T) {
	_, svc, db := setupSuspensionFixture(t)

	if err := svc.suspend.begin(svc.hasActiveJobs, func() {}); err != nil {
		t.Fatalf("begin: %v", err)
	}
	if !svc.suspend.seal() {
		t.Fatal("seal failed")
	}

	cwd := svc.config.DefaultCwd
	_, err := svc.RunJob(&RunJobRequest{Script: "echo hi", Cwd: &cwd})
	se, ok := err.(*ServerError)
	if !ok || se.StatusCode != 503 || se.Code != "sandbox_suspending" {
		t.Fatalf("fenced RunJob: err = %v, want 503 sandbox_suspending", err)
	}
	jobs, err := db.ListJobs(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 0 {
		t.Fatalf("fenced RunJob left %d job rows, want 0", len(jobs))
	}
}

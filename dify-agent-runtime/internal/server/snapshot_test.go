package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/langgenius/dify/dify-agent-runtime/internal/snapshot"
)

func newSnapshotTestServer(t *testing.T, cfg *Config) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(Handler(nil, cfg)) // snapshot routes never touch the job Service
	t.Cleanup(srv.Close)
	return srv
}

func testConfig() *Config {
	return &Config{SnapshotTimeout: 600 * time.Second}
}

func setHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	return home
}

func TestSnapshotSaveSuccessWithTrailers(t *testing.T) {
	home := setHome(t)
	if err := os.WriteFile(filepath.Join(home, "data.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := newSnapshotTestServer(t, testConfig())

	resp, err := http.Post(srv.URL+"/v1/snapshot/save", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read stream: %v", err)
	}
	if resp.Trailer.Get(TrailerSnapshotStatus) != SnapshotStatusOK {
		t.Fatalf("status trailer = %q", resp.Trailer.Get(TrailerSnapshotStatus))
	}
	sum := sha256.Sum256(body)
	if got := resp.Trailer.Get(TrailerSnapshotSha256); got != hex.EncodeToString(sum[:]) {
		t.Fatalf("sha trailer = %q, want %q", got, hex.EncodeToString(sum[:]))
	}
	if got := resp.Trailer.Get(TrailerSnapshotBytes); got != strconv.FormatInt(int64(len(body)), 10) {
		t.Fatalf("bytes trailer = %q, want %d", got, len(body))
	}

	// The stream is a restorable archive.
	dst := t.TempDir()
	if _, err := snapshot.RestoreHome(context.Background(), bytes.NewReader(body), dst); err != nil {
		t.Fatalf("returned stream not restorable: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(dst, "data.txt"))
	if err != nil || string(got) != "hello" {
		t.Fatalf("restored content = %q err=%v", got, err)
	}
}

// An empty Home is not a special case: it produces an ordinary archive with no
// entries, so every caller stores and restores it through the same path.
func TestSnapshotSaveEmptyHome(t *testing.T) {
	setHome(t)
	srv := newSnapshotTestServer(t, testConfig())

	resp, err := http.Post(srv.URL+"/v1/snapshot/save", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 200 {
		t.Fatalf("empty home: status = %d, want 200", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read stream: %v", err)
	}
	if resp.Trailer.Get(TrailerSnapshotStatus) != SnapshotStatusOK {
		t.Fatalf("status trailer = %q", resp.Trailer.Get(TrailerSnapshotStatus))
	}
	if len(body) == 0 {
		t.Fatal("empty home produced no bytes; callers cannot distinguish it from a dropped stream")
	}

	dst := t.TempDir()
	res, err := snapshot.RestoreHome(context.Background(), bytes.NewReader(body), dst)
	if err != nil {
		t.Fatalf("empty-home archive not restorable: %v", err)
	}
	if res.Entries != 0 || res.BytesWritten != 0 {
		t.Fatalf("restored %+v, want zero entries and bytes", res)
	}
}

func TestSnapshotSaveAbortsOnMidStreamFailure(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: permission checks are bypassed")
	}
	home := setHome(t)
	if err := os.WriteFile(filepath.Join(home, "ok.txt"), bytes.Repeat([]byte("x"), 64*1024), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "zz-locked.txt"), []byte("secret"), 0o000); err != nil {
		t.Fatal(err)
	}
	srv := newSnapshotTestServer(t, testConfig())

	resp, err := http.Post(srv.URL+"/v1/snapshot/save", "", nil)
	if err != nil {
		return // aborted before headers: also a valid failure surface
	}
	defer func() { _ = resp.Body.Close() }()
	_, readErr := io.ReadAll(resp.Body)
	if readErr == nil && resp.Trailer.Get(TrailerSnapshotStatus) == SnapshotStatusOK {
		t.Fatal("mid-stream failure must never produce a clean ok stream")
	}
}

func TestSnapshotBusy(t *testing.T) {
	setHome(t)
	cfg := testConfig()
	snap := newSnapshotHandlers(cfg)
	if !snap.gate.TryLock() {
		t.Fatal("fresh gate must lock")
	}
	defer snap.gate.Unlock()

	req := httptest.NewRequest("POST", "/v1/snapshot/save", nil)
	w := httptest.NewRecorder()
	snap.handleSnapshotSave()(w, req)
	if w.Code != 409 {
		t.Fatalf("busy save: status = %d, want 409", w.Code)
	}
	var savePayload ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&savePayload); err != nil {
		t.Fatal(err)
	}
	if savePayload.Error.Code != "snapshot_busy" {
		t.Fatalf("busy save: error code = %q, want snapshot_busy", savePayload.Error.Code)
	}

	req = httptest.NewRequest("POST", "/v1/snapshot/restore", nil)
	w = httptest.NewRecorder()
	snap.handleSnapshotRestore()(w, req)
	if w.Code != 409 {
		t.Fatalf("busy restore: status = %d, want 409", w.Code)
	}
	var restorePayload ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&restorePayload); err != nil {
		t.Fatal(err)
	}
	if restorePayload.Error.Code != "snapshot_busy" {
		t.Fatalf("busy restore: error code = %q, want snapshot_busy", restorePayload.Error.Code)
	}
}

// TestSnapshotWireContract pins the literal wire strings remote clients parse.
// If this test fails, the gateway protocol changed — that is a breaking change,
// not a refactor.
func TestSnapshotWireContract(t *testing.T) {
	if TrailerSnapshotStatus != "X-Snapshot-Status" ||
		TrailerSnapshotSha256 != "X-Snapshot-Sha256" ||
		TrailerSnapshotBytes != "X-Snapshot-Bytes" ||
		SnapshotStatusOK != "ok" {
		t.Fatalf("snapshot trailer contract changed: %q %q %q %q",
			TrailerSnapshotStatus, TrailerSnapshotSha256, TrailerSnapshotBytes, SnapshotStatusOK)
	}
}

func TestSnapshotRestoreEndpoint(t *testing.T) {
	srcHome := t.TempDir()
	if err := os.WriteFile(filepath.Join(srcHome, "keep.txt"), []byte("v"), 0o644); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	if err := snapshot.SaveHome(context.Background(), &archive, srcHome, nil); err != nil {
		t.Fatal(err)
	}

	home := setHome(t)
	srv := newSnapshotTestServer(t, testConfig())
	resp, err := http.Post(srv.URL+"/v1/snapshot/restore", "application/octet-stream", &archive)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var result RestoreResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Entries == 0 {
		t.Error("entries not counted")
	}
	if got, err := os.ReadFile(filepath.Join(home, "keep.txt")); err != nil || string(got) != "v" {
		t.Fatalf("restored file = %q err=%v", got, err)
	}
}

func TestSnapshotRestoreMalformed(t *testing.T) {
	setHome(t)
	srv := newSnapshotTestServer(t, testConfig())
	resp, err := http.Post(srv.URL+"/v1/snapshot/restore", "application/octet-stream", bytes.NewReader([]byte("garbage")))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	var payload ErrorResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != "archive_malformed" {
		t.Fatalf("error code = %q", payload.Error.Code)
	}
}

func TestSnapshotSaveHomeUnavailable(t *testing.T) {
	t.Setenv("HOME", "") // os.UserHomeDir errors when $HOME is unset
	srv := newSnapshotTestServer(t, testConfig())

	resp, err := http.Post(srv.URL+"/v1/snapshot/save", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 500 {
		t.Fatalf("status = %d, want 500", resp.StatusCode)
	}
	var payload ErrorResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != "home_unavailable" {
		t.Fatalf("error code = %q, want home_unavailable", payload.Error.Code)
	}
}

func TestSnapshotRoutesRequireAuth(t *testing.T) {
	setHome(t)
	cfg := testConfig()
	cfg.AuthToken = "secret"
	srv := newSnapshotTestServer(t, cfg)

	resp, err := http.Post(srv.URL+"/v1/snapshot/save", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("unauthenticated save: status = %d, want 401", resp.StatusCode)
	}

	resp, err = http.Post(srv.URL+"/v1/snapshot/restore", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("unauthenticated restore: status = %d, want 401", resp.StatusCode)
	}
}

// TestSnapshotRestoreStalledPeerReleasesGate proves that a peer which stops
// sending body bytes mid-stream cannot wedge the single-flight gate forever:
// the read deadline set via http.ResponseController must fire and unblock
// the handler even though the server's ReadTimeout is 0.
func TestSnapshotRestoreStalledPeerReleasesGate(t *testing.T) {
	setHome(t)
	cfg := testConfig()
	cfg.SnapshotTimeout = 300 * time.Millisecond
	srv := newSnapshotTestServer(t, cfg)

	addr := srv.Listener.Addr().String()
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()

	// A syntactically valid request head announcing a chunked body, followed
	// by a partial chunk. The peer then goes silent without completing it.
	head := "POST /v1/snapshot/restore HTTP/1.1\r\n" +
		"Host: " + addr + "\r\n" +
		"Transfer-Encoding: chunked\r\n" +
		"Content-Type: application/octet-stream\r\n" +
		"\r\n" +
		"5\r\n" +
		"ab"
	if _, err := conn.Write([]byte(head)); err != nil {
		t.Fatal(err)
	}

	// Comfortably past SnapshotTimeout: the stalled request's read deadline
	// must have fired and released the gate by now.
	time.Sleep(2 * time.Second)

	resp, err := http.Post(srv.URL+"/v1/snapshot/restore", "application/octet-stream", bytes.NewReader([]byte("garbage")))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusConflict {
		t.Fatal("gate still held after stalled peer's read deadline should have expired")
	}
}

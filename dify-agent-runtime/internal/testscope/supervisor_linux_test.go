//go:build linux

package testscope

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func validSpec() NativeScopeSpec {
	return NativeScopeSpec{ScopeID: "scope-1", Generation: 1, BindingRef: "binding-1", BaseSnapshotRef: "snapshot-1", CapabilityDigest: strings.Repeat("a", 64), Deadline: time.Now().Add(time.Minute), Limits: Limits{CPUQuota: 100000, MemoryBytes: 256 << 20, PIDs: 64, FDs: 128, WallSeconds: 60, InputBytes: 1 << 20, OutputBytes: 1 << 20, DiskBytes: 32 << 20}}
}
func TestMissingNativeScopePrimitivesRejectStart(t *testing.T) {
	if err := ValidateHostCapabilities(HostCapabilities{}); err == nil {
		t.Fatal("accepted missing kernel isolation")
	}
}
func TestScopeSpecRejectsUnboundedAndMutablePaths(t *testing.T) {
	for _, change := range []func(*NativeScopeSpec){func(s *NativeScopeSpec) { s.Limits.PIDs = 0 }, func(s *NativeScopeSpec) { s.Limits.DiskBytes = 0 }, func(s *NativeScopeSpec) { s.BaseSnapshotRef = "../../etc" }, func(s *NativeScopeSpec) { s.ScopeID = "../other" }, func(s *NativeScopeSpec) { s.Generation = 0 }, func(s *NativeScopeSpec) { s.Deadline = time.Now().Add(-time.Second) }} {
		s := validSpec()
		change(&s)
		if s.Validate() == nil {
			t.Fatalf("accepted invalid spec: %+v", s)
		}
	}
}
func TestTrustedReferenceRejectsSymlinks(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "snapshot-1")); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveReference(root, "snapshot-1"); err == nil {
		t.Fatal("resolved symlink outside trusted root")
	}
	if _, err := ResolveReference(root, "../outside"); err == nil {
		t.Fatal("resolved traversal")
	}
}
func TestMissingScopeAuthenticationNeverReachesJobs(t *testing.T) {
	// Missing credentials must be rejected even when no runtime/store is installed.
	m := NewManager(Config{AuthToken: "private-control-token"}, nil)
	for _, path := range []string{"/v1/test-scopes", "/v1/test-scopes/scope-1/jobs/run"} {
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"script":"touch /must-not-run"}`))
		w := httptest.NewRecorder()
		m.Handler().ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s returned %d, want 401", path, w.Code)
		}
	}
}
func TestScopeAuthorizationBindsGenerationAndToken(t *testing.T) {
	s := Scope{Spec: validSpec(), TokenHash: HashToken("scope-secret"), Status: "ready"}
	for _, p := range []struct {
		gen   int64
		token string
	}{{0, "scope-secret"}, {2, "scope-secret"}, {1, ""}, {1, "other-scope-token"}} {
		if s.Authorize(p.gen, p.token) == nil {
			t.Fatal("accepted wrong generation or scope token")
		}
	}
	if err := s.Authorize(1, "scope-secret"); err != nil {
		t.Fatal(err)
	}
	s.Status = "unknown"
	if s.Authorize(1, "scope-secret") == nil {
		t.Fatal("accepted lost physical owner")
	}
}
func TestNativeJobCannotOverrideIsolationOrCwd(t *testing.T) {
	for _, env := range []map[string]string{{"SHELLCTL_ENABLE_PATH_ISOLATION": "false"}, {"HOME": "/control"}, {"LD_PRELOAD": "/payload.so"}, {"BASH_ENV": "/control/secret"}} {
		if ValidateJob("/workspace", env) == nil {
			t.Fatalf("accepted control override %v", env)
		}
	}
	if ValidateJob("/control", nil) == nil {
		t.Fatal("accepted control cwd")
	}
	if err := ValidateJob("/workspace", map[string]string{"EXAMPLE": "value"}); err != nil {
		t.Fatal(err)
	}
}

func lifecycleStore(t *testing.T) (*SQLStore, func()) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "scopes.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("CREATE TABLE jobs(job_id TEXT PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err = Migrate(tx); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return NewSQLStore(db), func() { _ = db.Close() }
}
func assertRetainedScopeAccessible(t *testing.T, m *Manager, store *SQLStore) {
	t.Helper()
	spec := validSpec()
	spec.ScopeID = "retained-owner"
	scope := Scope{Spec: spec, Status: "ready", PID: os.Getpid(), StartTime: processStart(os.Getpid())}
	if err := store.Insert(scope); err != nil {
		t.Fatal(err)
	}
	if err := store.SetPhysical(spec.ScopeID, "ready", scope.PID, scope.StartTime); err != nil {
		t.Fatal(err)
	}
	if err := m.Reconcile(); err != nil {
		t.Fatalf("one cleanup failure prevented supervisor startup: %v", err)
	}
	request := httptest.NewRequest("GET", "/v1/test-scopes/retained-owner", nil)
	request.Header.Set("Authorization", "Bearer fixture-token")
	request.Header.Set("X-Scope-Generation", "1")
	response := httptest.NewRecorder()
	m.Handler().ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("healthy retained scope unavailable: %d", response.Code)
	}
}
func TestFailedCreateBeforePhysicalStartDoesNotBlockRetainedOwner(t *testing.T) {
	store, closeStore := lifecycleStore(t)
	defer closeStore()
	dir := t.TempDir()
	m := NewManager(Config{AuthToken: "fixture-token", StateDir: dir, CgroupRoot: filepath.Join(dir, "absent-cgroups"), SnapshotRoot: filepath.Join(dir, "missing-snapshot-root")}, store)
	spec := validSpec()
	body, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/v1/test-scopes", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer fixture-token")
	response := httptest.NewRecorder()
	m.Handler().ServeHTTP(response, request)
	if response.Code != 503 {
		t.Fatalf("missing source status %d", response.Code)
	}
	scope, err := store.Get(spec.ScopeID)
	if err != nil {
		t.Fatal(err)
	}
	if scope.Status != "reserved" {
		t.Fatalf("lost durable no-start proof: %s", scope.Status)
	}
	assertRetainedScopeAccessible(t, m, store)
	scope, err = store.Get(spec.ScopeID)
	if err != nil || scope.Status != "destroyed" {
		t.Fatalf("never-started scope not finalized: %s %v", scope.Status, err)
	}
	if err = store.Insert(Scope{Spec: spec}); err == nil {
		t.Fatal("destroyed ID recreated")
	}
}
func TestUncertainMissingCgroupStaysQuarantinedWithoutBlockingRecovery(t *testing.T) {
	for _, status := range []string{"creating", "launching", "unknown", "quarantined"} {
		t.Run(status, func(t *testing.T) {
			store, closeStore := lifecycleStore(t)
			defer closeStore()
			spec := validSpec()
			if err := store.Insert(Scope{Spec: spec, Status: status}); err != nil {
				t.Fatal(err)
			}
			if err := store.SetPhysical(spec.ScopeID, status, 12345, "uncertain"); err != nil {
				t.Fatal(err)
			}
			dir := t.TempDir()
			m := NewManager(Config{AuthToken: "fixture-token", StateDir: dir, CgroupRoot: filepath.Join(dir, "absent-cgroups")}, store)
			assertRetainedScopeAccessible(t, m, store)
			scope, err := store.Get(spec.ScopeID)
			if err != nil || scope.Status != "quarantined" {
				t.Fatalf("missing path released uncertain capacity: %+v %v", scope, err)
			}
		})
	}
}
func TestDurableFenceMakesPostCgroupCleanupRetryIdempotent(t *testing.T) {
	store, closeStore := lifecycleStore(t)
	defer closeStore()
	spec := validSpec()
	if err := store.Insert(Scope{Spec: spec, Status: "fenced"}); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	state := filepath.Join(dir, "state")
	if err := os.WriteFile(state, []byte("blocks artifact removal"), 0600); err != nil {
		t.Fatal(err)
	}
	m := NewManager(Config{AuthToken: "fixture-token", StateDir: state, CgroupRoot: filepath.Join(dir, "already-removed-cgroups")}, store)
	scope, _ := store.Get(spec.ScopeID)
	if err := m.cleanup(scope); err == nil {
		t.Fatal("expected partial artifact cleanup failure")
	}
	scope, _ = store.Get(spec.ScopeID)
	if scope.Status != "fenced" {
		t.Fatalf("cleanup erased durable fence proof: %s", scope.Status)
	}
	if err := os.Remove(state); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(m.scopeDir(spec.ScopeID), 0700); err != nil {
		t.Fatal(err)
	}
	// A fresh manager recovers from the durable catalog; no physical owner is recreated.
	restarted := NewManager(m.config, store)
	assertRetainedScopeAccessible(t, restarted, store)
	scope, _ = store.Get(spec.ScopeID)
	if scope.Status != "destroyed" {
		t.Fatalf("fenced cleanup retry not completed: %s", scope.Status)
	}
	if _, err := os.Stat(restarted.scopeDir(spec.ScopeID)); !os.IsNotExist(err) {
		t.Fatalf("scope artifacts remain: %v", err)
	}
}

func TestCatalogReadFailureStillPreventsRecovery(t *testing.T) {
	store, closeStore := lifecycleStore(t)
	closeStore()
	if err := NewManager(Config{}, store).Reconcile(); err == nil {
		t.Fatal("catalog read failure incorrectly treated as isolated cleanup failure")
	}
}

type fenceAfterReadStore struct{ *SQLStore }

func (s fenceAfterReadStore) Get(id string) (Scope, error) {
	scope, err := s.SQLStore.Get(id)
	if err == nil {
		err = s.SetPhysical(id, "fenced", 0, "")
	}
	return scope, err
}
func TestStaleJobReadCannotEraseDurableCleanupFence(t *testing.T) {
	store, closeStore := lifecycleStore(t)
	defer closeStore()
	spec := validSpec()
	if err := store.Insert(Scope{Spec: spec, Status: "ready", TokenHash: HashToken("scope-token")}); err != nil {
		t.Fatal(err)
	}
	// Simulate DELETE persisting its fence immediately after jobs loaded the old row.
	m := NewManager(Config{AuthToken: "fixture-token"}, fenceAfterReadStore{store})
	request := httptest.NewRequest("GET", "/v1/test-scopes/"+spec.ScopeID+"/jobs", nil)
	request.Header.Set("Authorization", "Bearer fixture-token")
	request.Header.Set("X-Scope-Generation", "1")
	request.Header.Set("X-Scope-Token", "scope-token")
	response := httptest.NewRecorder()
	m.Handler().ServeHTTP(response, request)
	if response.Code != 409 {
		t.Fatal(response.Code)
	}
	scope, err := store.Get(spec.ScopeID)
	if err != nil || scope.Status != "fenced" {
		t.Fatalf("stale job read erased fence: %s %v", scope.Status, err)
	}
}

func TestScopedProxyRewritesAuthorityAfterHopHeaders(t *testing.T) {
	store, closeStore := lifecycleStore(t)
	defer closeStore()
	spec := validSpec()
	dir := t.TempDir()
	m := NewManager(Config{AuthToken: "fixture-token", StateDir: dir}, store)
	if err := store.Insert(Scope{Spec: spec, Status: "ready", TokenHash: HashToken("scope-token")}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetPhysical(spec.ScopeID, "ready", os.Getpid(), processStart(os.Getpid())); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(m.scopeDir(spec.ScopeID), 0700); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("unix", filepath.Join(m.scopeDir(spec.ScopeID), "control.sock"))
	if err != nil {
		t.Fatal(err)
	}
	worker := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/jobs/job-id/wait" || r.URL.RawPath != "" || r.URL.Query().Get("check") != "yes" {
			t.Errorf("wrong scoped route %s", r.URL.String())
		}
		if r.Header.Get("Authorization") != "Bearer "+m.token(spec) {
			t.Error("worker authority not re-established after hop removal")
		}
		if r.Header.Get("X-Scope-Token") != "" || r.Header.Get("X-Scope-Generation") != "" || r.Header.Get("Forwarded") != "" {
			t.Error("caller control metadata reached worker")
		}
		w.WriteHeader(http.StatusNoContent)
	})}
	go func() { _ = worker.Serve(listener) }()
	defer func() { _ = worker.Close() }()
	request := httptest.NewRequest("POST", "/v1/test-scopes/"+spec.ScopeID+"/jobs/job-id/wait?check=yes", strings.NewReader(`{"timeout":0}`))
	request.Header.Set("Authorization", "Bearer fixture-token")
	request.Header.Set("X-Scope-Generation", "1")
	request.Header.Set("X-Scope-Token", "scope-token")
	request.Header.Set("Connection", "Authorization")
	request.Header.Set("Forwarded", "for=untrusted")
	response := httptest.NewRecorder()
	m.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("proxy status %d", response.Code)
	}
}

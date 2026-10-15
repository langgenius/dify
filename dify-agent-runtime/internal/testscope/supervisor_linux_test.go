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
	"os/exec"
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

// Startup fixture tests substitute read-only systemd/proc/cgroup inputs in a
// temporary copy of the real script. They do not qualify real kernel placement.
func TestNativeSystemdStartupRequiresManagerPlacement(t *testing.T) {
	source, err := os.ReadFile("../../docker/native-test-start.sh")
	if err != nil {
		t.Fatal(err)
	}
	unit, err := os.ReadFile("../../docker/native-test-supervisor.service")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(unit), "\nDelegateSubgroup=manager\n") {
		t.Error("unit must place initial and restarted manager directly in its leaf")
	}
	for _, tc := range []struct {
		name, version, placement, want string
		allowed                        bool
	}{
		{"old-systemd", "249", "/system.slice/dify-native.service/manager", "requires systemd >= 254", false},
		{"unknown-version", "unknown", "/system.slice/dify-native.service/manager", "requires systemd >= 254", false},
		{"unit-root", "254", "/system.slice/dify-native.service", "requires DelegateSubgroup=manager placement", false},
		{"scope-leaf", "255", "/system.slice/dify-native.service/scopes/other", "requires DelegateSubgroup=manager placement", false},
		{"minimum-version", "254", "/system.slice/dify-native.service/manager", "", true},
		{"retained-worker-restart", "255", "/system.slice/dify-native.service/manager", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			cg := filepath.Join(dir, "cgroup")
			if err := os.MkdirAll(filepath.Join(cg, "manager"), 0700); err != nil {
				t.Fatal(err)
			}
			worker := filepath.Join(cg, "scopes", "retained", "cgroup.procs")
			if err := os.MkdirAll(filepath.Dir(worker), 0700); err != nil {
				t.Fatal(err)
			}
			write := func(path, content string) {
				t.Helper()
				if err := os.WriteFile(path, []byte(content), 0700); err != nil {
					t.Fatal(err)
				}
			}
			write(worker, "777\n")
			write(filepath.Join(cg, "manager", "cgroup.procs"), "222\n")
			write(filepath.Join(cg, "cgroup.subtree_control"), "untouched\n")
			proc := filepath.Join(dir, "proc-cgroup")
			write(proc, "0::"+tc.placement+"\n")
			systemctl := filepath.Join(dir, "systemctl")
			write(systemctl, "#!/bin/sh\nprintf 'systemd "+tc.version+" (fixture)\\n'\n")
			stat := filepath.Join(dir, "stat")
			write(stat, "#!/bin/sh\nprintf 'cgroup2fs\\n'\n")
			executable := filepath.Join(dir, "shellctl")
			started := filepath.Join(dir, "started")
			write(executable, "#!/bin/sh\nprintf started > '"+started+"'\n")
			script := string(source)
			script = strings.ReplaceAll(script, "root=/sys/fs/cgroup/system.slice/dify-native.service", "root="+cg)
			script = strings.ReplaceAll(script, "/proc/self/cgroup", proc)
			script = strings.ReplaceAll(script, "/usr/bin/systemctl", systemctl)
			script = strings.ReplaceAll(script, "stat -fc", stat+" -fc")
			script = strings.ReplaceAll(script, "/usr/local/bin/shellctl", executable)
			path := filepath.Join(dir, "start.sh")
			write(path, script)
			command := exec.Command("/bin/sh", path)
			output, err := command.CombinedOutput()
			if tc.allowed {
				if err != nil {
					t.Fatalf("supported manager failed: %v %s", err, output)
				}
				if _, err = os.Stat(started); err != nil {
					t.Fatal("supervisor was not started")
				}
				for file, want := range map[string]string{"cgroup.subtree_control": "+cpu +memory +pids\n", "scopes/cpu.max": "200000 100000\n", "scopes/memory.max": "2147483648\n", "scopes/memory.swap.max": "0\n", "scopes/pids.max": "512\n", "scopes/cgroup.subtree_control": "+cpu +memory +pids\n"} {
					got, err := os.ReadFile(filepath.Join(cg, file))
					if err != nil || string(got) != want {
						t.Fatalf("bound %s = %q, %v", file, got, err)
					}
				}
			} else {
				if err == nil || !strings.Contains(string(output), tc.want) {
					t.Fatalf("missing prerequisite was not specifically refused: %v %s", err, output)
				}
				if _, err = os.Stat(started); !os.IsNotExist(err) {
					t.Fatal("unsupported startup reached supervisor")
				}
				data, _ := os.ReadFile(filepath.Join(cg, "cgroup.subtree_control"))
				if string(data) != "untouched\n" {
					t.Fatal("unsupported startup mutated delegation")
				}
			}
			data, _ := os.ReadFile(worker)
			if string(data) != "777\n" {
				t.Fatal("startup moved or erased retained worker")
			}
			data, _ = os.ReadFile(filepath.Join(cg, "manager", "cgroup.procs"))
			if string(data) != "222\n" {
				t.Fatal("startup performed manual manager migration")
			}
		})
	}
}

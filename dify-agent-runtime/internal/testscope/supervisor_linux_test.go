//go:build linux

package testscope

import (
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

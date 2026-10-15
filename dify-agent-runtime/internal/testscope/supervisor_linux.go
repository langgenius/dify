//go:build linux

package testscope

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/sys/unix"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Config struct {
	AuthToken    string
	StateDir     string
	CgroupRoot   string
	SnapshotRoot string
	InputRoot    string
	Mediators    []string
}
type Manager struct {
	config  Config
	store   Store
	mu      sync.Mutex
	brokers map[string]*Broker
}

func NewManager(c Config, s Store) *Manager {
	return &Manager{config: c, store: s, brokers: map[string]*Broker{}}
}
func (m *Manager) token(spec NativeScopeSpec) string {
	b, _ := json.Marshal(spec)
	mac := hmac.New(sha256.New, []byte(m.config.AuthToken))
	_, _ = mac.Write(b)
	return hex.EncodeToString(mac.Sum(nil))
}
func (m *Manager) scopeDir(id string) string { return filepath.Join(m.config.StateDir, "scopes", id) }
func (m *Manager) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeScopeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /v1/test-scopes", m.create)
	mux.HandleFunc("GET /v1/test-scopes/{scope_id}", m.inspect)
	mux.HandleFunc("DELETE /v1/test-scopes/{scope_id}", m.destroy)
	mux.HandleFunc("/v1/test-scopes/{scope_id}/jobs", m.jobs)
	mux.HandleFunc("/v1/test-scopes/{scope_id}/jobs/{rest...}", m.jobs)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.config.AuthToken == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+m.config.AuthToken)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func writeScopeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func (m *Manager) create(w http.ResponseWriter, r *http.Request) {
	var spec NativeScopeSpec
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&spec); err != nil {
		http.Error(w, "invalid scope specification", http.StatusBadRequest)
		return
	}
	if err := spec.Validate(); err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.store == nil {
		http.Error(w, ErrUnavailable.Error(), http.StatusServiceUnavailable)
		return
	}
	scopes, err := m.store.List()
	if err != nil {
		http.Error(w, "scope catalog unavailable", http.StatusServiceUnavailable)
		return
	}
	active := 0
	for _, s := range scopes {
		if s.Status != "destroyed" {
			active++
		}
	}
	if active >= 32 {
		http.Error(w, "scope capacity exhausted", http.StatusServiceUnavailable)
		return
	}
	if _, err := m.store.Get(spec.ScopeID); err == nil {
		http.Error(w, "immutable scope already exists", http.StatusConflict)
		return
	}
	pinCtx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	pinned, err := PinNetwork(pinCtx, spec.NetworkTargets, m.config.Mediators)
	if err != nil {
		http.Error(w, "network targets unavailable", http.StatusUnprocessableEntity)
		return
	}
	scope := Scope{Network: pinned, Spec: spec, TokenHash: HashToken(m.token(spec)), Status: "reserved"}
	if err := m.store.Insert(scope); err != nil {
		http.Error(w, "scope identity unavailable", http.StatusConflict)
		return
	}
	if err := m.start(&scope); err != nil {
		log.Printf("native scope isolation setup refused: %v", err)
		// Preserve durable evidence that no physical launch was attempted.
		// A failed catalog write is ambiguous: read the authoritative state.
		if recorded, readErr := m.store.Get(spec.ScopeID); readErr == nil && recorded.Status != "reserved" && recorded.Status != "fenced" {
			_ = m.store.SetPhysical(spec.ScopeID, "quarantined", scope.PID, scope.StartTime)
		}
		http.Error(w, "native_scope_unavailable: isolation setup failed", http.StatusServiceUnavailable)
		return
	}
	writeScopeJSON(w, 201, map[string]any{"scope_id": spec.ScopeID, "generation": spec.Generation, "status": "ready", "token": m.token(spec)})
}
func (m *Manager) load(r *http.Request) (Scope, error) {
	id := r.PathValue("scope_id")
	if !safeID.MatchString(id) || m.store == nil {
		return Scope{}, ErrUnavailable
	}
	s, err := m.store.Get(id)
	if err != nil {
		return s, ErrUnavailable
	}
	gen, err := strconv.ParseInt(r.Header.Get("X-Scope-Generation"), 10, 64)
	if err != nil || gen != s.Spec.Generation {
		return s, ErrUnauthorized
	}
	return s, nil
}
func (m *Manager) physicalAlive(s Scope) bool {
	return s.PID > 0 && s.StartTime != "" && processStart(s.PID) == s.StartTime
}
func (m *Manager) inspect(w http.ResponseWriter, r *http.Request) {
	s, err := m.load(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if s.Status != "ready" || !m.physicalAlive(s) || time.Now().After(s.Spec.Deadline) {
		http.Error(w, ErrUnavailable.Error(), http.StatusConflict)
		return
	}
	writeScopeJSON(w, 200, map[string]any{"scope_id": s.Spec.ScopeID, "generation": s.Spec.Generation, "status": s.Status, "token": m.token(s.Spec)})
}
func (m *Manager) destroy(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, err := m.load(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if s.Status == "destroyed" {
		writeScopeJSON(w, 200, map[string]string{"status": "destroyed"})
		return
	}
	if err := m.cleanup(s); err != nil {
		http.Error(w, "scope cleanup quarantined", http.StatusServiceUnavailable)
		return
	}
	writeScopeJSON(w, 200, map[string]string{"status": "destroyed"})
}
func (m *Manager) cleanup(s Scope) error {
	if b := m.brokers[s.Spec.ScopeID]; b != nil {
		b.Close()
		delete(m.brokers, s.Spec.ScopeID)
	}
	path := filepath.Join(m.config.CgroupRoot, s.Spec.ScopeID)
	if s.Status != "fenced" {
		// Only the new reserved status proves cmd.Start was never attempted.
		// Legacy creating/quarantined/unknown + an absent path proves nothing.
		neverStarted := s.Status == "reserved" && s.PID == 0 && s.StartTime == ""
		if !neverStarted {
			if err := KillCgroup(path, 3*time.Second); err != nil {
				_ = m.store.SetPhysical(s.Spec.ScopeID, "quarantined", s.PID, s.StartTime)
				return err
			}
		}
		// Persist the fence BEFORE any path is removed. Retrying after cgroup,
		// artifact or final catalog failure must not lose this physical proof.
		if err := m.store.SetPhysical(s.Spec.ScopeID, "fenced", 0, ""); err != nil {
			return err
		}
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.RemoveAll(m.scopeDir(s.Spec.ScopeID)); err != nil {
		return err
	}
	return m.store.SetPhysical(s.Spec.ScopeID, "destroyed", 0, "")
}
func (m *Manager) jobs(w http.ResponseWriter, r *http.Request) {
	s, err := m.load(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	if err = s.Authorize(s.Spec.Generation, r.Header.Get("X-Scope-Token")); err != nil {
		code := 409
		if errors.Is(err, ErrUnauthorized) {
			code = 401
		}
		http.Error(w, err.Error(), code)
		return
	}
	if !m.physicalAlive(s) {
		// Read-only job admission must not overwrite a newer cleanup fence.
		// Reconcile owns physical-state transitions under the manager mutex.
		http.Error(w, ErrUnavailable.Error(), http.StatusConflict)
		return
	}
	if r.Method == http.MethodPost {
		body, err := io.ReadAll(io.LimitReader(r.Body, s.Spec.Limits.InputBytes+1))
		if err != nil || int64(len(body)) > s.Spec.Limits.InputBytes {
			http.Error(w, "input budget exceeded", http.StatusRequestEntityTooLarge)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/run") {
			if err = m.store.Spend(s.Spec.ScopeID, "jobs", 1); err != nil {
				http.Error(w, "scope lifetime job capacity exhausted", http.StatusTooManyRequests)
				return
			}
		}
		if strings.HasSuffix(r.URL.Path, "/run") || strings.HasSuffix(r.URL.Path, "/input") {
			if err = m.store.Spend(s.Spec.ScopeID, "input", int64(len(body))); err != nil {
				http.Error(w, "input budget exhausted", http.StatusRequestEntityTooLarge)
				return
			}
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
	}
	path := "/v1/jobs"
	if rest := r.PathValue("rest"); rest != "" {
		path += "/" + rest
	}
	socket := filepath.Join(m.scopeDir(s.Spec.ScopeID), "control.sock")
	proxy := &httputil.ReverseProxy{}
	proxy.Transport = &http.Transport{DisableKeepAlives: true, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		return (&net.Dialer{Timeout: time.Second}).DialContext(ctx, "unix", socket)
	}}
	proxy.Rewrite = func(request *httputil.ProxyRequest) {
		req := request.Out
		req.URL.Scheme = "http"
		req.URL.Host = "scope"
		req.URL.Path = path
		req.URL.RawPath = ""
		req.Header.Set("Authorization", "Bearer "+m.token(s.Spec))
		req.Header.Del("X-Scope-Token")
		req.Header.Del("X-Scope-Generation")
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, "native job outcome unknown", http.StatusBadGateway)
	}
	proxy.ServeHTTP(w, r)
}

// Reconcile never launches a replacement worker. A lost physical owner remains
// unavailable, and expired/partially created scopes must be killed or quarantined.
// A catalog read failure is global/fatal. Per-scope cleanup errors retain capacity
// and are retried without preventing unrelated retained owners from being served.
func (m *Manager) Reconcile() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	scopes, err := m.store.List()
	if err != nil {
		return err
	}
	for _, s := range scopes {
		if s.Status == "destroyed" {
			continue
		}
		if s.Status != "ready" || !m.physicalAlive(s) || time.Now().After(s.Spec.Deadline) {
			if err := m.cleanup(s); err != nil {
				log.Printf("native scope %s remains unavailable during reconciliation: %v", s.Spec.ScopeID, err)
			}
		} else if len(s.Spec.NetworkTargets) > 0 && m.brokers[s.Spec.ScopeID] == nil {
			if err := m.startBroker(s); err != nil {
				log.Printf("native scope %s remains unavailable during reconciliation: %v", s.Spec.ScopeID, err)
			}
		}
	}
	return nil
}
func processStart(pid int) string {
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return ""
	}
	end := strings.LastIndex(string(b), ") ")
	if end < 0 {
		return ""
	}
	f := strings.Fields(string(b)[end+2:])
	if len(f) < 20 {
		return ""
	}
	return f[19]
}

type WorkerConfig struct {
	Spec         NativeScopeSpec   `json:"spec"`
	ControlToken string            `json:"control_token"`
	Directory    string            `json:"directory"`
	Snapshot     string            `json:"snapshot"`
	Inputs       map[string]string `json:"inputs"`
}

func (m *Manager) start(s *Scope) error {
	// Kernel clone and every required mount are validated by the actual worker
	// before readiness; no client-provided capability boolean is consumed.

	snapshot, err := ResolveReference(m.config.SnapshotRoot, s.Spec.BaseSnapshotRef)
	if err != nil {
		return err
	}
	inputs := map[string]string{}
	for _, ref := range s.Spec.InputFileRefs {
		p, err := ResolveReference(m.config.InputRoot, ref)
		if err != nil {
			return err
		}
		inputs[ref] = p
	}
	cg, err := createCgroup(m.config.CgroupRoot, s.Spec.ScopeID, s.Spec.Limits)
	if err != nil {
		return err
	}
	success := false
	defer func() {
		if !success {
			_ = KillCgroup(cg, time.Second)
		}
	}()
	dir := m.scopeDir(s.Spec.ScopeID)
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	if len(s.Spec.NetworkTargets) > 0 {
		if err = m.startBroker(*s); err != nil {
			return err
		}
	}
	cfg := WorkerConfig{ControlToken: m.token(s.Spec), Spec: s.Spec, Directory: dir, Snapshot: snapshot, Inputs: inputs}
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	cfgPath := filepath.Join(dir, "worker.json")
	if err = os.WriteFile(cfgPath, data, 0600); err != nil {
		return err
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(dir, "control.sock"), Net: "unix"})
	if err != nil {
		return err
	}
	listener.SetUnlinkOnClose(false)
	defer func() { _ = listener.Close() }()
	lf, err := listener.File()
	if err != nil {
		return err
	}
	defer func() { _ = lf.Close() }()
	read, write, err := os.Pipe()
	if err != nil {
		return err
	}
	defer func() { _ = read.Close() }()
	defer func() { _ = write.Close() }()
	cgfd, err := os.Open(cg)
	if err != nil {
		return err
	}
	defer func() { _ = cgfd.Close() }()
	self, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(self, "native-worker", cfgPath)
	cmd.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/home/dify", "LANG=C.UTF-8"}
	cmd.ExtraFiles = []*os.File{lf, write}
	cmd.SysProcAttr = &syscall.SysProcAttr{Cloneflags: unix.CLONE_NEWUSER | unix.CLONE_NEWNS | unix.CLONE_NEWPID | unix.CLONE_NEWNET | unix.CLONE_NEWIPC | unix.CLONE_NEWUTS, UidMappings: []syscall.SysProcIDMap{{ContainerID: 0, HostID: os.Getuid(), Size: 1}}, GidMappings: []syscall.SysProcIDMap{{ContainerID: 0, HostID: os.Getgid(), Size: 1}}, GidMappingsEnableSetgroups: false, UseCgroupFD: true, CgroupFD: int(cgfd.Fd())}
	// This committed transition is an irreversible start gate. A crash after
	// it is uncertain even if no PID was recorded; only kernel fencing resolves it.
	if err = m.store.SetPhysical(s.Spec.ScopeID, "launching", 0, ""); err != nil {
		return err
	}
	s.Status = "launching"
	if err = startRetainedWorker(cmd); err != nil {
		return err
	}
	s.PID = cmd.Process.Pid
	s.StartTime = processStart(s.PID)
	if b := m.brokers[s.Spec.ScopeID]; b != nil {
		b.SetPeer(s.PID)
	}
	go func() { _ = cmd.Wait() }()
	_ = write.Close()
	if err = m.store.SetPhysical(s.Spec.ScopeID, "creating", s.PID, s.StartTime); err != nil {
		return err
	}
	_ = read.SetReadDeadline(time.Now().Add(10 * time.Second))
	ready, err := io.ReadAll(io.LimitReader(read, 1024))
	if err != nil || string(ready) != "ready" {
		return fmt.Errorf("worker isolation readiness failed: %s (%v)", string(ready), err)
	}
	if err = m.store.SetPhysical(s.Spec.ScopeID, "ready", s.PID, s.StartTime); err != nil {
		return err
	}
	s.Status = "ready"
	success = true
	return nil
}

func startRetainedWorker(cmd *exec.Cmd) error {
	// A nil stream connects directly to os.DevNull. io.Discard instead makes
	// os/exec create pipes drained by this manager; after a restart a worker
	// logging to those orphaned pipes can die from SIGPIPE, losing its namespace.
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Start()
}

func (m *Manager) startBroker(s Scope) error {
	socket := filepath.Join(m.scopeDir(s.Spec.ScopeID), "broker.sock")
	_ = os.Remove(socket)
	broker, err := StartBroker(socket, s.Network, s.Spec.Deadline, func(authority string, n int64) error { return m.store.Spend(s.Spec.ScopeID, "network:"+authority, n) })
	if err != nil {
		return err
	}
	broker.SetPeer(s.PID)
	m.brokers[s.Spec.ScopeID] = broker
	return nil
}

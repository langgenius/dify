//go:build integration && native_scope

package tests

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func nativeRequest(t *testing.T, method, path string, body any, token string, generation int) (int, map[string]any) {
	t.Helper()
	endpoint := os.Getenv("SHELLCTL_NATIVE_TEST_URL")
	if endpoint == "" {
		t.Fatal("SHELLCTL_NATIVE_TEST_URL is required; native isolation cannot be skipped")
	}
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(method, endpoint+path, bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("SHELLCTL_NATIVE_TEST_TOKEN"))
	req.Header.Set("X-Scope-Token", token)
	req.Header.Set("X-Scope-Generation", fmt.Sprint(generation))
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	var result map[string]any
	_ = json.Unmarshal(b, &result)
	if result == nil {
		result = map[string]any{"error": string(b)}
	}
	return resp.StatusCode, result
}
func nativeCreate(t *testing.T, id string, targets ...map[string]any) string {
	t.Helper()
	spec := map[string]any{"scope_id": id, "generation": 1, "binding_ref": "fixture-binding", "base_snapshot_ref": "fixture-home", "input_file_refs": []string{"fixture-input"}, "capability_digest": strings.Repeat("a", 64), "deadline": time.Now().Add(240 * time.Second), "limits": map[string]any{"cpu_quota": 100000, "memory_bytes": 512 << 20, "pids": 96, "fds": 128, "wall_seconds": 300, "input_bytes": 1 << 20, "output_bytes": 1 << 20, "disk_bytes": 32 << 20}, "network_targets": targets}
	code, response := nativeRequest(t, "POST", "/v1/test-scopes", spec, "", 0)
	if code != 201 {
		t.Fatalf("real native scope must start, got %d: %v", code, response)
	}
	token, _ := response["token"].(string)
	if token == "" {
		t.Fatal("missing scope token")
	}
	t.Cleanup(func() {
		code, r := nativeRequest(t, "DELETE", "/v1/test-scopes/"+id, nil, token, 1)
		if code != 200 {
			t.Errorf("tree cleanup failed: %d %v", code, r)
		}
	})
	return token
}
func nativeRun(t *testing.T, id, token, script string) map[string]any {
	t.Helper()
	code, r := nativeRequest(t, "POST", "/v1/test-scopes/"+id+"/jobs/run", map[string]any{"script": script, "timeout": 5}, token, 1)
	if code != 200 {
		t.Fatalf("run: %d %v", code, r)
	}
	return r
}
func TestNativeScopeRealFilesystemSecretNetworkAndStdin(t *testing.T) {
	a := fmt.Sprintf("scope-a-%d", time.Now().UnixNano())
	b := fmt.Sprintf("scope-b-%d", time.Now().UnixNano())
	ta := nativeCreate(t, a)
	tb := nativeCreate(t, b)
	first := nativeRun(t, a, ta, "printf private-a > /workspace/canary; printf home-a > /home/dify/canary; printf 'READY\\n'; read answer; printf 'ANSWER:%s\\n' \"$answer\"")
	job, ok := first["job_id"].(string)
	if !ok {
		t.Fatal(first)
	}
	denied := []struct {
		token      string
		generation int
	}{{"", 1}, {tb, 1}, {ta, 0}, {ta, 2}}
	for _, d := range denied {
		code, _ := nativeRequest(t, "POST", "/v1/test-scopes/"+a+"/jobs/run", map[string]any{"script": "touch /workspace/unauthorized"}, d.token, d.generation)
		if code != 401 && code != 409 {
			t.Fatalf("invalid scope authority submitted instructions: %d", code)
		}
		code, _ = nativeRequest(t, "POST", "/v1/test-scopes/"+a+"/jobs/"+job+"/input", map[string]any{"text": "must-not-enter\n"}, d.token, d.generation)
		if code != 401 && code != 409 {
			t.Fatalf("invalid scope credential accepted: %d", code)
		}
	}
	other := nativeRun(t, b, tb, "test ! -e /workspace/canary && test ! -e /home/dify/canary && test ! -e /control && test ! -e /run/shellctl && test -r /inputs/fixture-input && printf ISOLATED")
	if !strings.Contains(fmt.Sprint(other["output"]), "ISOLATED") {
		t.Fatal(other)
	}
	// Python's direct socket bypasses proxy variables; the namespace must deny it.
	network := nativeRun(t, a, ta, "python3 - <<'PY'\nimport socket,os\nassert not os.path.exists('/workspace/unauthorized')\nassert not any('TOKEN' in k or 'SECRET' in k for k in os.environ)\ns=socket.socket();s.settimeout(1)\ntry:\n s.connect(('127.0.0.1',18081))\n raise AssertionError('raw egress escaped')\nexcept OSError: print('DENIED')\nPY")
	if !strings.Contains(fmt.Sprint(network["output"]), "DENIED") {
		t.Fatal(network)
	}
	// Reacquire a durable scope handle, then continue the same tmux job.
	code, view := nativeRequest(t, "GET", "/v1/test-scopes/"+a, nil, "", 1)
	if code != 200 {
		t.Fatal(code, view)
	}
	code, res := nativeRequest(t, "POST", "/v1/test-scopes/"+a+"/jobs/"+job+"/input", map[string]any{"text": "continued\n", "timeout": 5}, ta, 1)
	if code != 200 || !strings.Contains(fmt.Sprint(res["output"]), "ANSWER:continued") {
		t.Fatal(code, res)
	}
}
func TestNativeScopeRealBoundsAndTreeCancellation(t *testing.T) {
	id := fmt.Sprintf("scope-tree-%d", time.Now().UnixNano())
	token := nativeCreate(t, id)
	res := nativeRun(t, id, token, "python3 - <<'PY'\nimport resource,os,ctypes,errno,threading\nc=ctypes.CDLL(None,use_errno=True)\nassert c.prctl(21,0,0,0,0)==2\nassert c.ptrace(0,0,0,0)==-1 and ctypes.get_errno()==errno.EPERM\nassert c.unshare(0x10000000)==-1 and ctypes.get_errno()==errno.EPERM\nassert resource.getrlimit(resource.RLIMIT_NOFILE)[1] == 128\nassert os.getpid() != 0\nfor fd in range(3,128):\n try: os.fstat(fd); raise AssertionError('inherited control descriptor')\n except OSError as e: assert e.errno == errno.EBADF\nt=threading.Thread(target=lambda: None);t.start();t.join()\nprint('FINITE')\nPY")
	if !strings.Contains(fmt.Sprint(res["output"]), "FINITE") {
		t.Fatal(res)
	}
	nativeRun(t, id, token, "(while :; do sleep 1; done) & wait")
	code, res := nativeRequest(t, "DELETE", "/v1/test-scopes/"+id, nil, token, 1)
	if code != 200 || res["status"] != "destroyed" {
		t.Fatal(code, res)
	}
	code, _ = nativeRequest(t, "POST", "/v1/test-scopes/"+id+"/jobs/run", map[string]any{"script": "echo recreated"}, token, 1)
	if code != 409 {
		t.Fatalf("destroyed physical owner recreated: %d", code)
	}
}

func TestNativeScopeBrokerCanaryAndRawDenial(t *testing.T) {
	canary := os.Getenv("SHELLCTL_NATIVE_CANARY_URL")
	if canary == "" {
		t.Fatal("synthetic canary URL required")
	}
	parsed, err := url.Parse(canary)
	if err != nil {
		t.Fatal(err)
	}
	host, portText, err := net.SplitHostPort(parsed.Host)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := http.Get(canary + "/count")
	if err != nil {
		t.Fatal(err)
	}
	before, _ := io.ReadAll(baseline.Body)
	_ = baseline.Body.Close()
	id := fmt.Sprintf("scope-broker-%d", time.Now().UnixNano())
	token := nativeCreate(t, id, map[string]any{"host": host, "port": port, "max_bytes": 8192, "timeout_seconds": 3})
	denied := nativeRun(t, id, token, fmt.Sprintf("python3 - <<'PY'\nimport socket\ns=socket.socket();s.settimeout(1)\ntry:\n s.connect((%q,%d))\n raise AssertionError('raw route reached host canary')\nexcept OSError: print('RAW_DENIED')\nPY", host, port))
	if !strings.Contains(fmt.Sprint(denied["output"]), "RAW_DENIED") {
		t.Fatal(denied)
	}
	check, err := http.Get(canary + "/count")
	if err != nil {
		t.Fatal(err)
	}
	after, _ := io.ReadAll(check.Body)
	_ = check.Body.Close()
	if string(before) != string(after) {
		t.Fatal("raw connection reached synthetic canary")
	}
	allowed := nativeRun(t, id, token, "curl --fail --max-time 5 --noproxy '' "+canary+"/canary")
	if !strings.Contains(fmt.Sprint(allowed["output"]), "native-broker-canary") {
		t.Fatal(allowed)
	}
}

func TestNativeScopeOutputOverflowCannotReportSuccess(t *testing.T) {
	id := fmt.Sprintf("scope-output-%d", time.Now().UnixNano())
	token := nativeCreate(t, id)
	code, res := nativeRequest(t, "POST", "/v1/test-scopes/"+id+"/jobs/run", map[string]any{"script": `python3 -c 'import sys; sys.stdout.write("x" * (8<<20))'`, "timeout": 5}, token, 1)
	for tries := 0; code == 200 && res["done"] != true && tries < 10; tries++ {
		job, _ := res["job_id"].(string)
		code, res = nativeRequest(t, "POST", "/v1/test-scopes/"+id+"/jobs/"+job+"/wait", map[string]any{"offset": res["offset"], "timeout": 1}, token, 1)
	}
	if code == 200 && res["status"] != "failed" && res["status"] != "lost" {
		t.Fatalf("overflow reported success or never terminated: %v", res)
	}
	if code != 200 && code != 409 && code != 502 {
		t.Fatal("unexpected overflow response", code, res)
	}
}

// Normal CI runs Prepare, restarts only the supervisor service, then runs Resume
// in a fresh test process. The handoff file contains identifiers only, no tokens.
func TestNativeScopeRestartPrepare(t *testing.T) {
	path := os.Getenv("SHELLCTL_NATIVE_RESTART_STATE")
	if path == "" {
		t.Fatal("restart fixture state path required")
	}
	id := fmt.Sprintf("scope-restart-%d", time.Now().UnixNano())
	spec := map[string]any{"scope_id": id, "generation": 1, "binding_ref": "fixture-binding", "base_snapshot_ref": "fixture-home", "input_file_refs": []string{}, "capability_digest": strings.Repeat("a", 64), "deadline": time.Now().Add(240 * time.Second), "limits": map[string]any{"cpu_quota": 100000, "memory_bytes": 512 << 20, "pids": 96, "fds": 128, "wall_seconds": 300, "input_bytes": 1 << 20, "output_bytes": 1 << 20, "disk_bytes": 32 << 20}, "network_targets": []any{}}
	code, scope := nativeRequest(t, "POST", "/v1/test-scopes", spec, "", 0)
	if code != 201 {
		t.Fatal(code, scope)
	}
	token, _ := scope["token"].(string)
	job := nativeRun(t, id, token, `printf 'BEFORE_RESTART\n'; read value; printf 'AFTER_RESTART:%s\n' "$value"`)
	data, _ := json.Marshal(map[string]any{"scope_id": id, "job_id": job["job_id"]})
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}
func TestNativeScopeRestartResume(t *testing.T) {
	path := os.Getenv("SHELLCTL_NATIVE_RESTART_STATE")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var state map[string]string
	if err = json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	code, scope := nativeRequest(t, "GET", "/v1/test-scopes/"+state["scope_id"], nil, "", 1)
	if code != 200 {
		t.Fatal(code, scope)
	}
	token, _ := scope["token"].(string)
	code, result := nativeRequest(t, "POST", "/v1/test-scopes/"+state["scope_id"]+"/jobs/"+state["job_id"]+"/input", map[string]any{"text": "same-job\n", "timeout": 5}, token, 1)
	if code != 200 || !strings.Contains(fmt.Sprint(result["output"]), "AFTER_RESTART:same-job") {
		t.Fatal(code, result)
	}
	code, result = nativeRequest(t, "DELETE", "/v1/test-scopes/"+state["scope_id"], nil, token, 1)
	if code != 200 {
		t.Fatal(code, result)
	}
}

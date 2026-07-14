// Package-level packaging tests verify that go.mod, Makefile, and Dockerfile
// stay consistent with the set of binaries the project produces.
//
// These are the Go equivalent of dify-agent/tests/local/test_packaging.py:
// they catch accidental drift in module metadata, build targets, and the
// container image definition.
package packaging_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// projectRoot returns the absolute path to the dify-agent-sandbox-runtime
// module root (the directory containing go.mod).
func projectRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot determine project root via runtime.Caller")
	}
	return filepath.Dir(file)
}

func TestGoModDeclares(t *testing.T) {
	root := projectRoot(t)
	data, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}
	content := string(data)

	if !strings.Contains(content, "module github.com/langgenius/dify/dify-agent-sandbox-runtime") {
		t.Error("go.mod module path mismatch")
	}
	if !strings.Contains(content, "require modernc.org/sqlite") {
		t.Error("go.mod must depend on modernc.org/sqlite")
	}
}

// expectedCmds lists the cmd/<name> directories that must exist.
// Each one produces a binary via `go build ./cmd/<name>`.
var expectedCmds = []string{
	"shellctl",
	"sanitize-pty",
	"runner-exit",
	"dify-agent-cli",
}

func TestCmdDirectoriesExist(t *testing.T) {
	root := projectRoot(t)
	for _, cmd := range expectedCmds {
		dir := filepath.Join(root, "cmd", cmd)
		info, err := os.Stat(dir)
		if err != nil {
			t.Errorf("cmd/%s directory missing: %v", cmd, err)
			continue
		}
		if !info.IsDir() {
			t.Errorf("cmd/%s is not a directory", cmd)
			continue
		}
		// Each cmd directory must have a main.go
		main := filepath.Join(dir, "main.go")
		if _, err := os.Stat(main); err != nil {
			t.Errorf("cmd/%s/main.go missing: %v", cmd, err)
		}
	}
}

func TestMakefileBuildTargets(t *testing.T) {
	root := projectRoot(t)
	data, err := os.ReadFile(filepath.Join(root, "Makefile"))
	if err != nil {
		t.Fatalf("read Makefile: %v", err)
	}
	content := string(data)

	expectedTargets := []string{
		"$(BIN_DIR)/shellctl",
		"$(BIN_DIR)/shellctl-sanitize-pty",
		"$(BIN_DIR)/shellctl-runner-exit",
		"$(BIN_DIR)/dify-agent",
	}
	for _, target := range expectedTargets {
		if !strings.Contains(content, target) {
			t.Errorf("Makefile missing build target %s", target)
		}
	}

	expectedSources := []string{
		"./cmd/shellctl",
		"./cmd/sanitize-pty",
		"./cmd/runner-exit",
		"./cmd/dify-agent-cli",
	}
	for _, src := range expectedSources {
		if !strings.Contains(content, src) {
			t.Errorf("Makefile missing build source %s", src)
		}
	}
}

func TestDockerfileBuildsAndCopiesAllBinaries(t *testing.T) {
	root := projectRoot(t)
	data, err := os.ReadFile(filepath.Join(root, "docker", "Dockerfile"))
	if err != nil {
		t.Fatalf("read Dockerfile: %v", err)
	}
	content := string(data)

	// Go build stage must produce all binaries
	goBuildLines := []string{
		"go build -o /bin/shellctl ./cmd/shellctl",
		"go build -o /bin/shellctl-sanitize-pty ./cmd/sanitize-pty",
		"go build -o /bin/shellctl-runner-exit ./cmd/runner-exit",
		"go build -o /bin/dify-agent ./cmd/dify-agent-cli",
	}
	for _, line := range goBuildLines {
		if !strings.Contains(content, line) {
			t.Errorf("Dockerfile missing build line: %s", line)
		}
	}

	// COPY stage must copy all binaries
	copyLines := []string{
		"COPY --from=go-builder /bin/shellctl /usr/local/bin/shellctl",
		"COPY --from=go-builder /bin/shellctl-sanitize-pty /usr/local/bin/shellctl-sanitize-pty",
		"COPY --from=go-builder /bin/shellctl-runner-exit /usr/local/bin/shellctl-runner-exit",
		"COPY --from=go-builder /bin/dify-agent /usr/local/bin/dify-agent",
	}
	for _, line := range copyLines {
		if !strings.Contains(content, line) {
			t.Errorf("Dockerfile missing COPY line: %s", line)
		}
	}

	// Runtime container assertions
	assertions := map[string]string{
		"CMD":    `CMD ["shellctl", "serve", "--listen", "0.0.0.0:5004"]`,
		"EXPOSE": "EXPOSE 5004",
		"USER":   "USER dify",
		"bash":   "bash",
		"git":    "git",
		"jq":     "jq",
		"tmux":   "tmux",
	}
	for name, expected := range assertions {
		if !strings.Contains(content, expected) {
			t.Errorf("Dockerfile missing %s assertion: %s", name, expected)
		}
	}

	// Must NOT reference the Python shellctl-server
	if strings.Contains(content, "shellctl-server") {
		t.Error("Dockerfile must not reference shellctl-server (Python)")
	}
}

package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/langgenius/dify/dify-agent-runtime/internal/agentcli"
)

func runPromptCLI(t *testing.T, args ...string) (string, error) {
	t.Helper()
	output, err := os.CreateTemp(t.TempDir(), "stdout-*")
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stdout
	defer func() { os.Stdout = original }()
	os.Stdout = output
	runErr := runCLI(args)
	if err := output.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(output.Name())
	if err != nil {
		t.Fatal(err)
	}
	return string(data), runErr
}

func TestConfigPromptPull(t *testing.T) {
	for _, prompt := range []string{"  原文 🪷 [§skill:research:Research§]\r\n\n", ""} {
		for _, customPath := range []bool{false, true} {
			t.Run(fmt.Sprintf("custom=%t/%q", customPath, prompt), func(t *testing.T) {
				t.Chdir(t.TempDir())
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method != http.MethodGet || r.URL.Path != "/agent-stub/config/prompt" {
						t.Errorf("unexpected request: %s %s", r.Method, r.URL)
					}
					if r.Header.Get("Authorization") != "Bearer token" {
						t.Error("missing Agent Stub authorization")
					}
					_ = json.NewEncoder(w).Encode(map[string]string{"prompt": prompt})
				}))
				defer server.Close()
				t.Setenv(agentcli.EnvAPIBaseURL, server.URL)
				t.Setenv(agentcli.EnvAuthJWE, "token")
				path := filepath.Join(".dify_conf", "prompt.md")
				args := []string{"config", "prompt", "pull"}
				if customPath {
					path = filepath.Join("custom", "prompt.txt")
					args = append(args, "--to", path)
				}
				output, err := runPromptCLI(t, args...)
				if err != nil {
					t.Fatal(err)
				}
				absolutePath, err := filepath.Abs(path)
				if err != nil {
					t.Fatal(err)
				}
				if output != absolutePath+"\n" {
					t.Errorf("output = %q, want path %q", output, absolutePath)
				}
				data, err := os.ReadFile(path)
				if err != nil || string(data) != prompt {
					t.Fatalf("saved prompt = %q, err = %v", data, err)
				}
			})
		}
	}
}

func TestConfigPromptPush(t *testing.T) {
	for _, source := range []string{"default", "file", "stdin"} {
		for _, prompt := range []string{"  新提示 🪷 [§file:guide.md:Guide§]\r\n\n", ""} {
			t.Run(source+prompt, func(t *testing.T) {
				t.Chdir(t.TempDir())
				want := map[string]any{"prompt": prompt}
				var received map[string]any
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method != http.MethodPut || r.URL.Path != "/agent-stub/config/prompt" {
						t.Errorf("unexpected request: %s %s", r.Method, r.URL)
					}
					if r.Header.Get("Authorization") != "Bearer token" {
						t.Error("missing Agent Stub authorization")
					}
					if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
						t.Error(err)
					}
					_ = json.NewEncoder(w).Encode(received)
				}))
				defer server.Close()
				t.Setenv(agentcli.EnvAPIBaseURL, server.URL)
				t.Setenv(agentcli.EnvAuthJWE, "token")
				if err := os.MkdirAll(".dify_conf", 0o755); err != nil {
					t.Fatal(err)
				}
				path := filepath.Join(".dify_conf", "prompt.md")
				if source != "default" {
					path = "input.txt"
				}
				if err := os.WriteFile(path, []byte(prompt), 0o644); err != nil {
					t.Fatal(err)
				}
				args := []string{"config", "prompt", "push"}
				switch source {
				case "file":
					args = append(args, path)
				case "stdin":
					input, err := os.Open(path)
					if err != nil {
						t.Fatal(err)
					}
					defer func() { _ = input.Close() }()
					original := os.Stdin
					defer func() { os.Stdin = original }()
					os.Stdin = input
					args = append(args, "-")
				}
				output, err := runPromptCLI(t, args...)
				if err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(received, want) {
					t.Fatalf("request payload = %#v", received)
				}
				var response map[string]any
				if err := json.Unmarshal([]byte(output), &response); err != nil || !reflect.DeepEqual(response, want) {
					t.Fatalf("output = %q, err = %v", output, err)
				}
			})
		}
	}
}

func TestConfigPromptPullRejectsBadResponsesWithoutOverwritingFile(t *testing.T) {
	for _, body := range []string{`{}`, `{"prompt":null}`, `{"prompt":123}`, `not-json`} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(body))
			}))
			defer server.Close()
			t.Setenv(agentcli.EnvAPIBaseURL, server.URL)
			t.Setenv(agentcli.EnvAuthJWE, "token")
			path := filepath.Join(t.TempDir(), "prompt.md")
			if err := os.WriteFile(path, []byte("keep"), 0o644); err != nil {
				t.Fatal(err)
			}
			output, err := runPromptCLI(t, "config", "prompt", "pull", "--to", path)
			if err == nil || output != "" {
				t.Fatalf("output = %q, err = %v; want failure without output", output, err)
			}
			data, err := os.ReadFile(path)
			if err != nil || string(data) != "keep" {
				t.Fatalf("existing file changed: %q, err = %v", data, err)
			}
		})
	}
}

func TestConfigPromptReportsFailures(t *testing.T) {
	t.Chdir(t.TempDir())
	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount.Add(1)
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"detail":{"code":"config_not_writable","message":"read only"}}`))
	}))
	defer server.Close()
	t.Setenv(agentcli.EnvAPIBaseURL, server.URL)
	t.Setenv(agentcli.EnvAuthJWE, "token")
	if err := os.WriteFile("prompt.md", []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"config", "prompt", "pull", "--to", "prompt.md"},
		{"config", "prompt", "push", "prompt.md"},
	} {
		output, err := runPromptCLI(t, args...)
		if err == nil || !strings.Contains(err.Error(), "HTTP 403") || output != "" {
			t.Errorf("%v: output = %q, err = %v", args, output, err)
		}
	}
	for _, args := range [][]string{
		{"config", "prompt", "push"}, // Missing default file must not clear the prompt.
		{"config", "prompt", "pull", "unexpected"},
		{"config", "prompt", "push", "one", "two"},
	} {
		if _, err := runPromptCLI(t, args...); err == nil {
			t.Errorf("%v: expected error", args)
		}
	}
	if err := os.WriteFile("invalid.txt", []byte{0xff}, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := runPromptCLI(t, "config", "prompt", "push", "invalid.txt"); err == nil || !strings.Contains(err.Error(), "UTF-8") {
		t.Errorf("invalid text error = %v", err)
	}
	if requestCount.Load() != 2 {
		t.Errorf("unexpected requests for invalid input: %d", requestCount.Load())
	}
	data, err := os.ReadFile("prompt.md")
	if err != nil || string(data) != "keep" {
		t.Fatalf("existing file changed: %q, err = %v", data, err)
	}
}

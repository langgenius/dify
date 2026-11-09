package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/langgenius/dify/dify-agent-runtime/internal/agentcli"
)

func TestKnowledgeProtocolNeedsNoEnvironment(t *testing.T) {
	t.Setenv(agentcli.EnvAPIBaseURL, "")
	t.Setenv(agentcli.EnvAuthJWE, "")
	if output := executeHelp(t, "knowledge", "--protocol-version"); output != "1\n" {
		t.Fatalf("unexpected protocol: %q", output)
	}
}

func TestKnowledgeCommandsSerializeOnlyAllowedArguments(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["command"] == "grep" && payload["query"] != "text" {
			t.Fatal("query lost")
		}
		if _, found := payload["url"]; found {
			t.Fatal("routing authority exposed")
		}
		if images, found := payload["image_file_ids"]; found {
			if values := images.([]any); len(values) != 1 || values[0] != "00000000-0000-4000-8000-000000000001" {
				t.Fatal("canonical input reference was not translated into an upload identity")
			}
		}
		payload["status"] = "ok"
		_ = json.NewEncoder(w).Encode(payload)
	}))
	defer server.Close()
	t.Setenv(agentcli.EnvAPIBaseURL, server.URL)
	t.Setenv(agentcli.EnvAuthJWE, "jwe")
	for _, args := range [][]string{
		{"spaces"}, {"capabilities", "--space", "docs"}, {"search", "--space", "docs", "--query", "text"},
		{"search", "--space", "docs", "--image-file-id", "dify-file-ref:" + base64.URLEncoding.EncodeToString([]byte(`{"record_id":"00000000-0000-4000-8000-000000000001"}`))},
		{"ls", "--space", "docs"}, {"tree", "--space", "docs"}, {"find", "--space", "docs", "--query", "text"},
		{"grep", "--space", "docs", "--query", "text"}, {"cat", "--space", "docs", "--path", "/knowledge/a"}, {"stat", "--space", "docs"},
		{"diff", "--space", "docs", "--old-path", "/knowledge/a", "--new-path", "/knowledge/b"},
		{"open", "--space", "docs", "--node-id", "00000000-0000-4000-8000-000000000001"},
		{"images", "--space", "docs", "--receipt", "receipt"}, {"image", "--space", "docs", "--receipt", "receipt", "--item-id", "image"},
	} {
		t.Run(args[0], func(t *testing.T) {
			output := executeHelp(t, append([]string{"knowledge"}, args...)...)
			if !json.Valid(bytes.TrimSpace([]byte(output))) {
				t.Fatal(output)
			}
		})
	}
	root := newRootCommand()
	root.SetArgs([]string{"knowledge", "search", "--url", "http://other"})
	if err := root.Execute(); err == nil {
		t.Fatal("arbitrary URL flag accepted")
	}
}

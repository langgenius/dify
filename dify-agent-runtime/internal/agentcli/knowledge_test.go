package agentcli

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestKnowledgeQueryImagesAcceptExistingLocalFileReferences(t *testing.T) {
	id := "00000000-0000-4000-8000-000000000001"
	ref := "dify-file-ref:" + base64.URLEncoding.EncodeToString([]byte(`{"record_id":"`+id+`"}`))
	for _, input := range []string{id, ref} {
		got, err := KnowledgeQueryImageID(input)
		if err != nil || got != id {
			t.Fatalf("input identity was lost: %v", err)
		}
	}
	for _, input := range []string{"", "http://other/image.png", "dify-file-ref:bad", "not-a-uuid", strings.Repeat("x", 4097),
		"dify-file-ref:" + base64.URLEncoding.EncodeToString([]byte(`{"record_id":"http://other"}`))} {
		if _, err := KnowledgeQueryImageID(input); err == nil {
			t.Fatal("invalid image reference accepted")
		}
	}
}

func TestKnowledgeTransportContract(t *testing.T) {
	id, err := NewKnowledgeCommandID()
	if err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{"version": 1, "command_id": id, "command": "search", "space": "产品", "query": "规格"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/agent-stub/knowledge/commands" || r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer run-jwe" {
			t.Error("invalid request routing/auth")
		}
		var received map[string]any
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil || received["query"] != "规格" || received["command_id"] != id {
			t.Errorf("invalid request: %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"version": 1, "command_id": id, "command": "search", "status": "ok", "data": map[string]any{"text": "证据"}})
	}))
	defer server.Close()
	var output bytes.Buffer
	if err := RunKnowledge(context.Background(), &Environment{URL: server.URL, AuthJWE: "run-jwe"}, payload, &output); err != nil {
		t.Fatal(err)
	}
	if !json.Valid(bytes.TrimSpace(output.Bytes())) || strings.Contains(output.String(), "run-jwe") {
		t.Fatal("output must be complete credential-free JSON")
	}
}

func TestKnowledgeRejectsPartialOversizedAndMismatchedResponses(t *testing.T) {
	for _, response := range []string{
		`{"version":1`, strings.Repeat("界", 23000),
		`{"version":2,"command_id":"id","command":"spaces","status":"ok"}`,
		`{"version":1,"command_id":"another","command":"spaces","status":"ok"}`,
		`{"version":1,"command_id":"id","command":"search","status":"ok"}`,
	} {
		t.Run(response[:10], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(response)) }))
			defer server.Close()
			var output bytes.Buffer
			err := RunKnowledge(context.Background(), &Environment{URL: server.URL}, map[string]any{"command_id": "id", "command": "spaces"}, &output)
			if err == nil || output.Len() != 0 {
				t.Fatalf("unsafe partial output accepted: %v", err)
			}
		})
	}
}

func TestKnowledgeNeverFollowsRedirectsAndHonorsCancellation(t *testing.T) {
	reached := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { reached = true }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	var output bytes.Buffer
	payload := map[string]any{"command_id": "id", "command": "spaces"}
	if err := RunKnowledge(context.Background(), &Environment{URL: server.URL, AuthJWE: "secret"}, payload, &output); err == nil || reached {
		t.Fatal("redirect accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := RunKnowledge(ctx, &Environment{URL: server.URL}, payload, &output); err == nil {
		t.Fatal("cancel ignored")
	}
	if output.Len() != 0 {
		t.Fatal("failure emitted a partial result")
	}
}

package agentcli

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseEndpoint_HTTP(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantURL string
		wantErr bool
	}{
		{
			name:    "bare http host normalizes to /agent-stub",
			input:   "http://localhost:8080",
			wantURL: "http://localhost:8080/agent-stub",
		},
		{
			name:    "bare https host normalizes to /agent-stub",
			input:   "https://agent.example.com",
			wantURL: "https://agent.example.com/agent-stub",
		},
		{
			name:    "explicit /agent-stub path is preserved",
			input:   "http://localhost:8080/agent-stub",
			wantURL: "http://localhost:8080/agent-stub",
		},
		{
			name:    "trailing slash normalized",
			input:   "http://localhost:8080/",
			wantURL: "http://localhost:8080/agent-stub",
		},
		{
			name:    "invalid path rejects",
			input:   "http://localhost:8080/other-path",
			wantErr: true,
		},
		{
			name:    "query string rejects",
			input:   "http://localhost:8080?foo=bar",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ep, err := ParseEndpoint(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if ep.URL != tc.wantURL {
				t.Errorf("URL = %q, want %q", ep.URL, tc.wantURL)
			}
		})
	}
}

func TestParseEndpoint_Invalid(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"empty", ""},
		{"spaces only", "   "},
		{"unsupported scheme", "ftp://example.com"},
		{"no host", "http://"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseEndpoint(tc.input)
			if err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestNewStubClient_NormalizesServiceRootWithoutMutatingEnvironment(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/agent-stub/connections" {
			t.Errorf("request path = %q, want %q", r.URL.Path, "/agent-stub/connections")
		}
		_ = json.NewEncoder(w).Encode(ConnectResponse{ConnectionID: "connection-1", Status: "connected"})
	}))
	defer server.Close()

	env := &Environment{URL: server.URL, AuthJWE: "test-token"}
	client, err := NewStubClient(env)
	if err != nil {
		t.Fatalf("NewStubClient() error = %v", err)
	}
	defer func() { _ = client.Close() }()

	response, err := client.Connect(context.Background(), nil, "")
	if err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	if response.ConnectionID != "connection-1" {
		t.Errorf("connection ID = %q, want %q", response.ConnectionID, "connection-1")
	}
	if env.URL != server.URL {
		t.Errorf("caller environment URL = %q, want unchanged %q", env.URL, server.URL)
	}
}

func TestReadEnvironment_Missing(t *testing.T) {
	t.Setenv(EnvAPIBaseURL, "")
	t.Setenv(EnvAuthJWE, "")

	_, err := ReadEnvironment()
	if err == nil {
		t.Fatal("expected error for missing env vars")
	}
}

func TestReadEnvironment_Valid(t *testing.T) {
	t.Setenv(EnvAPIBaseURL, "http://localhost:8080")
	t.Setenv(EnvAuthJWE, "test-token")

	env, err := ReadEnvironment()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if env.URL != "http://localhost:8080/agent-stub" {
		t.Errorf("URL = %q, want %q", env.URL, "http://localhost:8080/agent-stub")
	}
	if env.AuthJWE != "test-token" {
		t.Errorf("AuthJWE = %q, want %q", env.AuthJWE, "test-token")
	}
}

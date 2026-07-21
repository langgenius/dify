package agentcli

import (
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
			if ep.IsGRPC {
				t.Error("expected IsGRPC=false")
			}
		})
	}
}

func TestParseEndpoint_GRPC(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantURL string
		wantErr bool
	}{
		{
			name:    "valid grpc endpoint",
			input:   "grpc://localhost:50051",
			wantURL: "grpc://localhost:50051",
		},
		{
			name:    "grpc without port rejects",
			input:   "grpc://localhost",
			wantErr: true,
		},
		{
			name:    "grpc with path rejects",
			input:   "grpc://localhost:50051/some-path",
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
			if !ep.IsGRPC {
				t.Error("expected IsGRPC=true")
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

func TestReadDriveBase_Default(t *testing.T) {
	t.Setenv(EnvDriveBase, "")
	if got := ReadDriveBase(); got != DefaultDriveBase {
		t.Errorf("ReadDriveBase() = %q, want %q", got, DefaultDriveBase)
	}
}

func TestReadDriveBase_Custom(t *testing.T) {
	t.Setenv(EnvDriveBase, "/custom/drive")
	if got := ReadDriveBase(); got != "/custom/drive" {
		t.Errorf("ReadDriveBase() = %q, want %q", got, "/custom/drive")
	}
}

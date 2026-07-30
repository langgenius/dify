package egressproxy

import (
	"net/http"
	"testing"
)

func TestResolverRegisterAndResolve(t *testing.T) {
	r := NewResolver()
	r.Register("openai/api_key", &StoredCredential{Value: "sk-12345"})

	cred := r.Resolve("openai/api_key")
	if cred == nil || cred.Value != "sk-12345" {
		t.Fatalf("expected sk-12345, got %v", cred)
	}

	if r.Resolve("nonexistent/key") != nil {
		t.Fatal("expected nil for unknown ref")
	}
}

func TestResolverReplaceAll(t *testing.T) {
	r := NewResolver()
	r.Register("github/token", &StoredCredential{Value: "ghp_realtoken123"})
	r.Register("dify_agent_stub/auth_jwe", &StoredCredential{Value: "eyJhbGci..."})

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "single placeholder in header value",
			input: "Bearer __secret:dify_agent_stub/auth_jwe__",
			want:  "Bearer eyJhbGci...",
		},
		{
			name:  "multiple placeholders",
			input: "token=__secret:github/token__&auth=__secret:dify_agent_stub/auth_jwe__",
			want:  "token=ghp_realtoken123&auth=eyJhbGci...",
		},
		{
			name:  "no placeholders",
			input: "just a normal string",
			want:  "just a normal string",
		},
		{
			name:  "unresolved placeholder left intact",
			input: "__secret:unknown/ref__",
			want:  "__secret:unknown/ref__",
		},
		{
			name:  "mixed resolved and unresolved",
			input: "__secret:github/token__ and __secret:unknown/key__",
			want:  "ghp_realtoken123 and __secret:unknown/key__",
		},
		{
			name:  "placeholder is entire string",
			input: "__secret:github/token__",
			want:  "ghp_realtoken123",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := r.ReplaceAll(tc.input)
			if got != tc.want {
				t.Errorf("ReplaceAll(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestResolverInjectHeaders(t *testing.T) {
	r := NewResolver()
	r.Register("github/token", &StoredCredential{
		Value: "ghp_abc123",
		Inject: &CredentialInjectionPolicy{
			Type: SimpleHeader,
			SimpleHeader: &SimpleHeaderPolicy{
				HeaderName: "Authorization",
				Domains:    []string{"*.github.com", "api.github.com"},
				Expr:       "Bearer {{.Value}}",
			},
		},
	})
	r.Register("openai/api_key", &StoredCredential{
		Value: "sk-xyz",
		Inject: &CredentialInjectionPolicy{
			Type: SimpleHeader,
			SimpleHeader: &SimpleHeaderPolicy{
				HeaderName: "Authorization",
				Domains:    []string{"api.openai.com"},
				Expr:       "Bearer {{.Value}}",
			},
		},
	})

	// Request to api.github.com should get github token
	req, _ := http.NewRequest("GET", "https://api.github.com/repos", nil)
	r.InjectHeaders(req)
	if got := req.Header.Get("Authorization"); got != "Bearer ghp_abc123" {
		t.Errorf("github request: got %q, want %q", got, "Bearer ghp_abc123")
	}

	// Request to api.openai.com should get openai key
	req2, _ := http.NewRequest("GET", "https://api.openai.com/v1/chat", nil)
	r.InjectHeaders(req2)
	if got := req2.Header.Get("Authorization"); got != "Bearer sk-xyz" {
		t.Errorf("openai request: got %q, want %q", got, "Bearer sk-xyz")
	}

	// Request to unmatched domain gets nothing
	req3, _ := http.NewRequest("GET", "https://example.com/api", nil)
	r.InjectHeaders(req3)
	if got := req3.Header.Get("Authorization"); got != "" {
		t.Errorf("unmatched request: got %q, want empty", got)
	}
}

func TestResolverInjectHeadersSimpleHeaderExprAndErrors(t *testing.T) {
	r := NewResolver()
	r.Register("custom/key", &StoredCredential{
		Value: "abc123",
		Inject: &CredentialInjectionPolicy{
			Type: SimpleHeader,
			SimpleHeader: &SimpleHeaderPolicy{
				HeaderName: "X-Api-Key",
				Expr:       "key={{.Value}}",
			},
		},
	})
	req, _ := http.NewRequest("GET", "https://example.com/x", nil)
	r.InjectHeaders(req)
	if got := req.Header.Get("X-Api-Key"); got != "key=abc123" {
		t.Errorf("got %q, want %q", got, "key=abc123")
	}

	// Unsupported policy type should not panic and should leave headers unset.
	r2 := NewResolver()
	r2.Register("broken/key", &StoredCredential{
		Value: "v",
		Inject: &CredentialInjectionPolicy{
			Type: CredentialInjectionPolicyType("unsupported"),
		},
	})
	req2, _ := http.NewRequest("GET", "https://example.com/x", nil)
	r2.InjectHeaders(req2)
	if len(req2.Header) != 0 {
		t.Errorf("expected no headers injected for unsupported policy, got %v", req2.Header)
	}
}

func TestMatchesDomain(t *testing.T) {
	tests := []struct {
		host     string
		patterns []string
		want     bool
	}{
		{"api.github.com", []string{"*.github.com"}, true},
		{"github.com", []string{"*.github.com"}, false},
		{"api.github.com", []string{"api.github.com"}, true},
		{"evil.com", []string{"api.github.com"}, false},
		{"anything.com", nil, true},        // empty patterns = match all
		{"anything.com", []string{}, true}, // empty patterns = match all
	}
	for _, tc := range tests {
		got := matchesDomain(tc.host, tc.patterns)
		if got != tc.want {
			t.Errorf("matchesDomain(%q, %v) = %v, want %v", tc.host, tc.patterns, got, tc.want)
		}
	}
}

func TestResolverUnregister(t *testing.T) {
	r := NewResolver()
	r.Register("test/key", &StoredCredential{Value: "value"})
	r.Unregister("test/key")
	if r.Resolve("test/key") != nil {
		t.Fatal("expected key to be unregistered")
	}
}

func TestResolverClear(t *testing.T) {
	r := NewResolver()
	r.Register("a/x", &StoredCredential{Value: "1"})
	r.Register("b/y", &StoredCredential{Value: "2"})
	r.Clear()
	if r.Len() != 0 {
		t.Fatalf("expected 0 entries after clear, got %d", r.Len())
	}
}

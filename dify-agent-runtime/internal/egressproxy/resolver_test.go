package egressproxy

import (
	"net/http"
	"testing"
)

func TestResolverResolveForSystemTier(t *testing.T) {
	r := NewResolver()
	r.SetSystemCredentials(map[string]*StoredCredential{"openai/api_key": {Value: "sk-12345"}})

	cred := r.ResolveFor("", "openai/api_key")
	if cred == nil || cred.Value != "sk-12345" {
		t.Fatalf("expected sk-12345, got %v", cred)
	}

	if r.ResolveFor("", "nonexistent/key") != nil {
		t.Fatal("expected nil for unknown ref")
	}
	// Any sandboxID with no session set still sees the system tier.
	if cred := r.ResolveFor("some-sandbox", "openai/api_key"); cred == nil || cred.Value != "sk-12345" {
		t.Fatalf("expected system fallback for unknown sandbox, got %v", cred)
	}
}

func TestResolverReplaceAllFor(t *testing.T) {
	r := NewResolver()
	r.SetSystemCredentials(map[string]*StoredCredential{
		"github/token":             {Value: "ghp_realtoken123"},
		"dify_agent_stub/auth_jwe": {Value: "eyJhbGci..."},
	})

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
			got := r.ReplaceAllFor("", tc.input)
			if got != tc.want {
				t.Errorf("ReplaceAllFor(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestResolverInjectHeadersFor(t *testing.T) {
	r := NewResolver()
	r.SetSystemCredentials(map[string]*StoredCredential{
		"github/token": {
			Value: "ghp_abc123",
			Inject: &CredentialInjectionPolicy{
				Type: SimpleHeader,
				SimpleHeader: &SimpleHeaderPolicy{
					HeaderName: "Authorization",
					Domains:    []string{"*.github.com", "api.github.com"},
					Expr:       "Bearer {{.Value}}",
				},
			},
		},
		"openai/api_key": {
			Value: "sk-xyz",
			Inject: &CredentialInjectionPolicy{
				Type: SimpleHeader,
				SimpleHeader: &SimpleHeaderPolicy{
					HeaderName: "Authorization",
					Domains:    []string{"api.openai.com"},
					Expr:       "Bearer {{.Value}}",
				},
			},
		},
	})

	// Request to api.github.com should get github token
	req, _ := http.NewRequest("GET", "https://api.github.com/repos", nil)
	r.InjectHeadersFor("", req)
	if got := req.Header.Get("Authorization"); got != "Bearer ghp_abc123" {
		t.Errorf("github request: got %q, want %q", got, "Bearer ghp_abc123")
	}

	// Request to api.openai.com should get openai key
	req2, _ := http.NewRequest("GET", "https://api.openai.com/v1/chat", nil)
	r.InjectHeadersFor("", req2)
	if got := req2.Header.Get("Authorization"); got != "Bearer sk-xyz" {
		t.Errorf("openai request: got %q, want %q", got, "Bearer sk-xyz")
	}

	// Request to unmatched domain gets nothing
	req3, _ := http.NewRequest("GET", "https://example.com/api", nil)
	r.InjectHeadersFor("", req3)
	if got := req3.Header.Get("Authorization"); got != "" {
		t.Errorf("unmatched request: got %q, want empty", got)
	}
}

func TestResolverInjectHeadersForSimpleHeaderExprAndErrors(t *testing.T) {
	r := NewResolver()
	r.SetSystemCredentials(map[string]*StoredCredential{
		"custom/key": {
			Value: "abc123",
			Inject: &CredentialInjectionPolicy{
				Type: SimpleHeader,
				SimpleHeader: &SimpleHeaderPolicy{
					HeaderName: "X-Api-Key",
					Expr:       "key={{.Value}}",
				},
			},
		},
	})
	req, _ := http.NewRequest("GET", "https://example.com/x", nil)
	r.InjectHeadersFor("", req)
	if got := req.Header.Get("X-Api-Key"); got != "key=abc123" {
		t.Errorf("got %q, want %q", got, "key=abc123")
	}

	// Unsupported policy type should not panic and should leave headers unset.
	r2 := NewResolver()
	r2.SetSystemCredentials(map[string]*StoredCredential{
		"broken/key": {
			Value: "v",
			Inject: &CredentialInjectionPolicy{
				Type: CredentialInjectionPolicyType("unsupported"),
			},
		},
	})
	req2, _ := http.NewRequest("GET", "https://example.com/x", nil)
	r2.InjectHeadersFor("", req2)
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

func TestResolverClearSession(t *testing.T) {
	r := NewResolver()
	r.SetSessionCredentials("sandbox-a", map[string]*StoredCredential{"test/key": {Value: "value"}})
	r.ClearSession("sandbox-a")
	if r.ResolveFor("sandbox-a", "test/key") != nil {
		t.Fatal("expected session credential to be cleared")
	}
}

func TestResolverSessionsAreIsolated(t *testing.T) {
	r := NewResolver()
	r.SetSessionCredentials("sandbox-a", map[string]*StoredCredential{"a/x": {Value: "1"}})
	r.SetSessionCredentials("sandbox-b", map[string]*StoredCredential{"b/y": {Value: "2"}})

	if r.ResolveFor("sandbox-a", "b/y") != nil {
		t.Fatal("sandbox-a must not see sandbox-b's credentials")
	}
	if r.ResolveFor("sandbox-b", "a/x") != nil {
		t.Fatal("sandbox-b must not see sandbox-a's credentials")
	}
	if r.LenFor("sandbox-a") != 1 {
		t.Fatalf("expected 1 effective credential for sandbox-a, got %d", r.LenFor("sandbox-a"))
	}
}

func TestResolverSessionShadowsSystemWithoutMutation(t *testing.T) {
	r := NewResolver()
	r.SetSystemCredentials(map[string]*StoredCredential{"custom_saas/api_key": {Value: "sk-system-default"}})

	if cred := r.ResolveFor("sandbox-a", "custom_saas/api_key"); cred == nil || cred.Value != "sk-system-default" {
		t.Fatalf("expected system default, got %v", cred)
	}

	// sandbox-a's own session credential shadows the system value.
	r.SetSessionCredentials("sandbox-a", map[string]*StoredCredential{"custom_saas/api_key": {Value: "sk-sandbox-a-override"}})
	if cred := r.ResolveFor("sandbox-a", "custom_saas/api_key"); cred == nil || cred.Value != "sk-sandbox-a-override" {
		t.Fatalf("expected sandbox-a override, got %v", cred)
	}

	// A different, unrelated sandbox must still see only the system default.
	if cred := r.ResolveFor("sandbox-b", "custom_saas/api_key"); cred == nil || cred.Value != "sk-system-default" {
		t.Fatalf("expected sandbox-b to see system default, got %v", cred)
	}

	// Clearing sandbox-a's session must NOT delete the system entry.
	r.ClearSession("sandbox-a")
	if cred := r.ResolveFor("sandbox-a", "custom_saas/api_key"); cred == nil || cred.Value != "sk-system-default" {
		t.Fatalf("expected system default to survive session clear, got %v", cred)
	}
}

func TestResolverInjectHeadersForMergesSystemAndSessionTiers(t *testing.T) {
	r := NewResolver()
	r.SetSystemCredentials(map[string]*StoredCredential{
		"custom_saas/api_key": {
			Value: "sk-system-default",
			Inject: &CredentialInjectionPolicy{
				Type: SimpleHeader,
				SimpleHeader: &SimpleHeaderPolicy{
					HeaderName: "Authorization",
					Domains:    []string{"api.custom-saas.example"},
					Expr:       "Bearer {{.Value}}",
				},
			},
		},
	})

	req, _ := http.NewRequest("GET", "https://api.custom-saas.example/v1", nil)
	r.InjectHeadersFor("sandbox-a", req)
	if got := req.Header.Get("Authorization"); got != "Bearer sk-system-default" {
		t.Errorf("got %q, want %q", got, "Bearer sk-system-default")
	}

	// sandbox-a's own session credential shadows the system policy too.
	r.SetSessionCredentials("sandbox-a", map[string]*StoredCredential{
		"custom_saas/api_key": {
			Value: "sk-sandbox-a-override",
			Inject: &CredentialInjectionPolicy{
				Type: SimpleHeader,
				SimpleHeader: &SimpleHeaderPolicy{
					HeaderName: "Authorization",
					Domains:    []string{"api.custom-saas.example"},
					Expr:       "Bearer {{.Value}}",
				},
			},
		},
	})

	req2, _ := http.NewRequest("GET", "https://api.custom-saas.example/v1", nil)
	r.InjectHeadersFor("sandbox-a", req2)
	if got := req2.Header.Get("Authorization"); got != "Bearer sk-sandbox-a-override" {
		t.Errorf("got %q, want %q", got, "Bearer sk-sandbox-a-override")
	}

	// A different sandbox with no session override still only gets the
	// system default injected.
	req3, _ := http.NewRequest("GET", "https://api.custom-saas.example/v1", nil)
	r.InjectHeadersFor("sandbox-b", req3)
	if got := req3.Header.Get("Authorization"); got != "Bearer sk-system-default" {
		t.Errorf("got %q, want %q", got, "Bearer sk-system-default")
	}
}

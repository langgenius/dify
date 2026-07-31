package egressproxy

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/langgenius/dify/dify-agent-runtime/internal/providers/aws"
	"github.com/langgenius/dify/dify-agent-runtime/internal/providers/simple"
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
			Inject: &simple.Policy{
				HeaderName: "Authorization",
				Domains_:   []string{"*.github.com", "api.github.com"},
				Expr:       "Bearer {{.Value}}",
			},
		},
		"openai/api_key": {
			Value: "sk-xyz",
			Inject: &simple.Policy{
				HeaderName: "Authorization",
				Domains_:   []string{"api.openai.com"},
				Expr:       "Bearer {{.Value}}",
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
			Inject: &simple.Policy{
				HeaderName: "X-Api-Key",
				Expr:       "key={{.Value}}",
			},
		},
	})
	req, _ := http.NewRequest("GET", "https://example.com/x", nil)
	r.InjectHeadersFor("", req)
	if got := req.Header.Get("X-Api-Key"); got != "key=abc123" {
		t.Errorf("got %q, want %q", got, "key=abc123")
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
			Inject: &simple.Policy{
				HeaderName: "Authorization",
				Domains_:   []string{"api.custom-saas.example"},
				Expr:       "Bearer {{.Value}}",
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
			Inject: &simple.Policy{
				HeaderName: "Authorization",
				Domains_:   []string{"api.custom-saas.example"},
				Expr:       "Bearer {{.Value}}",
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

// TestResolverInjectHeadersForAWSSigV4 verifies that the AWS SigV4 policy
// signs a request to an S3 endpoint with real credentials, stripping any
// client-supplied fake signature.
func TestResolverInjectHeadersForAWSSigV4(t *testing.T) {
	r := NewResolver()
	credJSON := []byte(`{"access_key_id":"AKIAIOSFODNN7EXAMPLE","secret_access_key":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}`)
	r.SetSystemCredentials(map[string]*StoredCredential{
		"aws/s3_prod": {
			Value: credJSON,
			Inject: &aws.Policy{
				Domains_: []string{"*.amazonaws.com"},
				Service:  "s3",
			},
		},
	})

	// Simulate a curl request (no signature) to S3.
	req, _ := http.NewRequest("GET", "https://s3.us-east-1.amazonaws.com/bucket/key", nil)
	r.InjectHeadersFor("", req)

	auth := req.Header.Get("Authorization")
	if auth == "" || !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 ") {
		t.Errorf("expected AWS4-HMAC-SHA256 Authorization header, got %q", auth)
	}
	if req.Header.Get("X-Amz-Date") == "" {
		t.Errorf("expected X-Amz-Date header to be set")
	}
	if req.Header.Get("X-Amz-Content-Sha256") == "" {
		t.Errorf("expected X-Amz-Content-Sha256 header to be set")
	}
}

// TestResolverInjectHeadersForAWSSigV4StripsFakeSignature verifies that a
// client-supplied fake signature (from aws cli using placeholder env vars)
// is stripped before re-signing with real credentials.
func TestResolverInjectHeadersForAWSSigV4StripsFakeSignature(t *testing.T) {
	r := NewResolver()
	credJSON := []byte(`{"access_key_id":"AKIAIOSFODNN7EXAMPLE","secret_access_key":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}`)
	r.SetSystemCredentials(map[string]*StoredCredential{
		"aws/s3_prod": {
			Value: credJSON,
			Inject: &aws.Policy{
				Domains_: []string{"*.amazonaws.com"},
				Service:  "s3",
			},
		},
	})

	// Simulate aws cli with placeholder env vars: it signs with the
	// placeholder as the access key, producing a fake signature.
	req, _ := http.NewRequest("GET", "https://s3.us-east-1.amazonaws.com/bucket/key", nil)
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential=__secret:aws/s3_prod__/20260731/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=fakesig")
	req.Header.Set("X-Amz-Date", "20260731T120000Z")
	req.Header.Set("X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD")
	r.InjectHeadersFor("", req)

	auth := req.Header.Get("Authorization")
	if auth == "" || !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 ") {
		t.Errorf("expected real AWS4-HMAC-SHA256 Authorization header, got %q", auth)
	}
	// The fake signature must have been replaced.
	if strings.Contains(auth, "__secret:aws/s3_prod__") {
		t.Errorf("fake signature not stripped: %q", auth)
	}
	if strings.Contains(auth, "fakesig") {
		t.Errorf("fake signature not stripped: %q", auth)
	}
}

// TestResolverInjectHeadersForAWSSigV4DomainFiltering verifies that requests
// to non-matching domains are not signed.
func TestResolverInjectHeadersForAWSSigV4DomainFiltering(t *testing.T) {
	r := NewResolver()
	credJSON := []byte(`{"access_key_id":"AKIAIOSFODNN7EXAMPLE","secret_access_key":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}`)
	r.SetSystemCredentials(map[string]*StoredCredential{
		"aws/s3_prod": {
			Value: credJSON,
			Inject: &aws.Policy{
				Domains_: []string{"*.amazonaws.com"},
				Service:  "s3",
			},
		},
	})

	// Request to a non-AWS domain should not be signed.
	req, _ := http.NewRequest("GET", "https://example.com/api", nil)
	r.InjectHeadersFor("", req)
	if req.Header.Get("Authorization") != "" {
		t.Errorf("expected no Authorization header for non-matching domain, got %q", req.Header.Get("Authorization"))
	}
}

// TestResolverInjectHeadersForAWSSigV4SessionToken verifies that a session
// token is included when present.
func TestResolverInjectHeadersForAWSSigV4SessionToken(t *testing.T) {
	r := NewResolver()
	credJSON := []byte(`{"access_key_id":"AKIAIOSFODNN7EXAMPLE","secret_access_key":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY","session_token":"sessiontoken123"}`)
	r.SetSystemCredentials(map[string]*StoredCredential{
		"aws/s3_prod": {
			Value: credJSON,
			Inject: &aws.Policy{
				Domains_: []string{"*.amazonaws.com"},
				Service:  "s3",
			},
		},
	})

	req, _ := http.NewRequest("GET", "https://s3.us-east-1.amazonaws.com/bucket/key", nil)
	r.InjectHeadersFor("", req)

	if got := req.Header.Get("X-Amz-Security-Token"); got != "sessiontoken123" {
		t.Errorf("expected X-Amz-Security-Token to be set, got %q", got)
	}
}

// TestResolverInjectHeadersForAWSSigV4BodyReplay verifies that a POST body
// is correctly hashed and the body remains readable after signing.
func TestResolverInjectHeadersForAWSSigV4BodyReplay(t *testing.T) {
	r := NewResolver()
	credJSON := []byte(`{"access_key_id":"AKIAIOSFODNN7EXAMPLE","secret_access_key":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}`)
	r.SetSystemCredentials(map[string]*StoredCredential{
		"aws/s3_prod": {
			Value: credJSON,
			Inject: &aws.Policy{
				Domains_: []string{"*.amazonaws.com"},
				Service:  "s3",
			},
		},
	})

	body := "hello world"
	req, _ := http.NewRequest("PUT", "https://s3.us-east-1.amazonaws.com/bucket/key", strings.NewReader(body))
	// Simulate aws cli setting a content-sha256 in "signed body" mode (a
	// real 64-char hex hash — the proxy will recompute it from the actual
	// body and use that for signing).
	req.Header.Set("X-Amz-Content-Sha256", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	r.InjectHeadersFor("", req)

	// The body should still be readable.
	readBody, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if string(readBody) != body {
		t.Errorf("body not replayed correctly: got %q, want %q", readBody, body)
	}

	// X-Amz-Content-Sha256 should be the real hash (recomputed from body),
	// not the fake value the client sent.
	sha := req.Header.Get("X-Amz-Content-Sha256")
	if sha == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Errorf("expected recomputed SHA-256 hash, got client's fake value")
	}
	// Verify it's a 64-char hex string.
	if len(sha) != 64 {
		t.Errorf("expected 64-char hex hash, got %d chars: %q", len(sha), sha)
	}
}

// TestResolverReplaceAllForSkipsNonStringValue verifies that placeholders for
// structured (non-string) credentials are left intact.
func TestResolverReplaceAllForSkipsNonStringValue(t *testing.T) {
	r := NewResolver()
	credJSON := []byte(`{"access_key_id":"AKIAIOSFODNN7EXAMPLE","secret_access_key":"secret"}`)
	r.SetSystemCredentials(map[string]*StoredCredential{
		"aws/creds": {Value: credJSON},
	})

	input := "__secret:aws/creds__"
	got := r.ReplaceAllFor("", input)
	if got != input {
		t.Errorf("expected placeholder to be left intact for non-string value, got %q", got)
	}
}

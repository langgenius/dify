// Package proxy implements the secret-injection outbound proxy for the
// Dify agent runtime.  It resolves placeholder env-var values into real
// secrets at the network boundary, so real credentials never enter the
// agent's process address space.
//
// Design doc: https://github.com/langgenius/dify/issues/39278
package proxy

import (
	"fmt"
	"strings"
)

// ── Domain Rules ──────────────────────────────────────────────

// DomainRule describes a single allowlisted domain or glob pattern.
type DomainRule struct {
	// Pattern is either an exact hostname ("api.github.com") or a glob
	// ("*.dify.internal").  Matching is always exact-subdomain: the
	// wildcard only matches a single label, so "*.dify.internal" does
	// NOT match "evil-dify.internal.attacker.com".
	Pattern string `yaml:"pattern"`
}

// Matches reports whether host is allowed by this rule.
func (r DomainRule) Matches(host string) bool {
	if !strings.HasPrefix(r.Pattern, "*.") {
		return host == r.Pattern
	}
	suffix := r.Pattern[1:] // ".dify.internal"
	return strings.HasSuffix(host, suffix) &&
		// Guard against suffix-only matching:
		// "evil-dify.internal.attacker.com" must NOT match "*.dify.internal"
		!strings.Contains(strings.TrimSuffix(host, suffix), ".")
}

// ── Secret Mapping ────────────────────────────────────────────

// SecretMapping defines one env-var → header injection rule.
type SecretMapping struct {
	// Env is the placeholder name exposed to the agent, e.g.
	// "GITHUB_TOKEN".  The agent's environment receives
	// "__secret:<provider>:<Env>__" as the value.
	Env string `yaml:"env"`

	// ValueFile is the path to the real secret on the host filesystem,
	// relative to the secret store root (/run/secrets/<session>/).
	ValueFile string `yaml:"value_file"`

	// Inject describes how the secret is placed into outbound requests.
	Inject InjectionRule `yaml:"inject"`
}

// Validate checks required fields and returns a human-readable error.
func (s SecretMapping) Validate() error {
	if s.Env == "" {
		return fmt.Errorf("secret mapping: env is required")
	}
	if s.ValueFile == "" {
		return fmt.Errorf("secret %q: value_file is required", s.Env)
	}
	if s.Inject.Header == "" {
		return fmt.Errorf("secret %q: inject.header is required", s.Env)
	}
	if len(s.Inject.Domains) == 0 {
		return fmt.Errorf("secret %q: at least one inject domain is required", s.Env)
	}
	return nil
}

// ── Injection Rule ────────────────────────────────────────────

// InjectionRule describes the HTTP header transformation.
type InjectionRule struct {
	// Header is the HTTP header name to populate (e.g. "Authorization").
	Header string `yaml:"header"`

	// Prefix is prepended to the secret value before injection.
	// For "Bearer <token>" set Prefix = "Bearer ".
	Prefix string `yaml:"prefix"`

	// Domains is the allowlist of target hostnames / globs.
	Domains []DomainRule `yaml:"domains"`
}

// ResolveValue returns the real header value (prefix + secret).
func (r InjectionRule) ResolveValue(secret string) string {
	return r.Prefix + secret
}

// MatchesDomain returns true if host matches any domain rule.
func (r InjectionRule) MatchesDomain(host string) bool {
	for _, d := range r.Domains {
		if d.Matches(host) {
			return true
		}
	}
	return false
}

// ── Provider Profile ──────────────────────────────────────────

// ProviderProfile is the top-level configuration for one provider.
type ProviderProfile struct {
	// Name is the provider identifier (e.g. "github", "openai").
	Name string `yaml:"-"`

	// Secrets is the ordered list of env-var → header mappings.
	Secrets []SecretMapping `yaml:"secrets"`
}

// Validate checks the entire profile and all its secrets.
func (p ProviderProfile) Validate() error {
	if p.Name == "" {
		return fmt.Errorf("provider name is required")
	}
	if len(p.Secrets) == 0 {
		return fmt.Errorf("provider %q: at least one secret mapping is required", p.Name)
	}
	for i := range p.Secrets {
		if err := p.Secrets[i].Validate(); err != nil {
			return fmt.Errorf("provider %q: %w", p.Name, err)
		}
	}
	return nil
}

// ── Injection Config (top-level) ──────────────────────────────

// InjectionConfig is the parsed providers.yaml.
type InjectionConfig struct {
	Providers map[string]ProviderProfile `yaml:"providers"`
}

// Validate checks all profiles.
func (c InjectionConfig) Validate() error {
	if len(c.Providers) == 0 {
		return fmt.Errorf("at least one provider is required")
	}
	for name, p := range c.Providers {
		p.Name = name
		if err := p.Validate(); err != nil {
			return err
		}
		c.Providers[name] = p
	}
	return nil
}

// Placeholder generates the placeholder value exposed to the agent.
// Format: __secret:<provider>:<env>__
func Placeholder(provider, env string) string {
	return fmt.Sprintf("__secret:%s:%s__", provider, env)
}

// IsPlaceholder reports whether value is a secret placeholder.
func IsPlaceholder(value string) bool {
	return strings.HasPrefix(value, "__secret:") && strings.HasSuffix(value, "__")
}

// ParsePlaceholder extracts (provider, env) from a placeholder string.
// Returns false if value is not a valid placeholder.
func ParsePlaceholder(value string) (provider, env string, ok bool) {
	if !IsPlaceholder(value) {
		return "", "", false
	}
	inner := value[len("__secret:") : len(value)-len("__")]
	parts := strings.SplitN(inner, ":", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	return parts[0], parts[1], true
}

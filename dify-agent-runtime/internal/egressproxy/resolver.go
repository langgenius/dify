// Package egressproxy implements the in-process egress proxy that runs inside
// the sandbox. It intercepts all outbound HTTP/HTTPS requests, resolves
// __secret:provider/name__ placeholders, and proactively injects credentials
// as HTTP headers based on domain-matching policies.
//
// Credentials are registered by the shellctl server when agent_backend
// sends them via the prepare API. In a future iteration the proxy will also
// enforce SSRF/access policies and rate-limiting.
package egressproxy

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"text/template"
)

// placeholderPattern matches __secret:<provider>/<name>__ tokens.
// Group 1 captures the full ref ("provider/name").
var placeholderPattern = regexp.MustCompile(`__secret:([a-zA-Z0-9_]+/[a-zA-Z0-9_]+)__`)

// CredentialInjectionPolicyType enumerates the supported proactive credential
// injection strategies. New strategies (e.g. AWS SigV4 request signing) can
// be added alongside SimpleHeader without changing the Resolver's public API.
type CredentialInjectionPolicyType string

const (
	// SimpleHeader injects the credential as a single HTTP header whose
	// value is rendered from a Go text/template.
	SimpleHeader CredentialInjectionPolicyType = "simple-header"
)

// SimpleHeaderPolicy injects a single HTTP header on requests matching
// Domains. The header value is rendered from Expr, a Go text/template
// evaluated with the resolved credential value available as {{.Value}},
// e.g. `Bearer {{.Value}}` or `{{.Value}}`.
type SimpleHeaderPolicy struct {
	HeaderName string
	Domains    []string // wildcard-capable domain patterns; empty = all
	Expr       string   // Go text/template rendered with {{.Value}}

	tmplOnce sync.Once
	tmpl     *template.Template
	tmplErr  error
}

// compile lazily parses Expr into a template, caching the result (or error).
func (p *SimpleHeaderPolicy) compile() (*template.Template, error) {
	p.tmplOnce.Do(func() {
		p.tmpl, p.tmplErr = template.New("simple-header").Parse(p.Expr)
	})
	return p.tmpl, p.tmplErr
}

// render evaluates Expr against the given credential value.
func (p *SimpleHeaderPolicy) render(value string) (string, error) {
	tmpl, err := p.compile()
	if err != nil {
		return "", fmt.Errorf("parse expr %q: %w", p.Expr, err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, struct{ Value string }{Value: value}); err != nil {
		return "", fmt.Errorf("render expr %q: %w", p.Expr, err)
	}
	return buf.String(), nil
}

// CredentialInjectionPolicy describes how a credential should be proactively
// injected into outbound requests. Type selects the concrete strategy; the
// corresponding field should be populated (e.g. SimpleHeader for
// CredentialInjectionPolicyType SimpleHeader).
type CredentialInjectionPolicy struct {
	Type         CredentialInjectionPolicyType
	SimpleHeader *SimpleHeaderPolicy
}

// domains returns the domain-match patterns for this policy, if any.
func (p *CredentialInjectionPolicy) domains() []string {
	switch p.Type {
	case SimpleHeader:
		if p.SimpleHeader != nil {
			return p.SimpleHeader.Domains
		}
	}
	return nil
}

// apply injects the credential into req according to the policy.
func (p *CredentialInjectionPolicy) apply(req *http.Request, value string) error {
	switch p.Type {
	case SimpleHeader:
		if p.SimpleHeader == nil {
			return fmt.Errorf("simple-header policy missing configuration")
		}
		rendered, err := p.SimpleHeader.render(value)
		if err != nil {
			return err
		}
		req.Header.Set(p.SimpleHeader.HeaderName, rendered)
		return nil
	default:
		return fmt.Errorf("unsupported credential injection policy type %q", p.Type)
	}
}

// StoredCredential holds a credential's value and optional injection policy.
type StoredCredential struct {
	Value  string
	Inject *CredentialInjectionPolicy
}

// Resolver is a thread-safe credential store indexed by "provider/name" refs.
// It supports both placeholder replacement and proactive header injection.
type Resolver struct {
	mu    sync.RWMutex
	creds map[string]*StoredCredential // key: "provider/name"
}

// NewResolver creates an empty credential resolver.
func NewResolver() *Resolver {
	return &Resolver{creds: make(map[string]*StoredCredential)}
}

// Register stores or updates a credential.
func (r *Resolver) Register(ref string, cred *StoredCredential) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.creds[ref] = cred
}

// Unregister removes a credential by ref.
func (r *Resolver) Unregister(ref string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.creds, ref)
}

// Resolve returns the stored credential for a ref, or nil if unknown.
func (r *Resolver) Resolve(ref string) *StoredCredential {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.creds[ref]
}

// ReplaceAll scans s for all __secret:provider/name__ placeholders and replaces
// each with the resolved value. Unresolved placeholders are left intact.
func (r *Resolver) ReplaceAll(s string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return placeholderPattern.ReplaceAllStringFunc(s, func(match string) string {
		groups := placeholderPattern.FindStringSubmatch(match)
		if len(groups) < 2 {
			return match
		}
		ref := groups[1]
		if cred, ok := r.creds[ref]; ok {
			return cred.Value
		}
		return match
	})
}

// InjectHeaders proactively injects credential-derived headers into the
// request based on domain-matching injection policies.
func (r *Resolver) InjectHeaders(req *http.Request) {
	host := req.URL.Hostname()
	if host == "" {
		host = req.Host
	}
	if idx := strings.LastIndex(host, ":"); idx >= 0 {
		host = host[:idx]
	}

	r.mu.RLock()
	defer r.mu.RUnlock()
	for ref, cred := range r.creds {
		if cred.Inject == nil {
			continue
		}
		if !matchesDomain(host, cred.Inject.domains()) {
			continue
		}
		if err := cred.Inject.apply(req, cred.Value); err != nil {
			log.Printf("egressproxy: inject credential %q: %v", ref, err)
		}
	}
}

// Clear removes all stored credentials.
func (r *Resolver) Clear() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.creds = make(map[string]*StoredCredential)
}

// Len returns the number of stored credentials.
func (r *Resolver) Len() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.creds)
}

// matchesDomain checks if host matches any of the domain patterns.
// Empty patterns list means match all. Supports "*.example.com" wildcard.
func matchesDomain(host string, patterns []string) bool {
	if len(patterns) == 0 {
		return true
	}
	host = strings.ToLower(host)
	for _, p := range patterns {
		p = strings.ToLower(p)
		if p == host {
			return true
		}
		if strings.HasPrefix(p, "*.") {
			suffix := p[1:] // ".example.com"
			if strings.HasSuffix(host, suffix) {
				return true
			}
		}
	}
	return false
}

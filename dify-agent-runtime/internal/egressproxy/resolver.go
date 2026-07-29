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
	"net/http"
	"regexp"
	"strings"
	"sync"
)

// placeholderPattern matches __secret:<provider>/<name>__ tokens.
// Group 1 captures the full ref ("provider/name").
var placeholderPattern = regexp.MustCompile(`__secret:([a-zA-Z0-9_]+/[a-zA-Z0-9_]+)__`)

// HeaderInjectRule describes a single header injection policy.
type HeaderInjectRule struct {
	HeaderName string   // e.g. "Authorization"
	Prefix     string   // e.g. "Bearer "
	Domains    []string // wildcard-capable domain patterns; empty = all
	Value      string   // the credential value to inject
}

// StoredCredential holds a credential's value and optional injection policy.
type StoredCredential struct {
	Value  string
	Inject *HeaderInjectRule
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
	for _, cred := range r.creds {
		if cred.Inject == nil {
			continue
		}
		rule := cred.Inject
		if !matchesDomain(host, rule.Domains) {
			continue
		}
		req.Header.Set(rule.HeaderName, rule.Prefix+rule.Value)
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

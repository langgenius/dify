// Package egressproxy implements the in-process egress proxy that runs inside
// the sandbox. It intercepts all outbound HTTP/HTTPS requests, resolves
// __secret:provider/name__ placeholders, and proactively injects credentials
// based on domain-matching policies (see package providers).
package egressproxy

import (
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/langgenius/dify/dify-agent-runtime/internal/providers"
)

// placeholderPattern matches __secret:<provider>/<name>__ tokens.
// Group 1 captures the full ref ("provider/name").
var placeholderPattern = regexp.MustCompile(`__secret:([a-zA-Z0-9_]+/[a-zA-Z0-9_]+)__`)

// StoredCredential holds a credential's value and optional injection policy.
// Value is interpreted by the Inject policy: simple.Policy expects a string
// (or JSON string), aws.Policy expects a structured object (see aws.Credentials).
type StoredCredential struct {
	Value  any
	Inject providers.Policy
}

// Resolver is a thread-safe credential store scoped by sandbox session.
// It supports both placeholder replacement and proactive header injection.
//
// Credentials live in two independent tiers:
//
//   - system holds credentials seeded once at startup (see
//     LoadCredentialManifest). It is set via SetSystemCredentials and is
//     never touched by session operations.
//   - sessions holds one independent credential set per sandbox_id, set via
//     SetSessionCredentials (from PUT /v1/prepare). Writing session N's
//     credentials never touches session M's map or the system tier — there
//     is no shared mutable state across sandbox sessions.
//
// Every lookup is scoped to a sandboxID: it checks that session's map first
// and falls back to the system tier. An empty sandboxID (no session
// identified) only ever sees the system tier.
type Resolver struct {
	mu       sync.RWMutex
	system   map[string]*StoredCredential            // key: "provider/name"
	sessions map[string]map[string]*StoredCredential // key: sandboxID -> "provider/name"
}

// NewResolver creates an empty credential resolver.
func NewResolver() *Resolver {
	return &Resolver{
		system:   make(map[string]*StoredCredential),
		sessions: make(map[string]map[string]*StoredCredential),
	}
}

// SetSystemCredentials replaces the entire system-tier credential set.
func (r *Resolver) SetSystemCredentials(creds map[string]*StoredCredential) {
	if creds == nil {
		creds = make(map[string]*StoredCredential)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.system = creds
}

// SetSessionCredentials replaces the credential set for one sandbox session,
// identified by sandboxID.
func (r *Resolver) SetSessionCredentials(sandboxID string, creds map[string]*StoredCredential) {
	if creds == nil {
		creds = make(map[string]*StoredCredential)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[sandboxID] = creds
}

// ClearSession removes a sandbox session's credentials.
func (r *Resolver) ClearSession(sandboxID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.sessions, sandboxID)
}

// ResolveFor returns the effective credential for ref within sandboxID's
// session, falling back to the system tier, or nil if neither has it. An
// empty sandboxID only ever resolves against the system tier.
func (r *Resolver) ResolveFor(sandboxID, ref string) *StoredCredential {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if sandboxID != "" {
		if session, ok := r.sessions[sandboxID]; ok {
			if cred, ok := session[ref]; ok {
				return cred
			}
		}
	}
	return r.system[ref]
}

// ReplaceAllFor scans s for all __secret:provider/name__ placeholders and
// replaces each with the value resolved for sandboxID (session, falling back
// to system). Unresolved placeholders are left intact. Placeholders whose
// credential Value is not a string (e.g. structured credentials used only for
// injection policies) are also left intact — they are not meant to be
// substituted into request text.
func (r *Resolver) ReplaceAllFor(sandboxID, s string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return placeholderPattern.ReplaceAllStringFunc(s, func(match string) string {
		groups := placeholderPattern.FindStringSubmatch(match)
		if len(groups) < 2 {
			return match
		}
		ref := groups[1]
		var cred *StoredCredential
		if sandboxID != "" {
			if session, ok := r.sessions[sandboxID]; ok {
				cred = session[ref]
			}
		}
		if cred == nil {
			cred = r.system[ref]
		}
		if cred == nil {
			return match
		}
		if sv, ok := cred.Value.(string); ok {
			return sv
		}
		// Non-string values (structured credentials) are not substituted.
		return match
	})
}

// InjectHeadersFor proactively injects credential-derived headers into the
// request based on domain-matching injection policies, using the effective
// credential set for sandboxID (session merged over system).
func (r *Resolver) InjectHeadersFor(sandboxID string, req *http.Request) {
	host := req.URL.Hostname()
	if host == "" {
		host = req.Host
	}
	if idx := strings.LastIndex(host, ":"); idx >= 0 {
		host = host[:idx]
	}

	r.mu.RLock()
	defer r.mu.RUnlock()
	for ref, cred := range r.effectiveCredsLocked(sandboxID) {
		if cred.Inject == nil {
			continue
		}
		if !matchesDomain(host, cred.Inject.Domains()) {
			continue
		}
		if err := cred.Inject.Apply(req, cred.Value); err != nil {
			log.Printf("egressproxy: inject credential %q (sandbox=%q): %v", ref, sandboxID, err)
		}
	}
}

// effectiveCredsLocked returns the merged view of the system tier and
// sandboxID's session tier, with the session shadowing the system tier
// under the same ref. Callers must hold r.mu (read or write lock).
func (r *Resolver) effectiveCredsLocked(sandboxID string) map[string]*StoredCredential {
	session := r.sessions[sandboxID]
	merged := make(map[string]*StoredCredential, len(r.system)+len(session))
	for ref, cred := range r.system {
		merged[ref] = cred
	}
	for ref, cred := range session {
		merged[ref] = cred
	}
	return merged
}

// LenFor returns the number of distinct effective credential refs visible to
// sandboxID (system tier merged with that session's tier).
func (r *Resolver) LenFor(sandboxID string) int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.effectiveCredsLocked(sandboxID))
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

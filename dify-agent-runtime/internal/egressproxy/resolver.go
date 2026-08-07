// Package egressproxy implements the in-process egress proxy that runs inside
// the sandbox. It intercepts all outbound HTTP/HTTPS requests and proactively
// injects credentials based on domain-matching policies (see package
// providers).
package egressproxy

import (
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/langgenius/dify/dify-agent-runtime/internal/providers"
)

// StoredCredential holds a credential's value and optional injection policy.
// Value is interpreted by the Inject policy: simple.Policy expects a string
// (or JSON string), aws.Policy expects a structured object (see aws.Credentials).
type StoredCredential struct {
	Value  any
	Inject providers.Policy
}

// Resolver is a thread-safe credential store scoped by sandbox session.
// It supports proactive header injection based on domain-matching policies.
//
// Credentials live in two independent tiers:
//
//   - system holds credentials seeded once at startup (see
//     LoadCredentialManifest). It is set via SetSystemCredentials and is
//     never touched by session operations.
//   - sessions holds one independent credential set per session_id, set via
//     SetSessionCredentials (from PUT /v1/prepare). Writing session N's
//     credentials never touches session M's map or the system tier — there
//     is no shared mutable state across sandbox sessions.
//
// Every lookup is scoped to a sessionID: it checks that session's map first
// and falls back to the system tier. An empty sessionID (no session
// identified) only ever sees the system tier.
type Resolver struct {
	mu       sync.RWMutex
	system   map[string]*StoredCredential            // key: "provider/name"
	sessions map[string]map[string]*StoredCredential // key: sessionID -> "provider/name"
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
// identified by sessionID.
func (r *Resolver) SetSessionCredentials(sessionID string, creds map[string]*StoredCredential) {
	if creds == nil {
		creds = make(map[string]*StoredCredential)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[sessionID] = creds
}

// ClearSession removes a sandbox session's credentials.
func (r *Resolver) ClearSession(sessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.sessions, sessionID)
}

// ResolveFor returns the effective credential for ref within sessionID's
// session, falling back to the system tier, or nil if neither has it. An
// empty sessionID only ever resolves against the system tier.
func (r *Resolver) ResolveFor(sessionID, ref string) *StoredCredential {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if sessionID != "" {
		if session, ok := r.sessions[sessionID]; ok {
			if cred, ok := session[ref]; ok {
				return cred
			}
		}
	}
	return r.system[ref]
}

// InjectHeadersFor proactively injects credential-derived headers into the
// request based on domain-matching injection policies, using the effective
// credential set for sessionID (session merged over system).
func (r *Resolver) InjectHeadersFor(sessionID string, req *http.Request) {
	host := req.URL.Hostname()
	if host == "" {
		host = req.Host
	}
	if idx := strings.LastIndex(host, ":"); idx >= 0 {
		host = host[:idx]
	}

	r.mu.RLock()
	defer r.mu.RUnlock()
	for ref, cred := range r.effectiveCredsLocked(sessionID) {
		if cred.Inject == nil {
			continue
		}
		if !matchesDomain(host, cred.Inject.Domains()) {
			continue
		}
		if err := cred.Inject.Apply(req, cred.Value); err != nil {
			log.Printf("egressproxy: inject credential %q (session=%q): %v", ref, sessionID, err)
		}
	}
}

// effectiveCredsLocked returns the merged view of the system tier and
// sessionID's session tier, with the session shadowing the system tier
// under the same ref. Callers must hold r.mu (read or write lock).
func (r *Resolver) effectiveCredsLocked(sessionID string) map[string]*StoredCredential {
	session := r.sessions[sessionID]
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
// sessionID (system tier merged with that session's tier).
func (r *Resolver) LenFor(sessionID string) int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.effectiveCredsLocked(sessionID))
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

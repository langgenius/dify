package proxy

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// ── Audit Event ───────────────────────────────────────────────

// AuditEvent is logged for every injection or rejection.
type AuditEvent struct {
	Provider     string `json:"provider"`
	Env          string `json:"env"`
	TargetDomain string `json:"target_domain"`
	Header       string `json:"header,omitempty"`
	Action       string `json:"action"` // "injected", "rejected", "stripped"
	Reason       string `json:"reason,omitempty"`
}

// ── Handler ───────────────────────────────────────────────────

// InjectionHandler is an http.Handler that resolves placeholder
// secrets at the network boundary.
type InjectionHandler struct {
	Config      *InjectionConfig
	SecretRoot  string // e.g. "/run/secrets/session-1"
	Next        http.Handler
}

// ServeHTTP implements http.Handler.
func (h *InjectionHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Config == nil || len(h.Config.Providers) == 0 {
		h.Next.ServeHTTP(w, r)
		return
	}

	targetHost := hostFromRequest(r)
	if targetHost == "" {
		h.Next.ServeHTTP(w, r)
		return
	}

	// Iterate providers to find matching secrets.
	for _, profile := range h.Config.Providers {
		for _, secret := range profile.Secrets {
			placeholder := Placeholder(profile.Name, secret.Env)

			// Check if the request carries the placeholder in any header.
			injected := false
			for headerName, headerValues := range r.Header {
				for _, v := range headerValues {
					if v == placeholder {
						if secret.Inject.MatchesDomain(targetHost) {
							realValue, err := h.readSecret(secret.ValueFile)
							if err != nil {
								h.audit(AuditEvent{
									Provider:     profile.Name,
									Env:          secret.Env,
									TargetDomain: targetHost,
									Action:       "rejected",
									Reason:       fmt.Sprintf("secret read error: %v", err),
								})
								http.Error(w,
									fmt.Sprintf(`{"error":"secret_unavailable","provider":"%s","env":"%s"}`,
										profile.Name, secret.Env),
									http.StatusInternalServerError,
								)
								return
							}

							resolved := secret.Inject.ResolveValue(realValue)
							r.Header.Set(headerName, resolved)

							h.audit(AuditEvent{
								Provider:     profile.Name,
								Env:          secret.Env,
								TargetDomain: targetHost,
								Header:       secret.Inject.Header,
								Action:       "injected",
							})
							injected = true
						} else {
							// Secret referenced but domain not allowlisted →
							// structured rejection (no silent-strip).
							h.audit(AuditEvent{
								Provider:     profile.Name,
								Env:          secret.Env,
								TargetDomain: targetHost,
								Action:       "rejected",
								Reason: fmt.Sprintf("domain %q not in allowlist",
									targetHost),
							})
							http.Error(w,
								fmt.Sprintf(`{"error":"domain_not_allowed","provider":"%s","env":"%s","domain":"%s"}`,
									profile.Name, secret.Env, targetHost),
								http.StatusForbidden,
							)
							return
						}
					}
				}
			}

			// Also check the Authorization header directly (common case).
			if !injected {
				authHeader := r.Header.Get("Authorization")
				if strings.Contains(authHeader, placeholder) {
					if secret.Inject.MatchesDomain(targetHost) {
						realValue, err := h.readSecret(secret.ValueFile)
						if err != nil {
							h.audit(AuditEvent{
								Provider:     profile.Name,
								Env:          secret.Env,
								TargetDomain: targetHost,
								Action:       "rejected",
								Reason:       fmt.Sprintf("secret read error: %v", err),
							})
							http.Error(w,
								fmt.Sprintf(`{"error":"secret_unavailable","provider":"%s","env":"%s"}`,
									profile.Name, secret.Env),
								http.StatusInternalServerError,
							)
							return
						}
						resolved := secret.Inject.ResolveValue(realValue)
						r.Header.Set(secret.Inject.Header, resolved)

						h.audit(AuditEvent{
							Provider:     profile.Name,
							Env:          secret.Env,
							TargetDomain: targetHost,
							Header:       secret.Inject.Header,
							Action:       "injected",
						})
					} else {
						h.audit(AuditEvent{
							Provider:     profile.Name,
							Env:          secret.Env,
							TargetDomain: targetHost,
							Action:       "rejected",
							Reason: fmt.Sprintf("domain %q not in allowlist",
								targetHost),
						})
						http.Error(w,
							fmt.Sprintf(`{"error":"domain_not_allowed","provider":"%s","env":"%s","domain":"%s"}`,
								profile.Name, secret.Env, targetHost),
							http.StatusForbidden,
						)
						return
					}
				}
			}
		}
	}

	h.Next.ServeHTTP(w, r)
}

// readSecret reads the real secret from the value file.
func (h *InjectionHandler) readSecret(valueFile string) (string, error) {
	// Prevent path traversal.
	if strings.Contains(valueFile, "..") {
		return "", fmt.Errorf("invalid value_file path (contains '..'): %s", valueFile)
	}
	path := h.SecretRoot + "/" + valueFile
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	return strings.TrimSpace(string(data)), nil
}

// audit emits one structured audit event.
func (h *InjectionHandler) audit(e AuditEvent) {
	slog.Info("secret_injection",
		"provider", e.Provider,
		"env", e.Env,
		"target_domain", e.TargetDomain,
		"header", e.Header,
		"action", e.Action,
		"reason", e.Reason,
	)
}

// ── Helpers ───────────────────────────────────────────────────

// hostFromRequest extracts the target host from an HTTP request.
// Prefer the Host header; fall back to URL.Host for CONNECT.
func hostFromRequest(r *http.Request) string {
	if r.Host != "" {
		h, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			// Host header may not include port.
			return r.Host
		}
		return h
	}
	if r.URL != nil {
		return r.URL.Hostname()
	}
	return ""
}

// ── RoundTripper (for use as an http.Transport wrapper) ────────

// InjectionRoundTripper wraps an http.RoundTripper to add
// placeholder resolution at the transport layer.  Use this when
// you need to integrate with an existing http.Client rather than
// running a separate proxy server.
type InjectionRoundTripper struct {
	Config     *InjectionConfig
	SecretRoot string
	Next       http.RoundTripper
}

// RoundTrip implements http.RoundTripper.
func (t *InjectionRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	if t.Config == nil {
		return t.Next.RoundTrip(r)
	}

	targetHost := hostFromRequest(r)
	if targetHost == "" {
		return t.Next.RoundTrip(r)
	}

	for _, profile := range t.Config.Providers {
		for _, secret := range profile.Secrets {
			placeholder := Placeholder(profile.Name, secret.Env)

			// Scan all headers for the placeholder.
			for headerName, headerValues := range r.Header {
				for _, v := range headerValues {
					if v != placeholder {
						continue
					}
					if !secret.Inject.MatchesDomain(targetHost) {
						return nil, &url.Error{
							Op:  "proxy",
							URL: r.URL.String(),
							Err: fmt.Errorf(
								"secret injection rejected: provider=%q env=%q domain=%q not in allowlist",
								profile.Name, secret.Env, targetHost,
							),
						}
					}
					realValue, err := readSecretFile(t.SecretRoot, secret.ValueFile)
					if err != nil {
						return nil, fmt.Errorf("secret injection: %w", err)
					}
					r.Header.Set(headerName, secret.Inject.ResolveValue(realValue))

					slog.Info("secret_injection",
						"provider", profile.Name,
						"env", secret.Env,
						"target_domain", targetHost,
						"action", "injected",
					)
				}
			}
		}
	}

	return t.Next.RoundTrip(r)
}

func readSecretFile(root, valueFile string) (string, error) {
	if strings.Contains(valueFile, "..") {
		return "", fmt.Errorf("invalid value_file path: %s", valueFile)
	}
	data, err := os.ReadFile(root + "/" + valueFile)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

// StripSecretsFromEnv removes all provider secrets from env and
// replaces them with placeholders.  Returns the modified env slice.
func (c *InjectionConfig) StripSecretsFromEnv(env []string) []string {
	// Build a set of env names that are secrets.
	secretNames := make(map[string]bool)
	for _, p := range c.Providers {
		for _, s := range p.Secrets {
			secretNames[s.Env] = true
		}
	}

	seen := make(map[string]bool)
	var result []string
	for _, e := range env {
		name, _, _ := strings.Cut(e, "=")
		if secretNames[name] {
			if !seen[name] {
				// Find the provider for this env.
				for _, p := range c.Providers {
					for _, s := range p.Secrets {
						if s.Env == name {
							result = append(result,
								fmt.Sprintf("%s=%s", name, Placeholder(p.Name, name)))
							seen[name] = true
							break
						}
					}
				}
			}
		} else {
			result = append(result, e)
		}
	}
	return result
}

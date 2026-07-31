// Package simple implements the "simple-header" credential injection policy:
// it renders a single HTTP header from a Go text/template evaluated against
// the credential value.
package simple

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"text/template"
)

// Policy injects a single HTTP header on requests matching Domains. The
// header value is rendered from Expr, a Go text/template evaluated with the
// resolved credential value available as {{.Value}} (for string values) or
// as individual fields (for structured values decoded from JSON, e.g.
// {{.AccessKeyID}}).
type Policy struct {
	HeaderName string
	Domains_   []string // wildcard-capable domain patterns; empty = all
	Expr       string   // Go text/template rendered with the value

	tmplOnce sync.Once
	tmpl     *template.Template
	tmplErr  error
}

// Compile-time assertion that Policy implements providers.Policy.
var _ interface {
	Domains() []string
	Apply(*http.Request, any) error
} = (*Policy)(nil)

// Domains returns the domain-match patterns for this policy.
func (p *Policy) Domains() []string { return p.Domains_ }

// Apply renders the template and sets the header on req.
func (p *Policy) Apply(req *http.Request, value any) error {
	rendered, err := p.render(value)
	if err != nil {
		return err
	}
	req.Header.Set(p.HeaderName, rendered)
	return nil
}

// compile lazily parses Expr into a template, caching the result (or error).
func (p *Policy) compile() (*template.Template, error) {
	p.tmplOnce.Do(func() {
		p.tmpl, p.tmplErr = template.New("simple-header").Parse(p.Expr)
	})
	return p.tmpl, p.tmplErr
}

// render evaluates Expr against the given credential value. The value may be
// a plain string (exposed as {{.Value}}) or a structured value decoded from
// JSON (exposed as its fields, e.g. {{.AccessKeyID}}).
func (p *Policy) render(value any) (string, error) {
	tmpl, err := p.compile()
	if err != nil {
		return "", fmt.Errorf("parse expr %q: %w", p.Expr, err)
	}
	var buf bytes.Buffer
	data := templateData(value)
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("render expr %q: %w", p.Expr, err)
	}
	return buf.String(), nil
}

// templateData converts a credential value into a form suitable for Go
// text/template execution. A string value is wrapped as {.Value: s}; a
// map[string]any or json.RawMessage is decoded so individual fields are
// accessible directly (e.g. {{.AccessKeyID}}) and also via {{.Value}} if
// present.
func templateData(value any) any {
	switch v := value.(type) {
	case string:
		return struct{ Value string }{Value: v}
	case json.RawMessage:
		var m map[string]any
		if err := json.Unmarshal(v, &m); err != nil {
			// Fall back to string.
			var s string
			if err2 := json.Unmarshal(v, &s); err2 == nil {
				return struct{ Value string }{Value: s}
			}
			return struct{ Value string }{Value: string(v)}
		}
		return m
	case map[string]any:
		return v
	default:
		return struct{ Value string }{Value: fmt.Sprint(v)}
	}
}

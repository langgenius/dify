package simple

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestPolicyApplyStringValue(t *testing.T) {
	p := &Policy{
		HeaderName: "Authorization",
		Expr:       "Bearer {{.Value}}",
	}
	req, _ := http.NewRequest("GET", "https://example.com", nil)
	if err := p.Apply(req, "mytoken"); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if got := req.Header.Get("Authorization"); got != "Bearer mytoken" {
		t.Errorf("got %q, want %q", got, "Bearer mytoken")
	}
}

func TestPolicyApplyJSONStringValue(t *testing.T) {
	p := &Policy{
		HeaderName: "X-Api-Key",
		Expr:       "{{.Value}}",
	}
	req, _ := http.NewRequest("GET", "https://example.com", nil)
	// Value is a JSON string literal.
	val, _ := json.Marshal("sk-abc")
	if err := p.Apply(req, json.RawMessage(val)); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if got := req.Header.Get("X-Api-Key"); got != "sk-abc" {
		t.Errorf("got %q, want %q", got, "sk-abc")
	}
}

func TestPolicyApplyStructuredValue(t *testing.T) {
	p := &Policy{
		HeaderName: "Authorization",
		Expr:       "Bearer {{.access_key_id}}",
	}
	req, _ := http.NewRequest("GET", "https://example.com", nil)
	val := json.RawMessage(`{"access_key_id":"AKIA123","secret_access_key":"secret"}`)
	if err := p.Apply(req, val); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if got := req.Header.Get("Authorization"); got != "Bearer AKIA123" {
		t.Errorf("got %q, want %q", got, "Bearer AKIA123")
	}
}

func TestPolicyApplyDefaultExpr(t *testing.T) {
	p := &Policy{
		HeaderName: "X-Token",
		Expr:       "",
	}
	req, _ := http.NewRequest("GET", "https://example.com", nil)
	// Empty expr → template parses as empty, header set to empty.
	if err := p.Apply(req, "val"); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if got := req.Header.Get("X-Token"); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestPolicyApplyBadExpr(t *testing.T) {
	p := &Policy{
		HeaderName: "X-Token",
		Expr:       "{{.Value", // malformed template
	}
	req, _ := http.NewRequest("GET", "https://example.com", nil)
	if err := p.Apply(req, "val"); err == nil {
		t.Fatal("expected error for malformed template")
	}
}

func TestPolicyDomains(t *testing.T) {
	p := &Policy{
		Domains_: []string{"*.example.com"},
	}
	if got := p.Domains(); len(got) != 1 || got[0] != "*.example.com" {
		t.Errorf("Domains() = %v, want [*.example.com]", got)
	}
}

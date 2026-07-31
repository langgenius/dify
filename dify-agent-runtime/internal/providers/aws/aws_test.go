package aws

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func validCredsJSON() json.RawMessage {
	return json.RawMessage(`{"access_key_id":"AKIAIOSFODNN7EXAMPLE","secret_access_key":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}`)
}

func validCredsWithTokenJSON() json.RawMessage {
	return json.RawMessage(`{"access_key_id":"AKIAIOSFODNN7EXAMPLE","secret_access_key":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY","session_token":"tok123"}`)
}

func TestPolicyApplySignsRequest(t *testing.T) {
	p := &Policy{Service: "s3"}
	req, _ := http.NewRequest("GET", "https://s3.us-east-1.amazonaws.com/bucket/key", nil)

	if err := p.Apply(req, validCredsJSON()); err != nil {
		t.Fatalf("Apply: %v", err)
	}

	auth := req.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 ") {
		t.Errorf("expected AWS4-HMAC-SHA256 Authorization, got %q", auth)
	}
	if req.Header.Get("X-Amz-Date") == "" {
		t.Error("expected X-Amz-Date to be set")
	}
	if req.Header.Get("X-Amz-Content-Sha256") == "" {
		t.Error("expected X-Amz-Content-Sha256 to be set")
	}
}

func TestPolicyApplyStripsClientHeaders(t *testing.T) {
	p := &Policy{Service: "s3"}
	req, _ := http.NewRequest("GET", "https://s3.us-east-1.amazonaws.com/bucket/key", nil)
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential=FAKE/...")
	req.Header.Set("X-Amz-Date", "20260101T000000Z")
	req.Header.Set("X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD")
	req.Header.Set("X-Amz-Security-Token", "faketoken")

	if err := p.Apply(req, validCredsJSON()); err != nil {
		t.Fatalf("Apply: %v", err)
	}

	auth := req.Header.Get("Authorization")
	if strings.Contains(auth, "FAKE") {
		t.Errorf("fake Authorization not stripped: %q", auth)
	}
	// X-Amz-Security-Token should be absent (creds have no session token).
	if got := req.Header.Get("X-Amz-Security-Token"); got == "faketoken" {
		t.Error("fake X-Amz-Security-Token not stripped")
	}
}

func TestPolicyApplySessionToken(t *testing.T) {
	p := &Policy{Service: "s3"}
	req, _ := http.NewRequest("GET", "https://s3.us-east-1.amazonaws.com/bucket/key", nil)

	if err := p.Apply(req, validCredsWithTokenJSON()); err != nil {
		t.Fatalf("Apply: %v", err)
	}

	if got := req.Header.Get("X-Amz-Security-Token"); got != "tok123" {
		t.Errorf("expected X-Amz-Security-Token=tok123, got %q", got)
	}
}

func TestPolicyApplyNoSessionToken(t *testing.T) {
	p := &Policy{Service: "s3"}
	req, _ := http.NewRequest("GET", "https://s3.us-east-1.amazonaws.com/bucket/key", nil)

	if err := p.Apply(req, validCredsJSON()); err != nil {
		t.Fatalf("Apply: %v", err)
	}

	if got := req.Header.Get("X-Amz-Security-Token"); got != "" {
		t.Errorf("expected no X-Amz-Security-Token, got %q", got)
	}
}

func TestPolicyApplyBodyReplay(t *testing.T) {
	p := &Policy{Service: "s3"}
	body := "hello world"
	req, _ := http.NewRequest("PUT", "https://s3.us-east-1.amazonaws.com/bucket/key", strings.NewReader(body))
	// Signed body mode: client provides a hex hash.
	req.Header.Set("X-Amz-Content-Sha256", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

	if err := p.Apply(req, validCredsJSON()); err != nil {
		t.Fatalf("Apply: %v", err)
	}

	// Body should still be readable.
	read, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if string(read) != body {
		t.Errorf("body not replayed: got %q, want %q", read, body)
	}

	// X-Amz-Content-Sha256 should be recomputed, not the client's fake value.
	sha := req.Header.Get("X-Amz-Content-Sha256")
	if sha == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Error("expected recomputed hash, got client's fake value")
	}
	if len(sha) != 64 {
		t.Errorf("expected 64-char hex hash, got %d chars: %q", len(sha), sha)
	}
}

func TestPolicyApplyUnsignedPayload(t *testing.T) {
	p := &Policy{Service: "s3"}
	req, _ := http.NewRequest("GET", "https://s3.us-east-1.amazonaws.com/bucket/key", nil)
	// No X-Amz-Content-Sha256 → defaults to UNSIGNED-PAYLOAD.

	if err := p.Apply(req, validCredsJSON()); err != nil {
		t.Fatalf("Apply: %v", err)
	}

	sha := req.Header.Get("X-Amz-Content-Sha256")
	if sha != "UNSIGNED-PAYLOAD" {
		t.Errorf("expected UNSIGNED-PAYLOAD, got %q", sha)
	}
}

func TestPolicyApplyRejectsChunkSignedStreaming(t *testing.T) {
	p := &Policy{Service: "s3"}
	req, _ := http.NewRequest("PUT", "https://s3.us-east-1.amazonaws.com/bucket/key", strings.NewReader("body"))
	req.Header.Set("X-Amz-Content-Sha256", "STREAMING-AWS4-HMAC-SHA256-PAYLOAD")

	if err := p.Apply(req, validCredsJSON()); err == nil {
		t.Fatal("expected error for chunk-signed streaming mode")
	}
}

func TestPolicyApplyExplicitRegion(t *testing.T) {
	p := &Policy{Service: "s3", Region: "eu-west-1"}
	req, _ := http.NewRequest("GET", "https://custom.endpoint.example.com/bucket/key", nil)

	if err := p.Apply(req, validCredsJSON()); err != nil {
		t.Fatalf("Apply: %v", err)
	}

	auth := req.Header.Get("Authorization")
	if !strings.Contains(auth, "eu-west-1") {
		t.Errorf("expected region eu-west-1 in Authorization, got %q", auth)
	}
}

func TestPolicyApplyR2Region(t *testing.T) {
	p := &Policy{Service: "s3"}
	req, _ := http.NewRequest("GET", "https://abc123.r2.cloudflarestorage.com/bucket/key", nil)

	if err := p.Apply(req, validCredsJSON()); err != nil {
		t.Fatalf("Apply: %v", err)
	}

	auth := req.Header.Get("Authorization")
	if !strings.Contains(auth, "auto") {
		t.Errorf("expected region 'auto' for R2, got %q", auth)
	}
}

func TestPolicyApplyFailsWithoutRegion(t *testing.T) {
	p := &Policy{Service: "s3"}
	req, _ := http.NewRequest("GET", "https://custom.endpoint.example.com/bucket/key", nil)

	if err := p.Apply(req, validCredsJSON()); err == nil {
		t.Fatal("expected error when region cannot be extracted")
	}
}

func TestPolicyApplyInvalidCreds(t *testing.T) {
	p := &Policy{Service: "s3"}
	req, _ := http.NewRequest("GET", "https://s3.us-east-1.amazonaws.com/bucket/key", nil)

	// Missing secret_access_key.
	badCreds := json.RawMessage(`{"access_key_id":"AKIA123"}`)
	if err := p.Apply(req, badCreds); err == nil {
		t.Fatal("expected error for missing secret_access_key")
	}
}

func TestPolicyApplyStringCredsRejected(t *testing.T) {
	p := &Policy{Service: "s3"}
	req, _ := http.NewRequest("GET", "https://s3.us-east-1.amazonaws.com/bucket/key", nil)

	// A plain string is not valid for SigV4.
	if err := p.Apply(req, "justastring"); err == nil {
		t.Fatal("expected error for string credential value")
	}
}

func TestPolicyDomains(t *testing.T) {
	p := &Policy{Domains_: []string{"*.s3.amazonaws.com"}}
	if got := p.Domains(); len(got) != 1 || got[0] != "*.s3.amazonaws.com" {
		t.Errorf("Domains() = %v, want [*.s3.amazonaws.com]", got)
	}
}

func TestDecodeCredentialsFromMap(t *testing.T) {
	m := map[string]any{
		"access_key_id":     "AKIA123",
		"secret_access_key": "secret",
	}
	c, err := DecodeCredentials(m)
	if err != nil {
		t.Fatalf("DecodeCredentials: %v", err)
	}
	if c.AccessKeyID != "AKIA123" || c.SecretAccessKey != "secret" {
		t.Errorf("got %+v", c)
	}
}

func TestDecodeCredentialsMissingFields(t *testing.T) {
	m := map[string]any{"access_key_id": "AKIA123"}
	if _, err := DecodeCredentials(m); err == nil {
		t.Fatal("expected error for missing secret_access_key")
	}
}

func TestExtractRegionFromHost(t *testing.T) {
	cases := []struct {
		host string
		want string
		err  bool
	}{
		{"s3.us-east-1.amazonaws.com", "us-east-1", false},
		{"s3-us-west-2.amazonaws.com", "us-west-2", false},
		{"abc123.r2.cloudflarestorage.com", "auto", false},
		{"custom.example.com", "", true},
	}
	for _, tc := range cases {
		got, err := ExtractRegionFromHost(tc.host)
		if tc.err {
			if err == nil {
				t.Errorf("ExtractRegionFromHost(%q): expected error, got %q", tc.host, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("ExtractRegionFromHost(%q): unexpected error: %v", tc.host, err)
			continue
		}
		if got != tc.want {
			t.Errorf("ExtractRegionFromHost(%q): got %q, want %q", tc.host, got, tc.want)
		}
	}
}

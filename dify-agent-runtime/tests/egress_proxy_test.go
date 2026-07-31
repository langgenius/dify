//go:build integration

// This file verifies the egress proxy's credential injection against a real
// container: a dedicated dify-agent-runtime container (SHELLCTL_EGRESSPROXY_ENABLED=true,
// HTTP(S)_PROXY pointed at the in-process MITM proxy) plus an echo backend
// reachable only from inside that container's docker network as "echo-backend".
// A job script issues a real outbound curl request; the echo backend reflects
// back the headers it received, which we assert against to prove the proxy
// actually injected credentials over the wire.
//
// Provisioned by `make integration-up` (see Makefile) and exercised via
// `make integration-test` / `make integration`.
package tests

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"testing"
)

var (
	egressGoURL     = os.Getenv("SHELLCTL_EGRESS_GO_URL")
	egressAuthToken = os.Getenv("SHELLCTL_EGRESS_TEST_TOKEN")

	// egressUpstreamGoURL/egressUpstreamAuthToken target a second runtime
	// container whose SHELLCTL_EGRESSPROXY_UPSTREAM points at a squid
	// container ("squid-upstream"), verifying that the credproxy correctly
	// chains through an upstream forward proxy to reach the real destination.
	egressUpstreamGoURL     = os.Getenv("SHELLCTL_EGRESS_UPSTREAM_GO_URL")
	egressUpstreamAuthToken = os.Getenv("SHELLCTL_EGRESS_UPSTREAM_TEST_TOKEN")
)

func egressTarget() (target, bool) {
	if egressGoURL == "" {
		return target{}, false
	}
	return target{name: "go-egress", baseURL: egressGoURL}, true
}

func egressUpstreamTarget() (target, bool) {
	if egressUpstreamGoURL == "" {
		return target{}, false
	}
	return target{name: "go-egress-upstream", baseURL: egressUpstreamGoURL}, true
}

// doPutWithToken issues a PUT request with a bearer token, mirroring doPost's
// shape but for the PUT /v1/prepare endpoint.
func doPutWithToken(t *testing.T, tgt target, token, path string, payload map[string]any) *http.Response {
	t.Helper()
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPut, tgt.baseURL+path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatalf("[%s] PUT %s failed: %v", tgt.name, path, err)
	}
	return resp
}

// TestEgressProxyCredentialInjection verifies that a credential registered via
// PUT /v1/prepare with a domain-scoped http-header injection rule is actually
// injected into an outbound request made by a job script, by round-tripping
// through the real in-process MITM egress proxy to an echo backend.
func TestEgressProxyCredentialInjection(t *testing.T) {
	tgt, ok := egressTarget()
	if !ok {
		t.Skip("SHELLCTL_EGRESS_GO_URL not set; egress proxy container not available")
	}

	const sandboxID = "sandbox-credential-injection"
	prepareResp := doPutWithToken(t, tgt, egressAuthToken, "/v1/prepare", map[string]any{
		"sandbox_id": sandboxID,
		"credentials": []map[string]any{
			{
				"provider": "testprovider",
				"name":     "apikey",
				"value":    "sk-integration-test-secret",
				"inject": map[string]any{
					"type": "http-header",
					"config": map[string]any{
						"name":    "Authorization",
						"expr":    "Bearer {{.Value}}",
						"domains": []string{"echo-backend"},
					},
				},
			},
		},
	})
	assertStatus(t, prepareResp, 200)
	readBody(t, prepareResp)

	result := runJobWithToken(t, tgt, egressAuthToken, map[string]any{
		"script":     "curl -s http://echo-backend:8080/",
		"timeout":    15,
		"sandbox_id": sandboxID,
	})
	assertJobDone(t, result)
	assertExitCode(t, result, 0)

	output := result["output"].(string)
	var echoed map[string]any
	if err := json.Unmarshal([]byte(output), &echoed); err != nil {
		t.Fatalf("failed to parse echo backend response: %v\noutput: %s", err, output)
	}
	headers, ok := echoed["headers"].(map[string]any)
	if !ok {
		t.Fatalf("echo response missing headers: %s", output)
	}
	auth, _ := headers["authorization"].(string)
	if auth != "Bearer sk-integration-test-secret" {
		t.Errorf("expected injected Authorization header, got %q (full output: %s)", auth, output)
	}
}

// TestEgressProxyCredentialNotInjectedForNonMatchingDomain verifies that
// injection rules are scoped to their configured domains and are not applied
// to unrelated destinations.
//
// NOTE: credentials registered via /v1/prepare persist for the lifetime of
// the container and are never cleared between tests (this mirrors production
// behavior: a job's credentials remain registered for the sandbox's life).
// To keep this test order-independent from other tests in this file that
// also register "Authorization" injection rules for "echo-backend", this
// test uses a header name unique to itself ("X-Scoped-Test") rather than
// asserting on "Authorization", which other tests may have already caused to
// be injected for echo-backend by the time this test runs.
func TestEgressProxyCredentialNotInjectedForNonMatchingDomain(t *testing.T) {
	tgt, ok := egressTarget()
	if !ok {
		t.Skip("SHELLCTL_EGRESS_GO_URL not set; egress proxy container not available")
	}

	const sandboxID = "sandbox-non-matching-domain"
	prepareResp := doPutWithToken(t, tgt, egressAuthToken, "/v1/prepare", map[string]any{
		"sandbox_id": sandboxID,
		"credentials": []map[string]any{
			{
				"provider": "testprovider",
				"name":     "scoped",
				"value":    "sk-should-not-leak",
				"inject": map[string]any{
					"type": "http-header",
					"config": map[string]any{
						"name":    "X-Scoped-Test",
						"expr":    "Bearer {{.Value}}",
						"domains": []string{"some-other-host.internal"},
					},
				},
			},
		},
	})
	assertStatus(t, prepareResp, 200)
	readBody(t, prepareResp)

	result := runJobWithToken(t, tgt, egressAuthToken, map[string]any{
		"script":     "curl -s http://echo-backend:8080/",
		"timeout":    15,
		"sandbox_id": sandboxID,
	})
	assertJobDone(t, result)
	assertExitCode(t, result, 0)

	output := result["output"].(string)
	var echoed map[string]any
	if err := json.Unmarshal([]byte(output), &echoed); err != nil {
		t.Fatalf("failed to parse echo backend response: %v\noutput: %s", err, output)
	}
	headers, _ := echoed["headers"].(map[string]any)
	if v, ok := headers["x-scoped-test"].(string); ok && v != "" {
		t.Errorf("X-Scoped-Test header should not be injected for non-matching domain, got %q", v)
	}
}

// TestEgressProxyUpstreamChaining verifies that when SHELLCTL_EGRESSPROXY_UPSTREAM
// is configured, the credproxy correctly tunnels the outbound connection
// through the upstream forward proxy (squid) to reach the real destination,
// and that credential injection still happens (it occurs in the credproxy's
// own HTTP interceptor before the request is handed to the upstream dialer,
// so it must be unaffected by upstream chaining).
//
// NOTE: this container shares a network with echo-backend directly, so this
// test alone does NOT prove hostname passthrough through the upstream chain
// (an attempt to test that at the Docker level, by isolating this container
// from echo-backend's network, hit an unrelated Docker networking pitfall —
// see the comment in the Makefile's integration-up target). Hostname
// passthrough is instead covered reliably, without any Docker networking
// involved, by TestProxyUpstreamChainingPreservesHostname in
// internal/egressproxy/proxy_test.go.
func TestEgressProxyUpstreamChaining(t *testing.T) {
	tgt, ok := egressUpstreamTarget()
	if !ok {
		t.Skip("SHELLCTL_EGRESS_UPSTREAM_GO_URL not set; upstream-chained egress proxy container not available")
	}

	const sandboxID = "sandbox-upstream-chaining"
	prepareResp := doPutWithToken(t, tgt, egressUpstreamAuthToken, "/v1/prepare", map[string]any{
		"sandbox_id": sandboxID,
		"credentials": []map[string]any{
			{
				"provider": "testprovider",
				"name":     "upstreamkey",
				"value":    "sk-upstream-chained-secret",
				"inject": map[string]any{
					"type": "http-header",
					"config": map[string]any{
						"name":    "Authorization",
						"expr":    "Bearer {{.Value}}",
						"domains": []string{"echo-backend"},
					},
				},
			},
		},
	})
	assertStatus(t, prepareResp, 200)
	readBody(t, prepareResp)

	// If the upstream chaining is broken (e.g. squid unreachable, CONNECT
	// rejected), this curl will fail and the job's exit code will be non-zero.
	result := runJobWithToken(t, tgt, egressUpstreamAuthToken, map[string]any{
		"script":     "curl -sf http://echo-backend:8080/",
		"timeout":    15,
		"sandbox_id": sandboxID,
	})
	assertJobDone(t, result)
	assertExitCode(t, result, 0)

	output := result["output"].(string)
	var echoed map[string]any
	if err := json.Unmarshal([]byte(output), &echoed); err != nil {
		t.Fatalf("failed to parse echo backend response (upstream chaining likely broken): %v\noutput: %s", err, output)
	}
	headers, ok := echoed["headers"].(map[string]any)
	if !ok {
		t.Fatalf("echo response missing headers: %s", output)
	}
	auth, _ := headers["authorization"].(string)
	if auth != "Bearer sk-upstream-chained-secret" {
		t.Errorf("expected credential injection to survive upstream chaining, got %q (full output: %s)", auth, output)
	}
}

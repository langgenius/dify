package egressproxy

import (
	"bufio"
	"crypto/tls"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sync"
	"testing"
)

// newTestProxy creates and starts a Proxy backed by a freshly generated CA,
// returning it along with the CA cert pool (for trusting the proxy's MITM
// leaf certs) and a cleanup function.
func newTestProxy(t *testing.T, resolver *Resolver, upstream string) (*Proxy, *x509.CertPool) {
	t.Helper()

	caFiles, err := GenerateCA(t.TempDir())
	if err != nil {
		t.Fatalf("GenerateCA: %v", err)
	}

	proxy, err := NewProxy(&Config{
		ListenAddr:    "127.0.0.1:0",
		UpstreamProxy: upstream,
		CACertPath:    caFiles.CertPath,
		CAKeyPath:     caFiles.KeyPath,
		Resolver:      resolver,
	})
	if err != nil {
		t.Fatalf("NewProxy: %v", err)
	}
	if err := proxy.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(proxy.Stop)

	caPEM, err := os.ReadFile(caFiles.CertPath)
	if err != nil {
		t.Fatalf("read CA cert: %v", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		t.Fatalf("failed to add CA cert to pool")
	}
	return proxy, pool
}

// clientThroughProxy builds an http.Client that routes through the given
// proxy and trusts caPool for TLS verification of MITM'd leaf certs.
func clientThroughProxy(t *testing.T, proxy *Proxy, caPool *x509.CertPool) *http.Client {
	t.Helper()
	proxyURL, err := url.Parse(proxy.ProxyURL())
	if err != nil {
		t.Fatalf("parse proxy url: %v", err)
	}
	return &http.Client{
		Transport: &http.Transport{
			Proxy:           http.ProxyURL(proxyURL),
			TLSClientConfig: &tls.Config{RootCAs: caPool},
		},
	}
}

// TestProxyHTTPCredentialInjection verifies plain-HTTP forward proxying
// injects credential headers per the Resolver's domain policy.
func TestProxyHTTPCredentialInjection(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Got-Auth", r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	resolver := NewResolver()
	resolver.SetSystemCredentials(map[string]*StoredCredential{
		"token": {
			Value: "s3cr3t",
			Inject: &CredentialInjectionPolicy{
				Type: SimpleHeader,
				SimpleHeader: &SimpleHeaderPolicy{
					HeaderName: "Authorization",
					Expr:       "Bearer {{.Value}}",
				},
			},
		},
	})

	proxy, caPool := newTestProxy(t, resolver, "")
	client := clientThroughProxy(t, proxy, caPool)

	resp, err := client.Get(backend.URL + "/x")
	if err != nil {
		t.Fatalf("GET through proxy: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if got := resp.Header.Get("X-Got-Auth"); got != "Bearer s3cr3t" {
		t.Fatalf("expected injected Authorization header %q, got %q", "Bearer s3cr3t", got)
	}
}

// TestProxyHTTPSMitmCredentialInjection verifies the proxy MITMs HTTPS
// CONNECT tunnels (decrypting, injecting credentials, and re-encrypting)
// rather than passing them through as opaque tunnels.
func TestProxyHTTPSMitmCredentialInjection(t *testing.T) {
	backend := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Got-Auth", r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	resolver := NewResolver()
	resolver.SetSystemCredentials(map[string]*StoredCredential{
		"token": {
			Value: "s3cr3t",
			Inject: &CredentialInjectionPolicy{
				Type: SimpleHeader,
				SimpleHeader: &SimpleHeaderPolicy{
					HeaderName: "Authorization",
					Expr:       "Bearer {{.Value}}",
				},
			},
		},
	})

	proxy, caPool := newTestProxy(t, resolver, "")

	// Trust the httptest TLS backend's self-signed cert for the proxy's own
	// outbound connection to it (this is a test-only wiring detail; in
	// production the proxy dials real destinations with normal cert
	// verification).
	proxy.handler.Tr.TLSClientConfig = &tls.Config{RootCAs: backend.Client().Transport.(*http.Transport).TLSClientConfig.RootCAs}

	client := clientThroughProxy(t, proxy, caPool)

	resp, err := client.Get(backend.URL + "/x")
	if err != nil {
		t.Fatalf("GET through proxy (MITM): %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if got := resp.Header.Get("X-Got-Auth"); got != "Bearer s3cr3t" {
		t.Fatalf("expected injected Authorization header %q, got %q", "Bearer s3cr3t", got)
	}
}

// TestProxyPlaceholderReplacement verifies __secret:provider/name__
// placeholders embedded in request headers are resolved.
func TestProxyPlaceholderReplacement(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Got-Custom", r.Header.Get("X-Custom"))
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	resolver := NewResolver()
	resolver.SetSystemCredentials(map[string]*StoredCredential{"myprovider/mysecret": {Value: "hunter2"}})

	proxy, caPool := newTestProxy(t, resolver, "")
	client := clientThroughProxy(t, proxy, caPool)

	req, err := http.NewRequest(http.MethodGet, backend.URL+"/x", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("X-Custom", "prefix-__secret:myprovider/mysecret__-suffix")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET through proxy: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if got, want := resp.Header.Get("X-Got-Custom"), "prefix-hunter2-suffix"; got != want {
		t.Fatalf("expected placeholder-resolved header %q, got %q", want, got)
	}
}

// fakeUpstreamCONNECTProxy is a minimal upstream proxy that only understands
// CONNECT. It records the literal, unmodified target string from each
// CONNECT request line, then blindly tunnels bytes to realBackendAddr
// regardless of what that target string was (which may not even be
// resolvable) — this is what an upstream like Squid would normally resolve
// and dial itself.
type fakeUpstreamCONNECTProxy struct {
	ln     net.Listener
	target string // realBackendAddr the tunnel is actually wired to

	mu          sync.Mutex
	seenTargets []string
}

func newFakeUpstreamCONNECTProxy(t *testing.T, realBackendAddr string) *fakeUpstreamCONNECTProxy {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	p := &fakeUpstreamCONNECTProxy{ln: ln, target: realBackendAddr}
	go p.serve(t)
	t.Cleanup(func() { _ = ln.Close() })
	return p
}

func (p *fakeUpstreamCONNECTProxy) Addr() string {
	return p.ln.Addr().String()
}

func (p *fakeUpstreamCONNECTProxy) recordedTargets() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]string, len(p.seenTargets))
	copy(out, p.seenTargets)
	return out
}

func (p *fakeUpstreamCONNECTProxy) serve(t *testing.T) {
	for {
		conn, err := p.ln.Accept()
		if err != nil {
			return
		}
		go p.handle(t, conn)
	}
}

func (p *fakeUpstreamCONNECTProxy) handle(t *testing.T, conn net.Conn) {
	defer func() { _ = conn.Close() }()

	br := bufio.NewReader(conn)
	req, err := http.ReadRequest(br)
	if err != nil {
		return
	}
	if req.Method != http.MethodConnect {
		_, _ = conn.Write([]byte("HTTP/1.1 405 Method Not Allowed\r\n\r\n"))
		return
	}

	// req.Host / req.RequestURI is the literal, verbatim CONNECT target
	// string as sent by the client — this is what we assert on. If the
	// caller (egressproxy.Proxy) had pre-resolved the hostname to an IP
	// before issuing CONNECT, this would observe an IP instead of the
	// original hostname.
	p.mu.Lock()
	p.seenTargets = append(p.seenTargets, req.Host)
	p.mu.Unlock()

	backendConn, err := net.Dial("tcp", p.target)
	if err != nil {
		_, _ = conn.Write([]byte("HTTP/1.1 502 Bad Gateway\r\n\r\n"))
		return
	}
	defer func() { _ = backendConn.Close() }()

	_, _ = conn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = io.Copy(backendConn, br)
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(conn, backendConn)
	}()
	wg.Wait()
}

// TestProxyUpstreamChainingPreservesHostname is a regression test for the
// bug that motivated migrating from mitmproxy-go to elazarl/goproxy:
// mitmproxy-go always resolved the destination hostname to an IP address in
// its own process before issuing CONNECT to the configured upstream proxy,
// which both discarded information the upstream needed for its own
// hostname-based ACLs/DNS view and broke entirely for hostnames this
// process itself couldn't resolve. goproxy instead forwards the literal,
// unresolved hostname string to the upstream via CONNECT, letting the
// upstream do its own resolution.
func TestProxyUpstreamChainingPreservesHostname(t *testing.T) {
	backend := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatalf("parse backend url: %v", err)
	}

	upstream := newFakeUpstreamCONNECTProxy(t, backendURL.Host)

	resolver := NewResolver()
	proxy, caPool := newTestProxy(t, resolver, "http://"+upstream.Addr())

	// The proxy's own outbound TLS handshake (after decrypting the MITM'd
	// tunnel) will use SNI/hostname verification against unresolvableHost
	// below, which intentionally does not match the backend's real
	// certificate (issued for 127.0.0.1/localhost) — skip verification here
	// since this test is only about hostname preservation through the
	// upstream CONNECT chain, not about end-to-end cert validation.
	proxy.handler.Tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}

	// Use a hostname that cannot be resolved by this test process at all.
	// If the proxy tried to resolve it locally before CONNECTing upstream
	// (the old mitmproxy-go bug), this request would fail outright.
	const unresolvableHost = "this-host-does-not-exist.invalid"
	_, port, err := net.SplitHostPort(backendURL.Host)
	if err != nil {
		t.Fatalf("split backend host:port: %v", err)
	}
	target := "https://" + unresolvableHost + ":" + port + "/x"

	client := clientThroughProxy(t, proxy, caPool)
	resp, err := client.Get(target)
	if err != nil {
		t.Fatalf("GET through proxy chained to upstream: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	seen := upstream.recordedTargets()
	if len(seen) != 1 {
		t.Fatalf("expected exactly 1 CONNECT to reach the upstream, got %d: %v", len(seen), seen)
	}
	wantTarget := unresolvableHost + ":" + port
	if seen[0] != wantTarget {
		t.Fatalf("upstream CONNECT target: got %q, want literal unresolved hostname %q", seen[0], wantTarget)
	}
}

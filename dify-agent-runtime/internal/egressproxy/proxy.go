package egressproxy

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/elazarl/goproxy"
)

// proxyAuthorizationHeader carries the session_id as Basic-Auth userinfo.
const proxyAuthorizationHeader = "Proxy-Authorization"

// validSessionIDPattern restricts session_id to the same charset/length
// enforced by the server's PrepareCredentials path, so a job cannot supply
// an out-of-contract session_id (e.g. extremely long, path-traversal-shaped)
// to the resolver. Matches server.validSessionIDPattern.
var validSessionIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

// errInvalidSessionID is returned when the Proxy-Authorization userinfo is
// present but does not parse into a valid session_id. Callers should reject
// the request with this error rather than silently proceeding.
var errInvalidSessionID = fmt.Errorf("invalid session_id in Proxy-Authorization")

// sessionIDFromProxyAuth extracts the session_id embedded as the username of
// a "Proxy-Authorization: Basic ..." header. Returns ("", nil) if the header
// is absent (no session scoping requested). Returns ("", errInvalidSessionID)
// if the header is present but malformed or fails validation. Validation
// prevents cross-session confusion / DoS via out-of-contract session IDs in
// the resolver maps.
func sessionIDFromProxyAuth(h http.Header) (string, error) {
	value := h.Get(proxyAuthorizationHeader)
	const prefix = "Basic "
	if value == "" {
		return "", nil
	}
	if !strings.HasPrefix(value, prefix) {
		return "", errInvalidSessionID
	}
	decoded, err := base64.StdEncoding.DecodeString(value[len(prefix):])
	if err != nil {
		return "", errInvalidSessionID
	}
	sessionID, _, _ := strings.Cut(string(decoded), ":")
	if !validSessionIDPattern.MatchString(sessionID) {
		return "", errInvalidSessionID
	}
	return sessionID, nil
}

const (
	// DefaultListenAddr is the loopback address for the MITM proxy.
	DefaultListenAddr = "127.0.0.1:18080"
)

// Proxy is the credential-injecting MITM forward proxy.
type Proxy struct {
	resolver *Resolver
	handler  *goproxy.ProxyHttpServer
	server   *http.Server
	addr     string
}

// Config holds configuration for the credential proxy.
type Config struct {
	// ListenAddr is the address to listen on (default: 127.0.0.1:18080).
	ListenAddr string

	// UpstreamProxy is the upstream HTTP proxy URL (e.g. http://agent_ssrf_proxy:3128).
	// If empty, the proxy connects directly to upstream servers.
	UpstreamProxy string

	// CACertPath is the path to the CA certificate for TLS interception.
	CACertPath string

	// CAKeyPath is the path to the CA private key for TLS interception.
	CAKeyPath string

	// Resolver is the credential resolver used for header injection.
	Resolver *Resolver
}

// NewProxy creates a new credential proxy but does not start it.
func NewProxy(cfg *Config) (*Proxy, error) {
	if cfg.Resolver == nil {
		return nil, fmt.Errorf("egressproxy: resolver is required")
	}
	if cfg.CACertPath == "" || cfg.CAKeyPath == "" {
		return nil, fmt.Errorf("egressproxy: CA cert and key paths are required")
	}

	addr := cfg.ListenAddr
	if addr == "" {
		addr = DefaultListenAddr
	}

	resolver := cfg.Resolver

	caCertPEM, err := os.ReadFile(cfg.CACertPath)
	if err != nil {
		return nil, fmt.Errorf("egressproxy: read CA cert: %w", err)
	}
	caKeyPEM, err := os.ReadFile(cfg.CAKeyPath)
	if err != nil {
		return nil, fmt.Errorf("egressproxy: read CA key: %w", err)
	}
	caCert, err := tls.X509KeyPair(caCertPEM, caKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("egressproxy: parse CA cert/key: %w", err)
	}

	px := goproxy.NewProxyHttpServer()
	px.Verbose = false
	px.Logger = log.New(log.Writer(), "egressproxy: goproxy: ", 0)
	px.CertStore = newMemCertStore()

	if cfg.UpstreamProxy != "" {
		log.Printf("egressproxy: using upstream proxy: %s", cfg.UpstreamProxy)
		upstreamURL, err := url.Parse(cfg.UpstreamProxy)
		if err != nil {
			return nil, fmt.Errorf("egressproxy: parse upstream proxy url: %w", err)
		}
		px.Tr.Proxy = http.ProxyURL(upstreamURL)
		px.ConnectDial = px.NewConnectDialToProxy(cfg.UpstreamProxy)
	} else {
		px.Tr.Proxy = nil
		px.ConnectDial = nil
	}

	mitmAction := &goproxy.ConnectAction{
		Action:    goproxy.ConnectMitm,
		TLSConfig: goproxy.TLSConfigFromCA(&caCert),
	}
	rejectAction := &goproxy.ConnectAction{Action: goproxy.ConnectReject}
	px.OnRequest().HandleConnectFunc(func(host string, ctx *goproxy.ProxyCtx) (*goproxy.ConnectAction, string) {
		sessionID, err := sessionIDFromProxyAuth(ctx.Req.Header)
		if err != nil {
			log.Printf("egressproxy: rejecting CONNECT %s: %v", host, err)
			return rejectAction, host
		}
		ctx.UserData = sessionID
		return mitmAction, host
	})

	px.OnRequest().DoFunc(makeInterceptor(resolver))
	px.OnResponse().DoFunc(makeResponseLogger())

	return &Proxy{
		resolver: resolver,
		handler:  px,
		addr:     addr,
	}, nil
}

// makeInterceptor returns a request handler that injects credential headers
// scoped to the session_id identified for the request. The
// Proxy-Authorization header is stripped before forwarding. Requests
// carrying an invalid session_id are rejected with 400.
func makeInterceptor(resolver *Resolver) func(req *http.Request, ctx *goproxy.ProxyCtx) (*http.Request, *http.Response) {
	return func(req *http.Request, ctx *goproxy.ProxyCtx) (*http.Request, *http.Response) {
		sessionID, _ := ctx.UserData.(string)
		if sessionID == "" {
			// HTTP (non-CONNECT) requests don't go through HandleConnectFunc;
			// re-extract and validate here.
			sid, err := sessionIDFromProxyAuth(req.Header)
			if err != nil {
				log.Printf("egressproxy: rejecting %s %s: %v", req.Method, req.URL.String(), err)
				return req, goproxy.NewResponse(req, goproxy.ContentTypeText, http.StatusBadRequest, "invalid session_id\n")
			}
			sessionID = sid
		}
		req.Header.Del(proxyAuthorizationHeader)

		log.Printf("egressproxy: interceptor: %s %s (host=%s, session=%q, effective_creds=%d)",
			req.Method, req.URL.String(), req.Host, sessionID, resolver.LenFor(sessionID))

		if resolver.LenFor(sessionID) == 0 {
			return req, nil
		}

		resolver.InjectHeadersFor(sessionID, req)

		return req, nil
	}
}

// makeResponseLogger logs the status of each forwarded response.
func makeResponseLogger() func(resp *http.Response, ctx *goproxy.ProxyCtx) *http.Response {
	return func(resp *http.Response, ctx *goproxy.ProxyCtx) *http.Response {
		if resp == nil || ctx.Req == nil {
			return resp
		}
		log.Printf("egressproxy: invoker ok: %s %s -> %d", ctx.Req.Method, ctx.Req.URL.String(), resp.StatusCode)
		return resp
	}
}

// Start begins serving the MITM proxy in a background goroutine.
// It returns once the listener is ready.
func (p *Proxy) Start() error {
	ln, err := net.Listen("tcp", p.addr)
	if err != nil {
		return fmt.Errorf("egressproxy: listen %s: %w", p.addr, err)
	}
	p.addr = ln.Addr().String()

	p.server = &http.Server{
		Handler: p.handler,
	}

	go func() {
		log.Printf("egressproxy: MITM proxy listening on %s", p.addr)
		if err := p.server.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("egressproxy: serve error: %v", err)
		}
	}()

	return nil
}

// Stop gracefully shuts down the proxy.
func (p *Proxy) Stop() {
	if p.server != nil {
		_ = p.server.Close()
	}
}

// Addr returns the actual listen address (useful when port 0 is used).
func (p *Proxy) Addr() string {
	return p.addr
}

// ProxyURL returns the proxy URL without session_id.
func (p *Proxy) ProxyURL() string {
	return "http://" + p.addr
}

// ProxyURLForSession returns the proxy URL with sessionID embedded as
// Basic-Auth userinfo. If sessionID is empty, equivalent to ProxyURL.
func (p *Proxy) ProxyURLForSession(sessionID string) string {
	if sessionID == "" {
		return p.ProxyURL()
	}
	u := url.URL{
		Scheme: "http",
		User:   url.UserPassword(sessionID, ""),
		Host:   p.addr,
	}
	return u.String()
}

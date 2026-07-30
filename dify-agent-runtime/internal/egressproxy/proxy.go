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
	"strings"

	"github.com/elazarl/goproxy"
)

// proxyAuthorizationHeader carries the sandbox_id as Basic-Auth userinfo.
const proxyAuthorizationHeader = "Proxy-Authorization"

// sandboxIDFromProxyAuth extracts the sandbox_id embedded as the username of
// a "Proxy-Authorization: Basic ..." header. Returns "" if absent or
// malformed.
func sandboxIDFromProxyAuth(h http.Header) string {
	value := h.Get(proxyAuthorizationHeader)
	const prefix = "Basic "
	if !strings.HasPrefix(value, prefix) {
		return ""
	}
	decoded, err := base64.StdEncoding.DecodeString(value[len(prefix):])
	if err != nil {
		return ""
	}
	sandboxID, _, _ := strings.Cut(string(decoded), ":")
	return sandboxID
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

	// Resolver is the credential resolver used for placeholder replacement.
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
	px.OnRequest().HandleConnectFunc(func(host string, ctx *goproxy.ProxyCtx) (*goproxy.ConnectAction, string) {
		ctx.UserData = sandboxIDFromProxyAuth(ctx.Req.Header)
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
// and resolves __secret:provider/name__ placeholders, scoped to the sandbox_id
// identified for the request. The Proxy-Authorization header is stripped before
// forwarding.
func makeInterceptor(resolver *Resolver) func(req *http.Request, ctx *goproxy.ProxyCtx) (*http.Request, *http.Response) {
	return func(req *http.Request, ctx *goproxy.ProxyCtx) (*http.Request, *http.Response) {
		sandboxID, _ := ctx.UserData.(string)
		if sandboxID == "" {
			sandboxID = sandboxIDFromProxyAuth(req.Header)
		}
		req.Header.Del(proxyAuthorizationHeader)

		log.Printf("egressproxy: interceptor: %s %s (host=%s, sandbox=%q, effective_creds=%d)",
			req.Method, req.URL.String(), req.Host, sandboxID, resolver.LenFor(sandboxID))

		if resolver.LenFor(sandboxID) == 0 {
			return req, nil
		}

		resolver.InjectHeadersFor(sandboxID, req)

		for key, values := range req.Header {
			for i, v := range values {
				replaced := resolver.ReplaceAllFor(sandboxID, v)
				if replaced != v {
					req.Header[key][i] = replaced
				}
			}
		}

		if req.URL.RawQuery != "" {
			replaced := resolver.ReplaceAllFor(sandboxID, req.URL.RawQuery)
			if replaced != req.URL.RawQuery {
				req.URL.RawQuery = replaced
			}
		}

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

// ProxyURL returns the proxy URL without sandbox_id.
func (p *Proxy) ProxyURL() string {
	return "http://" + p.addr
}

// ProxyURLForSandbox returns the proxy URL with sandboxID embedded as
// Basic-Auth userinfo. If sandboxID is empty, equivalent to ProxyURL.
func (p *Proxy) ProxyURLForSandbox(sandboxID string) string {
	if sandboxID == "" {
		return p.ProxyURL()
	}
	u := url.URL{
		Scheme: "http",
		User:   url.User(sandboxID),
		Host:   p.addr,
	}
	return u.String()
}

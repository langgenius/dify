package egressproxy

import (
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"

	"github.com/elazarl/goproxy"
)

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
//
// It is built on github.com/elazarl/goproxy rather than mitmproxy-go: the
// latter always pre-resolves the destination hostname itself (in this
// process's own network namespace) before dialing the upstream proxy with a
// bare IP. In this container's network topology, that IP is frequently
// unreachable from the upstream proxy's own network attachments, and for
// hosts outside this process's network entirely (no shared network with
// local_sandbox) resolution fails outright. goproxy's upstream chaining
// (Tr.Proxy / NewConnectDialToProxy) instead forwards the literal, unresolved
// hostname to the upstream proxy (matching the standard CONNECT/forward-proxy
// semantics of net/http.Transport), letting the upstream proxy resolve it
// using its own network view.
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
		// Route both plain-HTTP forwarding and the post-MITM decrypted
		// request round-trip through the upstream proxy.
		px.Tr.Proxy = http.ProxyURL(upstreamURL)
		// Route raw CONNECT tunneling (non-MITM'd, e.g. the initial CONNECT
		// dial performed by goproxy itself) through the upstream proxy too,
		// using the literal, unresolved hostname.
		px.ConnectDial = px.NewConnectDialToProxy(cfg.UpstreamProxy)
	} else {
		// Prevent reading HTTP(S)_PROXY from the environment to avoid proxy
		// loops (this process's own env sets HTTP_PROXY to itself).
		px.Tr.Proxy = nil
		px.ConnectDial = nil
	}

	mitmAction := &goproxy.ConnectAction{
		Action:    goproxy.ConnectMitm,
		TLSConfig: goproxy.TLSConfigFromCA(&caCert),
	}
	px.OnRequest().HandleConnectFunc(func(host string, ctx *goproxy.ProxyCtx) (*goproxy.ConnectAction, string) {
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

// makeInterceptor returns a request handler that:
// 1. Proactively injects credential headers based on domain-matching policies.
// 2. Scans request headers and URL for __secret:provider/name__ placeholders and resolves them.
func makeInterceptor(resolver *Resolver) func(req *http.Request, ctx *goproxy.ProxyCtx) (*http.Request, *http.Response) {
	return func(req *http.Request, ctx *goproxy.ProxyCtx) (*http.Request, *http.Response) {
		log.Printf("egressproxy: interceptor: %s %s (host=%s, registered_creds=%d)",
			req.Method, req.URL.String(), req.Host, resolver.Len())

		if resolver.Len() == 0 {
			return req, nil
		}

		// Phase 1: Proactive header injection based on domain policies.
		resolver.InjectHeaders(req)

		// Phase 2: Placeholder replacement in existing headers.
		for key, values := range req.Header {
			for i, v := range values {
				replaced := resolver.ReplaceAll(v)
				if replaced != v {
					req.Header[key][i] = replaced
				}
			}
		}

		// Phase 3: Placeholder replacement in URL query parameters.
		if req.URL.RawQuery != "" {
			replaced := resolver.ReplaceAll(req.URL.RawQuery)
			if replaced != req.URL.RawQuery {
				req.URL.RawQuery = replaced
			}
		}

		return req, nil
	}
}

// makeResponseLogger returns a response handler that logs the outcome of
// each forwarded request. When the round-trip itself fails (e.g. dial or DNS
// errors upstream), no response reaches this handler; goproxy logs those
// failures itself via ctx.Warnf/px.Logger.
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

// ProxyURL returns the full proxy URL for use in HTTP_PROXY/HTTPS_PROXY.
func (p *Proxy) ProxyURL() string {
	return "http://" + p.addr
}

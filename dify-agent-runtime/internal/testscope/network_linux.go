//go:build linux

package testscope

import (
	"bufio"
	"context"
	"errors"
	"golang.org/x/sys/unix"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"
)

// Private destinations are denied by default. Explicit deployment-owned mediator
// addresses are the only exception; request payloads cannot add these addresses.
func AllowedAddress(ip netip.Addr, mediators []netip.Addr) bool {
	ip = ip.Unmap()
	for _, allowed := range mediators {
		if ip == allowed.Unmap() {
			return true
		}
	}
	return ip.IsValid() && ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsUnspecified()
}

type PinnedTarget struct {
	Addresses      []string `json:"addresses"`
	MaxBytes       int64    `json:"max_bytes"`
	TimeoutSeconds int64    `json:"timeout_seconds"`
}
type PinnedNetwork struct {
	Targets map[string]PinnedTarget `json:"targets"`
}

func (p PinnedNetwork) Resolve(authority string) (string, error) {
	target, ok := p.Targets[authority]
	if !ok || len(target.Addresses) == 0 {
		return "", errors.New("unapproved network authority")
	}
	return target.Addresses[0], nil
}
func PinNetwork(ctx context.Context, targets []NetworkTarget, mediators []string) (PinnedNetwork, error) {
	pinned := PinnedNetwork{Targets: map[string]PinnedTarget{}}
	for _, target := range targets {
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", target.Host)
		if err != nil || len(ips) == 0 {
			return pinned, errors.New("target resolution failed")
		}
		p := PinnedTarget{MaxBytes: target.MaxBytes, TimeoutSeconds: target.TimeoutSeconds}
		for _, ip := range ips {
			address := net.JoinHostPort(ip.Unmap().String(), strconv.Itoa(int(target.Port)))
			allowed := AllowedAddress(ip, nil)
			for _, mediator := range mediators {
				if address == mediator {
					allowed = true
				}
			}
			if !allowed {
				return pinned, errors.New("target resolves to forbidden network")
			}
			p.Addresses = append(p.Addresses, address)
		}
		pinned.Targets[net.JoinHostPort(target.Host, strconv.Itoa(int(target.Port)))] = p
	}
	return pinned, nil
}

type Broker struct {
	listener net.Listener
	policy   PinnedNetwork
	spend    func(string, int64) error
	deadline time.Time
	mu       sync.Mutex
	conns    map[net.Conn]bool
	closed   bool
	peerPID  int
	slots    chan struct{}
}

func StartBroker(socket string, policy PinnedNetwork, deadline time.Time, spend func(string, int64) error) (*Broker, error) {
	listener, err := net.Listen("unix", socket)
	if err != nil {
		return nil, err
	}
	b := &Broker{listener: listener, policy: policy, deadline: deadline, spend: spend, conns: map[net.Conn]bool{}, slots: make(chan struct{}, 4)}
	go func() {
		_ = (&http.Server{Handler: b, ReadHeaderTimeout: 3 * time.Second, MaxHeaderBytes: 16 << 10}).Serve(&peerListener{Listener: listener, broker: b})
	}()
	return b, nil
}
func (b *Broker) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.closed = true
	_ = b.listener.Close()
	for conn := range b.conns {
		_ = conn.Close()
	}
}
func (b *Broker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	select {
	case b.slots <- struct{}{}:
		defer func() { <-b.slots }()
	default:
		http.Error(w, "broker connection limit", http.StatusTooManyRequests)
		return
	}
	authority := r.Host
	if r.Method != http.MethodConnect {
		if r.URL.Scheme != "http" {
			http.Error(w, "scheme denied", http.StatusForbidden)
			return
		}
		authority = r.URL.Host
	}
	address, err := b.policy.Resolve(authority)
	if err != nil {
		http.Error(w, "target denied", http.StatusForbidden)
		return
	}
	target := b.policy.Targets[authority]
	deadline := time.Now().Add(time.Duration(target.TimeoutSeconds) * time.Second)
	if b.deadline.Before(deadline) {
		deadline = b.deadline
	}
	if !deadline.After(time.Now()) {
		http.Error(w, "scope expired", http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithDeadline(r.Context(), deadline)
	defer cancel()
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		http.Error(w, "scope revoked", http.StatusForbidden)
		return
	}
	// Charge a conservative connection unit before every dial, including CONNECT.
	if err = b.spend(authority, 1); err != nil {
		b.mu.Unlock()
		http.Error(w, "network budget exhausted", http.StatusBadGateway)
		return
	}
	raw, err := (&net.Dialer{Timeout: time.Second}).DialContext(ctx, "tcp", address)
	if err != nil {
		b.mu.Unlock()
		http.Error(w, "target unavailable", http.StatusBadGateway)
		return
	}
	_ = raw.SetDeadline(deadline)
	b.conns[raw] = true
	b.mu.Unlock()
	defer func() { _ = raw.Close(); b.mu.Lock(); delete(b.conns, raw); b.mu.Unlock() }()
	conn := &budgetConn{Conn: raw, spend: func(n int64) error { return b.spend(authority, n) }}
	if r.Method == http.MethodConnect {
		client, buffer, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer func() { _ = client.Close() }()
		_ = client.SetDeadline(deadline)
		_, _ = buffer.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
		if err = buffer.Flush(); err != nil {
			return
		}
		done := make(chan struct{})
		go func() { _, _ = io.Copy(conn, buffer); _ = raw.Close(); close(done) }()
		_, _ = io.Copy(client, conn)
		_ = client.Close()
		_ = raw.Close()
		<-done
		return
	}
	r.RequestURI = ""
	r.URL.Scheme = ""
	r.URL.Host = ""
	r.Header.Del("Proxy-Authorization")
	r.Header.Del("Proxy-Connection")
	r.Close = true
	if err = r.Write(conn); err != nil {
		http.Error(w, "network budget exceeded", http.StatusBadGateway)
		return
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), r)
	if err != nil {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	defer func() { _ = response.Body.Close() }()
	for name, values := range response.Header {
		for _, v := range values {
			w.Header().Add(name, v)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

type budgetConn struct {
	net.Conn
	spend func(int64) error
}

func (c *budgetConn) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	// Reserve before consuming upstream bytes. Failed reservations spend zero;
	// shrink conservatively so a small remaining budget can still make progress.
	amount := len(p)
	if amount > 1024 {
		amount = 1024
	}
	for amount > 0 {
		if err := c.spend(int64(amount)); err == nil {
			return c.Conn.Read(p[:amount])
		}
		amount /= 2
	}
	return 0, errors.New("network budget exhausted")
}
func (c *budgetConn) Write(p []byte) (int, error) {
	if err := c.spend(int64(len(p))); err != nil {
		return 0, err
	}
	return c.Conn.Write(p)
}

// StartWorkerProxy is a local byte relay. Only this trusted process can open the
// broker Unix channel; the submitted job's chroot contains no broker socket.
func StartWorkerProxy(socket string) error {
	if err := exec.Command("ip", "link", "set", "lo", "up").Run(); err != nil {
		return err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:18080")
	if err != nil {
		return err
	}
	slots := make(chan struct{}, 4)
	go func() {
		for {
			client, err := listener.Accept()
			if err != nil {
				return
			}
			select {
			case slots <- struct{}{}:
			default:
				_ = client.Close()
				continue
			}
			_ = client.SetDeadline(time.Now().Add(60 * time.Second))
			go func() {
				defer func() { <-slots }()
				defer func() { _ = client.Close() }()
				broker, err := net.Dial("unix", socket)
				if err != nil {
					return
				}
				defer func() { _ = broker.Close() }()
				done := make(chan struct{})
				go func() { _, _ = io.Copy(broker, client); _ = broker.Close(); close(done) }()
				_, _ = io.Copy(client, broker)
				_ = client.Close()
				<-done
			}()
		}
	}()
	return nil
}

func (b *Broker) SetPeer(pid int) { b.mu.Lock(); defer b.mu.Unlock(); b.peerPID = pid }

type peerListener struct {
	net.Listener
	broker *Broker
}

func (l *peerListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		valid := false
		if socket, ok := conn.(syscall.Conn); ok {
			raw, err := socket.SyscallConn()
			if err == nil {
				_ = raw.Control(func(fd uintptr) {
					cred, err := unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
					if err == nil {
						l.broker.mu.Lock()
						valid = l.broker.peerPID > 0 && int(cred.Pid) == l.broker.peerPID && int(cred.Uid) == os.Getuid()
						l.broker.mu.Unlock()
					}
				})
			}
		}
		if valid {
			return conn, nil
		}
		_ = conn.Close()
	}
}

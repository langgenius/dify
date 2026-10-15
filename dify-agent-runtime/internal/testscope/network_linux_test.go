//go:build linux

package testscope

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestBrokerRejectsControlAndMetadataTargets(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1"} {
		if AllowedAddress(netip.MustParseAddr(ip), nil) {
			t.Fatalf("allowed private destination %s", ip)
		}
	}
}
func TestBrokerMatchesExactAuthority(t *testing.T) {
	target := NetworkTarget{Host: "example.test", Port: 443}
	for _, bad := range []string{"example.test:80", "other.test:443", "example.test.evil:443", "user@example.test:443"} {
		if target.Matches(bad) {
			t.Fatalf("accepted %s", bad)
		}
	}
	if !target.Matches("example.test:443") {
		t.Fatal("refused exact approved authority")
	}
}
func TestBrokerPinsResolutionAndRejectsUnapprovedAuthority(t *testing.T) {
	policy := PinnedNetwork{Targets: map[string]PinnedTarget{"example.test:443": {Addresses: []string{"93.184.216.34:443"}, MaxBytes: 128, TimeoutSeconds: 1}}}
	if _, err := policy.Resolve("evil.test:443"); err == nil {
		t.Fatal("unapproved authority resolved")
	}
	address, err := policy.Resolve("example.test:443")
	if err != nil || address != "93.184.216.34:443" {
		t.Fatal(address, err)
	}
}

func TestBrokerRealRelayDenialBudgetAndRevocation(t *testing.T) {
	var calls atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); _, _ = w.Write([]byte("synthetic-canary")) }))
	defer upstream.Close()
	address := strings.TrimPrefix(upstream.URL, "http://")
	socket := filepath.Join(t.TempDir(), "broker.sock")
	var used atomic.Int64
	broker, err := StartBroker(socket, PinnedNetwork{Targets: map[string]PinnedTarget{"canary.test:80": {Addresses: []string{address}, MaxBytes: 1024, TimeoutSeconds: 1}}}, time.Now().Add(time.Minute), func(_ string, n int64) error {
		for {
			old := used.Load()
			if old+n > 1024 {
				return errors.New("budget")
			}
			if used.CompareAndSwap(old, old+n) {
				return nil
			}
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer broker.Close()
	broker.SetPeer(os.Getpid())
	client := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{Proxy: http.ProxyURL(&url.URL{Scheme: "http", Host: "broker"}), DisableKeepAlives: true, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}}
	denied, err := client.Get("http://other.test:80/")
	if err != nil {
		t.Fatal(err)
	}
	denied.Body.Close()
	if denied.StatusCode != 403 || calls.Load() != 0 {
		t.Fatal("unapproved request reached canary")
	}
	response, err := client.Get("http://canary.test:80/")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || string(body) != "synthetic-canary" || calls.Load() != 1 {
		t.Fatal("approved relay failed", string(body), err)
	}
	used.Store(1024)
	response, err = client.Get("http://canary.test:80/")
	if err == nil {
		response.Body.Close()
		if response.StatusCode != 502 {
			t.Fatal("budget did not stop relay")
		}
	}
	if calls.Load() != 1 {
		t.Fatal("exhausted request reached target")
	}
	broker.Close()
	if response, err = client.Get("http://canary.test:80/"); err == nil {
		response.Body.Close()
		t.Fatal("revoked broker remained reachable")
	}
}

type countedReadConn struct {
	net.Conn
	reads int
}

func (c *countedReadConn) Read(p []byte) (int, error) { c.reads++; p[0] = 'x'; return 1, nil }
func TestNetworkBudgetRefusalCannotConsumeUnchargedResponseBytes(t *testing.T) {
	raw := &countedReadConn{}
	conn := &budgetConn{Conn: raw, spend: func(int64) error { return errors.New("exhausted") }}
	if _, err := conn.Read(make([]byte, 4096)); err == nil {
		t.Fatal("accepted exhausted read")
	}
	if raw.reads != 0 {
		t.Fatal("consumed upstream bytes before durable reservation")
	}
}

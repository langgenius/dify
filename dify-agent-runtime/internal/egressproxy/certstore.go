package egressproxy

import (
	"crypto/tls"
	"sync"
)

// memCertStore is a simple in-memory cache of MITM leaf certificates, keyed by
// hostname. goproxy recommends caching generated certificates in production to
// avoid repeated CPU-intensive signing for every intercepted CONNECT.
type memCertStore struct {
	mu    sync.RWMutex
	certs map[string]*tls.Certificate
}

func newMemCertStore() *memCertStore {
	return &memCertStore{certs: make(map[string]*tls.Certificate)}
}

// Fetch implements goproxy.CertStorage.
func (s *memCertStore) Fetch(hostname string, gen func() (*tls.Certificate, error)) (*tls.Certificate, error) {
	s.mu.RLock()
	cert, ok := s.certs[hostname]
	s.mu.RUnlock()
	if ok {
		return cert, nil
	}

	cert, err := gen()
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.certs[hostname] = cert
	s.mu.Unlock()
	return cert, nil
}

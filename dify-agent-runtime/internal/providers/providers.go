// Package providers defines credential injection policies used by the
// egress proxy. Each policy knows how to interpret a credential's Value
// and inject it into an outbound HTTP request.
//
// Provider packages register themselves at init time via Register, so the
// server package never needs to import individual providers — it only
// imports this package and blank-imports the provider packages for their
// side effects.
//
// A policy is created from API-level configuration (see package server) and
// stored inside egressproxy.StoredCredential. At request time the egress
// proxy calls Apply for every policy whose Domains match the request host.
package providers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

// Policy is the interface implemented by every credential injection policy.
//
//   - Domains returns the host patterns this policy applies to (empty = all).
//     The egress proxy uses this to decide whether to invoke Apply.
//   - Apply injects the credential into req. value is the credential's raw
//     stored value (e.g. json.RawMessage); the policy is responsible for
//     decoding it into the shape it needs.
type Policy interface {
	Domains() []string
	Apply(req *http.Request, value any) error
}

// Factory builds a Policy from raw JSON config (the per-type payload from
// the credential manifest, e.g. the "http_header" or "aws_sigv4" object).
type Factory func(config json.RawMessage) (Policy, error)

var (
	regMu      sync.RWMutex
	regFactory = map[string]Factory{}
)

// Register associates name with factory. Called from provider package init().
// Panics if name is already registered.
func Register(name string, factory Factory) {
	regMu.Lock()
	defer regMu.Unlock()
	if _, exists := regFactory[name]; exists {
		panic(fmt.Sprintf("providers: duplicate registration for %q", name))
	}
	regFactory[name] = factory
}

// Build looks up the factory registered under name and invokes it with config.
// Returns (nil, nil) if name is not registered and config is empty/nil.
// Returns an error if name is not registered but config is non-empty.
func Build(name string, config json.RawMessage) (Policy, error) {
	regMu.RLock()
	factory, ok := regFactory[name]
	regMu.RUnlock()
	if !ok {
		if len(config) == 0 || string(config) == "null" {
			return nil, nil
		}
		return nil, fmt.Errorf("providers: unknown inject type %q", name)
	}
	return factory(config)
}

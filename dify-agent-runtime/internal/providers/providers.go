// Package providers defines credential injection policies used by the
// egress proxy. Each policy knows how to interpret a credential's Value
// and inject it into an outbound HTTP request.
//
// A policy is created from API-level configuration (see package server) and
// stored inside egressproxy.StoredCredential. At request time the egress
// proxy calls Apply for every policy whose Domains match the request host.
package providers

import "net/http"

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

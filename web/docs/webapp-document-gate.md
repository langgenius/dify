# WebApp document availability gate

The optional Proxy gate checks default `/chat/:code`, `/chatbot/:code`, `/workflow/:code`, `/completion/:code`, and `/agent/:code` addresses before Next starts rendering. It does not replace Gateway checks on subsequent API requests. Environment/Enterprise address routing is unchanged.

Configure both server-only variables:

- `WEBAPP_ACCESS_PREFLIGHT_URL`: the fixed internal Gateway `/api/webapp/access-mode` endpoint. Do not point it at Core or a public redirecting origin.
- `WEBAPP_ACCESS_PREFLIGHT_PROXY_SECRET`: a random shared ingress secret. Do not use a `NEXT_PUBLIC_` variable, commit its value, include it in logs, or expose it in a response.

Every ingress location that forwards documents to Web must **overwrite**, not append or preserve, `X-Dify-Webapp-Client-Ip` with its validated visitor address and `X-Dify-Webapp-Proxy-Secret` with this secret. The ingress must itself have an explicit trusted-proxy policy; an arbitrary inbound XFF/CF header is not evidence of visitor identity. Web should not have an unprotected public port.

Web verifies the proof with a constant-time comparison and validates a single IP, then creates a fresh Gateway request with only `Accept` and a one-address `X-Forwarded-For`. Gateway must trust the Web peer's network and resolve the forwarded address using its existing trusted-hop policy. Original XFF, Forwarded, CF headers, Authorization, Cookie, and ingress proof are not forwarded. The URL is configuration-owned; request queries cannot select another upstream or supply an IP.

An unset URL leaves self-hosted routing unchanged. Once configured, missing/invalid attestation, timeout, redirects, invalid payloads, and dependency failures produce a non-cacheable 503. They are not application-not-found responses. Only the canonical Gateway/Core `404 app_not_found` produces the existing generic unavailable page, with a 404 status fixed before rendering and `Cache-Control: no-store`. The allow path retains existing rendering and authentication behavior.

The internal `/webapp-unavailable` destination has no application lookup, uses no caller-supplied query state, and is always a 404. Proxy clears its internal IP header on every request, including direct visits. Only a verified denial can populate that header. Locale resources are provided for server rendering; the existing error-page UI remains the owner of language selection, appearance, and navigation.

Validation must include real Next HTTP requests, not only an assertion on `NextResponse.status`: verify document status, absence of redirect, non-cacheability, matching missing/denied body, and unchanged allowed rendering. API availability and the edge trust configuration must be deployed before enabling these variables. Do not enable them globally in an environment whose Gateway does not route `/api`.

# Add the Dify Capability v2 authorization foundation

Date: 2026-07-21

## Why

The legacy Dify bridge uses one shared HS256 secret and broad read/write scopes. It cannot bind a
request to one action, namespace, Space, child resource, principal profile, or rotation key. This
change adds the asymmetric, resource-scoped contract needed before the integration can carry
production traffic.

## Runtime changes

- Added a Dify-side RS256 issuer with strict Capability v2 claims, current/private plus bounded
  previous/public rotation keys, public-only JWKS serialization, an explicit operation-to-action
  registry, and distinct interactive, service credential, agent, workflow, internal-worker, and
  disabled-MCP issuance profiles.
- Added sanitized synchronous issuance audit evidence with tenant/control-space/grant scope,
  operation and resource summary, authorization/content revisions, issued/expiry times, trace ID,
  and only a SHA-256 jti digest. Raw JWTs and raw jti values are not representable by the event.
- Added a KnowledgeFS verifier that accepts only RS256 public JWKS, validates issuer, audience,
  version, profile, time window, current/previous `kid`, and refreshes once for an unknown `kid`.
- Added a declarative request guard for action, caller profile, namespace, resource, parent resource,
  and path/query/body bindings. Integrated provision/delete and capability revoke/fence operations
  use dedicated internal routes; Capability provisioning cannot enter the legacy create route.
- Added a sanitized handler context for durable grant provenance. The audit record and handler
  context reuse one computed jti hash and expose neither the bearer nor raw jti.
- Added default-off API assembly. Selecting Capability v2 with missing or private JWKS leaves auth
  unassembled, so production readiness remains 503. KnowledgeFS never receives signing material.
- Hardened the Dify proxy so contract metadata cannot opt browser credentials, forwarding headers,
  or hop-by-hop headers back into the server-to-server request.

## Rollout boundary

The feature flag remains false in deployment examples. Dify can produce a public JWKS object and
KnowledgeFS can consume configured current/previous public keys, but this slice does not add an HTTP
JWKS publication endpoint or remote JWKS fetch/cache transport. That endpoint is a later rollout
interface and must not be inferred from the in-process key-ring API.

## Verification

- Dify capability/config/proxy/auditor focused Pytest suite passed.
- Ruff format/check passed for the changed Python files.
- Targeted MyPy passed for the issuer, configuration, and proxy modules.
- Capability, grant admission/provenance/revocation, integrated provisioning, and API assembly
  Vitest suites passed (45 tests).
- TypeScript typecheck passed for both `@knowledge/api` and `@knowledge/api-app`.
- Biome passed for the changed TypeScript files, and `git diff --check` passed.

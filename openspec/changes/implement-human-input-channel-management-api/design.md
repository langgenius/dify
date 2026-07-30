## Context

The archived Channel Management core now provides one facade, a complete-ref handler registry, a Resend Email manager and independently registered Slack, Feishu and DingTalk managers. The managers already preserve credential-free views, Email validation-before-write, Email timestamp snapshots and IM complete-CAS/replacement semantics.

The transport layer predates that boundary. `api/controllers/console/workspace/human_input.py` contains separate `/email-provider` and `/im-integration` stubs. No frontend repository calls the Email route. This change replaces only the Email stub; IM routes and DTOs stay unchanged and unimplemented.

The Community and Cloud Workspace Channels PRD requires Email to appear first beside Slack, Feishu and DingTalk and limits visibility to Workspace Owner/Admin. This change establishes that transport surface only. Provider-dependent operations remain follow-up work. Delivery Runtime behavior is intentionally unspecified and belongs to a separate change. Enterprise deployment-wide IM ownership and configuration behavior are outside this change; canonical Channels requests on Enterprise return HTTP `501` before channel route dispatch.

## Goals / Non-Goals

**Goals:**

- Expose the existing facade through one canonical owner/admin Workspace Console surface.
- Preserve complete channel/provider discriminators and provider-specific candidate DTOs.
- Compose provider-independent Resend reads and deletes without adding business logic to controllers.
- Keep every provider-dependent operation explicit and unimplemented.
- Retire the non-functional Email provider stub so Resend has one configuration authority.
- Keep the existing IM sync and Contact binding changes aligned with the facade boundary.
- Keep Enterprise deployment-wide IM ownership, configuration and provider behavior untouched.

**Non-Goals:**

- Implement frontend repository hooks or replace the mock UI.
- Implement IM directory synchronization, background sync workers or Contact binding APIs.
- Implement OAuth authorization redirects, callbacks or event subscriptions.
- Implement provider-dependent Resend save or test behavior.
- Implement Slack, Feishu or DingTalk provider connectivity, credential protection, persistence or lifecycle behavior.
- Implement, validate or change Enterprise deployment-wide IM ownership or configuration behavior.
- Define or implement Delivery Runtime behavior.
- Add SMTP, Lark, Microsoft Teams, WeCom or another management provider.
- Add database tables, migrations or a generic Channel repository.
- Refresh persisted channel status during list/get operations.

## Decisions

### 1. One canonical resource surface uses complete channel references

The canonical routes are:

| Method   | Route                                                                         | Result                                         |
| -------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| `GET`    | `/console/api/workspaces/current/human-input/channels`                        | Ordered collection plus isolated safe failures |
| `GET`    | `/console/api/workspaces/current/human-input/channels/<kind>/<provider>`      | One persisted-state view                       |
| `POST`   | `/console/api/workspaces/current/human-input/channels/<kind>/<provider>/test` | Reserved provider-dependent operation          |
| `PUT`    | `/console/api/workspaces/current/human-input/channels/<kind>/<provider>`      | Reserved provider-dependent operation          |
| `DELETE` | `/console/api/workspaces/current/human-input/channels/<kind>/<provider>`      | One unconfigured persisted-state view          |

The first release accepts only:

- `email/resend`
- `im/slack`
- `im/feishu`
- `im/ding_talk`

Both kind and provider remain in the path because the application registry is keyed by a complete `ChannelRef`, and future Email providers must not collide with the Email channel kind. A provider-only route was rejected because it makes the provider namespace global and hides kind/provider mismatch errors.

The collection evaluates references in product order as Email, Slack, Feishu and DingTalk. In this change only Email returns a persisted view; the three IM placeholders return isolated `unsupported_operation` failures.

### 2. Provider-specific request unions remain explicit at the edge

The Console API defines a discriminated union for Resend, Slack, Feishu and DingTalk candidates. The controller validates that path kind/provider, request discriminator and candidate type agree before constructing a command.

The Resend DTO preserves the future create/update key distinction: a non-blank key maps to a new secret candidate and an omitted or blank key maps to explicit retention. This change validates and maps that transport shape but does not execute Resend save or test connectivity.

Canonical IM DTO variants reserve complete new-secret and CAS shapes for a future implementation. Every canonical IM operation returns `unsupported_operation` before IM persistence, credential protection or provider I/O. Existing legacy IM DTOs and their 501 routes remain unchanged.

Email concurrency snapshots remain internal and are not exposed through the transport.

### 3. Transport responses keep persisted views and candidate tests separate

Collection and item reads return credential-free persisted `ChannelView` projections. Candidate-test response DTOs remain distinct from persisted views, but production test execution is deferred.

Delete returns the resulting unconfigured `ChannelView`. Resend save/test and every IM operation return explicit unsupported-operation results before provider or persistence work.

No canonical response contains plaintext, encrypted or masked credentials. Resend exposes only `api_key_configured`; the IM placeholders return no persisted summary.

### 4. Collection failure is partial; mutation failure is atomic

The list endpoint returns `200` with all successful views plus per-ref safe failures. One broken provider/repository read must not hide unrelated channel cards.

Single-ref operations map application failures as follows:

| Category                                        | HTTP status |
| ----------------------------------------------- | ----------- |
| unsupported channel                             | `404`       |
| unsupported operation                           | `405`       |
| request validation failure                      | `400`       |
| not configured, conflict or stale configuration | `409`       |
| provider failure                                | `502`       |
| unexpected channel failure                      | `500`       |

The body carries only the stable category, optional safe code and optional safe field identifier. Provider response bodies, exception text, request headers and credentials are never reflected.

### 5. Trusted management context is built only from server state

Every route keeps the existing setup, login, account-initialization and owner/admin decorators. The controller obtains Workspace ID, actor account ID and actor Email from the authenticated request.

Candidate DTOs contain no tenant, Organization or deployment selectors. Route parameters select only a supported channel reference.

This change targets Community and Cloud. Its composition root does not inspect deployment edition, resolve Organization or deployment identity, or access Enterprise deployment-wide IM state. The optional IM ownership fields in the shared context remain unset until a separate Enterprise-aware IM implementation defines and owns that behavior.

### 6. A request-scoped composition root owns infrastructure wiring

A composition function creates:

- one SQLAlchemy Email repository;
- one provider-independent Resend handler over the existing Email manager;
- three explicit unimplemented handlers for Slack, Feishu and DingTalk;
- one registry and facade.

Controllers receive or construct only the facade and DTO mappers. They do not import channel ORM records or provider SDKs, and they do not call repositories directly.

Email repository sessions remain operation-scoped for reads and deletes. Resend save/test and all IM placeholders return before repository, credential or provider work.

### 7. Provider-dependent operations remain a separate change

This change does not compose or define provider-dependent Resend behavior. Delivery Runtime is outside this design and remains unspecified.

The production Resend control-plane handler delegates only provider-independent get/delete behavior to the existing Email manager. Save and test return `unsupported_operation` with `resend_provider_connectivity_not_implemented` before reading configuration or exposing a credential.

Slack, Feishu and DingTalk have no provider client, credential protector or repository wiring in this change. Their complete references remain registered only so the canonical API returns a stable unimplemented response rather than accidentally exposing the old configuration authority.

### 8. Existing IM changes remain untouched

`human-input-v2-api-contracts` and `implement-im-contact-sync-api` retain their existing IM contracts and tasks. This change neither resolves nor redesigns those follow-up concerns.

### 9. Enterprise behavior is a non-interference boundary

Functional support commitments in this change apply only to Community and Cloud. One Console blueprint pre-dispatch guard matches the canonical Channels path prefix and returns HTTP `501` on Enterprise before authentication decorators, DTO mapping, composition or facade dispatch. It MUST NOT resolve, read, write or reinterpret deployment-wide IM ownership, configuration, credentials or provider state.

## Risks / Trade-offs

- [One collection request reads four handlers] → Keep reads independent, prohibit provider I/O, assert query counts and return partial safe failures.
- [A generic route becomes an untyped configuration bag] → Keep discriminated DTO unions and reject path/body mismatch before composition or provider work.
- [Controllers accidentally rebuild channel rules] → Limit them to authentication, DTO mapping, context construction, facade calls and result mapping; enforce import-boundary tests.
- [Reserved mutations look functional before connectivity lands] → Return one explicit `resend_provider_connectivity_not_implemented` code and document the boundary.
- [IM placeholders are mistaken for working integrations] → Return one explicit `im_channel_management_not_implemented` code and document that no IM provider or persistence work occurs.
- [Community and Cloud wiring accidentally couples to Enterprise IM state] → Reject Enterprise requests in one pre-dispatch edition guard, keep edition and deployment identity resolution out of the composition root and assert that shared IM ownership fields remain unset.
- [Removing the Email stub surprises a latent caller] → Confirm repository-wide absence of callers and replace generated/manual API documentation in the same change.

## Migration Plan

1. Add canonical DTOs, response mappers and route contract tests.
2. Add request-scoped composition with provider-independent Resend read/delete behavior and explicit provider stubs.
3. Wire canonical routes to the facade.
4. Leave active IM API-contract and sync changes unchanged.
5. Remove only the obsolete Email provider 501 route after repository-wide caller checks.
6. Keep the frontend mock repository until a separate frontend change switches atomically to the canonical API.
7. Roll back by restoring the Email 501 stub and removing canonical route registration; existing records remain unchanged.

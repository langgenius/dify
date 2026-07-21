## Context

The current standalone Human Input page lives under `web/app/(humanInputLayout)/form/[token]/`. Its route-local `FormData` type is imported by `web/service/use-share.ts`, it reads and submits through the legacy underscore path `/form/human_input/<token>`, and its submit payload contains only `inputs` and `action`. File upload detection also recognizes only `/form/<token>`.

Human Input v2 needs an isolated page at `/form-v2/<form_token>` with the sequence supplied by the user:

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant API
    participant Mail

    User->>Browser: Open /form-v2/<form_token>
    Browser->>API: GET /api/form/human-input/<form_token>
    API-->>Browser: Form definition
    Browser->>API: POST .../access-request
    API->>Mail: Send Email OTP
    API-->>Browser: Challenge Token and cooldown metadata
    Mail-->>User: OTP
    User->>Browser: Enter OTP and submit an action
    Browser->>API: inputs + action + otp_code + challenge_token
    API-->>Browser: Success or actionable error
```

The relevant backend surface is not ready: the access-request route is a `501` stub, the current access response omits `challenge_token`, the current public submit request omits `challenge_token`, and the canonical hyphenated GET/POST routes are not complete. The user explicitly requested frontend mocks for these blockers. This change therefore needs a transport boundary that can run against deterministic mocks now without embedding mock decisions in page components, then accept the finalized real/generated transport later.

## Goals / Non-Goals

**Goals:**

- Add an independently routed and independently orchestrated Human Input v2 public form page.
- Automatically issue one Email OTP access request after a valid form definition loads.
- Keep OTP and Challenge Token state secure, ephemeral, and synchronized with server cooldown/expiry metadata.
- Submit form values, action, OTP, and Challenge Token together with strong duplicate and stale-response protection.
- Reuse version-neutral form rendering and upload behavior without coupling v2 to the legacy transport model.
- Make all blocked API states implementable and testable through an explicit development/test mock adapter.
- Preserve the legacy page and add only English and Simplified Chinese copy.

**Non-Goals:**

- Implementing or modifying backend routes, generated contracts, mail delivery, OTP validation, or v2 mail-link generation.
- Redirecting or upgrading `/form/<form_token>` to v2.
- Changing Human Input node/editor DSL, recipients, message templates, or workflow runtime behavior.
- Defining a new visual redesign beyond the OTP controls and states required by the sequence; existing public form primitives remain the presentation baseline.
- Persisting an OTP session across a full page reload or sharing proof across tabs.

## Decisions

### 1. Give v2 a route-owned feature boundary while sharing presentation only

Create `web/app/(humanInputLayout)/form-v2/[token]/` with a thin page, an orchestration hook/controller, and route tests. Extract only version-neutral presentation from the legacy route where reuse is valuable: loaded form content, input/action rendering, expiration, branding, and status-card primitives. Contract types and request hooks MUST move out of route-local component files so neither service layer imports a Next.js route module.

The legacy route keeps its existing underscore endpoints, payload, status mapping, and behavior. The v2 route uses only the canonical hyphenated contract through its feature transport. Sharing the old submit hook was rejected because it cannot represent OTP/Challenge Token state and would make a later backend swap risk the v1 path.

### 2. Normalize transport DTOs into a v2 form domain model

The page consumes a feature-owned domain model containing the resolved form content, inputs, default values, actions, expiration, and optional site/branding data. The real adapter is responsible for mapping the finalized generated/public API DTO into this model; the mock adapter returns the same domain values. Optional branding lets the page remain functional if the final v2 definition contract does not expose the legacy `site` envelope.

The expected transport contract is:

| Operation      | Method and path                                          | Required result/body                                            |
| -------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| Get form       | `GET /api/form/human-input/<form_token>`                 | Resolved form definition                                        |
| Request access | `POST /api/form/human-input/<form_token>/access-request` | `challenge_token`, `resend_after_seconds`, `expires_in_seconds` |
| Upload token   | `POST /api/form/human-input/<form_token>/upload-token`   | Upload token and expiry                                         |
| Submit         | `POST /api/form/human-input/<form_token>`                | `inputs`, `action`, `otp_code`, `challenge_token`               |

No generated file is edited manually. When generated/public-client support lands, only the real adapter and DTO mapping change. Until then, the real adapter can fail explicitly as unavailable and local/test environments can select the mock adapter.

### 3. Express the page lifecycle as one local session state machine

The v2 route owns one session, so a feature hook with a reducer is preferable to global state. It separates form query state from proof/submission state while enforcing these transitions:

```text
loading-form
  -> terminal-form-error
  -> requesting-otp
      -> access-error
      -> awaiting-otp
          -> challenge-expired
          -> submitting
              -> otp-error / challenge-error
              -> terminal-submit-error
              -> success
```

After a successful form query, the controller starts access-request exactly once for the current token. A token-keyed attempt guard plus disabled query refetch/retry behavior prevents React Strict Mode, rerenders, reconnects, and focus events from sending extra email. Manual retry is available after access failure; manual resend is available only after the server-provided cooldown.

Changing the route token aborts/ignores stale async work and resets form values, OTP, Challenge Token, deadlines, errors, and submission success. Cancelled or late responses from the previous token MUST NOT mutate the new session.

### 4. Treat cooldown and challenge expiry as absolute server-derived deadlines

On access success the controller stores the Challenge Token in component memory and derives `resendAt` and `expiresAt` from the response seconds and one captured client timestamp. A lightweight clock tick derives display text; the timer is not the source of truth. Focus/background pauses therefore do not extend a challenge.

Resend replaces the Challenge Token, clears the OTP input and OTP-specific errors, and resets both deadlines. Challenge expiry clears the usable proof and requires a new access request before submit. The page does not automatically resend on expiry because that could send unexpected repeated email.

### 5. Keep OTP-guarded submission atomic at the UI boundary

The page reuses existing form initialization, required-field validation, value processing, and action styling. An action is enabled only when fields are valid, a non-expired Challenge Token exists, OTP satisfies the finalized client-side shape, and no access/submit operation is pending.

One click creates one payload containing processed `inputs`, the chosen `action`, `otp_code`, and the current `challenge_token`. A pending lock prevents action-button races. Success clears proof data and shows the existing completion treatment. Invalid OTP keeps form values and the current unexpired challenge so the user can retry; expired/stale challenge clears proof and returns to the access step; task submitted/expired becomes terminal.

### 6. Provide an explicitly selected, deterministic mock transport

Define a narrow `HumanInputV2FormTransport` interface for get-form, access-request, submit, and upload-token operations. Components and session logic receive the interface from a feature provider/factory and never branch on mock mode.

The mock transport is selected explicitly in development and tests through one feature-owned configuration/injection point. It is instance-scoped, accepts an injectable clock, and simulates:

- valid form definition and defaults;
- one fixed development/test OTP without displaying it in production UI;
- unique Challenge Token issuance, replacement, cooldown, and expiry;
- invalid OTP, stale/expired challenge, access failure, rate limit, expired/submitted/not-found forms, and concurrent completion;
- successful submit and v2 upload-token/file flows.

Production defaults to the real adapter and MUST NOT catch a real transport failure and substitute mock success. Token/query-string switches were rejected because they make mock activation externally controllable and risk exposing test behavior in production.

### 7. Make file upload routing version-aware

Replace the current single regex check with a small route classifier that yields legacy form, v2 form, or non-form. Legacy forms keep `/form/human_input/<token>/upload-token`; v2 forms use the transport's canonical `/form/human-input/<token>/upload-token` or its mock equivalent. Shared uploader UI receives the resolved upload strategy rather than reconstructing endpoint paths.

### 8. Keep errors, security, localization, and tests explicit

Normalize transport errors into page categories: not found, form expired, already submitted, form/access rate limited, access delivery failed, invalid OTP, expired/stale challenge, network/unavailable, and unknown. Recoverable proof errors retain entered form values; terminal form/task errors replace the form with a status card.

OTP and Challenge Token MUST NOT enter URLs, analytics, logs, error messages, local/session storage, or persisted query caches. OTP input uses an accessible label and `autocomplete="one-time-code"`; final length/character constraints come from the finalized contract. All new strings are read from the share namespace and added only to `en-US` and `zh-Hans` per the user's locale constraint.

Tests use the injected mock transport and fake clock to cover observable flows, not implementation details. Regression tests prove v1 endpoints, payloads, file upload, and terminal states are unchanged.

## Risks / Trade-offs

- [Mock behavior diverges from the final API] → Keep the interface narrow, isolate DTO mapping, model every field shown in the agreed sequence, and add contract-parity tests when generated types land.
- [Automatic access request sends duplicate email] → Guard by route token, disable implicit retry/refetch, abort stale work, and test Strict Mode, rerender, reconnect, and focus cases.
- [Challenge/OTP leaks through generic client caches or diagnostics] → Store proof only in local reducer state and redact normalized errors; never use persisted query state for proof.
- [Client and server clocks differ] → Treat server durations as authoritative from receipt time; the server remains the final validator and client expiry only prevents obviously stale submits.
- [A mock accidentally reaches production] → Require an explicit development/test selection, default production to real transport, and add a build/config test proving no silent fallback.
- [Shared component extraction regresses v1] → Characterize the current legacy route first and keep all version-specific orchestration outside shared presentation.
- [File upload selects the wrong endpoint] → Centralize route classification and test legacy, v2, unrelated, and malformed paths.

## Migration Plan

1. Characterize the legacy public form and upload flows with regression tests before extracting shared presentation.
2. Add v2 domain types, transport interface, error model, deterministic mock adapter, scenario fixtures, and contract tests.
3. Add the `/form-v2/[token]` route and session state machine against the mock adapter.
4. Add OTP/resend/expiry controls, atomic submit handling, terminal/recoverable states, and English/Simplified Chinese copy.
5. Make file upload routing version-aware and verify both route generations.
6. Run focused tests and frontend checks; keep mock mode explicit until the backend contract is available.
7. In a follow-up, map the finalized generated/public client in the real adapter, add mock/real contract-parity fixtures, disable mock mode in normal development if desired, and perform end-to-end mail/OTP testing. Rollback of this frontend change removes only `/form-v2`; v1 data and routes are unaffected.

## Open Questions

No question blocks the mock-first frontend implementation. Before switching to the real adapter, backend owners must confirm the exact Challenge Token field name, OTP shape/error codes, canonical form-definition branding fields, and how v2 mail links are generated; these differences remain isolated at the transport mapping boundary.

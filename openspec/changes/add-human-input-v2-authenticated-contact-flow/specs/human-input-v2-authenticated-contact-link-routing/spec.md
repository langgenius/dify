## ADDED Requirements

### Requirement: Contact approval links shall use one canonical frontend path

The frontend MUST define `/form-v2/contact/<form_token>` as the canonical authenticated Contact approval path. A shared path builder MUST encode `form_token` as exactly one path segment and MUST NOT add recipient identity, email, Contact type, tenant, or `auth_type` to the URL. The existing `/form-v2/<form_token>` path MUST remain the public Email-proof route.

#### Scenario: Build a Contact approval path

- **WHEN** the frontend builds a path for an opaque Contact token containing URL-sensitive characters
- **THEN** it MUST return `/form-v2/contact/<encoded-token>` with the token represented as one encoded path segment

#### Scenario: Public Email path remains distinct

- **WHEN** `/form-v2/email-token` is opened
- **THEN** routing MUST continue selecting the public Email-proof page and MUST NOT render the authenticated Contact page

#### Scenario: Contact path is opened directly

- **WHEN** `/form-v2/contact/contact-token` is opened from an Email or IM message
- **THEN** routing MUST enter the authenticated Contact page without requiring any preceding in-app navigation state

### Requirement: Signed-out Contact links shall round-trip through Dify sign-in

When the generated console definition request returns 401, the frontend MUST use the existing Dify Account sign-in flow with the complete same-origin Contact approval route as `redirect_url`. Successful authentication MUST return to that route and retry authorization through the console API. The flow MUST preserve the opaque token and MUST retain existing protection against unsafe external redirect targets.

#### Scenario: Signed-out approver opens a Contact link

- **WHEN** `/form-v2/contact/contact-token` receives a console 401
- **THEN** the browser MUST navigate to Dify sign-in with `/form-v2/contact/contact-token` as the encoded return target

#### Scenario: Sign-in succeeds

- **WHEN** authentication completes with a valid internal Contact approval return target
- **THEN** the browser MUST return to the original Contact route and start a fresh generated console definition request

#### Scenario: Return target includes an unsafe external origin

- **WHEN** sign-in receives a forged external `redirect_url`
- **THEN** existing redirect validation MUST reject it and MUST NOT navigate away from an allowed Dify origin

### Requirement: Route classification shall preserve all Human Input surfaces

The frontend route classifier MUST distinguish legacy form, public Email v2 form, authenticated Contact v2 form, and non-form paths. Consumers such as file upload MUST select behavior from that explicit route kind and MUST NOT collapse both v2 routes into one default transport.

#### Scenario: Classify all supported routes

- **WHEN** the classifier receives `/form/legacy-token`, `/form-v2/email-token`, and `/form-v2/contact/contact-token`
- **THEN** it MUST return distinct legacy, public-v2, and authenticated-contact-v2 kinds with the correct token

#### Scenario: Malformed Contact route is provided

- **WHEN** the classifier receives a missing-token or extra-segment Contact path
- **THEN** it MUST classify the path as non-form and MUST NOT expose a token to upload logic

#### Scenario: Base path prefixes the route

- **WHEN** Dify is deployed under a base path and the Contact route follows that prefix
- **THEN** the classifier MUST still identify the authenticated Contact route without treating the base path as identity data

### Requirement: Link-entry failures shall never switch authorization surfaces

The Contact link entry MUST remain bound to authenticated console authorization for its entire route lifecycle. A 403, 404, wrong-account response, wrong-surface token, unavailable response, or repeated retry MUST NOT navigate to the public route, call the public client, request Email OTP, or derive another URL from account/email matching.

#### Scenario: Signed-in wrong account opens a Contact link

- **WHEN** the console API rejects the current account for the delivery
- **THEN** the frontend MUST remain on the Contact route and show localized guidance without automatic public fallback

#### Scenario: Public token is pasted into a Contact link

- **WHEN** a public Email token is placed in `/form-v2/contact/<form_token>` and rejected by the console API
- **THEN** the frontend MUST stop on the normalized Contact-page error and MUST NOT reconstruct `/form-v2/<form_token>`

#### Scenario: Authenticated request is retried

- **WHEN** the user retries a recoverable Contact-page request
- **THEN** the frontend MUST repeat only the generated console operation for the same route token

### Requirement: Contact link tokens shall not enter unrelated client state

Apart from the canonical route, same-origin sign-in return target, and authenticated console request path, the frontend MUST NOT place the Contact token in analytics, logs, localStorage, sessionStorage, persisted query data, user-visible diagnostics, or identity lookups.

#### Scenario: Contact link is inspected after navigation and retry

- **WHEN** the user opens, signs into, and retries a Contact approval link
- **THEN** the token MUST remain absent from browser storage, analytics calls, logs, and displayed error text

### Requirement: Backend link production shall remain a documented handoff

The frontend MUST document `/form-v2/contact/<form_token>` as the target expected from message delivery for `auth_type=console`, but this change MUST NOT implement server-side Email/IM link generation or delivery selection.

#### Scenario: Frontend-only diff is reviewed

- **WHEN** the link-routing implementation is complete
- **THEN** the canonical Contact path and its direct-entry tests MUST exist while backend message-link generation remains unchanged

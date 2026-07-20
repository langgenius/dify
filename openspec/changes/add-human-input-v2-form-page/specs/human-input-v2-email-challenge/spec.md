## ADDED Requirements

### Requirement: A valid form load shall start exactly one automatic access request

After the current token's valid form definition loads, the frontend MUST invoke `POST /api/form/human-input/<form_token>/access-request` through the selected transport exactly once. It MUST disable automatic retry/refetch paths that could send duplicate Email OTP messages.

#### Scenario: First valid form load requests OTP

- **WHEN** the form definition for a token becomes available for the first time
- **THEN** the frontend MUST start one access request and expose a requesting state

#### Scenario: React rerenders do not resend

- **WHEN** the page rerenders, React Strict Mode replays effects, or local form values change
- **THEN** the frontend MUST NOT issue another automatic access request for the same loaded session

#### Scenario: Focus and reconnect do not resend

- **WHEN** the window regains focus or network reconnect handling runs after access success
- **THEN** the frontend MUST NOT refetch access-request or send another Email OTP

#### Scenario: Invalid form does not request access

- **WHEN** form loading is pending, fails, or reaches a terminal state
- **THEN** the frontend MUST NOT invoke access-request

### Requirement: Access success shall create an ephemeral challenge session

The access response MUST provide `challenge_token`, `resend_after_seconds`, and `expires_in_seconds`. The frontend MUST retain the token in page memory, derive absolute resend/expiry deadlines from one receipt timestamp, and expose an accessible OTP input without persisting proof data.

#### Scenario: Challenge is received

- **WHEN** access-request succeeds
- **THEN** the frontend MUST enter the awaiting-OTP state, retain the Challenge Token in memory, and start server-duration-based resend and expiry displays

#### Scenario: Browser was backgrounded

- **WHEN** the page resumes after the resend or expiry deadline passed while backgrounded
- **THEN** the derived state MUST immediately reflect the elapsed deadline rather than extending it by paused timer duration

#### Scenario: Challenge expires

- **WHEN** the current challenge reaches its expiry deadline before successful submit
- **THEN** the frontend MUST mark proof unusable, prevent submit, and require a new access request without automatically sending another email

### Requirement: Resend shall replace the entire proof session

The resend action MUST remain disabled until the server-provided cooldown expires. A successful resend MUST replace the Challenge Token and deadlines and MUST clear the prior OTP and proof-specific errors. Failed resend MUST not make an existing unexpired challenge unusable unless the server explicitly reports it invalid.

#### Scenario: Resend during cooldown

- **WHEN** the user attempts to resend before `resend_after_seconds` has elapsed
- **THEN** no access transport call MUST occur and the remaining cooldown MUST remain visible

#### Scenario: Resend succeeds

- **WHEN** cooldown elapsed and a new access request succeeds
- **THEN** the frontend MUST replace the prior Challenge Token, clear the OTP input, and use only the new resend and expiry deadlines

#### Scenario: Resend fails transiently

- **WHEN** resend returns a recoverable delivery or network error while the previous challenge is still unexpired
- **THEN** the page MUST show localized retry feedback and MUST preserve the still-valid previous proof state

### Requirement: Submit shall carry OTP and Challenge Token atomically

Every v2 public completion request MUST send processed `inputs`, selected `action`, `otp_code`, and the current `challenge_token` together to `POST /api/form/human-input/<form_token>`. A form token alone MUST never be treated by the frontend as sufficient submit proof.

#### Scenario: Submit valid proof

- **WHEN** form fields are valid, OTP is present, the challenge is unexpired, and an action is selected
- **THEN** the frontend MUST send one payload containing all four required values and the current route form token

#### Scenario: OTP is missing

- **WHEN** the user has not entered a validly shaped OTP
- **THEN** completion actions MUST remain disabled and no submit call MUST occur

#### Scenario: Challenge is missing or expired

- **WHEN** there is no usable Challenge Token
- **THEN** the frontend MUST reject submit locally and direct the user to request a new code

#### Scenario: Double action activation

- **WHEN** the user activates one or multiple form actions while submit is already pending
- **THEN** exactly one payload MUST be sent and later activations MUST be ignored

### Requirement: Proof errors shall preserve recoverable form work

The frontend MUST normalize invalid OTP, expired/stale Challenge Token, access delivery failure, cooldown/rate limit, network failure, and terminal task states. Recoverable proof errors MUST preserve entered form fields; terminal task states MUST stop all further mutations.

#### Scenario: OTP is incorrect

- **WHEN** submit reports invalid OTP while the Challenge Token remains valid
- **THEN** the page MUST retain form values and challenge, show an OTP-specific error, and allow the user to correct and resubmit

#### Scenario: Server rejects stale challenge

- **WHEN** submit reports an expired or replaced Challenge Token
- **THEN** the frontend MUST clear OTP and challenge proof, retain form values, and require a new access request

#### Scenario: Task completed concurrently

- **WHEN** submit reports the Human Input task was completed by another actor
- **THEN** the page MUST enter an already-completed terminal state and MUST not permit another access, upload, or submit operation

#### Scenario: Access request fails before proof exists

- **WHEN** the initial automatic access request fails recoverably
- **THEN** the page MUST preserve the loaded form, show an explicit manual retry, and MUST not retry automatically

### Requirement: OTP and Challenge Token shall remain confidential client state

The frontend MUST keep OTP and Challenge Token only in the current in-memory page session. It MUST NOT include them in URLs, analytics, logs, persisted query caches, browser storage, generic error text, or user-visible diagnostics, and MUST clear them after success or token change.

#### Scenario: Inspect persisted client state

- **WHEN** OTP has been entered and a Challenge Token received
- **THEN** neither value MUST appear in localStorage, sessionStorage, URL/search parameters, or persisted query data

#### Scenario: Submit succeeds

- **WHEN** the server or mock accepts the completion request
- **THEN** the frontend MUST clear OTP and Challenge Token before displaying success

#### Scenario: Route token changes with requests pending

- **WHEN** a response for the previous token arrives after navigation
- **THEN** the frontend MUST discard it and MUST not leak its Challenge Token into the new route session

### Requirement: Blocked backend operations shall have a contract-shaped mock transport

The frontend MUST provide an explicit development/test mock implementation of get-form, access-request, submit, and upload-token using the same feature transport interface as the real adapter. Mock mode MUST be selected only through a feature-owned development/test configuration or dependency injection and MUST NOT be activated by normal production failure or public URL input.

#### Scenario: Develop happy path without backend

- **WHEN** mock mode is explicitly enabled and a valid scenario token is loaded
- **THEN** the mock MUST return a form, issue a unique Challenge Token with cooldown/expiry metadata, accept only its configured OTP and current challenge, and return success without network access

#### Scenario: Exercise blocked/error paths

- **WHEN** a test selects an expired, submitted, not-found, rate-limited, delivery-failure, invalid-OTP, stale-challenge, or upload scenario
- **THEN** the mock MUST deterministically reproduce that state using an injectable clock and instance-scoped data

#### Scenario: Resend invalidates old mock challenge

- **WHEN** mock access-request succeeds for a second time after cooldown
- **THEN** the previous Challenge Token MUST no longer authorize mock submit

#### Scenario: Production real transport fails

- **WHEN** production selects the real adapter and the backend is unavailable
- **THEN** the page MUST show normalized unavailable/error feedback and MUST NOT silently fall back to mock data or accept a mock OTP

#### Scenario: Real contract becomes available

- **WHEN** finalized generated/public transport types are ready
- **THEN** implementation MUST be able to replace the real adapter DTO mapping without changing page components, session transitions, or mock scenario tests

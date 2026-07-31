## ADDED Requirements

### Requirement: Public Email runtime MUST keep Dynamic Email on the email-proof path
`/api/form/human-input/<form_token>` MUST serve `External contact` grants, one-time Email grants, and Dynamic Email grants that resolved as task-scoped EmailAddress subjects. Dynamic Email MUST remain on the same public email-proof path as one-time Email and MUST NOT be upgraded into authenticated Contact approval merely because a current Contact shares the same normalized email.

#### Scenario: Dynamic Email approver opens the public form
- **WHEN** one approver grant originated from Dynamic Email resolution
- **THEN** `GET /api/form/human-input/<form_token>` MUST serve that approver through the public email-proof surface

#### Scenario: Dynamic Email approver submits with OTP
- **WHEN** the same approver submits `POST /api/form/human-input/<form_token>` with a valid `otp_code` and `challenge_token`
- **THEN** the runtime MUST authorize it as an EmailAddress-backed proof path rather than a Contact-authenticated path

#### Scenario: Current Contact later shares the same email
- **WHEN** a current Contact now shares the normalized email of a Dynamic Email approver grant
- **THEN** the public runtime MUST continue treating that grant as email-proof only and MUST NOT accept Dify session approval as a substitute

### Requirement: Authenticated Contact runtime MUST stay limited to Contact-backed grants
`/console/api/form/human-input/<form_token>` MUST serve only Contact-backed approver grants such as `workspace contact` and `Platform contact`. The authenticated runtime MUST reject one-time Email and Dynamic Email grants even if those grants now share an email address with a current Contact.

#### Scenario: Contact-backed approver uses authenticated page
- **WHEN** a `workspace contact` or `Platform contact` opens and submits one approval task
- **THEN** the runtime MUST require Dify session validation and current Contact-backed grant validation

#### Scenario: One-time email token is presented to the authenticated runtime
- **WHEN** a one-time Email or Dynamic Email grant token is presented to `/console/api/form/human-input/<form_token>`
- **THEN** the authenticated runtime MUST reject it without invoking Contact-session approval logic

#### Scenario: Email overlap does not convert grant type
- **WHEN** an EmailAddress-backed grant shares a normalized email with a current Contact
- **THEN** the authenticated runtime MUST still reject Contact-session submission for that grant

### Requirement: Submission and audit contracts MUST preserve EmailAddress-backed actor semantics
When one public email-proof submission succeeds for a one-time Email or Dynamic Email grant, the submission contract MUST preserve EmailAddress-backed actor semantics. The runtime MUST NOT rewrite the actor or proof into Contact-backed audit data solely because a current Contact now exists with the same normalized email.

#### Scenario: Dynamic Email submission succeeds
- **WHEN** a Dynamic Email approver submits successfully through the public runtime with a valid OTP proof
- **THEN** the Submission actor MUST remain EmailAddress-backed and the authorization audit MUST retain email-proof semantics

#### Scenario: One-time Email submission succeeds after Contact overlap appears
- **WHEN** a one-time Email approver submits successfully after a current Contact begins using the same normalized email
- **THEN** the runtime MUST still persist an EmailAddress-backed authorization result

#### Scenario: Public runtime rejects Contact-session-only proof
- **WHEN** a caller presents only a Dify session without a valid email-proof challenge for a one-time Email or Dynamic Email grant
- **THEN** the public runtime MUST reject the submission

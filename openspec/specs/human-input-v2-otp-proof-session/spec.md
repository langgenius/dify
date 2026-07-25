# human-input-v2-otp-proof-session Specification

## Purpose
TBD - created by archiving change implement-human-input-v2-otp-proof-session. Update Purpose after archive.
## Requirements
### Requirement: OTP challenge MUST be an independent proof-session aggregate
The OTP challenge MUST enforce expiry, resend cooldown, send limit, attempt limit, verification and invalidation independently from Human Input form lifecycle.

#### Scenario: Challenge expires
- **WHEN** ten minutes pass after challenge issuance without successful verification
- **THEN** the challenge MUST become unusable and MUST return a stable expired result

#### Scenario: Resend is too early
- **WHEN** replacement is requested before the sixty-second cooldown has elapsed
- **THEN** the operation MUST reject replacement without incrementing the send count

#### Scenario: Send or attempt limit is reached
- **WHEN** the fifth allowed send or verification attempt has already been consumed
- **THEN** further sends or attempts MUST return the corresponding stable limit result

### Requirement: OTP replacement MUST leave exactly one usable challenge per grant scope
The persistence operation for `(form_id, approver_grant_id)` MUST atomically invalidate the previous pending challenge and create at most one replacement.

#### Scenario: OTP is resent
- **WHEN** an eligible approver requests a replacement after cooldown
- **THEN** the previous pending challenge MUST become unusable and exactly one current challenge MUST remain usable

#### Scenario: Concurrent resend requests occur
- **WHEN** two replacement requests run concurrently for the same form and grant
- **THEN** the grant-scoped transaction MUST commit at most one usable replacement

#### Scenario: Replacement write fails
- **WHEN** hashing, audit append or challenge persistence fails
- **THEN** invalidation and replacement writes MUST roll back together

### Requirement: OTP verification MUST exclude plaintext and produce limited proof
Plaintext OTP codes MUST NOT be persisted or returned by domain state. Successful verification MUST produce an immutable Email proof scoped to the challenge, form, grant and verified normalized Email.

#### Scenario: Valid code is verified
- **WHEN** the hash port confirms a valid code for a usable challenge
- **THEN** the challenge MUST record successful verification and return a proof that contains no plaintext code or reusable secret

#### Scenario: Raw code reaches submission authorization
- **WHEN** a caller attempts to use a raw OTP code as authorization proof
- **THEN** the submission boundary MUST reject it as unverified input

### Requirement: Verified OTP proof MUST still require current identity authorization
OTP verification MUST NOT by itself authorize form submission. Submission authorization MUST compare the proof with current grant subject and Email facts.

#### Scenario: Contact Email changes
- **WHEN** a Contact-backed OTP is verified for an Email that is no longer current at authorization time
- **THEN** submission authorization MUST reject the proof as stale

#### Scenario: External Contact is deleted and recreated
- **WHEN** an External Contact is deleted after challenge issuance and another Contact later uses the same Email
- **THEN** the old proof MUST NOT authorize the new Contact identity

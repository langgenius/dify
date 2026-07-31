## ADDED Requirements

### Requirement: Resend delivery MUST use an injectable narrow client boundary

The concrete Resend adapter MUST depend on a narrow injectable client that sends one Email with explicit credentials, sender, recipient, subject, body, deadline and idempotency key. Resend SDK models and exceptions MUST NOT escape the adapter.

#### Scenario: Unit test exercises the adapter

- **WHEN** adapter behavior is tested
- **THEN** a deterministic fake MUST represent acceptance, timeout, rate limit, concurrent idempotency, terminal rejection and malformed response without live credentials

### Requirement: Every Resend send MUST include one stable idempotency key

The adapter MUST include an `Idempotency-Key` for every `POST /emails` request. The key MUST be supplied by the rendered delivery request, MUST be stable for one logical delivery, MUST NOT contain recipient or credential material and MUST remain within the provider length limit.

#### Scenario: Same invocation is retried

- **WHEN** the runtime retries one logical delivery
- **THEN** the adapter MUST send the exact same idempotency key and request payload

#### Scenario: Separate logical delivery is sent

- **WHEN** a caller delivers another recipient or creates an explicit redelivery
- **THEN** the caller MUST supply a different idempotency key

### Requirement: Resend acceptance MUST return a safe provider receipt

A successful response MUST include a valid provider message ID. The adapter MUST map it to a strict safe receipt and MUST reject a success-shaped response that lacks or corrupts that identifier.

#### Scenario: Resend accepts an Email

- **WHEN** Resend returns a valid message ID
- **THEN** the adapter MUST return an accepted outcome containing only the provider name and message ID

#### Scenario: Success response is malformed

- **WHEN** the client returns no valid message ID
- **THEN** the adapter MUST return a sanitized provider-protocol failure

### Requirement: Resend failures MUST be classified for bounded retry

The adapter MUST classify network timeout, connection failure, `5xx`, `rate_limit_exceeded` and `concurrent_idempotent_requests` as retryable. Invalid or restricted credentials, invalid sender or domain, malformed request, quota exhaustion and `invalid_idempotent_request` MUST be terminal.

#### Scenario: Rate limit includes retry guidance

- **WHEN** Resend returns `rate_limit_exceeded` with a valid bounded `Retry-After`
- **THEN** the adapter MUST return a retryable outcome carrying that safe delay

#### Scenario: Concurrent idempotent request is reported

- **WHEN** Resend returns `concurrent_idempotent_requests`
- **THEN** the adapter MUST classify it as retryable with the same key and payload

#### Scenario: Idempotency key is reused with another payload

- **WHEN** Resend returns `invalid_idempotent_request`
- **THEN** the adapter MUST return a terminal invariant failure

#### Scenario: Account quota is exhausted

- **WHEN** Resend returns daily or monthly quota exhaustion
- **THEN** the adapter MUST return a terminal safe failure rather than retrying inside the invocation

### Requirement: Resend requests and short retries MUST be bounded

Every Resend request MUST have an explicit deadline. One runtime invocation MUST bound retry count, delay and total elapsed time, honor only safe bounded retry guidance and avoid sleeping while database resources are open.

#### Scenario: Resend does not respond

- **WHEN** one request exceeds its deadline
- **THEN** the adapter MUST cancel or abandon that request and return a retryable timeout outcome

#### Scenario: Retry-After exceeds runtime policy

- **WHEN** provider retry guidance is negative, malformed or above the configured maximum
- **THEN** the runtime MUST ignore or clamp it according to the bounded short-retry policy

#### Scenario: Short retry budget is exhausted

- **WHEN** no further retry fits within the current invocation budget
- **THEN** the runtime MUST return a retryable outcome without scheduling durable work

### Requirement: Resend credentials and raw responses MUST never cross the adapter boundary

The API key, authorization headers, recipient-bearing payload, raw response body and exception representation MUST be absent from outcomes, logs, metrics and persisted diagnostics.

#### Scenario: Client raises an exception containing request data

- **WHEN** a client exception includes credentials, headers or the request payload
- **THEN** the adapter MUST replace it with a stable safe classification before logging or returning

#### Scenario: Credential-safe representation is inspected

- **WHEN** resolved provider settings, adapter requests or failures are represented for debugging
- **THEN** no plaintext or protected credential value MAY appear

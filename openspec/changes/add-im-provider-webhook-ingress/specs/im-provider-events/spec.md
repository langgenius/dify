## MODIFIED Requirements

### Requirement: WebhookRequest and WebhookResponse MUST be framework-neutral
`WebhookRequest` MUST carry the uppercase HTTP method, exact body bytes before decoding, trusted local receive time and the ordered header field-values exposed separately by the HTTP framework. The HTTP boundary MUST preserve duplicate header fields when the framework exposes them separately. It MUST NOT split a comma-coalesced field, reconstruct duplicate boundaries or claim wire-level ordering that WSGI did not preserve. Provider authentication headers defined as singleton values MUST fail authentication when the framework exposes multiple values or when a coalesced value does not validate as one complete Provider value. `WebhookResponse` MUST carry status code, ordered response headers and exact response body bytes. Neither value MUST expose framework request or response objects.

#### Scenario: Provider signature covers exact request bytes
- **WHEN** a Webhook request is adapted from an HTTP framework
- **THEN** the `WebhookRequest` body MUST preserve the exact bytes required for Provider verification

#### Scenario: Framework exposes duplicate headers separately
- **WHEN** the HTTP framework exposes multiple field-values for the same header name
- **THEN** the controller MUST preserve those values and their framework-visible order in `WebhookRequest.headers`

#### Scenario: WSGI coalesces duplicate authentication headers
- **WHEN** the WSGI server exposes repeated authentication headers as one coalesced field-value
- **THEN** the controller MUST pass that field-value without splitting or reconstruction
- **AND** the Provider verifier MUST NOT select one apparent sub-value as authoritative

#### Scenario: Provider returns a challenge or acknowledgement
- **WHEN** a Webhook handler completes request processing
- **THEN** its `WebhookResponse` MUST contain all response facts needed by the HTTP boundary

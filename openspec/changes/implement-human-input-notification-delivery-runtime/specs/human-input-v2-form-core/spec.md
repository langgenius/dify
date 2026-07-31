## MODIFIED Requirements

### Requirement: Delivery facts MUST not control form lifecycle

Delivery attempts and endpoint-scoped upload capabilities MUST remain independent from form lifecycle. Attempts MUST be append-oriented across distinct logical provider invocations, while one attempt MAY perform controlled `QUEUED`, `SENDING`, `SENT` and `FAILED` transitions for dispatch of the same protected rendered request. Retry of one invocation MUST reuse the same attempt identity; a new attempt number requires the previous attempt to be terminal.

#### Scenario: Delivery attempt fails

- **WHEN** an Email or IM delivery attempt fails
- **THEN** it MUST record safe diagnostics and the form MUST remain in its current lifecycle state

#### Scenario: Attempt is retried

- **WHEN** one provider invocation receives a retryable outcome
- **THEN** the same attempt MAY transition from `SENDING` to `QUEUED`
- **AND** no new attempt number MAY be created for that retry

#### Scenario: New logical redelivery is requested

- **WHEN** an explicit redelivery is requested after the current attempt is terminal
- **THEN** the next attempt number MAY be appended without changing form lifecycle

#### Scenario: Upload capability is used

- **WHEN** a file is associated through an endpoint-scoped upload token
- **THEN** the association MUST remain scoped to that form and endpoint and MUST NOT grant submission authority

### Requirement: Form persistence MUST expose aggregate-oriented operations

Form persistence ports MUST own atomic form creation with initial protected notification attempts and controlled attempt transitions, use explicit mappers and load only the graph required by each operation. Provider I/O MUST remain outside repository sessions and transactions.

#### Scenario: Form and approval plan are persisted

- **WHEN** a v2 form with supported Email endpoints is created
- **THEN** one transaction MUST persist the form, grants, endpoints, token hashes, initial attempts and protected rendered requests or roll back all of them

#### Scenario: Structured values round-trip

- **WHEN** frozen definition, endpoint configuration, protected rendered request, safe snapshot or safe outcome is stored and loaded
- **THEN** strict immutable values MUST round-trip without exposing mutable raw dictionaries or plaintext notification content

#### Scenario: Form graph is loaded

- **WHEN** an application operation loads form-scoped relationships
- **THEN** the adapter MUST use explicit eager loading and query-count assertions MUST prevent hidden N+1 access

#### Scenario: Due attempt is claimed

- **WHEN** a worker claims a queued attempt
- **THEN** persistence MUST atomically verify complete workspace/form/endpoint ownership and current status
- **AND** it MUST commit the sending transition before provider I/O

#### Scenario: Attempt is completed concurrently

- **WHEN** two workers try to complete one claim
- **THEN** at most one compare-and-swap terminal update MUST commit

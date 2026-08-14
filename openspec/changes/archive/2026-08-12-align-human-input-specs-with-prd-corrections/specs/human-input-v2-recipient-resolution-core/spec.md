## MODIFIED Requirements

### Requirement: Recipient resolution MUST produce one canonical approval plan
Resolution MUST validate values, resolve current identities, canonicalize subjects, retain matched sources, select delivery endpoints, and retain machine-readable rejected-recipient facts in one result. Dynamic Email MUST always resolve as a task-scoped EmailAddress subject when it yields a valid email value. The resolver MUST NOT promote Dynamic Email into a Contact approver merely because the normalized email matches a current Contact.

#### Scenario: Multiple sources resolve to one Contact
- **WHEN** a static Contact and current initiator resolve to the same Contact
- **THEN** the plan MUST contain one Contact approver with every matched source

#### Scenario: Dynamic Email matches a current Contact email
- **WHEN** a valid normalized Dynamic Email equals the current email of an existing Contact
- **THEN** the plan MUST still contain one EmailAddress approver and MUST NOT rewrite the recipient into a Contact approver

#### Scenario: Dynamic Email does not match a Contact
- **WHEN** a valid normalized Dynamic Email does not match the directory snapshot
- **THEN** the plan MUST contain one EmailAddress approver and one Email endpoint plan

#### Scenario: One recipient is invalid
- **WHEN** one recipient value is invalid and another recipient resolves successfully
- **THEN** the plan MUST retain a typed rejection for the invalid value and MUST retain the valid approver

### Requirement: Canonical subject identity MUST remain independent from delivery channels
The resolver MUST deduplicate by canonical Contact, EndUser, or EmailAddress subject key, not by recipient source or channel. One approver MUST support multiple matched sources and endpoint plans. Distinct Contact-backed and EmailAddress-backed recipients that happen to share one normalized email MUST remain distinct approvers; endpoint-level delivery deduplication MUST NOT collapse them into one authorization subject.

#### Scenario: Contact has Email and IM delivery
- **WHEN** a Contact has a deliverable Email and an effective IM binding
- **THEN** the plan MUST contain one approver with parallel Email and IM endpoint plans

#### Scenario: Repeated Email values normalize equally
- **WHEN** repeated recipient values normalize to the same EmailAddress subject
- **THEN** the plan MUST contain one approver while retaining the applicable source facts

#### Scenario: Contact and one-time Email share the same normalized email
- **WHEN** one Contact-backed recipient and one EmailAddress-backed recipient share a normalized email in one preserved configuration
- **THEN** the plan MUST preserve them as two distinct approvers because their canonical subject keys differ

#### Scenario: Approver has no usable endpoint
- **WHEN** an approver has no usable delivery or interaction endpoint and no other approver remains
- **THEN** resolution MUST return the stable no-valid-recipients result

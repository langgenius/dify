## ADDED Requirements

### Requirement: Human Input form domain MUST remain independent from transport and ORM models
Form, grant, endpoint and delivery domain behavior MUST use pure domain values. Persistence records MUST be explicitly mapped and MUST NOT escape repository adapters.

#### Scenario: Form transition is tested
- **WHEN** active-state or selected-action behavior is exercised in a unit test
- **THEN** the test MUST run without Flask or a database engine

#### Scenario: Form record is loaded
- **WHEN** a repository loads form-scoped records
- **THEN** it MUST return domain state or an application read model rather than ORM instances

### Requirement: HumanInputForm MUST own local lifecycle invariants
`HumanInputForm` MUST directly own waiting, submitted, timed-out and expired state checks, global expiry, grant membership, selected-action validation and transition decisions. The design MUST NOT introduce a pass-through lifecycle object.

#### Scenario: Active form accepts a valid transition decision
- **WHEN** a waiting non-expired form receives a valid grant and selected action
- **THEN** the aggregate MUST produce a submission transition decision without claiming that persistence has committed

#### Scenario: Form is no longer active
- **WHEN** the form is submitted, timed out, status-expired or globally expired
- **THEN** the aggregate MUST return the corresponding stable transport-neutral form-state result

#### Scenario: Action is invalid
- **WHEN** a selected action is not present in the frozen form definition
- **THEN** the aggregate MUST reject the transition without mutating state

### Requirement: Grant, subject snapshot and delivery endpoint MUST remain distinct
Form creation MUST freeze approver grants, minimal subject snapshots and delivery endpoints as separate concepts. A grant records candidate authority at creation time; an endpoint records an interaction location and MUST NOT independently prove current submission authority.

#### Scenario: Resolved plan creates a form
- **WHEN** a deterministic `ResolvedApprovalPlan` is used to create a form
- **THEN** each canonical approver MUST create one grant with its matched sources and zero or more separate endpoint snapshots

#### Scenario: Endpoint token is available
- **WHEN** a valid endpoint token can read or interact with a form definition
- **THEN** the token MUST NOT become a verified proof or submission actor

#### Scenario: Historical subject changes
- **WHEN** the current Contact or Email later changes or is deleted
- **THEN** the frozen grant/endpoint snapshots MUST remain available for history but MUST NOT be treated as current authority

### Requirement: Delivery facts MUST not control form lifecycle
Delivery attempts and endpoint-scoped upload capabilities MUST be append-oriented facts whose failures do not directly mutate the form status.

#### Scenario: Delivery attempt fails
- **WHEN** an Email or IM delivery attempt fails
- **THEN** the attempt MUST record failure diagnostics and the form MUST remain in its current lifecycle state

#### Scenario: Upload capability is used
- **WHEN** a file is associated through an endpoint-scoped upload token
- **THEN** the association MUST remain scoped to that form and endpoint and MUST NOT grant submission authority

### Requirement: Form persistence MUST expose aggregate-oriented operations
Form persistence ports MUST own atomic form creation and append-oriented delivery writes, use explicit mappers and load only the graph required by each operation.

#### Scenario: Form and approval plan are persisted
- **WHEN** a new form is created from a resolved plan
- **THEN** one transaction MUST persist the form, grants and endpoints or roll back all of them

#### Scenario: Structured values round-trip
- **WHEN** frozen definition, matched sources or endpoint configuration is stored and loaded
- **THEN** strict immutable structured values MUST round-trip without exposing mutable raw dictionaries

#### Scenario: Form graph is loaded
- **WHEN** an application operation loads form-scoped relationships
- **THEN** the adapter MUST use explicit eager loading and query-count assertions MUST prevent hidden N+1 access

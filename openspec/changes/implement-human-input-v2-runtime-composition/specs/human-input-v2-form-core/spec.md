## MODIFIED Requirements

### Requirement: HumanInputForm MUST own local lifecycle invariants

`HumanInputForm` MUST directly own waiting, submitted, timed-out and expired state checks, global expiry, grant membership, selected-action validation and transition decisions. A runtime form MUST contain one immutable `RuntimeFormOwner` with `workflow_run_id` and `workflow_node_execution_id`; it MUST NOT require or persist a `workflow_pause_id`. A delivery-test form MUST NOT contain a `RuntimeFormOwner`. The design MUST NOT introduce a pass-through lifecycle object.

#### Scenario: Active form accepts a valid transition decision

- **WHEN** a waiting non-expired form receives a valid grant and selected action
- **THEN** the aggregate MUST produce a submission transition decision without claiming that persistence has committed

#### Scenario: Runtime owner is valid

- **WHEN** a v2 runtime form is created
- **THEN** both `workflow_run_id` and `workflow_node_execution_id` MUST be present
- **AND** `workflow_node_execution_id` MUST identify the primary key of the owning `workflow_node_executions` row

#### Scenario: One workflow run contains parallel Human Input nodes

- **WHEN** two parallel v2 Human Input node executions in one workflow run enter HITL
- **THEN** the run MUST own two distinct forms through their distinct workflow node execution identities
- **AND** one later workflow pause MUST be able to persist both form-backed HITL reasons

#### Scenario: Delivery-test form has no workflow owner

- **WHEN** a delivery-test v2 form is created outside workflow execution
- **THEN** its domain form MUST have no `RuntimeFormOwner`
- **AND** both persisted workflow owner columns MUST be absent
- **AND** the form MUST NOT acquire a synthetic workflow pause or node execution identity

#### Scenario: Form is no longer active

- **WHEN** the form is submitted, timed out, status-expired or globally expired
- **THEN** the aggregate MUST return the corresponding stable transport-neutral form-state result

#### Scenario: Action is invalid

- **WHEN** a selected action is not present in the frozen form definition
- **THEN** the aggregate MUST reject the transition without mutating state

### Requirement: Form persistence MUST expose aggregate-oriented operations

Form persistence ports MUST own form graph creation, use explicit mappers and load only the graph required by each operation. Runtime form creation MUST accept one `FormCreation` only after the serialized runtime entry has confirmed that the owner has no form. One transaction MUST persist the form, grants and endpoints or roll back all of them. Runtime provisioning MUST NOT create `DeliveryAttempt` records in that transaction. Delivery attempts and Provider outcomes MUST be persisted by the asynchronous delivery Worker and MUST NOT extend the Form lifecycle state.

#### Scenario: Form and approval plan are persisted

- **WHEN** a new non-runtime form is created from a resolved plan
- **THEN** persistence MUST return success only after the form, grants and endpoints are complete
- **AND** repeated execution MUST NOT create duplicate form, grant or endpoint records

#### Scenario: Runtime form graph is first created

- **WHEN** no form exists for one tenant and workflow node execution owner
- **THEN** one transaction MUST persist the form, grants and endpoints
- **AND** any write failure MUST roll back the complete creation

#### Scenario: Runtime owner uniqueness conflicts

- **WHEN** form creation encounters an existing complete graph for the same workflow node execution owner despite the serialized entry precondition
- **THEN** persistence MUST report an invariant violation
- **AND** it MUST NOT return the existing graph as a successful creation result

#### Scenario: Asynchronous delivery attempt fails after form creation

- **WHEN** the Worker records a delivery failure after the runtime form graph is complete
- **THEN** the form MUST remain waiting
- **AND** the Worker MUST persist the attempt outcome as an append-oriented delivery fact
- **AND** the system MUST NOT add a Form sending status

#### Scenario: Two forms share a workflow run

- **WHEN** two different workflow node executions belong to one workflow run
- **THEN** persistence MUST allow both runtime forms because `workflow_run_id` is not a unique form owner
- **AND** each `workflow_node_execution_id` MUST remain unique

#### Scenario: Structured values round-trip

- **WHEN** frozen definition, matched sources or endpoint configuration is stored and loaded
- **THEN** strict immutable structured values MUST round-trip without exposing mutable raw dictionaries

#### Scenario: Form graph is loaded

- **WHEN** an application operation loads form-scoped relationships
- **THEN** the adapter MUST use explicit eager loading and query-count assertions MUST prevent hidden N+1 access

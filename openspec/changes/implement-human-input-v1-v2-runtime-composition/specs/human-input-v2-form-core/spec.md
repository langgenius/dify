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

Form persistence ports MUST own form graph creation and append-oriented delivery writes, use explicit mappers and load only the graph required by each operation. Runtime form creation MUST expose an owner-scoped create-once operation that establishes one complete form, grant and endpoint graph before returning a ready result. A persistence adapter MAY commit the complete graph in one transaction. An adapter that uses multiple commits MUST idempotently complete or reject a partial graph without creating duplicate records. Initial delivery attempts and provider outcomes MUST remain append-oriented operational facts owned behind `FormSending`; they MUST NOT extend the Form lifecycle state.

#### Scenario: Form and approval plan are persisted

- **WHEN** a new non-runtime form is created from a resolved plan
- **THEN** persistence MUST return success only after the form, grants and endpoints are complete
- **AND** repeated execution MUST NOT create duplicate form, grant or endpoint records

#### Scenario: Runtime form graph is first created

- **WHEN** no form exists for one tenant and workflow node execution owner
- **THEN** persistence MUST establish one complete form, grant and endpoint graph for that owner
- **AND** it MUST NOT require all three record kinds to commit in one transaction

#### Scenario: Runtime form graph already exists

- **WHEN** create-once is repeated for the same workflow node execution owner
- **THEN** the operation MUST return the complete existing graph without creating duplicate form, grant or endpoint records
- **AND** it MUST complete or reject an existing partial graph rather than returning it as ready

#### Scenario: Initial delivery fails after form creation

- **WHEN** `FormSending` cannot deliver one or more sender operations after the create-once winner commits
- **THEN** the form MUST remain waiting
- **AND** each attempted sender outcome MUST be recorded as an append-oriented delivery fact
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

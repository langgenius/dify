## MODIFIED Requirements

### Requirement: HumanInputForm MUST own local lifecycle invariants

`HumanInputForm` MUST directly own waiting, submitted, timed-out and expired state checks, global expiry, grant membership, selected-action validation and transition decisions. A runtime form MUST be owned by its `workflow_run_id` and `workflow_node_execution_id`; it MUST NOT require or persist a `workflow_pause_id`. The design MUST NOT introduce a pass-through lifecycle object.

#### Scenario: Runtime owner is valid

- **WHEN** a v2 runtime form is created
- **THEN** both `workflow_run_id` and `workflow_node_execution_id` MUST be present
- **AND** `workflow_node_execution_id` MUST identify the primary key of the owning `workflow_node_executions` row

#### Scenario: One workflow run contains parallel Human Input nodes

- **WHEN** two parallel v2 Human Input node executions in one workflow run enter HITL
- **THEN** the run MUST own two distinct forms through their distinct workflow node execution identities
- **AND** one later workflow pause MUST be able to persist both form-backed HITL reasons

#### Scenario: Form is no longer active

- **WHEN** the form is submitted, timed out, status-expired or globally expired
- **THEN** the aggregate MUST return the corresponding stable transport-neutral form-state result

### Requirement: Grant, subject snapshot and delivery endpoint MUST remain distinct

Form creation MUST freeze approver grants, minimal subject snapshots and delivery endpoints as separate concepts. A grant records candidate authority at creation time; an endpoint records an interaction location and MUST NOT independently prove current submission authority. Interaction surfaces MUST be derived from resolved endpoint plans and persisted endpoints rather than a form-level `display_in_ui` flag.

#### Scenario: Resolved plan creates a form

- **WHEN** a deterministic `ResolvedApprovalPlan` is used to create a form
- **THEN** each canonical approver MUST create one grant with its matched sources and zero or more separate endpoint snapshots

#### Scenario: Interaction capability is projected

- **WHEN** a compatibility consumer needs SSE/pause `display_in_ui`
- **THEN** it MUST derive that value from the endpoint capabilities relevant to its surface
- **AND** the derived value MUST NOT create, remove or reinterpret any endpoint

#### Scenario: Form aggregate is inspected

- **WHEN** the v2 form aggregate or form-definition read projection is constructed
- **THEN** it MUST NOT contain an authoritative `display_in_ui` business-policy field

### Requirement: Form persistence MUST expose aggregate-oriented operations

Form persistence ports MUST own atomic form creation and append-oriented delivery writes, use explicit mappers and load only the graph required by each operation. Runtime form creation MUST expose an atomic owner-scoped create-once operation covering the form, grants, endpoints and initial delivery attempts.

#### Scenario: Runtime form graph is first created

- **WHEN** no form exists for one workspace and workflow node execution owner
- **THEN** one transaction MUST persist the form, grants, endpoints and initial attempts or roll back all of them

#### Scenario: Runtime form graph already exists

- **WHEN** create-once is repeated for the same workflow node execution owner
- **THEN** the operation MUST return the existing form graph without creating any child or attempt again

#### Scenario: Two forms share a workflow run

- **WHEN** two different workflow node executions belong to one workflow run
- **THEN** persistence MUST allow both runtime forms because `workflow_run_id` is not a unique form owner
- **AND** each `workflow_node_execution_id` MUST remain unique

#### Scenario: Structured values round-trip

- **WHEN** frozen definition, matched sources or endpoint configuration is stored and loaded
- **THEN** strict immutable structured values MUST round-trip without exposing mutable raw dictionaries

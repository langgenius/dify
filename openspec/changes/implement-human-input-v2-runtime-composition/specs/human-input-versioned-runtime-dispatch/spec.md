## ADDED Requirements

### Requirement: Human Input runtime MUST dispatch the raw persisted version strictly

The workflow runtime MUST inspect the raw persisted `version` before shared node-data coercion. Missing `version` and exact string `"1"` MUST resolve to the legacy Human Input node class. Exact string `"2"` MUST resolve to an independent Human Input v2 node class. Every other string or non-string value MUST fail with `HumanInputNodeVersionError` and stable code `invalid_human_input_node_version` before node execution, form creation, delivery materialization or pause entry. Human Input resolution MUST NOT convert the raw value with `str(...)` or use the registry `latest` fallback for an unsupported version.

#### Scenario: Missing version resolves to v1

- **WHEN** raw persisted Human Input node data omits `version`
- **THEN** the runtime MUST validate and execute it through the existing v1 node class and callback

#### Scenario: Exact string 2 resolves to the independent v2 node

- **WHEN** raw persisted Human Input node data contains `version: "2"`
- **THEN** the runtime MUST validate it with the strict v2 node-data model and construct the registered v2 node class
- **AND** it MUST NOT invoke legacy node-data validation or parse legacy `delivery_methods`

#### Scenario: Non-string version is rejected before coercion

- **WHEN** raw persisted Human Input node data contains a number, boolean, `null`, mapping or list as `version`
- **THEN** the runtime MUST return the stable Human Input configuration error before Pydantic or registry lookup can coerce that value

#### Scenario: Unsupported string does not resolve as latest

- **WHEN** raw persisted Human Input node data contains a string other than `"1"` or `"2"`
- **THEN** the runtime MUST reject it and MUST NOT resolve the Human Input registry `latest` node class

### Requirement: Human Input v1 implementation MUST remain unchanged

This change MUST NOT modify Human Input v1 node data, node class, callback composition, form repository, delivery behavior, submission behavior or public contract. Shared dispatch code MAY add an exact v2 branch, but missing version and exact string `"1"` MUST continue through the existing legacy validation and callback construction path without a new v1 binding, adapter or runtime application.

#### Scenario: Missing version executes after v2 support is installed

- **WHEN** an existing Human Input node omits `version`
- **THEN** the runtime MUST construct the same legacy node class and `DifyHITLCallback` composition used before this change
- **AND** no v2 runtime protocol or `RuntimeFormProvisioner` operation may execute

#### Scenario: Exact v1 executes after v2 support is installed

- **WHEN** a Human Input node contains exact string `version: "1"`
- **THEN** its validation, pause/reload, delivery, submission and output behavior MUST remain unchanged
- **AND** the implementation MUST NOT require a new v1 adapter or binding

### Requirement: Human Input v2 MUST be a separately registered workflow node class

The Human Input v2 node MUST register under `type: human-input` with exact version `"2"` and strict v2 node data. The v2 class MAY implement the version-neutral Graphon HITL decision protocol already used by v1, but it MUST NOT change or replace v1 validation or callback composition.

#### Scenario: Registry contains both Human Input versions

- **WHEN** production workflow nodes are bootstrapped
- **THEN** `human-input@1` MUST resolve to the existing Graphon Human Input class
- **AND** `human-input@2` MUST resolve to the Dify-owned Human Input v2 class

#### Scenario: V2 callback is built

- **WHEN** `NodeFactory` constructs a `human-input@2` node
- **THEN** it MUST inject the v2 HITL callback composition selected by the v2 runtime binding
- **AND** it MUST NOT construct the legacy callback as an intermediate adapter

### Requirement: Node and HITL callback external effects MUST be injected through ports

The Human Input v2 Node MUST perform external work only through its injected HITL callback. The v2 callback MUST convert strict v2 node data and callback runtime context into one runtime entry request and call only the injected `HumanInputV2Runtime` protocol. Neither layer MAY directly construct or access ORM records, SQLAlchemy sessions, controller state, recipient snapshots, delivery materialization internals, Celery tasks, global database handles, repository implementations or service locators.

#### Scenario: V2 node executes

- **WHEN** the Human Input v2 node evaluates its HITL state
- **THEN** the node MUST call only the injected version-neutral HITL callback protocol

#### Scenario: V2 callback enters runtime state

- **WHEN** the callback needs to create or reload one runtime form
- **THEN** it MUST call the injected `HumanInputV2Runtime` protocol once
- **AND** it MUST NOT receive a persistence result, recipient snapshot, `FormCreation`, delivery command, scheduler or Worker state

### Requirement: RuntimeFormProvisioner MUST hide new-form provisioning

The v2 runtime application MUST establish a missing runtime form through one injected `RuntimeFormProvisioner` interface. The provisioner MUST own recipient snapshot reads, `ResolvedApprovalPlan` construction, `FormCreation` construction, missing-form persistence and post-commit delivery scheduling. It MUST return the newly persisted `HumanInputForm` without returning `FormCreation`, persistence results, delivery commands, Worker state, Provider adapters or credentials to the runtime application or callback.

#### Scenario: A new runtime form is provisioned

- **WHEN** no form exists for the runtime owner and `HumanInputV2Runtime` invokes `RuntimeFormProvisioner`
- **THEN** the provisioner MUST persist the form, grants and endpoints in one transaction
- **AND** it MUST call `FormDeliveryScheduler.schedule(form_ref)` only after that transaction commits

#### Scenario: Delivery is scheduled asynchronously

- **WHEN** the persisted runtime form graph is ready
- **THEN** `RuntimeFormProvisioner` MUST schedule delivery without waiting for a per-endpoint result
- **AND** the Worker MUST own delivery fanout, attempt persistence, Provider I/O and outcome persistence

#### Scenario: Asynchronous delivery fails

- **WHEN** delivery scheduling, attempt execution or Provider I/O fails after the form transaction commits
- **THEN** the callback MUST still use the persisted waiting form as a valid `PauseRequested` state
- **AND** the failure MUST NOT change the current node entry outcome or Form lifecycle

#### Scenario: Runtime owner uniqueness conflicts during provisioning

- **WHEN** persistence reports that the runtime owner already has a form after the entry-start read reported none
- **THEN** `RuntimeFormProvisioner` MUST fail with an invariant violation
- **AND** it MUST NOT reinterpret the conflict as a normal existing-form result

### Requirement: V2 callback entry MUST branch once on persisted owner state

The Graph runtime MUST serialize callback execution for the same `workflow_node_execution_id`. For each entry, `HumanInputV2Runtime` MUST first read the persisted runtime form by owner. It MUST use that read to choose exactly one branch: evaluate the existing frozen entry or invoke `RuntimeFormProvisioner` for an absent form. It MUST NOT retry provisioning as an existing-form path after a uniqueness conflict, and it MUST NOT wait for asynchronous delivery outcomes before returning the callback decision.

#### Scenario: Waiting callback is entered again

- **WHEN** the callback is invoked again for a node execution whose v2 form already exists and remains waiting
- **THEN** it MUST return `PauseRequested` with the same form-backed session identity
- **AND** `HumanInputV2Runtime` MUST NOT invoke `RuntimeFormProvisioner`

#### Scenario: First callback entry has no form

- **WHEN** the entry-start owner read finds no runtime form
- **THEN** `HumanInputV2Runtime` MUST invoke `RuntimeFormProvisioner` once
- **AND** it MUST use the provisioned form as the waiting callback state

#### Scenario: Same node execution is invoked concurrently

- **WHEN** two callback executions for the same `workflow_node_execution_id` would overlap
- **THEN** the Graph runtime MUST serialize them before either enters `HumanInputV2Runtime`

### Requirement: Frozen v2 lifecycle state MUST determine the callback outcome

The v2 callback contract MUST decide waiting, submitted and node-timeout outcomes from persisted frozen runtime facts and an injected clock without re-reading authoring recipients, form blocks, actions or endpoints. A waiting form MUST request pause with the same form-backed session identity. A submitted form MUST construct its completion decision only from persisted `selected_action_id`, `input_snapshot`, `canonical_values` and the frozen form definition. A node timeout MUST select the `__timeout` branch. A globally expired form MUST NOT resume through the node-timeout branch; global-expiry orchestration MUST terminate the workflow outside the callback, and callback re-entry for a globally expired form MUST be rejected as an invalid resume state. This change does not require production controller, scheduler, workflow-stop or resume-task wiring that invokes these entries.

#### Scenario: Frozen waiting form is reloaded

- **WHEN** the injected runtime port returns a v2 form that remains waiting
- **THEN** the callback MUST return `PauseRequested` with the same form-backed session identity

#### Scenario: Frozen submitted outcome is reloaded

- **WHEN** the injected runtime port returns a committed submission outcome
- **THEN** the callback MUST return `Completed` using persisted `selected_action_id`, `input_snapshot`, `canonical_values` and the frozen form definition
- **AND** it MUST NOT resolve current authoring configuration to rebuild that outcome

#### Scenario: Frozen node timeout is reloaded

- **WHEN** the injected runtime port returns a v2 form whose frozen node timeout has elapsed
- **THEN** the callback MUST return the timeout decision with selected handle `__timeout`

#### Scenario: Frozen global expiry is reloaded

- **WHEN** the injected runtime port returns a v2 form whose frozen global expiry has elapsed
- **THEN** the callback MUST reject re-entry as an invalid resume state
- **AND** it MUST NOT return `Expired`, select `__timeout` or produce any other branch selection

#### Scenario: Production trigger is absent

- **WHEN** this change is validated without controller, scheduler, workflow-stop or workflow resume-task adapters
- **THEN** callback tests MUST exercise submitted, node-timeout and invalid global-expiry re-entry through an injected fake runtime port
- **AND** production trigger wiring MUST remain an explicit follow-up

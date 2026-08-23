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

### Requirement: Human Input v2 MUST be a separately registered workflow node class

The Human Input v2 node MUST register under `type: human-input` with exact version `"2"` and strict v2 node data. The v1 and v2 classes MAY share the version-neutral Graphon HITL decision protocol, but MUST NOT share version-specific validation or callback composition.

#### Scenario: Registry contains both Human Input versions

- **WHEN** production workflow nodes are bootstrapped
- **THEN** `human-input@1` MUST resolve to the existing Graphon Human Input class
- **AND** `human-input@2` MUST resolve to the Dify-owned Human Input v2 class

#### Scenario: V2 callback is built

- **WHEN** `NodeFactory` constructs a `human-input@2` node
- **THEN** it MUST inject the v2 HITL callback composition selected by the v2 runtime binding
- **AND** it MUST NOT construct the legacy callback as an intermediate adapter

### Requirement: Node and HITL callback external effects MUST be injected through ports

The Human Input v2 Node MUST perform external work only through its injected HITL callback. The v2 callback MUST convert strict v2 node data and callback runtime context into one runtime entry request and call only the injected `HumanInputV2Runtime` protocol. Neither layer MAY directly construct or access ORM records, SQLAlchemy sessions, controller state, recipient snapshots, provider capabilities, sender lists, Celery tasks, global database handles, repository implementations or service locators.

#### Scenario: V2 node executes

- **WHEN** the Human Input v2 node evaluates its HITL state
- **THEN** the node MUST call only the injected version-neutral HITL callback protocol

#### Scenario: V2 callback enters runtime state

- **WHEN** the callback needs to create or reload one runtime form
- **THEN** it MUST call the injected `HumanInputV2Runtime` protocol once
- **AND** it MUST NOT receive a persistence create result, recipient snapshot, delivery capability or sender list

### Requirement: FormSending MUST hide recipient resolution and delivery fanout

The v2 runtime application MUST expose delivery through one injected `FormSending` interface. `FormSending` MUST own recipient snapshot reads, `ResolvedApprovalPlan` construction, owner-scoped form graph create-once, internal sender selection, sender fanout and Email/IM delivery policy. It MUST return the winning persisted runtime form without returning sender objects, Provider adapters, credentials or Provider-specific outcomes to the callback.

#### Scenario: A new runtime form is sent

- **WHEN** no form exists for the runtime owner and `HumanInputV2Runtime` invokes `FormSending`
- **THEN** `FormSending` MUST establish one complete form, grant and endpoint graph for that owner
- **AND** only a create-once winner with a complete graph MUST execute internal sender fanout

#### Scenario: Form graph persistence uses multiple commits

- **WHEN** a persistence adapter does not commit the form, grants and endpoints in one transaction
- **THEN** repeated execution MUST complete or reject the partial graph without creating duplicate form, grant or endpoint records
- **AND** `FormSending` MUST NOT execute sender fanout until the graph is complete

#### Scenario: IM form delivery selects a surface

- **WHEN** `FormSending` delivers one IM endpoint
- **THEN** it MUST keep dynamic-card assessment, card selection and Message Template text fallback behind its interface
- **AND** the callback and runtime application MUST NOT branch on Provider-specific capabilities or outcomes

#### Scenario: Delivery fails after form creation

- **WHEN** one sender fails after the runtime form graph commits
- **THEN** `FormSending` MUST retain the failure as a delivery fact when available
- **AND** the waiting Form lifecycle and callback pause decision MUST remain unchanged

### Requirement: V2 callback reload MUST be create-once for one node execution

For one tenant, workflow run and workflow node execution, `HumanInputV2Runtime` MUST first reload by owner. It MUST invoke `FormSending` only when no runtime form exists. `FormSending` MUST use owner-scoped create-once persistence so concurrent invocations reuse the winning form and only the create-once winner executes sender fanout.

#### Scenario: Waiting callback is entered again

- **WHEN** the callback is invoked again for a node execution whose v2 form already exists and remains waiting
- **THEN** it MUST return `PauseRequested` with the same form-backed session identity
- **AND** `HumanInputV2Runtime` MUST NOT invoke `FormSending`

#### Scenario: Concurrent callback creation races

- **WHEN** two callback invocations concurrently observe the same new workflow node execution
- **THEN** exactly one form graph MUST be committed
- **AND** both invocations MUST resolve to the same form identity
- **AND** only the create-once winner MUST execute sender fanout

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

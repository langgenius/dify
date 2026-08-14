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

The Human Input v2 Node MUST perform external work only through its injected HITL callback. The v2 callback MUST perform external reads and writes only through injected runtime application protocols and narrow ports. Neither layer MAY directly construct or access ORM records, SQLAlchemy sessions, controller state, Celery tasks, global database handles, repository implementations or service locators.

#### Scenario: V2 node executes

- **WHEN** the Human Input v2 node evaluates its HITL state
- **THEN** the node MUST call only the injected version-neutral HITL callback protocol

#### Scenario: V2 callback needs runtime state

- **WHEN** the callback loads or creates a form, reads recipient snapshots or evaluates frozen lifecycle state
- **THEN** those capabilities MUST be supplied through injected protocols whose implementations are selected by the composition root

#### Scenario: Optional production capability is not wired

- **WHEN** a persisted node requires `all_workspace_contacts` but the production workspace-contact snapshot port is unavailable
- **THEN** the runtime MUST fail closed with a stable capability-unavailable error
- **AND** it MUST NOT silently treat the marker as an empty recipient set

### Requirement: V2 callback reload MUST be create-once for one node execution

For one workspace, workflow run and workflow node execution, the v2 callback MUST atomically load or create one runtime form graph. Re-entry or concurrent execution MUST reuse the winning form and MUST NOT recreate grants, endpoints, endpoint capabilities or initial delivery attempts.

#### Scenario: Waiting callback is entered again

- **WHEN** the callback is invoked again for a node execution whose v2 form already exists and remains waiting
- **THEN** it MUST return `PauseRequested` with the same form-backed session identity
- **AND** no form, grant, endpoint or initial delivery attempt creation operation may run again

#### Scenario: Concurrent callback creation races

- **WHEN** two callback invocations concurrently observe the same new workflow node execution
- **THEN** exactly one form graph MUST be committed
- **AND** both invocations MUST resolve to the same form identity

### Requirement: Frozen v2 lifecycle state MUST expose a timeout callback entry

The v2 callback contract MUST decide waiting, node-timeout and global-expiry outcomes from the persisted frozen runtime form state. Both frozen timeout outcomes MUST be representable as the `__timeout__` branch without re-reading authoring recipients, endpoints or form blocks. This change does not require production scheduling or resume-task wiring that invokes the entry.

#### Scenario: Frozen node timeout is reloaded

- **WHEN** the injected runtime port returns a v2 form whose frozen node timeout has elapsed
- **THEN** the callback MUST return the timeout decision with selected handle `__timeout__`

#### Scenario: Frozen global expiry is reloaded

- **WHEN** the injected runtime port returns a v2 form whose frozen global expiry has elapsed
- **THEN** the callback MUST return the timeout decision with selected handle `__timeout__`

#### Scenario: Timeout production trigger is absent

- **WHEN** this change is validated without a scheduler or workflow resume-task adapter
- **THEN** callback tests MUST exercise the timeout entry through an injected fake runtime port
- **AND** production trigger wiring MUST remain an explicit follow-up

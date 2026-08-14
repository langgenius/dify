## ADDED Requirements

### Requirement: Committed Human Input terminal handling MUST create Form-scoped card reconciliation work
The Human Input v2 application layer MUST create card reconciliation work when an accepted selected-action submission, node-timeout transition or expiry transition commits successfully. The work MUST be scoped by `HumanInputForm` identity and MUST become observable to a worker no earlier than the terminal transition commit. Provider mutation I/O MUST occur outside that transaction and MUST NOT be a prerequisite for commit, workflow resume or timeout-branch dispatch.

#### Scenario: Selected-action submission commits successfully
- **WHEN** a waiting `HumanInputForm` accepts one authorized selected-action submission, including a business rejection action, and the submission transaction commits
- **THEN** the system MUST make Form-scoped card reconciliation work available after that commit
- **AND** workflow resume MUST NOT wait for card reconciliation to complete

#### Scenario: Node timeout commits
- **WHEN** a waiting `HumanInputForm` commits its node-timeout transition
- **THEN** the system MUST make Form-scoped card reconciliation work available after that commit
- **AND** timeout-branch dispatch MUST NOT wait for card reconciliation to complete

#### Scenario: Form expiry commits
- **WHEN** a waiting `HumanInputForm` commits a status-expiry or global-expiry transition
- **THEN** the system MUST make Form-scoped card reconciliation work available after that commit
- **AND** timeout-branch dispatch MUST NOT wait for card reconciliation to complete

#### Scenario: Terminal transition does not commit
- **WHEN** authorization fails, lifecycle preconditions reject the transition or the terminal transition transaction rolls back
- **THEN** the system MUST NOT perform card reconciliation for that rejected transition

### Requirement: Reconciliation MUST cover every accepted dynamic card instance of the Form
The reconciliation scope MUST contain every confirmed `send_card` acceptance associated with the terminal `HumanInputForm`, including distinct accepted cards produced by separate delivery attempts. The application MUST NOT reduce the scope to the interaction that triggered submission, one endpoint, one Provider identity or one `MessageLocator`. Each accepted card instance MUST remain a separate reconciliation target.

#### Scenario: One Form has multiple accepted card instances
- **WHEN** two or more dynamic IM card deliveries for the same Form have distinct confirmed `MessageLocator` values when handling commits
- **THEN** the reconciliation plan MUST contain one target for every accepted card instance
- **AND** it MUST NOT deduplicate targets by endpoint, Provider, Provider identity or handling interaction

#### Scenario: Initial card delivery was not accepted
- **WHEN** an IM delivery attempt has no confirmed `MessageLocator`
- **THEN** that attempt MUST NOT create a card replacement target

#### Scenario: Card acceptance races with Form terminal handling
- **WHEN** a dynamic card delivery is confirmed after the Form has already committed as submitted, timed out or expired
- **THEN** recording that accepted delivery MUST create the missing reconciliation target for the terminal Form
- **AND** uniqueness by Form and accepted delivery attempt MUST prevent duplicate targets across the race

### Requirement: Each card target MUST use its own compatible Provider context and opaque locator
For each reconciliation target, application orchestration MUST resolve the adapter from that delivery's frozen Integration, Provider and Provider-tenant context, inspect the optional Dynamic Card Messaging capability, and pass the target's unmodified `MessageLocator` with a caller-rendered `StaticCardIntent`. Application code MUST NOT decode, alter, synthesize or substitute locators. Provider compatibility, locator validation and exact-message mutation MUST remain owned by the existing IM Provider capabilities.

#### Scenario: Provider supports dynamic card replacement
- **WHEN** one target has a confirmed locator and its compatible adapter exposes Dynamic Card Messaging
- **THEN** the reconciler MUST invoke `replace_with_static` once with that exact locator and the Form's committed static presentation

#### Scenario: Provider does not support dynamic card replacement
- **WHEN** one target's compatible adapter does not expose Dynamic Card Messaging
- **THEN** the reconciler MUST record an `UNSUPPORTED` operational outcome without attempting Provider mutation

#### Scenario: Provider rejects or cannot confirm the locator mutation
- **WHEN** `replace_with_static` returns `INVALID_REFERENCE`, `STALE_REFERENCE` or `UNKNOWN`
- **THEN** the reconciler MUST record the corresponding target outcome
- **AND** it MUST NOT select, synthesize or substitute another locator

### Requirement: Static card presentation MUST reflect the committed Form terminal outcome
The reconciler MUST render `StaticCardIntent` deterministically from the frozen Form definition, frozen display facts and committed lifecycle outcome. A submitted Form MUST reflect its committed selected action, including a business rejection action. A timed-out or expired Form MUST reflect that terminal state without inventing a selected action. Every static presentation MUST exclude interactive inputs, actions and callback metadata.

#### Scenario: Business rejection action is committed
- **WHEN** a selected action representing business rejection commits as the accepted Form submission
- **THEN** every reconciliation target MUST receive a static presentation reflecting that committed rejection action

#### Scenario: Node timeout is committed
- **WHEN** the Form commits its node-timeout transition
- **THEN** every reconciliation target MUST receive a static presentation reflecting the timed-out state without a selected action

#### Scenario: Form expiry is committed
- **WHEN** the Form commits a status-expiry or global-expiry transition
- **THEN** every reconciliation target MUST receive a static presentation reflecting the expired state without a selected action

#### Scenario: Static terminal presentation is rendered
- **WHEN** the reconciler renders any submitted, timed-out or expired Form outcome
- **THEN** the static intent MUST contain no interactive inputs, actions or callback metadata

### Requirement: Card targets MUST reconcile independently
The reconciler MUST process every target in the Form-scoped plan independently. A success, unsupported capability, invalid locator, stale locator or unknown outcome for one card instance MUST NOT prevent attempts for the remaining targets and MUST NOT rewrite their results.

#### Scenario: One card replacement fails before another target is processed
- **WHEN** one target produces a terminal non-success outcome and another target remains pending
- **THEN** the reconciler MUST preserve the first target's outcome and continue processing the remaining target

#### Scenario: Form reconciliation is partially successful
- **WHEN** at least one card replacement succeeds and at least one other target is unsupported, stale, invalid or unknown
- **THEN** the system MUST retain the distinct per-target outcomes rather than collapsing the Form into one replacement result

### Requirement: Card replacement MUST be an at-most-once effect without automatic retry
Each reconciliation target MUST permit at most one Provider mutation attempt for the committed Form outcome. A typed replacement failure, unsupported capability, uncertain outcome, worker redelivery or stale in-progress recovery MUST NOT schedule or perform an automatic Provider retry. Card reconciliation MUST NOT create or replay a submission or lifecycle transition attempt.

#### Scenario: Provider replacement returns a failure
- **WHEN** `replace_with_static` returns one `ReplacementError`
- **THEN** the target MUST become terminal with the mapped operational outcome
- **AND** no automatic Provider retry or second submission attempt may be scheduled

#### Scenario: Replacement acceptance is uncertain
- **WHEN** a worker loses the result of an attempted Provider mutation or recovers stale in-progress work
- **THEN** the target MUST become terminal with an `UNKNOWN` outcome
- **AND** the Provider mutation MUST NOT be attempted again

#### Scenario: Duplicate worker delivery occurs
- **WHEN** two workers or duplicate tasks contend for the same reconciliation target
- **THEN** an atomic claim MUST allow at most one worker to perform Provider mutation

### Requirement: Form outcome and card reconciliation outcomes MUST remain separate facts
The committed `HumanInputForm` lifecycle outcome MUST remain the authoritative business result. Reconciliation MUST persist one operational outcome per accepted card instance, including success and non-success classifications, without changing, rolling back or compensating the Form outcome, submission result when present, workflow progress or timeout-branch decision.

#### Scenario: Card replacement fails after terminal outcome commit
- **WHEN** one or more card targets finish with a non-success outcome after the Form was submitted, timed out or expired
- **THEN** the Form MUST retain that committed lifecycle state and the corresponding workflow progress or timeout-branch decision MUST remain valid

#### Scenario: Operational state is inspected
- **WHEN** an operator or audit consumer inspects a handled Form whose card targets have different results
- **THEN** the system MUST expose the committed Form outcome separately from every per-card reconciliation outcome

### Requirement: IM Provider abstractions MUST remain independent from HITL orchestration
The application reconciler MAY depend on Provider-neutral adapter capabilities, `MessageLocator`, `StaticCardIntent` and typed replacement outcomes. IM Provider contracts and implementations MUST NOT accept or import `HumanInputForm`, approver grant, submission, workflow or reconciliation aggregate types.

#### Scenario: Reconciler invokes one Provider capability
- **WHEN** application orchestration invokes `replace_with_static` for one target
- **THEN** the Provider boundary MUST receive only its compatible adapter context, opaque locator and static card intent
- **AND** all Form enumeration, commit ordering and operational persistence MUST remain outside the Provider boundary

## ADDED Requirements

### Requirement: The frontend shall classify legacy Human Input nodes consistently

The frontend MUST recognize a persisted Human Input node as v2 only when its `type` is `human-input` and its `version` is the exact string `'2'`. Every other persisted Human Input version MUST continue to use the legacy renderer, count as legacy for migration guidance, and block Human Input insertion in the current draft.

#### Scenario: Exact string version 2 is already migrated

- **WHEN** a node has `type: human-input` and `version: '2'`
- **THEN** the frontend MUST route it to v2 and MUST NOT include it in a legacy migration plan

#### Scenario: Missing or version 1 is legacy and eligible

- **WHEN** a Human Input node has no `version` or has `version: '1'`
- **THEN** the frontend MUST route it to the legacy UI and MUST include it in the current draft's migration preflight

#### Scenario: Malformed or unknown version is not coerced

- **WHEN** a Human Input node has numeric `version: 2` or another unsupported explicit version
- **THEN** the frontend MUST keep legacy rendering and insertion gating active, and migration preflight MUST report a compatibility blocker without mutating the graph

#### Scenario: Non-Human Input data is ignored

- **WHEN** another node type has a `version` value other than `'2'`
- **THEN** Human Input migration detection MUST ignore that node

### Requirement: Migration shall be scoped to all eligible nodes in the current draft

The frontend MUST build one migration plan containing every eligible legacy Human Input in the currently editable workflow draft. It MUST NOT automatically migrate on load, migrate only a selected node, or modify published and historical workflow versions.

#### Scenario: Legacy-only draft is planned as one batch

- **WHEN** an editable draft contains multiple eligible legacy Human Input nodes and the user confirms migration
- **THEN** the plan MUST contain replacements for every legacy Human Input node before any graph mutation occurs

#### Scenario: Mixed draft leaves v2 unchanged

- **WHEN** a draft contains both eligible legacy Human Input nodes and exact v2 Human Input nodes
- **THEN** the plan MUST replace all eligible legacy nodes and MUST preserve existing v2 node data byte-for-byte apart from ordinary draft serialization

#### Scenario: Published snapshot is not changed

- **WHEN** migration is initiated from an editable draft that also has published or historical versions
- **THEN** the frontend MUST mutate and synchronize only the editable draft

### Requirement: Migration shall preserve node and graph identity

Each replacement MUST retain its node ID, position, dimensions, selection-independent metadata, title, description, shared Human Input configuration, branch handles, edge endpoints, variable references, and compatible extension fields. The converter MUST add `version: '2'`, `recpients_spec`, `message_template`, and `debug_mode`, and MUST remove legacy `delivery_methods` only after a valid replacement is complete.

#### Scenario: Shared Human Input configuration survives conversion

- **WHEN** a legacy node has `form_content`, `inputs`, `user_actions`, `timeout`, and `timeout_unit`
- **THEN** its v2 replacement MUST preserve those values and their array order exactly

#### Scenario: Graph topology survives conversion

- **WHEN** legacy Human Input branches are connected to downstream nodes
- **THEN** migration MUST preserve the original Human Input node ID and every incoming/outgoing edge and source handle

#### Scenario: V2 wire shape is exact

- **WHEN** an eligible legacy node is converted successfully
- **THEN** its replacement MUST persist `type: human-input`, string `version: '2'`, and the literal `recpients_spec` key, and MUST NOT emit `recipients_spec` or retain `delivery_methods`

### Requirement: Active legacy delivery recipients shall map deterministically

The planner MUST translate supported active legacy delivery semantics into ordered v2 recipients. Enabled WebApp MUST map to one initiator; valid external emails MUST map to one-time email recipients; member and whole-workspace recipients MUST resolve through a snapshotted frontend contact/member resolver. Recipients MUST be deduplicated by canonical identity while preserving first occurrence.

#### Scenario: WebApp maps to initiator

- **WHEN** an eligible node contains an enabled `webapp` delivery method
- **THEN** the replacement MUST contain exactly one `{ type: 'initiator' }` recipient regardless of duplicate enabled WebApp records

#### Scenario: External email maps to one-time email

- **WHEN** an enabled email method contains ordered valid external-email recipients
- **THEN** the replacement MUST contain ordered `onetime_email` recipients with trimmed addresses and MUST collapse canonical duplicates to their first occurrence

#### Scenario: Workspace member resolves to a v2 recipient

- **WHEN** an enabled email recipient references a workspace `user_id`
- **THEN** the resolver MUST use a matching contact when available, otherwise MUST use the member's verified current email as an `onetime_email`, and MUST block migration if neither can be resolved

#### Scenario: Whole workspace expands from one stable snapshot

- **WHEN** enabled email configuration sets `whole_workspace: true`
- **THEN** the resolver MUST expand the current workspace members/contacts in stable order from one snapshot, apply the same fallback and deduplication rules, and MUST NOT read changing provider state during node conversion

#### Scenario: Multiple supported delivery methods preserve recipient order

- **WHEN** an eligible node has both enabled WebApp and enabled Email methods
- **THEN** recipient output MUST follow delivery-method order and email-recipient order while remaining deduplicated

### Requirement: Email template and debug configuration shall map without reinterpretation

For a supported enabled email method, the planner MUST preserve `subject` and `body` verbatim as `message_template`. Its Boolean `debug_mode` MUST map to the v2 debug object using the email channel only. A WebApp-only node MUST receive an empty message template and disabled debug mode.

#### Scenario: Email content and debug mode are enabled

- **WHEN** a legacy enabled email configuration has subject/body content and `debug_mode: true`
- **THEN** the replacement MUST preserve the content verbatim and MUST set `debug_mode` to `{ enabled: true, channels: ['email'] }`

#### Scenario: Email debug mode is disabled

- **WHEN** a supported legacy email configuration has `debug_mode: false`
- **THEN** the replacement MUST set `debug_mode` to `{ enabled: false, channels: [] }`

#### Scenario: WebApp-only node gets complete v2 defaults

- **WHEN** a legacy node has an enabled WebApp method and no enabled Email method
- **THEN** the replacement MUST use an empty subject/body template and disabled debug mode while preserving the initiator recipient

### Requirement: Lossy or ambiguous legacy data shall block the entire migration

The frontend MUST complete preflight for every legacy node before mutation. An unsupported version, invalid or unresolvable recipient, configured-but-disabled method, enabled unsupported delivery method, conflicting multiple email templates, or any other value without a lossless v2 representation MUST produce localized actionable blockers and MUST prevent all replacements.

#### Scenario: One invalid node prevents partial conversion

- **WHEN** a draft has several eligible nodes and one contains an unresolvable member recipient
- **THEN** preflight MUST identify the affected node and reason, and the frontend MUST leave every node and edge unchanged

#### Scenario: Unsupported enabled delivery method is retained by aborting

- **WHEN** an imported legacy node contains an enabled Slack, Teams, Discord, or unknown delivery method
- **THEN** migration MUST abort without deleting or rewriting that method

#### Scenario: Disabled configured method is not accidentally activated or dropped

- **WHEN** a disabled legacy delivery method retains material recipients, template, or debug configuration
- **THEN** migration MUST report a blocker and MUST NOT activate, discard, or mutate that configuration

#### Scenario: Conflicting email templates are not merged implicitly

- **WHEN** one legacy node contains multiple enabled email methods with different subject/body values
- **THEN** migration MUST report a blocker and MUST NOT choose or merge a template silently

### Requirement: Migration shall be atomic, idempotent, and serialized

After successful preflight, all replacements MUST be applied through one graph/history transaction. The frontend MUST prevent duplicate confirmations while work is pending and MUST treat an all-v2 graph as a no-op.

#### Scenario: Complete plan is committed once

- **WHEN** every legacy node passes preflight and the user confirms
- **THEN** all replacements MUST appear in one state/history transaction with unchanged topology and no observable partially migrated graph

#### Scenario: Repeated confirmation cannot race

- **WHEN** migration is pending and the user clicks or submits the confirmation action again
- **THEN** the frontend MUST ignore the duplicate action and MUST NOT produce another graph transaction or draft synchronization

#### Scenario: Planner is idempotent after success

- **WHEN** the planner runs after the graph contains only exact v2 Human Input nodes
- **THEN** it MUST return no replacements and MUST NOT change the graph or synchronize the draft

### Requirement: Migration shall use existing draft synchronization and recover completely

The frontend MUST synchronize a successful batch through the existing workflow draft path exactly once and MUST introduce no migration API. It MUST retain a complete pre-migration snapshot until synchronization succeeds. A synchronization failure MUST restore the snapshot, retain migration availability, and show localized error feedback; success MUST commit the migrated graph and emit completion feedback.

#### Scenario: Successful migration synchronizes once

- **WHEN** a valid atomic migration is confirmed and existing draft synchronization succeeds
- **THEN** the frontend MUST keep the v2 replacements, release the pending lock, and report migration success exactly once

#### Scenario: Draft synchronization fails

- **WHEN** existing draft synchronization rejects or reports failure after replacement
- **THEN** the frontend MUST restore all original node data and topology, MUST NOT show the success toast, and MUST leave the migration action available for retry

#### Scenario: Frontend-only boundary is maintained

- **WHEN** this capability is implemented
- **THEN** it MUST use existing frontend state, history, draft synchronization, and mock/already-available resolver data without adding backend, graphon, database, runtime, or generated-client changes

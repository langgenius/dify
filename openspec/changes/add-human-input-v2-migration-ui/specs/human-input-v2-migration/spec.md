## ADDED Requirements

### Requirement: The frontend shall classify legacy Human Input nodes consistently

The frontend MUST recognize a persisted Human Input node as v2 only when its `type` is `human-input` and its `version` is the exact string `'2'`. Every other persisted Human Input version MUST continue to use the legacy renderer, count as legacy for migration guidance, and block Human Input insertion in the current draft.

#### Scenario: Exact string version 2 is already migrated

- **WHEN** a node has `type: human-input` and `version: '2'`
- **THEN** the frontend MUST route it to v2 and MUST NOT include it in a legacy migration plan

#### Scenario: Missing or version 1 is legacy and eligible

- **WHEN** a Human Input node has no `version` or has `version: '1'`
- **THEN** the frontend MUST route it to the legacy UI and MUST include its current node data in the backend migration batch after explicit user confirmation

#### Scenario: Malformed or unknown version is not coerced

- **WHEN** a Human Input node has numeric `version: 2` or another unsupported explicit version
- **THEN** the frontend MUST keep legacy rendering and insertion gating active, MUST NOT coerce the version locally, and MUST surface any backend compatibility blocker without mutating the graph

#### Scenario: Non-Human Input data is ignored

- **WHEN** another node type has a `version` value other than `'2'`
- **THEN** Human Input migration detection MUST ignore that node

### Requirement: Migration shall be scoped to all eligible nodes in the current draft

The frontend MUST build one backend migration request containing every legacy-rendered Human Input in the currently editable workflow draft. It MUST NOT automatically migrate on load, submit only a selected node, or modify published and historical workflow versions.

#### Scenario: Legacy-only draft is submitted as one batch

- **WHEN** an editable draft contains multiple eligible legacy Human Input nodes and the user confirms migration
- **THEN** the request MUST contain `{ node_id, data }` for every legacy Human Input node before any graph mutation occurs

#### Scenario: Mixed draft leaves v2 unchanged

- **WHEN** a draft contains both eligible legacy Human Input nodes and exact v2 Human Input nodes
- **THEN** the frontend MUST submit only the legacy nodes and MUST preserve existing v2 node data byte-for-byte apart from ordinary draft serialization

#### Scenario: Published snapshot is not changed

- **WHEN** migration is initiated from an editable draft that also has published or historical versions
- **THEN** the frontend MUST mutate and synchronize only the editable draft

### Requirement: Migration shall preserve node and graph identity

The frontend MUST preserve each graph node's ID, position, dimensions, selection-independent metadata, branch handles, edge endpoints, and variable references. It MUST replace only the node data with the complete corresponding `data` object returned by the backend helper and MUST NOT merge legacy fields into, omit fields from, or reinterpret the returned definition.

#### Scenario: Returned node definition is applied without rewriting

- **WHEN** a successful backend response returns a complete v2 `data` object for a submitted `node_id`
- **THEN** the frontend MUST persist that `data` object as the node's replacement without resolving, filtering, deduplicating, or remapping any nested value

#### Scenario: Graph topology survives conversion

- **WHEN** legacy Human Input branches are connected to downstream nodes
- **THEN** migration MUST preserve the original Human Input node ID and every incoming/outgoing edge and source handle

#### Scenario: Legacy fields are not merged back into the response

- **WHEN** the returned v2 node definition omits a field that existed only in the legacy node data
- **THEN** the frontend MUST NOT restore that legacy field while applying the replacement

### Requirement: Backend conversion response shall be complete and authoritative

The frontend MUST delegate request-shape validation, recipient and Contact resolution, delivery-method conversion, message/debug mapping, deduplication, controlled-loss policy, and blocker generation to the backend batch migration helper. A successful response MUST contain exactly one complete result for every submitted `node_id`. The frontend MUST validate only response-envelope and correlation invariants before mutation and MUST otherwise treat returned node data as opaque and authoritative.

#### Scenario: Complete ordered response is accepted

- **WHEN** the backend returns exactly one result for every submitted `node_id` with no duplicate or unexpected identifier
- **THEN** the frontend MUST associate each result with its graph node and MAY proceed to the atomic replacement transaction

#### Scenario: Incomplete success response is rejected

- **WHEN** a nominally successful response omits a submitted node, duplicates a `node_id`, or includes an unexpected `node_id`
- **THEN** the frontend MUST treat the response as a protocol failure and MUST leave every node and edge unchanged

#### Scenario: Frontend does not perform semantic conversion

- **WHEN** the backend returns recipient, message-template, debug-mode, or other v2 node-data fields
- **THEN** the frontend MUST NOT resolve Contacts, expand workspace membership, apply email fallback, map delivery methods, deduplicate recipients, or otherwise recompute those fields

### Requirement: Backend conversion failure shall block the entire frontend mutation

The frontend MUST NOT mutate the graph unless the backend returns a complete successful result for the entire submitted batch. Backend transport errors, conversion errors, node-scoped blockers, and invalid success envelopes MUST leave the original graph unchanged and produce localized recoverable feedback.

#### Scenario: Backend returns node-scoped blockers

- **WHEN** the backend rejects one or more submitted legacy nodes and returns node-scoped blocker information
- **THEN** the frontend MUST display the returned blocker context, MUST NOT create replacements from any partial information, and MUST leave every node and edge unchanged

#### Scenario: Backend request fails

- **WHEN** the migration request fails because of network, authorization, server, or response-decoding error
- **THEN** the frontend MUST leave the graph unchanged and MUST keep the migration action available for retry

### Requirement: Migration shall be atomic, idempotent, and serialized

After validating a complete backend success response, all replacements MUST be applied through one graph/history transaction. The frontend MUST prevent duplicate confirmations while the backend request, graph mutation, or draft synchronization is pending and MUST treat an all-v2 graph as a no-op.

#### Scenario: Complete plan is committed once

- **WHEN** the backend returns one complete replacement for every submitted legacy node
- **THEN** all replacements MUST appear in one state/history transaction with unchanged topology and no observable partially migrated graph

#### Scenario: Repeated confirmation cannot race

- **WHEN** migration is pending and the user clicks or submits the confirmation action again
- **THEN** the frontend MUST ignore the duplicate action and MUST NOT produce another graph transaction or draft synchronization

#### Scenario: All-v2 graph does not call the backend

- **WHEN** the graph contains only exact v2 Human Input nodes
- **THEN** the frontend MUST NOT send a migration request, change the graph, or synchronize the draft

### Requirement: Migration shall use existing draft synchronization and recover completely

The frontend MUST call the separately specified backend batch migration helper at most once per confirmation and synchronize a successfully applied batch through the existing workflow draft path exactly once. It MUST retain a complete pre-migration snapshot until synchronization succeeds. A backend failure occurs before graph mutation; a synchronization failure MUST restore the snapshot, retain migration availability, and show localized error feedback; success MUST commit the migrated graph and emit completion feedback.

#### Scenario: Successful migration synchronizes once

- **WHEN** a valid atomic migration is confirmed and existing draft synchronization succeeds
- **THEN** the frontend MUST keep the v2 replacements, release the pending lock, and report migration success exactly once

#### Scenario: Draft synchronization fails

- **WHEN** existing draft synchronization rejects or reports failure after replacement
- **THEN** the frontend MUST restore all original node data and topology, MUST NOT show the success toast, and MUST leave the migration action available for retry

#### Scenario: Conversion ownership boundary is maintained

- **WHEN** this capability is implemented
- **THEN** the frontend MUST own confirmation, batch request orchestration, authoritative node-data replacement, history, draft synchronization, rollback, and feedback, while the backend helper owns every semantic conversion and blocker decision

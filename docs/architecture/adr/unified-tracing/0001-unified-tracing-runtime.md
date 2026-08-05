# ADR-0001: Define a Provider-Neutral Unified Tracing Runtime

- Status: Proposed
- Date: 2026-07-23

## Context

Dify tracing providers historically translate execution data independently. Each provider may load workflow executions, reconstruct node relationships, resolve sessions, and normalize inputs, outputs, status, and errors in its own way. Equivalent executions can consequently appear differently across providers, and every provider must repeat Dify workflow semantics.

Nested workflows expose the same problem across asynchronous trace tasks. A child task knows its logical Dify parent, but Phoenix and LangSmith require different provider-specific restoration data. The child may also run before the task that emits its parent.

Unified tracing therefore needs one runtime contract covering canonical topology, provider routing, and cross-task parent coordination. These concerns are not independently selectable: together they determine whether one Dify execution is emitted once, with a consistent hierarchy, through one tracing runtime.

## Decision

Dify introduces an opt-in provider-neutral unified tracing runtime. Dify Core constructs canonical trace fragments and coordinates cross-task relationships; provider adapters translate those fragments to provider protocols and transport them.

### Runtime ownership

Dify Core owns:

- trace and session identity;
- canonical span identity, ordering, parent relationships, names, and semantic kinds;
- workflow execution loading and hierarchy reconstruction;
- supported loop and iteration containment, including synthetic wrapper spans;
- input, output, status, error, usage, and Dify metadata normalization;
- destination compatibility and cross-task parent-context resolution;
- provider-agnostic retry signals.

A unified provider adapter owns:

- mapping canonical span kinds and fields to provider concepts;
- emitting spans in the order supplied by Core;
- creating and restoring the provider-specific portion of parent context;
- provider transport and SDK interaction.

Adapters do not query Dify workflow persistence or independently reconstruct workflow hierarchy. Core does not import provider SDKs or model canonical traces as OpenTelemetry, LangSmith runs, or another provider protocol.

### Logical trace fragments and supported topology

A workflow dispatch produces one canonical fragment containing its workflow root and the workflow node executions loaded for that run. A chatflow fragment additionally uses its message span as the fragment root and places the workflow span below it. A nested workflow remains a separate fragment with an explicit logical external parent.

Core supplies spans in deterministic parent-first order. Siblings are ordered deterministically by canonical span identity; sibling order is serialization order only and does not imply causality.

For the workflow topology currently supported by Dify:

- a predecessor becomes the parent only when its graph node identifies one execution unambiguously;
- structured iteration or loop membership produces one deterministic synthetic wrapper per container execution and index;
- contract v1 covers only the non-nested Loop and Iteration containers supported by the Dify product;
- parallel-branch metadata does not create an additional parent relationship; persisted predecessor and containment relationships remain authoritative;
- repeated graph node identifiers are treated as ambiguous rather than guessed;
- cyclic parent edges are removed deterministically;
- a span with an ambiguous, missing, or cyclic local relationship falls back to the workflow root.

Persisted workflow and node execution identifiers are canonical identities. Synthetic wrapper identities are deterministically derived from wrapper kind, container execution identity, and iteration or loop index. Provider-native identities remain adapter concerns.

Nested Loop or Iteration containers are outside the v1 product and tracing contract. Adapters must not infer nested containment. If Dify adds nested-container execution, Core topology semantics and conformance tests must be extended before unified tracing claims support; v1 does not add speculative runtime detection for topology the product cannot produce.

Standalone operations without a persisted execution identifier receive an additive operation identifier when their trace payload is first stored. New payloads reuse that canonical identity across delivery attempts. Older payloads without the field remain readable and retain the generated-identity fallback. Canonical, delivery-file, and provider-native identities remain distinct.

Workflow-owned Human Input forms may use the owning node execution identifier as their form identifier. When a human-wait identifier matches a canonical node execution span, Core uses that exact execution as the wait parent. Static graph node identifiers and timestamp proximity are only a compatibility fallback for older records without execution-scoped form identity. This prevents repeated executions of one Human Input node inside a supported Loop or Iteration container from being associated with the wrong container run.

### Pause, resume, and human-wait lifecycle

A Workflow or Chatflow execution remains one logical trace across any number of Human Input pauses and resumptions. A pause is non-terminal: Core persists the workflow execution and its private, provider-neutral tracing state, but does not enqueue a final trace. Resume restores that state and the existing workflow execution identity. A later pause replaces the private pause snapshot with the accumulated state, and only workflow success, partial success, failure, stop, or global Human Input timeout enqueues the final trace.

The private pause state retains Agent fragments and their owning node executions, plus completed human-wait records. Records are accumulated by stable run or wait identity so replayed resume delivery replaces the same logical record instead of duplicating it. This state is part of the versioned workflow resumption context; an external cache and its TTL are cleanup mechanisms, not the lifecycle authority.

`HumanInputForm` is the lifecycle authority for a human wait. Core normalizes its request and completion timestamps and one of `waiting`, `submitted`, `timed_out`, `expired`, or `canceled` into a bounded, provider-neutral record. A terminal workflow-owned wait becomes a direct child of its exact owning node execution and spans the actual waiting interval. A node timeout resumes normal workflow execution with a terminal wait record; a global timeout stops the workflow and marks the retained pause state for final-trace handoff. Tracing normalization and export remain fail-soft and must not prevent submission, timeout handling, workflow resumption, or the workflow's terminal business outcome.

Agent App Human Input intentionally follows the Message boundary instead. The requesting and resuming Messages are separate traces in the same conversation session. They contain `requested` and `resumed` human-wait phases correlated by stable wait identity and a span link, never by a cross-trace parent-child edge. The first Message may therefore export when it pauses, and no Agent App fragment needs to survive the wait.

### Reliable final delivery

A global-timeout pause snapshot remains authoritative until Core has persisted a deterministic final canonical payload and the asynchronous dispatcher has accepted it. A failed handoff retains the snapshot for a bounded recovery process. Once the dispatcher accepts the payload, ownership transfers to asynchronous provider dispatch and the pause snapshot can be removed.

Handoff recovery and provider export have separate bounded retry budgets. Handoff retries rebuild the final fragment from the authoritative snapshot and terminal Human Input records. Provider retries retain the durable payload only for recoverable transport failures. Terminal failures and provider retry exhaustion clean up that payload.

Retries replay the whole canonical fragment and may duplicate provider effects after an ambiguous or partially successful attempt. This at-least-once behavior is preferred to silently losing the terminal trace; provider adapters must therefore preserve deterministic identities where their protocol permits.

### Runtime selection and legacy isolation

Unified tracing is controlled by a global feature switch that defaults to disabled. `OpsTraceManager` is the runtime selection point:

- when disabled, every provider uses its legacy implementation;
- when enabled, a provider registered for unified tracing uses only the unified implementation;
- an unregistered provider continues to use its legacy implementation.

Selection occurs before constructing and dispatching a trace instance. A unified failure never falls back to legacy dispatch because tracing writes are non-transactional and fallback could duplicate spans or split one execution across traces.

Each delivery attempt resolves the latest enabled mode, provider, destination, and credentials. Configuration is not frozen into the trace payload. One attempt uses exactly one selected runtime and destination; a change between attempts may route a whole-fragment replay to a different destination after an earlier destination observed partial effects.

Unified and legacy runtimes use separate provider classes, registries, cache identities, mutable SDK clients, and parent-context namespaces. Existing provider configuration persistence and management APIs remain unchanged.

### Cross-task parent coordination

Dify propagates stable logical parent identifiers through workflow execution. Provider-specific parent restoration data is exchanged only in the asynchronous tracing layer.

A unified adapter may publish the minimum provider restoration context through the Core coordinator. Context is stored temporarily under the canonical parent identifier in a unified-only namespace. The versioned envelope contains:

- provider name;
- a non-secret destination scope derived from provider endpoint and project identity;
- trace and parent identifiers;
- only the opaque provider-specific fields required to restore the parent.

Credentials are never included in the scope or envelope.

For a nested workflow, Core first resolves the logical parent's tracing destination:

- a unified parent with the same provider and destination requires compatible stored context;
- missing compatible context or temporary context-store failure is retryable;
- malformed, unsupported, or stored incompatible context is terminal;
- an absent, untraced, legacy, cross-provider, or cross-destination parent produces a new root with explicit linked-parent metadata.

For an asynchronous child whose canonical parent is known to share the destination, missing context is retryable and malformed or incompatible context is terminal. Retry exhaustion never silently converts a required compatible parent into a new root. Top-level traces do not read parent context.

Context lookup does not consume the stored value, allowing multiple children to restore the same parent. Retention is bounded and cleanup is automatic. Concrete storage technology, keys, TTL values, retry counts, and retry delays are replaceable operational mechanisms.

Temporary Agent-fragment cache retention is not workflow lifecycle authority. This does not weaken the independent requirement that parent-restoration context remain available long enough for bounded child dispatch retries.

### Envelope compatibility

Parent-context envelopes are versioned and strictly validated. An unsupported envelope version fails closed rather than being guessed. Provider-specific restoration fields remain opaque to Core outside version, provider, destination, and structural validation. Partial per-span routing is not supported.

### Adapter acceptance and contract evolution

A registered unified adapter implements the complete current runtime contract. Its emission call returns only after its provider-specific synchronous acceptance step succeeds. Recoverable provider or transport failures use the Core retryable error contract; other failures are terminal. Parent context is published only after the corresponding provider parent span is accepted.

The existing trace task payload remains backwards compatible and canonical traces remain an in-process boundary, so contract v1 does not add versions to those structures. Unified mode is enabled only after all `ops_trace` workers support the current contract. A future incompatible serialized-payload change must add explicit versioning and deploy readers before writers.

## Supported Semantics

Maintainers and provider adapters may rely on these invariants:

- one workflow dispatch produces one provider-neutral canonical fragment before provider translation;
- Core, not adapters, decides supported local workflow hierarchy;
- spans are supplied parent-first with deterministic, non-causal sibling ordering;
- ambiguous and cyclic persisted relationships are handled conservatively and deterministically;
- workflow-owned human waits prefer exact node execution identity and only fall back to static-node matching for legacy records;
- every local parent belongs to the same fragment and appears before its child; cross-task parentage is resolved explicitly by Core;
- standalone operation identity remains stable across retries when the additive persisted identifier is present, while older payloads remain readable;
- a Workflow or Chatflow pause never exports a partial final trace; restored tracing state accumulates until one terminal workflow outcome;
- a global-timeout pause snapshot remains authoritative until its durable final payload is accepted for asynchronous dispatch;
- final-payload handoff recovery and provider export use separate bounded retry budgets;
- retry replays a whole canonical fragment and may duplicate provider effects;
- recoverable provider transport failures retain the durable payload, while terminal failures and retry exhaustion remove it;
- tracing delivery failure never changes the workflow's terminal business outcome;
- a workflow-owned human wait records its real lifecycle interval and cannot make pause, resume, or timeout processing fail;
- Agent App waits correlate two Message traces without creating a parent-child relationship across trace roots;
- registered unified providers receive the same logical topology and normalized Dify semantics;
- one dispatch attempt uses either the unified or legacy runtime, never both;
- each attempt uses the latest configuration but fixes one runtime and destination for that attempt;
- adapter return means its synchronous provider acceptance boundary succeeded;
- unified dispatch does not fall back to legacy after failure;
- compatible cross-task parents are restored from validated provider context;
- incompatible tracing destinations remain separate roots with explicit Dify correlation metadata;
- missing compatible context is distinguished from an intentionally incompatible destination;
- credentials are not coordination data and are never stored in parent-context envelopes.

## Consequences

- Provider output becomes more consistent and Dify hierarchy behavior can be tested in Core.
- Adding a unified provider requires a protocol adapter rather than another workflow hierarchy implementation.
- Nested workflow export may wait while parent context becomes available.
- Context-store availability and retention affect reliable cross-task assembly.
- Workflow and Chatflow traces are delayed while Human Input is pending and require tracing state to remain compatible with persisted pause snapshots.
- Global-timeout final delivery is at least once: bounded retries reduce loss but can duplicate provider-side effects.
- Agent App Human Input appears as two correlated wait phases rather than one cross-Message span.
- During migration, registered providers retain separate legacy and unified implementations.
- Some provider capabilities have no canonical equivalent and remain adapter-local.
- Changes to canonical semantics must be evaluated against every registered unified adapter.

## Alternatives Considered

### Keep separate ADRs for model, routing, and coordination

Rejected because the three decisions jointly define one runtime contract and cannot be evaluated, selected, or reversed independently.

### Keep hierarchy reconstruction in every provider

Rejected because it duplicates Dify semantics and allows provider behavior to drift.

### Use OpenTelemetry as the Core trace model

Rejected because it would privilege OpenTelemetry-style providers and couple Core to a provider protocol.

### Replace every legacy provider at once

Rejected because an incremental, opt-in rollout preserves existing production behavior.

### Fall back to legacy after unified failure

Rejected because Dify cannot know which non-transactional provider writes already succeeded.

### Rely on provider-side eventual parent association

Rejected because provider ingestion and child-before-parent behavior differ and may be undocumented.

### Pass provider context through workflow task payloads

Rejected because provider context may not exist when a child workflow starts and would couple application execution to provider protocols.

### Emit a new root whenever compatible parent context is missing

Rejected because transient task ordering would silently and permanently corrupt hierarchy.

### Export a Workflow or Chatflow trace at every Human Input pause

Rejected because every pause would expose an incomplete root and repeated pauses would produce duplicate traces for one workflow execution. Retaining provider-neutral state until a terminal outcome preserves one trace without keeping provider SDK objects alive.

### Keep paused tracing state only in a temporary cache

Rejected because a cache TTL may expire during a legitimate human wait. The workflow pause snapshot is the lifecycle-aligned persistence boundary; cache retention remains suitable only for recoverable coordination and cleanup.

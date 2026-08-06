# Unified Tracing Runtime Contract v1

## Status and scope

This document is the normative specification referenced by ADR-0001. It defines the unified tracing contract implemented by Dify Core and every provider registered in the unified tracing registry.

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

Contract v1 covers:

- canonical trace fragments constructed by Core;
- non-nested Loop and Iteration container topology (synthetic wrapper spans) implemented inside `api/core/ops/`;
- provider-neutral cross-task parent resolution and provider emission;
- durable asynchronous at-least-once delivery and whole-fragment provider-export retry;
- runtime selection and legacy isolation;
- conversation-name trace association by `message_id`.

The following are **out of scope for v1** and MUST NOT be relied upon by v1 adapters:

- Agent execution (Agent v2) sub-span fragments (run / tool-call / tool-result) and Agent App two-phase correlation;
- Human Input wait spans (`dify.span.kind=human_wait`) and their provider mappings;
- pause/resume private tracing-state retention across Human Input pauses;
- the global-timeout reliable final-trace handoff and any database migration to support it (`workflow_pauses.final_trace_*`).

These deferred items are described in ADR-0001 under "Out of scope (v1): deferred designs" and are not normative for v1. Their runtime modules, trace-builder paths, canonical span kind, and adapter mappings are absent from v1.

Contract v1 accepts only the non-nested Loop and Iteration topology produced by supported Dify product paths. The tracing runtime does not detect, flatten, or warn about nested-container state that the product contract cannot produce. Before any supported producer may emit nested containers, Dify MUST revise Core topology semantics and conformance tests. Adapters MUST NOT infer nested containment.

## Ownership

Dify Core MUST own:

- canonical trace and span identity;
- local topology and deterministic parent-first ordering;
- workflow execution loading;
- cross-task parent resolution and destination compatibility;
- provider-neutral retry classification;
- durable trace-payload lifecycle.

A provider adapter MUST own:

- translation from canonical spans to provider concepts;
- the provider SDK or transport interaction;
- construction and restoration of its opaque provider context;
- classification of concrete provider errors into the Core retry contract.

An adapter MUST NOT query workflow persistence, infer missing local topology, select another tracing runtime, or fall back to a legacy provider implementation.

## Canonical fragment invariants

For every canonical fragment:

1. Span identifiers MUST be unique within the fragment.
2. `root_span_id` MUST identify exactly one span in the fragment.
3. The fragment root MUST have `parent_id=None`.
4. Every non-root span MUST have a local `parent_id` that identifies an earlier span in the same fragment.
5. Cross-task parentage MUST be represented by `external_parent` or `required_parent_context_id`, never by a local `parent_id` outside the fragment.
6. `external_parent` and `required_parent_context_id` MUST NOT both be present.
7. Sibling serialization order MUST be deterministic and MUST NOT imply causality.
8. An ambiguous, missing, or cyclic local workflow relationship MUST fall back conservatively to the workflow root.
9. Adapters MUST consume the supplied order and relationships without reconstructing them.

Core MUST reject a malformed canonical fragment as a terminal tracing failure. That failure MUST NOT change the workflow or Message business outcome.

A workflow dispatch produces one fragment. A nested workflow produces a separate fragment with `external_parent`. A standalone Message child produces a separate root fragment with `required_parent_context_id` equal to the owning Message identifier.

## Supported workflow topology

For the non-nested Loop and Iteration topology supported by v1:

- persisted node execution identifiers are canonical span identifiers;
- a unique persisted predecessor MAY become the local parent;
- an unambiguous container membership produces one synthetic wrapper per container execution and index;
- a wrapper identifier MUST be derived deterministically from wrapper kind, container execution identifier, and index;
- repeated static node identifiers MUST NOT be guessed when they identify multiple executions;
- parallel metadata MUST NOT introduce an additional parent edge;
- Core MUST remove cyclic parent edges deterministically.

Human Input wait-span identity (owning node execution vs static node fallback) is deferred from v1; the wrapper topology above does not depend on it.

## Snapshot and identity

Canonical identity, delivery identity, and provider-native identity are distinct:

- workflow runs, Messages, node executions, and synthetic wrappers use stable Core identifiers;
- a persisted standalone `operation_id`, when present, MUST be reused by every delivery attempt for that payload;
- a trace payload without `operation_id` MUST remain readable and MAY use the legacy generated-identifier fallback;
- a stored trace file identifier identifies one delivery payload and MUST NOT be treated as the canonical operation identifier;
- an adapter MUST map canonical identifiers deterministically when its provider accepts caller-controlled identifiers;
- provider-native deduplication MAY strengthen one adapter's behavior but MUST NOT be represented as a runtime-wide exactly-once guarantee.

Workflow root completion data forms the terminal workflow snapshot. Persisted node executions are loaded through tenant-scoped Core persistence when the canonical fragment is built. Pause-state retention across Human Input pauses is deferred from v1.

## Message child parent resolution

Moderation, Suggested Question, Dataset Retrieval, Generate Name, and Tool Trace with a Message identifier are standalone Message-child fragments.

For each such fragment:

- the canonical root MUST have `parent_id=None`;
- `required_parent_context_id` MUST carry the owning Message identifier;
- Core MUST resolve the required provider parent before invoking the adapter;
- temporarily unavailable parent context MUST raise the retryable dispatch signal;
- malformed context, unsupported envelope version, or stored provider/destination mismatch MUST be terminal;
- retry exhaustion MUST NOT emit the child as a detached root.

When no Message identifier exists, a standalone operation MAY remain an independent root and MUST NOT perform required-parent lookup.

## Workflow external-parent resolution

A nested workflow fragment carries the internally generated logical workflow parent in `external_parent`. Core resolves the parent's current tracing destination before provider emission.

The outcomes are:

| Parent condition | Required outcome |
|---|---|
| Unified, same provider and destination, context available | Restore provider parent |
| Unified, same provider and destination, context unavailable | Retryable |
| Temporary context-store access failure | Retryable |
| Malformed or unsupported stored envelope | Terminal |
| Stored provider or destination mismatch after compatible resolution | Terminal |
| Parent absent, untraced, legacy, cross-provider, or cross-destination | Linked root |

Retry exhaustion after a compatible parent was expected MUST NOT silently change the outcome to linked or detached root.

## Parent-context lifecycle

Provider parent context is internal coordination data.

- Publication MUST occur only after the provider parent span reaches its adapter acceptance boundary.
- Duplicate publication is last-write-wins and MUST refresh bounded retention.
- Lookup MUST be non-consuming so multiple children can restore the same parent.
- Missing, expired, and never-published compatible context share one retryable unavailable state.
- Retention MUST cover the configured dispatch retry window.
- The envelope MUST contain only provider name, non-secret destination scope, trace and parent identifiers, and opaque restoration fields.
- Credentials and authorization tokens MUST NOT appear in keys, destination scope, or envelopes.
- The envelope MUST NOT be treated as an authorization token.

Contract v1 trusts the internal workflow and Celery task path that produces parent identifiers. Workflow execution loading remains tenant-scoped. The envelope does not redundantly encode tenant or application ownership.

## Adapter acceptance

An adapter's `emit` method receives one Core-resolved, parent-first fragment and an optional `ParentResolution`.

`emit` MUST:

- return only after its synchronous provider-specific acceptance step succeeds;
- raise `RetryableTraceDispatchError` when acceptance is unconfirmed because of a recoverable provider or transport failure;
- raise another exception for a terminal failure;
- publish provider parent context only after acceptance of the corresponding parent span.

Every registered adapter MUST accept every current `CanonicalSpanKind`. It MUST preserve the canonical kind in the reserved `dify.span.kind` metadata field. When `CanonicalSpan.links` is non-empty, the adapter MUST preserve those stable Dify logical identifiers in `dify.span.links`. Reserved canonical metadata MUST override conflicting caller metadata.

Logical links do not contain provider-native trace and span context. A v1 adapter MUST NOT fabricate a provider-native link from a logical identifier. A future contract MAY add native links when Core supplies provider-resolvable link context; `dify.span.links` remains the cross-provider representation.

For the v1 adapters:

| Adapter | Logical links | Provider identity and replay | Synchronous acceptance boundary |
|---|---|---|---|
| Phoenix | `dify.span.links` metadata | OpenTelemetry identifiers may change on replay; `dify.span.id` preserves canonical identity | exporter returns `SpanExportResult.SUCCESS` |
| LangSmith | `dify.span.links` metadata | run ID is derived deterministically from canonical identity, without an exactly-once guarantee | synchronous `create_run` returns normally |

The `human_wait` -> provider mapping row is deferred from v1 with the `human_wait` canonical kind.

An adapter backed only by a local asynchronous SDK queue MUST provide a synchronous flush or acknowledgement boundary before it can conform to v1.

## Delivery and replay

Durable delivery is at least once, not exactly once.

- A retry MUST replay the complete canonical fragment; v1 has no per-span checkpoint.
- A retry MAY duplicate provider effects after ambiguous or partial external success.
- Recoverable provider failures MUST retain the durable payload only after Celery accepts the retry request.
- Successful dispatch, terminal failure, retry scheduling failure, and retry exhaustion MUST clean up the provider-owned durable payload.
- Tracing failure MUST NOT change the workflow or Message business outcome.

The global-timeout pause-snapshot handoff (authoritative snapshot retained until the deterministic final payload is persisted and accepted, with separate handoff-recovery and provider-export retry budgets) is deferred from v1. ADR-0001 preserves its design under "Out of scope (v1): deferred designs".

## Configuration and destination

Each delivery attempt MUST resolve the latest enabled tracing mode, provider, destination, and credentials. Configuration and credentials MUST NOT be frozen into the durable trace payload.

Within one attempt:

- exactly one runtime and destination MUST be selected;
- unified dispatch MUST NOT fall back to legacy after provider effects may have begun;
- destination compatibility MUST use provider, normalized endpoint, and project identity;
- credentials MUST NOT participate in destination identity.

A configuration change between attempts MAY route a top-level replay to a different destination after an earlier destination observed partial effects. A parented fragment remains subject to the parent-context compatibility matrix and MUST NOT silently detach when its stored context targets another destination. These are accepted consequences of latest-configuration resolution and at-least-once replay.

## Serialization and rollout

Parent-context envelopes are the versioned serialized coordination boundary. Unknown envelope versions MUST fail closed.

Contract v1 does not add a version to the existing trace task payload because its serialized shape remains backwards compatible. `CanonicalTrace` is an in-process boundary and is not persisted between worker versions.

A registered unified adapter represents complete support for the current contract. Operators MUST upgrade every `ops_trace` worker before enabling unified mode. A future incompatible persisted-payload change MUST introduce an explicit version and deploy compatible readers before producers begin writing the new version.

## Normative examples

### Supported Loop or Iteration

Given one supported container execution and two child executions at index `0`, Core emits:

```text
workflow-run
└── container-execution
    └── iteration:container-execution:0
        ├── child-execution-a
        └── child-execution-b
```

The wrapper identifier is deterministic. Adapter-specific nesting rules MUST NOT replace this topology.

### Explicit standalone Message child

Given Message `message-1` and a later Moderation fragment:

```text
CanonicalTrace(
  root_span_id="moderation-operation",
  spans=[CanonicalSpan(id="moderation-operation", parent_id=None)],
  required_parent_context_id="message-1",
)
```

The adapter receives the child only after Core resolves `message-1`. It MUST NOT inspect a fragment-external local parent.

### Child before parent

If the child Celery task runs before the Message or workflow parent publishes provider context, lookup returns the unavailable state. The child payload is retained after Celery accepts the retry. A later attempt restores the same parent and reuses the persisted standalone operation identifier.

### Partial provider success

If a provider accepts the first spans and fails recoverably before accepting the complete fragment, the next attempt replays every span. Duplicate provider effects are permitted; no span checkpoint is inferred from parent-context publication.

### Configuration change between attempts

If attempt one for a top-level fragment uses project A and fails after partial effects, while attempt two resolves newly selected project B, attempt two emits the complete fragment to project B. Dify does not freeze project A or its credentials into the payload and does not claim exactly-once effects across destinations. A parented fragment instead follows the compatibility and retry rules above; it is never silently detached merely because configuration changed.

## Counterexample: adapter-local external-parent inference

The following fragment is non-conforming:

```text
root_span_id = "operation-1"
spans = [CanonicalSpan(id="operation-1", parent_id="message-1")]
```

`message-1` is not in the fragment. A LangSmith adapter MUST NOT convert it directly into `parent_run_id`. Core must instead construct a local root with `parent_id=None`, set `required_parent_context_id="message-1"`, and resolve the provider parent before invoking the adapter.

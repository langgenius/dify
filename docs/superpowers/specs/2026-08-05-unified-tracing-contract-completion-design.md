# Unified Tracing Contract Completion Design

**Date:** 2026-08-05  
**Status:** Approved for implementation planning; revised after conformance audit

## Context

The unified tracing runtime ADR defines Core-owned canonical topology, provider adapters, and cross-task parent coordination. Review discussion identified several contract details that remain implicit or inconsistently implemented. This design completes those details while preserving existing trace payload compatibility and keeping tracing fail-soft for application execution.

The design intentionally does not add span checkpoints, exactly-once delivery, a provider capability framework, a new database table, or a second authorization system for parent-context envelopes.

## Decisions

### Topology scope

Contract v1 supports the Loop and Iteration topology currently supported by Dify: containers are not nested inside other Loop or Iteration containers. The ADR and normative specification will state this product boundary. No speculative nested-topology detector, warning mechanism, or recursive builder support will be added now.

Adapters must not infer nested containment. If Dify later supports nested Loop or Iteration containers, the canonical topology contract, builder, and conformance tests must be extended before unified tracing claims support for that topology.

### Canonical fragment ownership

Core is the only component that constructs local parent relationships. An adapter receives a parent-first fragment in which:

- span identifiers are unique;
- `root_span_id` identifies a span in the fragment;
- the fragment root has no local `parent_id`;
- every non-root local `parent_id` identifies an earlier span in the same fragment;
- cross-task parentage is represented by trace-level parent-resolution fields, not by a local `parent_id` that points outside the fragment.

`CanonicalTrace` will validate these structural invariants at construction. It will also reject a fragment that sets both `external_parent` and `required_parent_context_id`. This is validation, not normalization: Core remains responsible for constructing the one valid topology rather than repairing malformed fragments differently for each adapter. Canonical traces are built in the current worker from persisted `TraceInfo`; they are not deserialized from old canonical payloads. Correcting the builders therefore preserves old `TraceInfo` compatibility without maintaining two canonical formats.

If a future internal defect produces an irrecoverably invalid fragment, tracing may be skipped and logged but must not affect workflow or message execution.

### Stable standalone operation identity

Workflow runs, Messages, node executions, Agent operations, Human Input waits, and synthetic container wrappers already have stable canonical identifiers. Standalone operations that lack a persisted execution identifier currently generate a new UUID every time the canonical builder runs, so a Celery retry may represent the same logical operation with a different identifier.

`BaseTraceInfo` will gain an optional `operation_id`. The durable trace-payload boundary will assign it once before serializing `TaskData`. Canonical builders for standalone operations will reuse it. Existing payloads without `operation_id` remain valid and use the current generated-UUID fallback.

The stored trace file ID remains a delivery identity and is not reused as the canonical operation identity. Provider-native identity remains adapter-owned.

### Explicit cross-task Message parentage

Standalone Message children are separate fragments. Their root span therefore has `parent_id=None`, while `required_parent_context_id` carries the owning Message identifier.

This applies to:

- Moderation;
- Suggested Question;
- Dataset Retrieval;
- Tool Trace when a `message_id` is present;
- Generate Name, which already requires its Message context.

The unified runtime resolves required parent context before adapter emission. A temporarily unavailable context raises the existing retryable dispatch error and uses the bounded Celery retry policy. Malformed or incompatible stored context is terminal. Tracing failure remains isolated from the Message or workflow business outcome.

After every standalone Message child uses explicit Core parent resolution, the LangSmith adapter's inference from an out-of-fragment root `parent_id` will be removed. Phoenix and LangSmith will then consume the same resolved relationship.

### Configuration timing and destination identity

Tracing configuration is not frozen into the durable task payload. Each delivery attempt resolves the latest enabled mode, provider, destination, and credentials. A single attempt selects exactly one runtime and destination and never falls back from unified to legacy dispatch after an external write may have occurred.

Destination compatibility continues to use a non-secret identity derived from provider, normalized endpoint, and project. Credential rotation does not create a new destination. Provider-specific organization or workspace identifiers should be added only when a provider requires them to distinguish destinations.

A configuration change between attempts may route a replay to a different destination after an earlier destination observed partial effects. This is an accepted consequence of latest-configuration resolution and whole-fragment at-least-once delivery.

### Unified adapter contract

For contract v1, adapter `emit` behavior means:

- normal return: the adapter's synchronous provider-specific acceptance step succeeded;
- `RetryableTraceDispatchError`: success is unconfirmed because of a recoverable transport or provider failure, so the complete canonical fragment may be replayed;
- any other exception: terminal dispatch failure.

An adapter may publish parent context only after the corresponding provider parent span has reached its acceptance boundary. Phoenix defines acceptance as `SpanExportResult.SUCCESS`. LangSmith defines acceptance as synchronous `create_run` return. A future adapter whose SDK only queues locally must provide a synchronous flush or acknowledgement boundary before it can conform to v1.

Phoenix and LangSmith behavior tests will apply the same conformance requirements without introducing a shared test framework. They cover Core-resolved parent consumption, publication-after-acceptance, retryable failure propagation, and terminal failure behavior while retaining provider-specific assertions for concrete SDK success and error mapping.

### Canonical kind and logical-link preservation

Every registered unified adapter must accept every `CanonicalSpanKind` in the current contract. Human Input waits map to the provider's generic chain concept because they represent a bounded workflow operation rather than an LLM, retriever, or tool:

- Phoenix maps `HUMAN_WAIT` to OpenInference `CHAIN`;
- LangSmith maps `HUMAN_WAIT` to `run_type="chain"`.

Both adapters must write the reserved metadata field `dify.span.kind` from the canonical enum value. Canonical metadata overrides a conflicting caller-supplied reserved value.

`CanonicalSpan.links` contains stable Dify logical identifiers, not provider-native trace and span context. Contract v1 therefore does not fabricate native provider links from those identifiers. When links are present, every adapter must preserve them in the reserved `dify.span.links` metadata field. A later contract may add native links when Core can supply real provider-resolvable link context; the logical metadata remains the cross-provider baseline.

The current adapter behavior is:

| Capability | Phoenix | LangSmith |
|---|---|---|
| Human Wait provider type | OpenInference `CHAIN` | `run_type="chain"` |
| Canonical kind | `dify.span.kind` | `dify.span.kind` |
| Logical links | `dify.span.links` metadata | `dify.span.links` metadata |
| Provider identity | OpenTelemetry identifiers are not stable across replay; canonical ID is an attribute | provider run ID is derived deterministically from canonical ID |
| Replay guarantee | duplicate effects are possible | stable ID does not imply runtime-wide exactly-once delivery |
| Acceptance | exporter returns success | synchronous `create_run` returns |

### At-least-once and provider idempotency

Dify guarantees stable canonical identity for a logical persisted operation, but it does not guarantee exactly-once provider effects. A retry replays the whole fragment and may duplicate spans after ambiguous or partial external success.

Adapters must map stable canonical identifiers deterministically when the provider supports caller-controlled identifiers. Providers without that capability may produce duplicates. Any stronger provider-native deduplication is documented as adapter behavior, not elevated into a runtime-wide guarantee.

### Parent-context lifecycle and trust boundary

The normative specification will record the existing lifecycle:

- duplicate publication is last-write-wins and refreshes retention;
- lookup is non-consuming;
- missing, expired, and never-published compatible context share the same retryable unavailable state;
- malformed data, unsupported envelope version, and stored provider or destination mismatch are terminal;
- absent, untraced, legacy, cross-provider, and cross-destination workflow parents become linked roots;
- retry exhaustion never silently converts a required compatible parent into a detached root.

The v1 envelope remains internal coordination data, not authorization data. Supported producers create parent identifiers internally, workflow execution loading is tenant-scoped, and credentials are excluded from keys, destination scope, and envelopes. Tenant and application identifiers will not be redundantly added unless Dify later requires protection against forged internal task payloads.

### Versioning and rollout

Parent-context envelopes retain their explicit version and fail closed on unsupported versions.

Contract v1 does not add version fields to `TaskData` or `CanonicalTrace`:

- `TaskData` retains its existing backwards-compatible serialized shape;
- `CanonicalTrace` is an in-process boundary built by the consuming worker;
- registration in the unified provider registry means complete support for the current runtime contract;
- unified mode must be enabled only after all `ops_trace` workers are upgraded.

If a future change alters the persisted task payload's meaning, that serialized boundary must gain an explicit contract version and follow a readers-before-writers rollout. Nested topology support requires a new contract version only if it changes existing fragment or parent semantics rather than adding a backwards-compatible topology case.

## Data Flow

### New payload

```text
TraceTask.execute
  -> BaseTraceInfo(operation_id=None)
  -> durable payload boundary assigns operation_id once
  -> TaskData stored
  -> Celery attempt loads the same operation_id
  -> CanonicalTraceBuilder creates a stable root span
```

### Existing payload

```text
TaskData without operation_id
  -> current BaseTraceInfo validation accepts the missing optional field
  -> CanonicalTraceBuilder uses the existing UUID fallback
```

### Standalone Message child

```text
Canonical root(parent_id=None, required_parent_context_id=message_id)
  -> Core coordinator resolves Message provider context
     -> unavailable: bounded retry
     -> invalid or incompatible stored context: terminal trace failure
     -> restored: adapter emits under the resolved provider parent
```

## Compatibility and Failure Handling

- Existing persisted trace payloads remain readable.
- The new `operation_id` field is optional and additive.
- Canonical structure changes occur after payload deserialization and require no migration.
- Parent-context waiting uses the existing retry budget and payload-retention behavior.
- Provider or canonical tracing failures never change the application execution result.
- Unified dispatch never falls back to legacy after an attempt begins.

## Testing

Tests will cover:

- old payloads without `operation_id`;
- stable standalone canonical IDs across repeated builds of one persisted payload;
- fragment-local parent invariants and parent-first ordering for every builder output;
- explicit required Message parent context for all standalone child types;
- retry when required context is unavailable;
- identical Core parent resolution for Phoenix and LangSmith;
- removal of LangSmith out-of-fragment inference;
- publication only after provider acceptance;
- retryable versus terminal adapter failures;
- destination stability across credential changes;
- parent-context lifecycle and version failure behavior.
- rejection of duplicate span IDs, a missing or parented root, out-of-order or missing local parents, and conflicting trace-level parent modes;
- behavioral conversion of every current canonical span kind by Phoenix and LangSmith;
- `HUMAN_WAIT` mapping to each provider's generic chain type;
- canonical `dify.span.kind` and `dify.span.links` preservation, including protection from conflicting caller metadata.

Container nesting is documented as unsupported by v1 and is not given speculative runtime tests until Dify supports that product topology.

## Documentation Sequence

Implementation, conformance tests, and normative documentation will be updated as one contract change. The ADR status becomes `Revised` to record that the original decision has been materially updated after review; this status does not claim reviewer acceptance.

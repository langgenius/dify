# Unified tracing design

## Goal

Add an opt-in unified tracing path that reconstructs Dify trace hierarchy once and lets provider adapters translate that hierarchy to provider-specific SDK calls.

The existing provider path remains the default and must not depend on, instantiate, or share runtime state with the unified path. The first unified providers are Phoenix and LangSmith. Other providers continue using their existing implementations until explicitly registered in the unified provider registry.

## Requirements

- Add a global `OPS_TRACE_UNIFIED_ENABLED` switch, defaulting to `false`.
- When disabled, all providers use the existing implementation without behavior changes.
- When enabled, a provider registered in the unified registry uses only its unified implementation.
- When enabled, an unregistered provider uses its existing implementation.
- Do not fall back to the existing implementation after a unified provider starts dispatching; doing so could duplicate or split a trace.
- Keep legacy and unified provider classes, registries, caches, and Redis keys separate.
- Reconstruct workflow, node, loop, iteration, nested-workflow, error, and session relationships in the core unified layer rather than in each adapter.
- Require every unified provider to participate in core parent-context coordination for nested workflows.

## Routing

`OpsTraceManager.get_ops_trace_instance` remains the single selection point:

1. Resolve the app's configured provider and decrypted provider configuration as it does today.
2. If `OPS_TRACE_UNIFIED_ENABLED` is true and the provider is registered in the unified registry, construct or return the unified provider instance.
3. Otherwise, construct or return the existing provider instance.

Instance cache keys must include the tracing mode, provider name, and configuration fingerprint. This prevents a legacy instance or a different provider with a similar configuration from being returned to the unified path.

Configuration validation, API checks, project URLs, and provider setup APIs continue using the existing provider classes in the first phase. The switch initially affects trace dispatch only.

## Components

Place the new implementation under `api/core/ops/unified_trace/`:

- `registry.py`: maps supported provider names to unified adapter factories.
- `entities.py`: defines the canonical trace tree and parent-context envelope.
- `trace_builder.py`: turns `BaseTraceInfo` and persisted workflow executions into a canonical tree.
- `parent_context.py`: publishes and resolves nested-workflow parent contexts through Redis.
- `provider.py`: defines the minimal unified adapter contract.

Provider adapters remain in their provider packages. They consume core entities but core code must not import provider SDKs.

### Canonical trace tree

The canonical model contains provider-independent data only:

- trace and session identifiers;
- span identifier and parent identifier;
- operation name and semantic kind;
- start and end timestamps;
- inputs, outputs, token usage, and metadata;
- success, handled-exception, and failure state;
- nested-workflow external-parent reference;
- synthetic loop or iteration wrapper marker.

The builder owns:

- session ID resolution, including custom `trace_session_id` and existing fallbacks;
- stable workflow and node naming;
- unique execution-ID indexing;
- predecessor hierarchy reconstruction;
- loop and iteration containment;
- synthetic per-iteration and per-loop wrapper grouping;
- deterministic handling of ambiguous repeated graph node IDs;
- workflow and node error normalization;
- loading workflow node executions once per trace.

Provider adapters must not query workflow executions or reconstruct graph relationships.

### Unified adapter contract

Each adapter is responsible only for provider-specific behavior:

- emit a canonical tree;
- convert canonical kinds, fields, status, and errors to provider fields;
- export the minimal parent context after emitting a workflow-tool node;
- restore its parent context before emitting a nested workflow;
- identify its non-secret destination scope.

Phoenix translates canonical spans to OpenTelemetry/OpenInference spans and exports/restores W3C `traceparent` data.

LangSmith translates canonical spans to runs, assigns `parent_run_id`, `trace_id`, and `dotted_order`, and maps the canonical session ID to root-run `metadata["session_id"]`.

## Parent context coordinator

All unified providers use the core coordinator for nested workflows, even if a provider may tolerate child-before-parent ingestion. Dify therefore controls ordering and does not depend on undocumented provider behavior.

A parent tool node follows this sequence:

1. The adapter successfully emits the provider span or run.
2. The adapter exports its minimal provider context.
3. The core coordinator stores the context in Redis with a bounded TTL.

A nested workflow follows this sequence:

1. The canonical builder exposes `parent_workflow_run_id` and `parent_node_execution_id` from `parent_trace_context`.
2. The coordinator determines whether the parent can participate in the same unified provider scope.
3. The coordinator resolves the stored context.
4. The adapter restores the context and emits the nested workflow beneath the parent tool node.

Top-level workflows do not read parent context. Only nodes that can parent nested workflows publish context.

### Stored envelope

Use a versioned, provider-neutral envelope:

```json
{
  "version": 1,
  "provider": "phoenix",
  "scope": "non-secret-destination-fingerprint",
  "trace_id": "provider-trace-id",
  "parent_id": "provider-parent-span-or-run-id",
  "provider_context": {}
}
```

`provider_context` contains only the adapter-specific restoration fields. Phoenix stores `traceparent`; LangSmith stores the root run ID, parent run ID, and parent dotted order.

Use a unified-only Redis namespace such as:

```text
trace:unified:parent:{parent_node_execution_id}
```

It must not read or write the existing Phoenix legacy key namespace. The scope fingerprint includes the provider destination endpoint and project identity but no credentials.

### Resolution outcomes

- Context is present, valid, and compatible: restore it and emit the nested trace.
- Parent is expected to publish compatible unified context, but context is absent: raise the existing retryable trace-dispatch exception.
- Retries are exhausted for an expected compatible parent: fail the unified trace; do not silently emit a new root and do not invoke the legacy provider.
- Parent does not use a unified provider, or uses a different provider/destination scope: emit a new root and record linked parent workflow/node IDs in metadata.
- Stored context is malformed or has an unsupported version: fail terminally with identifiers in the log; do not silently degrade.
- Redis access fails while compatible parent context is required: treat it as retryable and fail terminally after the existing retry budget is exhausted.

The existing Celery task retry contract remains provider-agnostic and requires no provider-specific branch.

## Isolation

The migration deliberately copies common behavior out of Phoenix while leaving the legacy Phoenix implementation intact. Moving or deleting legacy helpers during the first phase would violate the requirement that disabled mode retain existing behavior.

Isolation rules:

- Separate legacy and unified registries.
- Separate provider classes and instance cache entries.
- Separate Redis key namespaces.
- No shared mutable provider SDK clients or tracer instances.
- No feature-flag branches inside legacy providers.
- No runtime fallback from a registered unified provider to its legacy provider.
- The global switch is evaluated when selecting the trace instance, not independently for individual spans.

## Delivery phases

### Phase 1: framework and Phoenix

- Add the disabled-by-default global switch and dual-registry routing.
- Add canonical entities, hierarchy builder, and parent coordinator.
- Add the unified Phoenix adapter.
- Preserve the legacy Phoenix implementation unchanged.
- Verify equivalent session, hierarchy, wrapper, nested-workflow, and error behavior for representative inputs.

Arize and every provider other than Phoenix remain on the legacy path unless separately registered.

### Phase 2: LangSmith

- Add the unified LangSmith adapter.
- Emit the canonical predecessor and structured hierarchy instead of flat workflow children.
- Coordinate nested workflows through the core coordinator.
- Map custom trace sessions to LangSmith thread metadata.
- Preserve LangSmith root-run/trace-ID protocol constraints.

### Later phases

Add providers one at a time by implementing the adapter contract, contract tests, and a unified registry entry. An unregistered provider always remains on its existing implementation.

## Verification

Focused unit tests must cover:

- the routing matrix for switch state and provider registration;
- mode/provider-aware instance caching;
- canonical predecessor, loop, iteration, wrapper, and ambiguous-node reconstruction;
- custom and fallback session IDs;
- parent-context envelope validation and scope matching;
- publish-before-child ordering, retry, retry exhaustion, and terminal corruption;
- cross-provider and cross-scope root fallback with link metadata;
- no legacy invocation after unified dispatch starts;
- Phoenix adapter mapping and context restoration;
- LangSmith parent IDs, trace IDs, dotted order, and thread metadata.

Integration tests should use fake provider clients and Redis for deterministic failure injection. A small opt-in real-provider smoke test may verify final platform rendering, but correctness must not rely on external-provider tests in CI.

Regression tests must demonstrate that with `OPS_TRACE_UNIFIED_ENABLED=false`, existing providers are selected and their trace calls receive the same trace entities as before.

## Rollout

Ship with `OPS_TRACE_UNIFIED_ENABLED=false`. Enable it first in a controlled deployment with Phoenix, then LangSmith. Monitor successful dispatches, retry counts, exhausted retries, malformed contexts, and incompatible-scope root fallbacks. Providers added later require an explicit unified registry entry; the global flag alone never opts an unimplemented provider into the new path.

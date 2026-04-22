# LLM Quota Identity API Design

Date: 2026-04-22

## Summary

Refactor workflow quota handling so `LLMQuotaLayer` no longer depends on
`ModelInstance`.

The new design narrows quota APIs around the actual billing identity:

- `tenant_id`
- `provider`
- `model`
- `usage` for post-run deduction

`LLMQuotaLayer` will be initialized with graph-scoped `tenant_id` when the
engine is built. It will read `provider` and `model` from public node data
before execution and from Graphon result events after execution.

Existing `ModelInstance`-based quota helpers will remain temporarily as thin
deprecated wrappers so non-workflow callers do not need to move in the same
change.

## Problem

The current workflow quota path has the wrong dependency shape.

`LLMQuotaLayer` naturally has model identity plus graph-scoped tenant context,
but the quota helpers currently require a full `ModelInstance`. That forces the
layer to depend on runtime assembly details or reconstruct a rich object only
to answer a billing question.

This is unfriendly Python for two reasons:

1. The caller has to provide a much larger object than the callee actually
   needs.
2. The layer boundary becomes coupled to workflow internals instead of public
   data.

## Goals

- Remove `ModelInstance` from `LLMQuotaLayer` entirely.
- Keep pre-run quota checks and post-run quota deduction behavior unchanged.
- Make the post-run billing API explicit and identity-based.
- Pass graph-scoped `tenant_id` into the quota layer at construction time.
- Mark `ModelInstance`-based quota helpers as deprecated.

## Non-Goals

- Do not change provider quota semantics.
- Do not remove the deprecated helpers in this change.
- Do not migrate every existing non-workflow quota caller in this change.
- Do not redesign GraphEngine event ordering.

## Approved Direction

The workflow quota layer should not depend on `ModelInstance` at all.

For this workflow path:

- graph-scoped `tenant_id` is stable for the whole graph run
- Graphon success events provide `model_provider` and `model_name`
- pre-run checks must still happen in `on_node_run_start`, before any event is
  emitted

Because `on_node_run_start(node)` runs before `NodeRunStartedEvent` exists, the
layer will use public node configuration for pre-run model identity and public
event inputs for post-run model identity.

## Target Call Site

```python
layer = LLMQuotaLayer(
    tenant_id=run_context.tenant_id,
)

ensure_llm_quota_available_for_model(
    tenant_id=self.tenant_id,
    provider=provider,
    model=model,
)

deduct_llm_quota_for_model(
    tenant_id=self.tenant_id,
    provider=result_event.node_run_result.inputs["model_provider"],
    model=result_event.node_run_result.inputs["model_name"],
    usage=result_event.node_run_result.llm_usage,
)
```

This is the desired public shape because it matches the real caller knowledge
without reconstructing a runtime object.

## API Changes

In `api/core/app/llm/quota.py`, add two narrow helpers:

```python
def ensure_llm_quota_available_for_model(
    *,
    tenant_id: str,
    provider: str,
    model: str,
) -> None:
    ...


def deduct_llm_quota_for_model(
    *,
    tenant_id: str,
    provider: str,
    model: str,
    usage: LLMUsage,
) -> None:
    ...
```

These functions become the real implementation points for model-based quota
logic.

### Deprecated Wrappers

Keep the existing wrappers temporarily:

```python
def ensure_llm_quota_available(*, model_instance: ModelInstance) -> None:
    ...


def deduct_llm_quota(
    *,
    tenant_id: str,
    model_instance: ModelInstance,
    usage: LLMUsage,
) -> None:
    ...
```

Their behavior:

- emit `DeprecationWarning`
- delegate immediately to the new identity-based helpers
- contain no quota logic of their own

Recommended warning shape:

```python
warnings.warn(
    "ensure_llm_quota_available(model_instance=...) is deprecated; "
    "use ensure_llm_quota_available_for_model(...) instead.",
    DeprecationWarning,
    stacklevel=2,
)
```

The same pattern applies to `deduct_llm_quota(...)`.

## LLMQuotaLayer Design

### Constructor

Change the layer constructor from:

```python
LLMQuotaLayer()
```

to:

```python
LLMQuotaLayer(tenant_id: str)
```

The layer stores graph-scoped tenant context directly and no longer fetches it
during execution.

### Pre-Run Check

`on_node_run_start(node)` will:

1. check whether the node type is one of:
   - `BuiltinNodeTypes.LLM`
   - `BuiltinNodeTypes.PARAMETER_EXTRACTOR`
   - `BuiltinNodeTypes.QUESTION_CLASSIFIER`
2. extract `(provider, model)` from public node configuration
3. call `ensure_llm_quota_available_for_model(...)`

The layer should not read any `ModelInstance`, wrapped runtime object, or
private attribute in this path.

The preferred source is the node's public data model, not `node.model_instance`.
The intended helper shape is:

```python
def _extract_model_identity_from_node(node: Node) -> tuple[str, str] | None:
    ...
```

The helper reads the node's public model config, such as `node.data.model`.

### Post-Run Deduction

`on_node_run_end(node, error, result_event)` will:

1. ignore non-success events
2. extract `(provider, model)` from
   `result_event.node_run_result.inputs["model_provider"]` and
   `result_event.node_run_result.inputs["model_name"]`
3. call `deduct_llm_quota_for_model(...)`

The intended helper shape is:

```python
def _extract_model_identity_from_result_event(
    result_event: NodeRunSucceededEvent,
) -> tuple[str, str] | None:
    ...
```

This path depends only on public event payloads and graph-scoped tenant context.

## Quota Resolution Logic

The new narrow helpers will preserve the existing rules.

For pre-check:

- resolve provider configuration for the given tenant and model identity
- return early for non-system providers
- raise `QuotaExceededError` if the resolved system provider model is already in
  `QUOTA_EXCEEDED`

For deduction:

- resolve provider configuration for the given tenant and model identity
- return early for non-system providers
- compute used quota exactly as the current implementation does
- apply the same trial, paid, and free quota branches

The narrow quota API intentionally excludes `user_id`.

Model and credential resolution for quota is tenant-scoped in the current code:
provider configurations are cached and resolved by `tenant_id`, and current
credentials are selected from tenant-bound provider configuration. Request
`user_id` still matters in other request-scoped model runtime flows, but it is
not needed for quota lookup or billing.

## Engine Assembly Changes

Every workflow engine builder that constructs `LLMQuotaLayer` must pass
`tenant_id` explicitly.

This includes normal workflow entry and child engine creation paths that inherit
the same graph-scoped tenant context.

The layer should begin execution fully initialized:

- no lazy tenant lookup
- no node-scoped context probing
- no hidden capture on first use

## Error Handling

Behavior should remain the same where quota is actually exceeded.

### Pre-Check

On `QuotaExceededError`:

- set the stop event
- send an abort command
- log a warning

### Post-Run

On `QuotaExceededError`:

- set the stop event
- send an abort command
- log a warning

### Missing Public Identity

If the layer cannot extract public model identity:

- log once with the node id
- skip quota work for that node
- do not reconstruct identity from private state

This preserves the new boundary. Missing identity should be treated as a public
contract problem, not as a reason to fall back to hidden runtime internals.

## Testing Plan

Update tests to match the new public boundary.

### `api/core/app/llm/quota.py`

Add unit tests for:

- `ensure_llm_quota_available_for_model(...)`
- `deduct_llm_quota_for_model(...)`
- deprecated wrappers delegate correctly
- deprecated wrappers emit `DeprecationWarning`

### `api/core/app/workflow/layers/llm_quota.py`

Update layer tests to assert:

- the layer is initialized with `tenant_id`
- pre-run checks use public node model identity
- post-run deduction uses event input model identity
- no `ModelInstance` reconstruction is involved
- abort behavior on quota-exceeded remains unchanged

### Workflow Assembly

Update workflow entry tests to assert:

- `LLMQuotaLayer(tenant_id=...)` is constructed explicitly
- child engine paths pass the same graph-scoped tenant context into the layer

## Migration Plan

1. Add the new identity-based quota helpers.
2. Convert `LLMQuotaLayer` to the new constructor and helper API.
3. Keep the old `ModelInstance` wrappers as deprecated delegators.
4. Update tests to enforce the new public boundary.
5. Migrate remaining non-workflow callers in later follow-up changes.
6. Remove deprecated wrappers once all callers have moved.

## Alternatives Considered

### Keep `ModelInstance` in the Layer

Rejected because it preserves the same over-wide dependency and forces runtime
object reconstruction for a simple billing operation.

### Reconstruct `ModelInstance` Inside the Layer

Rejected because it hides complexity instead of removing it.

### Make the Layer Entirely Event-Driven

Rejected for now because `on_node_run_start(node)` runs before Graphon emits the
node start event. That would require an engine-ordering change that is outside
the scope of this API refactor.

## Open Removal Path

This design intentionally leaves a clean removal path:

- once non-workflow callers migrate, the deprecated wrappers can be deleted
- once Graphon event coverage is sufficient for any future pre-run design, the
  pre-run identity source can evolve independently of the quota API

The important boundary remains stable: quota logic consumes explicit model
identity, not `ModelInstance`.

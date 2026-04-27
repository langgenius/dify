# `ops_trace_manager` Versus Prototype Responsibilities

Date: 2026-04-23
Context: Identify which parts of the prototype's Phoenix tracing logic have already been moved upstream into `ops_trace_manager` / trace contracts, and which parts still remain provider-specific.

## Goal

Create a clean boundary for the upcoming spec:

- reuse what `ops_trace_manager` and trace contracts already do well
- avoid re-implementing upstream logic inside Phoenix-specific code
- clearly isolate what still must be implemented in Phoenix/exporter-specific layers

## Main Conclusion

`ops_trace_manager` has already absorbed a meaningful subset of the prototype's work, but not the full hierarchy logic.

The current split looks like this:

### Already moved upstream

- workflow trace data loading and normalization
- node execution trace data loading and normalization
- typed trace contracts (`WorkflowTraceInfo`, `WorkflowNodeTraceInfo`)
- normalized trace ID fallback
- normalized cross-workflow parent context transport
- workflow/message/conversation correlation fields
- token split and metadata enrichment

### Not yet moved upstream

- workflow graph loading for hierarchy reconstruction
- node-to-node parent reconstruction inside a workflow
- branch/loop/iteration-aware hierarchy rules
- execution-order fallback parent resolution
- Phoenix-specific span naming strategy
- session ID resolution and propagation as first-class contract
- canonical root vs orphan-root protection rules

## What The Prototype Did In The Provider

The prototype provider (`arize_phoenix_trace.py`) does both of these jobs at once:

1. Build trace semantics
2. Export spans to Phoenix

That is why the file became heavy. It does not merely serialize `TraceInfo`; it also:

- loads workflow nodes
- loads workflow graph
- reconstructs parent-child hierarchy
- infers nested workflow relationships
- chooses span names
- assigns session IDs
- emits spans directly

Relevant prototype locations:

- workflow-level logic: `/Users/yang/Downloads/arize_phoenix_trace.py:190`
- node-level hierarchy logic: `/Users/yang/Downloads/arize_phoenix_trace.py:298`
- hierarchy map construction: `/Users/yang/Downloads/arize_phoenix_trace.py:1182`
- child workflow inference: `/Users/yang/Downloads/arize_phoenix_trace.py:1664`
- logical parent fallback: `/Users/yang/Downloads/arize_phoenix_trace.py:1819`

## What `ops_trace_manager` Already Does That Prototype Also Did

## 1. Workflow trace data loading and normalization

`ops_trace_manager.TraceTask.workflow_trace(...)` already loads and normalizes core workflow execution data before any provider sees it.

It resolves:

- `workflow_id`
- `tenant_id`
- `workflow_run_id`
- workflow inputs/outputs
- status / error / version
- workflow app log id
- optional linked message id
- prompt/completion token split
- app/workspace name enrichment

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/ops_trace_manager.py:784`

This overlaps with the prototype's workflow metadata-building work.

## 2. Node execution trace data loading and normalization

`ops_trace_manager.TraceTask.node_execution_trace(...)` already constructs normalized node execution trace objects from runtime/persistence payloads.

It resolves:

- workflow and node identity
- node execution identity
- node type / title / status / error
- node timing and index
- predecessor id
- model/token/tool fields
- iteration / loop / parallel identifiers
- optional message and conversation correlation
- app/workspace/credential/plugin/dataset metadata

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/ops_trace_manager.py:1328`

This overlaps with the prototype's node metadata-building work.

## 3. Typed trace contracts

The trace contracts already carry a lot of the fields that the prototype relied on ad hoc:

- `WorkflowTraceInfo`
- `WorkflowNodeTraceInfo`
- workflow/node ids
- timing
- tokens
- `predecessor_node_id`
- `iteration_id`
- `loop_id`
- `parallel_id`
- `process_data`

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/entities/trace_entity.py:79`
- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/entities/trace_entity.py:189`

This is an upstreamed contract that the prototype did not have in a clean, reusable form.

## 4. Normalized trace ID fallback

`BaseTraceInfo.resolved_trace_id` already standardizes trace identity fallback order:

1. external `trace_id`
2. `workflow_run_id`
3. `message_id`

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/entities/trace_entity.py:30`

This replaces part of the prototype's provider-local trace ID decision logic.

## 5. Cross-workflow parent context transport

This is the clearest example of prototype logic already moved upstream.

`ops_trace_manager` already copies `parent_trace_context` into workflow and node trace metadata:

- workflow trace path: `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/ops_trace_manager.py:859`
- node trace path: `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/ops_trace_manager.py:1373`

Then `BaseTraceInfo.resolved_parent_context` turns that untyped metadata into a typed transport:

- `trace_correlation_override`
- `parent_span_id_source`

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/entities/trace_entity.py:50`

This is already a successful upstream migration of one important prototype behavior:

- nested workflow parent linking

## 6. Downstream consumption already assumes the upstream contract

`enterprise_trace.py` already consumes `resolved_parent_context` instead of reconstructing parent linkage from scratch.

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/enterprise/telemetry/enterprise_trace.py:184`
- `/Users/yang/.codex/worktrees/ace8/dify/api/enterprise/telemetry/enterprise_trace.py:343`

This confirms that part of the prototype's semantics has already been promoted into the standard tracing contract.

## What Has NOT Been Moved Upstream Yet

## 1. Workflow graph-driven hierarchy reconstruction

The prototype provider still does this locally:

- load workflow graph
- load workflow nodes
- build a hierarchy map

Relevant prototype code:

- `/Users/yang/Downloads/arize_phoenix_trace.py:298`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1182`

There is no equivalent upstream graph-based hierarchy builder in `ops_trace_manager`.

## 2. Node-to-node parent resolution inside a workflow

The prototype currently decides node parentage using:

- explicit graph parent
- special handling for `start` / `end`
- logical fallback to most recent prior execution

Relevant prototype code:

- `/Users/yang/Downloads/arize_phoenix_trace.py:456`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1819`

`ops_trace_manager` currently carries node metadata, but does not yet compute an explicit node parent contract.

## 3. Branch / loop / iteration-aware hierarchy rules

The prototype has local logic for:

- question-classifier / if-else decision context
- loop context
- child workflow triggered by tool timing

Relevant prototype code:

- `/Users/yang/Downloads/arize_phoenix_trace.py:369`
- `/Users/yang/Downloads/arize_phoenix_trace.py:379`
- `/Users/yang/Downloads/arize_phoenix_trace.py:384`

Upstream contracts currently expose loop/iteration ids, but do not define full hierarchy rules from them.

## 4. Phoenix-specific span naming

The prototype uses highly customized names, such as:

- workflow names with nested markers
- tool names with child workflow identifiers
- classifier / loop / API-call decoration

Relevant prototype code:

- `/Users/yang/Downloads/arize_phoenix_trace.py:236`
- `/Users/yang/Downloads/arize_phoenix_trace.py:508`

This has not been upstreamed, and probably should remain provider-specific or presentation-specific unless a stable cross-provider naming contract is desired.

## 5. Session ID resolution and propagation

The prototype sets `SpanAttributes.SESSION_ID` directly in provider code.

That behavior has not yet been promoted into `TraceInfo` contract fields.

Relevant prototype code:

- `/Users/yang/Downloads/arize_phoenix_trace.py:261`
- `/Users/yang/Downloads/arize_phoenix_trace.py:608`

We already concluded this should be moved upstream conceptually, but today it is not yet represented as a first-class standardized trace field.

## 6. Canonical root protection

The prototype provider currently creates workflow root spans in a way that can produce orphan roots instead of canonical roots.

That indicates root-construction constraints are still not enforced at the standardized contract level.

## Practical Spec Boundary

For the spec, the clean reuse boundary should be:

### Reuse upstream as-is

- workflow and node trace data loading in `ops_trace_manager`
- typed trace contracts in `trace_entity.py`
- existing `parent_trace_context` transport
- existing `resolved_parent_context`
- existing workflow/node identity and timing fields

### Extend upstream

- add explicit session identity contract
- add explicit node-parent / hierarchy contract if we want hierarchy standardized
- possibly add top-level-mode-derived session resolution
- possibly add canonical-root invariants

### Keep provider-specific for now

- Phoenix presentation-oriented span naming
- any UI-oriented metadata that is not part of core tracing semantics

## Working Recommendation

The spec should explicitly say:

1. Do not duplicate upstream normalization already present in `ops_trace_manager`
2. Reuse the existing parent context transport and typed trace contracts
3. Move workflow-internal hierarchy construction upstream if we want it standardized
4. Keep Phoenix-specific naming and display polish out of the core contract unless clearly justified

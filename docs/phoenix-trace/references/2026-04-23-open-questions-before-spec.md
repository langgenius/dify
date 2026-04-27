# Open Questions Before Spec

Date: 2026-04-23
Context: Preserve the important unresolved questions before context compression and before writing the implementation spec for Dify Phoenix hierarchy/session work.

## Confirmed Decisions

These points are already considered settled unless new evidence appears.

### 1. Session semantics in Dify

- top-level workflow app: `session.id = workflow_run_id`
- top-level chatflow app: `session.id = conversation_id`
- nested workflows inherit the outer session identity

### 2. Session semantics are not Phoenix-only

- `session.id` should belong to Dify's tracing contract
- Phoenix session pages / APIs are product features built on top of that attribute

### 3. Prototype root-span issue

- the prototype can show hierarchy in trace detail
- but it appears to produce orphan-root traces rather than canonical-root traces
- that likely explains why Phoenix session queries can return `rootSpan = null`

### 4. Current upstream/downstream split

- `ops_trace_manager` already performs substantial trace normalization
- `trace_entity.py` already contains part of the standardized contract
- `enterprise_trace.py` already consumes `resolved_parent_context`
- workflow-internal hierarchy reconstruction is still not upstreamed

## Open Questions

## 1. Exact placement of new hierarchy construction

We have broad agreement that the new logic should move upstream rather than stay inside a Phoenix-specific provider.

What is still not fully decided is the exact implementation layer:

- `ops_trace_manager.py` only
- `ops_trace_manager.py` + `trace_entity.py`
- partially in `ops_trace_manager.py`, partially finalized in `enterprise_trace.py`

### Why it matters

This determines:

- contract shape
- test surface
- provider reuse
- how much logic remains Phoenix-specific

## 2. Final node-parent rule inside a workflow

We have discussed likely ingredients, but the final rule has not yet been frozen.

Candidates currently include:

- use graph parent when available
- apply runtime correction for branch / loop / iteration semantics
- fallback to execution-order heuristics only when explicit structure is unavailable

### What is still unclear

- whether `predecessor_node_id` is useful enough to participate directly
- whether `end` nodes need special treatment
- how parallel nodes should be represented
- whether fallback heuristics should be allowed in v1 or minimized aggressively

## 3. Scope of v1 hierarchy support

We still need to decide what the first implementation must cover.

Possible scope levels:

- minimal:
  - workflow
  - chatflow
  - nested workflow under tool
- medium:
  - plus loop / branch handling
- broad:
  - plus iteration / parallel / deeply nested workflow chains

### Why it matters

This affects:

- spec size
- implementation risk
- testing matrix
- delivery order

## 4. Canonical-root guarantees

We know the prototype likely creates orphan roots.

What remains to be formalized:

- where canonical-root invariants should be enforced
- whether root-creation rules should be part of trace contract or exporter behavior
- how to verify root correctness in tests

## 5. Session propagation contract shape

We know the semantics, but not yet the exact field design.

Still open:

- should `session_id` become a first-class field on `BaseTraceInfo`
- or remain derived from metadata at first
- where top-level session resolution should happen
- how nested workflows receive inherited session identity

## 6. What remains Phoenix-specific after upstream migration

We already know some logic should stay out of the core tracing contract.

Still to clarify in the spec:

- whether span naming should remain Phoenix-specific
- whether any Phoenix-only metadata should still be attached
- how much presentation-oriented polish belongs outside the shared contract

## 7. Validation plan

We have not yet written the exact verification checklist.

This still needs to be specified:

- which cases to manually verify in Phoenix UI
- which responses to inspect through APIs / GraphQL
- which automated tests to add
- what evidence counts as confirming canonical roots, session grouping, and hierarchy correctness

## Suggested Priority Order

If the next session starts from scratch, the most important unresolved questions to answer first are:

1. Final node-parent rule inside a workflow
2. Exact placement of hierarchy construction in upstream code
3. Scope of v1 support
4. Canonical-root guarantee strategy
5. Session propagation field design

## Useful Reference Files

These notes are the key context files already written in `docs/phoenix-trace/references/`:

- `2026-04-23-prototype-hierarchy-analysis.md`
- `2026-04-23-prototype-session-rootspan-analysis.md`
- `2026-04-23-dify-session-id-semantics.md`
- `2026-04-23-session-id-vs-phoenix-sessions.md`
- `2026-04-23-ops-trace-manager-vs-prototype.md`

## Working Summary

The core remaining work before spec writing is no longer about understanding the prototype.

It is now about productizing the design:

- decide the standardized hierarchy contract
- decide the precise upstream implementation boundary
- decide the first release scope
- define how correctness will be verified

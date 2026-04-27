## Phoenix-Local Spec Decisions

Date: 2026-04-23
Context: Record the decisions made after revisiting the open questions. These decisions intentionally constrain the first implementation to the Phoenix-specific provider layer and avoid upstream refactors that are currently being handled by others.

### 1. Implementation Boundary

The first implementation should stay inside the Phoenix tracing file.

This means:

- Reuse upstream capabilities that already exist
- Do not modify `ops_trace_manager.py`
- Do not modify `trace_entity.py`
- Do not modify `enterprise_trace.py`

The Phoenix-side implementation may consume upstream-standardized fields such as:

- `parent_trace_context`
- `resolved_parent_context`
- existing trace and workflow metadata

### 2. Responsibility Split

The agreed split is a hybrid model:

- Cross-workflow parent / trace / session propagation should reuse upstream data whenever possible
- Internal workflow node hierarchy should still be reconstructed inside the Phoenix file

This means the Phoenix provider remains responsible for rebuilding workflow-internal hierarchy, while avoiding duplication of cross-workflow context propagation that already exists upstream.

### 3. Allowed Phoenix-Side Logic

For v1, the Phoenix file is allowed to:

- read workflow graph structure
- interpret workflow node relationships
- reconstruct node-to-node hierarchy for supported workflow constructs

For v1, it should avoid inventing new upstream contract requirements.

### 4. Node-Parent Rule Direction

The agreed direction is:

- execution-order heuristic is not a primary rule
- runtime-actual parent is preferred
- graph parent is the structural fallback
- workflow root is the safe fallback
- execution-order heuristic is only a last-resort fallback, ideally used in very narrow cases

In short:

1. runtime actual parent
2. graph parent
3. workflow root
4. execution-order heuristic only if absolutely necessary

### 5. V1 Scope

The first version should support:

- top-level workflow
- top-level chatflow
- nested workflow
- serial node chains
- `if/else`
- `loop`
- `iteration`

The first version should not explicitly target:

- `parallel`
- more complex concurrent merge cases

### 6. Canonical Root Requirement

The first version must treat canonical root correctness as a hard requirement.

The rule is:

- the top-level workflow or chatflow trace root span must be created as a true root span with no parent
- only nested workflows may be explicitly attached to an outer tool span
- Phoenix-side hierarchy reconstruction must never fabricate a parent context for the top-level root span

This decision is motivated by the earlier prototype analysis:

- prototype likely produces orphan-root traces instead of canonical-root traces
- that behavior likely contributes to Phoenix session views failing to resolve `rootSpan`

### 7. Overall Direction

The v1 design is intentionally conservative:

- reuse upstream where upstream already expresses stable business semantics
- keep new hierarchy reconstruction logic inside the Phoenix implementation
- prefer correctness and explainability over broad heuristic guessing
- exclude `parallel` from the first version to avoid reopening the parent-selection rules around heavy heuristics

### 8. What Remains Open

Even after these decisions, several details are still intentionally left for the implementation-plan phase:

- which exact upstream fields are sufficient for each supported node type
- the precise parent rule for each node category
- how loop and iteration runtime context should be interpreted in practice
- the exact validation checklist for canonical root, hierarchy, and session grouping

### Summary

The current spec direction is:

- Phoenix-local implementation
- upstream reuse where available
- internal hierarchy reconstruction in the Phoenix file
- support for serial flow, nested workflow, `if/else`, `loop`, and `iteration`
- explicit exclusion of `parallel` in v1
- canonical root correctness as a non-negotiable invariant

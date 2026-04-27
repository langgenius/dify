# Phoenix Hierarchy Spec Decisions

Date: 2026-04-23
Status: Draft decision-record set
Audience: developers working on the transitional Phoenix-local hierarchy implementation

## Purpose

This directory consolidates the earlier exploration notes into a smaller set of decision-oriented spec documents.

The earlier notes remain the detailed evidence trail. These files are the normalized decision layer that later implementation plans can reference directly.

## Source Notes

These decision records are derived from the following earlier analysis notes:

- `../2026-04-23-prototype-hierarchy-analysis.md`
- `../2026-04-23-prototype-session-rootspan-analysis.md`
- `../2026-04-23-dify-session-id-semantics.md`
- `../2026-04-23-session-id-vs-phoenix-sessions.md`
- `../2026-04-23-ops-trace-manager-vs-prototype.md`
- `../2026-04-23-open-questions-before-spec.md`
- `../2026-04-23-phoenix-local-spec-decisions.md`

## Related Commits

The underlying notes were recorded in these commits:

- `b74a60b2c8` `docs: add prototype hierarchy analysis notes`
- `13eaf0b3d7` `docs: add session and root span analysis notes`
- `25274e76d0` `docs: refine orphan root analysis for phoenix sessions`
- `d5d362210d` `docs: add dify session id semantics notes`
- `4e252c2b53` `docs: add session id versus phoenix sessions notes`
- `65dd285d1b` `docs: compare ops trace manager with prototype`
- `f3f37c87df` `docs: add open questions before spec`
- `3649456650` `docs: add phoenix-local spec decisions notes`

## Decision Records

### 0001. Transitional Phoenix-Local Boundary

File: `0001-phoenix-local-boundary.md`

Defines the implementation boundary for v1:

- keep changes inside the Phoenix provider file
- reuse upstream capabilities where available
- do not modify upstream tracing builders or contracts in this phase

### 0002. Reuse and Transition Strategy

File: `0002-reuse-and-transition-strategy.md`

Defines the reuse rule:

- upstream semantics first
- Phoenix fills gaps only when necessary
- many Phoenix-local semantics are transitional and should eventually move upstream

### 0003. V1 Hierarchy Scope and Parent Rules

File: `0003-v1-hierarchy-scope-and-parent-rules.md`

Defines what v1 must cover and the parent-selection direction:

- serial nodes
- nested workflows
- `if/else`
- `loop`
- `iteration`
- no `parallel` in v1
- execution-order heuristic only as last-resort fallback

### 0004. Canonical Root and Session Principles

File: `0004-canonical-root-and-session-principles.md`

Defines:

- canonical root as a hard invariant
- session semantics for workflow and chatflow
- the rule that Phoenix should reuse upstream session semantics before applying local fallback logic

### 0005. Nested Workflow Session Inheritance In Phoenix

File: `0005-nested-workflow-session-inheritance.md`

Defines the Phoenix-local session unification rule for nested workflows:

- keep `conversation_id` first for chatflow
- let nested workflow inherit the outer workflow session through `parent_workflow_run_id`
- treat session unification and session-summary input/output issues as separate concerns

### 0006. Two-Phase Upstream Parent Context Strategy

File: `0006-two-phase-upstream-parent-context-strategy.md`

Defines the next upstream direction after debugging the workflow-as-tool gap:

- Phase 1 injects `outer_workflow_run_id` to unblock session unification
- Phase 2 separately designs how to expose `outer_node_execution_id`
- avoid forcing session correctness and parent-span correctness into one patch

### 0007. Cross-Repo Workflow-Tool Parent Context Propagation

File: `0007-cross-repo-workflow-tool-parent-context.md`

Defines the cross-repo ownership boundary:

- Graphon owns the tool runtime contract and execution context exposure
- Dify owns adapter translation into runtime parameters and tracing metadata
- the feature should be delivered as coordinated Graphon + Dify changes

### 0008. Phoenix Parent Tool-Span Resolution For Nested Workflows

File: `0008-phoenix-parent-tool-span-resolution.md`

Defines the final Phoenix-local step after trace/session unification:

- publish emitted tool-span context keyed by `node_execution_id`
- resolve nested workflow parent context from `parent_node_execution_id`
- use bounded retry when child trace tasks arrive before the parent tool span context exists

## How To Use These Files

Use this decision set as the policy layer for the implementation plan.

- Use the older notes for evidence and historical reasoning
- Use the files in this directory for current decisions
- Keep implementation comments aligned with the transitional intent described here

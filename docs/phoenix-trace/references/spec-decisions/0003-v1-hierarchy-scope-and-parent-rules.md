# 0003. V1 Hierarchy Scope and Parent Rules

Date: 2026-04-23
Status: Accepted for v1

## Context

The reimplementation should preserve the useful hierarchy behaviors from the prototype without carrying over prototype-heavy dependence on execution-order guessing.

The first version should focus on the workflow constructs that matter most for real usage while keeping the rules explainable and testable.

## Decision

### Supported In V1

V1 should support hierarchy reconstruction for:

- top-level workflow
- top-level chatflow
- nested workflow
- serial node chains
- `if/else`
- `loop`
- `iteration`

### Explicitly Out Of Scope For V1

V1 does not explicitly target:

- `parallel`
- more complex concurrent merge patterns

## Parent Rule Direction

The parent-selection direction for v1 is:

1. runtime actual parent
2. graph parent
3. workflow root
4. execution-order heuristic only as a last-resort fallback

## Rule Intention

### Start Nodes

`start` nodes should attach directly under the current workflow span.

### Serial Nodes

Serial nodes should prefer the runtime-actual triggering parent. If that cannot be determined, the implementation may use the graph parent. If neither is reliable, the node should safely fall back to the workflow root.

### Branching Nodes

For `if/else`-like branching, the active branch selected at runtime should take precedence over static graph ambiguity.

### Loop and Iteration

For `loop` and `iteration`, the implementation should preserve runtime-local structure and avoid linking nodes across rounds merely because they executed close together in time.

### End Nodes

If a reliable final upstream node can be identified, `end` may attach to it. Otherwise, `end` should safely attach to the workflow root rather than rely on aggressive guessing.

## Anti-Goal

Execution-order heuristic should not be a primary modeling strategy.

It may exist as a narrow last resort, but v1 should not be defined around “attach to the most recently executed node” as a general rule.

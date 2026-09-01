# Component Architecture Audit

Read this document for architecture audits, refactoring designs, and the final ownership verification after an implementation refactor.

## Audit Procedure

For a named component, use it as the audit root. For a refactoring request, use the nearest route, page, feature entrypoint, or behavior owner whose state contract is changing.

1. Build the complete locally owned rendered component tree from the root to every leaf. Follow imported feature components, conditional branches, lists, portals, dialogs, drawers, popovers, and secondary surfaces. Stop at third-party primitives, Dify UI primitives, or an explicit stable feature boundary, but record the props passed across the final edge.
2. At every component, inventory React state and reducers, form and uncontrolled DOM state, URL and route state, Context/Jotai/store reads and writes, queries, mutations, refs that hold workflow or lifecycle state, custom-hook results, render-time derived facts, and workflow commands or handlers.
3. For every value, record its authoritative owner/source, graph role, declaring component, consuming branches, lifetime and reset/isolation requirements, and whether it is local, shared, forwarded, mirrored, or persisted.
4. Inspect every meaningful props edge. Mark each prop as consumed, forwarded unchanged, renamed, recomputed, mirrored into local state, or paired with lifecycle fields such as `data/pending/error/retry` and `open/onOpenChange`.
5. Draw the current state graph in dependency order and assess ownership only after the complete paths are mapped. Group related problems at the highest incorrect owner instead of repeating the same issue for every descendant.
6. Give every current local component an explicit target disposition: keep, split, merge, remove, rename, promote to an owner, or demote to presentation. Map every current state or workflow owner to a target component and reset boundary.
7. Redraw the target rendered tree independently of the current file layout. Split only when state lifetime, interaction lifecycle, behavior ownership, or an independently changing visual region establishes a real boundary. Merge or remove components that only forward, rename, or obscure a single owner's contract.
8. For refactoring design or implementation planning, define ordered migration slices with explicit state-file changes, component moves/splits/merges, observable verification boundaries, and intentionally temporary props edges.

A rename, facade wrapper, props bag, Context, or provider around the same switchboard does not count as a boundary redesign. Correctness bugs may illustrate an ownership defect, but architecture-audit mode does not prioritize or severity-rank bug findings.

## Audit Output

Cover the following information. Merge sections or omit empty tables when the review is small, but do not omit applicable values, paths, edges, owners, or reset boundaries:

1. **Review boundary:** root component, locally owned rendered paths, and stopping boundaries.
2. **Rendered component tree:** every local branch and secondary surface followed.
3. **State inventory:** owner/source, graph role, graph-entry decision, declaration, consumers, and lifetime/reset needs for every stateful value, query, mutation, ref, custom-hook result, derived fact, and command.
4. **Props-edge ledger:** every meaningful parent-child edge and how each prop is treated.
5. **Current architecture:** state graph, component owners, and ownership assessment.
6. **Component dispositions:** the target disposition of every current local component and the destination of every current state/workflow owner.
7. **Target architecture:** target rendered tree, state graph, owners, component contracts, and reset boundaries.
8. **Migration slices:** required for refactoring design; include them in an audit when they materially clarify how to reach the target.

Use compact tables when they make full accounting easier to verify:

| Value | Source/role | Declared at | Consumers | Props path | Lifetime/reset | Recommended owner |
| --- | --- | --- | --- | --- | --- | --- |

| Edge | Prop | Treatment | Real consumer | Assessment |
| --- | --- | --- | --- | --- |

| Current component | Current responsibilities | Target disposition | Target owner(s) | Reason |
| --- | --- | --- | --- | --- |

| Target component | Owned state/workflow | Children | Public contract | Reset boundary |
| --- | --- | --- | --- | --- |

## Implementation Completion Gate

Repeat the audit against the final code. Do not describe an implementation or refactor as complete until all applicable checks pass:

- every locally owned rendered path, meaningful props edge, and stateful value is represented in the component tree, inventory, or ledger;
- every current local component has a target disposition, and every current state/workflow owner maps to an implemented component and reset boundary;
- every multi-consumer graph value has one authoritative bridge or graph node and a named owner;
- route or URL identity is read directly by a single consumer or bridged once, not also threaded through descendant props;
- query keys, observer objects, `refetch`, loading/error groups, and cache invalidation mechanics do not cross a boundary unless the child owns the query surface;
- no page, hook, provider, or Context mainly destructures, renames, and redistributes another state machine;
- components consume focused fields, named facts, or domain commands instead of rebuilding shared business conclusions;
- query and mutation atoms remain cache-shared, while only resettable workflow primitives or boundary snapshots are scoped;
- every remaining multi-layer prop edge is justified as stable identity, an immutable display snapshot, placement, or a named cross-boundary command;
- the final rendered tree, state graph, owner map, contracts, and reset boundaries match the implemented code rather than only the initial design.

If the user requests incremental commits, a slice may intentionally leave documented edges for a later slice. The final requested slice must still pass this gate.

---
name: how-to-write-component
description: Use when implementing, refactoring, or conducting architecture-oriented reviews of React/TypeScript components involving component ownership, state graphs, props, feature boundaries, data flow, effects, lifecycle/reset behavior, or interaction ownership. Architecture reviews trace the locally owned component tree root-to-leaf, account for every state source and props edge, and re-cut component boundaries from ownership and lifecycle instead of treating current files as fixed. Do not use for bug, regression, security, or accessibility audits; test-only work; copy-only edits; or styling-only changes.
---

# How To Write A Component

Use this skill to make component architecture explicit before implementation. Classify state on two independent axes:

1. **Owner/source:** the component, a parent boundary, URL/framework APIs, TanStack Query, or the feature workflow.
2. **Graph role:** primitive input, query/mutation node, derived business fact, or workflow command.

Then mark instance isolation/reset as a lifecycle requirement, not another node type. Do not force one label to answer both axes. Read only the bundled references required by the current change.

Make shared feature state visible as a dependency graph instead of hiding it in a component, a giant hook, or a provider adapter. When a value drives a query or command, feeds reusable derivation, is consumed by another owner, or bridges an external source for several consumers, it has entered the feature state graph. In this repository, use feature-local Jotai as the default representation for that graph. Keep owner-local display state and submit-only fields in the component or DOM.

## Operating Modes

Choose the mode from the user's requested outcome:

- **Architecture audit:** Perform a read-only analysis of an existing component. Trace the complete locally owned rendered tree from the named root to its leaves, inventory every state source and props edge, evaluate ownership and lifecycle, then propose the target state graph and component boundaries. Do not lead with bug findings or severity levels.
- **Refactoring design:** Perform the architecture audit, then produce target contracts, migration slices, and a verification strategy without modifying code.
- **Implementation:** Establish the affected target state graph, owner map, and props edges before the first edit, then implement one coherent vertical slice at a time. After the final requested slice, rerun the complete root-to-leaf ownership and props audit before declaring the refactor complete.
- **Bug or regression review:** Use the frontend code-review workflow unless the user explicitly requests this skill's architecture model as an additional lens.

## First Decisions

| Question | Default | Choose differently when |
| --- | --- | --- |
| Where should code live? | In the product workflow, route, or feature owner. | Several verticals need the same stable contract. |
| Who owns state and handlers? | The lowest owner that consumes them and whose lifetime matches the state. | Another owner coordinates the value or it must survive the local owner's unmount. |
| Should React control a value? | Leave submit-only DOM fields uncontrolled. | The workflow must own the current value to drive rendering or coordination. |
| Should state enter Jotai? | Keep isolated display state and submit-only fields local. Once a value enters the feature state graph, use feature-local Jotai first. | An existing stable graph/store already owns the same contract, or the value remains entirely owner-local. |
| Who owns URL state? | Next.js route APIs and `nuqs`. | Atoms need a route-identity bridge for queries or shared derivations. URL writes still stay with the URL owner. |
| Who owns remote state? | TanStack Query at the lowest consumer. | Atom state drives the query, shared derivations consume its result, or a workflow command coordinates it. |
| Is a wrapper needed? | Use the primitive or direct code. | The wrapper owns behavior, validation, state, or semantics. |
| Is an Effect needed? | Derive during render or handle the user action. | A named external system must be synchronized. |

## State Graph Entry Gate

A value enters the feature state graph when any of these are true:

- it drives a query, mutation, workflow command, or another graph node;
- several sibling owners consume it or a parent would otherwise relay it through more than one layer;
- it is route, URL, Query, or parent-owned input needed by several queries, facts, or commands;
- it needs named derivation, coordinated writes, workflow persistence, or instance-scoped reset.

For values that enter the graph:

- create or extend a feature-local state file/folder ordered as inputs -> query/mutation nodes -> field selectors -> named business facts -> commands -> runtime orchestration;
- bridge external owners such as route APIs, `nuqs`, and TanStack Query without copying their state into a second owner;
- expose field selectors, named facts, and domain commands to components, not a complete query result, a hook result object, raw query keys, or `refetch` plumbing;
- keep query and mutation atoms unscoped; scope only primitives and injected snapshots whose instances must reset or remain isolated;
- do not use Context, a provider value object, or a large custom hook as an atom substitute when it merely repackages the same state machine.

Context remains appropriate for stable external dependencies or an existing authoritative product boundary. Local `useState`, `useQuery`, and `useMutation` remain appropriate when one component owns their complete lifecycle and no other graph node consumes them.

## Topic Routing

- Architecture audits, component moves, module boundaries, props, types, owner placement, or parent input that creates a child state graph: read [`references/ownership.md`][ownership].
- Architecture audits involving state ownership, state graphs, route identity, isolation, reset, drafts, or persistence: also read [`references/state.md`][state].
- Jotai, state graphs, form drafts, route identity, URL state, isolation/reset, or persistence: read [`references/state.md`][state].
- Generated contracts, nullable API data, Query, mutations, SSR, auth, or workspace state: read [`references/data.md`][data].
- Hotkeys, focus, dialogs, menus, popovers, or other secondary surfaces: read [`references/interactions.md`][interactions] and the overlay guide it references when applicable. Also read [`references/state.md`][state] when the surface owns a draft or other local session state.
- Effects, navigation, memoization, preloading, or render cost: read [`references/runtime.md`][runtime].

## Workflow

Follow this order so component splitting does not precede ownership decisions:

1. **Boundary:** identify the route, tab, workflow, or action surface that owns the behavior and state lifetime. Inspect nearby sibling feature state files and established graph boundaries before inventing a new pattern.
2. **Data contract:** identify generated API types, URL inputs, Query cache data, and user-input normalization boundaries.
3. **State graph:** list graph inputs, query/mutation nodes, field selectors, named derived facts, commands, runtime controllers, and scope/reset needs. Decide explicitly for every stateful value whether it enters the graph. When a graph exists, create its feature-local state file before wiring components. Keep unrelated local UI state out.
4. **Re-cut the component tree:** treat current components and files as evidence, not target constraints. For every current local component, decide whether to keep, split, merge, remove, rename, promote to an owner, or demote to presentation based on state lifetime, behavior ownership, interaction lifecycle, and independently changing visual regions.
5. **Component contracts:** place data, loading, empty, error, and handlers at the lowest real consumer; define only the props that cross true owner boundaries.
6. **Interaction surfaces:** give forms, menus, dialogs, drawers, and popovers explicit lifecycle owners.
7. **Finish and verify:** remove copied state, unnecessary Effects/wrappers/memoization/nullable coercion, rerun the props-edge and owner ledger, then verify observable behavior at the narrowest sufficient boundary.

## Implementation Completion Gate

Do not describe an implementation or refactor as complete until all applicable checks pass:

- every multi-consumer graph value has one authoritative bridge or graph node and a named owner;
- route/URL identity is read directly by a single consumer or bridged once; the same identity is not also threaded through descendant props;
- query keys, observer objects, `refetch`, loading/error groups, and cache invalidation mechanics do not cross a component boundary unless the child is the actual query surface owner;
- no page, hook, provider, or Context mainly destructures, renames, and redistributes another state machine;
- components consume field selectors, named facts, or domain commands instead of rebuilding shared business conclusions;
- query/mutation atoms remain cache-shared, while only resettable workflow primitives or boundary snapshots are scoped;
- every remaining multi-layer prop edge is listed and justified as stable identity, an immutable display snapshot, placement, or a named cross-boundary command;
- the final root-to-leaf rendered tree, state graph, owner map, and reset boundaries match the implemented code rather than only the initial design.

If the user requests incremental commits, a slice may intentionally leave documented edges for a later slice. The final slice must still pass this gate.

## Architecture Audit Output

In architecture-audit mode, report:

1. **Review boundary:** the root component, locally owned rendered paths, and stopping boundaries.
2. **Rendered component tree:** every local branch and secondary surface followed during the audit.
3. **State inventory:** owner/source, graph role, graph-entry decision, declaration, consumers, and lifetime/reset needs for every stateful value, query, mutation, ref, custom-hook result, derived fact, and command.
4. **Props-edge ledger:** every meaningful parent-child props edge and whether each prop is consumed, forwarded, renamed, recomputed, mirrored, or paired with lifecycle state.
5. **Current state graph:** primitive inputs -> queries/mutations -> named facts -> commands -> consumers.
6. **Ownership assessment:** misplaced state, switchboard parents, duplicated owners, mirrored state, prop fan-out, and unclear lifecycle boundaries.
7. **Component-boundary disposition:** account for every current local component as keep, split, merge, remove, rename, promote to owner, or demote to presentation. Map every current state/workflow owner to a target component, and justify boundary changes by ownership, lifecycle, behavior, or an independently changing visual region.
8. **Target architecture:** redraw the target rendered component tree independently of the current file layout, then report proposed owners, component contracts, reset boundaries, and the target state graph. Do not count a renamed component, facade wrapper, props bag, or provider around the same switchboard as a boundary redesign.
9. **Migration slices:** ordered refactoring steps with explicit state-file changes, component moves/splits/merges, observable verification boundaries, and intentionally temporary props edges.

Do not organize an architecture audit by bug severity unless the user also requests a correctness review. Use compact tables where they make full accounting easier to verify:

| Value | Source/role | Declared at | Consumers | Props path | Lifetime/reset | Recommended owner |
| --- | --- | --- | --- | --- | --- | --- |

| Edge | Prop | Treatment | Real consumer | Assessment |
| --- | --- | --- | --- | --- |

| Current component | Current responsibilities | Target disposition | Target owner(s) | Reason |
| --- | --- | --- | --- | --- |

| Target component | Owned state/workflow | Children | Public contract | Reset boundary |
| --- | --- | --- | --- | --- |

## Patterns To Avoid

- A giant component, switchboard page, or view-model hook that redistributes a large props-and-handlers bag: move single-branch state down and expose focused feature facts and commands for shared workflows.
- A provider or Context that converts a giant hook or props bag into several value objects without changing the underlying owner graph.
- Route identity threaded through the component tree after it has already been bridged into a feature graph or is available from an authoritative route/product context.
- Query keys, observer methods, cache invalidation details, or `data/pending/error/retry` groups passed from a parent that does not render or coordinate those states.
- A second owner created by copying props, URL values, or Query data into local state or atoms: bridge the authoritative owner instead.
- Components that consume a whole query atom or repeatedly derive the same business conclusion: expose a field selector or named fact.
- Query or mutation atoms placed in a scope, or an edit-session snapshot overwritten by forced hydration: scope only the primitives whose instances must reset.
- Effects used to fetch data, copy render state, react to user actions, or reset from props: derive during render, handle the event, or use the owning data API.
- Wrappers, helpers, memoization, or nullable coercion that only hide unclear ownership: fix the boundary before adding abstraction or optimization.

Read the nearby implementation, tests, sibling state files, and existing feature boundaries before analyzing or changing code. In architecture-audit and refactoring-design modes, do not modify code. When implementation is requested, implement one coherent vertical slice; complete equivalent ownership fixes inside the audited feature when the target contract depends on them, but do not expand into unrelated features. Run the checks documented by the owning package: `web/docs/test.md` or `web/docs/lint.md` for Web, and `packages/dify-ui/docs/testing.md` for Dify UI.

[data]: references/data.md
[interactions]: references/interactions.md
[ownership]: references/ownership.md
[runtime]: references/runtime.md
[state]: references/state.md

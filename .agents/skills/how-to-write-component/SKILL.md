---
name: how-to-write-component
description: Use when implementing, refactoring, or conducting architecture-oriented reviews of React/TypeScript components involving component ownership, state graphs, props, feature boundaries, data flow, effects, lifecycle/reset behavior, or interaction ownership. Architecture reviews trace the locally owned component tree root-to-leaf and account for every state source and props edge. Do not use for bug, regression, security, or accessibility audits; test-only work; copy-only edits; or styling-only changes.
---

# How To Write A Component

Use this skill to make component architecture explicit before implementation. Classify state on two independent axes:

1. **Owner/source:** the component, a parent boundary, URL/framework APIs, TanStack Query, or the feature workflow.
2. **Graph role:** primitive input, query/mutation node, derived business fact, or workflow command.

Then mark instance isolation/reset as a lifecycle requirement, not another node type. Do not force one label to answer both axes. Read only the bundled references required by the current change.

## Operating Modes

Choose the mode from the user's requested outcome:

- **Architecture audit:** Perform a read-only analysis of an existing component. Trace the complete locally owned rendered tree from the named root to its leaves, inventory every state source and props edge, evaluate ownership and lifecycle, then propose the target state graph and component boundaries. Do not lead with bug findings or severity levels.
- **Refactoring design:** Perform the architecture audit, then produce target contracts, migration slices, and a verification strategy without modifying code.
- **Implementation:** Perform enough of the architecture audit to establish ownership, then implement one coherent vertical slice and verify it.
- **Bug or regression review:** Use the frontend code-review workflow unless the user explicitly requests this skill's architecture model as an additional lens.

## First Decisions

| Question | Default | Choose differently when |
| --- | --- | --- |
| Where should code live? | In the product workflow, route, or feature owner. | Several verticals need the same stable contract. |
| Who owns state and handlers? | The lowest owner that consumes them and whose lifetime matches the state. | Another owner coordinates the value or it must survive the local owner's unmount. |
| Should React control a value? | Leave submit-only DOM fields uncontrolled. | The workflow must own the current value to drive rendering or coordination. |
| Should state enter Jotai? | Keep isolated display state and submit-only fields local. | A value drives a query or command, feeds reusable derivation, is consumed by another owner, or needs scoped workflow persistence. |
| Who owns URL state? | Next.js route APIs and `nuqs`. | Atoms need a route-identity bridge for queries or shared derivations. URL writes still stay with the URL owner. |
| Who owns remote state? | TanStack Query at the lowest consumer. | Atom state drives the query, shared derivations consume its result, or a workflow command coordinates it. |
| Is a wrapper needed? | Use the primitive or direct code. | The wrapper owns behavior, validation, state, or semantics. |
| Is an Effect needed? | Derive during render or handle the user action. | A named external system must be synchronized. |

## Topic Routing

- Architecture audits, component moves, module boundaries, props, types, owner placement, or parent input that creates a child state graph: read [`references/ownership.md`][ownership].
- Architecture audits involving state ownership, state graphs, route identity, isolation, reset, drafts, or persistence: also read [`references/state.md`][state].
- Jotai, state graphs, form drafts, route identity, URL state, isolation/reset, or persistence: read [`references/state.md`][state].
- Generated contracts, nullable API data, Query, mutations, SSR, auth, or workspace state: read [`references/data.md`][data].
- Hotkeys, focus, dialogs, menus, popovers, or other secondary surfaces: read [`references/interactions.md`][interactions] and the overlay guide it references when applicable. Also read [`references/state.md`][state] when the surface owns a draft or other local session state.
- Effects, navigation, memoization, preloading, or render cost: read [`references/runtime.md`][runtime].

## Workflow

Follow this order so component splitting does not precede ownership decisions:

1. **Boundary:** identify the route, tab, workflow, or action surface that owns the behavior and state lifetime.
2. **Data contract:** identify generated API types, URL inputs, Query cache data, and user-input normalization boundaries.
3. **State graph:** list graph inputs, query/mutation nodes, named derived facts, commands, and any scope/reset needs. Keep unrelated local UI state out.
4. **Component contracts:** place data, loading, empty, error, and handlers at the lowest real consumer; define only the props that cross true owner boundaries.
5. **Interaction surfaces:** give forms, menus, dialogs, drawers, and popovers explicit lifecycle owners.
6. **Finish and verify:** remove copied state, unnecessary Effects/wrappers/memoization/nullable coercion, then verify observable behavior at the narrowest sufficient boundary.

## Architecture Audit Output

In architecture-audit mode, report:

1. **Review boundary:** the root component, locally owned rendered paths, and stopping boundaries.
2. **Rendered component tree:** every local branch and secondary surface followed during the audit.
3. **State inventory:** owner/source, graph role, declaration, consumers, and lifetime/reset needs for every stateful value, query, mutation, ref, custom-hook result, derived fact, and command.
4. **Props-edge ledger:** every meaningful parent-child props edge and whether each prop is consumed, forwarded, renamed, recomputed, mirrored, or paired with lifecycle state.
5. **Current state graph:** primitive inputs -> queries/mutations -> named facts -> commands -> consumers.
6. **Ownership assessment:** misplaced state, switchboard parents, duplicated owners, mirrored state, prop fan-out, and unclear lifecycle boundaries.
7. **Target architecture:** proposed owners, component contracts, and target state graph.
8. **Migration slices:** ordered refactoring steps with observable verification boundaries.

Do not organize an architecture audit by bug severity unless the user also requests a correctness review. Use compact tables where they make full accounting easier to verify:

| Value | Source/role | Declared at | Consumers | Props path | Lifetime/reset | Recommended owner |
| --- | --- | --- | --- | --- | --- | --- |

| Edge | Prop | Treatment | Real consumer | Assessment |
| --- | --- | --- | --- | --- |

## Patterns To Avoid

- A giant component, switchboard page, or view-model hook that redistributes a large props-and-handlers bag: move single-branch state down and expose focused feature facts and commands for shared workflows.
- A second owner created by copying props, URL values, or Query data into local state or atoms: bridge the authoritative owner instead.
- Components that consume a whole query atom or repeatedly derive the same business conclusion: expose a field selector or named fact.
- Query or mutation atoms placed in a scope, or an edit-session snapshot overwritten by forced hydration: scope only the primitives whose instances must reset.
- Effects used to fetch data, copy render state, react to user actions, or reset from props: derive during render, handle the event, or use the owning data API.
- Wrappers, helpers, memoization, or nullable coercion that only hide unclear ownership: fix the boundary before adding abstraction or optimization.

Read the nearby implementation and tests before analyzing or changing code. In architecture-audit and refactoring-design modes, do not modify code. When implementation is requested, implement one coherent vertical slice; do not expand into equivalent patterns elsewhere unless the current contract cannot be completed without them. Run the checks documented by the owning package: `web/docs/test.md` or `web/docs/lint.md` for Web, and `packages/dify-ui/docs/testing.md` for Dify UI.

[data]: references/data.md
[interactions]: references/interactions.md
[ownership]: references/ownership.md
[runtime]: references/runtime.md
[state]: references/state.md

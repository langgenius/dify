---
name: how-to-write-component
description: Use when implementing or refactoring React/TypeScript components and the task requires decisions about component ownership, feature boundaries, state, data flow, effects, or interaction ownership. Do not use for review-only requests, test-only work, copy-only edits, or styling-only changes.
---

# How To Write A Component

Use this skill to make component architecture explicit before implementation. Classify state on two independent axes:

1. **Owner/source:** the component, a parent boundary, URL/framework APIs, TanStack Query, or the feature workflow.
2. **Graph role:** primitive input, query/mutation node, derived business fact, or workflow command.

Then mark instance isolation/reset as a lifecycle requirement, not another node type. Do not force one label to answer both axes. Read only the bundled references required by the current change.

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

- Component moves, module boundaries, props, types, owner placement, or parent input that creates a child state graph: read [`references/ownership.md`][ownership].
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

Read the nearby implementation and tests before changing code. Implement one coherent vertical slice; do not expand into equivalent patterns elsewhere unless the current contract cannot be completed without them. Run the checks documented by the owning package: `web/docs/test.md` or `web/docs/lint.md` for Web, and `packages/dify-ui/docs/testing.md` for Dify UI.

[data]: references/data.md
[interactions]: references/interactions.md
[ownership]: references/ownership.md
[runtime]: references/runtime.md
[state]: references/state.md

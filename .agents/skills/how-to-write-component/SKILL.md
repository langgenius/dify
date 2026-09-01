---
name: how-to-write-component
description: Use when implementing, refactoring, or architecture-reviewing React/TypeScript components whose ownership, state lifetimes, data flow, props, feature boundaries, effects, or interaction surfaces need redesign. Do not use for bug, regression, security, or accessibility audits; test-only work; copy-only edits; or styling-only changes.
---

# React Component Architecture

Use this skill to make component ownership and lifecycle explicit before implementation. Classify every stateful value on three independent dimensions:

1. **Owner/source:** a component, parent boundary, URL/framework API, TanStack Query, or feature workflow.
2. **Graph role:** primitive input, query/mutation node, derived business fact, or workflow command.
3. **Lifecycle:** instance isolation, persistence, and reset requirements.

Do not force one label to answer all three dimensions.

Keep display state, submit-only fields, and owner-local queries or mutations with the component or DOM that owns their complete lifecycle. A value enters the feature state graph only when it crosses an ownership boundary, participates in shared derivation or coordination, or must outlive/reset independently of its current owner. Driving an owner-local query or command alone is not sufficient. In this repository, use feature-local Jotai as the default representation once a value enters that graph.

## Operating Modes

Choose the mode from the user's requested outcome:

- **Architecture audit:** Perform a read-only, root-to-leaf analysis and propose the target ownership model. Read [`references/audit.md`][audit] and [`references/ownership.md`][ownership].
- **Refactoring design:** Perform the architecture audit, then provide target contracts, migration slices, and a verification strategy without modifying code. Read [`references/audit.md`][audit] and [`references/ownership.md`][ownership].
- **Implementation:** Establish the affected owner map, state graph, props edges, and reset boundaries before editing. Implement one coherent vertical slice at a time, then run the final audit in [`references/audit.md`][audit]. Read [`references/ownership.md`][ownership].
- **Bug or regression review:** Use the frontend code-review workflow unless the user explicitly requests this skill's architecture model as an additional lens.

## First Decisions

| Question | Default | Choose differently when |
| --- | --- | --- |
| Where should code live? | In the product workflow, route, or feature owner. | Several verticals need the same stable contract. |
| Who owns state and handlers? | The lowest owner whose consumers and lifetime match the state. | Another owner coordinates it or it must survive the local owner's unmount. |
| Should React control a value? | Leave submit-only DOM fields uncontrolled. | The workflow needs the current value for rendering or coordination. |
| Should state enter Jotai? | Keep owner-local state local. Use feature-local Jotai after a value enters the feature state graph. | An existing stable graph/store already owns the contract. |
| Who owns URL state? | Next.js route APIs and `nuqs`. | Atoms need one route-identity bridge for shared queries or derivations. URL writes still stay with the URL owner. |
| Who owns remote state? | TanStack Query at the lowest complete consumer. | Atom state drives shared work, another graph node consumes the result, or a workflow command coordinates it. |
| Is a wrapper needed? | Use the primitive or direct code. | The wrapper owns behavior, validation, state, semantics, or necessary integration. |
| Is an Effect needed? | Derive during render or handle the user action. | A named external system must be synchronized. |

## Reference Routing

After selecting the operating mode, read only the topic references required by the change:

- Jotai, graph-entry decisions, form drafts, shared client state, route identity, URL state, isolation/reset, or persistence: read [`references/state.md`][state].
- Generated contracts, nullable API data, Query, mutations, SSR, authentication, or workspace state: read [`references/data.md`][data].
- A feature graph that combines Jotai isolation with TanStack Query atoms or commands: read both [`references/state.md`][state] and [`references/data.md`][data].
- Hotkeys, focus, dialogs, menus, popovers, or other secondary surfaces: read [`references/interactions.md`][interactions] and the overlay guide it references when applicable. Also read [`references/state.md`][state] when the surface owns a draft or session state.
- Effects, navigation, memoization, preloading, or render cost: read [`references/runtime.md`][runtime].

## Common Workflow

Follow this order so component splitting does not precede ownership decisions:

1. **Boundary and evidence:** identify the route, tab, workflow, or action surface that owns the behavior and lifetime. Inspect nearby implementation, tests, sibling state files, and established feature boundaries.
2. **Current model:** identify generated data contracts and authoritative external inputs, then inventory state, queries, mutations, derived facts, commands, refs, and meaningful props edges.
3. **Target graph and owners:** decide explicitly which values remain local and which enter the feature graph. Define authoritative bridges, graph nodes, component owners, and scope/reset boundaries before creating files or wiring components.
4. **Re-cut the tree:** treat current files as evidence rather than target constraints. Keep, split, merge, remove, rename, promote, or demote components based on ownership, lifecycle, behavior, and independently changing visual regions.
5. **Contracts and interactions:** place data, loading, empty, error, and handlers at the lowest real consumer. Cross true owner boundaries only with stable identity, a small immutable snapshot, placement, or a named command. Give forms and secondary surfaces explicit lifecycle owners.
6. **Finish and verify:** remove copied state and unnecessary Effects, wrappers, memoization, or nullable coercion. Rerun the final owner, graph, props-edge, and reset audit, then verify observable behavior at the narrowest sufficient boundary.

## Scope And Verification

In architecture-audit and refactoring-design modes, do not modify code. In implementation mode, complete equivalent ownership fixes inside the audited feature when the target contract depends on them, but do not expand into unrelated features. Incremental slices may retain documented temporary edges; the final requested slice must pass the completion gate in [`references/audit.md`][audit].

Run the checks documented by the owning package: `web/docs/test.md` or `web/docs/lint.md` for Web, and `packages/dify-ui/docs/testing.md` for Dify UI.

[audit]: references/audit.md
[data]: references/data.md
[interactions]: references/interactions.md
[ownership]: references/ownership.md
[runtime]: references/runtime.md
[state]: references/state.md

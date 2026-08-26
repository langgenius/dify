---
name: how-to-write-component
description: Use when implementing or refactoring React/TypeScript components and the task requires decisions about component ownership, feature boundaries, state, data flow, effects, or interaction ownership. Do not use for review-only requests, test-only work, copy-only edits, or styling-only changes.
---

# How To Write A Component

Use this skill to route component architecture decisions to its bundled references. Read only the references required by the current change.

## First Decisions

| Question | Default | Promote only when |
| --- | --- | --- |
| Where should code live? | In the product workflow, route, or feature owner. | Several verticals need the same stable contract. |
| Who owns state and handlers? | The lowest visual owner that consumes them. | A parent coordinates one workflow or consistent snapshot. |
| Should state enter Jotai? | Keep component and form state local. | Siblings need one source of truth or scoped workflow persistence. |
| Who owns URL state? | Next.js route APIs and `nuqs`. | Atoms require a read-only route-identity bridge. |
| Who owns remote state? | TanStack Query at the lowest consumer. | Atom state drives the query or shared derivations consume it. |
| Is a wrapper needed? | Use the primitive or direct code. | The wrapper owns behavior, validation, state, or semantics. |
| Is an Effect needed? | Derive during render or handle the user action. | A named external system must be synchronized. |

## Topic Routing

- Component moves, module boundaries, props, types, or owner placement: read [`references/ownership.md`][ownership].
- Jotai, form drafts, route identity, URL state, or persistence: read [`references/state.md`][state].
- Generated contracts, nullable API data, Query, mutations, SSR, auth, or workspace state: read [`references/data.md`][data].
- Hotkeys, focus, dialogs, menus, popovers, or other secondary surfaces: read [`references/interactions.md`][interactions] and the overlay guide it references when applicable.
- Effects, navigation, memoization, preloading, or render cost: read [`references/runtime.md`][runtime].

## Workflow

1. Identify the behavior owner and the public contract being changed.
2. Read the nearby implementation, tests, and only the routed skill references.
3. Implement one coherent vertical slice. Do not expand into equivalent patterns elsewhere unless the current contract cannot be completed without them.
4. Verify observable behavior at the narrowest sufficient boundary, then run the checks documented by the owning package: `web/docs/test.md` or `web/docs/lint.md` for Web, and `packages/dify-ui/docs/testing.md` for Dify UI.

[data]: references/data.md
[interactions]: references/interactions.md
[ownership]: references/ownership.md
[runtime]: references/runtime.md
[state]: references/state.md

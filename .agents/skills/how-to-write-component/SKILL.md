---
name: how-to-write-component
description: Use when implementing or refactoring React/TypeScript components and the task requires decisions about component ownership, feature boundaries, state, data flow, effects, or interaction ownership. Do not use for review-only requests, test-only work, copy-only edits, or styling-only changes.
---

# How To Write A Component

Use this skill to route component architecture decisions to its bundled references. Read only the references required by the current change.

## Topic Routing

- Component moves, module boundaries, props, types, or owner placement: read [`references/ownership.md`][ownership].
- Jotai, form drafts, route identity, URL state, or persistence: read [`references/state.md`][state].
- Generated contracts, nullable API data, Query, mutations, SSR, auth, or workspace state: read [`references/data.md`][data].
- Hotkeys, focus, dialogs, menus, popovers, or other secondary surfaces: read [`references/interactions.md`][interactions] and the overlay guide it references when applicable. Also read [`references/state.md`][state] when the surface owns a draft or other local session state.
- Effects, navigation, memoization, preloading, or render cost: read [`references/runtime.md`][runtime].

## Scope And Verification

Identify the behavior owner, state lifetime, and public contract from the nearby implementation and relevant references. Keep the change within that vertical slice unless the contract requires changes elsewhere. Verify the changed behavior and complete the owning package's required checks. For Web, read `web/docs/test.md` for test work and `web/docs/lint.md` for static checks. Dify UI verification is owned by `packages/dify-ui/docs/testing.md`.

## Tailwind CSS

- Write canonical Tailwind v4 classes; prefer canonical utilities over equivalent arbitrary values.
- Common forms include `w-105` instead of `w-[420px]`, `px-2.25` instead of `px-[9px]`, `bg-linear-to-b` instead of `bg-gradient-to-b`, `wrap-break-word` instead of `break-words`, and `field-sizing-content` instead of `[field-sizing:content]`.

[data]: references/data.md
[interactions]: references/interactions.md
[ownership]: references/ownership.md
[runtime]: references/runtime.md
[state]: references/state.md

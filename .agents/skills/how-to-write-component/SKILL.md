---
name: how-to-write-component
description: React/TypeScript component style guide. Use when writing, refactoring, or reviewing React components, especially around props typing, state boundaries, shared local state with Jotai atoms, API types, query/mutation contracts, navigation, memoization, wrappers, and empty-state handling.
---

# How To Write A Component

Use this as the decision guide for React/TypeScript component structure. Existing code is reference material, not automatic precedent; when it conflicts with these rules, adapt the approach instead of reproducing the violation.

## Core Defaults

- Search before adding UI, hooks, helpers, or styling patterns. Reuse existing base components, feature components, hooks, utilities, and design styles when they fit.
- Group code by feature workflow, route, or ownership area: components, hooks, local types, query helpers, atoms, constants, and small utilities should live near the code that changes with them.
- Promote code to shared only when multiple verticals need the same stable primitive. Otherwise keep it local and compose shared primitives inside the owning feature.
- Use Tailwind CSS v4.1+ rules via the `tailwind-css-rules` skill. Prefer v4 utilities, `gap`, `text-size/line-height`, `min-h-dvh`, and avoid deprecated utilities and `@apply`.

## Ownership

- Put local state, queries, mutations, handlers, and derived UI data in the lowest component that uses them. Extract a purpose-built owner component only when the logic has no natural home.
- Repeated TanStack query calls in sibling components are acceptable when each component independently consumes the data. Do not hoist a query only because it is duplicated; TanStack Query handles deduplication and cache sharing.
- Hoist state, queries, or callbacks to a parent only when the parent consumes the data, coordinates shared loading/error/empty UI, needs one consistent snapshot, or owns a workflow spanning children.
- Avoid prop drilling. One pass-through layer is acceptable; repeated forwarding means ownership should move down or into feature-scoped Jotai UI state. Keep server/cache state in query and API data flow.
- Keep callbacks in a parent only for workflow coordination such as form submission, shared selection, batch behavior, or navigation. Otherwise let the child or row own its action.
- Prefer uncontrolled DOM state and CSS variables before adding controlled props.

## Components, Props, And Types

- Type component signatures directly; do not use `FC` or `React.FC`.
- Prefer `function` for top-level components and module helpers. Use arrow functions for local callbacks, handlers, and lambda-style APIs.
- Prefer named exports. Use default exports only where the framework requires them, such as Next.js route files.
- Type simple one-off props inline. Use a named `Props` type only when reused, exported, complex, or clearer.
- Use API-generated or API-returned types at component boundaries. Keep small UI conversion helpers beside the component that needs them.
- Name values by their domain role and backend API contract, and keep that name stable across the call chain, especially IDs like `appInstanceId`. Normalize framework or route params at the boundary.
- Keep fallback and invariant checks at the lowest component that already handles that state; callers should pass raw values through instead of duplicating checks.

## Queries And Mutations

- Keep `web/contract/*` as the single source of truth for API shape; follow existing domain/router patterns and the `{ params, query?, body? }` input shape.
- Consume queries directly with `useQuery(consoleQuery.xxx.queryOptions(...))` or `useQuery(marketplaceQuery.xxx.queryOptions(...))`.
- Avoid pass-through hooks and thin `web/service/use-*` wrappers that only rename `queryOptions()` or `mutationOptions()`. Extract a small `queryOptions` helper only when repeated call-site options justify it.
- Keep feature hooks for real orchestration, workflow state, or shared domain behavior.
- For missing required query input, use `input: skipToken`; use `enabled` only for extra business gating after the input is valid.
- Consume mutations directly with `useMutation(consoleQuery.xxx.mutationOptions(...))` or `useMutation(marketplaceQuery.xxx.mutationOptions(...))`; use oRPC clients as `mutationFn` only for custom flows.
- Put shared cache behavior in `createTanstackQueryUtils(...experimental_defaults...)`; components may add UI feedback callbacks, but should not own shared invalidation rules.
- Do not use deprecated `useInvalid` or `useReset`.
- Prefer `mutate(...)`; use `mutateAsync(...)` only when Promise semantics are required, and wrap awaited calls in `try/catch`.

## Component Boundaries

- Use the first level below a page or tab to organize independent page sections when it adds real structure. This layer is layout/semantic first, not automatically the data owner.
- Split deeper components by the data and state each layer actually needs. Each component should access only necessary data, and ownership should stay at the lowest consumer.
- Keep cohesive forms, menu bodies, and one-off helpers local unless they need their own state, reuse, or semantic boundary.
- Separate hidden secondary surfaces from the trigger's main flow. For dialogs, dropdowns, popovers, and similar branches, extract a small local component that owns the trigger, open state, and hidden content when it would obscure the parent flow.
- Preserve composability by separating behavior ownership from layout ownership. A dropdown action may own its trigger, open state, and menu content; the caller owns placement such as slots, offsets, and alignment.
- Avoid unnecessary DOM hierarchy. Do not add wrapper elements unless they provide layout, semantics, accessibility, state ownership, or integration with a library API; prefer fragments or styling an existing element when possible.
- Avoid shallow wrappers and prop renaming unless the wrapper adds validation, orchestration, error handling, state ownership, or a real semantic boundary.

## Navigation, Effects, And Performance

- Prefer `Link` for normal navigation. Use router APIs only for command-flow side effects such as mutation success, guarded redirects, or form submission.
- Treat `useEffect` as a last resort. First try deriving values during render, moving event-driven work into handlers, or using existing hooks/APIs for persistence, subscriptions, media queries, timers, and DOM sync.
- Do not use `useEffect` directly in components. If unavoidable, encapsulate it in a purpose-built hook so the component consumes a declarative API.
- Avoid `memo`, `useMemo`, and `useCallback` unless there is a clear performance reason.

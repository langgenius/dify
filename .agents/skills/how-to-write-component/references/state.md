# Component State And URL Ownership

Read this document when a change involves Jotai, form drafts, route identity, shared client state, or local persistence.

## Choose The Owner

- Keep synchronous state local when one component owns it: dialog and menu state, confirmations, field drafts, and local selections usually belong to the component or DOM.
- Use feature-scoped Jotai when siblings need one source of truth, values drive other atoms, or a scoped workflow must preserve state across hidden or unmounted steps.
- Keep server and cache state in TanStack Query. Use existing feature stores for complex, high-frequency interaction state such as workflow canvas drag, resize, and runtime panels.
- Use feature-owned storage only for low-frequency client preferences, dismissed notices, and UI defaults. Live application state does not belong in local storage.

## Forms

- Prefer uncontrolled Dify UI form and field controls when values are only read at submit time. Initialize query-backed defaults with `defaultValue` and keyed remounts.
- Promote form values to atoms only when another owner reacts to in-progress values, the draft must survive scoped unmounting, or several workflow steps edit the same draft.
- Keep validation, source priority, fallback behavior, dirty checks, and payload assembly in the workflow that owns submission.

## Route And URL State

- Treat `useParams`, route arguments, and `nuqs` as the owners of URL identity and updates.
- Hydrate a primitive atom at the route or surface boundary only when query atoms or shared derived atoms require route identity. Keep URL writes in route and query-state APIs.
- Within one route-owned feature, choose one route-identity source. Do not hydrate route identity into atoms while also threading the same ID through multiple component layers.
- Put shareable filters, tabs, pagination, and search state in the URL. Keep one-shot navigation signals and transient UI state out of persistent subscriptions.

## Jotai And Query

- A Jotai-backed feature may keep one feature-local state module ordered by dependency: types and constants, primitives, query atoms, query-data derivations, business facts, commands, mutations, submission orchestration, and provider exports.
- Use `atomWithQuery` or `atomWithMutation` for async work driven by atom state. Do not hand-roll loading, error, or in-flight state for atom-orchestrated work.
- Use field-specific derived atoms for query results. `jotai-tanstack-query` does not provide TanStack Query tracked properties, so reading a whole query atom subscribes to the entire observer result.
- Leave query and mutation atoms unscoped so they retain the shared QueryClient cache. Scope resettable primitives and hydration tuples; scope a derived atom only when all dependencies should be private to the surface.
- Use non-null lazy primitives for values always hydrated by a scope provider. Name derived atoms as business facts and write atoms as user or workflow commands.
- Keep independent dialog lifecycles separate. A scoped open-state atom is acceptable only when composed sibling surfaces would otherwise pass confusing lifecycle props through unrelated owners.

## Persistence

- Use feature-owned storage modules built on `createLocalStorageState`; callers should not scatter direct storage access or raw keys.
- Persist high-frequency interaction state only on commit or after updates settle.
- Do not add ad hoc global event listeners for shared state. Centralize subscriptions through the owning atom, store, or subscription hook.

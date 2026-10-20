# Component State And URL Ownership

Read this document when a change involves Jotai, form drafts, route identity, shared client state, or local persistence.

## Choose The Owner

- Keep synchronous state local when one component owns it: dialog and menu state, confirmations, field drafts, and local selections usually belong to the component or DOM.
- Use feature-scoped Jotai when siblings need one source of truth, values drive other atoms, or a scoped workflow must preserve state across hidden or unmounted steps.
- Keep server and cache state in TanStack Query. Use existing feature stores for complex, high-frequency interaction state such as workflow canvas drag, resize, and runtime panels.
- Use feature-owned storage only for low-frequency client preferences, dismissed notices, and UI defaults. Live application state does not belong in local storage.

## Forms And Sessions

- Follow the [form contract] for field controlledness and the [overlay contract] for Root/content mounting and state lifetime. These primitive contracts also apply when reviewing a consumer.
- Choose the Web draft owner from the required lifetime. Keep mounted-session drafts in the content owner; start with the lowest shared React owner when another component needs the draft or it must survive unmounting. Use feature-scoped atoms only when their coordination or persistence contract is needed.
- For query-backed defaults, establish the form session after the required defaults are available. `defaultValue` initializes the current mount; a stable semantic identity key may create a fresh snapshot when the represented identity changes. Do not use a generated key as a routine reset command.
- Keep validation, source priority, fallback behavior, dirty checks, and payload assembly in the workflow that owns submission.
- Derive booleans, disabled flags, default tabs, and loading labels from current state. Do not mirror one value into competing prop, default, and local sources; controlled state alone is not a competing-source defect.
- Do not use local state to fake server data or generated contract fields, or connect a feature mock shell to an unrelated API before its actual contract is confirmed.

## Route And URL State

- Treat `useParams`, route arguments, and `nuqs` as the owners of URL identity and updates.
- Hydrate a primitive atom at the route or surface boundary only when query atoms or shared derived atoms require route identity. Keep URL writes in route and query-state APIs.
- Within one route-owned feature, choose one route-identity source. Do not hydrate route identity into atoms while also threading the same ID through multiple component layers.
- Put shareable filters, tabs, selected panels, pagination, and search state in the URL. Keep one-shot navigation signals and transient UI state out of persistent subscriptions.

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

[form contract]: ../../../../packages/dify-ui/docs/forms.md
[overlay contract]: ../../../../packages/dify-ui/docs/overlays.md

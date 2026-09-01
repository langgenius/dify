# Component State And URL Ownership

Read this document when a change involves Jotai, form drafts, route identity, shared client state, or local persistence.

## Classify State On Two Axes

First identify the owner or source of truth: one component, a parent boundary, URL/framework APIs, TanStack Query, or the feature workflow. Then identify the graph role independently: primitive input, query/mutation node, derived business fact, or workflow command. Finally mark whether any node needs per-instance isolation or reset; this is a lifecycle requirement, not a node type.

A value should enter a feature state graph when it drives a query or command, feeds a reusable derivation, is consumed by another owner, or bridges an external source for several consumers. Entering the graph does not transfer ownership from URL APIs or Query cache to Jotai.

Once a value enters the graph, represent it in a feature-local Jotai state file by default. Do not leave graph inputs and async nodes inside a component or large custom hook while exporting only the final result through props or Context; that hides the dependency graph instead of modeling it.

Keep values out of the graph when they only affect one component's presentation, are read only at form submission, or are one-off render computations without domain meaning.

## Choose The Owner

- Keep synchronous state local when one component owns it: dialog and menu state, confirmations, field drafts, and local selections usually belong to the component or DOM.
- Use feature-scoped Jotai when siblings need one source of truth, values drive other atoms, a parent input establishes its own state graph, or a scoped workflow must preserve state across hidden or unmounted steps.
- Keep server and cache state in TanStack Query. Use existing feature stores for complex, high-frequency interaction state such as workflow canvas drag, resize, and runtime panels.
- Use feature-owned storage only for low-frequency client preferences, dismissed notices, and UI defaults. Live application state does not belong in local storage.
- Use Context for an existing authoritative product boundary or stable dependency injection. Do not introduce Context merely to translate a hook result, query observer, or prop fan-out into another large value object.

## Forms And Sessions

- Keep form state in the narrowest owner whose lifetime matches the draft. A draft scoped to one mounted surface belongs to that content or session owner; a draft that must survive its current owner's unmount belongs to an explicit longer-lived feature owner.
- Prefer uncontrolled fields when values are only read at submit time. Use local controlled state only when React must own the current value to drive dependent UI or linked fields; track derived facts such as dirty state without mirroring the field value. Controlledness does not decide whether a draft is local or persisted.
- For query-backed defaults, establish the form session after the required defaults are available. `defaultValue` initializes the current mount; a stable semantic identity key may create a fresh snapshot when the represented identity changes. Do not use a generated key as a routine reset command.
- Promote drafts beyond the session only when another owner reacts to in-progress values, several workflow steps share one draft, or the draft must intentionally survive unmounting. Start with the lowest shared React owner; use feature-scoped atoms only when their coordination or persistence contract is needed.
- Keep validation, source priority, fallback behavior, dirty checks, and payload assembly in the workflow that owns submission.

## Route And URL State

- Treat `useParams`, route arguments, and `nuqs` as the owners of URL identity and updates.
- A single consumer should read the owner hook directly. Hydrate an unscoped primitive atom at the route or surface boundary only when several consumers, query atoms, or shared derived atoms require route identity. Keep URL writes in route and query-state APIs.
- A route, framework, or permission bridge that must follow later owner changes should use `dangerouslyForceHydrate: true` at that controlled boundary so descendants observe one synchronous authoritative snapshot. This is the canonical exception to ordinary render-phase write guidance: do not flag the resulting React render-phase update warning as an ownership or architecture problem when the hydration tuples contain only those authoritative external inputs.
- A scoped workflow input is different: initialize it once, key the scope by semantic identity when switching entities should reset it, and do not force later parent refreshes into an in-progress session. Never extend the bridge exception to feature-owned primitives, drafts, query or mutation atoms, or edit-session snapshots.
- Within one route-owned feature, choose one route-identity source. Do not hydrate route identity into atoms while also threading the same ID through multiple component layers.
- A route parameter may cross the route-to-feature entry edge once. After a route bridge exists, queries, facts, commands, and descendant surfaces must read that bridge instead of accepting the same ID as props.
- Put shareable filters, tabs, pagination, and search state in the URL. Keep one-shot navigation signals and transient UI state out of persistent subscriptions.

## Build A Clean Jotai Graph

- Keep one feature-local state file or folder ordered by dependency: primitives and boundary inputs, query atoms, query-data selectors, business facts, commands, mutation atoms when justified, submission orchestration, then provider exports.
- Keep graph flow one-way: primitive inputs -> queries -> named facts -> commands. Do not let components maintain a second writable entry for the same fact.
- Create a derived atom only when its value is reused, consumed by another atom, or deserves a stable business name such as `rows`, `showEmpty`, or `canSubmit`. Leave one-off presentation assembly in the component.
- Keep internal graph nodes unexported. Export only atoms that a component, provider boundary, or another state module must read or write.
- Use `atomWithQuery` or `atomWithMutation` for async work driven by atom state. Do not hand-roll loading, error, or in-flight state for atom-orchestrated work.
- Use `selectAtom` or another field-specific derived atom for query results. `jotai-tanstack-query` does not provide TanStack Query tracked properties, so reading a whole query atom subscribes to the entire observer result. Read the whole result only when the consumer truly needs observer methods or a coordinated group of fields.
- Name derived atoms as business facts and write atoms as user or workflow commands. Commands should express actions such as selecting a source or submitting a wizard, not merely rename setter callbacks.
- Treat query keys, observer methods, cache invalidation, retries, and refresh composition as graph internals. Export a named command such as `refreshDocument`, not the query key plus a raw `refetch` callback.
- A headless runtime controller may synchronize atoms with storage, timers, subscriptions, or other external systems. It should read and write focused graph nodes and render no UI; it must not return a large object for a parent to redistribute.

## Scope, Isolation, And Reset

- Leave query and mutation atoms unscoped so they retain the shared QueryClient cache. Scope resettable primitives and hydration tuples; scope a derived atom only when all dependencies should be private to the surface.
- Use `atomWithLazy` or another non-null lazy primitive for required values injected by a scope provider; fail when the boundary forgot to provide them instead of inventing an empty ID.
- Maintain the scoped primitive list explicitly. Use a semantic `key` when switching identity should create a fresh session; do not use forced hydration for an edit snapshot that must remain stable while an outer query refreshes.
- Scope exists for per-instance isolation and natural reset, not as a general module boundary. A state file may be warranted even when its atoms remain unscoped.
- Keep independent dialog lifecycles separate. A scoped open-state atom is acceptable only when composed sibling surfaces would otherwise pass confusing lifecycle props through unrelated owners.

## Graph Review Checklist

Before implementation and again after the final slice, draw the actual graph in dependency order and verify:

- every route, URL, parent, and persisted input has one bridge;
- every query driven by graph input is represented in the graph and remains unscoped;
- components read field selectors or named facts rather than complete query results;
- write atoms and exported commands describe user or workflow intent;
- scoped atoms are limited to primitives and snapshots with a documented reset boundary;
- no equivalent value remains available through both atoms and descendant props;
- every exported atom has a real component, boundary, or state-module consumer.

## Persistence

- Use feature-owned storage modules built on `createLocalStorageState`; callers should not scatter direct storage access or raw keys.
- Persist high-frequency interaction state only on commit or after updates settle.
- Do not add ad hoc global event listeners for shared state. Centralize subscriptions through the owning atom, store, or subscription hook.

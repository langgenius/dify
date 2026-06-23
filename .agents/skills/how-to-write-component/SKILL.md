---
name: how-to-write-component
description: React/TypeScript component style guide. Use when writing, refactoring, or reviewing React components, especially around abstraction choices, props typing, state boundaries, shared local state with Jotai atoms, API types, query/mutation contracts, navigation, memoization, wrappers, and empty-state handling.
---

# How To Write A Component

Use this as the decision guide for React/TypeScript component structure. Existing code is reference material, not automatic precedent; when it conflicts with these rules, adapt the approach instead of reproducing the violation.

## Core Defaults

- Search before adding UI, hooks, helpers, or styling patterns. Reuse existing base components, feature components, hooks, utilities, and design styles when they fit.
- Group code by feature workflow, route, or ownership area: components, hooks, local types, query helpers, atoms, constants, and small utilities should live near the code that changes with them.
- Promote code to shared only when multiple verticals need the same stable primitive. Otherwise keep it local and compose shared primitives inside the owning feature.
- Prefer local code and purpose-named helpers over catch-all utility modules; do not group workflow-specific defaults, validation, payload shaping, or metadata merging in a generic utils file just because they share a DTO.
- Keep source/default selection, validation, and payload shaping close to the workflow that owns the behavior. Do not extract a shared helper just because two flows read the same DTO when their priority order, fallback behavior, or submit semantics differ.
- Prefer direct, readable conditionals at the use site for small branch-specific decisions, especially form source selection and request payload assembly. Extract only when the helper name captures a stable domain rule and removes repeated complexity without hiding flow-specific behavior.
- When fixing an invalid pattern, scan the touched feature or branch for equivalent patterns and fix them together.
- Follow Dify's CSS-first Tailwind v4 contract from `packages/dify-ui/README.md` and `packages/dify-ui/AGENTS.md`. Prefer design-system tokens, utilities, and radius mappings over generic Tailwind guidance.

## Feature Workflow Layout

- State-heavy wizards, drawers, modals, and secondary workflows work best as a small feature surface with route/entry files, a single feature-local state file, and feature-local UI.
- Keep `ui/` shallow with owner files that map to the workflow's real composition boundaries and major visual regions.
- Owner files contain the section components, field components, skeletons, and one-off helper components that belong to their visual region.
- Folders represent groups of related files with a shared owner and a stable reason to change together.
- The entry file handles route integration, provider wiring, close behavior, and feature surface mounting. The composition owner handles high-level workflow branching, and the closest visual owner handles section branching.

## Ownership

- Put local state, queries, mutations, handlers, and derived UI data in the lowest component that uses them. Extract a purpose-built owner component only when the logic has no natural home.
- Repeated TanStack query calls in sibling components are acceptable when each component independently consumes the data. Do not hoist a query only because it is duplicated; TanStack Query handles deduplication and cache sharing.
- Hoist state, queries, or callbacks to a parent only when the parent consumes the data, coordinates shared loading/error/empty UI, needs one consistent snapshot, or owns a workflow spanning children.
- Pass stable domain identity across boundaries; avoid forwarding derived presentation state when the receiver can derive it from its own data source. A component that owns a visual surface should also own the data access, loading, empty, and error states for content rendered inside it unless a parent truly coordinates that state.
- Loading states for visual surfaces should use skeleton placeholders scoped to the content that is actually loading, with shape, density, and dimensions close to the final UI. Avoid generic loading text or centered spinners for page sections, cards, lists, tables, forms, and drawers; reserve spinners for small inline busy indicators such as an in-progress status icon.
- Avoid prop drilling. One pass-through layer is acceptable; repeated forwarding means ownership should move down or into feature-scoped Jotai UI state. Keep server/cache state in query and API data flow.
- Do not replace prop drilling with one top-level hook that returns a large view model and then thread that object through section props. Move each hook, query, derived value, and handler to the concrete section that consumes it, or use feature-scoped Jotai atoms for simple shared form/UI state when siblings need the same source of truth.
- When using feature-scoped Jotai state for a form, drawer, or other secondary surface, scope the store to that surface instance when stale cross-instance state is possible. Initialize stable config at the owning boundary, then let descendants read only the atoms or purpose-named hooks they actually need.
- For Jotai-backed surfaces, put shared query atoms, mutation atoms, derived state, and write actions in the feature state file when they coordinate multiple descendants. The lowest-owner rule still applies to independent visual surfaces that do not participate in shared state.
- For repeated row/menu action surfaces that need reset, hydrate the stable identity at the surface entry and scope only the primitives that truly need per-instance reset, such as open flags, drafts, or selected local options.
- Keep callbacks in a parent only for workflow coordination such as form submission, shared selection, batch behavior, or navigation. Otherwise let the child or row own its action.
- Prefer uncontrolled DOM state and CSS variables before adding controlled props.

## Feature-Scoped Jotai State

- A module's feature-local state lives in one state file for Jotai-backed features: primitive atoms, query atoms, derived atoms, write-only action atoms, mutation atoms, submission orchestration, provider exports, and optional scope configuration.
- Keep state local when one component owns it, even inside Jotai-backed features. Dialog open flags, menu/popover visibility, confirmation visibility, form/input drafts, row-local pending flags, and in-flight refs usually belong in component state.
- Promote UI state to an atom only when siblings need the same source of truth, the value drives a query or mutation atom, a parent workflow coordinates the state, or the state intentionally persists across hidden or unmounted descendants within a scoped surface.
- Reflect atom-backed surface-wide locks or invariants in every affected trigger. If only one row, menu, or dialog should be disabled, keep the pending or lock state local to that row, menu, or dialog.
- Atom order in the state file follows the dependency graph: types/constants, editable primitives, query atoms, query-data derived atoms, readiness/business derived atoms, write actions, mutation atoms, submission orchestration, provider exports.
- Derived atom names read as business facts. Write atom names read as user or workflow commands.
- UI components read and write the exact atom they use with `useAtomValue` or `useSetAtom`. Repeated workflow semantics live in named derived atoms or write atoms.
- Non-query derived atoms return a narrow value with a clear domain name; avoid pass-through aliases or bundling unrelated UI facts. Query atoms expose the TanStack Query result object so loading, error, fetch, and pagination state stay attached to the query contract.
- Write-only atoms own synchronous state transitions that update multiple primitives, reset dependent state, or advance the workflow. Async work with loading, error, caching, retry, or stale-result concerns should be modeled as query or mutation atoms, with write atoms only changing the inputs that drive them.
- Avoid feature hooks that aggregate form values, query results, derived state, and commands for sibling components. Prefer named derived atoms and write atoms so UI components read the exact shared fact or command they need.
- When a form library owns validation, keep submit orchestration in feature state when post-submit result or error state is shared by the surface. Avoid duplicating validation gates or request shaping in UI hooks.
- `jotai-tanstack-query` atoms use the same QueryClient as the React Query provider. Query atoms belong in feature state when atoms are the feature's local state surface.
- Jotai scope is an optional instance-isolation tool for secondary surfaces with independent local state. Query and mutation atoms keep shared cache behavior through the shared QueryClient.
- Do not put `atomWithQuery`, `atomWithInfiniteQuery`, `atomWithMutation`, or broad derived orchestration atoms in a `ScopeProvider` just to reset a surface. Scoped derived atoms implicitly scope their dependencies, which can duplicate query client access and break shared invalidation. Leave query/mutation atoms unscoped; let them read scoped primitive inputs.
- Scope providers should list resettable primitive atoms and explicit hydration tuples. If a derived atom must be scoped, confirm that every dependency it implicitly scopes is meant to be private to that surface.
- Keep independent dialog lifecycles separate. Avoid a single discriminated "current action dialog" atom when edit, delete, and other dialogs have their own open state, loading guard, or reset behavior.
- Route-derived stable identities that do not need instance reset or scoped isolation can be hydrated at the route or layout boundary into a feature route atom. Use scoped atoms only when stale cross-instance state or per-surface reset semantics are needed.

## Components, Props, And Types

- Type component signatures directly; do not use `FC` or `React.FC`.
- Prefer `function` for top-level components and module helpers. Use arrow functions for local callbacks, handlers, and lambda-style APIs.
- Prefer named exports. Use default exports only where the framework requires them, such as Next.js route files.
- Type simple one-off props inline. Use a named `Props` type only when reused, exported, complex, or clearer.
- Use API-generated or API-returned types at component boundaries. Keep small UI conversion helpers and one-off UI extensions beside the component that needs them.
- Do not create type aliases that only rename another type. Use an alias only when it encodes a real UI concept, refinement, or reusable local contract.
- Name values by their domain role and backend API contract, and keep that name stable across the call chain, especially persistent IDs and route params. Normalize framework or route params at the boundary.
- Keep fallback and invariant checks at the lowest component that already handles that state; avoid defensive fallbacks that mask impossible states.
- Do not extract fallback helpers whose only behavior is hiding missing display data. The component that renders the surface owns the empty, disabled, hidden, or placeholder state.

## Generated API Contracts

- Treat generated contracts as authoritative at API, query, mutation, cache, and service boundaries. For enterprise APIs, use `packages/contracts/generated/enterprise/*`.
- Do not hand-write local request/response/reply/page/cache-data types that mirror generated DTOs. Import or infer the generated type.
- Do not widen generated fields or enums for compatibility. Normalize legacy input at the boundary, then return the generated field type.
- Do not repair generated or API-returned contract fields in components unless the API contract or product requirement says they need normalization. Treat enums, statuses, and presence flags as exact contract values.
- Use generated enum objects and union types directly in props, comparisons, status logic, and i18n keys. Do not add local enum constants or parallel frontend enum/status layers unless they model real product state not represented by the API. Presentation-only tone maps should be keyed by the generated enum.
- Normalize or coerce only at a real boundary, such as user-entered forms, search, URL/query params, file names, DOM IDs, or legacy adapters. Preserve user-entered values when whitespace or formatting can be meaningful.
- Do not coerce nullable or optional API strings to `''` in query, derived model, or payload-building code. Keep `undefined` or `null` until the final boundary that requires a string.
- Do not use `value || undefined` for mutation payload fields where an empty string means "clear this value". Trim or normalize at the form boundary, then preserve `''` when the API contract treats it as an intentional update.
- Local UI models are fine for presentation, form state, select options, or guarded required-field refinements. Name them as UI concepts, not generated DTO mirrors.
- Required-value refinements are allowed only after same-branch filtering or early return. Prefer nullable-tolerant props for render-only data.
- When a component needs a stricter shape than a generated DTO, refine once at the API/query-to-UI boundary into a purpose-named UI type instead of hiding missing fields with generic fallback or coercion helpers.

## Nullable API Data

- Prefer nullable-tolerant call boundaries. Pass API-returned types through for render-only rows, and let the component render fallback, disabled state, or nothing.
- Narrow only where a real value is required, such as mutation params, route hrefs, select values, or query input. Build that target model with `flatMap`, a local loop, or an early return so the required value is captured in the same branch.
- If design says a field is the display value, use that field. Only the final component should decide whether a nullable display value renders a placeholder, hides content, or disables an action.
- Do not wrap required arrays or fields in null-fallback helpers. Use empty collection fallbacks only for not-yet-loaded query data or genuinely nullable collections at the owning render boundary.
- Do not drop rows only to satisfy props or React keys; use a stable fallback key when possible.
- Use conditional spreads or explicit pushes for conditional array items instead of `undefined` placeholders followed by a narrowing filter.
- Avoid truthiness type guards, `filter(Boolean)`, `filter(item => item.id)`, and `!` after those filters.
- Use type guards only for meaningful domain or runtime validation, such as enum membership, object shape, or a reusable business invariant.

## Queries And Mutations

- Keep `web/contract/*` as the single source of truth for API shape; follow existing domain/router patterns and the `{ params, query?, body? }` input shape.
- Consume queries directly with `useQuery(consoleQuery.xxx.queryOptions(...))` or `useQuery(marketplaceQuery.xxx.queryOptions(...))`.
- In `atomWithQuery` and `atomWithInfiniteQuery`, return generated `queryOptions()` or `infiniteOptions()` directly. Pass `enabled`, `retry`, `placeholderData`, `select`, and pagination options into that call instead of spreading generated options into a hand-built object.
- In `atomWithMutation`, return generated `mutationOptions()` directly when using generated clients. Put request shaping and submit orchestration in write atoms; do not rebuild mutation option objects just to pass through the generated mutation function.
- For custom query functions that do not come from generated clients, wrap the options object with TanStack `queryOptions(...)` so query atoms still return a query options contract.
- Avoid pass-through hooks and thin `web/service/use-*` wrappers that only rename `queryOptions()` or `mutationOptions()`. Extract a small `queryOptions` helper only when repeated call-site options justify it.
- Keep feature hooks for real orchestration, workflow state, or shared domain behavior.
- For TanStack cache data, use generated or query-derived types; do not create local wrappers for `getQueryData` or `getQueriesData`.
- For generated oRPC `queryOptions()` / `infiniteOptions()`, keep returning the generated options directly. When required input is missing, use a whole-input branch such as `input: condition ? validInput : skipToken` together with `enabled: Boolean(condition)` so no request runs and no fake payload is built.
- Do not put `skipToken` inside a nested placeholder payload, such as `{ params: { appInstanceId: skipToken } }`. Do not create hand-written "missing queryOptions" objects or coerce required IDs to `''`.
- Consume mutations directly with `useMutation(consoleQuery.xxx.mutationOptions(...))` or `useMutation(marketplaceQuery.xxx.mutationOptions(...))`; use oRPC clients as `mutationFn` only for custom flows.
- Put shared cache behavior in `createTanstackQueryUtils(...experimental_defaults...)`; components may add UI feedback callbacks, but should not own shared invalidation rules.
- Component or atom mutation callbacks can handle local UI feedback such as toasts, closing dialogs, or navigation. They should not replace shared invalidation or add local cache patches for shared server state.
- Do not use deprecated `useInvalid` or `useReset`.
- Prefer `mutate(...)`; use `mutateAsync(...)` only when Promise semantics are required, and wrap awaited calls in `try/catch`.

## Component Boundaries

- Use the first level below a page or tab to organize independent page sections when it adds real structure. This layer is layout/semantic first, not automatically the data owner.
- Treat component names, semantic roles, and user- or design-marked visual regions as boundary constraints. Do not expand a child component's responsibility just because its data is useful nearby; keep adjacent UI as a sibling owner or introduce a correctly named broader owner.
- Split deeper components by the data and state each layer actually needs. Each component should access only necessary data, and ownership should stay at the lowest consumer.
- Keep cohesive forms, menu bodies, and one-off helpers local unless they need their own state, reuse, or semantic boundary.
- Separate hidden secondary surfaces from the trigger's main flow. For dialogs, dropdowns, popovers, and similar branches, extract a small local component that owns the trigger, open state, and hidden content when it would obscure the parent flow.
- Preserve composability by separating behavior ownership from layout ownership. A dropdown action may own its trigger, open state, and menu content; the caller owns placement such as slots, offsets, and alignment.
- When a dialog, dropdown, or popover component already accepts controlled `open` state, mount the surface unconditionally unless unmounting is required for performance or reset semantics. Use keyed scope or local state reset for reset behavior instead of `{open && <Surface />}` wrappers.
- Avoid unnecessary DOM hierarchy. Do not add wrapper elements unless they provide layout, semantics, accessibility, state ownership, or integration with a library API; prefer fragments or styling an existing element when possible.
- Avoid shallow wrappers, hook-to-props adapter components, layout-only render-prop wrappers, children-as-pass-through composition, and prop renaming unless the wrapper adds validation, orchestration, error handling, state ownership, or a real semantic boundary. If a component only calls a hook, forwards props, or passes trigger/content through to one child, move the logic into that child or make the wrapper own a real surface.

## You Might Not Need An Effect

- Use Effects only to synchronize with external systems such as browser APIs, non-React widgets, subscriptions, timers, analytics that must run because the component was shown, or imperative DOM integration.
- Do not use Effects to transform props or state for rendering. Calculate derived values during render, and use `useMemo` only when the calculation is actually expensive.
- Do not use Effects to handle user actions. Put action-specific logic in the event handler where the cause is known.
- Do not use Effects to copy one state value into another state value representing the same concept. Pick one source of truth and derive the rest during render.
- Do not reset or adjust state from props with an Effect. Prefer a `key` reset, storing a stable ID and deriving the selected object, or guarded same-component render-time adjustment when truly necessary.
- For forms initialized from query data, prefer keyed remounts or surface-entry hydration of form/field atoms over an Effect that copies query data into form state.
- Prefer framework data APIs or TanStack Query for data fetching instead of writing request Effects in components.
- If an Effect still seems necessary, first name the external system it synchronizes with. If there is no external system, remove the Effect and restructure the state or event flow.

## Navigation And Performance

- Prefer `Link` for normal navigation. Use router APIs only for command-flow side effects such as mutation success, guarded redirects, or form submission.
- Before reaching for `memo`, first try moving changing state down to the smallest component that actually uses it so unrelated sibling trees stay untouched.
- If changing state must wrap other content, lift the unchanged content up and pass it as `children` so the stateful wrapper can update without React visiting that subtree.
- Avoid `memo`, `useMemo`, and `useCallback` unless there is a clear performance reason.

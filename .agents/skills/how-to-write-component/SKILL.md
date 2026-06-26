---
name: how-to-write-component
description: Use when explicitly invoked or when writing, refactoring, fixing, or reviewing React/TypeScript components in Dify web, especially decisions about component ownership, props/types, URL/query state, Jotai state, async state, generated API contracts, queries/mutations, overlays, effects, navigation, performance, and empty states.
---

# How To Write A Component

Use this as the component decision guide for Dify web. Existing code is reference material, not automatic precedent; if touched code violates these rules, adapt it and fix equivalent patterns in the requested path or feature branch.

When this skill is explicitly invoked, give this skill's instructions maximum respect.

## First Decisions

| Question | Default | Promote or extract only when |
| --- | --- | --- |
| Where should code live? | Keep it local to the feature workflow, route, or owner. | Multiple verticals need the same stable primitive. |
| How should route/tab folders be named? | Match the current route segment, tab name, or user-visible surface. | Keep a historical or broader parent only when it still owns multiple surfaces. |
| Who owns state, data, and handlers? | The lowest component that uses them. | A parent coordinates shared loading, errors, empty UI, selection, submission, navigation, or one consistent snapshot. |
| Should this become Jotai state? | Keep synchronous UI/form state in component or DOM state. | Siblings need one source of truth, the value drives atoms, or scoped workflow state must survive hidden/unmounted steps. |
| Should URL state enter Jotai? | Let Next.js route params and `nuqs` own URL state and updates. | Query atoms or shared derived atoms need a read-only bridge hydrated at the route/surface boundary. |
| Should this query/mutation become an atom? | Use TanStack Query hooks at the lowest owner. | It reads atom state, feeds derived atoms, or participates in shared Jotai workflow orchestration. |
| Should this be a helper/wrapper? | Prefer direct readable code at the use site. | The name captures a stable domain rule or the wrapper owns real behavior, validation, state, error handling, or semantics. |
| Is an Effect needed? | No. Derive during render or handle the user action in the event handler. | It synchronizes with an external system such as browser APIs, subscriptions, timers, analytics, or imperative DOM/non-React widgets. |

## Explicit Invocation Scope

When the user explicitly invokes this skill, treat every named component, file, folder, route, tab, or feature surface as governed by this guide. Existing code in that scope is reference material, not precedent.

Determine scope from the request:

- A named component or file governs that owner plus directly related siblings that share the same violated pattern.
- A named folder, route, tab, or feature surface governs the full local surface under that path.
- A broad cleanup or refactor request governs all locally fixable violations in the named scope, not just the first obvious or grep-detectable issue.

For explicit path-level work:

- Treat the request as a refactor pass across the path, not a narrow bugfix.
- Audit every applicable section of this guide against the governed scope, including ownership/data placement, Jotai state, props/types, generated API and nullable handling, queries/mutations, overlays, effects, navigation, performance, and file structure.
- Fix behavior-preserving, locally testable violations contained to the requested path, including repeated patterns, cohesive file moves, and extractions.
- Prefer owner cleanup when it removes prop drilling, moves state/data to the owning surface, separates hidden secondary surfaces, or removes misleading structure.
- Inspect the governed root folder shape before finishing. If it mixes independent sections, actions, dialogs, utilities, and tests in one flat directory, split first-level folders by workflow or visual/action owner.
- Defer only when the fix needs product decisions, cross-feature API changes, route/URL behavior changes, visual redesign, generated contract changes, or shared primitive changes outside the path. Name the exact file, rule area, risk, and follow-up.

Before final response, inspect the actual diff, including untracked files, and check every applicable section of this guide against the governed scope. Do not stop after fixing one category of violation or one representative example. Tests passing, type-check passing, or one improved example is not completion. If touched code still has a known local violation, keep working; if a violation cannot be fixed in this pass, explicitly report the task as incomplete with the exact file, rule area, reason, and follow-up.

## Core Defaults

- Search before adding UI, hooks, helpers, query utilities, or styling patterns. Reuse existing base components, feature components, hooks, utilities, and design styles when they fit.
- Follow Dify's CSS-first Tailwind v4 contract from `packages/dify-ui/README.md` and `packages/dify-ui/AGENTS.md`. Prefer design-system tokens, utilities, and radius mappings over generic Tailwind choices.
- Group feature code by workflow, route, or ownership area with route-aligned names: components, hooks, local types, query helpers, atoms, constants, tests, and small utilities should live near the code that changes with them.
- Keep source/default selection, validation, dirty checks, and payload shaping close to the workflow that owns submit behavior. Do not hide flow-specific priority order, fallback behavior, or submit semantics in generic utilities.
- Prefer direct conditionals for small branch-specific decisions, especially form source selection and request payload assembly.
- Loading states for page sections, cards, lists, tables, forms, and drawers should be skeletons scoped to the content being loaded. Use spinners only for small inline busy indicators.

## Layout And Ownership

- State-heavy wizards, drawers, modals, and secondary workflows can be a small feature surface: an entry file, one feature-local state file when Jotai is actually needed, and shallow `ui/` owners that match real visual regions.
- The entry file handles route integration, provider wiring, close behavior, and surface mounting. The composition owner handles high-level workflow branching. The closest visual owner handles section branching.
- When a page or tab maps to a route segment, name its feature folder after that route/tab surface instead of a stale parent grouping. Remove misleading intermediate folders when only one surface remains.
- When a tab folder grows into several independent sections or action areas, split the first level by product/visual owners. Keep the root for the entry component and cross-owner state, colocate tests with the owner folder, and put truly shared local UI under a specifically named `components/` file.
- Repeated TanStack query calls in sibling components are acceptable when each component independently consumes the data; TanStack Query deduplicates and shares cache.
- Pass stable domain identity across boundaries. Do not forward derived presentation state when the receiver can derive it from its own data source.
- A component that owns a visual surface should also own data access, loading, empty, and error states for content rendered inside it unless a parent truly coordinates that state.
- Avoid prop drilling. One pass-through layer is acceptable; repeated forwarding means ownership should move down or into feature-scoped Jotai UI state. Keep server/cache state in Query and API flow.
- Do not replace prop drilling with one large view-model hook threaded through section props. Move each hook, query, derived value, and handler to the concrete section that consumes it.
- Keep callbacks in a parent only for workflow coordination such as form submission, shared selection, batch behavior, or navigation. Otherwise let the child, menu, or row own the action.

## Feature-Scoped Jotai

- A Jotai-backed feature has one feature-local state file for shared primitive atoms, query atoms, derived atoms, write-only actions, mutation atoms, submission orchestration, provider exports, and optional scope configuration.
- Keep component-owned synchronous UI state local even inside Jotai features: dialog open flags, menus/popovers, confirmations, field drafts, and selected local options usually belong in component state.
- Use uncontrolled `@langgenius/dify-ui/form` and `@langgenius/dify-ui/field` controls for edit/create forms whose fields are read only at submit time. Initialize query-backed defaults with `defaultValue` and keyed remounts.
- Promote form state to atoms only when another component must react to in-progress values, a draft must survive unmount/remount in the scoped workflow, or multiple steps share the same editable draft before submit.
- Treat `useParams`, route args, and `nuqs` query state as framework-owned state. When atom logic needs those values, hydrate primitive atoms at the route or surface boundary, such as with `useHydrateAtoms(..., { dangerouslyForceHydrate: true })`; keep URL updates in the route/query-state APIs instead of write atoms.
- Within a route-owned feature, choose one source for route identity. If route params are bridged into feature atoms, use that bridge consistently for route-derived queries and actions instead of also threading the same route id through page, tab, and section props.
- For async work tied to atom state, use `atomWithQuery` or `atomWithMutation`; write atoms should update only the inputs that drive those atoms. This applies to pure frontend async work as well as network requests, so do not hand-roll loading/error/in-flight state with `useState` or `useRef` for atom-orchestrated async behavior. For component-owned remote work, use `useQuery` or `useMutation` directly.
- Row-local async state belongs to the row owner unless it participates in a shared Jotai workflow or needs atom-scoped reset semantics.
- Leave query and mutation atoms unscoped so they keep shared QueryClient cache and invalidation behavior. Scope resettable primitives and explicit hydration tuples; scope a derived atom only when every dependency should be private to that surface.
- For scoped primitives that are always hydrated by `ScopeProvider`, prefer `atomWithLazy<T>(() => { throw new Error(...) })` when consumers should see a non-null type.
- Order state files by dependency graph: types/constants, primitives, query atoms, query-data derived atoms, business/readiness derived atoms, write actions, mutation atoms, submission orchestration, provider exports.
- Name derived atoms as business facts and write atoms as user or workflow commands. Components should read or write the exact atom they need with `useAtomValue` or `useSetAtom`.
- Menu/dialog `open` state usually stays local, but a scoped atom is acceptable when a composed menu plus secondary surface would otherwise pass confusing `open`/`onClose` props through unrelated layers. Scope that primitive with the surface instance so reset behavior stays local.
- Keep independent dialog lifecycles separate. Avoid one discriminated "current action dialog" atom when dialogs have separate open state, loading guards, or reset behavior.

## Components, Props, And Types

- Type component signatures directly; do not use `FC` or `React.FC`.
- Prefer `function` for top-level components and module helpers. Use arrow functions for local callbacks, handlers, and lambda-style APIs.
- Prefer named exports. Use default exports only where the framework requires them, such as Next.js route files.
- Avoid barrel files that only re-export secondary owners. `index.tsx` is acceptable for a route/tab entry component; import header controls, switches, sections, and row owners from their concrete owner files.
- Type simple one-off props inline. Use a named `Props` type only when reused, exported, complex, or clearer.
- Use API-generated or API-returned types at component boundaries. Keep small UI conversion helpers and one-off UI extensions beside the component that needs them.
- Avoid `common.tsx` buckets for shared UI. Use a feature-local `components/` folder with concrete filenames that describe the shared role.
- Do not create type aliases that only rename another type. Use aliases only for real UI concepts, refinements, or reusable local contracts.
- Name values by their domain role and backend API contract, especially persistent IDs and route params. Normalize framework or route params at the boundary.
- Put fallback and invariant checks in the lowest component that already handles that state. Do not extract helpers whose only behavior is hiding missing display data.

## Generated API And Nullable Data

- Treat generated contracts as authoritative at API, query, mutation, cache, and service boundaries. For enterprise APIs, use `packages/contracts/generated/enterprise/*`.
- Do not hand-write DTO mirrors, widen generated fields/enums, or add parallel frontend enum/status layers unless they model product state not represented by the API.
- Use generated enum objects and union types directly in props, comparisons, status logic, and i18n keys. Presentation-only tone maps should be keyed by generated enums.
- Normalize or coerce only at real boundaries: user-entered forms, search, URL/query params, file names, DOM IDs, or legacy adapters.
- Do not coerce nullable or optional API strings to `''` in query, derived model, or payload-building code. Keep `null` or `undefined` until the final boundary requiring a string.
- Do not use `value || undefined` for mutation fields where `''` means "clear this value". Trim or normalize at the form boundary, then preserve intentional empty strings.
- Prefer nullable-tolerant render props for API-returned rows. Narrow only where a real value is required, such as mutation params, route hrefs, select values, query input, or required React keys.
- Build required values in the same branch that proves them, using `flatMap`, a local loop, or an early return. Avoid truthiness guards, `filter(Boolean)`, `filter(item => item.id)`, and `!` after filters.
- Use conditional spreads or explicit pushes for conditional array items instead of `undefined` placeholders followed by narrowing filters.
- Empty collection fallbacks are for not-yet-loaded query data or genuinely nullable collections at the owning render boundary, not for hiding required API fields.

## Queries And Mutations

- Keep `web/contract/*` as the API shape source of truth and follow the `{ params, query?, body? }` input shape.
- Consume generated queries with `useQuery(consoleQuery.xxx.queryOptions(...))` or `useQuery(marketplaceQuery.xxx.queryOptions(...))`.
- If a generated query input comes from an atom, including a route-identity bridge atom, keep the query in `atomWithQuery`; do not unwrap the atom in a component just to call `useQuery`.
- Consume owner-local mutations with `useMutation(consoleQuery.xxx.mutationOptions(...))` or `useMutation(marketplaceQuery.xxx.mutationOptions(...))` when pending/error state is not consumed by feature atoms.
- In `atomWithQuery`, `atomWithInfiniteQuery`, and `atomWithMutation`, return generated `queryOptions()`, `infiniteOptions()`, or `mutationOptions()` directly. Pass `enabled`, `retry`, `placeholderData`, `select`, and pagination options into the generated call instead of spreading options into a hand-built object.
- For generated oRPC options with missing required input, branch the whole input with `input: condition ? validInput : skipToken` and `enabled: Boolean(condition)`. Never place `skipToken` inside a nested placeholder payload or coerce required IDs to `''`.
- When prefetch and render use the same request, extract local query options or a query-options atom so `prefetchQuery` and `useQuery`/`atomWithQuery` share the exact options.
- For custom query or mutation functions, wrap options with TanStack `queryOptions(...)` or `mutationOptions(...)`.
- Do not extract generated `queryOptions(...)` into a helper solely to share input construction; extract only when prefetch/render must share exact options or the helper owns real domain behavior.
- Avoid pass-through hooks and thin `web/service/use-*` wrappers that only rename generated options. Keep feature hooks for real orchestration, workflow state, or shared domain behavior.
- Put shared cache behavior in `createTanstackQueryUtils(...experimental_defaults...)`. Component or atom callbacks may handle local toasts, closing dialogs, and navigation, but should not replace shared invalidation or patch shared server state locally.
- For overlays that may open heavier secondary content, prefetch from the trigger/menu open event with `queryClient.prefetchQuery(queryOptions)` when `onOpenChange` is available. Do not mount hidden subscribers just to warm cache.
- Do not use deprecated `useInvalid` or `useReset`.
- Prefer `mutate(...)`; use `mutateAsync(...)` only when Promise semantics are required, and wrap awaited calls in `try/catch`.

## Boundaries And Overlays

- Use the first level below a page or tab to organize independent page sections when it adds structure or the root folder becomes noisy. This layer is layout/semantic first, not automatically the data owner.
- Treat component names, semantic roles, and user- or design-marked visual regions as boundary constraints. Keep adjacent UI as a sibling owner or introduce a correctly named broader owner.
- Keep cohesive forms, menu bodies, and one-off helpers local unless they need their own state, reuse, or semantic boundary.
- Separate hidden secondary surfaces from the trigger's main flow. For dialogs, dropdowns, popovers, and similar branches, extract a small local component when hidden content would obscure the parent.
- Preserve composability by separating behavior ownership from placement ownership: an action can own trigger/open/menu content while the caller owns slots, offsets, and alignment.
- When a dialog, dropdown, or popover accepts controlled `open`, mount it unconditionally unless unmounting is required for performance or reset semantics. Use keyed scope or local state reset instead of `{open && <Surface />}` wrappers.
- When opening a dialog from a menu item, keep the menu and dialog as sibling surfaces. Let the menu command open the dialog, and mount the dialog outside menu popup content.
- For dialogs and alert dialogs, keep the root responsible for `open` wiring and put query/mutation hooks inside the content component when work should mount only after the overlay opens.
- Prefer uncontrolled overlay roots when the library can own open state. Use `onOpenChange` for side effects and CSS/data selectors for open-state styling.
- Avoid wrapper DOM unless it provides layout, semantics, accessibility, state ownership, or library integration. Avoid shallow wrappers, hook-to-props adapters, layout-only render props, children pass-through wrappers, and prop renaming unless they add real behavior or a real boundary.

## Effects, Navigation, And Performance

- Use Effects only to synchronize with external systems. Do not use Effects to transform props/state for rendering, handle user actions, copy state, reset state from props, or fetch data.
- For forms initialized from query data, prefer keyed remounts or surface-entry atom hydration over Effects that copy query data into form state.
- Prefer framework data APIs or TanStack Query for data fetching.
- Prefer `Link` for normal navigation. Use router APIs only for command-flow side effects such as mutation success, guarded redirects, or form submission.
- Before using `memo`, move changing state down to the smallest component that uses it. If state must wrap stable content, lift the stable content up and pass it as `children`.
- Avoid `memo`, `useMemo`, and `useCallback` unless there is a clear performance reason.

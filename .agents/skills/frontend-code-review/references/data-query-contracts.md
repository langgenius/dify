# Data, Query, And Contract Rules

Use these rules for generated contracts, TanStack Query, mutations, auth/SSR boundaries, URL state, and client persistence.

## Generated Contracts

Flag:

- New legacy service/helper wrappers around generated `queryOptions()` or `mutationOptions()`.
- Continuing to use deprecated contract operations when a ready generated contract exists.
- Assuming a generated file means an operation is ready without checking deprecated markers, schema shape, and the actual UI consumer.
- Re-declaring API DTOs in components.
- Adding compatibility layers instead of migrating the pointed line and deleting the old layer.

Backend Pydantic and OpenAPI schemas own API shape. Generated clients and schemas under `packages/contracts/generated/*` are authoritative at frontend boundaries and use the `{ params, query?, body? }` input shape.

## Queries

Flag:

- `enabled` used to hide missing required input instead of `input: skipToken`.
- Fake fallback IDs or placeholder inputs used to force a query to run.
- Query results copied into local state for rendering.
- Shared query behavior such as invalidation, stale defaults, or retry rules reimplemented at call sites.
- Deprecated imperative reads such as `fetchQuery`, `prefetchQuery`, `ensureQueryData`, or their infinite variants when
  the current `query` or `infiniteQuery` contract applies.

Use `useQuery(consoleQuery.xxx.queryOptions(...))` or `useQuery(marketplaceQuery.xxx.queryOptions(...))` directly unless a feature hook performs real orchestration.

For imperative access, treat the choices as independent dimensions:

- `query` or `infiniteQuery` resolves the generated query and returns its data.
- `staleTime` decides whether cached data satisfies this call: `0` treats it as stale, a finite value accepts a freshness
  window, `Infinity` accepts it until invalidation, and `'static'` accepts available data even after invalidation.
- `select` projects the resolved value without replacing cached query-function data. An imperative query defaults to no
  retries when `retry` is not configured; `enabled` is observer-only, so guard before a conditional call.
- `await` blocks the current flow, `return` transfers the Promise to the caller, and `void` discards the result without
  handling rejection. Handle rejection before discarding a potentially rejecting Promise; use `.catch(noop)` only for
  intentional silence or feedback owned elsewhere, and preserve rejection for hard gates.

## Mutations

Flag:

- Deprecated `useInvalid` or `useReset`.
- `mutateAsync` used without a need for Promise semantics.
- Awaited mutations without `try/catch`.
- Components owning shared cache invalidation that belongs in query defaults.
- Optimistic updates that do not match current list/detail ownership.

Use generated `mutationOptions()` directly when possible. Put shared cache behavior in `createTanstackQueryUtils(...experimental_defaults...)`.

## SSR, Auth, And Route Boundaries

Flag:

- Request-time auth, setup, workspace role, or tenant decisions moved into static `next.config redirects()`.
- Dynamic role gates depending on `workspaces.current` implemented as static path redirects.
- Authorization logic depending on an imperative query whose rejection is swallowed.
- Removing a client fallback before server API unavailable behavior is defined.
- Global placeholder query contracts introduced to solve a route-local Suspense issue.
- Branding-sensitive UI reading placeholder defaults without checking pending/placeholder state.
- A Server Component rendering or passing an imperative query result that the browser can independently revalidate,
  leaving server and client output with different owners.
- A non-blocking Server Component query without pending-query dehydration, Next-compatible error redaction, a
  `HydrationBoundary` covering the same-key client consumer, or an explicit Suspense and SSR-content decision.

Hard gates await `query` or `infiniteQuery` and preserve rejection; soft prefetches handle failure at the fallback owner.
Treat Server Components as prefetch-and-dehydrate owners by default, rendering returned data only under exclusive server
ownership or a freshness contract that prevents server/client drift.

## Workspace And Tenant

Flag:

- Treating workspace switch as ordinary CRUD invalidation when the current app flow performs server switch plus full reload.
- Query keys that omit workspace/tenant identity when the query truly varies by workspace and no full reload boundary applies.
- Mixing `workspace_id` and `tenant_id` without tracing the current backend/API contract.

Current Dify workspace switch should be reviewed as a tenant cache boundary first.

## URL State And Local Storage

Flag:

- Shareable filters, tabs, pagination, selected panels, or search state hidden only in component state.
- One-shot navigation signals modeled as subscribed persistent state.
- Live app state stored in localStorage.
- Direct `window.localStorage`, `globalThis.localStorage`, or raw storage calls in app code.
- High-frequency interaction state persisted on every change instead of on commit/settle.

Use URL state for shareable UI state, feature/Jotai/store state for live UI state, and `@/hooks/use-local-storage` only for low-frequency client-only preferences, dismissed notices, and UI defaults.

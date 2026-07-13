# Data, Query, And Contract Rules

Use these rules for generated contracts, TanStack Query, mutations, auth/SSR boundaries, URL state, and client persistence.

## Generated Contracts

Flag:

- New legacy service/helper wrappers around generated `queryOptions()` or `mutationOptions()`.
- Continuing to use deprecated contract operations when a ready generated contract exists.
- Assuming a generated file means an operation is ready without checking deprecated markers, schema shape, and the actual UI consumer.
- Re-declaring API DTOs in components.
- Adding compatibility layers instead of migrating the pointed line and deleting the old layer.

Use `web/contract/*` as the API shape source of truth. Follow existing `{ params, query?, body? }` input shape.

## Queries

Flag:

- `enabled` used to hide missing required input instead of `input: skipToken`.
- Fake fallback IDs or placeholder inputs used to force a query to run.
- Query results copied into local state for rendering.
- Shared query behavior such as invalidation, stale defaults, or retry rules reimplemented at call sites.
- `prefetchQuery` treated as a hard gate or as returning data/errors to the caller.

Use `useQuery(consoleQuery.xxx.queryOptions(...))` or `useQuery(marketplaceQuery.xxx.queryOptions(...))` directly unless a feature hook performs real orchestration.

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
- Authorization logic depending on soft `prefetchQuery`.
- Removing a client fallback before server API unavailable behavior is defined.
- Global placeholder query contracts introduced to solve a route-local Suspense issue.
- Branding-sensitive UI reading placeholder defaults without checking pending/placeholder state.

Separate hard gates from soft prefetches. `fetchQuery` can be a server decision boundary; `prefetchQuery` is cache warmup.

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

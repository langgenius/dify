# Component Data And Queries

Read this document when a component consumes generated contracts, nullable API values, TanStack Query, mutations, prefetching, authentication, or workspace state.

## Generated Contracts

- Treat generated contracts as authoritative at API, query, mutation, cache, and service boundaries. Enterprise APIs use `packages/contracts/generated/enterprise/*`.
- Backend Pydantic and OpenAPI schemas own API shape. Follow the generated `{ params, query?, body? }` input shape; when it is wrong, fix the backend schema and regenerate `packages/contracts/generated/*`.
- Do not hand-write DTO mirrors, widen generated fields or enums, edit generated output, or add a parallel frontend status layer unless it models product state absent from the API.
- Check deprecated markers, schema shape, and the actual consumer before assuming that a generated operation is ready to use.
- Normalize only at real boundaries such as user input, search, URL params, filenames, DOM IDs, or a required legacy adapter.
- Preserve `null`, `undefined`, and intentional empty strings until the final boundary. Do not use `value || undefined` when an empty string means clearing a field.
- Build required values in the branch that proves them. Avoid `filter(Boolean)`, truthiness filters, non-null assertions after filters, and placeholder values used only to satisfy types.

## Queries

- Use generated options directly with `useQuery(consoleQuery.xxx.queryOptions(...))`, `marketplaceQuery`, or the equivalent generated client.
- If query input comes from atom state, keep it in `atomWithQuery`; do not unwrap the atom in a component solely to call `useQuery`.
- For missing required input, branch the whole generated input with `skipToken` and an explicit `enabled` condition. Do not put `skipToken` inside a placeholder payload or coerce IDs to empty strings.
- Return generated `queryOptions()`, `infiniteOptions()`, or `mutationOptions()` directly from TanStack Query atoms. Pass supported options into the generated call instead of spreading into a parallel object.
- Share the exact options between prefetch and render when they represent the same request. Do not extract option helpers merely to reuse input construction.
- Avoid pass-through service hooks that only rename generated options. Keep feature hooks for actual orchestration or shared domain behavior.

## Mutations And Cache

- Use generated `mutationOptions()` directly for owner-local mutations.
- Put shared invalidation, retries, and cache behavior in `createTanstackQueryUtils(...experimental_defaults...)`. Local callbacks may own toast, close, and navigation effects but must not replace shared cache policy.
- Prefer `mutate(...)`. Use `mutateAsync(...)` only when Promise composition is required, and catch awaited failures.
- Preserve intentional empty values and current list/detail ownership when updating data. Do not add optimistic updates without a verified owner contract.

## Prefetch And Hidden Surfaces

- Prefetch expensive secondary content from the trigger or menu-open event when it benefits the visible path. Do not mount hidden subscribers solely to warm the cache.
- `prefetchQuery` is cache warmup, not an authorization or availability gate. Use a hard fetch boundary when the server must decide whether rendering may proceed.

## SSR, Authentication, And Workspace

- Keep request-time authentication, setup, workspace-role, and tenant decisions out of static route configuration.
- Do not base authorization on soft prefetches or introduce global placeholder contracts to solve route-local Suspense behavior.
- Treat workspace switching as a tenant cache boundary. Trace the current backend contract before mixing `workspace_id` and `tenant_id`, and include the relevant identity in query keys when no full-reload boundary resets the cache.
- Do not remove a client recovery path until server unavailable behavior is defined. Branding-sensitive UI must distinguish pending or placeholder data from authoritative values.

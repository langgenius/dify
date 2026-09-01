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
- Keep owner-local queries in `useQuery` when their pending, error, and data state serve only that component. Promote them to query atoms only when atom input drives them or other graph nodes consume their result.
- When a query supplies several sibling owners, shared derived facts, or workflow commands, model it as a graph node with field selectors. Do not keep it in a page and pass its data, query key, observer methods, and status fields back down as a deconstructed query object.
- For missing required input, branch the whole generated input with `skipToken`. Add `enabled` only for an independent execution condition; do not put `skipToken` inside a placeholder payload or coerce IDs to empty strings.
- Return generated `queryOptions()`, `infiniteOptions()`, or `mutationOptions()` directly from TanStack Query atoms. Pass supported options into the generated call instead of spreading into a parallel object.
- Share the exact options between prefetch and render when they represent the same request. Do not extract option helpers merely to reuse input construction.
- In Jotai-backed components, consume field-level selectors or named facts rather than the complete query result unless observer methods such as `refetch` or an infinite-scroll field group are part of that owner's contract.
- Keep observer methods inside the component that owns the query surface or behind a named graph command. A parent must not pass raw `refetch`, query keys, or invalidation details merely because a descendant action needs fresh data.
- Treat `refetch()` as an explicit execution command: it can run a query whose observer currently has `enabled: false`. Retry and refresh commands must recheck the permission, identity, or availability condition before including conditionally enabled queries.
- Cache writes and query-observer notifications may reach React through asynchronous batching, including when `atomWithQuery` observes an existing QueryClient. Tests that call `setQueryData`, invalidate, or complete a refetch must await the resulting DOM fact with `findBy*` or `waitFor`; do not assume the observer rerender is synchronous with the cache call.
- Avoid pass-through service hooks that only rename generated options. Keep feature hooks for actual orchestration or shared domain behavior.

## Mutations And Cache

- Use generated `mutationOptions()` directly for owner-local mutations.
- Keep a mutation in `useMutation` when pending and error state belong to one dialog or form. Use a mutation atom only when shared workflow orchestration or graph-derived state consumes it; query and mutation atoms remain unscoped.
- Put shared invalidation, retries, and cache behavior in `createTanstackQueryUtils(...experimental_defaults...)`. Local callbacks may own toast, close, and navigation effects but must not replace shared cache policy.
- Workflow-specific invalidation belongs beside the mutation/command that understands which caches become stale. Construct generated query options or keys from graph identity there instead of receiving keys from a rendering parent.
- Prefer `mutate(...)`. Use `mutateAsync(...)` only when Promise composition is required, and catch awaited failures.
- Preserve intentional empty values and current list/detail ownership when updating data. Do not add optimistic updates without a verified owner contract.

## Prefetch And Hidden Surfaces

- Prefetch expensive secondary content from the trigger or menu-open event when it benefits the visible path. Do not mount hidden subscribers solely to warm the cache.
- `prefetchQuery` is cache warmup, not an authorization or availability gate. Use a hard fetch boundary when the server must decide whether rendering may proceed.

## SSR, Authentication, And Workspace

- Static configuration owns path-invariant routing. Request-dependent authentication, setup, role, and tenant decisions belong to SSR or runtime decision boundaries.
- Distinguish soft SSR cache warming from authoritative decisions. Prefetched or placeholder data must not grant access or represent successful availability.
- Never reuse tenant-scoped state after switching workspaces. Discard it at the switch boundary or isolate it by workspace identity.
- Do not make product or authorization decisions from bootstrap defaults. Wait for authoritative data, or render an explicit loading or error state.
- Keep loading and Suspense behavior inside the feature that owns the request. Do not add fake global data merely to bypass that boundary.

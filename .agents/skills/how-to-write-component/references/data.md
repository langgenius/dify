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
- For missing required input, branch the whole generated input with `skipToken`. Add `enabled` only for an independent execution condition; do not put `skipToken` inside a placeholder payload or coerce IDs to empty strings.
- Return generated `queryOptions()`, `infiniteOptions()`, or `mutationOptions()` directly from TanStack Query atoms. Pass supported options into the generated call instead of spreading into a parallel object.
- For the same logical request, preserve key, input, operation, and result contracts. Reuse exact options only when
  transport, context, and cache policy are shared; imperative and observer freshness may differ. Do not extract a helper
  merely to reuse input construction.
- Avoid pass-through service hooks that only rename generated options. Keep feature hooks for actual orchestration or shared domain behavior.

## Mutations And Cache

- Use generated `mutationOptions()` directly for owner-local mutations.
- Put shared invalidation, retries, and cache behavior in `createTanstackQueryUtils(...experimental_defaults...)`. Local callbacks may own toast, close, and navigation effects but must not replace shared cache policy.
- Prefer `mutate(...)`. Use `mutateAsync(...)` only when Promise composition is required, and catch awaited failures.
- Preserve intentional empty values and current list/detail ownership when updating data. Do not add optimistic updates without a verified owner contract.

## Prefetch And Hidden Surfaces

- Prefetch expensive secondary content from the trigger or menu-open event when it benefits the visible path. Do not mount hidden subscribers solely to warm the cache.
- Use `query` or `infiniteQuery` for imperative access. `staleTime` defines cache acceptance; `select` projects the return
  value without replacing cached query-function data. Imperative queries default to no retries when `retry` is not
  configured, and observer-only `enabled` does not prevent an imperative call.
- `await` blocks, `return` transfers the Promise, and `void` discards its value without handling rejection. Handle
  rejection before discarding a potentially rejecting Promise; use `.catch(noop)` only for intentional silence or
  feedback owned elsewhere. Hard server gates await the query and preserve rejection.

## SSR, Authentication, And Workspace

- Static configuration owns path-invariant routing. Request-dependent authentication, setup, role, and tenant decisions belong to SSR or runtime decision boundaries.
- Distinguish soft SSR cache warming from authoritative decisions. Prefetched or placeholder data must not grant access or represent successful availability.
- Treat Server Components as query prefetch-and-dehydrate owners by default. Do not render or pass an imperative query
  result when a browser observer can revalidate the same data unless ownership and freshness explicitly prevent drift.
- Non-blocking RSC streaming requires pending-query dehydration without redacting Next.js server errors, a
  `HydrationBoundary` around the same-key client consumer, and Suspense when that content must be server-rendered.
- Never reuse tenant-scoped state after switching workspaces. Discard it at the switch boundary or isolate it by workspace identity.
- Do not make product or authorization decisions from bootstrap defaults. Wait for authoritative data, or render an explicit loading or error state.
- Keep loading and Suspense behavior inside the feature that owns the request. Do not add fake global data merely to bypass that boundary.

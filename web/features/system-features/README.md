# System Features

This feature owns the deployment-wide capability query contract and application bootstrap boundary. It is neither a
cross-request server cache nor a general configuration registry.

- The generated System Features operation owns the shared query identity and response contract.
- `server.ts` owns request-scoped imperative resolution and dehydration. Under the [TanStack Query prefetching] semantics,
  `'static'` accepts any successful request-local snapshot, even after invalidation. Optional access maps an initial
  no-data failure to `undefined` without another optional attempt; required access reuses a successful snapshot, starts
  a new resolution after an earlier no-data failure, and preserves rejection for route gates. Neither path configures
  automatic retry.
- `client.ts` owns the browser observer policy. `Infinity` keeps the hydrated bootstrap snapshot fresh without automatic
  revalidation, while still allowing explicit invalidation or refetching.
- `bootstrap-boundary.tsx` blocks application rendering until the browser cache has capability data. When optional SSR
  access fails, this boundary owns the client recovery request and its loading, error, and retry UI.
- `state.ts` exposes narrow derived client atoms backed by the same TanStack Query data.

Following [TanStack Query advanced SSR], server reads are limited to metadata, route gates, integration inclusion, and
Home prefetch shape; application rendering stays client-owned through the hydrated cache. Revisit that split if the
browser snapshot becomes automatically revalidating. Consumers must not issue a second capability request or copy
deployment-edition state.

[TanStack Query advanced SSR]: https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr
[TanStack Query prefetching]: https://tanstack.com/query/latest/docs/framework/react/guides/prefetching

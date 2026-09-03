# System Features

This feature owns the deployment-wide capability query contract and application bootstrap boundary.

- `server.ts` owns the request-scoped query client. Optional access soft-fails once per request, required access preserves failures for route gates, and domain dehydration transfers successful data to the browser cache.
- `client.ts` owns the canonical query options.
- `bootstrap-boundary.tsx` blocks application rendering until capability data is available and owns retry UI.
- `state.ts` exposes narrow derived client atoms backed by the same TanStack Query data.

Consumers read capabilities through this feature instead of issuing another request or copying deployment-edition state.

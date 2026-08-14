# System Features

This feature owns the deployment-wide capability query contract and application bootstrap boundary.

- `server.ts` exposes the request-scoped query client and canonical server query options; route and layout owners perform prefetching and hydration.
- `client.ts` owns the canonical query options.
- `bootstrap-boundary.tsx` blocks application rendering until capability data is available and owns retry UI.
- `state.ts` exposes narrow derived client atoms backed by the same TanStack Query data.

Consumers read capabilities through this feature instead of issuing another request or copying deployment-edition state.

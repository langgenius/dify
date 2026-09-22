# Console service

Use `consoleClient` and `consoleQuery` from `@/service/console`
in Server and Client Components. Calls use the appropriate HTTP
transport for the Python Console API.

- [Browser transport] preserves the existing request
  layer's authentication and error handling.
- [Server transport] requires an absolute API address;
  see [server configuration].
  [Instrumentation] and the [root layout]
  register this transport. Only the transport is shared globally;
  request identity is resolved per request.
- Shared query/mutation defaults live in
  [query-policies.ts].
  In oRPC v1, caller options override defaults, including callbacks.
- Routes/layouts own prefetching and hydration. Use the existing
  [QueryClient factory].

## Policy ownership

Shared operation defaults belong in `query-policies.ts`. Call sites own inputs,
execution conditions, projections, and interaction feedback. A local option
overrides the corresponding default; callbacks are not composed automatically.
When a mutation uses shared `onSettled` invalidation, keep local toast, close, and
navigation behavior in `onSuccess` / `onError`. Do not override `onSettled` without
preserving that cache contract. The returned invalidation promise keeps the
mutation pending until active consumers have refreshed.

Use generated options and types directly. A feature-owned options factory is
appropriate only when it owns a shared request policy or a composed query;
forwarding hooks and handwritten API DTOs create a second owner.

Module contracts record backend ownership, affected caches, and call-site choices:

- [Plugin endpoints]

[Browser transport]: ./browser.ts
[Instrumentation]: ../../instrumentation.ts
[Plugin endpoints]: ../../app/components/plugins/plugin-detail-panel/endpoints.md
[QueryClient factory]: ../../app/get-query-client.ts
[Server transport]: ./server.ts
[query-policies.ts]: ./query-policies.ts
[root layout]: ../../app/layout.tsx
[server configuration]: ../../config/server.ts

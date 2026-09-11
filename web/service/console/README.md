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

[Browser transport]: ./browser.ts
[Instrumentation]: ../../instrumentation.ts
[QueryClient factory]: ../../app/get-query-client.ts
[Server transport]: ./server.ts
[query-policies.ts]: ./query-policies.ts
[root layout]: ../../app/layout.tsx
[server configuration]: ../../config/server.ts

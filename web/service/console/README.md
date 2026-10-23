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
  [query-defaults.ts].
  In oRPC v1, caller options override defaults, including callbacks.
- Routes/layouts own prefetching and hydration. Use the existing
  [QueryClient factory].

## Policy ownership

Shared operation defaults belong in `query-defaults.ts`. The existing oRPC router assembles them in `query-policies.ts`; `console.openapi.queries.ts` exposes the same defaults as static per-operation exports for the inferred client. Cache references use `query-keys.ts`, which carries no HTTP client or contract registry. Call sites own inputs,
execution conditions, projections, and interaction feedback. A local option
overrides the corresponding default; callbacks are not composed automatically.
When a mutation uses shared `onSettled` invalidation, keep local toast, close, and
navigation behavior in `onSuccess` / `onError`. Do not override `onSettled` without
preserving that cache contract. The returned invalidation promise keeps the
mutation pending until active consumers have refreshed.

List affected generated keys inline in the owning operation's policy. Whether
invalidation runs after an error depends on the write contract: a rejected
request does not imply the server rolled back. Record that decision per module.
Do not add an invalidation helper to hide the cache dependencies.

Use generated options and types directly. A feature-owned options factory is
appropriate only when it owns a shared request policy or a composed query;
forwarding hooks and handwritten API DTOs create a second owner.
[Instrumentation]: ../../instrumentation.ts
[QueryClient factory]: ../../app/get-query-client.ts
[Server transport]: ./server.ts
[query-defaults.ts]: ./query-defaults.ts
[root layout]: ../../app/layout.tsx
[server configuration]: ../../config/server.ts

## OpenAPI mapper migration

`inferred.ts` exposes the same nested client and Query member names through TS 7.1
Content Mappers. It is a separate entry while migration is incremental. The
KnowledgeFS metadata call is the initial committed consumer.

The imported `console.openapi` symlink points at the composed document in
`packages/contracts/openapi/console-client-openapi.json`. `@dify/contracts` prepares
it during workspace installation from the tracked Console, FastOpenAPI and two
normalized enterprise snapshots. It namespaces schema references and preserves
enterprise member paths via `x-client-path`. Redirect-only endpoints are excluded,
matching the generated oRPC router. No private repository or running API is needed
for an ordinary checkout.

After changing source snapshots, or installing with lifecycle scripts disabled, run:

```sh
pnpm --filter @dify/contracts compose:console
pnpm --filter @dify/openapi-content-mapper build
```

The Docker build runs these steps explicitly. API contract regeneration refreshes
the composed document. Enterprise regeneration requires the matching enterprise
source checkout through `DIFY_ENTERPRISE_SERVER`; its generation command also
exports only reachable Console schemas and records the existing contract member
paths. Commit those source snapshots with their regenerated contracts. Do not
commit the composed document or mapper caches.

Migration gates:

```sh
pnpm --filter @dify/openapi-content-mapper check:console
pnpm --filter @dify/openapi-content-mapper test:repository
pnpm --filter @dify/openapi-content-mapper benchmark:console
```

`check:console` requires full route coverage and compares input/output assignability
against the reviewed per-operation baseline in `console-type-differences.json`.
The baseline distinguishes omitted-input ergonomics, explicit multipart media,
raw SSE streams, parsed defaults versus wire values, undocumented bodies, and
legacy JSON-labelled binary responses. Those last responses are existing spec
issues: verify/fix their advertised response media before migrating those callers.
To review changed differences, run `compare:orpc -- --console --update-baseline`
and inspect the generated report; do not accept a changed baseline without
checking the affected operation. The default all-surface repository tests also
require the other locally generated API OpenAPI documents.

The Web compatibility suite compares cache keys and default policies across the
whole composed router. SDK integration tests compare complete and reduced bundles,
including lazy error validators. Keep direct ESM re-exports at the application
entry and keep cache policies independent of runtime client registries.

The benchmark writes measurements to `/tmp/dify-console-benchmark.json`; pass an
absolute `.json` output path to change it. It checks the actual application entries
serially with bounded compiler parallelism. It reports initial chunks, the first
successful request, error validation and all emitted chunks separately. Its scoped
CLI type timings are not whole-application or editor latency. Results and migration
status belong in the PR rather than a checked-in measurement report.

[Browser transport]: ./browser.ts

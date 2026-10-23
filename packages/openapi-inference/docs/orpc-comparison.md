# Comparison with oRPC

For an existing REST backend, this package provides direct OpenAPI imports, nested calls and automatic pruning of statically unused operations. Direct oRPC offers a broader transport and error-handling ecosystem without requiring this package's beta compiler integration. Both can produce smaller bundles when unused contract information is removed.

This comparison describes the Dify pilot and oRPC **1.15.7**, not every oRPC version or application. Measurements were taken on 2026-10-23 at Dify revision [`b14efc01d3`].

## Calling model and tooling

| Aspect            | Inferred SDK                                                                     | Direct oRPC in the Dify REST client                                  |
| ----------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Type source       | OpenAPI imported through TS 7.1 Content Mappers                                  | Generated TypeScript/Zod/oRPC contracts                              |
| Build steps       | Compiler mapper and bundler adapter; no separate generated SDK source            | Contract code generation followed by normal TypeScript and bundling  |
| Calls             | Nested `api` functions and `query` helpers                                       | Nested client functions and `createTanstackQueryUtils`               |
| Query integration | Reuses `@orpc/tanstack-query` primitives                                         | Uses `@orpc/tanstack-query` directly                                 |
| Toolchain         | TS 7.1 beta, editor mapper configuration and a supported runtime/bundler adapter | Does not require the content mapper or TS 7.1 beta                   |
| Runtime scope     | Fetch transport, supported OpenAPI serialization and raw SSE streams             | oRPC Links, interceptors, error model and serialization integrations |

The similar calling shape does not make the two clients interchangeable. Input schemas, error handling, context and application-specific query policies still need to be checked when migrating an endpoint.

## Bundle measurements

The benchmark uses `GET /knowledge-fs/spaces/{control_space_id}/metadata` in a browser ESM library build with minification and no externalized dependencies. The API entry exports a wrapper calling the operation. The query entry exports a wrapper returning its `queryOptions`; API-only entries do not construct query helpers. Each result contains one JavaScript chunk. KB means 1,000 bytes.

| Client and contract                                 | API JS / gzip KB | Query JS / gzip KB |
| --------------------------------------------------- | ---------------: | -----------------: |
| Inferred SDK, complete console OpenAPI document     |  5.66 / **2.38** |   11.81 / **3.81** |
| OpenAPILink, generated KnowledgeFS group            |   312.62 / 57.40 |     318.96 / 58.86 |
| OpenAPILink, single generated procedure import      |   306.60 / 55.83 |     312.83 / 57.27 |
| OpenAPILink, pre-minified KnowledgeFS group         |    76.42 / 13.31 |      82.64 / 14.65 |
| OpenAPILink, pre-minified single-operation contract |    32.87 / 10.08 |      39.08 / 11.42 |
| RPCLink, different protocol; reference only         |     28.77 / 9.25 |      35.08 / 10.58 |

The SDK starts from the full console specification and retains the statically used operation. In the existing generated oRPC file, importing only the metadata procedure still retains other KnowledgeFS routes because schema/contract construction calls are not fully eliminated. This is partly a property of the generated code, not just the oRPC core runtime.

oRPC officially supports [`minifyContractRouter`]. Pre-minifying the group substantially reduces the bundle, although it still includes that group's routes. Selecting and pre-minifying a single-operation contract removes the unused routes. In this version, minification also removes `errorMap`; it does not preserve the generated defined-error validation used by Dify.

[`OpenAPILink`] uses a runtime contract to call OpenAPI-compatible HTTP servers. [`RPCLink`] can use a type-only client declaration, but requires a server implementing the matching RPC protocol. Its row is not a replacement benchmark for Dify's Python REST backend.

### Measurement boundaries

- Environment: Node 24.22.1, oRPC 1.15.7 and the repository's Vite Plus core 1.4.0 alias. These are not measurements with the official Vite 8.3.5 used by the standalone package verification.
- Inputs: `packages/contracts/openapi/console-openapi.json` and the generated `packages/contracts/generated/api/console/knowledge-fs/orpc.gen.ts` at the revision above. The SDK document is copied without its Dify runtime sidecar and configured with a fixed base URL.
- Both clients include their transport and, for query entries, query helper dependencies. Both exclude shared Dify authentication, defined-error validation and endpoint-specific query policies.
- Minified contracts are computed before bundling, rather than shipping the minification implementation to the browser. Their preparation and oRPC code generation are outside the measurement.
- Sizes are the emitted JavaScript byte length and Node's default `gzipSync` output. They are isolated artifacts, not incremental application costs or page-load measurements. Dify already loads oRPC contracts lazily by group.
- The SDK implements a smaller runtime feature set. Smaller output is not evidence of full behavioral equivalence. No end-to-end build-speed, editor-performance or runtime-throughput claim is made.

## Types and runtime behavior

Five existing generated contracts were checked again: dataset list, dataset creation, file upload, service chat and public chat-run. The checks passed with the intentional raw-stream and explicit multipart differences retained. This is a spot check, not proof that every generated procedure has identical types.

An earlier full audit at revision `530d8300cfdfeca610a6288a4db04025ad921887` compared 1,286 generated procedures. Of these, 914 had mutually assignable inputs and outputs; 97 had input differences and 301 had output differences, with 26 overlapping. Differences were classified as missing oRPC input schemas, explicit multipart choices, parsed defaults versus wire values, undocumented bodies and raw streams. No unexplained differences remained in that snapshot. That full audit was **not rerun** for this benchmark; see the [repository guide] for audit commands and classification details.

A Fetch-stub check of the metadata endpoint compared the SDK with both the original and minified OpenAPILink contracts:

- HTTP method, escaped path, query parameter values and successful response data matched. Query parameter ordering differed, which does not change this endpoint's request semantics.
- Query keys matched when both clients used the same `['console']` prefix.
- For a simulated HTTP 403, the standalone SDK returned `ApiError` with the response and decoded body. OpenAPILink returned `ORPCError` with its own status, code and error-data envelope.
- Dify's SDK adapter retains the existing application's `ORPCError` envelope, but does not load the generated defined-error maps or apply their validation. Endpoint-specific query policies are not inherited automatically.

The check did not call a live Dify or KnowledgeFS backend. The SDK does not runtime-validate response schemas or fill schema defaults. SSE remains a raw `ReadableStream<Uint8Array>`; multipart keeps its explicit media-type and encoding design.

## Choosing an approach

The inferred SDK is useful when OpenAPI is already the source of truth and direct imports, nested calls and automatic operation pruning justify maintaining the beta compiler and bundler integrations. The single-endpoint Dify pilot keeps the migration small enough to verify these tradeoffs.

If bundle size is the only concern, first consider optimizing the existing oRPC generator and pre-minifying or narrowing its runtime contracts. This avoids introducing the content-mapper toolchain. For a native oRPC server, evaluate the type-only RPCLink client separately rather than assuming it has the same contract cost as the REST client.

[`OpenAPILink`]: https://v1.orpc.dev/docs/openapi/client/openapi-link
[`RPCLink`]: https://v1.orpc.dev/docs/client/client-side
[`b14efc01d3`]: https://github.com/langgenius/dify/commit/b14efc01d32b7815fae9c55f6710592aa2e023f6
[`minifyContractRouter`]: https://v1.orpc.dev/docs/contract-first/router-to-contract
[repository guide]: https://github.com/langgenius/dify/blob/main/packages/openapi-inference/docs/repository.md

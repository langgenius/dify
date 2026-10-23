# Dify integration and repository validation

These instructions are for contributors working in the Dify monorepo. Package users should start with the [README](../README.md).

## Verification with the repository's actual specifications

Run after building:

```sh
pnpm --filter @dify/openapi-inference test:repository
```

This reads the existing generated files in `packages/contracts/openapi/` and the tracked `api/knowledge-fs-contract/knowledge-fs.openapi.json`. The console snapshot is committed for frontend consumers; the other generated documents remain ignored by Git and must be exported for the full repository suite. Set `DIFY_OPENAPI_DIR=/path/to/existing/openapi` if those documents live in another checkout. Missing inputs fail explicitly. The suite uses temporary `.openapi` symlinks and verifies source SHA-256 hashes are unchanged.

Refresh the local OpenAPI documents from the current backend before comparing with checked-in contracts (run from the repository root):

```sh
uv run --project api api/dev/generate_swagger_specs.py --output-dir packages/contracts/openapi
uv run --project api api/dev/generate_fastopenapi_specs.py --output-dir packages/contracts/openapi
```

| Document            | Operations checked |
| ------------------- | -----------------: |
| console             |                978 |
| fastopenapi-console |                  6 |
| inner               |                 63 |
| openapi             |                111 |
| service             |                156 |
| web                 |                 43 |
| knowledge-fs        |                203 |
| Total               |               1560 |

The suite checks full-document mapping without dropping operations; native TS 7.1 signatures for every route; positive and negative request/response assertions; full-console LSP completions and hover; and real local HTTP requests for queries, relative server URLs, multipart files/arrays/JSON parts, binary bodies, historical aliases and SSE cancellation. It does not call the running Dify or KnowledgeFS services or mutate business data. Relative server URLs use the browser origin; Node callers provide an absolute `baseUrl`.

The oRPC spot check reads input/output types from the actual generated procedures' Standard Schema definitions. It verifies bidirectional assignability for dataset listing (including `knowledge_fs_upgrade`), dataset creation, file upload, and the JSON portion of service chat responses. The public chat-run output also matches. Intentional differences are asserted explicitly: SSE uses a raw `ReadableStream` instead of oRPC's generated `string`, and chat-run inputs distinguish JSON strings from multipart files using `contentType`. These checks cover five endpoints, not all generated contracts or runtime validation behavior.

For a full comparison, run `pnpm --filter @dify/openapi-inference compare:orpc` after building. This matches every exported procedure in `packages/contracts/generated/api` by HTTP method and path, including the FastOpenAPI console prefix adjustment, and checks both assignability directions plus top-level `any`, `unknown`, and `never`. It writes `reports/orpc-comparison.json` with every result, missing counterparts, source hashes and compiler diagnostics. A successful command means the audit completed; it does **not** mean every type is compatible. Representation checks (schema defaults, omitted input, `void`, streaming and multipart) are separate from the raw comparisons and never change the SDK.

The current full audit covers all **1,286** existing generated procedures: **914** have mutually assignable inputs and outputs; **97** have an input difference and **301** an output difference (26 overlap). Another **274** OpenAPI operations lack a generated counterpart: 63 inner, 203 KnowledgeFS, and 8 console redirects filtered out by codegen. Request headers now use oRPC's `headers` key, typed dictionaries reject extra `undefined` values, empty RPC responses use `void`, and local schema references use recursive virtual aliases. Remaining input differences are 87 missing oRPC input schemas (inferred as `unknown`) and 10 explicit multipart choices. Remaining output differences are 270 parsed defaults, 21 undocumented bodies, 9 raw streams, and one stream combined with parsed defaults. There are no unexplained differences in this snapshot.

Run `pnpm --filter @dify/openapi-inference check:orpc` to fail on unexplained differences, vacuous top-level types or an unmatched generated procedure. Known differences are established by additional type checks; they do not replace the raw results. The repository's `OpenAPILink` does not apply Zod response defaults: an omitted field stays omitted at runtime. Likewise, a procedure without an input schema infers `unknown`, even though the detailed transport rejects primitive input. The SDK keeps optional wire fields and rejects invalid arguments instead of copying these overbroad guarantees. Undocumented successful response bodies stay `unknown` rather than becoming invented object shapes.

Full-console imports produce approximately **5.7 KB JS / 2.2 KB gzip** for `api.datasets.get`, or **11.7 KB / 3.6 KB gzip** for its query helper. KnowledgeFS `health.get` is approximately **5.1 KB / 2.2 KB gzip**, or **11.2 KB / 3.6 KB gzip** for its query helper. Each full-document result is compared against a one-path document and must produce identical code after removing bundler module-label comments.

Specification limitations remain visible: Swagger 2 input files are rejected (use the corresponding converted OpenAPI 3 files); undocumented successful responses and redirect-only operations infer `unknown`. Some current documents omit upload request schemas or label SSE as JSON (for example public `/apps/{app_id}/chat:run`). Inference follows those declarations and cannot repair missing or incorrect server contracts. Runtime SSE detection uses the actual response Content-Type.

## Prototype boundaries

### KnowledgeFS console integration pilot

`web/service/console/inferred.ts` exposes the complete imported console document as `consoleClient` and `consoleQuery`. Only `web/service/knowledge-fs/metadata.ts` is migrated: it reads metadata through the inferred `GET /knowledge-fs/spaces/{control_space_id}/metadata` operation. It is used by the document metadata drawer/card and the Knowledge Retrieval v2 panel. `console.openapi` is a relative symlink to the existing `packages/contracts/openapi/console-openapi.json`; this is the Dify console contract, not the direct KnowledgeFS service contract. The console snapshot is committed, so both the application import and repository example resolve in a fresh checkout without Python or a local backend. Update it through `pnpm --dir packages/contracts gen-api-contract` when the backend changes. The existing `autofix.ci` frontend-contract job runs that same command for backend or contract changes and includes the refreshed snapshot in its generated changes. Keep the exporter's sorted JSON verbatim; do not edit the snapshot by hand.

`console.openapi.config.ts` binds every operation to the existing console transport and supplies the shared context type and query-key prefix. Endpoint inputs and outputs come from the imported specification. The migrated owner keeps its existing nested API calls and only switches its import to `@/service/console/inferred`; there is no metadata-specific client wrapper. The browser keeps cookie auth, CSRF, refresh handling, `silent`, cancellation and response-header callbacks. Server calls use the existing `@/service/console/server` registration and request-local identity. HTTP errors retain the existing `ORPCError` envelope; the pilot does not load generated error maps or mark errors as validated defined errors. The unchanged query-key prefix lets existing oRPC consumers invalidate the same cache. Pagination now forwards the cancellation signal and silent context to every request.

Normal workspace installation builds this package through its `prepare` script. When installing with `--ignore-scripts`, build it explicitly before running Web; the Docker build does this too. Web configures the mapper runtime for Vinext, unit tests and Storybook, and an OpenAPI loader for Next.js Turbopack and Webpack. The Next.js rules match the resolved `console-openapi.json` target of the `.openapi` symlink and bind the same console runtime configuration. Use the existing Vinext command (`pnpm --dir web dev`) or Next.js command (`pnpm --dir web dev:next`) with a configured Dify console backend and KnowledgeFS enabled.

```sh
pnpm --filter @dify/openapi-inference build
pnpm --dir web type-check
pnpm --dir web exec vp test run --project unit service/knowledge-fs/__tests__/metadata.spec.ts service/console/server.spec.ts app/components/workflow/nodes/knowledge-retrieval-v2/__tests__/panel.spec.tsx
pnpm --filter @dify/openapi-inference exec node --test integration/knowledge-fs-console.test.mjs
```

The integration checks pagination, CSRF/cookies, cache invalidation, HTTP errors, cancellation, response headers and server identity forwarding at the network boundary. It does not prove a running Dify/KnowledgeFS deployment is configured. The production metadata module bundles to approximately **13.3 KB JS / 4.1 KB gzip**, including the SDK and query helpers, with the shared application runtime configuration external. Full-console and single-operation imports produce identical code after removing module-label comments. Only metadata reading is migrated; other KnowledgeFS operations retain their existing clients. The shared setup is also tested with an unmigrated space-list query. FastOpenAPI/enterprise documents and existing endpoint-specific query policies are not automatically composed into this entry; preserve or migrate their behavior when moving the corresponding consumers.

### Supported scope

- OpenAPI 3.0/3.1; local JSON Pointer references; required/optional fields; enum/const; arrays, objects and dictionaries; `oneOf`, `anyOf`, `allOf`; nullable types. Imported local schema references become lazy, type-only aliases, preserving recursive JSON and deeply nested models without finite expansion. No schema types are shipped to the browser or written as SDK files. The standalone `InferSchema` helper and inline expansion retain a 24-step fallback; circular aliases without an object/array boundary remain subject to TypeScript diagnostics.
- JSON, flat multipart and Blob/File binary request bodies; JSON, text, binary, raw SSE streams and empty responses; path/header `simple`, query `form`/flat `deepObject`, primitive cookies. Browser Fetch controls whether Cookie headers may be set.
- External references, URL-encoded forms, nested multipart file dictionaries, advanced serialization and YAML aliases are not implemented. Multipart supports repeated array fields and explicit `application/json` part encoding. When multiple request media types are declared, only `application/json` may omit `contentType`; all other alternatives require it explicitly. A single declared media type may always omit it. SSE returns a `ReadableStream<Uint8Array>` without buffering or parsing events. Unsupported request serialization fails explicitly. This is not a complete JSON Schema validator, and response bodies are not runtime-validated.
- These are oRPC-shaped functions using a Fetch transport, not a drop-in replacement for every oRPC Link, interceptor, typed error map or Dify `context` policy. Document configurations can implement context behavior through the transport factory; arbitrary existing query policies and defined-error maps are not imported automatically. Errors expose `response` and `data` via `ApiError`.
- Unresolvable router member collisions are rejected. `key` is reserved as a route segment for query helpers. Operation IDs do not become exports and have no reserved names.
- Vite, Next.js Turbopack and Webpack handle bundling; Node handles direct execution. Other bundlers need an adapter. The compiler's mapper output is used for checking and is not the browser runtime artifact.

References: [TS 7.1 announcement] and [content mapper protocol].

[TS 7.1 announcement]: https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta
[content mapper protocol]: https://github.com/microsoft/typescript-go/pull/4712

# OpenAPI inference with TypeScript 7.1

An experimental SDK using **TypeScript 7.1 Content Mappers**. Import an OpenAPI document, get typed oRPC-style calls and TanStack Query helpers, and bundle only the operations you use. There is no SDK generation command and no generated SDK or declaration files to commit.

```ts
import { client } from '@dify/openapi-inference'
import { api as consoleClient, query as consoleQuery } from './pets.openapi.yaml'

client.setConfig({ baseUrl: 'https://example.com' })

const pet = await consoleClient.pets.byPetId.get({ params: { petId: 1 } })
// pet.name: string; pet.status: 'available' | 'adopted'

const options = consoleQuery.pets.byPetId.get.queryOptions({
  input: { params: { petId: 1 } },
})
// useQuery(options), queryClient.fetchQuery(options), etc.
```

`/pets/{petId}` becomes `pets.byPetId`; hyphenated and underscored segments become camelCase. Each HTTP method is a leaf function. Colon actions such as `/apps/{app_id}/chat:run` become `apps.byAppId.chat.run`; `/` becomes `root`. When legacy underscore routes collide with camelCase normalization, the canonical route keeps its camelCase member and the alias retains its literal segment (for example `createByFile` and `create_by_file`). Inputs use `params`, `query`, `body`, `headers`, and `cookie`; the optional second argument accepts `client`, `signal`, `headers`, and `credentials`. Calls return response data and throw `ApiError` on non-2xx responses.

Operations with an `operationId` also have a named export, e.g. `getPet({ path: { petId: 1 } })`. The nested API does not require operation IDs.

## Try the checked-in demo

From the repository root:

```sh
pnpm install --filter @dify/openapi-inference --ignore-scripts
pnpm --filter @dify/openapi-inference build
pnpm --filter @dify/openapi-inference type-check
pnpm --filter @dify/openapi-inference test
pnpm --filter @dify/openapi-inference demo
```

The demo starts an ephemeral local HTTP server, exercises YAML and JSON-backed imports, creates and deletes a pet, checks a 404 response, and closes the server. Node 24+ is required for the synchronous module hooks. This package pins TypeScript **7.1.0-beta** in its own catalog. The workspace's `@typescript/native` alias also points to 7.1.0-beta. Existing checks still use the unchanged tsrs version; Web adds `--runExternalCode` for Content Mappers. The TS 6 JavaScript Compiler API remains available to code-generation, lint and i18n tools.

## Native compiler setup

Build the package first, then configure the consuming project:

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "NodeNext",
    "target": "ES2022",
    "noEmit": true
  },
  "contentMappers": [
    {
      "package": "@dify/openapi-inference",
      "extensions": [".yaml", ".yml", ".openapi"]
    }
  ]
}
```

Run `tsc --runExternalCode --noEmit`. This is the actual TS 7.1 compiler, not a wrapper or a TS 6 language-service plugin. The local example uses `"package": "../.."` to resolve this uninstalled package directly.

For editor support, open this package directory in VS Code, use Microsoft's **TypeScript 7** extension (`TypeScriptTeam.native-preview`), and select the workspace TypeScript **7.1.0-beta** installation. The workspace must be trusted and content mappers enabled. Open a consuming `.ts` file first so the language server discovers its config. Native LSP tests cover nested completions, inferred response hover, navigation from a method to its YAML declaration, and unsaved YAML updates.

### JSON in the 7.1 beta

The beta rejects content mapper registrations for built-in `.json` files, including `.openapi.json` (`TS18066`). Use JSON content in a file ending in `.openapi`, or keep an existing JSON file and add a symlink:

```sh
ln -s pets.json pets.openapi
```

Then import `./pets.openapi`. The example includes this exact setup. Nothing copies or regenerates the JSON. Both the Node hook and Vite plugin preserve the logical `.openapi` extension when resolving the symlink. Native `.json` imports are **not** advertised as supported.

## Runtime setup

Content mappers provide types; they do not implement runtime loading. Vite and Node adapters use the same parsed document to expose matching runtime modules.

For Vite:

```ts
import { openapi } from '@dify/openapi-inference/vite'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [openapi()] })
```

For Node:

```sh
node --import @dify/openapi-inference/register app.ts
```

For Next.js, use `@dify/openapi-inference/loader` in both `turbopack.rules` and `webpack` rules, as shown in `web/next.config.ts`. Turbopack rules need `as: '*.js'`; Webpack rules need `type: 'javascript/auto'` for JSON targets. Match the resolved JSON filename when importing through an `.openapi` symlink. The optional `runtime` loader option is a path relative to the specification directory; this selects the sidecar when symlink resolution moves the specification to another directory. Without the option, the loader discovers `<resolved filename>.config.ts`.

The loader emits ESM namespaces as separate query modules, keeping API calls and query helpers tree-shakable. It tracks the runtime configuration as a dependency and refreshes compiled descriptors when the document changes.

`pnpm --filter @dify/openapi-inference test:next` builds disposable Next.js apps sequentially with Turbopack and Webpack. It verifies server transport/context, query-key binding and removal of unused endpoints/schema metadata from client chunks. This production-build test is separate from `test` and `test:repository`; CI runs it with bounded workers and memory.

Use an independent transport when requests need different hosts, credentials, or fetch implementations:

```ts
import { createClient } from '@dify/openapi-inference'
import { api } from './pets.openapi.yaml'

const transport = createClient({
  baseUrl: 'https://example.com/v1',
  headers: { Authorization: 'Bearer …' },
  fetch: globalThis.fetch,
})

await api.pets.byPetId.get(
  { params: { petId: 1 } },
  { client: transport, signal: controller.signal },
)
```

The shared `client` can be configured once for a browser app. Passing an independent transport per call also avoids sharing request-specific credentials in a server process.

## Configure an entire document

Place a `<document filename>.config.ts` module beside an imported specification (for example `console.openapi.config.ts` beside `console.openapi`). It exports a `Context` type for native checking and a default `RuntimeConfig` for execution:

```ts
import type { RuntimeConfig } from '@dify/openapi-inference'
import { createClient } from '@dify/openapi-inference'

export type Context = { silent?: boolean }
const runtime: RuntimeConfig = {
  createClient: (options) =>
    createClient({
      baseUrl: 'https://example.com/console/api',
      // Bind your existing auth/error Fetch adapter here, using options.context.
    }),
  queryKeyPrefix: ['console'],
  onError: (error) => console.error(error),
}
export default runtime
```

The native mapper imports only the context type. Vite and Node bind the configuration to named exports, nested calls and query helpers. The client factory runs per call, receives context and cancellation options, and does not share request-specific credentials. Explicit per-call clients take precedence. Query prefixes apply at every namespace level, including `key()` for cache invalidation. Restart the development server after adding or removing a configuration file; edits to an existing configuration follow normal module HMR.

Expose the entire document through direct ESM re-exports:

```ts
export { api as consoleClient, query as consoleQuery } from './console.openapi'
```

Avoid wrapping the full router in a dynamic factory or assigning its namespaces to exported constants: the latter also retained unused operations in this workspace's bundler. Direct re-exports preserve per-operation pruning. Vite also accepts a `runtime(fileName)` resolver for applications that keep runtime configuration elsewhere; typed contexts come from the adjacent configuration file.

## Bundle behavior

The compiler sees a literal representation of the full schema **in memory**. The browser sees separate ESM namespace modules containing only request paths, methods, serialization settings, and JSON content types. Response schemas, descriptions, examples, and YAML parsing code stay out of the bundle. Build-time conversion is still necessary; “no codegen” here means no separate generation step or generated SDK files on disk.

Both of these remain statically traceable:

```ts
import { api, query } from './pets.openapi.yaml'

api.pets.byPetId.get({ params: { petId: 1 } })
query.pets.byPetId.get.queryOptions({ input: { params: { petId: 1 } } })
```

Measured with this workspace's Vite/Rolldown build, including the shared runtime:

| Entry used               |       JS |    Gzip |
| ------------------------ | -------: | ------: |
| One named operation      |  ~5.0 KB | ~2.1 KB |
| One nested API operation |  ~5.0 KB | ~2.2 KB |
| One nested query helper  | ~11.2 KB | ~3.6 KB |

Tests add **1,000 unused endpoints within the same resource group** and a large description, then assert unchanged output size and absence of unused endpoint markers. JSON-backed and YAML inputs also produce equivalent code.

`createTanstackQueryUtils(api)` is structurally compatible and tested, but passing the entire router to a dynamic factory may retain its operations. Import the prebuilt `query` namespace for per-operation pruning. Dynamic property access, enumeration, spreading or passing whole namespace objects across opaque function boundaries can also prevent pruning. This follows normal ESM tree-shaking rules.

The exported query helpers include `queryOptions`, `queryKey`, `mutationOptions`, and `key()` on both procedures and namespaces. Keys are based on route segments; applications combining multiple API documents with overlapping routes must namespace their query keys explicitly.

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
- External references, URL-encoded forms, nested multipart file dictionaries, advanced serialization and YAML aliases are not implemented. Multipart supports repeated array fields and explicit `application/json` part encoding. Select `contentType: 'multipart/form-data'` when the endpoint also accepts JSON. SSE returns a `ReadableStream<Uint8Array>` without buffering or parsing events. Unsupported request serialization fails explicitly. This is not a complete JSON Schema validator, and response bodies are not runtime-validated.
- These are oRPC-shaped functions using a Fetch transport, not a drop-in replacement for every oRPC Link, interceptor, typed error map or Dify `context` policy. Document configurations can implement context behavior through the transport factory; arbitrary existing query policies and defined-error maps are not imported automatically. Errors expose `response` and `data` via `ApiError`.
- Unresolvable router member collisions are rejected. `key` is reserved as a route segment for query helpers; `api`, `query`, `default` and `then` are reserved operation IDs.
- Vite, Next.js Turbopack and Webpack handle bundling; Node handles direct execution. Other bundlers need an adapter. The compiler's mapper output is used for checking and is not the browser runtime artifact.

References: [TS 7.1 announcement] and [content mapper protocol].

[TS 7.1 announcement]: https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta
[content mapper protocol]: https://github.com/microsoft/typescript-go/pull/4712

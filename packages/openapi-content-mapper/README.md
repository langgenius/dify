# @dify/openapi-content-mapper

Import OpenAPI documents as typed, tree-shakable API calls and TanStack Query helpers using **TypeScript 7.1 Content Mappers**. No generated SDK source or declaration files need to be committed.

**Experimental beta:** the compiler integration targets TypeScript `7.1.0-beta`. The API and compiler protocol may change between prereleases. This package is ESM-only.

## Compatibility

| Environment           | Supported setup                                                        |
| --------------------- | ---------------------------------------------------------------------- |
| Compiler              | TypeScript `7.1.0-beta`, with `--runExternalCode`                      |
| Editor                | TypeScript 7 extension, workspace compiler and content mappers enabled |
| Build/runtime tooling | Node.js 24+                                                            |
| Vite                  | Official Vite 8.3.5; optional peer dependency                          |
| Next.js               | Next.js 16.4.2, Turbopack and Webpack with the loader below            |
| Browser runtime       | Modern Fetch, Headers, FormData, Blob and ReadableStream APIs          |
| Specification         | OpenAPI 3.0/3.1, local JSON Pointer references                         |

## Install and try

After the beta is published:

```sh
npm install @dify/openapi-content-mapper@beta
npm install --save-dev typescript@7.1.0-beta vite@8.3.5
```

Before publication, install a locally packed release candidate with `npm install /path/to/dify-openapi-content-mapper-0.1.0-beta.0.tgz`. See [Development and release] for packaging and verification.

Create `pets.openapi.yaml`:

```yaml
openapi: 3.1.0
info:
  title: Pets
  version: '1'
servers:
  - url: https://api.example.com
paths:
  /pets/{petId}:
    get:
      parameters:
        - name: petId
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: A pet
          content:
            application/json:
              schema:
                type: object
                required: [id, name]
                properties:
                  id:
                    type: integer
                  name:
                    type: string
```

Configure `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true
  },
  "contentMappers": [
    {
      "package": "@dify/openapi-content-mapper",
      "extensions": [".yaml", ".yml", ".openapi"]
    }
  ]
}
```

Configure `vite.config.ts`:

```ts
import { openapi } from '@dify/openapi-content-mapper/vite'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [openapi()] })
```

Then call the API:

```ts
import { api, query } from './pets.openapi.yaml'

const pet = await api.pets.byPetId.get({ params: { petId: 1 } })
pet.name // string

const options = query.pets.byPetId.get.queryOptions({
  input: { params: { petId: 1 } },
})
// Pass options to useQuery(), queryClient.fetchQuery(), etc.
```

Run `npx tsc --runExternalCode --noEmit`. The compiler supplies types; the Vite plugin supplies runtime modules. Both are required for this setup.

For VS Code, install Microsoft's TypeScript 7 extension (`TypeScriptTeam.native-preview`), select the workspace TypeScript 7.1 compiler, trust the workspace and enable content mappers. Open a consuming `.ts` file so the language server discovers its config.

### Compiler cache

Successful mapper results are cached in the current user's temporary directory under `dify-openapi-content-mapper-<user>`, retaining up to 64 documents. Content, implementation and configuration-sidecar presence changes invalidate the cache; sidecar contents are checked by TypeScript. The cache can be deleted safely. Corrupt entries or unavailable storage fall back to transformation, and no cache files are shipped to the browser.

### Existing JSON files

The TS 7.1 beta cannot register mappers for built-in `.json` imports, including `.openapi.json`. Store JSON in a file ending in `.openapi`, or symlink an existing JSON file:

```sh
ln -s pets.json pets.openapi
```

Import `./pets.openapi`. On platforms where symlinks are unavailable, use a regular `.openapi` file containing JSON. Vite and Node preserve the logical extension of symlinks.

## API and transport

Documents export only `api` and `query`; operation IDs are not exports. `/pets/{petId}` becomes `pets.byPetId`, hyphenated segments become camelCase and HTTP methods are leaf functions. Colon actions such as `/chat:run` become `chat.run`. `key` is reserved as a route segment for query helpers. Unresolvable member collisions fail during compilation.

An operation may set `x-client-path` to an explicit array such as `["enterprise", "access", "getEnvironmentApi"]` to preserve an existing public API. This replaces its entire client member path, including the method leaf, and also determines its query key. HTTP methods, URLs and per-operation sidecar keys still use the OpenAPI operation. Colliding or reserved member names fail during compilation.

The first argument contains `params`, `query`, `headers`, `cookie`, `body` and `contentType` as declared by the specification. The optional second argument accepts `client`, `signal`, additional transport `headers`, `credentials` and document `context`.

```ts
import { createClient } from '@dify/openapi-content-mapper'
import { api } from './pets.openapi.yaml'

const transport = createClient({
  baseUrl: 'https://api.example.com/v1',
  headers: { Authorization: 'Bearer …' },
  fetch: globalThis.fetch,
})

await api.pets.byPetId.get(
  { params: { petId: 1 } },
  { client: transport, signal: AbortSignal.timeout(5000) },
)
```

A client override takes precedence over document configuration. Otherwise the document's `servers` URL is used; relative server URLs require a browser origin or an explicit absolute `baseUrl` in Node. The exported shared `client` also supports `setConfig()`, but request-specific credentials should use independent clients.

Successful calls return decoded response data. Non-2xx responses throw `ApiError` with `response` and decoded `data`; network and cancellation failures propagate. Responses are not runtime-validated and schema defaults are not filled in. JSON binary-formatted fields remain strings; binary response media return Blob objects; SSE returns a raw `ReadableStream<Uint8Array>`.

With one request media type, `contentType` can be omitted. With multiple media types, only `application/json` is implicit; other alternatives require an explicit matching `contentType`. Multipart accepts flat objects with scalar, Blob/File or repeated array fields, plus explicit JSON part encodings. Fetch supplies its boundary. Optional request bodies may be omitted entirely.

### Document configuration

Place `pets.openapi.yaml.config.ts` next to `pets.openapi.yaml`:

```ts
import type { RuntimeConfig } from '@dify/openapi-content-mapper'
import { createClient } from '@dify/openapi-content-mapper'

export type Context = { token?: string }

const runtime: RuntimeConfig<Context> = {
  createClient: ({ context }) =>
    createClient({
      baseUrl: 'https://api.example.com',
      headers: context?.token ? { Authorization: `Bearer ${context.token}` } : {},
    }),
  queryKeyPrefix: ['pets'],
}
export default runtime
```

Both `api` and `query` infer `Context`. The factory runs per call. An optional `onError(error)` hook observes failures; avoid throwing from it if you want the original error to propagate. Restart the development server after adding or removing a sidecar; edits to existing files follow normal HMR.

### Per-operation query defaults and typed errors

Export defaults from `<document>.queries.ts` under the exact `METHOD /path` name:

```ts
// pets.openapi.queries.ts
import type { experimental_RouterUtilsDefaults } from '@orpc/tanstack-query'
import type { api } from './pets.openapi'

const list: experimental_RouterUtilsDefaults<typeof api.pets.get> = {
  queryOptions: { staleTime: 30_000, retry: false },
}
export { list as 'GET /pets' }
```

Defaults use oRPC's query helpers, including mutation callbacks and infinite queries.
Caller options override defaults, including callbacks; they are not composed. Return
cache invalidation promises from mutation callbacks when the mutation must remain
pending until refresh completes. Keep policy dependencies independent of a complete
runtime router: importing or enumerating a whole client can retain unrelated operations.

An optional `<document>.errors.ts` exports oRPC error maps with the same names:

```ts
// pets.openapi.errors.ts
import type { ErrorMap } from '@orpc/contract'
import { conflictSchema } from './error-schemas'

const conflicts = {
  CONFLICT: { status: 409, data: conflictSchema },
} satisfies ErrorMap
export { conflicts as 'POST /pets' }
```

The `data` validator can use any Standard Schema implementation. API calls and query
helpers infer the map's error union, so `safe` and `isDefinedError` narrow the code and
validated payload. HTTP status and schema validation must match before an error is
marked defined. Network/cancellation failures keep their identity. Bare HTTP errors
with a `code` envelope are converted to `ORPCError` when an error map is configured;
existing transport `ORPCError`s are preserved and validated.

Each operation imports its own defaults and lazy error module. Error validators load
on HTTP failure, and unused maps/defaults can be removed by the bundler. A validator
chunk that fails to load leaves the original HTTP error undefined. Serve the emitted
chunks together with the entry bundle. Keep validators free of module-level side
effects; schema construction must be removable when its map is unused. Named
re-exports and `export *` are supported; sidecars are inspected without executing them.
Vite and Next track sidecar changes; Node imports follow normal module caching.

### Query helpers and bundles

Import `query` directly for `queryOptions`, `mutationOptions`, `queryKey` and namespace `key()` helpers. Give each document a distinct `queryKeyPrefix` when routes overlap. For an application-level entry, preserve direct ESM re-exports:

```ts
export { api as apiClient, query as apiQuery } from './pets.openapi.yaml'
```

Static calls retain only used operations. Dynamic indexing, enumeration or passing whole namespaces to opaque functions can retain other operations. The runtime does not bundle response schemas or the YAML parser.

### Comparison with oRPC

This package consumes OpenAPI directly and prunes statically used operations while keeping oRPC-shaped calls and reusing its TanStack Query helpers. It requires the TS 7.1 beta toolchain. Per-operation defaults and error maps are opt-in; arbitrary oRPC Links and interceptors still require an application transport adapter.

## Other runtime adapters

### Node.js

```sh
node --import @dify/openapi-content-mapper/register app.ts
```

The hook loads YAML and `.openapi` files; Node's native TypeScript support loads configuration sidecars. Native execution does not replace the separate type check.

### Next.js

For `pets.openapi` linked to `pets.json`, configure `next.config.mjs`:

```js
const loader = {
  loader: '@dify/openapi-content-mapper/loader',
  // Optional; relative to the resolved specification, not this config file.
  options: {
    runtime: './pets.openapi.config.ts',
    sidecars: './pets.openapi',
  },
}

export default {
  turbopack: {
    rules: {
      '*pets.json': { loaders: [loader], as: '*.js' },
      '*openapi-namespace.js': { loaders: [loader], as: '*.js' },
    },
  },
  webpack(config) {
    config.module.rules.push({
      test: /(?:pets\.json|openapi-namespace\.js)$/,
      type: 'javascript/auto',
      use: [loader],
    })
    return config
  },
}
```

Merge these rules into existing configuration. Match the resolved JSON filename for symlinks; match the actual `.openapi` or YAML filename for regular files. Apply the loader to `openapi-namespace.js` too. Omit `options.runtime` to discover `<resolved specification filename>.config.ts`. Set `options.sidecars` to the logical document path (relative to the resolved specification) when its `.queries.ts` and `.errors.ts` files live beside a symlink. Without this option they are discovered beside the resolved specification. Next.js runtime options do not change compiler context discovery, which uses the imported document's adjacent sidecar.

The loader uses a tiny shared resource for child namespaces so the full specification is not copied into every bundler module. Adapters use internal subpaths (`runtime`, `query-runtime`, `namespace`, `mapper`); application code should use the root, `vite`, `loader` and `register` entry points.

## Limitations

External references, Swagger 2, URL-encoded forms, advanced parameter serialization, nested multipart file dictionaries and YAML aliases are unsupported. Inline schema inference has a 24-step fallback; local referenced schemas use recursive aliases. Unsupported request serialization fails explicitly. Missing or inaccurate OpenAPI declarations cannot be repaired by inference.

Existing oRPC Links and interceptors require explicit transport adapters; query policies and typed errors require the per-operation sidecars above. Browser Fetch governs cookie headers. Supported schema features include required/optional properties, enum/const, arrays and dictionaries, `oneOf`, `anyOf`, `allOf`, and nullable types.

## Development and release

From the repository root, build and verify the package:

```sh
pnpm --filter @dify/openapi-content-mapper build
pnpm --filter @dify/openapi-content-mapper type-check
pnpm --filter @dify/openapi-content-mapper test
OPENAPI_PACKAGE_TARBALL=/tmp/dify-openapi-content-mapper.tgz \
  pnpm --filter @dify/openapi-content-mapper test:package
```

The independent package check packs and installs the tarball outside the monorepo, then exercises its declarations, compiler mapper, Node runtime and official Vite adapter. It requires network access and performs no publication. Full application and Next.js builds run in CI.

Update the package version and [CHANGELOG] together before release. Use pnpm to pack: it resolves workspace `catalog:` dependencies, while `prepack` cleans and rebuilds `dist`. The package contains compiled ESM/declarations, README, changelog and license; consumers do not build it during installation.

A maintainer with npm access can publish the same verified artifact after confirming its name, version, license and registry:

```sh
npm publish /tmp/dify-openapi-content-mapper.tgz --access public --tag beta
```

The default tag is `beta`. Publication is manual; merging changes or creating a Dify release does not publish the package. Verify new compiler versions before changing the supported TS 7.1 beta protocol.

## License

This package retains the repository's modified Apache 2.0 terms, including its additional conditions. See [LICENSE]; it is not licensed under unmodified Apache-2.0 or MIT.

[CHANGELOG]: CHANGELOG.md
[Development and release]: #development-and-release
[LICENSE]: LICENSE

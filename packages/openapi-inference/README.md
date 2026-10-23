# @dify/openapi-inference

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
npm install @dify/openapi-inference@beta
npm install --save-dev typescript@7.1.0-beta vite@8.3.5
```

Before publication, install a locally packed release candidate with `npm install /path/to/dify-openapi-inference-0.1.0-beta.0.tgz`. See [release preparation] for the packaging and independent-consumer checks.

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
      "package": "@dify/openapi-inference",
      "extensions": [".yaml", ".yml", ".openapi"]
    }
  ]
}
```

Configure `vite.config.ts`:

```ts
import { openapi } from '@dify/openapi-inference/vite'
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

### Existing JSON files

The TS 7.1 beta cannot register mappers for built-in `.json` imports, including `.openapi.json`. Store JSON in a file ending in `.openapi`, or symlink an existing JSON file:

```sh
ln -s pets.json pets.openapi
```

Import `./pets.openapi`. On platforms where symlinks are unavailable, use a regular `.openapi` file containing JSON. Vite and Node preserve the logical extension of symlinks.

## API and transport

Documents export only `api` and `query`; operation IDs are not exports. `/pets/{petId}` becomes `pets.byPetId`, hyphenated segments become camelCase and HTTP methods are leaf functions. Colon actions such as `/chat:run` become `chat.run`. Unresolvable member collisions fail during compilation.

The first argument contains `params`, `query`, `headers`, `cookie`, `body` and `contentType` as declared by the specification. The optional second argument accepts `client`, `signal`, additional transport `headers`, `credentials` and document `context`.

```ts
import { createClient } from '@dify/openapi-inference'
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
import type { RuntimeConfig } from '@dify/openapi-inference'
import { createClient } from '@dify/openapi-inference'

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

### Query helpers and bundles

Import `query` directly for `queryOptions`, `mutationOptions`, `queryKey` and namespace `key()` helpers. Give each document a distinct `queryKeyPrefix` when routes overlap. For an application-level entry, preserve direct ESM re-exports:

```ts
export { api as apiClient, query as apiQuery } from './pets.openapi.yaml'
```

Static calls retain only used operations. Dynamic indexing, enumeration or passing whole namespaces to opaque functions can retain other operations. The runtime does not bundle response schemas or the YAML parser. Tests verify that adding 1,000 unused operations does not increase a static consumer's bundle.

### Comparison with oRPC

This package consumes OpenAPI directly and prunes statically used operations while keeping oRPC-shaped calls and reusing its TanStack Query helpers. It requires the TS 7.1 beta toolchain and does not replace oRPC's full Link, interceptor or defined-error capabilities.

In an isolated KnowledgeFS metadata benchmark, API-only output was 2.38 KB gzip, compared with 57.40 KB for the current generated oRPC contract group and 10.08 KB for a pre-minified single-operation oRPC contract. oRPC supports contract minification; these results do not imply that oRPC cannot tree-shake. They do not measure Dify's page load. See the [oRPC comparison] for all measurements, methodology, behavior differences and tradeoffs.

## Other runtime adapters

### Node.js

```sh
node --import @dify/openapi-inference/register app.ts
```

The hook loads YAML and `.openapi` files; Node's native TypeScript support loads configuration sidecars. Native execution does not replace the separate type check.

### Next.js

For `pets.openapi` linked to `pets.json`, configure `next.config.mjs`:

```js
const loader = {
  loader: '@dify/openapi-inference/loader',
  // Optional; relative to the resolved specification, not this config file.
  options: { runtime: './pets.openapi.config.ts' },
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

Merge these rules into existing configuration. Match the resolved JSON filename for symlinks; match the actual `.openapi` or YAML filename for regular files. Apply the loader to `openapi-namespace.js` too. Omit `options.runtime` to discover `<resolved specification filename>.config.ts`. Next.js runtime options do not change compiler context discovery, which uses the imported document's adjacent sidecar.

The loader uses a tiny shared resource for child namespaces so the full specification is not copied into every bundler module. Adapters use internal subpaths (`runtime`, `query-runtime`, `namespace`, `mapper`); application code should use the root, `vite`, `loader` and `register` entry points.

## Limitations

External references, Swagger 2, URL-encoded forms, advanced parameter serialization, nested multipart file dictionaries and YAML aliases are unsupported. Inline schema inference has a 24-step fallback; local referenced schemas use recursive aliases. Unsupported request serialization fails explicitly. Missing or inaccurate OpenAPI declarations cannot be repaired by inference.

This is not a drop-in replacement for all oRPC Links, interceptors, typed error maps or application-specific query policies. Browser Fetch governs cookie headers. For the complete supported scope and Dify-specific verification, see the [repository guide].

## Development and release

See [release preparation] and [CHANGELOG]. The independent package check installs a real tarball outside this monorepo and exercises its types, Node runtime and official Vite adapter. It performs no registry publication.

## License

This package retains the repository's modified Apache 2.0 terms, including its additional conditions. See [LICENSE]; it is not licensed under unmodified Apache-2.0 or MIT.

[CHANGELOG]: CHANGELOG.md
[LICENSE]: LICENSE
[oRPC comparison]: docs/orpc-comparison.md
[release preparation]: docs/releasing.md
[repository guide]: https://github.com/langgenius/dify/blob/main/packages/openapi-inference/docs/repository.md

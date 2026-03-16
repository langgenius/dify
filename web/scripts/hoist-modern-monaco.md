# `hoist-modern-monaco.ts`

This script does more than just download and copy assets. It also applies a few targeted customizations so the hoisted `modern-monaco` setup works reliably in Dify.

All generated assets are written under:

```text
public/hoisted-modern-monaco/
```

That directory is expected to stay generated-only and is git-ignored.

It also generates:

```text
app/components/base/modern-monaco/hoisted-config.ts
```

That module is the runtime source of truth for:

- `tm-themes` version
- `tm-grammars` version
- the hoisted theme list
- the hoisted language list
- the local `modern-monaco` import map

## Customizations

### 1. Only download the Shiki assets Dify actually uses

By default, the script downloads these themes and grammars:

- themes: `light-plus`, `dark-plus`
- languages: `javascript`, `json`, `python`

It also parses embedded grammar dependencies from `modern-monaco/dist/shiki.mjs` and pulls those in as well.
At the moment, `javascript` also pulls in `html` and `css`.

Why:

- Avoid copying the full `tm-themes` and `tm-grammars` sets into `public`
- Keep the current Dify editor use cases fully local
- Keep the generated runtime config aligned with the actual hoisted assets

### 2. Rewrite the bare `typescript` import in the TypeScript worker

In the npm `dist` build of `modern-monaco`, `lsp/typescript/worker.mjs` still contains:

```js
import ts from 'typescript'
```

That bare import does not resolve when the file is executed directly from `public/hoisted-modern-monaco/modern-monaco/...` in the browser.
The script downloads the TypeScript ESM build from `esm.sh`, stores it locally, and rewrites the import to a relative path pointing to:

```text
public/hoisted-modern-monaco/typescript@<version>/es2022/typescript.mjs
```

Why:

- Make the hoisted TypeScript worker runnable in the browser

### 3. Force the TypeScript worker to always use Blob bootstrap

In the original `modern-monaco` `lsp/typescript/setup.mjs`:

- cross-origin worker URLs use Blob bootstrap
- same-origin worker URLs use `new Worker(workerUrl)`

Once the files are hoisted to same-origin `/hoisted-modern-monaco/modern-monaco/...`, the runtime falls into the second branch.
In Dify, that caused the completion pipeline to break, with the TypeScript worker failing to resolve anonymous in-memory files.

The script rewrites that logic to always use:

```js
const worker = new Worker(
  URL.createObjectURL(new Blob([`import "${workerUrl.href}"`], { type: 'application/javascript' })),
  { type: 'module', name: 'typescript-worker' },
)
```

Why:

- Match the effective worker startup behavior used in the `esm.sh` setup
- Restore completion behavior after local hoisting

## What this script does not do

- It does not change `modern-monaco` feature behavior
- It does not register any custom LSP provider
- It does not mirror the full `esm.sh` dependency graph

The current strategy is still:

- hoist the main `modern-monaco` modules and built-in LSP locally
- hoist Shiki themes and grammars as local JSON assets
- hoist TypeScript runtime as a local ESM file

## Things to re-check on upgrade

When upgrading `modern-monaco` or `typescript`, re-check these points first:

- whether `lsp/typescript/worker.mjs` still contains a bare `import ts from "typescript"`
- whether the structure of `lsp/typescript/setup.mjs#createWebWorker()` has changed
- whether the `tm-themes` and `tm-grammars` version extraction from `dist/shiki.mjs` still matches
- whether Dify's editor theme/language usage has changed

If any of those change, the patch logic in this script may need to be updated as well.

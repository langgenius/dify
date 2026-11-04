/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Integration tests exercise the built package in native Node, including its module hooks. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'
import { parse, stringify } from 'yaml'
import { openapi } from '../dist/tooling/vite.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')
const fixture = parse(readFileSync(join(root, 'examples/petstore/pets.openapi.yaml'), 'utf8'))

test('sidecar star re-exports use Vite aliases and TypeScript extension resolution', async () => {
  const dir = mkdtempSync(join(root, 'test/.sidecar-resolve-'))
  try {
    writeFileSync(
      join(dir, 'api.openapi'),
      JSON.stringify({
        openapi: '3.1.0',
        paths: { '/pets': { get: { responses: { 200: { description: 'OK' } } } } },
      }),
    )
    writeFileSync(join(dir, 'api.openapi.queries.ts'), "export * from './defaults.js';")
    writeFileSync(join(dir, 'defaults.ts'), "export * from '@policies';")
    writeFileSync(
      join(dir, 'policies.ts'),
      "const policy = {queryOptions: {staleTime: 42}}; export {policy as 'GET /pets'};",
    )
    writeFileSync(join(dir, 'api.openapi.errors.ts'), "export * from './errors.js';")
    writeFileSync(
      join(dir, 'errors.ts'),
      "const errors = {CONFLICT: {status: 409}}; export {errors as 'GET /pets'};",
    )
    writeFileSync(
      join(dir, 'entry.ts'),
      `
import {createClient} from '@dify/openapi-content-mapper';
import {api, query} from './api.openapi';
export const staleTime = query.pets.get.queryOptions().staleTime;
export async function fail() {
  const client = createClient({baseUrl: 'https://example.test', fetch: async () => Response.json({code: 'CONFLICT'}, {status: 409})});
  return api.pets.get(undefined, {client}).catch(error => ({code: error.code, defined: error.defined}));
}`,
    )
    await build({
      configFile: false,
      root: dir,
      logLevel: 'silent',
      plugins: [openapi()],
      resolve: { alias: { '@policies': join(dir, 'policies.ts') } },
      build: { lib: { entry: join(dir, 'entry.ts'), formats: ['es'], fileName: () => 'entry.js' } },
    })
    const result = await import(pathToFileURL(join(dir, 'dist/entry.js')).href)
    assert.equal(result.staleTime, 42)
    assert.deepEqual(await result.fail(), { code: 'CONFLICT', defined: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const mode of ['api', 'query'])
  test(`${mode}: error chunks are shared per document and stay lazy with distinct maps`, async () => {
    const dir = mkdtempSync(join(root, 'test/.shared-errors-'))
    const loaded = `error-sidecars:${dir}`
    globalThis[loaded] = []
    try {
      writeFileSync(join(dir, 'shared.ts'), `export const errorCode = index => 'ERROR_' + index;`)
      for (const document of ['console', 'marketplace']) {
        const paths = {}
        const maps = [
          `import { errorCode } from './shared'; globalThis[${JSON.stringify(loaded)}].push('${document}');`,
        ]
        for (let index = 0; index < 20; index++) {
          paths[`/operation${index}`] = { get: { responses: { 200: { description: 'OK' } } } }
          maps.push(
            `const map${index} = { [errorCode(${index})]: { status: 409 } }; export { map${index} as 'GET /operation${index}' };`,
          )
        }
        writeFileSync(join(dir, `${document}.openapi`), JSON.stringify({ openapi: '3.1.0', paths }))
        writeFileSync(join(dir, `${document}.openapi.errors.ts`), maps.join('\n'))
      }
      writeFileSync(
        join(dir, 'entry.ts'),
        `
import { createClient } from '@dify/openapi-content-mapper';
export { errorCode } from './shared';
import { ${mode} as console } from './console.openapi';
import { ${mode} as marketplace } from './marketplace.openapi';
export async function run(document, index, code) {
  const client = createClient({ baseUrl: 'https://example.test', fetch: async () =>
    code ? Response.json({ code }, { status: 409 }) : Response.json({ ok: true }) });
  const operation = (document === 'console' ? console : marketplace)['operation' + index].get;
  try {
    return await ${mode === 'api' ? 'operation(undefined, { client })' : 'operation.call(undefined, { client })'};
  } catch (error) { return { code: error.code, defined: error.defined }; }
}
`,
      )
      const result = await build({
        configFile: false,
        root: dir,
        logLevel: 'silent',
        plugins: [openapi()],
        build: {
          minify: true,
          rolldownOptions: { preserveEntrySignatures: 'allow-extension' },
          lib: { entry: join(dir, 'entry.ts'), formats: ['es'], fileName: 'entry' },
        },
      })
      const chunks = (Array.isArray(result) ? result : [result])
        .flatMap((output) => output.output)
        .filter((file) => file.type === 'chunk')
      const errorChunks = chunks.filter((chunk) =>
        Object.keys(chunk.modules).some((id) => id.includes('?openapi-errors=')),
      )
      assert.equal(errorChunks.length, 2, 'Forty operations need only one error chunk per document')
      for (const chunk of errorChunks) {
        const documents = new Set(
          Object.keys(chunk.modules)
            .filter((id) => id.includes('?openapi-errors='))
            .map((id) => id.split('?')[0]),
        )
        assert.equal(documents.size, 1, 'Independent documents must not share error chunks')
      }
      const entry = chunks.find((chunk) => chunk.isEntry)
      const initial = new Set()
      const visit = (file) => {
        if (initial.has(file)) return
        initial.add(file)
        chunks.find((chunk) => chunk.fileName === file)?.imports.forEach(visit)
      }
      visit(entry.fileName)
      assert(errorChunks.every((chunk) => !initial.has(chunk.fileName)))
      const { run } = await import(pathToFileURL(join(dir, 'dist', entry.fileName)).href)
      assert.deepEqual(globalThis[loaded], [])
      assert.deepEqual(await run('console', 0), { ok: true })
      assert.deepEqual(globalThis[loaded], [], 'Success must not load error validators')
      assert.deepEqual(await run('console', 0, 'ERROR_0'), { code: 'ERROR_0', defined: true })
      assert.deepEqual(await run('console', 1, 'ERROR_0'), { code: 'ERROR_0', defined: false })
      assert.deepEqual(await run('console', 1, 'ERROR_1'), { code: 'ERROR_1', defined: true })
      assert.deepEqual(globalThis[loaded], ['console'])
      assert.deepEqual(await run('marketplace', 0, 'ERROR_0'), { code: 'ERROR_0', defined: true })
      assert.deepEqual(globalThis[loaded], ['console', 'marketplace'])
    } finally {
      delete globalThis[loaded]
      rmSync(dir, { recursive: true, force: true })
    }
  })

for (const mode of ['nested', 'query'])
  test(`${mode}: Vite browser bundle drops 1,000 unused operations and all schema metadata`, async (t) => {
    const dir = mkdtempSync(join(root, 'test/.bundle-'))
    try {
      async function bundle(spec, extension = 'yaml') {
        const file = `api.${extension}`
        if (extension === 'openapi') {
          writeFileSync(join(dir, 'original.json'), JSON.stringify(spec))
          symlinkSync('original.json', join(dir, file))
        } else writeFileSync(join(dir, file), stringify(spec))
        writeFileSync(
          join(dir, 'entry.ts'),
          mode === 'nested'
            ? `import { api } from './${file}'; export const getPet = api.pets.byPetId.get;`
            : `import { query } from './${file}'; export const getPet = query.pets.byPetId.get.queryOptions;`,
        )
        const result = await build({
          configFile: false,
          root: dir,
          logLevel: 'silent',
          plugins: [openapi()],
          build: {
            write: false,
            minify: true,
            lib: { entry: join(dir, 'entry.ts'), formats: ['es'] },
          },
        })
        return (Array.isArray(result) ? result : [result])
          .flatMap((output) => output.output)
          .filter((file) => file.type === 'chunk')
          .map((file) => file.code)
          .join('\n')
      }
      const small = await bundle(fixture)
      const large = structuredClone(fixture)
      large.info.description = 'SCHEMA_METADATA_MUST_DISAPPEAR'.repeat(2000)
      for (let i = 0; i < 1000; i++)
        large.paths[`/pets/UNUSED_ENDPOINT_${i}`] = {
          get: {
            operationId: `unused${i}`,
            responses: {
              200: {
                description: 'unused',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            },
          },
        }
      const output = await bundle(large)
      assert(!output.includes('UNUSED_ENDPOINT_'))
      assert(!output.includes('SCHEMA_METADATA_MUST_DISAPPEAR'))
      assert(!output.includes('components'))
      assert(!output.includes('YAMLParseError'))
      assert(!output.includes('parseDocument'))
      assert(output.includes('/pets/{petId}'))
      assert.equal(
        output.length,
        small.length,
        'Adding unused operations must not increase the bundle',
      )
      assert(Buffer.byteLength(output) < 30000, `Unexpected runtime size: ${output.length}`)
      const json = await bundle(fixture, 'openapi')
      const stripBundleComments = (code) => code.replace(/^\/\/.*$/gm, '')
      assert.equal(
        stripBundleComments(json),
        stripBundleComments(small),
        'JSON and YAML must produce equivalent runtime code',
      )
      t.diagnostic(
        `One operation: ${Buffer.byteLength(output)} bytes, ${gzipSync(output).length} bytes gzip; unchanged with 1,000 extra operations`,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

for (const mode of ['api', 'query'])
  test(`${mode}: unused operation policies and error validators are removed`, async () => {
    const dir = mkdtempSync(join(root, 'test/.policies-bundle-'))
    try {
      async function bundle(count) {
        const spec = structuredClone(fixture)
        const defaults = [
          `const used = { queryOptions: { staleTime: 1234 } }; export { used as 'GET /pets/{petId}' };`,
        ]
        const errors = [
          `const used = { NOT_FOUND: { status: 404 } }; export { used as 'GET /pets/{petId}' };`,
        ]
        for (let i = 0; i < count; i++) {
          const path = `/UNUSED_OPERATION_${i}`
          spec.paths[path] = { get: { responses: { 200: { description: 'OK' } } } }
          defaults.push(
            `const policy${i} = { queryOptions: { meta: { marker: 'UNUSED_POLICY_${i}' } } }; export { policy${i} as ${JSON.stringify(`GET ${path}`)} };`,
          )
          errors.push(
            `const errors${i} = { UNUSED: { status: 400, message: 'UNUSED_VALIDATOR_${i}' } }; export { errors${i} as ${JSON.stringify(`GET ${path}`)} };`,
          )
        }
        writeFileSync(join(dir, 'api.openapi'), JSON.stringify(spec))
        writeFileSync(join(dir, 'api.openapi.queries.ts'), defaults.join('\n'))
        writeFileSync(join(dir, 'api.openapi.errors.ts'), errors.join('\n'))
        writeFileSync(
          join(dir, 'entry.ts'),
          `import { ${mode} } from './api.openapi'; export const operation = ${mode}.pets.byPetId.get${mode === 'query' ? '.queryOptions' : ''};`,
        )
        const result = await build({
          configFile: false,
          root: dir,
          logLevel: 'silent',
          plugins: [openapi()],
          build: {
            write: false,
            minify: true,
            rolldownOptions: { preserveEntrySignatures: 'allow-extension' },
            lib: { entry: join(dir, 'entry.ts'), formats: ['es'] },
          },
        })
        return (Array.isArray(result) ? result : [result])
          .flatMap((r) => r.output)
          .filter((f) => f.type === 'chunk')
          .map((f) => f.code)
          .join('\n')
      }
      const small = await bundle(0)
      const large = await bundle(1000)
      assert.equal(large, small)
      assert(!large.includes('UNUSED_'))
      if (mode === 'query') assert(large.includes('1234'))
      else assert(!large.includes('1234'), 'API calls do not retain query defaults')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

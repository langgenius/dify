/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Integration tests exercise the built package in native Node, including its module hooks. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'
import { parse, stringify } from 'yaml'
import { openapi } from '../dist/tooling/vite.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')
const fixture = parse(readFileSync(join(root, 'examples/petstore/pets.openapi.yaml'), 'utf8'))

for (const mode of ['named', 'nested', 'query'])
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
          mode === 'named'
            ? `import { getPet } from './${file}'; export { getPet };`
            : mode === 'nested'
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

/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Verify the production integration with the built mapper and bundler. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'
import { openapi } from '../dist/tooling/vite.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const repository = resolve(import.meta.dirname, '../../..')
const web = join(repository, 'web')
const entry = join(web, 'service/knowledge-fs/metadata.ts')
const specFile = join(repository, 'packages/contracts/openapi/console-client-openapi.json')

test('the production metadata integration prunes every unused console operation', async (t) => {
  const directory = await mkdtemp(join(import.meta.dirname, '.console-bundle-'))
  try {
    const spec = JSON.parse(await readFile(specFile, 'utf8'))
    const path = '/knowledge-fs/spaces/{control_space_id}/metadata'
    const reduced = join(directory, 'reduced.openapi')
    await writeFile(
      reduced,
      JSON.stringify({
        ...spec,
        paths: {
          [path]: { ...spec.paths[path], post: undefined, patch: undefined, delete: undefined },
        },
      }),
    )
    for (const kind of ['queries', 'errors']) {
      await writeFile(
        `${reduced}.${kind}.ts`,
        `export * from ${JSON.stringify(join(web, `service/console/console.openapi.${kind}.ts`))};`,
      )
    }
    async function bundle(useReduced) {
      const result = await build({
        configFile: false,
        root: web,
        resolve: { alias: { '@': web } },
        logLevel: 'silent',
        plugins: [
          ...(useReduced
            ? [
                {
                  name: 'one-operation-control',
                  enforce: 'pre',
                  resolveId(source) {
                    if (source === './console.openapi') return reduced
                  },
                },
              ]
            : []),
          openapi({ runtime: () => join(web, 'service/console/console.openapi.config.ts') }),
        ],
        build: {
          write: false,
          minify: true,
          lib: { entry, formats: ['es'] },
          // Shared application auth/error code is the same for both builds.
          rollupOptions: {
            output: { chunkFileNames: 'error-[hash].js' },
            external: [join(web, 'service/console/console.openapi.config.ts')],
          },
        },
      })
      if (!useReduced) {
        const chunks = (Array.isArray(result) ? result : [result])
          .flatMap((item) => item.output)
          .filter((file) => file.type === 'chunk')
        const initial = chunks
          .filter((file) => file.isEntry)
          .map((file) => file.code)
          .join('\n')
        const deferred = chunks
          .filter((file) => !file.isEntry)
          .map((file) => file.code)
          .join('\n')
        assert(
          !initial.includes('knowledge_fs_access_denied'),
          'Validators must load only when a request fails',
        )
        t.diagnostic(
          `Metadata entry: ${gzipSync(initial).length} gzip; deferred error validation: ${gzipSync(deferred).length} gzip.`,
        )
      }
      return (Array.isArray(result) ? result : [result])
        .flatMap((item) => item.output)
        .filter((item) => item.type === 'chunk')
        .map((item) => item.code)
        .join('\n')
    }
    const full = await bundle(false)
    const single = await bundle(true)
    assert.equal(full.replace(/^\/\/.*$/gm, ''), single.replace(/^\/\/.*$/gm, ''))
    assert(full.includes('/knowledge-fs/spaces/'))
    for (const unused of [
      '/files/upload',
      '/datasets',
      '/chat-messages',
      'parseDocument',
      'draft_workflow_not_sync',
      'environment_deployments',
      'zKnowledgeFsSpaceResponse',
    ])
      assert(!full.includes(unused), `Unused code retained: ${unused}`)
    t.diagnostic(
      `Metadata integration: ${Buffer.byteLength(full)} bytes JS, ${gzipSync(full).length} gzip; shared app transport external.`,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

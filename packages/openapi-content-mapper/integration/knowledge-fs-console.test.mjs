/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Verify standalone Console imports with the built mapper and bundler. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'
import { loadConsoleDocument } from '../../contracts/scripts/compose-console-openapi.mjs'
import { openapi } from '../dist/tooling/vite.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const repository = resolve(import.meta.dirname, '../../..')

test('a standalone metadata consumer prunes every unused console operation', async (t) => {
  const directory = await mkdtemp(join(import.meta.dirname, '.console-bundle-'))
  try {
    const spec = loadConsoleDocument()
    const path = '/knowledge-fs/spaces/{control_space_id}/metadata'
    const fullSpec = join(directory, 'console.openapi')
    const entry = join(directory, 'consumer.ts')
    await writeFile(fullSpec, JSON.stringify(spec))
    await writeFile(
      entry,
      `import { api, query } from './console.openapi';
export const loadMetadata = (input) => api.knowledgeFs.spaces.byControlSpaceId.metadata.get(input);
export const metadataOptions = (input) => query.knowledgeFs.spaces.byControlSpaceId.metadata.get.queryOptions({ input });
`,
    )
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
    for (const document of [fullSpec, reduced]) {
      await writeFile(
        `${document}.errors.ts`,
        `export * from ${JSON.stringify(join(repository, 'packages/contracts/generated/api/console/errors.gen.ts'))};`,
      )
      await writeFile(
        `${document}.queries.ts`,
        `const defaults = { queryOptions: { retry: false, staleTime: 30000 } };
export { defaults as 'GET ${path}' };`,
      )
    }
    async function bundle(useReduced) {
      const result = await build({
        configFile: false,
        root: directory,
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
          openapi(),
        ],
        build: {
          write: false,
          minify: true,
          lib: { entry, formats: ['es'] },
          rollupOptions: {
            output: { chunkFileNames: 'error-[hash].js' },
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
      `Standalone metadata consumer: ${Buffer.byteLength(full)} bytes JS, ${gzipSync(full).length} gzip, including the SDK transport.`,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

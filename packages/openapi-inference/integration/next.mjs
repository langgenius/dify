/* oxlint-disable vitest/no-import-node-test -- Exercise the real Next builders in disposable apps. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
/* oxlint-enable vitest/no-import-node-test */

const repository = resolve(import.meta.dirname, '../../..')
const web = join(repository, 'web')
const next = join(web, 'node_modules/next/dist/bin/next')

async function javascript(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const file = join(directory, entry.name)
        if (entry.isDirectory()) return javascript(file)
        return entry.name.endsWith('.js') ? readFile(file, 'utf8') : ''
      }),
    )
  ).join('\n')
}

for (const bundler of ['turbopack', 'webpack']) {
  test(`Next ${bundler}: JSON symlink imports bind transport and prune unused operations`, async () => {
    const dir = await mkdtemp(join(web, '.openapi-next-'))
    try {
      await mkdir(join(dir, 'app'))
      await writeFile(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
      await writeFile(
        join(dir, 'next.config.mjs'),
        `
const loader = { loader: '@dify/openapi-inference/loader', options: { runtime: './runtime.js' } };
export default {
  experimental: { cpus: 2 },
  turbopack: { root: ${JSON.stringify(repository)}, rules: { '*spec.json': { loaders: [loader], as: '*.js' } } },
  webpack(config) { config.module.rules.push({ test: /spec\\.json$/, type: 'javascript/auto', use: [loader] }); return config; },
};
`,
      )
      await writeFile(
        join(dir, 'spec.json'),
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'SCHEMA_METADATA_MUST_DISAPPEAR', version: '1' },
          paths: {
            '/pets': { get: { operationId: 'pets', responses: { 200: { description: 'OK' } } } },
            '/UNUSED_ENDPOINT_MUST_DISAPPEAR': {
              get: { responses: { 200: { description: 'OK' } } },
            },
          },
        }),
      )
      await symlink('spec.json', join(dir, 'spec.openapi'))
      await writeFile(
        join(dir, 'runtime.js'),
        `
import { createClient } from '@dify/openapi-inference';
export default {
  queryKeyPrefix: ['bound'],
  createClient: ({ context }) => createClient({ baseUrl: 'https://bound.test', fetch: async url => Response.json({ value: String(url) + ':' + context.user }) }),
};
`,
      )
      await writeFile(
        join(dir, 'app/layout.jsx'),
        'export default function Layout({ children }) { return <html><body>{children}</body></html> }',
      )
      await writeFile(
        join(dir, 'app/button.jsx'),
        `
'use client';
import { api, query } from '../spec.openapi';
export default function Button() {
  return <button onClick={() => api.pets.get({}, { context: { user: 'client' } })}>{JSON.stringify(query.pets.key())}</button>;
}
`,
      )
      await writeFile(
        join(dir, 'app/page.jsx'),
        `
import { api } from '../spec.openapi';
import Button from './button';
export default async function Page() {
  const response = await api.pets.get({}, { context: { user: 'server' } });
  return <><p>{response.value}</p><Button /></>;
}
`,
      )
      const result = spawnSync(process.execPath, [next, 'build', `--${bundler}`], {
        cwd: dir,
        env: {
          ...process.env,
          NEXT_TELEMETRY_DISABLED: '1',
          NODE_OPTIONS: '--max-old-space-size=2048',
          RAYON_NUM_THREADS: '2',
        },
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      })
      assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
      const html = await readFile(join(dir, '.next/server/app/index.html'), 'utf8')
      assert(html.includes('https://bound.test/pets:server'))
      assert(html.includes('bound'))
      const client = await javascript(join(dir, '.next/static/chunks'))
      assert(client.includes('/pets'))
      assert(!client.includes('UNUSED_ENDPOINT_MUST_DISAPPEAR'))
      assert(!client.includes('SCHEMA_METADATA_MUST_DISAPPEAR'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

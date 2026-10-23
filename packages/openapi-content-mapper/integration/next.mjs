import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'

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
  test(`Next ${bundler}: full console JSON imports bind transport and prune unused operations`, async () => {
    const consoleSpec = JSON.parse(
      await readFile(
        join(repository, 'packages/contracts/openapi/console-client-openapi.json'),
        'utf8',
      ),
    )
    const alias = 'enterprise.access.getMetadata'
    consoleSpec.paths['/knowledge-fs/spaces/{control_space_id}/metadata'].get['x-client-path'] =
      alias.split('.')
    const dir = await mkdtemp(join(web, '.openapi-next-'))
    // Match production: contracts owns the document but only Web depends on the SDK.
    const specDir = await mkdtemp(join(repository, 'packages/contracts/.openapi-next-'))
    try {
      await mkdir(join(dir, 'app'))
      await writeFile(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
      await writeFile(
        join(dir, 'next.config.mjs'),
        `
const loader = { loader: '@dify/openapi-content-mapper/loader', options: { runtime: ${JSON.stringify(relative(specDir, join(dir, 'runtime.js')))}, sidecars: ${JSON.stringify(relative(specDir, join(dir, 'spec.openapi')))} } };
export default {
  experimental: { cpus: 2 },
  turbopack: { root: ${JSON.stringify(repository)}, rules: { '*spec.json': { loaders: [loader], as: '*.js' }, '*openapi-namespace.js': { loaders: [loader], as: '*.js' } } },
  webpack(config) { config.module.rules.push({ test: /(?:spec\\.json|openapi-namespace\\.js)$/, type: 'javascript/auto', use: [loader] }); return config; },
};
`,
      )
      await writeFile(
        join(specDir, 'spec.json'),
        JSON.stringify({
          ...consoleSpec,
          info: { title: 'SCHEMA_METADATA_MUST_DISAPPEAR', version: '1' },
          paths: {
            ...consoleSpec.paths,
            '/UNUSED_ENDPOINT_MUST_DISAPPEAR': {
              get: { responses: { 200: { description: 'OK' } } },
            },
          },
        }),
      )
      await symlink(join(specDir, 'spec.json'), join(dir, 'spec.openapi'))
      const policy = `const selected = { queryOptions: { staleTime: 4242 } }; const unused = { queryOptions: { meta: { marker: 'UNUSED_POLICY_MUST_DISAPPEAR' } } }; export { selected as 'GET /knowledge-fs/spaces/{control_space_id}/metadata', unused as 'GET /UNUSED_ENDPOINT_MUST_DISAPPEAR' };`
      const errors = `const selected = { CONFLICT: { status: 409 } }; const unused = { UNUSED: { status: 400, message: 'UNUSED_ERROR_MUST_DISAPPEAR' } }; export { selected as 'GET /knowledge-fs/spaces/{control_space_id}/metadata', unused as 'GET /UNUSED_ENDPOINT_MUST_DISAPPEAR' };`
      await writeFile(join(dir, 'spec.openapi.queries.ts'), policy)
      await writeFile(join(dir, 'spec.openapi.errors.ts'), errors)

      await writeFile(
        join(dir, 'runtime.js'),
        `
import { createClient } from '@dify/openapi-content-mapper';
export default {
  queryKeyPrefix: ['bound'],
  createClient: ({ context }) => createClient({ baseUrl: 'https://bound.test', fetch: async url => context.user === 'conflict' ? Response.json({ code: 'CONFLICT' }, { status: 409 }) : Response.json({ value: String(url) + ':' + context.user }) }),
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
  return <button onClick={() => api.${alias}({ params: { control_space_id: 'space-1' } }, { context: { user: 'client' } })}>{JSON.stringify(query.${alias}.key())}</button>;
}
`,
      )
      await writeFile(
        join(dir, 'app/page.jsx'),
        `
import { api, query } from '../spec.openapi';
import Button from './button';
export default async function Page() {
  const response = await api.${alias}({ params: { control_space_id: 'space-1' } }, { context: { user: 'server' } });
  const defined = await api.${alias}({ params: { control_space_id: 'space-1' } }, { context: { user: 'conflict' } }).catch(error => error.defined);
  const options = query.${alias}.queryOptions({ input: { params: { control_space_id: 'space-1' } } });
  return <><p>{response.value}</p><p>defined-error:{String(defined)};stale:{options.staleTime}</p><Button /></>;
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
        killSignal: 'SIGKILL',
        maxBuffer: 4 * 1024 * 1024,
      })
      assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
      const html = await readFile(join(dir, '.next/server/app/index.html'), 'utf8')
      assert(html.includes('https://bound.test/knowledge-fs/spaces/space-1/metadata:server'))
      assert(html.includes('bound'))
      assert(html.replaceAll(/<!--.*?-->/g, '').includes('defined-error:true;stale:4242'))
      assert(html.includes('4242'))
      const client = await javascript(join(dir, '.next/static/chunks'))
      assert(client.includes('/knowledge-fs/spaces/'))
      assert(!client.includes('/datasets'))
      assert(!client.includes('UNUSED_ENDPOINT_MUST_DISAPPEAR'))
      assert(!client.includes('SCHEMA_METADATA_MUST_DISAPPEAR'))
      assert(!client.includes('UNUSED_POLICY_MUST_DISAPPEAR'))
      assert(!client.includes('UNUSED_ERROR_MUST_DISAPPEAR'))
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(specDir, { recursive: true, force: true })
    }
  })
}

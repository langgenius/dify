/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Exercise the built adapter inside a real Vite development server. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { createServer } from 'vite'
import { parse, stringify } from 'yaml'
import { openapi } from '../dist/tooling/vite.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')
const fixture = parse(readFileSync(join(root, 'examples/petstore/pets.openapi.yaml'), 'utf8'))

test('Vite watches new sidecars beside a symlink outside its root', async (t) => {
  const dir = mkdtempSync(join(root, 'test/.external-dev-'))
  const client = join(dir, 'client')
  mkdirSync(client)
  writeFileSync(
    join(dir, 'source.json'),
    JSON.stringify({
      openapi: '3.1.0',
      paths: { '/pets': { get: { responses: { 200: { description: 'OK' } } } } },
    }),
  )
  const file = join(dir, 'api.openapi')
  symlinkSync('source.json', file)
  writeFileSync(join(client, 'entry.ts'), "export { api, query } from '../api.openapi'")
  const server = await createServer({
    configFile: false,
    root: client,
    logLevel: 'silent',
    plugins: [openapi()],
    server: { port: 0, watch: { useFsEvents: false, usePolling: false } },
  })
  t.after(async () => {
    await server.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const watcherReady = new Promise((resolve) => server.watcher.once('ready', resolve))
  await server.listen()
  await watcherReady
  // Chokidar emits ready only once. Observe the real NodeFs handler finishing
  // the later external-directory registration before creating new sidecars.
  const handler = server.watcher._nodeFsHandler
  const handleDir = handler._handleDir
  const directoryReady = new Promise((resolve) => {
    handler._handleDir = async function (...args) {
      const result = await handleDir.apply(this, args)
      if (args[0] === dir) resolve()
      return result
    }
  })
  t.after(() => {
    handler._handleDir = handleDir
  })
  await server.transformRequest('/entry.ts')
  const url = `/@fs${file}`
  await server.transformRequest(url)
  const query = `${url}?openapi-query=%5B%22pets%22%5D`
  assert.doesNotMatch((await server.transformRequest(query)).code, /api\.openapi\.queries\.ts/)
  for (const [kind, source] of [
    ['queries', "const policy = {queryOptions: {staleTime: 42}}; export {policy as 'GET /pets'};"],
    ['errors', "const errors = {CONFLICT: {status: 409}}; export {errors as 'GET /pets'};"],
  ]) {
    const sidecar = `${file}.${kind}.ts`
    const refreshed = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`No Vite reload after adding ${kind}`)),
        10000,
      )
      const send = server.ws.send.bind(server.ws)
      server.ws.send = (...args) => {
        if (args[0]?.type === 'full-reload' && args[0].triggeredBy === sidecar) {
          clearTimeout(timeout)
          resolve()
        }
        return send(...args)
      }
    })
    await Promise.race([directoryReady, refreshed])
    writeFileSync(sidecar, source)
    await refreshed
    const path = kind === 'queries' ? ['pets'] : ['pets', 'get']
    const transformed = await server.transformRequest(
      `${url}?openapi-${kind === 'queries' ? 'query' : 'errors'}=${encodeURIComponent(JSON.stringify(path))}`,
    )
    assert(transformed.code.includes(`api.openapi.${kind}.ts`), transformed.code)
  }
})

for (const extension of ['yaml', 'openapi']) {
  test(`Vite dev ${extension}: nested virtual modules refresh after the source changes`, async () => {
    const dir = mkdtempSync(join(root, 'test/.dev-'))
    let server
    try {
      const file = join(dir, extension === 'yaml' ? 'api.yaml' : 'source.json')
      const spec = structuredClone(fixture)
      spec.servers = [{ url: 'https://before.test' }]
      const save = () =>
        writeFileSync(file, extension === 'yaml' ? stringify(spec) : JSON.stringify(spec))
      save()
      if (extension === 'openapi') symlinkSync('source.json', join(dir, 'api.openapi'))
      writeFileSync(join(dir, 'entry.ts'), `export { api, query } from './api.${extension}';`)
      server = await createServer({
        configFile: false,
        root: dir,
        logLevel: 'silent',
        plugins: [
          openapi(),
          {
            name: 'downstream-source-map',
            transform(code, id) {
              if (!id.includes('?openapi-')) return
              return { code, map: { version: 3, sources: [id], names: [], mappings: 'AAAA' } }
            },
          },
        ],
        server: {
          port: 0,
          watch: { awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 } },
        },
      })
      await server.listen()
      await server.transformRequest('/entry.ts')
      const main = await server.transformRequest(`/api.${extension}`)
      assert.match(main.code, /openapi-router/)
      const urls = ['router', 'query'].map(
        (kind) =>
          `/api.${extension}?openapi-${kind}=${encodeURIComponent(JSON.stringify(['pets', 'byPetId']))}`,
      )
      for (const url of urls) {
        const transformed = await server.transformRequest(url)
        assert.match(transformed.code, /before\.test/)
        assert.equal(
          transformed.map.mappings,
          '',
          'Virtual namespaces must not embed the source specification',
        )
      }
      const refreshed = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('No Vite reload after spec edit')), 10000)
        const send = server.ws.send.bind(server.ws)
        server.ws.send = (...args) => {
          if (
            args[0]?.type === 'full-reload' &&
            [file, join(dir, 'api.openapi')].includes(args[0].triggeredBy)
          ) {
            clearTimeout(timeout)
            resolve()
          }
          return send(...args)
        }
      })
      spec.servers[0].url = 'https://after.test'
      save()
      await refreshed
      for (const url of urls) {
        const transformed = await server.transformRequest(url)
        assert.match(transformed.code, /after\.test/)
        assert.doesNotMatch(transformed.code, /before\.test/)
      }
    } finally {
      await server?.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Exercise the built adapter inside a real Vite development server. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { createServer } from 'vite'
import { parse, stringify } from 'yaml'
import { openapi } from '../dist/tooling/vite.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')
const fixture = parse(readFileSync(join(root, 'examples/petstore/pets.openapi.yaml'), 'utf8'))

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

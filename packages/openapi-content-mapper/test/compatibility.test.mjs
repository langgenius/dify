/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Exercise public native imports, query callbacks and Standard Schema error validation. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { isDefinedError, ORPCError, safe } from '@orpc/client'
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { createClient } from '../dist/index.js'
import '../dist/tooling/register.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

test('operation defaults preserve keys, overrides and awaited mutation callbacks; errors stay typed and validated', async () => {
  const dir = mkdtempSync(join(import.meta.dirname, '.compat-'))
  try {
    const file = join(dir, 'api.openapi')
    writeFileSync(
      file,
      JSON.stringify({
        openapi: '3.1.0',
        paths: {
          '/pets': {
            get: { responses: { 200: { description: 'ok' } } },
            post: { responses: { 200: { description: 'ok' } } },
          },
        },
      }),
    )
    writeFileSync(
      `${file}.config.ts`,
      `
import { createClient } from '@dify/openapi-content-mapper';
export type Context = { silent?: boolean };
export default { createClient: () => createClient({ baseUrl: 'https://example.test', fetch: async () => Response.json({ id: 1 }) }) };
`,
    )
    writeFileSync(
      `${file}.queries.ts`,
      `
const read = { queryOptions: { staleTime: 1234, retry: false, context: { silent: true } } };
const write = { mutationOptions: { onSettled: (_data, _error, _input, _result, context) => context.client.invalidateQueries({ queryKey: [['pets'], {}] }) } };
export { read as 'GET /pets', write as 'POST /pets' };
`,
    )
    writeFileSync(
      `${file}.errors.ts`,
      `
const errors = { CONFLICT: { status: 409, data: { '~standard': {
  version: 1, vendor: 'fixture', validate(value) {
    return typeof value?.revision === 'number'
      ? { value: { revision: value.revision } }
      : { issues: [{ message: 'revision must be a number' }] };
  },
} } } };
export { errors as 'POST /pets' };
`,
    )
    const { api, query } = await import(pathToFileURL(file).href)
    const client = createClient({
      baseUrl: 'https://example.test',
      fetch: async () => Response.json({ id: 1 }),
    })
    const defaults = query.pets.get.queryOptions()
    assert.equal(defaults.staleTime, 1234)
    assert.equal(defaults.retry, false)
    assert.deepEqual(defaults.queryKey, [['pets', 'get'], { type: 'query' }])
    assert.equal(query.pets.get.queryOptions({ staleTime: 9 }).staleTime, 9)
    assert.deepEqual(query.pets.get.queryKey({ queryKey: ['custom'] }), ['custom'])
    assert.deepEqual(query.pets.post.mutationKey({ mutationKey: ['custom-write'] }), [
      'custom-write',
    ])

    const cache = new QueryClient()
    let release
    let invalidated = false
    const callbackStarted = Promise.withResolvers()
    cache.invalidateQueries = async () => {
      invalidated = true
      callbackStarted.resolve()
      await new Promise((resolve) => {
        release = resolve
      })
    }
    const observer = new MutationObserver(cache, query.pets.post.mutationOptions())
    let settled = false
    const pending = observer.mutate().then(() => {
      settled = true
    })
    await callbackStarted.promise
    assert.equal(settled, false)
    assert.equal(observer.getCurrentResult().status, 'pending')
    release()
    await pending
    assert.equal(settled, true)
    invalidated = false
    await new MutationObserver(
      cache,
      query.pets.post.mutationOptions({ onSettled: () => {} }),
    ).mutate()
    assert.equal(invalidated, false, 'caller callbacks replace defaults, as in oRPC')
    cache.clear()

    for (const [status, data, defined] of [
      [409, { revision: 2, extra: true }, true],
      [400, { revision: 2 }, false],
      [409, { revision: 'bad' }, false],
    ]) {
      client.setConfig({
        fetch: async () => {
          throw new ORPCError('CONFLICT', { status, data })
        },
      })
      const [error, , isDefined] = await safe(api.pets.post(undefined, { client }))
      assert.equal(isDefined, defined)
      assert.equal(isDefinedError(error), defined)
      if (defined)
        assert.deepEqual(error.data, { revision: 2 }, 'validated data strips undeclared properties')
    }
    client.setConfig({
      fetch: async () => Response.json({ code: 'CONFLICT', revision: 3 }, { status: 409 }),
    })
    const [error, , defined] = await safe(api.pets.post(undefined, { client }))
    assert.equal(defined, true)
    assert.equal(error.data.revision, 3)
    const failure = new TypeError('Network failed')
    client.setConfig({
      fetch: async () => {
        throw failure
      },
    })
    await assert.rejects(api.pets.post(undefined, { client }), (error) => error === failure)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

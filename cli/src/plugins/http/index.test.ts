import type { DifyMock } from '@test/fixtures/dify-mock/server'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMock } from '@test/fixtures/dify-mock/server'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Context } from '@/kernel/context'
import { catalog, CATALOG_PATH } from '@/plugins/catalog'
import { CONFIG_FILE_NAME } from '@/plugins/config'
import { http } from './index'

const SHORT_TIMEOUT_MS = 50

let mock: DifyMock
let dir: string

function writeTimeout(ms: number): void {
  writeFileSync(join(dir, CONFIG_FILE_NAME), `schema_version: 1\nhttp:\n  timeout: ${ms}\n`)
}
beforeEach(async () => {
  mock = await startMock()
  dir = mkdtempSync(join(tmpdir(), 'difyctl-http-'))
  Object.assign(process.env, {
    DIFY_CONFIG_DIR: dir,
    DIFY_CACHE_DIR: dir,
    DIFY_SERVER: mock.url,
    DIFY_TOKEN: 'dfoa_test',
  })
})
afterEach(async () => {
  await mock.stop()
  for (const k of ['DIFY_CONFIG_DIR', 'DIFY_CACHE_DIR', 'DIFY_SERVER', 'DIFY_TOKEN'])
    delete process.env[k]
})

const account = () => ({ method: 'GET', path: '/openapi/v1/account' })

describe('http plugin', () => {
  it('fetches the catalog on first use and sends bearer, fingerprint and user agent', async () => {
    const ctx = new Context()
    const res = await (await ctx.get(http)).request(account)
    expect(res.status).toBe(200)
    const c = await ctx.get(catalog)
    expect(c.loaded).toBe(true)
    expect(mock.lastRequest?.headers.authorization).toBe('Bearer dfoa_test')
    expect(mock.lastRequest?.headers['x-dify-catalog']).toBe(c.fingerprint)
    expect(mock.lastRequest?.headers['user-agent']).toMatch(/^difyctl\//)
  })

  it('on 412 refetches the catalog, rebuilds once and resends', async () => {
    const ctx = new Context()
    const h = await ctx.get(http)
    await h.request(account)
    const before = (await ctx.get(catalog)).fingerprint
    mock.setScenario('catalog-changed')
    let builds = 0
    const res = await h.request((cat) => {
      builds++
      return {
        method: 'GET',
        path: '/openapi/v1/account',
        headers: { 'x-build': String(cat.op('workspace.ping') !== undefined) },
      }
    })
    expect(res.status).toBe(200)
    expect(builds).toBe(2)
    expect(mock.lastRequest?.headers['x-build']).toBe('true')
    expect((await ctx.get(catalog)).fingerprint).not.toBe(before)
    expect(mock.requestCount).toBe(5) // catalog, account, account(412), catalog, account
  })

  it('a second 412 is a server error, exit 1, carrying the server hint', async () => {
    const h = await new Context().get(http)
    await h.request(account)
    mock.setScenario('always-stale')
    await expect(h.request(account)).rejects.toMatchObject({
      code: 'server_error',
      httpStatus: 412,
      hint: expect.stringContaining('X-Dify-Catalog'),
    })
  })

  it('maps 401 to exit 4 and 429 to exit 7 with a retry hint', async () => {
    const h = await new Context().get(http)
    mock.setScenario('auth-expired')
    await expect(h.request(account)).rejects.toMatchObject({ code: 'auth_expired' })
    mock.setScenario('rate-limited')
    await expect(h.request(account)).rejects.toMatchObject({
      code: 'rate_limited',
      hint: expect.stringContaining('1'),
    })
  })

  it('surfaces 5xx as server_error with the server body and details', async () => {
    const h = await new Context().get(http)
    mock.setScenario('server-5xx')
    await expect(h.request(account)).rejects.toMatchObject({
      code: 'server_error',
      httpStatus: 503,
      serverError: { code: 'server_5xx' },
    })
  })

  it('fails with catalog_unavailable when the catalog route is missing', async () => {
    mock.setScenario('no-catalog')
    await expect((await new Context().get(http)).request(account)).rejects.toMatchObject({
      code: 'catalog_unavailable',
    })
  })

  it('an auth:false request needs no catalog and sends no bearer', async () => {
    const ctx = new Context()
    const res = await (
      await ctx.get(http)
    ).request(() => ({ method: 'GET', path: '/openapi/v1/_version', auth: false }))
    expect(res.status).toBe(200)
    expect((await ctx.get(catalog)).loaded).toBe(false)
    expect(mock.lastRequest?.headers.authorization).toBeUndefined()
  })

  it('http.timeout bounds the headers, not the stream: a slow body still arrives whole', async () => {
    writeTimeout(SHORT_TIMEOUT_MS)
    mock.setScenario('slow-stream')
    const res = await (
      await new Context().get(http)
    ).request(() => ({
      method: 'POST',
      path: '/openapi/v1/apps/app-1/chat:run',
      json: { app_id: 'app-1', inputs: {}, query: 'hi' },
    }))
    expect(res.status).toBe(200)
    // The gap between the two writes is four times the deadline.
    const body = await res.text()
    expect(body).toContain('"event":"message_end"')
    expect(body).toContain('"answer":"hi"')
  })

  it('a server that never sends headers within the timeout is network_connection', async () => {
    writeTimeout(SHORT_TIMEOUT_MS)
    await expect(
      (await new Context().get(http)).request(() => ({
        method: 'GET',
        path: '/hang',
        auth: false,
      })),
    ).rejects.toMatchObject({
      code: 'network_connection',
      message: expect.stringContaining(`timed out after ${SHORT_TIMEOUT_MS}ms`),
    })
  })

  it('a catalog fetch failure names the status and the catalog path', async () => {
    mock.setScenario('no-catalog')
    await expect((await new Context().get(http)).request(account)).rejects.toMatchObject({
      code: 'catalog_unavailable',
      message: `failed to fetch the catalog: HTTP 404 from ${CATALOG_PATH}`,
      hint: expect.stringContaining('cache refresh'),
    })
  })

  it('an error with no body is named by its status', async () => {
    await expect(
      (await new Context().get(http)).request(() => ({
        method: 'GET',
        path: '/empty-error',
        auth: false,
      })),
    ).rejects.toMatchObject({ code: 'server_error', message: 'HTTP 503' })
  })
})

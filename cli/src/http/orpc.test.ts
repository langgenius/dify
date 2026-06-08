import type { StubServer } from '@test/fixtures/stub-server'
import { jsonResponder, startStubServer } from '@test/fixtures/stub-server'
import { afterEach, describe, expect, it } from 'vitest'
import { isHttpClientError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { openAPIBase } from '@/util/host'
import { createHttpClient } from './client.js'
import { createOpenApiClient } from './orpc.js'

// createOpenApiClient maps errors at the transport seams, so a migrated endpoint surfaces the
// SAME classified HttpClientError as the `this.http.*` path — Dify's message/hint, the request
// method/url, and the raw body — straight from a plain `orpc.x()` call, with no per-call wrapper.
function orpcClient(host: string) {
  // retryAttempts: 0 so the 5xx case fails fast instead of burning the backoff budget.
  const http = createHttpClient({ baseURL: openAPIBase(host), bearer: 'dfoa_test', retryAttempts: 0 })
  return createOpenApiClient(http)
}

async function catchErr(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return undefined
  }
  catch (err) {
    return err
  }
}

describe('createOpenApiClient error mapping', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('recovers Dify message + hint from a top-level 4xx envelope', async () => {
    stub = await startStubServer(cap => jsonResponder(403, { message: 'no access', hint: 'ask an admin' }, cap))
    const orpc = orpcClient(stub.url)

    const caught = await catchErr(() => orpc.account.get())

    expect(isHttpClientError(caught)).toBe(true)
    if (isHttpClientError(caught)) {
      expect(caught.code).toBe(ErrorCode.Server4xxOther)
      expect(caught.httpStatus).toBe(403)
      expect(caught.message).toBe('no access')
      expect(caught.hint).toBe('ask an admin')
      // Parity with the transport path: the migrated endpoint's error keeps the request
      // method/url and the raw body, so formatted errors still print the `request:` line
      // and the raw-response dump (not just message/hint).
      expect(caught.method).toBe('GET')
      expect(caught.url).toContain('/account')
      expect(caught.rawResponse).toContain('no access')
    }
  })

  it('recovers from a nested { error: { message, hint } } envelope and keeps the auth code on 401', async () => {
    stub = await startStubServer(cap => jsonResponder(401, { error: { message: 'expired', hint: 'relogin' } }, cap))
    const orpc = orpcClient(stub.url)

    const caught = await catchErr(() => orpc.account.get())

    expect(isHttpClientError(caught)).toBe(true)
    if (isHttpClientError(caught)) {
      expect(caught.code).toBe(ErrorCode.AuthExpired)
      expect(caught.httpStatus).toBe(401)
      expect(caught.message).toBe('expired')
      expect(caught.hint).toBe('relogin')
    }
  })

  it('falls back to the default auth-login hint when the body carries none', async () => {
    stub = await startStubServer(cap => jsonResponder(401, { error: 'expired' }, cap))
    const orpc = orpcClient(stub.url)

    const caught = await catchErr(() => orpc.account.get())

    expect(isHttpClientError(caught)).toBe(true)
    if (isHttpClientError(caught)) {
      expect(caught.code).toBe(ErrorCode.AuthExpired)
      expect(caught.hint).toContain('difyctl auth login')
    }
  })

  it('maps 5xx to Server5xx', async () => {
    stub = await startStubServer(cap => jsonResponder(503, { message: 'down for maintenance' }, cap))
    const orpc = orpcClient(stub.url)

    const caught = await catchErr(() => orpc.account.get())

    expect(isHttpClientError(caught)).toBe(true)
    if (isHttpClientError(caught)) {
      expect(caught.code).toBe(ErrorCode.Server5xx)
      expect(caught.httpStatus).toBe(503)
      expect(caught.message).toBe('down for maintenance')
    }
  })
})

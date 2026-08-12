import type { StubServer } from '@test/fixtures/stub-server'
import type { HttpClientError } from '@/errors/base'
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
  const http = createHttpClient({
    baseURL: openAPIBase(host),
    bearer: 'dfoa_test',
    retryAttempts: 0,
  })
  return createOpenApiClient(http)
}

async function catchErr(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return undefined
  } catch (err) {
    return err
  }
}

describe('createOpenApiClient error mapping', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  async function classifiedError(status: number, body: unknown): Promise<HttpClientError> {
    stub = await startStubServer((cap) => jsonResponder(status, body, cap))
    const orpc = orpcClient(stub.url)
    const caught = await catchErr(() => orpc.account.get())
    if (!isHttpClientError(caught))
      throw new Error(`expected HttpClientError, got: ${String(caught)}`)
    return caught
  }

  it('recovers Dify message from a canonical ErrorBody 4xx response', async () => {
    const caught = await classifiedError(422, {
      code: 'invalid_param',
      message: 'no access',
      status: 422,
    })

    expect(caught.code).toBe(ErrorCode.Server4xxOther)
    expect(caught.httpStatus).toBe(422)
    expect(caught.message).toBe('no access')
    // Parity with the transport path: the migrated endpoint's error keeps the request
    // method/url and the raw body, so formatted errors still print the `request:` line
    // and the raw-response dump (not just message/hint).
    expect(caught.method).toBe('GET')
    expect(caught.url).toContain('/account')
    expect(caught.rawResponse).toContain('no access')
  })

  it('reads server message from canonical ErrorBody on 401 and keeps the auth code', async () => {
    const caught = await classifiedError(401, {
      code: 'unauthorized',
      message: 'expired',
      status: 401,
    })

    expect(caught.code).toBe(ErrorCode.AuthExpired)
    expect(caught.httpStatus).toBe(401)
    expect(caught.message).toBe('expired')
  })

  it('uses CLI default auth-login hint for non-conforming 401 body', async () => {
    const caught = await classifiedError(401, { error: 'expired' })

    expect(caught.code).toBe(ErrorCode.AuthExpired)
    expect(caught.hint).toContain('difyctl auth login')
  })

  it('maps 5xx to Server5xx with message from canonical ErrorBody', async () => {
    const caught = await classifiedError(503, {
      code: 'service_unavailable',
      message: 'down for maintenance',
      status: 503,
    })

    expect(caught.code).toBe(ErrorCode.Server5xx)
    expect(caught.httpStatus).toBe(503)
    expect(caught.message).toBe('down for maintenance')
  })
})

import type { StubServer } from '@test/fixtures/stub-server'
import { jsonResponder, startStubServer } from '@test/fixtures/stub-server'
import { afterEach, describe, expect, it } from 'vitest'
import { isHttpClientError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { openAPIBase } from '@/util/host'
import { createHttpClient } from './client.js'
import { createOpenApiClient, unwrap } from './orpc.js'

// createOpenApiClient + unwrap is the oRPC facade every migrated wrapper uses. oRPC owns error
// construction for non-2xx, so these tests pin that mapOrpcError translates the ORPCError back
// into the CLI's HttpClientError AND recovers Dify's wire message/hint (parity with the
// transport path's classifyResponse), since the typed-client tests can't observe that.
function orpcClient(host: string) {
  // retryAttempts: 0 so the 5xx case fails fast instead of burning the backoff budget.
  const http = createHttpClient({ baseURL: openAPIBase(host), bearer: 'dfoa_test', retryAttempts: 0 })
  return createOpenApiClient(http, http.baseURL)
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

describe('mapOrpcError (via unwrap)', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('recovers Dify message + hint from a top-level 4xx envelope', async () => {
    stub = await startStubServer(cap => jsonResponder(403, { message: 'no access', hint: 'ask an admin' }, cap))
    const orpc = orpcClient(stub.url)

    const caught = await catchErr(() => unwrap(orpc.account.get()))

    expect(isHttpClientError(caught)).toBe(true)
    if (isHttpClientError(caught)) {
      expect(caught.code).toBe(ErrorCode.Server4xxOther)
      expect(caught.httpStatus).toBe(403)
      expect(caught.message).toBe('no access')
      expect(caught.hint).toBe('ask an admin')
    }
  })

  it('recovers from a nested { error: { message, hint } } envelope and keeps the auth code on 401', async () => {
    stub = await startStubServer(cap => jsonResponder(401, { error: { message: 'expired', hint: 'relogin' } }, cap))
    const orpc = orpcClient(stub.url)

    const caught = await catchErr(() => unwrap(orpc.account.get()))

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

    const caught = await catchErr(() => unwrap(orpc.account.get()))

    expect(isHttpClientError(caught)).toBe(true)
    if (isHttpClientError(caught)) {
      expect(caught.code).toBe(ErrorCode.AuthExpired)
      expect(caught.hint).toContain('difyctl auth login')
    }
  })

  it('maps 5xx to Server5xx', async () => {
    stub = await startStubServer(cap => jsonResponder(503, { message: 'down for maintenance' }, cap))
    const orpc = orpcClient(stub.url)

    const caught = await catchErr(() => unwrap(orpc.account.get()))

    expect(isHttpClientError(caught)).toBe(true)
    if (isHttpClientError(caught)) {
      expect(caught.code).toBe(ErrorCode.Server5xx)
      expect(caught.httpStatus).toBe(503)
      expect(caught.message).toBe('down for maintenance')
    }
  })
})

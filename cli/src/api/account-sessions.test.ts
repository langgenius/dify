import type { StubServer } from '@test/fixtures/stub-server'
import { testHttpClient } from '@test/fixtures/http-client'
import { jsonResponder, startStubServer } from '@test/fixtures/stub-server'
import { afterEach, describe, expect, it } from 'vitest'
import { isHttpClientError } from '@/errors/base'
import { AccountSessionsClient } from './account-sessions.js'

const LIST_BODY = { page: 1, limit: 100, total: 0, has_more: false, data: [] }

function makeClient(host: string): AccountSessionsClient {
  return new AccountSessionsClient(testHttpClient(host, 'dfoa_test'))
}

describe('AccountSessionsClient.list', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('GETs account/sessions with no query when paging is unset', async () => {
    stub = await startStubServer((cap) => jsonResponder(200, LIST_BODY, cap))

    await makeClient(stub.url).list()

    expect(stub.captured.method).toBe('GET')
    // page/limit are undefined → dropped, so no trailing query string at all.
    expect(stub.captured.url).toBe('/openapi/v1/account/sessions')
  })

  it('forwards page/limit when supplied', async () => {
    stub = await startStubServer((cap) => jsonResponder(200, LIST_BODY, cap))

    await makeClient(stub.url).list({ page: 2, limit: 25 })

    const q = new URL(stub.captured.url ?? '', 'http://x').searchParams
    expect(q.get('page')).toBe('2')
    expect(q.get('limit')).toBe('25')
  })
})

describe('AccountSessionsClient.revoke', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('DELETEs the session by id and discards the JSON body without throwing', async () => {
    // The server replies 200 + {status:"revoked"}; revoke() returns void but the
    // typed client still parses the body — this guards against a regression where
    // a non-empty 200 body trips JSON handling.
    stub = await startStubServer((cap) => jsonResponder(200, { status: 'revoked' }, cap))

    await expect(makeClient(stub.url).revoke('sess-1')).resolves.toBeUndefined()
    expect(stub.captured.method).toBe('DELETE')
    expect(stub.captured.url).toBe('/openapi/v1/account/sessions/sess-1')
  })

  it('URL-encodes the session id', async () => {
    stub = await startStubServer((cap) => jsonResponder(200, { status: 'revoked' }, cap))

    await makeClient(stub.url).revoke('sess/1 2')

    expect(stub.captured.url).toBe('/openapi/v1/account/sessions/sess%2F1%202')
  })

  it('propagates 404 as a classified BaseError', async () => {
    stub = await startStubServer((cap) =>
      jsonResponder(404, { error: { code: 'not_found', message: 'session not found' } }, cap),
    )

    await expect(makeClient(stub.url).revoke('missing')).rejects.toSatisfy(
      (err) => isHttpClientError(err) && err.httpStatus === 404,
    )
  })

  it('revokeSelf DELETEs the self subresource', async () => {
    stub = await startStubServer((cap) => jsonResponder(200, { status: 'revoked' }, cap))

    await expect(makeClient(stub.url).revokeSelf()).resolves.toBeUndefined()
    expect(stub.captured.method).toBe('DELETE')
    expect(stub.captured.url).toBe('/openapi/v1/account/sessions/self')
  })
})

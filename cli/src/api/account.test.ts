import type { StubServer } from '@test/fixtures/stub-server'
import { testHttpClient } from '@test/fixtures/http-client'
import { jsonResponder, startStubServer } from '@test/fixtures/stub-server'
import { afterEach, describe, expect, it } from 'vitest'
import { isHttpClientError } from '@/errors/base'
import { AccountClient } from './account.js'

function makeClient(host: string): AccountClient {
  return new AccountClient(testHttpClient(host, 'dfoa_test'))
}

describe('AccountClient.get', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('GETs account, sends the bearer, and returns the parsed payload', async () => {
    stub = await startStubServer((cap) =>
      jsonResponder(
        200,
        {
          subject_type: 'account',
          account: { id: 'acct-1', email: 'a@e.com', name: 'A' },
        },
        cap,
      ),
    )

    const res = await makeClient(stub.url).get()

    expect(stub.captured.method).toBe('GET')
    expect(stub.captured.url).toBe('/openapi/v1/account')
    expect(stub.captured.headers?.authorization).toBe('Bearer dfoa_test')
    expect(res.account?.email).toBe('a@e.com')
  })

  it('maps 401 to a classified BaseError', async () => {
    stub = await startStubServer((cap) => jsonResponder(401, { error: 'expired' }, cap))

    await expect(makeClient(stub.url).get()).rejects.toSatisfy(
      (err) => isHttpClientError(err) && err.httpStatus === 401,
    )
  })
})

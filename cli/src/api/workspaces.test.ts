import type { StubServer } from '@test/fixtures/stub-server'
import { testHttpClient } from '@test/fixtures/http-client'
import { jsonResponder, startStubServer } from '@test/fixtures/stub-server'
import { afterEach, describe, expect, it } from 'vitest'
import { isHttpClientError } from '@/errors/base'
import { WorkspacesClient } from './workspaces.js'

// WorkspacesClient.switch is covered in members.test.ts; this file covers list(), which now
// routes through the generated oRPC contract (OpenAPILink over http.request). The happy path
// asserts the on-the-wire GET /openapi/v1/workspaces is unchanged; the 401 case asserts the
// oRPC client surfaces it as the CLI's classified HttpClientError.

function makeClient(host: string): WorkspacesClient {
  return new WorkspacesClient(testHttpClient(host, 'dfoa_test'))
}

describe('WorkspacesClient.list', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('GETs /workspaces and returns the parsed list', async () => {
    stub = await startStubServer((cap) =>
      jsonResponder(
        200,
        {
          workspaces: [
            { id: 'ws-1', name: 'Default', role: 'owner', status: 'normal', current: true },
          ],
        },
        cap,
      ),
    )

    const res = await makeClient(stub.url).list()

    expect(stub.captured.method).toBe('GET')
    expect(stub.captured.url).toBe('/openapi/v1/workspaces')
    expect(res.workspaces[0]?.id).toBe('ws-1')
  })

  it('maps 401 to a classified BaseError', async () => {
    stub = await startStubServer((cap) => jsonResponder(401, { error: 'expired' }, cap))

    await expect(makeClient(stub.url).list()).rejects.toSatisfy(
      (err) => isHttpClientError(err) && err.httpStatus === 401,
    )
  })
})

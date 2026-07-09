import type { StubServer } from '@test/fixtures/stub-server'
import { testHttpClient } from '@test/fixtures/http-client'
import { jsonResponder, startStubServer } from '@test/fixtures/stub-server'
import { afterEach, describe, expect, it } from 'vitest'
import { isHttpClientError } from '@/errors/base'
import { MembersClient } from './members.js'
import { WorkspacesClient } from './workspaces.js'

function makeClient(host: string): MembersClient {
  return new MembersClient(testHttpClient(host, 'dfoa_test'))
}

describe('MembersClient.list', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('GETs /workspaces/<id>/members and returns parsed envelope', async () => {
    stub = await startStubServer(cap =>
      jsonResponder(
        200,
        {
          page: 1,
          limit: 20,
          total: 1,
          has_more: false,
          data: [
            { id: 'm-1', name: 'Mia', email: 'mia@e.com', role: 'admin', status: 'active' },
          ],
        },
        cap,
      ))

    const result = await makeClient(stub.url).list('ws-1')

    expect(stub.captured.method).toBe('GET')
    expect(stub.captured.url).toBe('/openapi/v1/workspaces/ws-1/members')
    expect(result.data[0]?.email).toBe('mia@e.com')
  })

  it('URL-encodes workspace id', async () => {
    stub = await startStubServer(cap =>
      jsonResponder(200, { page: 1, limit: 20, total: 0, has_more: false, data: [] }, cap))

    await makeClient(stub.url).list('ws with space')

    expect(stub.captured.url).toBe('/openapi/v1/workspaces/ws%20with%20space/members')
  })

  it('forwards page/limit as query params', async () => {
    stub = await startStubServer(cap =>
      jsonResponder(200, { page: 2, limit: 50, total: 0, has_more: false, data: [] }, cap))

    await makeClient(stub.url).list('ws-1', { page: 2, limit: 50 })

    expect(stub.captured.url).toBe('/openapi/v1/workspaces/ws-1/members?page=2&limit=50')
  })

  it('propagates server 403 as classified BaseError', async () => {
    stub = await startStubServer(cap => jsonResponder(403, { error: 'forbidden' }, cap))

    await expect(makeClient(stub.url).list('ws-1')).rejects.toSatisfy(
      err => isHttpClientError(err) && err.httpStatus === 403,
    )
  })

  it('propagates 404 as classified BaseError', async () => {
    stub = await startStubServer(cap => jsonResponder(404, { error: 'not found' }, cap))

    await expect(makeClient(stub.url).list('ws-missing')).rejects.toSatisfy(
      err => isHttpClientError(err) && err.httpStatus === 404,
    )
  })
})

describe('MembersClient.invite', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('POSTs JSON body and returns parsed invite response', async () => {
    stub = await startStubServer(cap =>
      jsonResponder(
        201,
        {
          result: 'success',
          email: 'new@e.com',
          role: 'normal',
          member_id: 'acct-9',
          invite_url: 'https://console.example.com/activate?email=new&token=tok',
          tenant_id: 'ws-1',
        },
        cap,
      ))

    const result = await makeClient(stub.url).invite('ws-1', {
      email: 'new@e.com',
      role: 'normal',
    })

    expect(stub.captured.method).toBe('POST')
    expect(stub.captured.url).toBe('/openapi/v1/workspaces/ws-1/members')
    expect(JSON.parse(stub.captured.body ?? '{}')).toEqual({
      email: 'new@e.com',
      role: 'normal',
    })
    expect(result.member_id).toBe('acct-9')
    expect(result.invite_url).toContain('token=tok')
  })

  it('propagates 400 (already in tenant) as classified BaseError', async () => {
    stub = await startStubServer(cap => jsonResponder(400, { error: 'already in tenant' }, cap))

    await expect(
      makeClient(stub.url).invite('ws-1', { email: 'u@e.com', role: 'normal' }),
    ).rejects.toSatisfy(err => isHttpClientError(err) && err.httpStatus === 400)
  })
})

describe('MembersClient.remove', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('DELETEs member by id and returns success', async () => {
    stub = await startStubServer(cap => jsonResponder(200, { result: 'success' }, cap))

    const result = await makeClient(stub.url).remove('ws-1', 'm-1')

    expect(stub.captured.method).toBe('DELETE')
    expect(stub.captured.url).toBe('/openapi/v1/workspaces/ws-1/members/m-1')
    expect(result.result).toBe('success')
  })

  it('propagates 400 (cannot operate self / cannot remove owner)', async () => {
    stub = await startStubServer(cap => jsonResponder(400, { error: 'cannot operate self' }, cap))

    await expect(makeClient(stub.url).remove('ws-1', 'm-1')).rejects.toSatisfy(
      err => isHttpClientError(err) && err.httpStatus === 400,
    )
  })
})

describe('MembersClient.updateRole', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('PATCHes role payload to the member resource', async () => {
    stub = await startStubServer(cap => jsonResponder(200, { result: 'success' }, cap))

    const result = await makeClient(stub.url).updateRole('ws-1', 'm-1', { role: 'admin' })

    expect(stub.captured.method).toBe('PATCH')
    expect(stub.captured.url).toBe('/openapi/v1/workspaces/ws-1/members/m-1')
    expect(JSON.parse(stub.captured.body ?? '{}')).toEqual({ role: 'admin' })
    expect(result.result).toBe('success')
  })

  it('propagates 400 (admin cannot demote owner)', async () => {
    stub = await startStubServer(cap => jsonResponder(400, { error: 'no permission' }, cap))

    await expect(
      makeClient(stub.url).updateRole('ws-1', 'm-1', { role: 'admin' }),
    ).rejects.toSatisfy(err => isHttpClientError(err) && err.httpStatus === 400)
  })
})

describe('WorkspacesClient.switch (integration with stub)', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('POSTs /workspaces/<id>:switch and returns workspace detail', async () => {
    stub = await startStubServer(cap =>
      jsonResponder(
        200,
        {
          id: 'ws-1',
          name: 'Workspace 1',
          role: 'owner',
          status: 'normal',
          current: true,
          created_at: '2026-05-18T00:00:00Z',
        },
        cap,
      ))

    const client = new WorkspacesClient(testHttpClient(stub.url, 'dfoa_test'))
    const result = await client.switch('ws-1')

    expect(stub.captured.method).toBe('POST')
    expect(stub.captured.url).toBe('/openapi/v1/workspaces/ws-1:switch')
    expect(result.current).toBe(true)
  })

  it('propagates 404 (non-member)', async () => {
    stub = await startStubServer(cap => jsonResponder(404, { error: 'not found' }, cap))

    const client = new WorkspacesClient(testHttpClient(stub.url, 'dfoa_test'))
    await expect(client.switch('ws-x')).rejects.toSatisfy(
      err => isHttpClientError(err) && err.httpStatus === 404,
    )
  })
})

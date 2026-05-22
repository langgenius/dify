import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import * as http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { isBaseError } from '../errors/base.js'
import { createClient } from '../http/client.js'
import { MembersClient } from './members.js'

type StubServer = {
  url: string
  lastRequest: { method?: string, url?: string, body?: string }
  stop: () => Promise<void>
}

function jsonResponder(
  status: number,
  body: unknown,
  captured: StubServer['lastRequest'],
): http.RequestListener {
  return (req, res) => {
    captured.method = req.method
    captured.url = req.url
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      captured.body = Buffer.concat(chunks).toString('utf8')
      const payload = JSON.stringify(body)
      res.writeHead(status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      })
      res.end(payload)
    })
  }
}

function startServer(handler: http.RequestListener): Promise<StubServer> {
  const captured: StubServer['lastRequest'] = {}
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handler(req, res))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        lastRequest: captured,
        stop: () =>
          new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res()))),
      })
    })
    server.on('error', reject)
  })
}

function makeClient(host: string): MembersClient {
  return new MembersClient(createClient({ host, bearer: 'dfoa_test' }))
}

describe('MembersClient.list', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('GETs /workspaces/<id>/members and returns parsed envelope', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(
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
        captured,
      ),
    )
    stub.lastRequest = captured

    const result = await makeClient(stub.url).list('ws-1')
    expect(captured.method).toBe('GET')
    expect(captured.url).toBe('/openapi/v1/workspaces/ws-1/members')
    expect(result.data[0].email).toBe('mia@e.com')
  })

  it('URL-encodes workspace id', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(
      jsonResponder(200, { page: 1, limit: 20, total: 0, has_more: false, data: [] }, captured),
    )
    stub.lastRequest = captured

    await makeClient(stub.url).list('ws with space')
    expect(captured.url).toBe('/openapi/v1/workspaces/ws%20with%20space/members')
  })

  it('forwards page/limit as query params', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(
      jsonResponder(200, { page: 2, limit: 50, total: 0, has_more: false, data: [] }, captured),
    )
    stub.lastRequest = captured

    await makeClient(stub.url).list('ws-1', { page: 2, limit: 50 })
    expect(captured.url).toBe('/openapi/v1/workspaces/ws-1/members?page=2&limit=50')
  })

  it('propagates server 403 as HTTPError', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(jsonResponder(403, { error: 'forbidden' }, captured))

    await expect(makeClient(stub.url).list('ws-1')).rejects.toSatisfy(
      err => isBaseError(err) && err.httpStatus === 403,
    )
  })

  it('propagates 404 as classified BaseError', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(jsonResponder(404, { error: 'not found' }, captured))

    await expect(makeClient(stub.url).list('ws-missing')).rejects.toSatisfy(
      err => isBaseError(err) && err.httpStatus === 404,
    )
  })
})

describe('MembersClient.invite', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('POSTs JSON body and returns parsed invite response', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(
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
        captured,
      ),
    )
    stub.lastRequest = captured

    const result = await makeClient(stub.url).invite('ws-1', {
      email: 'new@e.com',
      role: 'normal',
    })
    expect(captured.method).toBe('POST')
    expect(captured.url).toBe('/openapi/v1/workspaces/ws-1/members')
    expect(JSON.parse(captured.body ?? '{}')).toEqual({
      email: 'new@e.com',
      role: 'normal',
    })
    expect(result.member_id).toBe('acct-9')
    expect(result.invite_url).toContain('token=tok')
  })

  it('propagates 400 (already in tenant) as HTTPError', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(jsonResponder(400, { error: 'already in tenant' }, captured))

    await expect(
      makeClient(stub.url).invite('ws-1', { email: 'u@e.com', role: 'normal' }),
    ).rejects.toSatisfy(err => isBaseError(err) && err.httpStatus === 400)
  })
})

describe('MembersClient.remove', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('DELETEs member by id and returns success', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(jsonResponder(200, { result: 'success' }, captured))
    stub.lastRequest = captured

    const result = await makeClient(stub.url).remove('ws-1', 'm-1')
    expect(captured.method).toBe('DELETE')
    expect(captured.url).toBe('/openapi/v1/workspaces/ws-1/members/m-1')
    expect(result.result).toBe('success')
  })

  it('propagates 400 (cannot operate self / cannot remove owner)', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(jsonResponder(400, { error: 'cannot operate self' }, captured))

    await expect(makeClient(stub.url).remove('ws-1', 'm-1')).rejects.toSatisfy(
      err => isBaseError(err) && err.httpStatus === 400,
    )
  })
})

describe('MembersClient.updateRole', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('PUTs role payload to /role subresource', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(jsonResponder(200, { result: 'success' }, captured))
    stub.lastRequest = captured

    const result = await makeClient(stub.url).updateRole('ws-1', 'm-1', { role: 'admin' })
    expect(captured.method).toBe('PUT')
    expect(captured.url).toBe('/openapi/v1/workspaces/ws-1/members/m-1/role')
    expect(JSON.parse(captured.body ?? '{}')).toEqual({ role: 'admin' })
    expect(result.result).toBe('success')
  })

  it('propagates 400 (admin cannot demote owner)', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(jsonResponder(400, { error: 'no permission' }, captured))

    await expect(
      makeClient(stub.url).updateRole('ws-1', 'm-1', { role: 'admin' }),
    ).rejects.toSatisfy(err => isBaseError(err) && err.httpStatus === 400)
  })
})

describe('WorkspacesClient.switch (integration with stub)', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('POSTs /workspaces/<id>/switch and returns workspace detail', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(
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
        captured,
      ),
    )
    stub.lastRequest = captured

    const { WorkspacesClient } = await import('./workspaces.js')
    const client = new WorkspacesClient(createClient({ host: stub.url, bearer: 'dfoa_test' }))
    const result = await client.switch('ws-1')
    expect(captured.method).toBe('POST')
    expect(captured.url).toBe('/openapi/v1/workspaces/ws-1/switch')
    expect(result.current).toBe(true)
  })

  it('propagates 404 (non-member)', async () => {
    const captured: StubServer['lastRequest'] = {}
    stub = await startServer(jsonResponder(404, { error: 'not found' }, captured))

    const { WorkspacesClient } = await import('./workspaces.js')
    const client = new WorkspacesClient(createClient({ host: stub.url, bearer: 'dfoa_test' }))
    await expect(client.switch('ws-x')).rejects.toSatisfy(
      err => isBaseError(err) && err.httpStatus === 404,
    )
  })
})

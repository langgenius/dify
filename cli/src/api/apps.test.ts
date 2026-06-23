import type { StubServer } from '@test/fixtures/stub-server'
import { testHttpClient } from '@test/fixtures/http-client'
import { jsonResponder, startStubServer } from '@test/fixtures/stub-server'
import { afterEach, describe, expect, it } from 'vitest'
import { isHttpClientError } from '@/errors/base'
import { AppsClient } from './apps.js'

const LIST_BODY = { page: 1, limit: 20, total: 0, has_more: false, data: [] }
const DESCRIBE_BODY = { info: { id: 'app-1', name: 'Demo', mode: 'chat', service_api_enabled: true } }

function makeClient(host: string): AppsClient {
  return new AppsClient(testHttpClient(host, 'dfoa_test'))
}

function queryOf(url: string | undefined): URLSearchParams {
  return new URL(url ?? '', 'http://x').searchParams
}

describe('AppsClient.list', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('defaults page=1 & limit=20 and always sends workspace_id', async () => {
    stub = await startStubServer(cap => jsonResponder(200, LIST_BODY, cap))

    await makeClient(stub.url).list({ workspaceId: 'ws-1' })

    const q = queryOf(stub.captured.url)
    expect(stub.captured.method).toBe('GET')
    expect(q.get('workspace_id')).toBe('ws-1')
    expect(q.get('page')).toBe('1')
    expect(q.get('limit')).toBe('20')
    // Optional filters are omitted entirely when not supplied.
    expect(q.has('mode')).toBe(false)
    expect(q.has('name')).toBe(false)
  })

  it('forwards explicit pagination and filters', async () => {
    stub = await startStubServer(cap => jsonResponder(200, LIST_BODY, cap))

    await makeClient(stub.url).list({
      workspaceId: 'ws-1',
      page: 3,
      limit: 50,
      mode: 'chat',
      name: 'support bot',
    })

    const q = queryOf(stub.captured.url)
    expect(q.get('page')).toBe('3')
    expect(q.get('limit')).toBe('50')
    expect(q.get('mode')).toBe('chat')
    expect(q.get('name')).toBe('support bot')
  })

  it('treats empty-string filters as absent (not blank query params)', async () => {
    stub = await startStubServer(cap => jsonResponder(200, LIST_BODY, cap))

    await makeClient(stub.url).list({ workspaceId: 'ws-1', mode: '', name: '' })

    const q = queryOf(stub.captured.url)
    expect(q.has('mode')).toBe(false)
    expect(q.has('name')).toBe(false)
  })

  it('propagates server 403 as a classified BaseError', async () => {
    stub = await startStubServer(cap => jsonResponder(403, { error: 'forbidden' }, cap))

    await expect(makeClient(stub.url).list({ workspaceId: 'ws-1' })).rejects.toSatisfy(
      err => isHttpClientError(err) && err.httpStatus === 403,
    )
  })
})

describe('AppsClient.describe', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('hits /apps/<id>/describe, omits workspace_id and fields when not given', async () => {
    stub = await startStubServer(cap => jsonResponder(200, DESCRIBE_BODY, cap))

    const res = await makeClient(stub.url).describe('app-1')

    expect(stub.captured.url?.split('?')[0]).toBe('/openapi/v1/apps/app-1/describe')
    const q = queryOf(stub.captured.url)
    expect(q.has('workspace_id')).toBe(false)
    expect(q.has('fields')).toBe(false)
    expect(res.info?.id).toBe('app-1')
  })

  it('joins fields with commas', async () => {
    stub = await startStubServer(cap => jsonResponder(200, DESCRIBE_BODY, cap))

    await makeClient(stub.url).describe('app-1', ['parameters', 'input_schema'])

    expect(queryOf(stub.captured.url).get('fields')).toBe('parameters,input_schema')
  })

  it('URL-encodes the app id', async () => {
    stub = await startStubServer(cap => jsonResponder(200, DESCRIBE_BODY, cap))

    await makeClient(stub.url).describe('app/with space')

    expect(stub.captured.url?.split('?')[0]).toBe('/openapi/v1/apps/app%2Fwith%20space/describe')
  })
})

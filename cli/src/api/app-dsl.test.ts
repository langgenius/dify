import type { StubServer } from '@test/fixtures/stub-server'
import { testHttpClient } from '@test/fixtures/http-client'
import { jsonResponder, startStubServer } from '@test/fixtures/stub-server'
import { afterEach, describe, expect, it } from 'vitest'
import { isHttpClientError } from '@/errors/base'
import { AppDslClient } from './app-dsl.js'

const DSL_YAML = `app:\n  mode: chat\n  name: Test\nversion: '0.1.4'\n`

const COMPLETED_IMPORT = { id: 'imp-1', status: 'completed', app_id: 'app-1', app_mode: 'chat' }

function makeClient(host: string): AppDslClient {
  return new AppDslClient(testHttpClient(host, 'dfoa_test'))
}

describe('AppDslClient.exportDsl', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('returns the data string from the response', async () => {
    stub = await startStubServer(cap => jsonResponder(200, { data: DSL_YAML }, cap))

    const yaml = await makeClient(stub.url).exportDsl('app-1')

    expect(stub.captured.method).toBe('GET')
    expect(stub.captured.url?.split('?')[0]).toBe('/openapi/v1/apps/app-1/export')
    expect(yaml).toBe(DSL_YAML)
  })

  it('throws when response has no data field', async () => {
    stub = await startStubServer(cap => jsonResponder(200, { wrong: 1 }, cap))

    await expect(makeClient(stub.url).exportDsl('app-1')).rejects.toThrow('export response missing data field')
  })

  it('propagates 404 as a classified HttpClientError', async () => {
    stub = await startStubServer(cap => jsonResponder(404, { error: 'not_found' }, cap))

    await expect(makeClient(stub.url).exportDsl('missing')).rejects.toSatisfy(
      err => isHttpClientError(err) && err.httpStatus === 404,
    )
  })
})

describe('AppDslClient.importApp', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('POST to /workspaces/:id/apps/imports with body and returns Import', async () => {
    stub = await startStubServer(cap => jsonResponder(200, COMPLETED_IMPORT, cap))

    const result = await makeClient(stub.url).importApp('ws-1', {
      mode: 'yaml-content',
      yaml_content: DSL_YAML,
    })

    expect(stub.captured.method).toBe('POST')
    expect(stub.captured.url).toBe('/openapi/v1/workspaces/ws-1/apps/imports')
    expect(result.status).toBe('completed')
    expect(result.app_id).toBe('app-1')
  })

  it('returns pending import on 202', async () => {
    const pending = { id: 'imp-1', status: 'pending', current_dsl_version: '0.1.4', imported_dsl_version: '0.0.9' }
    stub = await startStubServer(cap => jsonResponder(202, pending, cap))

    const result = await makeClient(stub.url).importApp('ws-1', { mode: 'yaml-content', yaml_content: DSL_YAML })

    expect(result.status).toBe('pending')
    expect(result.id).toBe('imp-1')
  })
})

describe('AppDslClient.confirmImport', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('POST to confirm URL and returns completed Import', async () => {
    stub = await startStubServer(cap => jsonResponder(200, COMPLETED_IMPORT, cap))

    const result = await makeClient(stub.url).confirmImport('ws-1', 'imp-1')

    expect(stub.captured.method).toBe('POST')
    expect(stub.captured.url).toBe('/openapi/v1/workspaces/ws-1/apps/imports/imp-1/confirm')
    expect(result.status).toBe('completed')
  })
})

describe('AppDslClient.checkDependencies', () => {
  let stub: StubServer

  afterEach(async () => {
    await stub?.stop()
  })

  it('returns empty leaked_dependencies on healthy app', async () => {
    stub = await startStubServer(cap => jsonResponder(200, { leaked_dependencies: [] }, cap))

    const result = await makeClient(stub.url).checkDependencies('app-1')

    expect(stub.captured.url?.split('?')[0]).toBe('/openapi/v1/apps/app-1/check-dependencies')
    expect(result.leaked_dependencies).toEqual([])
  })
})

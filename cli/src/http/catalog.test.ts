import type { StubServer } from '@test/fixtures/stub-server'
import { knowledgeFsCatalog, withCatalog } from '@test/fixtures/catalog-server'
import { testHttpClient } from '@test/fixtures/http-client'
import { jsonResponder, startStubServer } from '@test/fixtures/stub-server'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { KnowledgeFsClient } from '@/api/knowledge-fs'
import { requestCatalogOperation } from './catalog'

const diffInput = { old_path: '/knowledge/old', new_path: '/knowledge/new' }
const diffOutput = { operations: [], stats: { delete: 0, equal: 0, insert: 0 } }

describe('catalog-backed KnowledgeFS requests', () => {
  let stub: StubServer
  afterEach(async () => {
    await stub?.stop()
  })

  it('does not download a catalog for an already cancelled operation', async () => {
    let reads = 0
    stub = await startStubServer((cap) => (req, res) => {
      reads++
      withCatalog(jsonResponder(200, diffOutput, cap))(req, res)
    })
    const controller = new AbortController()
    controller.abort()
    await expect(
      requestCatalogOperation(
        testHttpClient(stub.url),
        'knowledge_fs.diff',
        {
          workspace_id: 'ws',
          knowledge_space_id: 'space',
          ...diffInput,
        },
        { signal: controller.signal },
      ),
    ).rejects.toBe(controller.signal.reason)
    expect(reads).toBe(0)
  })

  it.each([false, true])(
    'cancels a catalog wait without disrupting another caller (refresh=%s)',
    async (refresh) => {
      let onReceived = () => {}
      const received = new Promise<void>((resolve) => {
        onReceived = resolve
      })
      let release = () => {}
      let reads = 0
      let calls = 0
      stub = await startStubServer((cap) => (req, res) => {
        const handler = withCatalog((request, response) => {
          calls++
          if (refresh && calls === 1) {
            jsonResponder(
              412,
              { code: 'catalog_stale', message: 'Changed', status: 412 },
              cap,
            )(request, response)
          } else {
            jsonResponder(200, diffOutput, cap)(request, response)
          }
        })
        if (req.url === '/openapi/v1/_catalog') {
          reads++
          if (reads === (refresh ? 2 : 1)) {
            release = () => handler(req, res)
            onReceived()
            return
          }
        }
        handler(req, res)
      })
      const http = testHttpClient(stub.url)
      const controller = new AbortController()
      const pending = requestCatalogOperation(
        http,
        'knowledge_fs.diff',
        {
          workspace_id: 'ws',
          knowledge_space_id: 'space',
          ...diffInput,
        },
        { signal: controller.signal },
      )
      const cancelled = pending.catch((error) => error)
      await received
      const other = new KnowledgeFsClient(http).diff('ws', 'space', diffInput)
      try {
        controller.abort()
        // Assert rejection before releasing the server response, not merely eventual failure.
        await expect(pending).rejects.toBe(controller.signal.reason)
      } finally {
        release()
      }
      expect(await cancelled).toBe(controller.signal.reason)
      await expect(other).resolves.toEqual(diffOutput)
      expect(reads).toBe(refresh ? 2 : 1)
      expect(calls).toBe(refresh ? 2 : 1)
    },
  )

  it('refreshes once and rebuilds a rejected POST using the new route without losing its body', async () => {
    const updated = structuredClone(knowledgeFsCatalog)
    updated.ops['knowledge_fs.diff'].path += '-v2'
    let catalogReads = 0
    let executions = 0
    stub = await startStubServer((cap) => {
      const success = jsonResponder(200, diffOutput, cap)
      return (req, res) => {
        if (req.url === '/openapi/v1/_catalog') catalogReads++
        const document =
          catalogReads === 1 && req.url === '/openapi/v1/_catalog' ? knowledgeFsCatalog : updated
        withCatalog((request, response) => {
          executions++
          success(request, response)
        }, document)(req, res)
      }
    })
    const client = new KnowledgeFsClient(testHttpClient(stub.url, 'dfoa_test'))
    await expect(client.diff('ws', 'space', diffInput)).resolves.toEqual(diffOutput)
    expect(catalogReads).toBe(2)
    expect(executions).toBe(1)
    expect(stub.captured.url).toContain('fs:diff-v2')
    expect(JSON.parse(stub.captured.body ?? '{}')).toEqual(diffInput)
    expect(stub.captured.headers?.authorization).toBe('Bearer dfoa_test')
  })

  it('does not replay a POST after the refreshed schema requires a new input', async () => {
    const updated = structuredClone(knowledgeFsCatalog)
    updated.ops['knowledge_fs.diff'].input.required.push('mode')
    let reads = 0
    let executions = 0
    stub = await startStubServer((cap) => (req, res) => {
      if (req.url === '/openapi/v1/_catalog') reads++
      withCatalog(
        (request, response) => {
          executions++
          jsonResponder(200, diffOutput, cap)(request, response)
        },
        reads === 1 && req.url === '/openapi/v1/_catalog' ? knowledgeFsCatalog : updated,
      )(req, res)
    })
    const client = new KnowledgeFsClient(testHttpClient(stub.url))
    await expect(client.diff('ws', 'space', diffInput)).rejects.toMatchObject({
      code: 'version_skew',
    })
    expect(reads).toBe(2)
    expect(executions).toBe(0)
  })

  it('bounds catalog-stale retries even for POST', async () => {
    let calls = 0
    let reads = 0
    stub = await startStubServer((cap) =>
      withCatalog((req, res) => {
        calls++
        jsonResponder(
          412,
          { code: 'catalog_stale', message: 'Changed again', status: 412 },
          cap,
        )(req, res)
      }),
    )
    const http = testHttpClient(stub.url)
    const fetch = http.fetch
    const client = new KnowledgeFsClient({
      ...http,
      fetch: (path, opts) => {
        if (path === '_catalog') reads++
        return fetch(path, opts)
      },
    })
    await expect(client.diff('ws', 'space', diffInput)).rejects.toMatchObject({ httpStatus: 412 })
    expect(calls).toBe(2)
    expect(reads).toBe(2)
  })

  it('rejects a fingerprint that does not describe the downloaded catalog', async () => {
    stub = await startStubServer((cap) => jsonResponder(200, knowledgeFsCatalog, cap))
    const client = new KnowledgeFsClient(testHttpClient(stub.url))
    await expect(client.diff('ws', 'space', diffInput)).rejects.toMatchObject({
      code: 'version_skew',
    })
    expect(stub.captured.url).toBe('/openapi/v1/_catalog')
  })

  it('does not retry ordinary errors and shares the catalog across resource clients', async () => {
    let reads = 0
    let calls = 0
    stub = await startStubServer((cap) => (req, res) => {
      if (req.url === '/openapi/v1/_catalog') reads++
      withCatalog((request, response) => {
        calls++
        jsonResponder(
          403,
          { code: 'forbidden', message: 'No access', status: 403 },
          cap,
        )(request, response)
      })(req, res)
    })
    const http = testHttpClient(stub.url)
    for (let i = 0; i < 2; i++) {
      await expect(
        new KnowledgeFsClient(http).diff('ws', 'space', diffInput),
      ).rejects.toMatchObject({ httpStatus: 403 })
    }
    expect(reads).toBe(1)
    expect(calls).toBe(2)
  })
})

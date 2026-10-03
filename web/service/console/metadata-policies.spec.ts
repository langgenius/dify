import type { QueryKey } from '@tanstack/react-query'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from './index'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))

vi.mock('../base', () => ({ request }))

const dataset = consoleQuery.datasets.byDatasetId
const params = { dataset_id: 'dataset-1' }
const metadataKey = dataset.metadata.get.queryKey({ input: { params } })
const documentKeys = ['document-1', 'document-2'].map((document_id) =>
  dataset.documents.byDocumentId.get.queryKey({
    input: { params: { ...params, document_id }, query: { metadata: 'only' } },
  }),
)
const listKeys: QueryKey[] = [
  dataset.documents.get.queryKey({ input: { params, query: { page: '1' } } }),
  dataset.documents.get.queryKey({ input: { params, query: { page: '2' } } }),
  ['knowledge/document', 'documentList', params.dataset_id, { page: 1 }],
  ['knowledge/document', 'documentList', params.dataset_id, { page: 2 }],
]
const unrelatedKeys = [
  dataset.metadata.get.queryKey({ input: { params: { dataset_id: 'dataset-2' } } }),
  dataset.documents.byDocumentId.get.queryKey({
    input: { params: { dataset_id: 'dataset-2', document_id: 'other-document' } },
  }),
  ['knowledge/document', 'documentList', 'dataset-2'],
]

const mutations = [
  {
    name: 'create',
    method: 'POST',
    path: '/metadata',
    status: 201,
    affected: [metadataKey],
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(client, dataset.metadata.post.mutationOptions({ onSuccess })).mutate({
        params,
        body: { name: 'category', type: 'string' },
      }),
  },
  {
    name: 'rename',
    method: 'PATCH',
    path: '/metadata/field-1',
    status: 200,
    affected: [metadataKey, ...documentKeys, ...listKeys],
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(
        client,
        dataset.metadata.byMetadataId.patch.mutationOptions({ onSuccess }),
      ).mutate({
        params: { ...params, metadata_id: 'field-1' },
        body: { name: 'category' },
      }),
  },
  {
    name: 'delete',
    method: 'DELETE',
    path: '/metadata/field-1',
    status: 204,
    affected: [metadataKey, ...documentKeys, ...listKeys],
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(
        client,
        dataset.metadata.byMetadataId.delete.mutationOptions({ onSuccess }),
      ).mutate({
        params: { ...params, metadata_id: 'field-1' },
      }),
  },
  {
    name: 'enable built-ins',
    method: 'POST',
    path: '/metadata/built-in/enable',
    status: 204,
    affected: [metadataKey, ...documentKeys, ...listKeys],
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(
        client,
        dataset.metadata.builtIn.byAction.post.mutationOptions({ onSuccess }),
      ).mutate({
        params: { ...params, action: 'enable' },
      }),
  },
  {
    name: 'disable built-ins',
    method: 'POST',
    path: '/metadata/built-in/disable',
    status: 204,
    affected: [metadataKey, ...documentKeys, ...listKeys],
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(
        client,
        dataset.metadata.builtIn.byAction.post.mutationOptions({ onSuccess }),
      ).mutate({
        params: { ...params, action: 'disable' },
      }),
  },
  {
    name: 'update documents',
    method: 'POST',
    path: '/documents/metadata',
    status: 204,
    affected: [metadataKey, ...documentKeys, ...listKeys],
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(
        client,
        dataset.documents.metadata.post.mutationOptions({ onSuccess }),
      ).mutate({
        params,
        body: {
          operation_data: [
            {
              document_id: 'document-1',
              partial_update: true,
              metadata_list: [
                { id: 'field-1', name: 'count', value: 0 },
                { id: 'field-2', name: 'empty', value: '' },
                { id: 'field-3', name: 'cleared', value: null },
              ],
            },
          ],
        },
      }),
  },
]

describe('metadata mutation cache policy', () => {
  let client: QueryClient

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    for (const key of [metadataKey, ...documentKeys, ...listKeys, ...unrelatedKeys])
      client.setQueryData(key, { cached: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    client.clear()
    vi.restoreAllMocks()
  })

  it.each(mutations)(
    '$name refreshes affected views without touching another dataset',
    async ({ run, method, path, status, affected }) => {
      request.mockResolvedValue(
        status === 204
          ? new Response(null, { status })
          : Response.json({ id: 'field-1', name: 'category', type: 'string' }, { status }),
      )
      const onSuccess = vi.fn()

      await run(client, onSuccess)

      expect(onSuccess).toHaveBeenCalledOnce()
      const sent = request.mock.calls[0]![2].request
      expect(new URL(sent.url).pathname).toBe(`/console/api/datasets/dataset-1${path}`)
      expect(sent.method).toBe(method)
      for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
      for (const key of unrelatedKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
      if (path === '/documents/metadata') {
        expect(await sent.json()).toEqual({
          operation_data: [
            {
              document_id: 'document-1',
              partial_update: true,
              metadata_list: [
                { id: 'field-1', name: 'count', value: 0 },
                { id: 'field-2', name: 'empty', value: '' },
                { id: 'field-3', name: 'cleared', value: null },
              ],
            },
          ],
        })
      }
    },
  )

  it.each(mutations)('$name preserves rejection and skips success feedback', async ({ run }) => {
    request.mockResolvedValue(Response.json({ message: 'Permission denied' }, { status: 403 }))
    const onSuccess = vi.fn()

    await expect(run(client, onSuccess)).rejects.toThrow()

    expect(onSuccess).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledOnce()
    for (const key of [metadataKey, ...documentKeys, ...listKeys])
      expect(client.getQueryState(key)?.isInvalidated).toBe(false)
  })

  it('keeps a mutation pending until active metadata has refreshed', async () => {
    const initial = { doc_metadata: [], built_in_field_enabled: false }
    client.setQueryData(metadataKey, initial)
    let resolve!: (response: Response) => void
    const promise = new Promise<Response>((res) => {
      resolve = res
    })
    request.mockImplementation((_url, _init, { request: req }) =>
      req.method === 'GET'
        ? promise
        : Promise.resolve(
            Response.json({ id: 'field-1', name: 'category', type: 'string' }, { status: 201 }),
          ),
    )
    const query = new QueryObserver(
      client,
      dataset.metadata.get.queryOptions({ input: { params }, staleTime: Infinity }),
    )
    const unsubscribe = query.subscribe(() => {})
    const mutation = new MutationObserver(client, dataset.metadata.post.mutationOptions())
    const pending = mutation.mutate({ params, body: { name: 'category', type: 'string' } })
    try {
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
      expect(mutation.getCurrentResult().isPending).toBe(true)
      const refreshed = {
        ...initial,
        doc_metadata: [{ id: 'field-1', name: 'category', type: 'string', count: 0 }],
      }
      resolve(Response.json(refreshed))
      await pending
      expect(query.getCurrentResult().data).toEqual(refreshed)
      expect(mutation.getCurrentResult().isSuccess).toBe(true)
    } finally {
      resolve(Response.json(initial))
      unsubscribe()
    }
  })
})

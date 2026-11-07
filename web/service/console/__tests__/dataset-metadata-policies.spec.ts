import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { MutationObserver } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { createTestQueryClient } from '@/test/query-client'

const { mockCall } = vi.hoisted(() => ({ mockCall: vi.fn() }))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: mockCall },
}))

const params = { dataset_id: 'dataset-1' }

const datasetMetadataKey = consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
  input: { params },
})
const documentListKey = consoleQuery.datasets.byDatasetId.documents.get.queryKey({
  input: { params, query: { page: 1, limit: 10 } },
})
const documentMetadataKey = consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.queryKey({
  input: { params: { ...params, document_id: 'doc-1' }, query: { metadata: 'only' } },
})
const otherDatasetMetadataKey = consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
  input: { params: { dataset_id: 'dataset-2' } },
})

const seed = (queryClient: QueryClient, keys: QueryKey[]) => {
  keys.forEach((key) => queryClient.setQueryData(key, {}))
}

const isInvalidated = (queryClient: QueryClient, key: QueryKey) =>
  queryClient.getQueryState(key)?.isInvalidated ?? false

describe('dataset metadata cache policies', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    mockCall.mockResolvedValue({})
    queryClient = createTestQueryClient()
    seed(queryClient, [
      datasetMetadataKey,
      documentListKey,
      documentMetadataKey,
      otherDatasetMetadataKey,
    ])
  })

  it('refreshes the dataset fields after a field is created', async () => {
    await new MutationObserver(
      queryClient,
      consoleQuery.datasets.byDatasetId.metadata.post.mutationOptions(),
    ).mutate({ params, body: { name: 'author', type: 'string' } })

    expect(isInvalidated(queryClient, datasetMetadataKey)).toBe(true)
    expect(isInvalidated(queryClient, documentListKey)).toBe(false)
    expect(isInvalidated(queryClient, otherDatasetMetadataKey)).toBe(false)
  })

  it.each([
    [
      'renaming a field',
      () =>
        new MutationObserver(
          queryClient,
          consoleQuery.datasets.byDatasetId.metadata.byMetadataId.patch.mutationOptions(),
        ).mutate({ params: { ...params, metadata_id: 'field-1' }, body: { name: 'writer' } }),
    ],
    [
      'deleting a field',
      () =>
        new MutationObserver(
          queryClient,
          consoleQuery.datasets.byDatasetId.metadata.byMetadataId.delete.mutationOptions(),
        ).mutate({ params: { ...params, metadata_id: 'field-1' } }),
    ],
    [
      'editing document values',
      () =>
        new MutationObserver(
          queryClient,
          consoleQuery.datasets.byDatasetId.documents.metadata.post.mutationOptions(),
        ).mutate({ params, body: { operation_data: [] } }),
    ],
  ])('refreshes the fields, document list and document details after %s', async (_, run) => {
    await run()

    expect(isInvalidated(queryClient, datasetMetadataKey)).toBe(true)
    expect(isInvalidated(queryClient, documentListKey)).toBe(true)
    expect(isInvalidated(queryClient, documentMetadataKey)).toBe(true)
    expect(isInvalidated(queryClient, otherDatasetMetadataKey)).toBe(false)
  })

  it('refreshes the dataset fields after the built-in fields are toggled', async () => {
    await new MutationObserver(
      queryClient,
      consoleQuery.datasets.byDatasetId.metadata.builtIn.byAction.post.mutationOptions(),
    ).mutate({ params: { ...params, action: 'enable' } })

    expect(isInvalidated(queryClient, datasetMetadataKey)).toBe(true)
    expect(isInvalidated(queryClient, documentListKey)).toBe(false)
  })

  it('keeps the cache when the request fails', async () => {
    mockCall.mockRejectedValueOnce(new Error('failed'))

    await expect(
      new MutationObserver(
        queryClient,
        consoleQuery.datasets.byDatasetId.metadata.byMetadataId.delete.mutationOptions(),
      ).mutate({ params: { ...params, metadata_id: 'field-1' } }),
    ).rejects.toThrow('failed')

    expect(isInvalidated(queryClient, datasetMetadataKey)).toBe(false)
  })
})

import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { MutationObserver, QueryObserver } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { createMutationInvalidation } from '@/service/console/mutation-invalidation'
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

  const renameField = (client: QueryClient) =>
    new MutationObserver(
      client,
      consoleQuery.datasets.byDatasetId.metadata.byMetadataId.patch.mutationOptions(),
    ).mutate({ params: { ...params, metadata_id: 'field-1' }, body: { name: 'writer' } })
  const deleteField = (client: QueryClient) =>
    new MutationObserver(
      client,
      consoleQuery.datasets.byDatasetId.metadata.byMetadataId.delete.mutationOptions(),
    ).mutate({ params: { ...params, metadata_id: 'field-1' } })
  const editValues = (client: QueryClient) =>
    new MutationObserver(
      client,
      consoleQuery.datasets.byDatasetId.documents.metadata.post.mutationOptions(),
    ).mutate({ params, body: { operation_data: [] } })

  it.each([
    ['renaming a field', renameField, [datasetMetadataKey]],
    ['deleting a field', deleteField, [datasetMetadataKey, documentListKey, documentMetadataKey]],
    ['editing document values', editValues, [documentListKey, documentMetadataKey]],
  ])('refreshes what the flow reads next after %s', async (_, run, refreshed) => {
    await run(queryClient)

    for (const key of [datasetMetadataKey, documentListKey, documentMetadataKey])
      expect(isInvalidated(queryClient, key)).toBe(refreshed.includes(key))
    expect(isInvalidated(queryClient, otherDatasetMetadataKey)).toBe(false)
  })

  it.each([
    ['renaming a field', renameField],
    ['editing document values', editValues],
  ])('leaves the rest of the dataset to the invalidation fallback after %s', async (_, run) => {
    const client = createTestQueryClient(undefined, { invalidation: createMutationInvalidation() })
    seed(client, [datasetMetadataKey, documentListKey, documentMetadataKey])

    await run(client)

    expect(isInvalidated(client, datasetMetadataKey)).toBe(true)
    expect(isInvalidated(client, documentListKey)).toBe(true)
    expect(isInvalidated(client, documentMetadataKey)).toBe(true)
  })

  it('refreshes the dataset fields after the built-in fields are toggled', async () => {
    await new MutationObserver(
      queryClient,
      consoleQuery.datasets.byDatasetId.metadata.builtIn.byAction.post.mutationOptions(),
    ).mutate({ params: { ...params, action: 'enable' } })

    expect(isInvalidated(queryClient, datasetMetadataKey)).toBe(true)
    expect(isInvalidated(queryClient, documentListKey)).toBe(false)
  })

  it.each([
    ['enable', true],
    ['disable', false],
  ] as const)(
    'shows the built-in fields as %sd before the field list reloads',
    async (action, enabled) => {
      queryClient.setQueryData(datasetMetadataKey, {
        built_in_field_enabled: !enabled,
        doc_metadata: [],
      })
      let release!: () => void
      mockCall.mockImplementation((path: string[]) =>
        path.at(-1) === 'get'
          ? new Promise((resolve) => {
              release = () => resolve({ built_in_field_enabled: enabled, doc_metadata: [] })
            })
          : Promise.resolve({}),
      )
      const observer = new QueryObserver(
        queryClient,
        consoleQuery.datasets.byDatasetId.metadata.get.queryOptions({ input: { params } }),
      )
      const unsubscribe = observer.subscribe(() => {})

      const toggled = new MutationObserver(
        queryClient,
        consoleQuery.datasets.byDatasetId.metadata.builtIn.byAction.post.mutationOptions(),
      ).mutate({ params: { ...params, action } })

      await vi.waitFor(() => expect(release).toBeTypeOf('function'))
      expect(queryClient.getQueryData(datasetMetadataKey)).toMatchObject({
        built_in_field_enabled: enabled,
      })
      release()
      await toggled
      unsubscribe()
    },
  )

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

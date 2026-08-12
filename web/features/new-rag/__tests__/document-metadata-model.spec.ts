import { documentMetadataFieldsQueryOptions } from '../document-metadata-model'

const metadataGet = vi.hoisted(() => vi.fn())
const metadataQueryOptions = vi.hoisted(() => vi.fn(() => ({ queryKey: ['metadata'] })))

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          metadata: { get: metadataGet },
        },
      },
    },
  },
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          metadata: { get: { queryOptions: metadataQueryOptions } },
        },
      },
    },
  },
}))

describe('documentMetadataFieldsQueryOptions', () => {
  it('collects every cursor page before exposing metadata fields', async () => {
    metadataGet
      .mockResolvedValueOnce({
        data: [
          {
            count: 1,
            created_at: '2026-08-01T00:00:00Z',
            id: 'field-1',
            name: 'category',
            row_version: 1,
            type: 'string',
            updated_at: '2026-08-01T00:00:00Z',
          },
        ],
        next_cursor: 'page-2',
      })
      .mockResolvedValueOnce({
        data: [
          {
            count: 2,
            created_at: '2026-08-02T00:00:00Z',
            id: 'field-2',
            name: 'priority',
            row_version: 3,
            type: 'number',
            updated_at: '2026-08-03T00:00:00Z',
          },
        ],
        next_cursor: null,
      })

    const options = documentMetadataFieldsQueryOptions('space-1')
    const response = await options.queryFn()
    const fields = options.select(response)

    expect(metadataGet).toHaveBeenNthCalledWith(1, {
      params: { control_space_id: 'space-1' },
      query: { limit: 100 },
    })
    expect(metadataGet).toHaveBeenNthCalledWith(2, {
      params: { control_space_id: 'space-1' },
      query: { cursor: 'page-2', limit: 100 },
    })
    expect(fields.map((field) => field.name)).toEqual(['category', 'priority'])
  })
})

import type {
  DatasetListItemResponse,
  DatasetListResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import { knowledgeAction, knowledgeSearchQueryOptions } from '../knowledge'

const serviceMocks = vi.hoisted(() => ({ queryOptions: vi.fn((options) => options) }))

vi.mock('@/service/client', () => ({
  consoleQuery: { datasets: { get: { queryOptions: serviceMocks.queryOptions } } },
}))

function dataset(overrides: Partial<DatasetListItemResponse> = {}): DatasetListItemResponse {
  return {
    id: 'dataset-1',
    name: 'Knowledge',
    description: 'Description',
    provider: 'vendor',
    embedding_available: true,
    ...overrides,
  } as DatasetListItemResponse
}

function response(data: DatasetListItemResponse[]): DatasetListResponse {
  return { data, has_more: false, limit: 10, page: 1, total: data.length }
}

describe('knowledge search query', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exposes remote action metadata', () => {
    expect(knowledgeAction).toMatchObject({
      key: '@knowledge',
      shortcut: '@kb',
      source: 'remote',
    })
  })

  it('builds generated query options from the search term', () => {
    knowledgeSearchQueryOptions('vector')

    expect(serviceMocks.queryOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { query: { page: 1, limit: 10, keyword: 'vector' } },
        retry: false,
        select: expect.any(Function),
      }),
    )
  })

  it('selects paths from the dataset provider contract', () => {
    const options = knowledgeSearchQueryOptions('')
    const results = options.select!(
      response([dataset(), dataset({ id: 'external', provider: 'external' })]),
    )

    expect(results.map((result) => result.path)).toEqual([
      '/datasets/dataset-1/documents',
      '/datasets/external/hitTesting',
    ])
  })
})

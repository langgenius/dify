import type { DataSet } from '@/models/datasets'
import { knowledgeAction } from '../knowledge'

vi.mock('@/service/datasets', () => ({
  fetchDatasets: vi.fn(),
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}))

describe('knowledgeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct metadata', () => {
    expect(knowledgeAction.key).toBe('@knowledge')
    expect(knowledgeAction.shortcut).toBe('@kb')
  })

  it('returns parsed dataset results on success', async () => {
    const { fetchDatasets } = await import('@/service/datasets')
    vi.mocked(fetchDatasets).mockResolvedValue({
      data: [
        { id: 'ds-1', name: 'My Knowledge', description: 'A KB', provider: 'vendor', embedding_available: true } as unknown as DataSet,
      ],
      has_more: false,
      limit: 10,
      page: 1,
      total: 1,
    })

    const results = await knowledgeAction.search('@knowledge query', 'query', 'en')

    expect(fetchDatasets).toHaveBeenCalledWith({
      url: '/datasets',
      params: { page: 1, limit: 10, keyword: 'query' },
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'ds-1',
      title: 'My Knowledge',
      type: 'knowledge',
    })
  })

  it('generates correct path for external provider', async () => {
    const { fetchDatasets } = await import('@/service/datasets')
    vi.mocked(fetchDatasets).mockResolvedValue({
      data: [
        { id: 'ds-ext', name: 'External', description: '', provider: 'external', embedding_available: true } as unknown as DataSet,
      ],
      has_more: false,
      limit: 10,
      page: 1,
      total: 1,
    })

    const results = await knowledgeAction.search('@knowledge', '', 'en')

    expect(results[0].path).toBe('/datasets/ds-ext/hitTesting')
  })

  it('generates correct path for non-external provider', async () => {
    const { fetchDatasets } = await import('@/service/datasets')
    vi.mocked(fetchDatasets).mockResolvedValue({
      data: [
        { id: 'ds-2', name: 'Internal', description: '', provider: 'vendor', embedding_available: true } as unknown as DataSet,
      ],
      has_more: false,
      limit: 10,
      page: 1,
      total: 1,
    })

    const results = await knowledgeAction.search('@knowledge', '', 'en')

    expect(results[0].path).toBe('/datasets/ds-2/documents')
  })

  it('returns empty array on API failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { fetchDatasets } = await import('@/service/datasets')
    vi.mocked(fetchDatasets).mockRejectedValue(new Error('fail'))

    const results = await knowledgeAction.search('@knowledge', 'fail', 'en')
    expect(results).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('Knowledge search failed:', expect.any(Error))
    warnSpy.mockRestore()
  })
})

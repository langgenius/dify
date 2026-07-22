import type { Source } from '@dify/contracts/knowledge-fs/types.gen'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { SourcesPage } from '../sources-page'

const toastInfoMock = vi.hoisted(() => vi.fn())

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { info: toastInfoMock },
}))

type SourcesInfiniteOptions = {
  getNextPageParam: (lastPage: { nextCursor?: string }) => string | undefined
  input: (pageParam: string | null) => unknown
  initialPageParam: string | null
  refetchInterval: (query: {
    state: { data?: { pages: Array<{ items: Source[] }> } }
  }) => false | number
}

const sourcesQuery = vi.hoisted(() => ({
  data: undefined as { pages: Array<{ items: Source[]; nextCursor?: string }> } | undefined,
  error: null as unknown,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  isPending: false,
  refetch: vi.fn(),
}))

const infiniteOptionsMock = vi.hoisted(() => vi.fn((_options: SourcesInfiniteOptions) => ({})))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: () => sourcesQuery,
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      getKnowledgeSpacesByIdSources: {
        infiniteOptions: infiniteOptionsMock,
      },
    },
  },
}))

const source = (overrides: Partial<Source>): Source => ({
  createdAt: '2026-07-20T10:00:00Z',
  id: 'source-1',
  knowledgeSpaceId: 'space-1',
  metadata: {},
  name: 'Product documentation',
  status: 'active',
  type: 'web',
  updatedAt: '2026-07-20T10:00:00Z',
  uri: 'https://docs.example.com',
  ...overrides,
})

describe('SourcesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sourcesQuery.data = undefined
    sourcesQuery.error = null
    sourcesQuery.hasNextPage = false
    sourcesQuery.isFetchNextPageError = false
    sourcesQuery.isFetchingNextPage = false
    sourcesQuery.isPending = false
  })

  it('loads sources through the KnowledgeFS contract', () => {
    sourcesQuery.isPending = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const options = infiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected source infinite query options')
    expect(options.input(null)).toEqual({
      params: { id: 'space-1' },
      query: { limit: 50 },
    })
    expect(options.input('next')).toEqual({
      params: { id: 'space-1' },
      query: { cursor: 'next', limit: 50 },
    })
    expect(options.getNextPageParam({ nextCursor: 'next' })).toBe('next')
    expect(options.initialPageParam).toBeNull()
    expect(
      options.refetchInterval({
        state: { data: { pages: [{ items: [source({ status: 'syncing' })] }] } },
      }),
    ).toBe(2000)
    expect(
      options.refetchInterval({
        state: { data: { pages: [{ items: [source({ status: 'active' })] }] } },
      }),
    ).toBe(false)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders the designed empty state and enters the real add-source route', () => {
    sourcesQuery.data = { pages: [{ items: [] }] }

    const { container } = render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.sourcesEmptyTitle')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.sources' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'dataset.newKnowledge.addSource' })).toHaveAttribute(
      'href',
      '/datasets/new/space-1/sources/new',
    )
    for (const brand of ['firecrawl', 'jina', 'notion', 'google-drive', 'confluence', 'dropbox'])
      expect(container.querySelector(`[data-brand="${brand}"]`)).toBeInTheDocument()
    expect(container.querySelector('[data-brand="firecrawl"]')?.tagName).toBe('svg')
    expect(container.querySelector('[data-brand="jina"]')).toHaveClass('i-custom-public-llm-jina')
  })

  it('renders real source statuses and filters by status and search text', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({ id: 'active', name: 'Product documentation', status: 'active' }),
            source({ id: 'syncing', name: 'API reference', status: 'syncing' }),
            source({ id: 'disabled', name: 'Legacy FAQ', status: 'disabled' }),
            source({ id: 'error', name: 'Support site', status: 'error' }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getAllByText('dataset.newKnowledge.sourceStatus.active')).toHaveLength(2)
    expect(screen.getAllByText('dataset.newKnowledge.sourceStatus.syncing')).toHaveLength(2)
    expect(screen.getAllByText('dataset.newKnowledge.sourceStatus.disabled')).toHaveLength(2)
    expect(screen.getAllByText('dataset.newKnowledge.sourceStatus.error')).toHaveLength(2)

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.sourceFilterLabel' }),
      'error',
    )
    expect(screen.getByText('Support site')).toBeInTheDocument()
    expect(screen.queryByText('Product documentation')).not.toBeInTheDocument()

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.sourceFilterLabel' }),
      'all',
    )
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchSources' }),
      'api',
    )
    expect(screen.getByText('API reference')).toBeInTheDocument()
    expect(screen.queryByText('Support site')).not.toBeInTheDocument()
  })

  it('places the newest source first after creation', () => {
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({ id: 'older', name: 'Older source', createdAt: '2026-07-20T10:00:00Z' }),
            source({ id: 'newer', name: 'Newest source', createdAt: '2026-07-20T10:01:00Z' }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByText('Newest source')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Older source')).toBeInTheDocument()
  })

  it('keeps provisional crawl sources out of the source list', () => {
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              id: 'preview',
              metadata: { preview: true },
              name: 'Discarded preview',
              status: 'disabled',
            }),
            source({ id: 'connected', name: 'Connected source' }),
            source({
              id: 'submitted-preview',
              metadata: { preview: true },
              name: 'Submitted preview',
              status: 'syncing',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByText('Discarded preview')).not.toBeInTheDocument()
    expect(screen.getByText('Connected source')).toBeInTheDocument()
    expect(screen.getByText('Submitted preview')).toBeInTheDocument()
  })

  it('continues past cursor pages containing only hidden preview drafts', () => {
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              id: 'preview',
              metadata: { preview: true },
              status: 'disabled',
            }),
          ],
          nextCursor: 'next',
        },
      ],
    }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.sourcesEmptyTitle')).not.toBeInTheDocument()
  })

  it('continues after a loaded cursor page contributes only hidden preview drafts', () => {
    sourcesQuery.data = {
      pages: [
        { items: [source({ id: 'connected', name: 'Connected source' })] },
        {
          items: [
            source({
              id: 'preview',
              metadata: { preview: true },
              status: 'disabled',
            }),
          ],
          nextCursor: 'next',
        },
      ],
    }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('Connected source')).toBeInTheDocument()
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('keeps backend-dependent row actions available without pretending they work', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )

    const labels = [
      'dataset.newKnowledge.syncNow',
      'dataset.newKnowledge.editSource',
      'dataset.newKnowledge.disableSource',
      'dataset.newKnowledge.removeSource',
    ]
    for (const label of labels)
      expect(screen.getByRole('menuitem', { name: label })).not.toHaveAttribute('data-disabled')
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }))
    expect(toastInfoMock).toHaveBeenCalledWith('dataset.cornerLabel.unavailable')
  })

  it('offers a real retry when the source list cannot load', async () => {
    const user = userEvent.setup()
    sourcesQuery.error = new Error('temporary failure')

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(sourcesQuery.refetch).toHaveBeenCalledOnce()
  })

  it('loads the next real cursor page on demand', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})], nextCursor: 'next' }] }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))

    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('continues through cursor pages before declaring a filtered search empty', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})], nextCursor: 'next' }] }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchSources' }),
      'later page',
    )

    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(screen.queryByText('dataset.newKnowledge.noMatchingSources')).not.toBeInTheDocument()
  })

  it('announces automatic filtered pagination when some results already match', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [{ items: [source({ name: 'Product documentation' })], nextCursor: 'next' }],
    }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchSources' }),
      'product',
    )

    expect(screen.getByText('Product documentation')).toBeInTheDocument()
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('announces a filtered search with no matches', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchSources' }),
      'missing',
    )

    expect(screen.getByRole('status')).toHaveTextContent('dataset.newKnowledge.noMatchingSources')
  })

  it('stops automatic filtered pagination after a cursor error', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})], nextCursor: 'next' }] }
    sourcesQuery.hasNextPage = true
    sourcesQuery.isFetchNextPageError = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchSources' }),
      'later page',
    )

    expect(sourcesQuery.fetchNextPage).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.noMatchingSources')).not.toBeInTheDocument()
  })

  it('shows provider and source type as separate row details', () => {
    sourcesQuery.data = {
      pages: [{ items: [source({ metadata: { providerName: 'Firecrawl' } })] }],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('Firecrawl')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.sourceType.web')).toBeInTheDocument()
  })

  it('renders the designed source selection column and selects visible rows', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({ id: 'one', name: 'One source' }),
            source({ id: 'two', name: 'Two source' }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    const selectAll = screen.getByRole('checkbox', {
      name: 'dataset.newKnowledge.selectAllSources',
    })
    expect(screen.getByRole('checkbox', { name: 'One source' })).not.toBeChecked()

    await user.click(selectAll)

    expect(selectAll).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'One source' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Two source' })).toBeChecked()
  })
})

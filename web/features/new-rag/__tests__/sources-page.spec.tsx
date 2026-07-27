import type { Source } from '@dify/contracts/knowledge-fs/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import datasetTranslations from '@/i18n/en-US/dataset.json'
import { render } from '@/test/console/render'
import { SourcesPage } from '../sources-page'

const toastInfoMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())
const permissionState = vi.hoisted(() => ({
  workspacePermissionKeys: ['dataset.acl.edit', 'dataset.external.connect'],
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: toastErrorMock, info: toastInfoMock },
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => permissionState)
})

type SourcesInfiniteOptions = {
  getNextPageParam: (lastPage: { nextCursor?: string }) => string | undefined
  input: (pageParam: string | null) => unknown
  initialPageParam: string | null
  refetchInterval: (query: {
    state: {
      data?: { pages: Array<{ items: Source[] }> }
    }
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
const clientMock = vi.hoisted(() => ({
  deleteSource: vi.fn(),
  patchSource: vi.fn(),
  syncSource: vi.fn(),
}))
const invalidateQueriesMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: () => sourcesQuery,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      deleteKnowledgeSpacesByIdSourcesBySourceId: clientMock.deleteSource,
      patchKnowledgeSpacesByIdSourcesBySourceId: clientMock.patchSource,
      postKnowledgeSpacesByIdSourcesBySourceIdSync: clientMock.syncSource,
    },
  },
  consoleQuery: {
    knowledgeFs: {
      getKnowledgeSpacesByIdSources: {
        infiniteOptions: infiniteOptionsMock,
        key: vi.fn(() => ['sources']),
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
  version: 3,
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
    clientMock.deleteSource.mockResolvedValue({ status: 'accepted' })
    clientMock.patchSource.mockResolvedValue(source({}))
    clientMock.syncSource.mockResolvedValue({ state: 'queued' })
    permissionState.workspacePermissionKeys = ['dataset.acl.edit', 'dataset.external.connect']
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
    ).toBe(3000)
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
    expect(datasetTranslations['newKnowledge.sourcesEmptyDescription']).toBe(
      'Connect a website, workspace, or drive — Dify keeps it synced and fresh, so retrieval never breaks.',
    )
    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.sources' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'dataset.newKnowledge.addSource' })).toHaveAttribute(
      'href',
      '/datasets/new/space-1/sources/new',
    )
    for (const [brand, iconClass] of [
      ['firecrawl', 'i-custom-public-common-firecrawl'],
      ['jina', 'i-custom-public-llm-jina'],
      ['notion', 'i-custom-public-common-notion'],
      ['google-drive', 'i-custom-public-common-google-drive'],
      ['confluence', 'i-custom-public-common-confluence'],
      ['dropbox', 'i-custom-public-common-dropbox'],
    ] as const) {
      const icon = container.querySelector(`[data-brand="${brand}"]`)
      expect(icon).toBeInTheDocument()
      expect(icon?.tagName).toBe('SPAN')
      expect(icon).toHaveClass(iconClass)
    }
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

  it('sorts loaded sources by name from the source column header', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({ id: 'zulu', name: 'Zulu docs' }),
            source({ id: 'alpha', name: 'Alpha docs' }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.sourceColumn' }))
    const rowsAscending = screen.getAllByRole('row').slice(1)
    expect(within(rowsAscending[0]!).getByText('Alpha docs')).toBeInTheDocument()
    expect(within(rowsAscending[1]!).getByText('Zulu docs')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.sourceColumn' }))
    const rowsDescending = screen.getAllByRole('row').slice(1)
    expect(within(rowsDescending[0]!).getByText('Zulu docs')).toBeInTheDocument()
    expect(within(rowsDescending[1]!).getByText('Alpha docs')).toBeInTheDocument()
  })

  it('places the newest source first until the user selects a name sort', () => {
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
    expect(screen.queryByText('dataset.newKnowledge.sourcesEmptyTitle')).not.toBeInTheDocument()
  })

  it('continues when the newest loaded page contributes only hidden preview drafts', () => {
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

  it('opens a source URI from the row action menu', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )

    const openSource = screen.getByRole('menuitem', { name: 'common.operation.openInNewTab' })
    expect(openSource).toHaveAttribute('href', 'https://docs.example.com')
    expect(openSource).toHaveAttribute('target', '_blank')
    expect(openSource).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('hides the row action menu when a read-only source has no openable URI', () => {
    permissionState.workspacePermissionKeys = ['dataset.acl.readonly']
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              type: 'object-storage',
              uri: 's3://private-bucket/product-documentation',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(
      screen.queryByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    ).not.toBeInTheDocument()
  })

  it('uses dataset.external.connect for every source mutation action', async () => {
    const user = userEvent.setup()
    permissionState.workspacePermissionKeys = ['dataset.external.connect']
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )

    expect(
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.removeSource' }),
    ).toBeInTheDocument()
  })

  it('hides source mutations without dataset.external.connect', async () => {
    const user = userEvent.setup()
    permissionState.workspacePermissionKeys = ['dataset.acl.edit', 'dataset.create_and_management']
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )

    expect(
      screen.getByRole('menuitem', { name: 'common.operation.openInNewTab' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.removeSource' }),
    ).not.toBeInTheDocument()
  })

  it('syncs a source through the real KnowledgeFS action', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )

    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }))

    await waitFor(() =>
      expect(clientMock.syncSource).toHaveBeenCalledWith({
        headers: { 'Idempotency-Key': expect.any(String) },
        params: { id: 'space-1', sourceId: 'source-1' },
      }),
    )
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'dataset.newKnowledge.sourceStatus.syncing',
      ),
    ).toBeInTheDocument()
    const options = infiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected source infinite query options')
    expect(
      options.refetchInterval({
        state: { data: { pages: [{ items: [source({ status: 'active' })] }] } },
      }),
    ).toBe(3000)
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['sources'] })
  })

  it('disables and re-enables a source through the real patch endpoint', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({ id: 'active-source', name: 'Active source' }),
            source({ id: 'disabled', name: 'Disabled source', status: 'disabled' }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    const activeSourceActions = within(
      screen.getByRole('row', { name: /Active source/ }),
    ).getByRole('button', { name: /dataset.newKnowledge.sourceActions/ })
    const disabledSourceActions = within(
      screen.getByRole('row', { name: /Disabled source/ }),
    ).getByRole('button', { name: /dataset.newKnowledge.sourceActions/ })
    await user.click(activeSourceActions)
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }))
    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: { expectedVersion: 3, status: 'disabled' },
        params: { id: 'space-1', sourceId: 'active-source' },
      }),
    )

    await user.click(disabledSourceActions)
    await user.click(screen.getByRole('menuitem', { name: 'dataset.enable' }))
    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenLastCalledWith({
        body: { expectedVersion: 3, status: 'active' },
        params: { id: 'space-1', sourceId: 'disabled' },
      }),
    )
  })

  it('uses the returned source version while the list replica is stale', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }
    clientMock.patchSource
      .mockResolvedValueOnce(
        source({
          status: 'disabled',
          updatedAt: '2026-07-20T10:01:00Z',
          version: 4,
        }),
      )
      .mockResolvedValueOnce(
        source({
          status: 'active',
          updatedAt: '2026-07-20T10:02:00Z',
          version: 5,
        }),
      )

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }))

    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'dataset.newKnowledge.sourceStatus.disabled',
      ),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.enable' }))

    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenLastCalledWith({
        body: { expectedVersion: 4, status: 'active' },
        params: { id: 'space-1', sourceId: 'source-1' },
      }),
    )
  })

  it('requires confirmation before removing a source', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.removeSource' }))

    expect(clientMock.deleteSource).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.removeSource' }))
    await waitFor(() =>
      expect(clientMock.deleteSource).toHaveBeenCalledWith({
        body: { expectedRevision: 3 },
        headers: { 'idempotency-key': expect.any(String) },
        params: { id: 'space-1', sourceId: 'source-1' },
        query: { documents: 'keep' },
      }),
    )
    expect(screen.queryByText('Product documentation')).not.toBeInTheDocument()
  })

  it('keeps the removal confirmation open when the request fails', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({})] }] }
    clientMock.deleteSource.mockRejectedValue(new Error('temporary failure'))

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.removeSource' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.removeSource' }))

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('dataset.newKnowledge.sourcesErrorDescription'),
    )
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.removeSource' }),
    ).toBeInTheDocument()
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['sources'] })
  })

  it('retries an errored source and shows its queued state', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [source({ status: 'error' })] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() => expect(clientMock.syncSource).toHaveBeenCalledOnce())
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'dataset.newKnowledge.sourceStatus.syncing',
      ),
    ).toBeInTheDocument()
  })

  it('supports row selection and a true indeterminate select-all state', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: [{ items: [source({ id: 'first' }), source({ id: 'second' })] }],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
    const selectAll = checkboxes[0]
    const firstSource = checkboxes[1]
    const secondSource = checkboxes[2]
    if (!selectAll || !firstSource || !secondSource) throw new Error('Expected source checkboxes')
    await user.click(firstSource)
    expect(selectAll).toHaveAttribute('data-indeterminate')

    await user.click(selectAll)
    expect(firstSource).toBeChecked()
    expect(secondSource).toBeChecked()
  })

  it('offers a real retry when the source list cannot load', async () => {
    const user = userEvent.setup()
    sourcesQuery.error = new Error('temporary failure')

    render(<SourcesPage knowledgeSpaceId="space-1" />)
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

  it('continues from an empty cursor page when a later page exists', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = { pages: [{ items: [], nextCursor: 'next' }] }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByText('dataset.newKnowledge.sourcesEmptyTitle')).not.toBeInTheDocument()
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

  it('caps automatic filtered pagination and offers explicit continuation', async () => {
    const user = userEvent.setup()
    sourcesQuery.data = {
      pages: Array.from({ length: 4 }, (_, index) => ({
        items: [source({ id: `source-${index}`, name: `Source ${index}` })],
        nextCursor: `cursor-${index + 1}`,
      })),
    }
    sourcesQuery.hasNextPage = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchSources' }),
      'later page',
    )

    expect(sourcesQuery.fetchNextPage).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }),
    ).toBeInTheDocument()
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

  it('keeps read-only source viewing while hiding mutation and add-source actions', async () => {
    const user = userEvent.setup()
    permissionState.workspacePermissionKeys = ['dataset.acl.readonly']
    sourcesQuery.data = { pages: [{ items: [source({ status: 'error' })] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(
      screen.queryByRole('link', { name: 'dataset.newKnowledge.addSource' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    expect(
      screen.getByRole('menuitem', { name: 'common.operation.openInNewTab' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.removeSource' }),
    ).not.toBeInTheDocument()
  })
})

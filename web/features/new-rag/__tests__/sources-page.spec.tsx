import type { Source } from '../source-models'
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
const sourceApiResponse = vi.hoisted(() => (source: Source) => ({
  connection_id: source.connectionId ?? null,
  created_at: source.createdAt,
  credential_configured: source.credentialConfigured ?? null,
  id: source.id,
  knowledge_space_id: source.knowledgeSpaceId,
  metadata: source.metadata,
  name: source.name,
  permission_scope: source.permissionScope ?? [],
  status: source.status,
  type: source.type,
  updated_at: source.updatedAt,
  uri: source.uri,
  version: source.version ?? null,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: toastErrorMock, info: toastInfoMock },
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => permissionState)
})

type SourcesInfiniteOptions = {
  getNextPageParam: (lastPage: { next_cursor?: string | null }) => string | null | undefined
  input: (pageParam: string | null) => unknown
  initialPageParam: string | null
  refetchInterval: (query: {
    state: {
      data?: { pages: Array<{ data: ReturnType<typeof sourceApiResponse>[] }> }
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
const routerMock = vi.hoisted(() => ({ push: vi.fn() }))
const settingsState = vi.hoisted(() => ({
  configurationState: 'active' as 'active' | 'setup-required',
  refetch: vi.fn(),
}))
const workflowState = vi.hoisted(() => ({
  data: undefined as
    | {
        canceled_at: null
        checkpoint: string
        completed_at: null
        created_at: string
        execution_attempts: number
        id: string
        kind: string
        knowledge_space_id: string
        last_error_code: null
        max_execution_attempts: number
        progress_completed: number
        progress_failed: number
        progress_skipped: number
        progress_total: number
        source_id: string
        state: string
        updated_at: string
      }
    | undefined,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: () => ({
      ...sourcesQuery,
      data: sourcesQuery.data
        ? {
            pages: sourcesQuery.data.pages.map((page) => ({
              data: page.items.map(sourceApiResponse),
              next_cursor: page.nextCursor ?? null,
            })),
          }
        : undefined,
    }),
    useQuery: (options: { queryKey?: unknown[] }) =>
      options.queryKey?.[1] === 'source-workflow'
        ? { data: workflowState.data }
        : {
            data: {
              configuration_state: settingsState.configurationState,
              embedding: null,
              retrieval: null,
              revision: 1,
            },
            refetch: settingsState.refetch,
          },
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
  }
})
vi.mock('@/next/navigation', () => ({ useRouter: () => routerMock }))

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          sources: {
            bySourceId: {
              delete: clientMock.deleteSource,
              patch: async (input: unknown) =>
                sourceApiResponse(await clientMock.patchSource(input)),
              sync: { post: clientMock.syncSource },
            },
            get: {
              infiniteOptions: infiniteOptionsMock,
              key: vi.fn(() => ['sources']),
            },
          },
        },
      },
    },
  },
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          settings: {
            get: {
              queryOptions: ({ input }: { input: unknown }) => ({
                queryKey: ['knowledge-fs', 'settings', input],
              }),
            },
          },
          sourceWorkflows: {
            byRunId: {
              get: {
                queryOptions: ({ input }: { input: { params: { run_id: string } } }) => ({
                  queryKey: ['knowledge-fs', 'source-workflow', input.params.run_id],
                }),
              },
            },
          },
          sources: {
            get: {
              infiniteOptions: infiniteOptionsMock,
              key: vi.fn(() => ['sources']),
            },
          },
        },
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

const workflow = (state = 'queued') => ({
  canceled_at: null,
  checkpoint: 'sync',
  completed_at: null,
  created_at: '2026-07-20T10:00:00Z',
  execution_attempts: 1,
  id: 'workflow-1',
  kind: 'sync',
  knowledge_space_id: 'space-1',
  last_error_code: null,
  max_execution_attempts: 3,
  progress_completed: 0,
  progress_failed: 0,
  progress_skipped: 0,
  progress_total: 1,
  source_id: 'source-1',
  state,
  updated_at: '2026-07-20T10:00:00Z',
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
    workflowState.data = undefined
    clientMock.syncSource.mockResolvedValue(workflow())
    permissionState.workspacePermissionKeys = ['dataset.acl.edit', 'dataset.external.connect']
    settingsState.configurationState = 'active'
    settingsState.refetch.mockImplementation(async () => ({
      data: {
        configuration_state: settingsState.configurationState,
        embedding: null,
        retrieval: null,
        revision: 1,
      },
      isError: false,
    }))
  })

  it('loads sources through the KnowledgeFS contract', () => {
    sourcesQuery.isPending = true

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    const options = infiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected source infinite query options')
    expect(options.input(null)).toEqual({
      params: { control_space_id: 'space-1' },
      query: { limit: 50 },
    })
    expect(options.input('next')).toEqual({
      params: { control_space_id: 'space-1' },
      query: { cursor: 'next', limit: 50 },
    })
    expect(options.getNextPageParam({ next_cursor: 'next' })).toBe('next')
    expect(options.initialPageParam).toBeNull()
    expect(
      options.refetchInterval({
        state: {
          data: { pages: [{ data: [sourceApiResponse(source({ status: 'syncing' }))] }] },
        },
      }),
    ).toBe(3000)
    expect(
      options.refetchInterval({
        state: {
          data: { pages: [{ data: [sourceApiResponse(source({ status: 'active' }))] }] },
        },
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
      ['more', 'i-ri-more-fill'],
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

    expect(screen.getByText('dataset.newKnowledge.sourceStatus.active')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.sourceStatus.syncing')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.sourceStatus.disabled')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.sourceStatus.error')).toBeInTheDocument()

    const sourceFilter = screen.getByRole('combobox', {
      name: 'dataset.newKnowledge.sourceFilterLabel',
    })
    await user.click(sourceFilter)
    await user.click(
      screen.getByRole('option', { name: 'dataset.newKnowledge.sourceStatus.error' }),
    )
    expect(screen.getByText('Support site')).toBeInTheDocument()
    expect(screen.queryByText('Product documentation')).not.toBeInTheDocument()

    await user.click(sourceFilter)
    await user.click(screen.getByRole('option', { name: 'dataset.newKnowledge.allSources' }))
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

    const openSource = screen.getByRole('menuitem', {
      name: 'dataset.newKnowledge.editSource',
    })
    expect(openSource).toHaveAttribute('href', 'https://docs.example.com')
    expect(openSource).toHaveAttribute('target', '_blank')
    expect(openSource).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('opens an Amazon S3 source in the AWS console for read-only users', async () => {
    const user = userEvent.setup()
    permissionState.workspacePermissionKeys = ['dataset.acl.readonly']
    sourcesQuery.data = {
      pages: [
        {
          items: [
            source({
              type: 'object-storage',
              uri: 's3://private-bucket/Product%20documentation/文档',
            }),
          ],
        },
      ],
    }

    render(<SourcesPage knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    expect(
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.editSource' }),
    ).toHaveAttribute(
      'href',
      'https://s3.console.aws.amazon.com/s3/buckets/private-bucket?prefix=Product+documentation%2F%E6%96%87%E6%A1%A3',
    )
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
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.editSource' }),
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
    let finishRefresh: (() => void) | undefined
    invalidateQueriesMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        }),
    )

    const { rerender } = render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )

    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }))

    await waitFor(() =>
      expect(clientMock.syncSource).toHaveBeenCalledWith({
        headers: { 'Idempotency-Key': expect.any(String) },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'dataset.newKnowledge.sourceStatus.syncing',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'dataset.newKnowledge.sourceSyncProgress:{"completed":0,"total":1}',
      ),
    ).toBeInTheDocument()
    finishRefresh?.()
    workflowState.data = workflow('completed')
    rerender(<SourcesPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
          'dataset.newKnowledge.sourceStatus.active',
        ),
      ).toBeInTheDocument(),
    )
    const options = infiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected source infinite query options')
    expect(
      options.refetchInterval({
        state: {
          data: { pages: [{ data: [sourceApiResponse(source({ status: 'active' }))] }] },
        },
      }),
    ).toBe(false)
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['sources'] })
  })

  it('prompts for model setup before syncing a source', async () => {
    const user = userEvent.setup()
    settingsState.configurationState = 'setup-required'
    sourcesQuery.data = { pages: [{ items: [source({})] }] }

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.sourceActions:{"name":"Product documentation"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'dataset.newKnowledge.syncNow' }))

    expect(clientMock.syncSource).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', {
      name: 'common.modelProvider.toBeConfigured',
    })
    await user.click(
      within(dialog).getByRole('button', {
        name: 'common.modelProvider.selector.configure',
      }),
    )
    expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/settings')
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
        params: { control_space_id: 'space-1', source_id: 'active-source' },
      }),
    )

    await user.click(disabledSourceActions)
    await user.click(screen.getByRole('menuitem', { name: 'dataset.enable' }))
    await waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenLastCalledWith({
        body: { expectedVersion: 3, status: 'active' },
        params: { control_space_id: 'space-1', source_id: 'disabled' },
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
        params: { control_space_id: 'space-1', source_id: 'source-1' },
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
        headers: { 'Idempotency-Key': expect.any(String) },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
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
    let finishRefresh: (() => void) | undefined
    invalidateQueriesMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        }),
    )

    render(<SourcesPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() => expect(clientMock.syncSource).toHaveBeenCalledOnce())
    expect(
      within(screen.getByRole('row', { name: /Product documentation/ })).getByText(
        'dataset.newKnowledge.sourceStatus.syncing',
      ),
    ).toBeInTheDocument()
    finishRefresh?.()
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
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.editSource' }),
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

import type {
  GetKnowledgeSpacesByIdSourceConnectionsResponse,
  GetSourceProvidersResponse,
} from '@dify/contracts/knowledge-fs/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { AddSourcePage } from '../add-source-page'

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const toastInfoMock = vi.hoisted(() => vi.fn())

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { info: toastInfoMock },
}))

type ConnectionsInfiniteData = {
  pages: GetKnowledgeSpacesByIdSourceConnectionsResponse[]
}

type ConnectionsInfiniteOptions = {
  getNextPageParam: (
    lastPage: GetKnowledgeSpacesByIdSourceConnectionsResponse,
  ) => string | undefined
  input: (pageParam: string | null) => unknown
  initialPageParam: string | null
}

const queryState = vi.hoisted(() => ({
  connections: {
    data: { pages: [{ items: [] }] } as ConnectionsInfiniteData | undefined,
    error: null as unknown,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    isPending: false,
    refetch: vi.fn(),
  },
  providers: {
    data: undefined as GetSourceProvidersResponse | undefined,
    error: null as unknown,
    isPending: false,
    refetch: vi.fn(),
  },
}))

const clientMock = vi.hoisted(() => ({
  createConnection: vi.fn(),
  refreshConnection: vi.fn(),
}))

const queryClientMock = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}))

const providerQueryOptionsMock = vi.hoisted(() => vi.fn(() => ({ queryKey: ['source-providers'] })))
const connectionInfiniteOptionsMock = vi.hoisted(() =>
  vi.fn((_options: ConnectionsInfiniteOptions) => ({ queryKey: ['source-connections'] })),
)

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: () => queryState.connections,
    useQuery: () => queryState.providers,
    useQueryClient: () => queryClientMock,
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      postKnowledgeSpacesByIdSourceConnections: clientMock.createConnection,
      postKnowledgeSpacesByIdSourceConnectionsByConnectionIdRefresh: clientMock.refreshConnection,
    },
  },
  consoleQuery: {
    knowledgeFs: {
      getSourceProviders: {
        queryOptions: providerQueryOptionsMock,
      },
      getKnowledgeSpacesByIdSourceConnections: {
        infiniteOptions: connectionInfiniteOptionsMock,
        key: vi.fn(() => ['source-connections']),
      },
    },
  },
}))

const firecrawlProvider: GetSourceProvidersResponse['items'][number] = {
  authKinds: ['api-key', 'endpoint'],
  available: true,
  capabilities: ['website-crawl'],
  configuration: [
    {
      description: 'Plugin identifier',
      name: 'pluginId',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      description: 'Plugin provider',
      name: 'provider',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      description: 'Plugin datasource',
      name: 'datasource',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      description: 'Firecrawl API key',
      format: 'password',
      name: 'apiKey',
      required: true,
      secret: true,
      type: 'string',
    },
    {
      description: 'Self-hosted endpoint',
      format: 'uri',
      name: 'endpoint',
      required: false,
      secret: false,
      type: 'string',
    },
  ],
  displayName: 'Plugin daemon website crawl',
  id: 'plugin-daemon-website',
}

const connection = (
  status: 'provisioning' | 'active' | 'expired' | 'error' | 'revoked',
  version = 2,
) => ({
  authKind: 'api-key' as const,
  configuration: {
    datasource: 'crawl',
    pluginId: 'langgenius/firecrawl_datasource',
    provider: 'firecrawl',
  },
  createdAt: '2026-07-20T10:00:00Z',
  id: 'connection-1',
  knowledgeSpaceId: 'space-1',
  name: 'Firecrawl',
  providerId: 'plugin-daemon-website',
  scopes: [],
  status,
  updatedAt: '2026-07-20T10:00:00Z',
  version,
})

describe('AddSourcePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMock.createConnection.mockReset()
    clientMock.refreshConnection.mockReset()
    queryState.connections.refetch.mockReset()
    queryState.providers.refetch.mockReset()
    queryState.providers.data = { items: [firecrawlProvider] }
    queryState.providers.error = null
    queryState.providers.isPending = false
    queryState.connections.data = { pages: [{ items: [] }] }
    queryState.connections.error = null
    queryState.connections.hasNextPage = false
    queryState.connections.isFetchNextPageError = false
    queryState.connections.isFetchingNextPage = false
    queryState.connections.isPending = false
  })

  it('loads the provider catalog and every scoped connection cursor page', () => {
    queryState.providers.isPending = true

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(providerQueryOptionsMock).toHaveBeenCalledWith({
      context: { silent: true },
      input: {},
      retry: false,
    })
    const options = connectionInfiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected connection infinite query options')
    expect(options.input(null)).toEqual({ params: { id: 'space-1' }, query: { limit: 200 } })
    expect(options.input('next')).toEqual({
      params: { id: 'space-1' },
      query: { cursor: 'next', limit: 200 },
    })
    expect(options.getNextPageParam({ items: [], nextCursor: 'next' })).toBe('next')
    expect(options.initialPageParam).toBeNull()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('continues loading connection pages automatically', async () => {
    queryState.connections.hasNextPage = true

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(queryState.connections.fetchNextPage).toHaveBeenCalledOnce())
  })

  it('stops automatic connection pagination after a cursor error', () => {
    queryState.connections.error = new Error('next page failed')
    queryState.connections.hasNextPage = true
    queryState.connections.isFetchNextPageError = true

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(queryState.connections.fetchNextPage).not.toHaveBeenCalled()
    expect(screen.getByText('dataset.newKnowledge.providerLoadFailed')).toBeInTheDocument()
  })

  it('finds the provider connection on a later loaded page', () => {
    queryState.connections.data = { pages: [{ items: [] }, { items: [connection('active')] }] }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.providerConnected')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: /dataset\.newKnowledge\.rootUrl/ })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }),
    ).toBeDisabled()
  })

  it('creates the exact Firecrawl provider connection without leaking credentials', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockResolvedValue(connection('active'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.configureProvider' }))
    await user.type(screen.getByLabelText(/Api Key/), 'secret-value')
    await user.type(screen.getByLabelText('Endpoint'), 'https://crawl.example.com')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.connectProvider' }))

    await waitFor(() =>
      expect(clientMock.createConnection).toHaveBeenCalledWith({
        body: {
          authKind: 'api-key',
          configuration: {
            datasource: 'crawl',
            endpoint: 'https://crawl.example.com',
            pluginId: 'langgenius/firecrawl_datasource',
            provider: 'firecrawl',
          },
          credentials: { apiKey: 'secret-value' },
          name: 'Firecrawl',
          providerId: 'plugin-daemon-website',
        },
        params: { id: 'space-1' },
      }),
    )
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['source-connections'],
    })
    expect(screen.getByText('dataset.newKnowledge.providerConnected')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('secret-value')).not.toBeInTheDocument()
  })

  it('does not select a lookalike provider by fuzzy display name', () => {
    queryState.providers.data = {
      items: [{ ...firecrawlProvider, displayName: 'Firecrawl impostor', id: 'impostor' }],
    }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.firecrawlUnavailable')).toBeInTheDocument()
  })

  it('clears sensitive input but retains non-sensitive input after a connection error', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockRejectedValue(new Error('provider unavailable'))
    queryState.connections.refetch.mockResolvedValue({ data: queryState.connections.data })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.configureProvider' }))
    await user.type(screen.getByLabelText(/Api Key/), 'do-not-retain')
    await user.type(screen.getByLabelText('Endpoint'), 'https://crawl.example.com')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.connectProvider' }))

    expect(await screen.findByText('dataset.newKnowledge.connectionFailed')).toBeInTheDocument()
    expect(screen.getByLabelText(/Api Key/)).toHaveValue('')
    expect(screen.getByLabelText('Endpoint')).toHaveValue('https://crawl.example.com')
  })

  it('reconciles a response-lost create before showing an error', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockRejectedValue(new Error('response lost'))
    queryState.connections.refetch.mockResolvedValue({
      data: { pages: [{ items: [connection('active')] }] },
    })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.configureProvider' }))
    await user.type(screen.getByLabelText(/Api Key/), 'secret-value')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.connectProvider' }))

    expect(await screen.findByText('dataset.newKnowledge.providerConnected')).toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.connectionFailed')).not.toBeInTheDocument()
  })

  it('clears an API key when authentication modes are changed and changed back', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockResolvedValue(connection('active'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.configureProvider' }))
    await user.type(screen.getByLabelText(/Api Key/), 'must-not-return')
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.authKind.endpoint' }))
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.authKind.api-key' }))

    expect(screen.getByLabelText(/Api Key/)).toHaveValue('')
  })

  it('supports an endpoint descriptor without sending a hidden secret field', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockResolvedValue({ ...connection('active'), authKind: 'endpoint' })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.configureProvider' }))
    await user.type(screen.getByLabelText(/Api Key/), 'must-not-be-sent')
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.authKind.endpoint' }))
    await user.type(screen.getByLabelText('Endpoint'), 'https://crawl.example.com')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.connectProvider' }))

    await waitFor(() =>
      expect(clientMock.createConnection).toHaveBeenCalledWith({
        body: {
          authKind: 'endpoint',
          configuration: {
            datasource: 'crawl',
            endpoint: 'https://crawl.example.com',
            pluginId: 'langgenius/firecrawl_datasource',
            provider: 'firecrawl',
          },
          credentials: {},
          name: 'Firecrawl',
          providerId: 'plugin-daemon-website',
        },
        params: { id: 'space-1' },
      }),
    )
  })

  it('associates provider field descriptions with their controls', async () => {
    const user = userEvent.setup()
    const booleanProvider = {
      ...firecrawlProvider,
      configuration: [
        ...firecrawlProvider.configuration,
        {
          description: 'Use stealth mode',
          name: 'stealth',
          required: false,
          secret: false,
          type: 'boolean' as const,
        },
      ],
    }
    queryState.providers.data = { items: [booleanProvider] }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.configureProvider' }))

    expect(screen.getByLabelText(/Api Key/)).toHaveAccessibleDescription('Firecrawl API key')
    expect(screen.getByLabelText('Stealth')).toHaveAccessibleDescription('Use stealth mode')
  })

  it('refreshes an errored connection using its current version', async () => {
    const user = userEvent.setup()
    queryState.connections.data = { pages: [{ items: [connection('error')] }] }
    clientMock.refreshConnection.mockResolvedValue(connection('active'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() =>
      expect(clientMock.refreshConnection).toHaveBeenCalledWith({
        body: { expectedVersion: 2 },
        params: { connectionId: 'connection-1', id: 'space-1' },
      }),
    )
    expect(queryClientMock.invalidateQueries).toHaveBeenCalled()
    expect(screen.getByText('dataset.newKnowledge.providerConnected')).toBeInTheDocument()
  })

  it('reconciles a refresh version race and retries with the server version', async () => {
    const user = userEvent.setup()
    queryState.connections.data = { pages: [{ items: [connection('error')] }] }
    clientMock.refreshConnection
      .mockRejectedValueOnce(new Error('version conflict'))
      .mockResolvedValueOnce(connection('active', 4))
    queryState.connections.refetch.mockResolvedValue({
      data: {
        pages: [
          {
            items: [
              connection('error', 3),
              {
                ...connection('error', 8),
                id: 'connection-2',
                updatedAt: '2026-07-20T11:00:00Z',
              },
            ],
          },
        ],
      },
    })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(queryState.connections.refetch).toHaveBeenCalledOnce())
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() =>
      expect(clientMock.refreshConnection).toHaveBeenLastCalledWith({
        body: { expectedVersion: 3 },
        params: { connectionId: 'connection-1', id: 'space-1' },
      }),
    )
  })

  it('does not regress the current version when reconciliation reads a stale replica', async () => {
    const user = userEvent.setup()
    queryState.connections.data = { pages: [{ items: [connection('error', 3)] }] }
    clientMock.refreshConnection
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(connection('active', 4))
    queryState.connections.refetch.mockResolvedValue({
      data: { pages: [{ items: [connection('error', 2)] }] },
    })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(queryState.connections.refetch).toHaveBeenCalledOnce())
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() =>
      expect(clientMock.refreshConnection).toHaveBeenLastCalledWith({
        body: { expectedVersion: 3 },
        params: { connectionId: 'connection-1', id: 'space-1' },
      }),
    )
  })

  it('lets a newer remote connection version replace a local mutation response', async () => {
    const user = userEvent.setup()
    queryState.connections.data = { pages: [{ items: [connection('error')] }] }
    clientMock.refreshConnection.mockResolvedValue(connection('provisioning', 3))

    const view = render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(
      await screen.findByText('dataset.newKnowledge.connectionProvisioning'),
    ).toBeInTheDocument()

    queryState.connections.data = {
      pages: [
        {
          items: [
            connection('active', 3),
            {
              ...connection('active', 10),
              id: 'connection-2',
              updatedAt: '2026-07-20T11:00:00Z',
            },
          ],
        },
      ],
    }
    view.rerender(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.providerConnected')).toBeInTheDocument()
  })

  it('reconciles a provisioning connection with the refreshed server state', async () => {
    const user = userEvent.setup()
    queryState.connections.data = { pages: [{ items: [connection('provisioning')] }] }
    queryState.connections.refetch.mockResolvedValue({
      data: { pages: [{ items: [connection('active')] }] },
    })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.refreshConnectionStatus' }),
    )

    expect(await screen.findByText('dataset.newKnowledge.providerConnected')).toBeInTheDocument()
  })

  it('shows a retryable error when provisioning reconciliation fails', async () => {
    const user = userEvent.setup()
    queryState.connections.data = { pages: [{ items: [connection('provisioning')] }] }
    queryState.connections.refetch.mockResolvedValue({
      data: queryState.connections.data,
      error: new Error('temporary failure'),
    })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.refreshConnectionStatus' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.connectionRefreshFailed',
    )
  })

  it('shows a retryable error when provisioning reconciliation finds no connection', async () => {
    const user = userEvent.setup()
    queryState.connections.data = { pages: [{ items: [connection('provisioning')] }] }
    queryState.connections.refetch.mockImplementation(async () => {
      queryState.connections.data = { pages: [{ items: [] }] }
      return { data: queryState.connections.data }
    })

    const view = render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.refreshConnectionStatus' }),
    )
    view.rerender(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.connectionRefreshFailed',
    )
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.configureProvider' }),
    ).not.toBeInTheDocument()
  })

  it('keeps source types selectable and shows an honest dependency state', async () => {
    const user = userEvent.setup()
    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.websiteCrawl' })).toBeChecked()
    const onlineDocuments = screen.getByRole('radio', {
      name: 'dataset.newKnowledge.onlineDocuments',
    })
    expect(onlineDocuments).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDrive' })).toBeEnabled()
    expect(screen.queryByText('Jina Reader')).not.toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'datasetCreation.stepOne.website.chooseProvider' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()

    await user.click(onlineDocuments)
    expect(onlineDocuments).toBeChecked()
    expect(
      screen.queryByRole('group', { name: 'datasetCreation.stepOne.website.chooseProvider' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('dataset.newKnowledge.providerUnavailable')
  })

  it('keeps the final Add source action interactive with dependency feedback', async () => {
    const user = userEvent.setup()
    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDocuments' }))
    const addSource = screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })
    expect(addSource).toBeEnabled()
    await user.click(addSource)
    expect(toastInfoMock).toHaveBeenCalledWith(
      'dataset.newKnowledge.crawlSetupUnavailableDescription',
    )
  })

  it('shows catalog unavailability instead of offering a fake connection', () => {
    queryState.providers.data = {
      items: [{ ...firecrawlProvider, available: false, unavailableReason: 'Disabled by admin' }],
    }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('Disabled by admin')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.configureProvider' }),
    ).not.toBeInTheDocument()
  })

  it('does not offer unsupported OAuth or undocumented direct connection paths', () => {
    queryState.providers.data = {
      items: [
        {
          ...firecrawlProvider,
          authKinds: ['oauth2'],
          configuration: firecrawlProvider.configuration.slice(0, 3),
        },
      ],
    }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.providerUnavailable')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.configureProvider' }),
    ).not.toBeInTheDocument()
  })
})

import type {
  GetKnowledgeSpacesByIdSourceConnectionsResponse,
  GetSourceProvidersResponse,
} from '@dify/contracts/knowledge-fs/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { AddSourcePage } from '../add-source-page'

const queryState = vi.hoisted(() => ({
  connections: {
    data: { items: [] } as GetKnowledgeSpacesByIdSourceConnectionsResponse | undefined,
    error: null as unknown,
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

const providerQueryOptionsMock = vi.hoisted(() => vi.fn(() => ({ queryKey: ['source-providers'] })))
const connectionQueryOptionsMock = vi.hoisted(() =>
  vi.fn(() => ({ queryKey: ['source-connections'] })),
)

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useQuery: (options: { queryKey?: string[] }) =>
      options.queryKey?.[0] === 'source-providers' ? queryState.providers : queryState.connections,
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
        queryOptions: connectionQueryOptionsMock,
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
  displayName: 'Firecrawl',
  id: 'firecrawl',
}

const connection = (status: 'provisioning' | 'active' | 'expired' | 'error' | 'revoked') => ({
  authKind: 'api-key' as const,
  configuration: { endpoint: 'https://crawl.example.com' },
  createdAt: '2026-07-20T10:00:00Z',
  id: 'connection-1',
  knowledgeSpaceId: 'space-1',
  name: 'Firecrawl',
  providerId: 'firecrawl',
  scopes: [],
  status,
  updatedAt: '2026-07-20T10:00:00Z',
  version: 2,
})

describe('AddSourcePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryState.providers.data = { items: [firecrawlProvider] }
    queryState.providers.error = null
    queryState.providers.isPending = false
    queryState.connections.data = { items: [] }
    queryState.connections.error = null
    queryState.connections.isPending = false
  })

  it('loads the provider catalog and scoped connections from KnowledgeFS', () => {
    queryState.providers.isPending = true

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(providerQueryOptionsMock).toHaveBeenCalledWith({ input: {} })
    expect(connectionQueryOptionsMock).toHaveBeenCalledWith({
      input: { params: { id: 'space-1' }, query: { limit: 200 } },
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('creates a Firecrawl connection and never places credentials in non-secret configuration', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockResolvedValue(connection('active'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.configureProvider' }))
    await user.type(screen.getByLabelText('Api Key'), 'secret-value')
    await user.type(screen.getByLabelText('Endpoint'), 'https://crawl.example.com')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.connectProvider' }))

    await waitFor(() =>
      expect(clientMock.createConnection).toHaveBeenCalledWith({
        body: {
          authKind: 'api-key',
          configuration: { endpoint: 'https://crawl.example.com' },
          credentials: { apiKey: 'secret-value' },
          name: 'Firecrawl',
          providerId: 'firecrawl',
        },
        params: { id: 'space-1' },
      }),
    )
    expect(screen.getByText('dataset.newKnowledge.providerConnected')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('secret-value')).not.toBeInTheDocument()
  })

  it('clears sensitive input but retains non-sensitive input after a connection error', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockRejectedValue(new Error('provider unavailable'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.configureProvider' }))
    await user.type(screen.getByLabelText('Api Key'), 'do-not-retain')
    await user.type(screen.getByLabelText('Endpoint'), 'https://crawl.example.com')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.connectProvider' }))

    expect(await screen.findByText('dataset.newKnowledge.connectionFailed')).toBeInTheDocument()
    expect(screen.getByLabelText('Api Key')).toHaveValue('')
    expect(screen.getByLabelText('Endpoint')).toHaveValue('https://crawl.example.com')
  })

  it('supports endpoint authentication without requiring or sending a secret field', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockResolvedValue({ ...connection('active'), authKind: 'endpoint' })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.configureProvider' }))
    await user.type(screen.getByLabelText('Api Key'), 'must-not-be-sent')
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.authKind.endpoint' }))
    expect(screen.queryByLabelText('Api Key')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Endpoint'), 'https://crawl.example.com')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.connectProvider' }))

    await waitFor(() =>
      expect(clientMock.createConnection).toHaveBeenCalledWith({
        body: {
          authKind: 'endpoint',
          configuration: { endpoint: 'https://crawl.example.com' },
          credentials: {},
          name: 'Firecrawl',
          providerId: 'firecrawl',
        },
        params: { id: 'space-1' },
      }),
    )
  })

  it('refreshes an errored connection using its current version', async () => {
    const user = userEvent.setup()
    queryState.connections.data = { items: [connection('error')] }
    clientMock.refreshConnection.mockResolvedValue(connection('active'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() =>
      expect(clientMock.refreshConnection).toHaveBeenCalledWith({
        body: { expectedVersion: 2 },
        params: { connectionId: 'connection-1', id: 'space-1' },
      }),
    )
    expect(screen.getByText('dataset.newKnowledge.providerConnected')).toBeInTheDocument()
  })

  it('reconciles a provisioning connection with the refreshed server state', async () => {
    const user = userEvent.setup()
    queryState.connections.data = { items: [connection('provisioning')] }
    queryState.connections.refetch.mockResolvedValue({ data: { items: [connection('active')] } })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.refreshConnectionStatus' }),
    )

    expect(await screen.findByText('dataset.newKnowledge.providerConnected')).toBeInTheDocument()
  })

  it('keeps out-of-scope source types and providers disabled', () => {
    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.onlineDocuments' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.onlineDrive' })).toBeDisabled()
    expect(screen.queryByText('Jina Reader')).not.toBeInTheDocument()
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

  it('does not offer the out-of-scope OAuth connection path', () => {
    queryState.providers.data = {
      items: [{ ...firecrawlProvider, authKinds: ['oauth2'] }],
    }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.providerUnavailable')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.configureProvider' }),
    ).not.toBeInTheDocument()
  })
})

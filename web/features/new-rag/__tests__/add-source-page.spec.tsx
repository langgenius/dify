import type { DatasourceProviderAuthListResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { NewKnowledgeSourceDraft } from '../routes'
import type { SourceConnection, SourceProvider } from '../source-models'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { render } from '@/test/console/render'
import { AddSourcePage } from '../add-source-page'
import { newKnowledgeSourceDraftStorageKey } from '../routes'

type GetKnowledgeSpacesByIdSourceConnectionsResponse = {
  items: SourceConnection[]
  nextCursor?: string
}
type GetSourceProvidersResponse = { items: SourceProvider[] }

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}))
const openMock = vi.hoisted(() => vi.fn())

const connectFirecrawlButtonName = 'dataset.newKnowledge.connectProvider:{"provider":"Firecrawl"}'

vi.mock('@/next/navigation', () => ({ useRouter: () => routerMock }))

vi.mock('../connected-source-setup', () => ({
  ConnectedSourceSetup: ({
    draft,
    onDraftChange,
    onExit,
  }: {
    draft: Exclude<NewKnowledgeSourceDraft, { sourceType: 'websiteCrawl' }>
    onDraftChange: (draft: NewKnowledgeSourceDraft) => void
    onExit: () => void
  }) => {
    const providers =
      draft.sourceType === 'onlineDocuments'
        ? ['Notion', 'Google Docs', 'Confluence']
        : ['Google Drive', 'OneDrive', 'Amazon S3']
    return (
      <section data-testid="connected-source-setup">
        <fieldset>
          <legend>dataset.newKnowledge.providerLabel</legend>
          {providers.map((provider) => (
            <label key={provider}>
              <input
                type="radio"
                name="connected-source-provider"
                checked={draft.provider === provider}
                onChange={() => onDraftChange({ ...draft, provider } as NewKnowledgeSourceDraft)}
              />
              {provider}
            </label>
          ))}
        </fieldset>
        <label>
          dataset.newKnowledge.sourceName
          <input
            aria-label="dataset.newKnowledge.sourceName"
            value={draft.sourceName}
            onChange={(event) => onDraftChange({ ...draft, sourceName: event.target.value })}
          />
        </label>
        <label>
          dataset.newKnowledge.syncPolicy
          <select
            aria-label="dataset.newKnowledge.syncPolicy"
            value={draft.syncPolicy}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                syncPolicy: event.target.value as NewKnowledgeSourceDraft['syncPolicy'],
              })
            }
          >
            <option value="provider">dataset.newKnowledge.syncPolicyProvider</option>
            <option value="daily">dataset.newKnowledge.syncPolicyDaily</option>
            <option value="manual">dataset.newKnowledge.syncPolicyManual</option>
          </select>
        </label>
        <p role="status">dataset.newKnowledge.notionNotConnected</p>
        <button type="button" onClick={onExit}>
          dataset.newKnowledge.cancelAddSource
        </button>
        <button type="button" disabled>
          dataset.newKnowledge.addSource
        </button>
      </section>
    )
  },
}))

const toastInfoMock = vi.hoisted(() => vi.fn())
const providerApiResponse = vi.hoisted(() => (provider: SourceProvider) => ({
  auth_kinds: provider.authKinds,
  available: provider.available,
  capabilities: provider.capabilities,
  configuration: provider.configuration.map((field) => ({
    description: field.description ?? null,
    format: field.format ?? null,
    name: field.name,
    required: field.required,
    secret: field.secret,
    type: field.type,
  })),
  display_name: provider.displayName,
  id: provider.id,
  unavailable_reason: provider.unavailableReason ?? null,
}))
const connectionApiResponse = vi.hoisted(() => (connection: SourceConnection) => ({
  auth_kind: connection.authKind,
  configuration: connection.configuration,
  created_at: connection.createdAt,
  error_code: connection.errorCode ?? null,
  expires_at: connection.expiresAt ?? null,
  id: connection.id,
  knowledge_space_id: connection.knowledgeSpaceId,
  name: connection.name,
  provider_id: connection.providerId,
  scopes: connection.scopes,
  status: connection.status,
  updated_at: connection.updatedAt,
  version: connection.version,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { info: toastInfoMock },
}))

type ConnectionsInfiniteData = {
  pages: GetKnowledgeSpacesByIdSourceConnectionsResponse[]
}
const connectionInfiniteDataApiResponse = vi.hoisted(() => (data: ConnectionsInfiniteData) => ({
  pages: data.pages.map((page) => ({
    data: page.items.map(connectionApiResponse),
    next_cursor: page.nextCursor ?? null,
  })),
}))

type ConnectionsInfiniteOptions = {
  enabled?: boolean
  getNextPageParam: (lastPage: {
    data: ReturnType<typeof connectionApiResponse>[]
    next_cursor?: string | null
  }) => string | null | undefined
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
  datasourceAuth: {
    data: { result: [] } as DatasourceProviderAuthListResponse | undefined,
    error: null as unknown,
    isPending: false,
    refetch: vi.fn(),
  },
  datasourcePlugins: {
    data: [] as DataSourceItem[],
    error: null as unknown,
    isPending: false,
    refetch: vi.fn(),
  },
}))

vi.mock('@/service/use-pipeline', () => ({
  useDataSourceList: () => queryState.datasourcePlugins,
}))

const clientMock = vi.hoisted(() => ({
  createConnection: vi.fn(),
  refreshConnection: vi.fn(),
}))

const queryClientMock = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}))

const providerQueryOptionsMock = vi.hoisted(() =>
  vi.fn((options: { enabled?: boolean; select?: (data: unknown) => unknown }) => ({
    enabled: options.enabled,
    queryKey: ['source-providers'],
    select: options.select,
  })),
)
const connectionInfiniteOptionsMock = vi.hoisted(() =>
  vi.fn((options: ConnectionsInfiniteOptions) => ({
    enabled: options.enabled,
    queryKey: ['source-connections'],
  })),
)
const providerHookOptionsMock = vi.hoisted(() => vi.fn())
const datasourceAuthQueryOptionsMock = vi.hoisted(() =>
  vi.fn((options: { enabled?: boolean }) => ({
    enabled: options.enabled,
    queryKey: ['datasource-auth'],
  })),
)
const connectionHookOptionsMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: (options: unknown) => {
      connectionHookOptionsMock(options)
      return {
        ...queryState.connections,
        data: queryState.connections.data
          ? connectionInfiniteDataApiResponse(queryState.connections.data)
          : undefined,
        refetch: async () => {
          const result = (await queryState.connections.refetch()) as
            | { data?: ConnectionsInfiniteData; error?: unknown }
            | undefined
          if (!result?.data) return result
          return {
            ...result,
            data: connectionInfiniteDataApiResponse(result.data),
          }
        },
      }
    },
    useQuery: (options: { queryKey?: string[]; select?: (data: unknown) => unknown }) => {
      providerHookOptionsMock(options)
      if (options.queryKey?.[0] === 'datasource-auth') return queryState.datasourceAuth
      const raw = queryState.providers.data
        ? { data: queryState.providers.data.items.map(providerApiResponse) }
        : undefined
      return {
        ...queryState.providers,
        data: raw && options.select ? options.select(raw) : raw,
      }
    },
    useQueryClient: () => queryClientMock,
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          sourceConnections: {
            byConnectionId: {
              refresh: {
                post: async (input: unknown) =>
                  connectionApiResponse(await clientMock.refreshConnection(input)),
              },
            },
            post: async (input: unknown) =>
              connectionApiResponse(await clientMock.createConnection(input)),
          },
        },
      },
    },
  },
  consoleQuery: {
    auth: {
      plugin: {
        datasource: {
          defaultList: {
            get: {
              queryOptions: datasourceAuthQueryOptionsMock,
            },
          },
        },
      },
    },
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          sourceConnections: {
            get: {
              infiniteOptions: connectionInfiniteOptionsMock,
              key: vi.fn(() => ['source-connections']),
            },
          },
          sourceProviders: {
            get: {
              queryOptions: providerQueryOptionsMock,
            },
          },
        },
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

const difyManagedFirecrawlProvider: GetSourceProvidersResponse['items'][number] = {
  authKinds: ['endpoint'],
  available: true,
  capabilities: ['website-crawl'],
  configuration: [
    {
      name: 'credentialId',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      name: 'pluginId',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      name: 'provider',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      name: 'datasource',
      required: true,
      secret: false,
      type: 'string',
    },
    {
      name: 'providerKind',
      required: true,
      secret: false,
      type: 'string',
    },
  ],
  displayName: 'Dify website crawl',
  id: 'plugin-daemon-website',
}

const firecrawlDatasourceAuth: DatasourceProviderAuthListResponse['result'][number] = {
  author: 'langgenius',
  credential_schema: [],
  credentials_list: [
    {
      avatar_url: null,
      credential: {},
      id: 'firecrawl-credential-1',
      is_default: true,
      name: 'Default Firecrawl',
      type: 'api-key',
    },
  ],
  description: { en_US: 'Firecrawl' },
  icon: 'icon.svg',
  label: { en_US: 'Firecrawl' },
  name: 'firecrawl',
  oauth_schema: null,
  plugin_id: 'langgenius/firecrawl_datasource',
  plugin_unique_identifier: 'langgenius/firecrawl_datasource:1.0.0@local',
  provider: 'firecrawl',
}

const firecrawlDatasourcePlugin: DataSourceItem = {
  declaration: {
    credentials_schema: [],
    datasources: [
      {
        description: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
        identity: {
          author: 'langgenius',
          label: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
          name: 'crawl',
          provider: 'firecrawl',
        },
        parameters: [],
      },
    ],
    identity: {
      author: 'langgenius',
      description: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
      icon: 'icon.svg',
      label: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
      name: 'firecrawl',
      tags: [],
    },
    provider_type: 'website_crawl',
  },
  is_authorized: true,
  plugin_id: 'langgenius/firecrawl_datasource',
  plugin_unique_identifier: 'langgenius/firecrawl_datasource:1.0.0@local',
  provider: 'firecrawl',
}

const jinaDatasourcePlugin: DataSourceItem = {
  declaration: {
    credentials_schema: [],
    datasources: [
      {
        description: { en_US: 'Jina Reader', zh_Hans: 'Jina Reader' },
        identity: {
          author: 'langgenius',
          label: { en_US: 'Jina Reader', zh_Hans: 'Jina Reader' },
          name: 'jina_reader',
          provider: 'jinareader',
        },
        parameters: [],
      },
    ],
    identity: {
      author: 'langgenius',
      description: { en_US: 'Jina Reader', zh_Hans: 'Jina Reader' },
      icon: 'icon.svg',
      label: { en_US: 'Jina Reader', zh_Hans: 'Jina Reader' },
      name: 'jinareader',
      tags: [],
    },
    provider_type: 'website_crawl',
  },
  is_authorized: true,
  plugin_id: 'langgenius/jina_datasource',
  plugin_unique_identifier: 'langgenius/jina_datasource:1.0.0@local',
  provider: 'jinareader',
}

const jinaDatasourceAuth: DatasourceProviderAuthListResponse['result'][number] = {
  ...firecrawlDatasourceAuth,
  credentials_list: [
    {
      avatar_url: null,
      credential: {},
      id: 'jina-credential-1',
      is_default: true,
      name: 'Default Jina Reader',
      type: 'api-key',
    },
  ],
  label: { en_US: 'Jina Reader' },
  name: 'jinareader',
  plugin_id: 'langgenius/jina_datasource',
  plugin_unique_identifier: 'langgenius/jina_datasource:1.0.0@local',
  provider: 'jinareader',
}

const customCrawlerDatasourcePlugin: DataSourceItem = {
  ...firecrawlDatasourcePlugin,
  declaration: {
    ...firecrawlDatasourcePlugin.declaration,
    datasources: [
      {
        description: { en_US: 'Acme crawler', zh_Hans: 'Acme crawler' },
        identity: {
          author: 'acme',
          label: { en_US: 'Acme Crawler', zh_Hans: 'Acme Crawler' },
          name: 'acme_crawler',
          provider: 'acme',
        },
        parameters: [],
      },
    ],
    identity: {
      ...firecrawlDatasourcePlugin.declaration.identity,
      author: 'acme',
      description: { en_US: 'Acme crawler', zh_Hans: 'Acme crawler' },
      label: { en_US: 'Acme Crawler', zh_Hans: 'Acme Crawler' },
      name: 'acme_crawler',
    },
  },
  plugin_id: 'acme/acme_crawler',
  plugin_unique_identifier: 'acme/acme_crawler:1.0.0@local',
  provider: 'acme',
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
    vi.stubGlobal('open', openMock)
    globalThis.sessionStorage.clear()
    clientMock.createConnection.mockReset()
    clientMock.refreshConnection.mockReset()
    queryState.connections.refetch.mockReset()
    queryState.providers.refetch.mockReset()
    queryState.datasourceAuth.refetch.mockReset()
    queryState.datasourcePlugins.refetch.mockReset()
    queryState.providers.data = { items: [firecrawlProvider] }
    queryState.providers.error = null
    queryState.providers.isPending = false
    queryState.datasourceAuth.data = { result: [] }
    queryState.datasourceAuth.error = null
    queryState.datasourceAuth.isPending = false
    queryState.datasourcePlugins.data = [firecrawlDatasourcePlugin]
    queryState.datasourcePlugins.error = null
    queryState.datasourcePlugins.isPending = false
    queryState.connections.data = { pages: [{ items: [] }] }
    queryState.connections.error = null
    queryState.connections.hasNextPage = false
    queryState.connections.isFetchNextPageError = false
    queryState.connections.isFetchingNextPage = false
    queryState.connections.isPending = false
  })

  afterEach(() => {
    globalThis.sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it('loads the provider catalog and every scoped connection cursor page', () => {
    queryState.providers.isPending = true

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(providerQueryOptionsMock).toHaveBeenCalledWith({
      context: { silent: true },
      enabled: true,
      input: { params: { control_space_id: 'space-1' } },
      retry: false,
      select: expect.any(Function),
    })
    const options = connectionInfiniteOptionsMock.mock.lastCall?.[0]
    expect(options).toBeDefined()
    if (!options) throw new Error('Expected connection infinite query options')
    expect(options.input(null)).toEqual({
      params: { control_space_id: 'space-1' },
      query: { limit: 200 },
    })
    expect(options.input('next')).toEqual({
      params: { control_space_id: 'space-1' },
      query: { cursor: 'next', limit: 200 },
    })
    expect(options.getNextPageParam({ data: [], next_cursor: 'next' })).toBe('next')
    expect(options.initialPageParam).toBeNull()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('continues loading connection pages automatically', async () => {
    queryState.connections.hasNextPage = true

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(queryState.connections.fetchNextPage).toHaveBeenCalledOnce())
  })

  it('stops website connection pagination after switching source type', async () => {
    const user = userEvent.setup()

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    queryState.connections.hasNextPage = true

    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDocuments' }))

    expect(queryState.connections.fetchNextPage).not.toHaveBeenCalled()
  })

  it.each(['onlineDocuments', 'onlineDrive'])(
    'does not request website provider data for the %s state',
    (initialSourceType) => {
      queryState.providers.isPending = true
      queryState.connections.isPending = true

      render(<AddSourcePage initialSourceType={initialSourceType} knowledgeSpaceId="space-1" />)

      expect(providerHookOptionsMock.mock.lastCall?.[0]).toMatchObject({ enabled: false })
      expect(connectionHookOptionsMock.mock.lastCall?.[0]).toMatchObject({ enabled: false })
      expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
      expect(screen.getByTestId('connected-source-setup')).toBeInTheDocument()
    },
  )

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

    expect(screen.getByText(/dataset\.newKnowledge\.providerConnected/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: /dataset\.newKnowledge\.rootUrl/ })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }),
    ).toBeDisabled()
  })

  it('offers replacement setup when the saved provider connection is revoked', () => {
    queryState.connections.data = { pages: [{ items: [connection('revoked')] }] }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', { name: /^dataset\.newKnowledge\.configureProvider/ }),
    ).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
  })

  it('restores a website draft handed off by the creation flow', async () => {
    const user = userEvent.setup()
    queryState.connections.data = { pages: [{ items: [connection('active')] }] }

    render(
      <AddSourcePage
        initialSourceDraft={{
          includeSubpages: false,
          maxPages: 25,
          provider: 'Firecrawl',
          rootUrl: 'https://docs.dify.ai',
          sourceName: 'Dify docs',
          sourceType: 'websiteCrawl',
          syncPolicy: 'provider',
        }}
        knowledgeSpaceId="space-1"
      />,
    )

    expect(screen.getByRole('textbox', { name: /dataset\.newKnowledge\.rootUrl/ })).toHaveValue(
      'https://docs.dify.ai',
    )
    expect(screen.getByRole('textbox', { name: /dataset\.newKnowledge\.sourceName/ })).toHaveValue(
      'Dify docs',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlOptions' }))
    expect(
      screen.getByRole('checkbox', { name: 'dataset.newKnowledge.includeSubpages' }),
    ).not.toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'dataset.newKnowledge.maxPages' })).toHaveValue(
      25,
    )
  })

  it('keeps the exact website provider selected while loading website dependencies', async () => {
    const user = userEvent.setup()
    render(
      <AddSourcePage
        initialSourceDraft={{
          includeSubpages: true,
          maxPages: 100,
          provider: 'Jina Reader',
          rootUrl: 'https://docs.dify.ai',
          sourceName: 'Dify docs',
          sourceType: 'websiteCrawl',
          syncPolicy: 'manual',
        }}
        knowledgeSpaceId="space-1"
      />,
    )

    expect(screen.getByRole('radio', { name: 'Jina Reader' })).toBeChecked()
    expect(providerHookOptionsMock.mock.lastCall?.[0]).toMatchObject({ enabled: true })
    expect(connectionHookOptionsMock.mock.lastCall?.[0]).toMatchObject({ enabled: true })
    expect(screen.getByText('workflow.nodes.common.pluginNotInstalled')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'plugin.installPlugin',
      }),
    )
    expect(openMock).toHaveBeenCalledWith(
      '/integrations/data-source?package-ids=%5B%22langgenius%2Fjina_datasource%22%5D',
      '_blank',
      'noopener,noreferrer',
    )
    await user.click(screen.getByRole('radio', { name: 'Firecrawl' }))
    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()
    expect(providerHookOptionsMock.mock.lastCall?.[0]).toMatchObject({ enabled: true })
    expect(connectionHookOptionsMock.mock.lastCall?.[0]).toMatchObject({ enabled: true })
  })

  it('keeps crawl fields hidden until the selected website provider is configured', async () => {
    const user = userEvent.setup()
    render(
      <AddSourcePage
        initialSourceDraft={{
          includeSubpages: true,
          maxPages: 100,
          provider: 'Firecrawl',
          rootUrl: 'https://docs.dify.ai',
          sourceName: 'Dify docs',
          sourceType: 'websiteCrawl',
          syncPolicy: 'provider',
        }}
        knowledgeSpaceId="space-1"
      />,
    )
    expect(
      screen.getByText('dataset.newKnowledge.providerNotConfigured:{"provider":"Firecrawl"}'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'dataset.newKnowledge.rootUrl' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' })).toBeEnabled()

    await user.click(screen.getByRole('radio', { name: 'Jina Reader' }))
    expect(screen.getByText('workflow.nodes.common.pluginNotInstalled')).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'dataset.newKnowledge.rootUrl' }),
    ).not.toBeInTheDocument()
  })

  it('restores online document configuration and keeps Add disabled until a resource is selected', () => {
    render(
      <AddSourcePage
        initialSourceDraft={{
          provider: 'Google Docs',
          sourceName: 'Shared product docs',
          sourceType: 'onlineDocuments',
          syncPolicy: 'daily',
        }}
        knowledgeSpaceId="space-1"
      />,
    )

    expect(screen.getByRole('radio', { name: 'Google Docs' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceName' })).toHaveValue(
      'Shared product docs',
    )
    expect(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' }),
    ).toHaveTextContent('dataset.newKnowledge.syncPolicyDaily')
    const addSource = screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })
    expect(addSource).toBeDisabled()
  })

  it('restores a website draft from session storage', async () => {
    queryState.connections.data = { pages: [{ items: [connection('active')] }] }
    const storageKey = newKnowledgeSourceDraftStorageKey('draft-1')
    globalThis.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        includeSubpages: false,
        maxPages: 25,
        provider: 'Firecrawl',
        rootUrl: 'https://docs.dify.ai',
        sourceName: 'Dify docs',
        sourceType: 'websiteCrawl',
        syncPolicy: 'provider',
      }),
    )

    render(<AddSourcePage knowledgeSpaceId="space-1" sourceDraftKey="draft-1" />)

    expect(
      await screen.findByRole('textbox', { name: /dataset\.newKnowledge\.rootUrl/ }),
    ).toHaveValue('https://docs.dify.ai')
    expect(screen.getByRole('textbox', { name: /dataset\.newKnowledge\.sourceName/ })).toHaveValue(
      'Dify docs',
    )
    expect(globalThis.sessionStorage.getItem(storageKey)).not.toBeNull()
  })

  it('retains the draft through Strict Mode, delayed loading, and a real remount', async () => {
    queryState.connections.data = { pages: [{ items: [connection('active')] }] }
    queryState.connections.isPending = true
    const storageKey = newKnowledgeSourceDraftStorageKey('strict-draft')
    globalThis.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        includeSubpages: true,
        maxPages: 100,
        provider: 'Firecrawl',
        rootUrl: 'https://docs.dify.ai/strict',
        sourceName: 'Strict docs',
        sourceType: 'websiteCrawl',
        syncPolicy: 'provider',
      }),
    )

    const view = render(
      <StrictMode>
        <AddSourcePage knowledgeSpaceId="space-1" sourceDraftKey="strict-draft" />
      </StrictMode>,
    )
    await waitFor(() => expect(globalThis.sessionStorage.getItem(storageKey)).not.toBeNull())

    queryState.connections.isPending = false
    view.rerender(
      <StrictMode>
        <AddSourcePage knowledgeSpaceId="space-1" sourceDraftKey="strict-draft" />
      </StrictMode>,
    )

    expect(
      await screen.findByRole('textbox', { name: /dataset\.newKnowledge\.rootUrl/ }),
    ).toHaveValue('https://docs.dify.ai/strict')
    expect(screen.getByRole('textbox', { name: /dataset\.newKnowledge\.sourceName/ })).toHaveValue(
      'Strict docs',
    )

    view.unmount()
    queryState.connections.isPending = false
    render(
      <StrictMode>
        <AddSourcePage knowledgeSpaceId="space-1" sourceDraftKey="strict-draft" />
      </StrictMode>,
    )
    expect(
      await screen.findByRole('textbox', { name: /dataset\.newKnowledge\.rootUrl/ }),
    ).toHaveValue('https://docs.dify.ai/strict')
  })

  it('clears the stored draft when source setup is canceled', async () => {
    const user = userEvent.setup()
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)
    const storageKey = newKnowledgeSourceDraftStorageKey('cancel-draft')
    globalThis.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        includeSubpages: true,
        maxPages: 100,
        provider: 'Firecrawl',
        rootUrl: 'https://docs.dify.ai',
        sourceName: 'Dify docs',
        sourceType: 'websiteCrawl',
        syncPolicy: 'provider',
      }),
    )

    render(<AddSourcePage knowledgeSpaceId="space-1" sourceDraftKey="cancel-draft" />)
    await user.click(
      await screen.findByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }),
    )
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'dataset.newKnowledge.discardSourceDraftTitle',
    })
    expect(globalThis.sessionStorage.getItem(storageKey)).not.toBeNull()
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.discardDraftConfirm' }),
    )

    expect(globalThis.sessionStorage.getItem(storageKey)).toBeNull()
    expect(historyBack).toHaveBeenCalledOnce()
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(routerMock.replace).toHaveBeenCalledWith('/datasets/new/space-1/sources')
    expect(confirmation).not.toBeInTheDocument()
  })

  it('creates the exact Firecrawl provider connection without leaking credentials', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockResolvedValue(connection('active'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: /^dataset\.newKnowledge\.configureProvider/ }),
    )
    await user.type(screen.getByLabelText(/Api Key/), 'secret-value')
    await user.type(screen.getByLabelText('Endpoint'), 'https://crawl.example.com')
    await user.click(screen.getByRole('button', { name: connectFirecrawlButtonName }))

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
        params: { control_space_id: 'space-1' },
      }),
    )
    await screen.findByRole('status', { name: 'appApi.loading' })
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['source-connections'],
    })
    expect(screen.getByText(/dataset\.newKnowledge\.providerConnected/)).toBeInTheDocument()
    expect(screen.queryByDisplayValue('secret-value')).not.toBeInTheDocument()
  })

  it('automatically binds the default Dify Firecrawl credential for the real KnowledgeFS provider', async () => {
    queryState.providers.data = { items: [difyManagedFirecrawlProvider] }
    queryState.datasourceAuth.data = { result: [firecrawlDatasourceAuth] }
    clientMock.createConnection.mockResolvedValue({
      ...connection('active'),
      authKind: 'endpoint',
      configuration: {
        credentialId: 'firecrawl-credential-1',
        datasource: 'crawl',
        pluginId: 'langgenius/firecrawl_datasource',
        provider: 'firecrawl',
        providerKind: 'website',
      },
    })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(clientMock.createConnection).toHaveBeenCalledWith({
        body: {
          authKind: 'endpoint',
          configuration: {
            credentialId: 'firecrawl-credential-1',
            datasource: 'crawl',
            pluginId: 'langgenius/firecrawl_datasource',
            provider: 'firecrawl',
            providerKind: 'website',
          },
          credentials: {},
          name: 'Firecrawl',
          providerId: 'plugin-daemon-website',
        },
        params: { control_space_id: 'space-1' },
      }),
    )
    expect(
      screen.queryByRole('button', { name: connectFirecrawlButtonName }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Api Key/)).not.toBeInTheDocument()
  })

  it('binds an installed Jina Reader datasource without reusing a Firecrawl connection', async () => {
    queryState.providers.data = { items: [difyManagedFirecrawlProvider] }
    queryState.datasourcePlugins.data = [firecrawlDatasourcePlugin, jinaDatasourcePlugin]
    queryState.datasourceAuth.data = { result: [jinaDatasourceAuth] }
    queryState.connections.data = {
      pages: [
        {
          items: [
            {
              ...connection('active'),
              authKind: 'endpoint',
              configuration: {
                credentialId: 'firecrawl-credential-1',
                datasource: 'crawl',
                pluginId: 'langgenius/firecrawl_datasource',
                provider: 'firecrawl',
                providerKind: 'website',
              },
            },
          ],
        },
      ],
    }
    clientMock.createConnection.mockResolvedValue({
      ...connection('active'),
      authKind: 'endpoint',
      configuration: {
        credentialId: 'jina-credential-1',
        datasource: 'jina_reader',
        pluginId: 'langgenius/jina_datasource',
        provider: 'jinareader',
        providerKind: 'website',
      },
      name: 'Jina Reader',
    })

    render(
      <AddSourcePage
        initialSourceProvider="Jina Reader"
        initialSourceType="websiteCrawl"
        knowledgeSpaceId="space-1"
      />,
    )

    await waitFor(() =>
      expect(clientMock.createConnection).toHaveBeenCalledWith({
        body: {
          authKind: 'endpoint',
          configuration: {
            credentialId: 'jina-credential-1',
            datasource: 'jina_reader',
            pluginId: 'langgenius/jina_datasource',
            provider: 'jinareader',
            providerKind: 'website',
          },
          credentials: {},
          name: 'Jina Reader',
          providerId: 'plugin-daemon-website',
        },
        params: { control_space_id: 'space-1' },
      }),
    )
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(
      await screen.findByRole('textbox', { name: /dataset\.newKnowledge\.rootUrl/ }),
    ).toBeEnabled()
  })

  it('clears website parameters when switching between configured providers', async () => {
    const user = userEvent.setup()
    queryState.providers.data = { items: [difyManagedFirecrawlProvider] }
    queryState.datasourcePlugins.data = [firecrawlDatasourcePlugin, jinaDatasourcePlugin]
    queryState.datasourceAuth.data = { result: [firecrawlDatasourceAuth, jinaDatasourceAuth] }
    queryState.connections.data = {
      pages: [
        {
          items: [
            {
              ...connection('active'),
              authKind: 'endpoint',
              configuration: {
                credentialId: 'firecrawl-credential-1',
                datasource: 'crawl',
                pluginId: 'langgenius/firecrawl_datasource',
                provider: 'firecrawl',
                providerKind: 'website',
              },
            },
            {
              ...connection('active'),
              authKind: 'endpoint',
              configuration: {
                credentialId: 'jina-credential-1',
                datasource: 'jina_reader',
                pluginId: 'langgenius/jina_datasource',
                provider: 'jinareader',
                providerKind: 'website',
              },
              id: 'jina-connection-1',
              name: 'Jina Reader',
            },
          ],
        },
      ],
    }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    const rootUrl = await screen.findByRole('textbox', {
      name: /dataset\.newKnowledge\.rootUrl/,
    })
    await user.type(rootUrl, 'https://firecrawl.example.com')

    await user.click(screen.getByRole('radio', { name: 'Jina Reader' }))

    expect(
      await screen.findByRole('textbox', { name: /dataset\.newKnowledge\.rootUrl/ }),
    ).toHaveValue('')
  })

  it('opens Data Source settings when Dify has no Firecrawl credential', async () => {
    const user = userEvent.setup()
    queryState.providers.data = { items: [difyManagedFirecrawlProvider] }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    expect(screen.queryByLabelText(/Api Key/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: connectFirecrawlButtonName }),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.configureProvider:{"provider":"Firecrawl"}',
      }),
    )

    expect(openMock).toHaveBeenCalledWith(
      '/integrations/data-source?package-ids=%5B%22langgenius%2Ffirecrawl_datasource%22%5D',
      '_blank',
      'noopener,noreferrer',
    )
    expect(clientMock.createConnection).not.toHaveBeenCalled()
  })

  it('refreshes website plugins, credentials, providers, and connections after configuration', () => {
    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    act(() => globalThis.dispatchEvent(new Event('focus')))

    expect(queryState.providers.refetch).toHaveBeenCalledOnce()
    expect(queryState.datasourcePlugins.refetch).toHaveBeenCalledOnce()
    expect(queryState.datasourceAuth.refetch).toHaveBeenCalledOnce()
    expect(queryState.connections.refetch).toHaveBeenCalledOnce()
  })

  it('treats an active managed connection as unconfigured after its credential is deleted', () => {
    queryState.providers.data = { items: [difyManagedFirecrawlProvider] }
    queryState.datasourceAuth.data = {
      result: [{ ...firecrawlDatasourceAuth, credentials_list: [] }],
    }
    queryState.connections.data = {
      pages: [
        {
          items: [
            {
              ...connection('active'),
              authKind: 'endpoint',
              configuration: {
                credentialId: 'deleted-firecrawl-credential',
                datasource: 'crawl',
                pluginId: 'langgenius/firecrawl_datasource',
                provider: 'firecrawl',
                providerKind: 'website',
              },
            },
          ],
        },
      ],
    }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByText('dataset.newKnowledge.providerNotConfigured:{"provider":"Firecrawl"}'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.configureProvider:{"provider":"Firecrawl"}',
      }),
    ).toBeEnabled()
    expect(
      screen.queryByRole('textbox', { name: 'dataset.newKnowledge.rootUrl' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }),
    ).not.toBeInTheDocument()
  })

  it('releases the parent history guard before the crawl preview owns navigation', async () => {
    const user = userEvent.setup()
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)
    clientMock.createConnection.mockResolvedValue(connection('active'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: /^dataset\.newKnowledge\.configureProvider/ }),
    )
    await user.type(screen.getByLabelText(/Api Key/), 'secret-value')
    await user.click(screen.getByRole('button', { name: connectFirecrawlButtonName }))

    await waitFor(() => expect(historyBack).toHaveBeenCalledOnce())
    expect(screen.queryByText(/dataset\.newKnowledge\.providerConnected/)).not.toBeInTheDocument()

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    await screen.findByText(/dataset\.newKnowledge\.providerConnected/)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.cancelAddSource' }))

    expect(historyBack).toHaveBeenCalledOnce()
    expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources')
  })

  it('discovers installed website providers and keeps the provider-management action', () => {
    queryState.datasourcePlugins.data = [firecrawlDatasourcePlugin, customCrawlerDatasourcePlugin]
    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('group', { name: 'dataset.newKnowledge.providerLabel' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Acme Crawler' })).toBeEnabled()
    expect(screen.queryByRole('radio', { name: 'FakeCrawler' })).not.toBeInTheDocument()
    const moreProvidersLink = screen.getByRole('link', {
      name: 'dataset.newKnowledge.moreProviders',
    })
    expect(moreProvidersLink).toHaveAttribute('href', '/integrations/data-source')
    expect(moreProvidersLink).toHaveAttribute('target', '_blank')
    expect(moreProvidersLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('keeps the handed-off website draft when the provider connection becomes active', async () => {
    const initialSourceDraft = {
      includeSubpages: true,
      maxPages: 100,
      provider: 'Firecrawl' as const,
      rootUrl: 'https://docs.dify.ai',
      sourceName: 'Dify docs',
      sourceType: 'websiteCrawl' as const,
      syncPolicy: 'provider' as const,
    }
    const view = render(
      <AddSourcePage initialSourceDraft={initialSourceDraft} knowledgeSpaceId="space-1" />,
    )
    expect(
      screen.queryByRole('textbox', { name: 'dataset.newKnowledge.rootUrl' }),
    ).not.toBeInTheDocument()

    queryState.connections.data = { pages: [{ items: [connection('active')] }] }
    view.rerender(
      <AddSourcePage initialSourceDraft={initialSourceDraft} knowledgeSpaceId="space-1" />,
    )
    await screen.findByRole('status', { name: 'appApi.loading' })
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))

    expect(screen.getByRole('textbox', { name: /dataset\.newKnowledge\.rootUrl/ })).toHaveValue(
      'https://docs.dify.ai',
    )
    expect(screen.getByRole('textbox', { name: /dataset\.newKnowledge\.sourceName/ })).toHaveValue(
      'Dify docs',
    )
  })

  it('does not select a lookalike provider by fuzzy display name', () => {
    queryState.providers.data = {
      items: [{ ...firecrawlProvider, displayName: 'Firecrawl impostor', id: 'impostor' }],
    }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.providerUnavailable')).toBeInTheDocument()
  })

  it('clears sensitive input but retains non-sensitive input after a connection error', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockRejectedValue(new Error('provider unavailable'))
    queryState.connections.refetch.mockResolvedValue({ data: queryState.connections.data })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: /^dataset\.newKnowledge\.configureProvider/ }),
    )
    await user.type(screen.getByLabelText(/Api Key/), 'do-not-retain')
    await user.type(screen.getByLabelText('Endpoint'), 'https://crawl.example.com')
    await user.click(screen.getByRole('button', { name: connectFirecrawlButtonName }))

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
    await user.click(
      screen.getByRole('button', { name: /^dataset\.newKnowledge\.configureProvider/ }),
    )
    await user.type(screen.getByLabelText(/Api Key/), 'secret-value')
    await user.click(screen.getByRole('button', { name: connectFirecrawlButtonName }))

    await waitFor(() => expect(clientMock.createConnection).toHaveBeenCalledOnce())
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(await screen.findByText(/dataset\.newKnowledge\.providerConnected/)).toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.connectionFailed')).not.toBeInTheDocument()
  })

  it('clears an API key when authentication modes are changed and changed back', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockResolvedValue(connection('active'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: /^dataset\.newKnowledge\.configureProvider/ }),
    )
    await user.type(screen.getByLabelText(/Api Key/), 'must-not-return')
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.authKind.endpoint' }))
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.authKind.api-key' }))

    expect(screen.getByLabelText(/Api Key/)).toHaveValue('')
  })

  it('supports an endpoint descriptor without sending a hidden secret field', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockResolvedValue({
      ...connection('active'),
      authKind: 'endpoint',
    })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: /^dataset\.newKnowledge\.configureProvider/ }),
    )
    await user.type(screen.getByLabelText(/Api Key/), 'must-not-be-sent')
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.authKind.endpoint' }))
    await user.type(screen.getByLabelText('Endpoint'), 'https://crawl.example.com')
    await user.click(screen.getByRole('button', { name: connectFirecrawlButtonName }))

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
        params: { control_space_id: 'space-1' },
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
    await user.click(
      screen.getByRole('button', { name: /^dataset\.newKnowledge\.configureProvider/ }),
    )

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
        params: { connection_id: 'connection-1', control_space_id: 'space-1' },
      }),
    )
    expect(queryClientMock.invalidateQueries).toHaveBeenCalled()
    expect(screen.getByText(/dataset\.newKnowledge\.providerConnected/)).toBeInTheDocument()
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
        params: { connection_id: 'connection-1', control_space_id: 'space-1' },
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
        params: { connection_id: 'connection-1', control_space_id: 'space-1' },
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

    expect(screen.getByText(/dataset\.newKnowledge\.providerConnected/)).toBeInTheDocument()
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

    expect(await screen.findByText(/dataset\.newKnowledge\.providerConnected/)).toBeInTheDocument()
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
      screen.queryByRole('button', { name: /^dataset\.newKnowledge\.configureProvider/ }),
    ).not.toBeInTheDocument()
  })

  it('keeps source types selectable and preserves each connected-source draft', async () => {
    const user = userEvent.setup()
    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.websiteCrawl' })).toBeChecked()
    const onlineDocuments = screen.getByRole('radio', {
      name: 'dataset.newKnowledge.onlineDocuments',
    })
    expect(onlineDocuments).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDrive' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Jina Reader' })).toBeEnabled()
    expect(
      screen.getByRole('group', { name: 'dataset.newKnowledge.providerLabel' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()

    await user.click(onlineDocuments)
    expect(onlineDocuments).toBeChecked()
    expect(screen.getByRole('group', { name: 'dataset.newKnowledge.providerLabel' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceName' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'dataset.newKnowledge.syncPolicy' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('dataset.newKnowledge.notionNotConnected')
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceName' }),
      'Product docs',
    )

    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDrive' }))
    expect(screen.getByRole('radio', { name: 'Google Drive' })).toBeChecked()
    await user.click(onlineDocuments)
    expect(screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceName' })).toHaveValue(
      'Product docs',
    )
  })

  it('restores the selected source type from the create flow', () => {
    render(<AddSourcePage initialSourceType="onlineDrive" knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDrive' })).toBeChecked()
    expect(screen.getByTestId('connected-source-setup')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'dataset.newKnowledge.sourceName' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('dataset.newKnowledge.notionNotConnected')
  })

  it.each([
    ['websiteCrawl', 'Jina Reader'],
    ['onlineDocuments', 'Confluence'],
    ['onlineDrive', 'OneDrive'],
  ] as const)('restores the %s provider from a shortcut URL', (initialSourceType, provider) => {
    render(
      <AddSourcePage
        initialSourceProvider={provider}
        initialSourceType={initialSourceType}
        knowledgeSpaceId="space-1"
      />,
    )

    expect(screen.getByRole('radio', { name: provider })).toBeChecked()
  })

  it('disables the final Add source action while its backend dependency is missing', async () => {
    const user = userEvent.setup()
    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDocuments' }))
    const addSource = screen.getByRole('button', { name: 'dataset.newKnowledge.addSource' })
    expect(addSource).toBeDisabled()
    expect(toastInfoMock).not.toHaveBeenCalled()
  })

  it('shows catalog unavailability instead of offering a fake connection', () => {
    queryState.providers.data = {
      items: [{ ...firecrawlProvider, available: false, unavailableReason: 'Disabled by admin' }],
    }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('Disabled by admin')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^dataset\.newKnowledge\.configureProvider/ }),
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
      screen.queryByRole('button', { name: /^dataset\.newKnowledge\.configureProvider/ }),
    ).not.toBeInTheDocument()
  })
})

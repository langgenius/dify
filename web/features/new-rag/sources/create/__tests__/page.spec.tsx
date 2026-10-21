import type { DatasourceProviderAuthListResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { KnowledgeFsProductPermission } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RagPipelineDatasourceProviderResponse as DataSourceItem } from '@dify/contracts/api/console/rag/types.gen'
import type { ReactElement } from 'react'
import type { NewKnowledgeSourceDraft } from '../../setup/source-draft'
import type { SourceConnection, SourceProvider } from '../../source-models'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { newKnowledgeSourceDraftStorageKey } from '../../setup/source-draft'
import { AddSourcePage } from '../page'

type GetKnowledgeSpacesByIdSourceConnectionsResponse = {
  items: SourceConnection[]
  nextCursor?: string
}
type GetSourceProvidersResponse = { items: SourceProvider[] }

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}))
const knowledgeSpacePermissionState = vi.hoisted(() => ({
  keys: ['knowledge_space_document_write'] as KnowledgeFsProductPermission[],
}))
vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-123' },
  }))
})

const openMock = vi.hoisted(() => vi.fn())

const connectFirecrawlButtonName = 'knowledgeSources.connectProvider:{"provider":"Firecrawl"}'

vi.mock('@/next/navigation', () => ({ useRouter: () => routerMock }))

vi.mock('../connected-source-workflow', () => ({
  ConnectedSourceWorkflow: ({
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
          <legend>knowledgeSpace.providerLabel</legend>
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
          knowledgeSources.sourceName
          <input
            aria-label="knowledgeSources.sourceName"
            value={draft.sourceName}
            onChange={(event) => onDraftChange({ ...draft, sourceName: event.target.value })}
          />
        </label>
        <label>
          knowledgeSources.syncPolicy
          <select
            aria-label="knowledgeSources.syncPolicy"
            value={draft.syncPolicy}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                syncPolicy: event.target.value as NewKnowledgeSourceDraft['syncPolicy'],
              })
            }
          >
            <option value="daily">knowledgeSources.syncPolicyDaily</option>
            <option value="manual">knowledgeSources.syncPolicyManual</option>
          </select>
        </label>
        <p role="status">knowledgeSpace.notionNotConnected</p>
        <button type="button" onClick={onExit}>
          knowledgeSources.cancelAddSource
        </button>
        <button type="button" disabled>
          knowledgeSpace.addSource
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

vi.mock('@/app/notifications', () => ({
  toast: { info: toastInfoMock },
}))

type ServerResource<T> = { data: T; error: unknown; pending: boolean }

// Server-side state behind the real Query observers; each test edits it before or between fetches.
const server = vi.hoisted(() => ({
  connections: {
    data: [{ items: [] }] as GetKnowledgeSpacesByIdSourceConnectionsResponse[],
    error: null as unknown,
    nextPageError: null as unknown,
    pending: false,
  },
  datasourceAuth: {
    data: { result: [] } as DatasourceProviderAuthListResponse,
    error: null as unknown,
    pending: false,
  },
  datasourcePlugins: { data: [] as DataSourceItem[], error: null as unknown, pending: false },
  providers: {
    data: { items: [] } as GetSourceProvidersResponse,
    error: null as unknown,
    pending: false,
  },
  listConnections: vi.fn(),
  listDatasourceAuth: vi.fn(),
  listDatasourcePlugins: vi.fn(),
  listProviders: vi.fn(),
}))

const respond = vi.hoisted(
  () =>
    <T, R>(resource: ServerResource<T>, toApi: (data: T) => R) =>
      resource.pending
        ? new Promise<R>(() => {})
        : resource.error
          ? Promise.reject(resource.error)
          : Promise.resolve(toApi(resource.data)),
)

const clientMock = vi.hoisted(() => ({
  createConnection: vi.fn(),
  refreshConnection: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  const space = 'knowledgeFs.spaces.byControlSpaceId'
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      [`${space}.sourceConnections.byConnectionId.refresh.post`]: async (input: never) =>
        connectionApiResponse(await clientMock.refreshConnection(input)),
      [`${space}.sourceConnections.post`]: async (input: never) =>
        connectionApiResponse(await clientMock.createConnection(input)),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'auth.plugin.datasource.defaultList.get': (input: never) => {
        server.listDatasourceAuth(input)
        return respond(server.datasourceAuth, (data) => data)
      },
      'rag.pipelines.datasourcePlugins.get': (input: never) => {
        server.listDatasourcePlugins(input)
        return respond(server.datasourcePlugins, (data) => data)
      },
      [`${space}.sourceConnections.get`]: (input: { query: { cursor?: string } }) => {
        server.listConnections(input)
        const index = input.query.cursor ? Number(input.query.cursor.replace('page-', '')) : 0
        if (index > 0 && server.connections.nextPageError)
          return Promise.reject(server.connections.nextPageError)
        return respond(server.connections, (pages) => ({
          data: (pages[index]?.items ?? []).map(connectionApiResponse),
          next_cursor: index + 1 < pages.length ? `page-${index + 1}` : null,
        }))
      },
      [`${space}.sourceProviders.get`]: (input: never) => {
        server.listProviders(input)
        return respond(server.providers, (data) => ({
          data: data.items.map(providerApiResponse),
        }))
      },
    }),
  }
})

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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const connectionsKey = () =>
  consoleQuery.knowledgeFs.spaces.byControlSpaceId.sourceConnections.get.key()

let currentQueryClient: ReturnType<typeof renderWithConsoleQuery>['queryClient'] | undefined

/** Renders inside the space shell's context; by default waits until every settled request lands. */
async function renderPage(ui: ReactElement, { settle = true } = {}) {
  const view = renderWithConsoleQuery(
    <KnowledgeSpaceTestProvider
      space={createKnowledgeSpaceFixture({ permission_keys: knowledgeSpacePermissionState.keys })}
    >
      {ui}
    </KnowledgeSpaceTestProvider>,
  )
  currentQueryClient = view.queryClient
  if (settle) await waitFor(() => expect(view.queryClient.isFetching()).toBe(0))
  return view
}

/** Lets the page observe the current server state, as a later background refetch would. */
async function refetchConnections() {
  await act(() => currentQueryClient!.invalidateQueries({ queryKey: connectionsKey() }))
}

describe('AddSourcePage', () => {
  beforeEach(() => {
    knowledgeSpacePermissionState.keys = ['knowledge_space_document_write']
    vi.stubGlobal('open', openMock)
    globalThis.sessionStorage.clear()
    clientMock.createConnection.mockReset()
    clientMock.refreshConnection.mockReset()
    server.providers = { data: { items: [firecrawlProvider] }, error: null, pending: false }
    server.datasourceAuth = { data: { result: [] }, error: null, pending: false }
    server.datasourcePlugins = { data: [firecrawlDatasourcePlugin], error: null, pending: false }
    server.connections = { data: [{ items: [] }], error: null, nextPageError: null, pending: false }
  })

  afterEach(() => {
    globalThis.sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it('redirects a direct route visit without document-write permission', async () => {
    knowledgeSpacePermissionState.keys = []

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith('/datasets/new/space-1/sources'),
    )
    expect(screen.queryByText('knowledgeSpace.addSourceTitle')).not.toBeInTheDocument()
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
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
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

    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDocuments' }))

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
    expect(screen.getByText('knowledgeSpace.providerLoadFailed')).toBeInTheDocument()
  })

  it('finds the provider connection on a later loaded page', () => {
    server.connections.data = [{ items: [], { items: [connection('active')] }] }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByText(/knowledgeSources\.providerConnected/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: /knowledgeSources\.rootUrl/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.crawlAndPreview' })).toBeDisabled()
  })

  it('offers replacement setup when the saved provider connection is revoked', () => {
    server.connections.data = [{ items: [connection('revoked')]] }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', { name: /^knowledgeSources\.configureProvider/ }),
    ).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
  })

  it('restores a website draft handed off by the creation flow', async () => {
    const user = userEvent.setup()
    server.connections.data = [{ items: [connection('active')]] }

    render(
      <AddSourcePage
        initialSourceDraft={{
          includeSubpages: false,
          maxPages: 25,
          provider: 'Firecrawl',
          rootUrl: 'https://docs.dify.ai',
          sourceName: 'Dify docs',
          sourceType: 'websiteCrawl',
          syncPolicy: 'daily',
        }}
        knowledgeSpaceId="space-1"
      />,
    )

    expect(screen.getByRole('textbox', { name: /knowledgeSources\.rootUrl/ })).toHaveValue(
      'https://docs.dify.ai',
    )
    expect(screen.getByRole('textbox', { name: /knowledgeSources\.sourceName/ })).toHaveValue(
      'Dify docs',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSources.crawlOptions' }))
    expect(
      screen.getByRole('checkbox', { name: 'knowledgeSources.includeSubpages' }),
    ).not.toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'knowledgeSources.maxPages' })).toHaveValue(25)
  })

  it('falls back to an installed website provider when the requested provider is not installed', () => {
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

    expect(screen.queryByRole('radio', { name: 'Jina Reader' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()
    expect(providerHookOptionsMock.mock.lastCall?.[0]).toMatchObject({ enabled: true })
    expect(connectionHookOptionsMock.mock.lastCall?.[0]).toMatchObject({ enabled: true })
    expect(screen.queryByText('workflow.nodes.common.pluginNotInstalled')).not.toBeInTheDocument()
  })

  it('clears provider-specific draft fields when falling back to another website provider', async () => {
    const user = userEvent.setup()
    server.connections.data = [{ items: [connection('active')]] }

    render(
      <AddSourcePage
        initialSourceDraft={{
          includeSubpages: false,
          maxPages: 25,
          parameters: {
            crawl_sub_pages: false,
            jinaOnly: 'stale-value',
            url: 'https://jina.example.com',
          },
          provider: 'Jina Reader',
          rootUrl: 'https://jina.example.com',
          sourceName: 'Old Jina source',
          sourceType: 'websiteCrawl',
          syncPolicy: 'daily',
        }}
        knowledgeSpaceId="space-1"
      />,
    )

    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: /knowledgeSources\.rootUrl/ })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: /knowledgeSources\.sourceName/ })).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'knowledgeSources.crawlOptions' }))
    expect(screen.getByRole('checkbox', { name: 'knowledgeSources.includeSubpages' })).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'knowledgeSources.maxPages' })).toHaveValue(100)
  })

  it('keeps crawl fields hidden until the selected website provider is configured', () => {
    render(
      <AddSourcePage
        initialSourceDraft={{
          includeSubpages: true,
          maxPages: 100,
          provider: 'Firecrawl',
          rootUrl: 'https://docs.dify.ai',
          sourceName: 'Dify docs',
          sourceType: 'websiteCrawl',
          syncPolicy: 'daily',
        }}
        knowledgeSpaceId="space-1"
      />,
    )
    expect(
      screen.getByText('knowledgeSources.providerNotConfigured:{"provider":"Firecrawl"}'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'knowledgeSources.rootUrl' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.crawlAndPreview' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'knowledgeSources.syncPolicy' })).toBeEnabled()

    expect(screen.queryByRole('radio', { name: 'Jina Reader' })).not.toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.common.pluginNotInstalled')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'knowledgeSources.rootUrl' }),
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
    expect(screen.getByRole('textbox', { name: 'knowledgeSources.sourceName' })).toHaveValue(
      'Shared product docs',
    )
    expect(screen.getByRole('combobox', { name: 'knowledgeSources.syncPolicy' })).toHaveTextContent(
      'knowledgeSources.syncPolicyDaily',
    )
    const addSource = screen.getByRole('button', { name: 'knowledgeSpace.addSource' })
    expect(addSource).toBeDisabled()
  })

  it('restores a website draft from session storage', async () => {
    server.connections.data = [{ items: [connection('active')]] }
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
        syncPolicy: 'daily',
      }),
    )

    render(<AddSourcePage knowledgeSpaceId="space-1" sourceDraftKey="draft-1" />)

    expect(await screen.findByRole('textbox', { name: /knowledgeSources\.rootUrl/ })).toHaveValue(
      'https://docs.dify.ai',
    )
    expect(screen.getByRole('textbox', { name: /knowledgeSources\.sourceName/ })).toHaveValue(
      'Dify docs',
    )
    expect(globalThis.sessionStorage.getItem(storageKey)).not.toBeNull()
  })

  it('retains the draft through Strict Mode, delayed loading, and a real remount', async () => {
    server.connections.data = [{ items: [connection('active')]] }
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
        syncPolicy: 'daily',
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

    expect(await screen.findByRole('textbox', { name: /knowledgeSources\.rootUrl/ })).toHaveValue(
      'https://docs.dify.ai/strict',
    )
    expect(screen.getByRole('textbox', { name: /knowledgeSources\.sourceName/ })).toHaveValue(
      'Strict docs',
    )

    view.unmount()
    queryState.connections.isPending = false
    render(
      <StrictMode>
        <AddSourcePage knowledgeSpaceId="space-1" sourceDraftKey="strict-draft" />
      </StrictMode>,
    )
    expect(await screen.findByRole('textbox', { name: /knowledgeSources\.rootUrl/ })).toHaveValue(
      'https://docs.dify.ai/strict',
    )
  })

  it('clears the stored draft when source setup is canceled', async () => {
    const user = userEvent.setup()
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
        syncPolicy: 'daily',
      }),
    )

    render(<AddSourcePage knowledgeSpaceId="space-1" sourceDraftKey="cancel-draft" />)
    await user.click(
      await screen.findByRole('button', { name: 'knowledgeSources.cancelAddSource' }),
    )

    expect(globalThis.sessionStorage.getItem(storageKey)).toBeNull()
    expect(routerMock.replace).toHaveBeenCalledWith('/datasets/new/space-1/sources')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('creates the exact Firecrawl provider connection without leaking credentials', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockResolvedValue(connection('active'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /^knowledgeSources\.configureProvider/ }))
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
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['source-connections'],
    })
    expect(screen.getByText(/knowledgeSources\.providerConnected/)).toBeInTheDocument()
    expect(screen.queryByDisplayValue('secret-value')).not.toBeInTheDocument()
  })

  it('automatically binds the default Dify Firecrawl credential for the real KnowledgeFS provider', async () => {
    server.providers.data = { items: [difyManagedFirecrawlProvider] }
    server.datasourceAuth.data = { result: [firecrawlDatasourceAuth] }
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

  it('names the provider when automatic credential binding fails', async () => {
    server.providers.data = { items: [difyManagedFirecrawlProvider] }
    server.datasourceAuth.data = { result: [firecrawlDatasourceAuth] }
    clientMock.createConnection.mockRejectedValue(new Error('provider unavailable'))
    queryState.connections.refetch.mockResolvedValue({ data: queryState.connections.data })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'knowledgeSources.connectionFailed:{"provider":"Firecrawl"}',
    )
  })

  it('binds an installed Jina Reader datasource without reusing a Firecrawl connection', async () => {
    server.providers.data = { items: [difyManagedFirecrawlProvider] }
    server.datasourcePlugins.data = [firecrawlDatasourcePlugin, jinaDatasourcePlugin]
    server.datasourceAuth.data = { result: [jinaDatasourceAuth] }
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
    expect(await screen.findByRole('textbox', { name: /knowledgeSources\.rootUrl/ })).toBeEnabled()
  })

  it('clears website parameters when switching between configured providers', async () => {
    const user = userEvent.setup()
    server.providers.data = { items: [difyManagedFirecrawlProvider] }
    server.datasourcePlugins.data = [firecrawlDatasourcePlugin, jinaDatasourcePlugin]
    server.datasourceAuth.data = { result: [firecrawlDatasourceAuth, jinaDatasourceAuth] }
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
      name: /knowledgeSources\.rootUrl/,
    })
    await user.type(rootUrl, 'https://firecrawl.example.com')

    await user.click(screen.getByRole('radio', { name: 'Jina Reader' }))

    expect(await screen.findByRole('textbox', { name: /knowledgeSources\.rootUrl/ })).toHaveValue(
      '',
    )
  })

  it('opens Data Source settings when Dify has no Firecrawl credential', async () => {
    const user = userEvent.setup()
    server.providers.data = { items: [difyManagedFirecrawlProvider] }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    expect(screen.queryByLabelText(/Api Key/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: connectFirecrawlButtonName }),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSources.configureProvider:{"provider":"Firecrawl"}',
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
    server.providers.data = { items: [difyManagedFirecrawlProvider] }
    server.datasourceAuth.data = {
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
      screen.getByText('knowledgeSources.providerNotConfigured:{"provider":"Firecrawl"}'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'knowledgeSources.configureProvider:{"provider":"Firecrawl"}',
      }),
    ).toBeEnabled()
    expect(
      screen.queryByRole('textbox', { name: 'knowledgeSources.rootUrl' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.crawlAndPreview' }),
    ).not.toBeInTheDocument()
  })

  it('shows the crawl preview immediately after the provider connection becomes active', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockResolvedValue(connection('active'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /^knowledgeSources\.configureProvider/ }))
    await user.type(screen.getByLabelText(/Api Key/), 'secret-value')
    await user.click(screen.getByRole('button', { name: connectFirecrawlButtonName }))

    await screen.findByText(/knowledgeSources\.providerConnected/)
    await user.click(screen.getByRole('button', { name: 'knowledgeSources.cancelAddSource' }))

    expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources')
  })

  it('keeps the connection action focused and explicitly named while pending', async () => {
    const user = userEvent.setup()
    const createConnectionDeferred = createDeferred<ReturnType<typeof connection>>()
    clientMock.createConnection.mockReturnValue(createConnectionDeferred.promise)

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /^knowledgeSources\.configureProvider/ }))
    await user.type(screen.getByLabelText(/Api Key/), 'secret-value')
    const connectButton = screen.getByRole('button', { name: connectFirecrawlButtonName })
    await user.click(connectButton)

    const pendingButton = screen.getByRole('button', {
      name: 'knowledgeSources.connectingProvider',
    })
    expect(pendingButton).toBe(connectButton)
    expect(pendingButton).toHaveAttribute('aria-disabled', 'true')
    expect(pendingButton).toHaveFocus()
    await user.click(pendingButton)
    expect(clientMock.createConnection).toHaveBeenCalledOnce()

    await act(async () => createConnectionDeferred.resolve(connection('active')))
    await screen.findByText(/knowledgeSources\.providerConnected/)
  })

  it('discovers installed website providers and keeps the provider-management action', () => {
    server.datasourcePlugins.data = [firecrawlDatasourcePlugin, customCrawlerDatasourcePlugin]
    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('group', { name: 'knowledgeSpace.providerLabel' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Acme Crawler' })).toBeEnabled()
    expect(screen.queryByRole('radio', { name: 'FakeCrawler' })).not.toBeInTheDocument()
    const moreProvidersLink = screen.getByRole('link', {
      name: 'knowledgeSpace.moreProviders',
    })
    expect(moreProvidersLink).toHaveAttribute('href', '/integrations/data-source')
    expect(moreProvidersLink).toHaveAttribute('target', '_blank')
    expect(moreProvidersLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('prompts for provider installation when no datasource integration is installed', () => {
    server.datasourcePlugins.data = []

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('status')).toHaveTextContent('plugin.list.notFound')
    expect(screen.queryByRole('radio', { name: 'Firecrawl' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'knowledgeSpace.moreProviders' })).toHaveAttribute(
      'href',
      '/integrations/data-source',
    )
    expect(screen.queryByText('knowledgeSources.providerUnavailable')).not.toBeInTheDocument()
  })

  it('keeps the handed-off website draft when the provider connection becomes active', async () => {
    const initialSourceDraft = {
      includeSubpages: true,
      maxPages: 100,
      provider: 'Firecrawl' as const,
      rootUrl: 'https://docs.dify.ai',
      sourceName: 'Dify docs',
      sourceType: 'websiteCrawl' as const,
      syncPolicy: 'daily' as const,
    }
    const view = render(
      <AddSourcePage initialSourceDraft={initialSourceDraft} knowledgeSpaceId="space-1" />,
    )
    expect(
      screen.queryByRole('textbox', { name: 'knowledgeSources.rootUrl' }),
    ).not.toBeInTheDocument()

    server.connections.data = [{ items: [connection('active')]] }
    view.rerender(
      <AddSourcePage initialSourceDraft={initialSourceDraft} knowledgeSpaceId="space-1" />,
    )
    expect(screen.getByRole('textbox', { name: /knowledgeSources\.rootUrl/ })).toHaveValue(
      'https://docs.dify.ai',
    )
    expect(screen.getByRole('textbox', { name: /knowledgeSources\.sourceName/ })).toHaveValue(
      'Dify docs',
    )
  })

  it('does not select a lookalike provider by fuzzy display name', () => {
    server.providers.data = {
      items: [{ ...firecrawlProvider, displayName: 'Firecrawl impostor', id: 'impostor' }],
    }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('knowledgeSources.providerUnavailable')).toBeInTheDocument()
  })

  it('clears sensitive input but retains non-sensitive input after a connection error', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockRejectedValue(new Error('provider unavailable'))
    queryState.connections.refetch.mockResolvedValue({ data: queryState.connections.data })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /^knowledgeSources\.configureProvider/ }))
    await user.type(screen.getByLabelText(/Api Key/), 'do-not-retain')
    await user.type(screen.getByLabelText('Endpoint'), 'https://crawl.example.com')
    await user.click(screen.getByRole('button', { name: connectFirecrawlButtonName }))

    expect(
      await screen.findByText('knowledgeSources.connectionFailed:{"provider":"Firecrawl"}'),
    ).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: /^knowledgeSources\.configureProvider/ }))
    await user.type(screen.getByLabelText(/Api Key/), 'secret-value')
    await user.click(screen.getByRole('button', { name: connectFirecrawlButtonName }))

    await waitFor(() => expect(clientMock.createConnection).toHaveBeenCalledOnce())
    expect(await screen.findByText(/knowledgeSources\.providerConnected/)).toBeInTheDocument()
    expect(
      screen.queryByText('knowledgeSources.connectionFailed:{"provider":"Firecrawl"}'),
    ).not.toBeInTheDocument()
  })

  it('clears an API key when authentication modes are changed and changed back', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockResolvedValue(connection('active'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /^knowledgeSources\.configureProvider/ }))
    await user.type(screen.getByLabelText(/Api Key/), 'must-not-return')
    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.authKind.endpoint' }))
    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.authKind.api-key' }))

    expect(screen.getByLabelText(/Api Key/)).toHaveValue('')
  })

  it('supports an endpoint descriptor without sending a hidden secret field', async () => {
    const user = userEvent.setup()
    clientMock.createConnection.mockResolvedValue({
      ...connection('active'),
      authKind: 'endpoint',
    })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /^knowledgeSources\.configureProvider/ }))
    await user.type(screen.getByLabelText(/Api Key/), 'must-not-be-sent')
    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.authKind.endpoint' }))
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
    server.providers.data = { items: [booleanProvider] }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /^knowledgeSources\.configureProvider/ }))

    expect(screen.getByLabelText(/Api Key/)).toHaveAccessibleDescription('Firecrawl API key')
    expect(screen.getByLabelText('Stealth')).toHaveAccessibleDescription('Use stealth mode')
  })

  it('refreshes an errored connection using its current version', async () => {
    const user = userEvent.setup()
    server.connections.data = [{ items: [connection('error')]] }
    clientMock.refreshConnection.mockResolvedValue(connection('active'))

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    expect(
      screen.getByText('knowledgeSources.connectionNeedsAttention:{"provider":"Firecrawl"}'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() =>
      expect(clientMock.refreshConnection).toHaveBeenCalledWith({
        body: { expectedVersion: 2 },
        params: { connection_id: 'connection-1', control_space_id: 'space-1' },
      }),
    )
    expect(queryClientMock.invalidateQueries).toHaveBeenCalled()
    expect(screen.getByText(/knowledgeSources\.providerConnected/)).toBeInTheDocument()
  })

  it('keeps the refresh action focused and explicitly named while pending', async () => {
    const user = userEvent.setup()
    const refreshConnectionDeferred = createDeferred<ReturnType<typeof connection>>()
    server.connections.data = [{ items: [connection('error')]] }
    clientMock.refreshConnection.mockReturnValue(refreshConnectionDeferred.promise)

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    const refreshButton = screen.getByRole('button', { name: 'common.operation.retry' })
    await user.click(refreshButton)

    const pendingButton = screen.getByRole('button', {
      name: 'knowledgeSources.refreshingConnection',
    })
    expect(pendingButton).toBe(refreshButton)
    expect(pendingButton).toHaveAttribute('aria-disabled', 'true')
    expect(pendingButton).toHaveFocus()
    await user.click(pendingButton)
    expect(clientMock.refreshConnection).toHaveBeenCalledOnce()

    await act(async () => refreshConnectionDeferred.resolve(connection('active')))
    await screen.findByText(/knowledgeSources\.providerConnected/)
  })

  it('reconciles a refresh version race and retries with the server version', async () => {
    const user = userEvent.setup()
    server.connections.data = [{ items: [connection('error')]] }
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
    server.connections.data = [{ items: [connection('error', 3)]] }
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
    server.connections.data = [{ items: [connection('error')]] }
    clientMock.refreshConnection.mockResolvedValue(connection('provisioning', 3))

    const view = render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(
      await screen.findByText('knowledgeSources.connectionProvisioning:{"provider":"Firecrawl"}'),
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

    expect(screen.getByText(/knowledgeSources\.providerConnected/)).toBeInTheDocument()
  })

  it('reconciles a provisioning connection with the refreshed server state', async () => {
    const user = userEvent.setup()
    server.connections.data = [{ items: [connection('provisioning')]] }
    queryState.connections.refetch.mockResolvedValue({
      data: { pages: [{ items: [connection('active')] }] },
    })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSources.refreshConnectionStatus' }),
    )

    expect(await screen.findByText(/knowledgeSources\.providerConnected/)).toBeInTheDocument()
  })

  it('shows a retryable error when provisioning reconciliation fails', async () => {
    const user = userEvent.setup()
    server.connections.data = [{ items: [connection('provisioning')]] }
    queryState.connections.refetch.mockResolvedValue({
      data: queryState.connections.data,
      error: new Error('temporary failure'),
    })

    render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSources.refreshConnectionStatus' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'knowledgeSources.connectionRefreshFailed',
    )
  })

  it('shows a retryable error when provisioning reconciliation finds no connection', async () => {
    const user = userEvent.setup()
    server.connections.data = [{ items: [connection('provisioning')]] }
    queryState.connections.refetch.mockImplementation(async () => {
      server.connections.data = [{ items: []] }
      return { data: queryState.connections.data }
    })

    const view = render(<AddSourcePage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSources.refreshConnectionStatus' }),
    )
    view.rerender(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'knowledgeSources.connectionRefreshFailed',
    )
    expect(
      screen.queryByRole('button', { name: /^knowledgeSources\.configureProvider/ }),
    ).not.toBeInTheDocument()
  })

  it('keeps source types selectable and preserves each connected-source draft', async () => {
    const user = userEvent.setup()
    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('radio', { name: 'knowledgeSpace.websiteCrawl' })).toBeChecked()
    const onlineDocuments = screen.getByRole('radio', {
      name: 'knowledgeSpace.onlineDocuments',
    })
    expect(onlineDocuments).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDrive' })).toBeEnabled()
    expect(screen.queryByRole('radio', { name: 'Jina Reader' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'knowledgeSpace.providerLabel' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()

    await user.click(onlineDocuments)
    expect(onlineDocuments).toBeChecked()
    expect(screen.getByRole('group', { name: 'knowledgeSpace.providerLabel' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'knowledgeSources.sourceName' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'knowledgeSources.syncPolicy' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('knowledgeSpace.notionNotConnected')
    await user.type(
      screen.getByRole('textbox', { name: 'knowledgeSources.sourceName' }),
      'Product docs',
    )

    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDrive' }))
    expect(screen.getByRole('radio', { name: 'Google Drive' })).toBeChecked()
    await user.click(onlineDocuments)
    expect(screen.getByRole('textbox', { name: 'knowledgeSources.sourceName' })).toHaveValue(
      'Product docs',
    )
  })

  it('restores the selected source type from the create flow', () => {
    render(<AddSourcePage initialSourceType="onlineDrive" knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDrive' })).toBeChecked()
    expect(screen.getByTestId('connected-source-setup')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'knowledgeSources.sourceName' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('knowledgeSpace.notionNotConnected')
  })

  it.each([
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

  it('does not expose an uninstalled website provider from a shortcut URL', () => {
    render(
      <AddSourcePage
        initialSourceProvider="Jina Reader"
        initialSourceType="websiteCrawl"
        knowledgeSpaceId="space-1"
      />,
    )

    expect(screen.queryByRole('radio', { name: 'Jina Reader' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()
  })

  it('disables the final Add source action while its backend dependency is missing', async () => {
    const user = userEvent.setup()
    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDocuments' }))
    const addSource = screen.getByRole('button', { name: 'knowledgeSpace.addSource' })
    expect(addSource).toBeDisabled()
    expect(toastInfoMock).not.toHaveBeenCalled()
  })

  it('shows catalog unavailability instead of offering a fake connection', () => {
    server.providers.data = {
      items: [{ ...firecrawlProvider, available: false, unavailableReason: 'Disabled by admin' }],
    }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('Disabled by admin')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^knowledgeSources\.configureProvider/ }),
    ).not.toBeInTheDocument()
  })

  it('does not offer unsupported OAuth or undocumented direct connection paths', () => {
    server.providers.data = {
      items: [
        {
          ...firecrawlProvider,
          authKinds: ['oauth2'],
          configuration: firecrawlProvider.configuration.slice(0, 3),
        },
      ],
    }

    render(<AddSourcePage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('knowledgeSources.providerUnavailable')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^knowledgeSources\.configureProvider/ }),
    ).not.toBeInTheDocument()
  })
})

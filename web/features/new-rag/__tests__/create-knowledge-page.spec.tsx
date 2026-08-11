import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateKnowledgePage } from '../create-knowledge-page'

const serviceMock = vi.hoisted(() => ({
  create: vi.fn(),
  createCrawl: vi.fn(),
  createKfsSource: vi.fn(),
  getKfsSource: vi.fn(),
  getCrawlStatus: vi.fn(),
  previewInitialSource: vi.fn(),
  getDefaultModel: vi.fn(),
  getSpace: vi.fn(),
  getSyncPolicy: vi.fn(),
  getWorkflow: vi.fn(),
  listConnections: vi.fn(),
  listProviders: vi.fn(),
  listWorkflowPages: vi.fn(),
  selectWorkflowPages: vi.fn(),
  startKfsCrawlPreview: vi.fn(),
  stageUpload: vi.fn(),
  discardUpload: vi.fn(),
  updateKfsSource: vi.fn(),
  updateSyncPolicy: vi.fn(),
  upload: vi.fn(),
  listKey: vi.fn(() => ['console', 'knowledgeFs', 'listKnowledgeSpaces']),
  sourcesKey: vi.fn(() => ['console', 'knowledgeFs', 'sources']),
  documentsKey: vi.fn(() => ['console', 'knowledgeFs', 'documents']),
}))

const datasourceQueryMock = vi.hoisted(() => ({
  auth: {
    data: { result: [] as Array<Record<string, unknown>> },
    error: null as unknown,
    isPending: false,
    refetch: vi.fn(),
  },
  plugins: {
    data: [] as Array<Record<string, unknown>>,
    error: null as unknown,
    isPending: false,
    refetch: vi.fn(),
  },
}))

const routerMock = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
}))

const navigationMock = vi.hoisted(() => ({
  startMode: null as string | null,
}))

const permissionStateMock = vi.hoisted(() => ({
  atom: Symbol('datasetDefaultPermissionKeysAtom'),
  keys: ['dataset.acl.access_config'],
}))

const systemFeaturesStateMock = vi.hoisted(() => ({
  uploadAtom: Symbol('knowledgeFsUploadEnabledAtom'),
  rbacAtom: Symbol('rbacEnabledAtom'),
  uploadEnabled: true,
  rbacEnabled: true,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => ({
    get: (key: string) => (key === 'start' ? navigationMock.startMode : null),
  }),
}))

vi.mock('@/context/permission-state', () => ({
  datasetDefaultPermissionKeysAtom: permissionStateMock.atom,
}))

vi.mock('@/features/system-features/state', () => ({
  knowledgeFsUploadEnabledAtom: systemFeaturesStateMock.uploadAtom,
  rbacEnabledAtom: systemFeaturesStateMock.rbacAtom,
}))

vi.mock('jotai', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai')>()
  return {
    ...original,
    useAtomValue: (atom: unknown) =>
      atom === permissionStateMock.atom
        ? permissionStateMock.keys
        : atom === systemFeaturesStateMock.uploadAtom
          ? systemFeaturesStateMock.uploadEnabled
          : atom === systemFeaturesStateMock.rbacAtom
            ? systemFeaturesStateMock.rbacEnabled
            : original.useAtomValue(atom as Parameters<typeof original.useAtomValue>[0]),
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      sourceProviderPreview: {
        post: serviceMock.previewInitialSource,
      },
      spaces: {
        byControlSpaceId: {
          get: serviceMock.getSpace,
          sourceConnections: {
            get: serviceMock.listConnections,
          },
          sourceProviders: {
            get: serviceMock.listProviders,
          },
          sourceWorkflows: {
            byRunId: {
              get: serviceMock.getWorkflow,
              pages: {
                get: serviceMock.listWorkflowPages,
              },
              selection: {
                post: serviceMock.selectWorkflowPages,
              },
            },
          },
          sources: {
            bySourceId: {
              crawlPreview: {
                post: serviceMock.startKfsCrawlPreview,
              },
              get: serviceMock.getKfsSource,
              patch: serviceMock.updateKfsSource,
              syncPolicy: {
                get: serviceMock.getSyncPolicy,
                put: serviceMock.updateSyncPolicy,
              },
            },
            post: serviceMock.createKfsSource,
          },
        },
        post: serviceMock.create,
      },
    },
    workspaces: {
      current: {
        defaultModel: {
          get: serviceMock.getDefaultModel,
        },
      },
    },
  },
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        get: {
          key: serviceMock.listKey,
        },
        byControlSpaceId: {
          documents: {
            get: {
              key: serviceMock.documentsKey,
            },
          },
          sources: {
            get: {
              key: serviceMock.sourcesKey,
            },
          },
        },
      },
    },
  },
}))

vi.mock('@/service/datasets', () => ({
  checkFirecrawlTaskStatus: serviceMock.getCrawlStatus,
  checkJinaReaderTaskStatus: serviceMock.getCrawlStatus,
  checkWatercrawlTaskStatus: serviceMock.getCrawlStatus,
  createFirecrawlTask: serviceMock.createCrawl,
  createJinaReaderTask: serviceMock.createCrawl,
  createWatercrawlTask: serviceMock.createCrawl,
}))

vi.mock('@/service/use-pipeline', () => ({
  useDataSourceList: () => datasourceQueryMock.plugins,
}))

vi.mock('@/service/use-datasource', () => ({
  useGetDataSourceListAuth: () => datasourceQueryMock.auth,
}))

const firecrawlDatasourcePlugin = {
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

const firecrawlDatasourceAuth = {
  author: 'langgenius',
  credentials_list: [
    {
      avatar_url: '',
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
  plugin_id: 'langgenius/firecrawl_datasource',
  plugin_unique_identifier: 'langgenius/firecrawl_datasource:1.0.0@local',
  provider: 'firecrawl',
}

const jinaDatasourcePlugin = {
  ...firecrawlDatasourcePlugin,
  declaration: {
    ...firecrawlDatasourcePlugin.declaration,
    identity: {
      ...firecrawlDatasourcePlugin.declaration.identity,
      label: { en_US: 'Jina Reader', zh_Hans: 'Jina Reader' },
      name: 'jinareader',
    },
  },
  plugin_id: 'langgenius/jina_datasource',
  plugin_unique_identifier: 'langgenius/jina_datasource:1.0.0@local',
  provider: 'jinareader',
}

const jinaDatasourceAuth = {
  ...firecrawlDatasourceAuth,
  credentials_list: [
    {
      ...firecrawlDatasourceAuth.credentials_list[0],
      id: 'jina-credential-1',
      name: 'Default Jina Reader',
    },
  ],
  label: { en_US: 'Jina Reader' },
  name: 'jinareader',
  plugin_id: 'langgenius/jina_datasource',
  plugin_unique_identifier: 'langgenius/jina_datasource:1.0.0@local',
  provider: 'jinareader',
}

const notionDatasourcePlugin = {
  ...firecrawlDatasourcePlugin,
  declaration: {
    ...firecrawlDatasourcePlugin.declaration,
    datasources: [
      {
        description: { en_US: 'Notion', zh_Hans: 'Notion' },
        identity: {
          author: 'langgenius',
          label: { en_US: 'Notion', zh_Hans: 'Notion' },
          name: 'notion',
          provider: 'notion',
        },
        parameters: [],
      },
    ],
    identity: {
      ...firecrawlDatasourcePlugin.declaration.identity,
      label: { en_US: 'Notion', zh_Hans: 'Notion' },
      name: 'notion',
    },
    provider_type: 'online_document',
  },
  plugin_id: 'langgenius/notion_datasource',
  plugin_unique_identifier: 'langgenius/notion_datasource:1.0.0@local',
  provider: 'notion',
}

const notionDatasourceAuth = {
  ...firecrawlDatasourceAuth,
  credentials_list: [
    {
      ...firecrawlDatasourceAuth.credentials_list[0],
      id: 'notion-credential-1',
      name: 'Default Notion',
    },
  ],
  label: { en_US: 'Notion' },
  name: 'notion',
  plugin_id: 'langgenius/notion_datasource',
  plugin_unique_identifier: 'langgenius/notion_datasource:1.0.0@local',
  provider: 'notion',
}

const googleDriveDatasourcePlugin = {
  ...firecrawlDatasourcePlugin,
  declaration: {
    ...firecrawlDatasourcePlugin.declaration,
    datasources: [
      {
        description: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
        identity: {
          author: 'langgenius',
          label: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
          name: 'google_drive',
          provider: 'google_drive',
        },
        parameters: [],
      },
    ],
    identity: {
      ...firecrawlDatasourcePlugin.declaration.identity,
      label: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
      name: 'google_drive',
    },
    provider_type: 'online_drive',
  },
  plugin_id: 'langgenius/google_drive',
  plugin_unique_identifier: 'langgenius/google_drive:1.0.0@local',
  provider: 'google_drive',
}

const googleDriveDatasourceAuth = {
  ...firecrawlDatasourceAuth,
  credentials_list: [
    {
      ...firecrawlDatasourceAuth.credentials_list[0],
      id: 'google-drive-credential-1',
      name: 'Default Google Drive',
    },
  ],
  label: { en_US: 'Google Drive' },
  name: 'google_drive',
  plugin_id: 'langgenius/google_drive',
  plugin_unique_identifier: 'langgenius/google_drive:1.0.0@local',
  provider: 'google_drive',
}

const createdKnowledge = {
  control_space_id: 'e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084',
  model_setup_required: false,
  operation_id: 'operation-1',
  state: 'provisioning' as const,
}

const kfsSourceResponse = (overrides: Record<string, unknown> = {}) => ({
  connection_id: 'firecrawl-connection-1',
  created_at: '2026-08-06T10:00:00Z',
  credential_configured: true,
  id: 'source-1',
  knowledge_space_id: createdKnowledge.control_space_id,
  metadata: {},
  name: 'Dify docs',
  permission_scope: [],
  status: 'disabled',
  type: 'web',
  updated_at: '2026-08-06T10:00:00Z',
  uri: 'https://docs.dify.ai',
  version: 1,
  ...overrides,
})

const workflowResponse = (overrides: Record<string, unknown> = {}) => ({
  canceled_at: null,
  checkpoint: 'complete',
  completed_at: '2026-08-06T10:01:00Z',
  created_at: '2026-08-06T10:00:00Z',
  cursor: null,
  execution_attempts: 1,
  id: 'run-1',
  knowledge_space_id: createdKnowledge.control_space_id,
  kind: 'crawl-preview',
  last_error_code: null,
  max_execution_attempts: 3,
  progress_completed: 1,
  progress_failed: 0,
  progress_skipped: 0,
  progress_total: 1,
  source_id: 'source-1',
  state: 'completed',
  updated_at: '2026-08-06T10:01:00Z',
  ...overrides,
})

vi.mock('../knowledge-fs-upload', () => ({
  discardKnowledgeFsStagedUpload: serviceMock.discardUpload,
  stageKnowledgeFsDocument: async (file: File) => {
    const result = await serviceMock.stageUpload({ body: { file } })
    return result.id
  },
  uploadKnowledgeFsDocuments: async (
    knowledgeSpaceId: string,
    uploads: Array<{ file: File; id: string; uploadId: string }>,
    _progress: Map<string, { phase: 'completed' | 'pending' }>,
    onProgress?: (file: File, phase: 'completed' | 'pending') => void,
  ) => {
    for (const { file, uploadId } of uploads) {
      onProgress?.(file, 'pending')
      await serviceMock.upload({
        body: { upload_id: uploadId },
        params: { control_space_id: knowledgeSpaceId },
      })
      onProgress?.(file, 'completed')
    }
  },
}))

function renderPage(
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, ...render(<CreateKnowledgePage />, { wrapper: Wrapper }) }
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' }),
    '  Product handbook  ',
  )
  await user.type(
    screen.getByRole('textbox', { name: /dataset\.newKnowledge\.description/ }),
    '  Internal answers  ',
  )
}

async function choosePermission(user: ReturnType<typeof userEvent.setup>, optionName: string) {
  await user.click(screen.getByRole('combobox', { name: 'dataset.newKnowledge.permission' }))
  await user.click(await screen.findByRole('option', { name: optionName }))
}

describe('CreateKnowledgePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.sessionStorage.clear()
    datasourceQueryMock.plugins.data = [firecrawlDatasourcePlugin]
    datasourceQueryMock.plugins.error = null
    datasourceQueryMock.plugins.isPending = false
    datasourceQueryMock.auth.data = { result: [firecrawlDatasourceAuth] }
    datasourceQueryMock.auth.error = null
    datasourceQueryMock.auth.isPending = false
    serviceMock.create.mockResolvedValue(createdKnowledge)
    serviceMock.createCrawl.mockResolvedValue({ job_id: 'crawl-job-1' })
    serviceMock.createKfsSource.mockResolvedValue(kfsSourceResponse())
    serviceMock.getKfsSource.mockResolvedValue(kfsSourceResponse({ status: 'active', version: 3 }))
    serviceMock.getCrawlStatus.mockResolvedValue({
      data: [
        {
          description: 'Getting started',
          markdown: '# Getting started',
          source_url: 'https://docs.dify.ai/getting-started',
          title: 'Getting started',
        },
      ],
      status: 'completed',
    })
    serviceMock.getSyncPolicy.mockRejectedValue({ status: 404 })
    serviceMock.getWorkflow.mockResolvedValue(workflowResponse())
    serviceMock.listConnections.mockResolvedValue({
      data: [
        {
          auth_kind: 'endpoint',
          configuration: {},
          created_at: '2026-08-06T10:00:00Z',
          error_code: null,
          expires_at: null,
          id: 'firecrawl-connection-1',
          knowledge_space_id: createdKnowledge.control_space_id,
          name: 'Firecrawl',
          provider_id: 'plugin-daemon-website',
          scopes: [],
          status: 'active',
          updated_at: '2026-08-06T10:00:00Z',
          version: 1,
        },
      ],
      next_cursor: null,
    })
    serviceMock.listProviders.mockResolvedValue({
      data: [
        {
          auth_kinds: ['endpoint'],
          available: true,
          capabilities: ['website-crawl'],
          configuration: [],
          display_name: 'Firecrawl',
          id: 'plugin-daemon-website',
          unavailable_reason: null,
        },
      ],
    })
    serviceMock.listWorkflowPages.mockResolvedValue({
      data: [
        {
          description: 'Getting started',
          etag: null,
          page_id: 'kfs-page-1',
          source_url: 'https://docs.dify.ai/getting-started',
          title: 'Getting started',
        },
      ],
      next_cursor: null,
    })
    serviceMock.selectWorkflowPages.mockResolvedValue(
      workflowResponse({ id: 'import-run-1', kind: 'import', state: 'completed' }),
    )
    serviceMock.startKfsCrawlPreview.mockResolvedValue(workflowResponse())
    serviceMock.updateKfsSource.mockResolvedValue(
      kfsSourceResponse({ status: 'active', version: 2 }),
    )
    serviceMock.updateSyncPolicy.mockResolvedValue({
      created_at: '2026-08-06T10:00:00Z',
      custom_interval_seconds: null,
      enabled: true,
      expected_source_version: 3,
      id: 'policy-1',
      knowledge_space_id: createdKnowledge.control_space_id,
      mode: 'provider',
      next_run_at: null,
      revision: 1,
      source_id: 'source-1',
      updated_at: '2026-08-06T10:00:00Z',
    })
    serviceMock.getDefaultModel.mockImplementation(({ query }: { query: { model_type: string } }) =>
      Promise.resolve({
        data: {
          model: query.model_type === 'llm' ? 'echo' : 'embed',
          model_type: query.model_type,
          provider: {
            provider:
              query.model_type === 'llm'
                ? 'kurokobo/fake_models/fake_models'
                : 'langgenius/cohere/cohere',
          },
        },
      }),
    )
    serviceMock.getSpace.mockResolvedValue({
      control_space_id: createdKnowledge.control_space_id,
      created_at: '2026-08-10T09:45:02Z',
      knowledge_space_id: 'knowledge-space-1',
      owner_account_id: 'account-1',
      permission_keys: ['knowledge_space_read'],
      resource_version: 1,
      state: 'active',
      technical_status: 'available',
      technical_summary: null,
      updated_at: '2026-08-10T09:45:38Z',
      visibility: 'all_team_members',
    })
    serviceMock.upload.mockResolvedValue({
      id: 'document-1',
    })
    serviceMock.stageUpload.mockImplementation(({ body }: { body: { file: File } }) =>
      Promise.resolve({ id: `staged-${body.file.name}` }),
    )
    serviceMock.discardUpload.mockResolvedValue(undefined)
    permissionStateMock.keys = ['dataset.acl.access_config']
    systemFeaturesStateMock.uploadEnabled = true
    systemFeaturesStateMock.rbacEnabled = true
    navigationMock.startMode = null
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      'a9c36c57-2d84-44d6-a36d-841f0d92a179',
    )
  })

  afterEach(() => {
    globalThis.sessionStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps create disabled until the knowledge name is provided', async () => {
    const user = userEvent.setup()
    renderPage()

    const createButton = screen.getByRole('button', {
      name: 'dataset.newKnowledge.createTitle',
    })
    expect(createButton).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' }), 'Handbook')
    expect(createButton).toBeEnabled()
  })

  it('creates a private empty knowledge space, invalidates the list, and navigates', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderPage(queryClient)
    await fillRequiredFields(user)
    await choosePermission(user, 'dataset.newKnowledge.permissionOnlyMe')

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => {
      expect(serviceMock.create).toHaveBeenCalledWith({
        body: {
          description: 'Internal answers',
          embedding: {
            model: 'embed',
            plugin_id: 'langgenius/cohere',
            provider: 'cohere',
          },
          idempotency_key: 'a9c36c57-2d84-44d6-a36d-841f0d92a179',
          name: 'Product handbook',
          retrieval: {
            default_mode: 'fast',
            reasoning_model: {
              model: 'echo',
              plugin_id: 'kurokobo/fake_models',
              provider: 'fake_models',
            },
            rerank: { enabled: false },
            score_threshold: { enabled: false, stage: 'mode-final' },
            top_k: 10,
          },
          slug: 'product-handbook-a9c36c572d84',
          visibility: 'only_me',
        },
      })
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['console', 'knowledgeFs', 'listKnowledgeSpaces'],
    })
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources',
    )
  })

  it('creates the default all-members visibility atomically', async () => {
    const user = userEvent.setup()
    renderPage()
    await fillRequiredFields(user)
    expect(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.permission' }),
    ).toHaveTextContent('dataset.newKnowledge.permissionAllMembers')

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => {
      expect(serviceMock.create).toHaveBeenCalledWith({
        body: expect.objectContaining({ visibility: 'all_team_members' }),
      })
    })
  })

  it('keeps the legacy private default editable when RBAC is disabled', async () => {
    const user = userEvent.setup()
    permissionStateMock.keys = []
    systemFeaturesStateMock.rbacEnabled = false
    renderPage()
    await fillRequiredFields(user)

    const permission = screen.getByRole('combobox', {
      name: 'dataset.newKnowledge.permission',
    })
    expect(permission).toBeEnabled()
    expect(permission).toHaveTextContent('dataset.newKnowledge.permissionOnlyMe')
    expect(screen.queryByText('dataset.newKnowledge.permissionRestricted')).not.toBeInTheDocument()

    await choosePermission(user, 'dataset.newKnowledge.permissionAllMembers')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.objectContaining({ visibility: 'all_team_members' }),
    })
  })

  it('forces RBAC users without access-config permission to create a private space', async () => {
    const user = userEvent.setup()
    permissionStateMock.keys = []
    renderPage()
    await fillRequiredFields(user)

    const permission = screen.getByRole('combobox', {
      name: 'dataset.newKnowledge.permission',
    })
    expect(permission).toBeDisabled()
    expect(permission).toHaveTextContent('dataset.newKnowledge.permissionOnlyMe')
    expect(permission).toHaveAccessibleDescription('dataset.newKnowledge.permissionRestricted')
    expect(screen.getByText('dataset.newKnowledge.permissionRestricted')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.objectContaining({ visibility: 'only_me' }),
    })
  })

  it('prevents duplicate pending submissions', async () => {
    const user = userEvent.setup()
    let resolveCreate: (value: typeof createdKnowledge) => void = () => undefined
    serviceMock.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    renderPage()
    await fillRequiredFields(user)
    const createButton = screen.getByRole('button', {
      name: 'dataset.newKnowledge.createTitle',
    })

    await user.dblClick(createButton)

    expect(serviceMock.create).toHaveBeenCalledOnce()
    expect(createButton).toHaveAttribute('aria-disabled', 'true')
    resolveCreate(createdKnowledge)
  })

  it('keeps the same idempotency key for a safe retry after failure', async () => {
    const user = userEvent.setup()
    serviceMock.create.mockRejectedValueOnce(new Error('upstream unavailable'))
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('dataset.newKnowledge.createFailed')
    expect(screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledTimes(2))
    expect(serviceMock.create.mock.calls[0]?.[0].body.idempotency_key).toBe(
      serviceMock.create.mock.calls[1]?.[0].body.idempotency_key,
    )
  })

  it('creates an empty knowledge base when a default model is missing', async () => {
    const user = userEvent.setup()
    serviceMock.create.mockResolvedValueOnce({
      ...createdKnowledge,
      model_setup_required: true,
    })
    vi.mocked(globalThis.crypto.randomUUID).mockReturnValueOnce(
      '11111111-1111-4111-8111-111111111111',
    )
    serviceMock.getDefaultModel.mockImplementation(({ query }: { query: { model_type: string } }) =>
      Promise.resolve(
        query.model_type === 'llm'
          ? {
              data: {
                model: 'echo',
                provider: { provider: 'kurokobo/fake_models/fake_models' },
              },
            }
          : { data: null },
      ),
    )
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.not.objectContaining({
        embedding: expect.anything(),
        retrieval: expect.anything(),
      }),
    })
    expect(routerMock.replace).toHaveBeenCalledWith(
      `/datasets/new/${createdKnowledge.control_space_id}/sources`,
    )
  })

  it('creates without model presets when loading default models fails', async () => {
    const user = userEvent.setup()
    serviceMock.create.mockResolvedValueOnce({
      ...createdKnowledge,
      model_setup_required: true,
    })
    serviceMock.getDefaultModel.mockRejectedValue(new Error('model service unavailable'))
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.not.objectContaining({
        embedding: expect.anything(),
        retrieval: expect.anything(),
      }),
    })
  })

  it('creates the space but prompts for model setup before uploading', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    serviceMock.create.mockResolvedValueOnce({
      ...createdKnowledge,
      model_setup_required: true,
    })
    serviceMock.getDefaultModel.mockResolvedValue({ data: null })
    renderPage()
    await fillRequiredFields(user)
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'guide.txt', { type: 'text/plain' }),
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'common.modelProvider.toBeConfigured',
    )
    expect(serviceMock.create).toHaveBeenCalledOnce()
    expect(serviceMock.upload).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: 'common.modelProvider.selector.configure' }),
    )
    expect(routerMock.replace).toHaveBeenCalledWith(
      `/datasets/new/${createdKnowledge.control_space_id}/settings`,
    )
  })

  it.each([400, 401, 403, 422])(
    'unlocks editable fields and rotates the idempotency key after a definitive %s rejection',
    async (status) => {
      const user = userEvent.setup()
      vi.mocked(globalThis.crypto.randomUUID)
        .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
        .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
      serviceMock.create.mockRejectedValueOnce({ status })
      renderPage()
      await fillRequiredFields(user)

      await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'dataset.newKnowledge.createFailed',
      )
      const nameInput = screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' })
      expect(nameInput).toBeEnabled()
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated handbook')
      await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

      await waitFor(() => expect(serviceMock.create).toHaveBeenCalledTimes(2))
      expect(serviceMock.create.mock.calls[0]?.[0].body.idempotency_key).toBe(
        '11111111-1111-4111-8111-111111111111',
      )
      expect(serviceMock.create.mock.calls[1]?.[0].body).toMatchObject({
        idempotency_key: '22222222-2222-4222-8222-222222222222',
        name: 'Updated handbook',
      })
    },
  )

  it.each([409, 429, 503])(
    'keeps request identity frozen after an ambiguous %s response',
    async (status) => {
      const user = userEvent.setup()
      serviceMock.create.mockRejectedValueOnce({ status })
      renderPage()
      await fillRequiredFields(user)

      await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'dataset.newKnowledge.createFailed',
      )
      expect(screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' })).toBeDisabled()
      expect(
        screen.getByRole('combobox', { name: 'dataset.newKnowledge.permission' }),
      ).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

      await waitFor(() => expect(serviceMock.create).toHaveBeenCalledTimes(2))
      expect(serviceMock.create.mock.calls[0]?.[0].body.idempotency_key).toBe(
        serviceMock.create.mock.calls[1]?.[0].body.idempotency_key,
      )
    },
  )

  it('safely resumes a downstream upload after the control space is created', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    serviceMock.upload.mockRejectedValueOnce(new Error('upload unavailable'))
    renderPage(queryClient)
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )
    await waitFor(() =>
      expect(serviceMock.stageUpload).toHaveBeenCalledWith({
        body: { file: expect.objectContaining({ name: 'handbook.md' }) },
      }),
    )
    expect(serviceMock.create).not.toHaveBeenCalled()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentUploadFailed',
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['console', 'knowledgeFs', 'listKnowledgeSpaces'],
    })
    const nameInput = screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' })
    expect(nameInput).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'dataset.newKnowledge.permission' })).toBeDisabled()
    await user.type(nameInput, ' changed')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.upload).toHaveBeenCalledTimes(2))
    expect(serviceMock.create).toHaveBeenCalledOnce()
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/documents',
    )
  })

  it('converges after an atomic creation response is lost', async () => {
    const user = userEvent.setup()
    serviceMock.create.mockRejectedValueOnce(new Error('response lost'))
    renderPage()
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('dataset.newKnowledge.createFailed')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledTimes(2)
    expect(serviceMock.create.mock.calls[0]?.[0].body.idempotency_key).toBe(
      serviceMock.create.mock.calls[1]?.[0].body.idempotency_key,
    )
  })

  it('enables every atomic source type and distinguishes installed providers', async () => {
    const user = userEvent.setup()
    renderPage()

    const startEmpty = screen.getByRole('radio', { name: 'dataset.newKnowledge.startEmpty' })
    expect(startEmpty).toBeChecked()
    expect(startEmpty).toHaveAccessibleDescription('dataset.newKnowledge.startEmptyDescription')
    const connectSource = screen.getByRole('radio', {
      name: 'dataset.newKnowledge.connectSource',
    })
    const uploadFiles = screen.getByRole('radio', { name: 'dataset.newKnowledge.uploadFiles' })
    expect(connectSource).toBeEnabled()
    expect(uploadFiles).toBeEnabled()

    await user.click(connectSource)
    expect(connectSource).toBeChecked()
    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.websiteCrawl' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.websiteCrawl' })).toBeChecked()
    const onlineDocuments = screen.getByRole('radio', {
      name: 'dataset.newKnowledge.onlineDocuments',
    })
    expect(onlineDocuments).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDrive' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Jina Reader' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'WaterCrawl' })).toBeEnabled()
    await user.click(onlineDocuments)
    expect(onlineDocuments).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Notion' })).toBeChecked()
    expect(screen.getByText('workflow.nodes.common.pluginNotInstalled')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.websiteCrawl' }))
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.moreProviders' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.crawlOptions')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }),
    ).toBeDisabled()
    expect(screen.getByText('dataset.newKnowledge.pagesAppearTitle')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.usingDefaults')).toBeInTheDocument()
    const rootUrl = screen.getByPlaceholderText('dataset.newKnowledge.rootUrlPlaceholder')
    const sourceName = screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder')
    expect(rootUrl).toBeEnabled()
    expect(sourceName).toBeEnabled()
    await user.type(rootUrl, 'https://docs.dify.ai')
    await user.type(sourceName, 'Dify docs')
    const crawlAndPreview = screen.getByRole('button', {
      name: 'dataset.newKnowledge.crawlAndPreview',
    })
    expect(crawlAndPreview).toBeEnabled()
    await user.click(crawlAndPreview)
    expect(serviceMock.create).not.toHaveBeenCalled()
    expect(routerMock.replace).not.toHaveBeenCalled()
    expect(await screen.findByText('Getting started')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/^dataset\.newKnowledge\.pagesCrawled/)).toBeInTheDocument()
    expect(screen.getByText(/^dataset\.newKnowledge\.pagesSelected/)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Getting started' }))
    expect(screen.getByText(/^dataset\.newKnowledge\.pagesSelected/)).toHaveTextContent('1')
    await user.click(uploadFiles)
    expect(uploadFiles).toBeChecked()
    const uploadInput = screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
      selector: 'input[type="file"]',
    })
    expect(uploadInput).toBeInTheDocument()
    expect(uploadInput).not.toHaveAttribute('hidden')
    expect(uploadInput.nextElementSibling).toHaveClass('peer-focus-visible:ring-2')
    uploadInput.focus()
    expect(uploadInput).toHaveFocus()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' })).toBeDisabled()
  })

  it('disables upload before creating a space when direct upload is unavailable', () => {
    navigationMock.startMode = 'upload'
    systemFeaturesStateMock.uploadEnabled = false

    renderPage()

    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.startEmpty' })).toBeChecked()
    const uploadFiles = screen.getByRole('radio', { name: 'dataset.newKnowledge.uploadFiles' })
    expect(uploadFiles).toBeDisabled()
    expect(uploadFiles).toHaveAccessibleDescription(
      'dataset.newKnowledge.uploadFilesDescription dataset.cornerLabel.unavailable',
    )
    expect(serviceMock.create).not.toHaveBeenCalled()
  })

  it('continues from the upload mode after real creation succeeds', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    renderPage()

    expect(screen.getByRole('radio', { name: 'dataset.newKnowledge.uploadFiles' })).toBeChecked()
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )
    await fillRequiredFields(user)
    await choosePermission(user, 'dataset.newKnowledge.permissionOnlyMe')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(
        '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/documents',
      ),
    )
    expect(serviceMock.upload).toHaveBeenCalledWith({
      body: { upload_id: 'staged-handbook.md' },
      params: { control_space_id: createdKnowledge.control_space_id },
    })
  })

  it('queues uploads when native random UUID generation is unavailable', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    vi.restoreAllMocks()
    const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    })

    try {
      renderPage()
      await user.upload(
        screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
          selector: 'input[type="file"]',
        }),
        new File(['content'], 'handbook.md', { type: 'text/markdown' }),
      )

      expect(screen.getByText('handbook.md')).toBeInTheDocument()
    } finally {
      if (descriptor) Object.defineProperty(globalThis.crypto, 'randomUUID', descriptor)
      else Reflect.deleteProperty(globalThis.crypto, 'randomUUID')
    }
  })

  it('previews a configured website in place without creating a knowledge space', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()
    await fillRequiredFields(user)
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.rootUrlPlaceholder'),
      'https://docs.dify.ai',
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder'),
      'Dify docs',
    )
    await user.keyboard('{Enter}')
    expect(serviceMock.create).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlOptions' }))
    await user.click(screen.getByRole('checkbox', { name: 'dataset.newKnowledge.includeSubpages' }))
    const maxPages = screen.getByRole('textbox', { name: 'dataset.newKnowledge.maxPages' })
    await user.clear(maxPages)
    await user.type(maxPages, '25')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlOptions' }))
    expect(
      screen.getByText(
        'dataset.newKnowledge.includeSubpages: dataset.newKnowledge.booleanFalse · dataset.newKnowledge.maxPages: 25',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))

    expect(serviceMock.create).not.toHaveBeenCalled()
    expect(routerMock.replace).not.toHaveBeenCalled()
    expect(serviceMock.createCrawl).toHaveBeenCalledWith({
      options: expect.objectContaining({
        crawl_sub_pages: false,
        limit: 25,
      }),
      url: 'https://docs.dify.ai',
    })
    expect(await screen.findByText('Getting started')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAll' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Getting started' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.reCrawl' })).toBeEnabled()
    const syncPolicy = screen.getByRole('combobox', {
      name: 'dataset.newKnowledge.syncPolicy',
    })
    expect(syncPolicy).toHaveTextContent('dataset.newKnowledge.syncPolicyDaily')
    await user.click(syncPolicy)
    await user.click(
      await screen.findByRole('option', { name: 'dataset.newKnowledge.syncPolicyManual' }),
    )
    expect(syncPolicy).toHaveTextContent('dataset.newKnowledge.syncPolicyManual')
    expect(screen.getByText('Getting started')).toBeInTheDocument()
  })

  it('creates an initial source from a synchronous Jina Reader preview', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    datasourceQueryMock.plugins.data = [firecrawlDatasourcePlugin, jinaDatasourcePlugin]
    datasourceQueryMock.auth.data = { result: [firecrawlDatasourceAuth, jinaDatasourceAuth] }
    serviceMock.createCrawl.mockResolvedValueOnce({
      data: {
        content: '# Dify introduction',
        description: 'Introduction',
        title: 'Dify introduction',
        url: 'https://docs.dify.ai/introduction',
      },
    })
    renderPage()
    await fillRequiredFields(user)
    await user.click(screen.getByRole('radio', { name: 'Jina Reader' }))
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.rootUrlPlaceholder'),
      'https://docs.dify.ai/introduction',
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder'),
      'Dify introduction',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))

    await user.click(await screen.findByRole('checkbox', { name: 'Dify introduction' }))
    expect(serviceMock.getCrawlStatus).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.objectContaining({
        initial_source: expect.objectContaining({
          credentialId: 'jina-credential-1',
          pluginId: 'langgenius/jina_datasource',
          provider: 'jinareader',
          selection: [
            expect.objectContaining({
              source_url: 'https://docs.dify.ai/introduction',
              title: 'Dify introduction',
            }),
          ],
        }),
      }),
    })
  })

  it('shows and can stop an ongoing website crawl', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    serviceMock.getCrawlStatus.mockImplementation(() => new Promise(() => {}))
    renderPage()
    await fillRequiredFields(user)
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.rootUrlPlaceholder'),
      'https://docs.dify.ai',
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder'),
      'Dify docs',
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'dataset.newKnowledge.crawlingPages',
    )
    const stopButton = screen.getByRole('button', { name: 'dataset.newKnowledge.stopCrawl' })
    expect(stopButton).toBeEnabled()

    await user.click(stopButton)
    expect(screen.getByRole('status')).toHaveTextContent('dataset.newKnowledge.crawlStopped')
  })

  it('submits selected preview URLs for the server-side crawl import', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()
    await fillRequiredFields(user)
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.rootUrlPlaceholder'),
      'https://docs.dify.ai',
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder'),
      'Dify docs',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.crawlAndPreview' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
    await waitFor(() =>
      expect(screen.getByText(/^dataset\.newKnowledge\.pagesSelected/)).toHaveTextContent('1'),
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(
        '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources',
      ),
    )
    expect(routerMock.replace).not.toHaveBeenCalledWith(expect.stringContaining('/sources/new'))
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.objectContaining({
        initial_source: {
          crawl_options: {
            include_subpages: true,
            limit: 100,
          },
          credentialId: 'firecrawl-credential-1',
          datasource: 'crawl',
          kind: 'website_crawl',
          name: 'Dify docs',
          pluginId: 'langgenius/firecrawl_datasource',
          provider: 'firecrawl',
          providerDisplayName: 'Firecrawl',
          root_url: 'https://docs.dify.ai',
          selection: [
            {
              source_url: 'https://docs.dify.ai/getting-started',
              title: 'Getting started',
            },
          ],
          sync_policy: 'daily',
        },
      }),
    })
    expect(serviceMock.createKfsSource).not.toHaveBeenCalled()
    expect(serviceMock.startKfsCrawlPreview).not.toHaveBeenCalled()
    expect(serviceMock.selectWorkflowPages).not.toHaveBeenCalled()
  })

  it('distinguishes an installed document provider with no credential', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    datasourceQueryMock.plugins.data = [firecrawlDatasourcePlugin, notionDatasourcePlugin]
    renderPage()

    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDocuments' }))

    expect(
      screen.getByText('dataset.newKnowledge.providerNotConfigured:{"provider":"Notion"}'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.connectProvider:{"provider":"Notion"}',
      }),
    ).toBeEnabled()
    expect(screen.queryByText('workflow.nodes.common.pluginNotInstalled')).not.toBeInTheDocument()
  })

  it('creates a knowledge space atomically with selected online documents', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    datasourceQueryMock.plugins.data = [firecrawlDatasourcePlugin, notionDatasourcePlugin]
    datasourceQueryMock.auth.data = {
      result: [firecrawlDatasourceAuth, notionDatasourceAuth],
    }
    serviceMock.previewInitialSource.mockResolvedValue({
      documents: [
        {
          last_edited_time: '2026-08-10T08:00:00Z',
          name: 'Product handbook',
          page_id: 'page-1',
          provider_item_id: '["workspace-1","page-1"]',
          type: 'page',
          workspace_id: 'workspace-1',
          workspace_name: 'Dify',
        },
      ],
      kind: 'online_document',
      next_page_parameters: null,
    })
    renderPage()
    await fillRequiredFields(user)
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDocuments' }))
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder'),
      'Notion handbook',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.preview' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Product handbook' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }),
      ).toBeEnabled(),
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.objectContaining({
        initial_source: {
          credentialId: 'notion-credential-1',
          datasource: 'notion',
          kind: 'online_document',
          name: 'Notion handbook',
          pluginId: 'langgenius/notion_datasource',
          provider: 'notion',
          providerDisplayName: 'Notion',
          selection: [
            {
              lastEditedTime: '2026-08-10T08:00:00Z',
              name: 'Product handbook',
              pageId: 'page-1',
              providerItemId: '["workspace-1","page-1"]',
              type: 'page',
              workspaceId: 'workspace-1',
            },
          ],
          sync_policy: 'provider',
        },
      }),
    })
  })

  it('creates a knowledge space atomically with a selected drive file', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    datasourceQueryMock.plugins.data = [firecrawlDatasourcePlugin, googleDriveDatasourcePlugin]
    datasourceQueryMock.auth.data = {
      result: [firecrawlDatasourceAuth, googleDriveDatasourceAuth],
    }
    serviceMock.previewInitialSource.mockResolvedValue({
      files: [
        {
          bucket: null,
          id: 'file-1',
          mime_type: 'application/pdf',
          name: 'Runbook.pdf',
          provider_item_id: '["","file-1"]',
          size: 2048,
          type: 'application/pdf',
        },
      ],
      kind: 'online_drive',
      next_page_parameters: null,
    })
    renderPage()
    await fillRequiredFields(user)
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDrive' }))
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder'),
      'Drive runbook',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.preview' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Runbook.pdf' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }),
      ).toBeEnabled(),
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.objectContaining({
        initial_source: {
          credentialId: 'google-drive-credential-1',
          datasource: 'google_drive',
          kind: 'online_drive',
          name: 'Drive runbook',
          pluginId: 'langgenius/google_drive',
          provider: 'google_drive',
          providerDisplayName: 'Google Drive',
          selection: [
            {
              bucket: undefined,
              id: 'file-1',
              mimeType: 'application/pdf',
              name: 'Runbook.pdf',
              providerItemId: '["","file-1"]',
            },
          ],
          sync_policy: 'provider',
        },
      }),
    })
  })

  it('uses the online-drive transport when creating with Google Docs', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    datasourceQueryMock.plugins.data = [
      firecrawlDatasourcePlugin,
      notionDatasourcePlugin,
      googleDriveDatasourcePlugin,
    ]
    datasourceQueryMock.auth.data = {
      result: [firecrawlDatasourceAuth, notionDatasourceAuth, googleDriveDatasourceAuth],
    }
    serviceMock.previewInitialSource.mockResolvedValue({
      files: [
        {
          bucket: null,
          id: 'doc-1',
          mime_type: 'application/vnd.google-apps.document',
          name: 'Launch plan',
          provider_item_id: '["","doc-1"]',
          size: 1024,
          type: 'application/vnd.google-apps.document',
        },
      ],
      kind: 'online_drive',
      next_page_parameters: null,
    })
    renderPage()
    await fillRequiredFields(user)
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDocuments' }))
    await user.click(screen.getByRole('radio', { name: 'Google Docs' }))
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder'),
      'Team docs',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.preview' }))

    await waitFor(() =>
      expect(serviceMock.previewInitialSource).toHaveBeenCalledWith({
        body: expect.objectContaining({ kind: 'online_drive' }),
      }),
    )
    await user.click(await screen.findByRole('checkbox', { name: 'Launch plan' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.objectContaining({
        initial_source: expect.objectContaining({
          kind: 'online_drive',
          selection: [expect.objectContaining({ id: 'doc-1' })],
        }),
      }),
    })
  })

  it('preserves root pagination while expanding a drive folder', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    datasourceQueryMock.plugins.data = [firecrawlDatasourcePlugin, googleDriveDatasourcePlugin]
    datasourceQueryMock.auth.data = {
      result: [firecrawlDatasourceAuth, googleDriveDatasourceAuth],
    }
    serviceMock.previewInitialSource.mockImplementation(
      ({ body }: { body: { parameters: Record<string, unknown> } }) => {
        if (body.parameters.prefix === 'folder-1') {
          return Promise.resolve({
            files: [
              {
                bucket: null,
                id: 'child-1',
                mime_type: 'application/pdf',
                name: 'Folder child.pdf',
                provider_item_id: '["","child-1"]',
                size: 128,
                type: 'application/pdf',
              },
            ],
            kind: 'online_drive',
            next_page_parameters: null,
          })
        }
        if (body.parameters.next_page_parameters) {
          return Promise.resolve({
            files: [
              {
                bucket: null,
                id: 'root-2',
                mime_type: 'application/pdf',
                name: 'Second root file.pdf',
                provider_item_id: '["","root-2"]',
                size: 256,
                type: 'application/pdf',
              },
            ],
            kind: 'online_drive',
            next_page_parameters: null,
          })
        }
        return Promise.resolve({
          files: [
            {
              bucket: null,
              id: 'folder-1',
              mime_type: null,
              name: 'Plans',
              provider_item_id: '["","folder-1"]',
              size: 0,
              type: 'folder',
            },
          ],
          kind: 'online_drive',
          next_page_parameters: { cursor: 'root-next' },
        })
      },
    )
    renderPage()
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDrive' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.preview' }))

    const folderButton = await screen.findByRole('button', { name: 'Plans' })
    expect(folderButton).toHaveAttribute('aria-expanded', 'false')
    await user.click(folderButton)
    expect(folderButton).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('checkbox', { name: 'Folder child.pdf' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))

    expect(
      await screen.findByRole('checkbox', { name: 'Second root file.pdf' }),
    ).toBeInTheDocument()
    expect(serviceMock.previewInitialSource).toHaveBeenLastCalledWith({
      body: expect.objectContaining({
        parameters: { next_page_parameters: { cursor: 'root-next' } },
      }),
    })
  })

  it('limits a paginated drive selection to the backend maximum', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    datasourceQueryMock.plugins.data = [firecrawlDatasourcePlugin, googleDriveDatasourcePlugin]
    datasourceQueryMock.auth.data = {
      result: [firecrawlDatasourceAuth, googleDriveDatasourceAuth],
    }
    const files = Array.from({ length: 200 }, (_, index) => ({
      bucket: null,
      id: `file-${index + 1}`,
      mime_type: 'application/pdf',
      name: `File ${index + 1}.pdf`,
      provider_item_id: `["","file-${index + 1}"]`,
      size: 128,
      type: 'application/pdf',
    }))
    serviceMock.previewInitialSource
      .mockResolvedValueOnce({
        files,
        kind: 'online_drive',
        next_page_parameters: { cursor: 'next' },
      })
      .mockResolvedValueOnce({
        files: [
          {
            bucket: null,
            id: 'file-201',
            mime_type: 'application/pdf',
            name: 'File 201.pdf',
            provider_item_id: '["","file-201"]',
            size: 128,
            type: 'application/pdf',
          },
        ],
        kind: 'online_drive',
        next_page_parameters: null,
      })
    renderPage()
    await fillRequiredFields(user)
    await user.click(screen.getByRole('radio', { name: 'dataset.newKnowledge.onlineDrive' }))
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder'),
      'Drive archive',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.preview' }))
    await user.click(await screen.findByRole('button', { name: 'dataset.newKnowledge.loadMore' }))
    await screen.findByRole('checkbox', { name: 'File 201.pdf' })
    await user.click(screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAll' }))

    expect(screen.getByRole('checkbox', { name: 'File 201.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByText(/^dataset\.newKnowledge\.pagesSelected/)).toHaveTextContent('200')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create.mock.calls[0]?.[0].body.initial_source.selection).toHaveLength(200)
  })

  it('requires a selected website preview page before creating with an initial source', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()
    await fillRequiredFields(user)
    const rootUrl = screen.getByPlaceholderText('dataset.newKnowledge.rootUrlPlaceholder')
    const sourceName = screen.getByPlaceholderText('dataset.newKnowledge.sourceNamePlaceholder')
    expect(rootUrl).toHaveAttribute('maxlength', '2048')
    expect(sourceName).toHaveAttribute('maxlength', '200')

    await user.type(rootUrl, 'https://user:secret@docs.dify.ai')
    await user.type(sourceName, 'Dify docs')
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(serviceMock.create).not.toHaveBeenCalled()

    await user.clear(rootUrl)
    await user.type(rootUrl, 'https://docs.dify.ai')
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' })).toBeDisabled()

    const crawlAndPreview = screen.getByRole('button', {
      name: 'dataset.newKnowledge.crawlAndPreview',
    })
    expect(crawlAndPreview).toBeEnabled()
    await user.click(crawlAndPreview)
    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))

    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' })).toBeEnabled()
  })

  it('keeps an invalid upload visible and prevents creating the knowledge space', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    renderPage()
    await fillRequiredFields(user)
    const oversizedFile = new File(['content'], 'oversized.pdf', { type: 'application/pdf' })
    Object.defineProperty(oversizedFile, 'size', { value: 16 * 1024 * 1024 })
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      oversizedFile,
    )

    expect(screen.getByText('oversized.pdf')).toBeInTheDocument()
    expect(
      screen.getByText(/dataset\.newKnowledge\.documentUploadExclusion\.fileSize/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'dataset.newKnowledge.preview' })).toBeNull()
    expect(serviceMock.create).not.toHaveBeenCalled()
  })

  it('rejects empty files locally while staging a one-byte file from a mixed selection', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    vi.mocked(globalThis.crypto.randomUUID)
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    renderPage()
    await fillRequiredFields(user)
    const emptyFile = new File([], 'empty.txt', { type: 'text/plain' })
    const oneByteFile = new File(['x'], 'one-byte.txt', { type: 'text/plain' })

    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      [emptyFile, oneByteFile],
    )

    expect(screen.getByText('empty.txt')).toBeInTheDocument()
    expect(
      screen.getByText(/dataset\.newKnowledge\.selectedFiles:.*"total":2.*"valid":1/),
    ).toBeVisible()
    expect(screen.getByText('dataset.newKnowledge.documentUploadExclusion.fileEmpty')).toBeVisible()
    await waitFor(() =>
      expect(serviceMock.stageUpload).toHaveBeenCalledWith({
        body: { file: expect.objectContaining({ name: 'one-byte.txt', size: 1 }) },
      }),
    )
    expect(serviceMock.stageUpload).toHaveBeenCalledTimes(1)
    const createButton = screen.getByRole('button', {
      name: 'dataset.newKnowledge.createTitle',
    })
    await waitFor(() => expect(createButton).not.toHaveAttribute('data-disabled'))
    await user.click(createButton)

    await waitFor(() =>
      expect(serviceMock.upload).toHaveBeenCalledWith({
        body: { upload_id: 'staged-one-byte.txt' },
        params: { control_space_id: createdKnowledge.control_space_id },
      }),
    )
    expect(serviceMock.upload).toHaveBeenCalledTimes(1)
  })

  it('marks only the file currently being uploaded as pending', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    vi.mocked(globalThis.crypto.randomUUID)
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
      .mockReturnValue('33333333-3333-4333-8333-333333333333')
    serviceMock.upload.mockImplementation(() => new Promise(() => {}))
    renderPage()
    await fillRequiredFields(user)
    fireEvent.change(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      {
        target: {
          files: [
            new File(['content'], 'handbook.md', { type: 'text/markdown' }),
            new File(['content'], 'policy.pdf', { type: 'application/pdf' }),
          ],
        },
      },
    )
    const queue = screen.getByRole('list', { name: 'dataset.newKnowledge.uploadFiles' })
    const handbookRow = within(queue).getByText('handbook.md').closest('li')
    const policyRow = within(queue).getByText('policy.pdf').closest('li')
    expect(handbookRow).not.toBeNull()
    expect(policyRow).not.toBeNull()
    await waitFor(() =>
      expect(
        within(queue).getAllByRole('button', { name: 'dataset.newKnowledge.preview' }),
      ).toHaveLength(2),
    )
    expect(screen.queryByText('dataset.newKnowledge.previewUnavailable')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    expect(
      await within(handbookRow as HTMLElement).findByText('dataset.newKnowledge.uploadingFiles'),
    ).toBeVisible()
    expect(
      within(handbookRow as HTMLElement).queryByRole('button', {
        name: 'dataset.newKnowledge.preview',
      }),
    ).toBeNull()
    expect(
      within(policyRow as HTMLElement).getByText(
        'dataset.newKnowledge.uploadCharactersUnavailable',
      ),
    ).toBeVisible()
    expect(
      within(policyRow as HTMLElement).getByRole('button', {
        name: 'dataset.newKnowledge.preview',
      }),
    ).toBeEnabled()
  })

  it('waits for first-time space provisioning before uploading the selected file', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    let resolveReadiness: (value: Awaited<ReturnType<typeof serviceMock.getSpace>>) => void = () =>
      undefined
    serviceMock.getSpace.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReadiness = resolve
        }),
    )
    renderPage()
    await fillRequiredFields(user)
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(serviceMock.getSpace).toHaveBeenCalledOnce())
    expect(serviceMock.upload).not.toHaveBeenCalled()

    resolveReadiness({
      control_space_id: createdKnowledge.control_space_id,
      created_at: '2026-08-10T09:45:02Z',
      knowledge_space_id: 'knowledge-space-1',
      owner_account_id: 'account-1',
      permission_keys: ['knowledge_space_read'],
      resource_version: 1,
      state: 'active',
      technical_status: 'available',
      technical_summary: null,
      updated_at: '2026-08-10T09:45:38Z',
      visibility: 'all_team_members',
    })

    await waitFor(() => expect(serviceMock.upload).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledOnce()
  })

  it('previews a selected file locally without claiming it', async () => {
    navigationMock.startMode = 'upload'
    const file = new File(['local content'], 'handbook.md', { type: 'text/markdown' })
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:handbook')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL')
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null)
    vi.useFakeTimers()
    renderPage()

    fireEvent.change(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      { target: { files: [file] } },
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole('button', { name: 'dataset.newKnowledge.preview' }))

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect((createObjectUrl.mock.calls[0]?.[0] as Blob).type).toBe('text/plain')
    expect(open).toHaveBeenCalledWith('blob:handbook', '_blank', 'noopener,noreferrer')
    expect(serviceMock.upload).not.toHaveBeenCalled()
    expect(revokeObjectUrl).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60_000)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:handbook')
  })

  it('retries upload without creating a duplicate knowledge space', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    serviceMock.upload.mockRejectedValueOnce(new Error('KnowledgeFS unavailable'))
    renderPage()
    await fillRequiredFields(user)
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentUploadFailed',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled())
    expect(serviceMock.create).toHaveBeenCalledOnce()
    expect(serviceMock.upload).toHaveBeenCalledTimes(2)
  })

  it('renders the approved creation modal and exposes both dismiss actions', async () => {
    const user = userEvent.setup()
    renderPage()

    const dialog = screen.getByRole('dialog', {
      name: 'dataset.newKnowledge.createTitle',
    })
    expect(
      within(dialog).getByRole('heading', { name: 'dataset.newKnowledge.createTitle' }),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('dataset.newKnowledge.namePlaceholder')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('dataset.newKnowledge.descriptionPlaceholder'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: /^dataset\.newKnowledge\.description$/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.descriptionHelp')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.startWithHelp')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }),
    ).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.illustrationHeadline')).toBeInTheDocument()
    expect(document.querySelector('.bg-background-overlay-backdrop')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
    routerMock.replace.mockClear()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
    routerMock.replace.mockClear()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
  })

  it('asks before discarding an unsaved draft', async () => {
    const user = userEvent.setup()
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)
    renderPage()
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' }),
      'Draft knowledge',
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(routerMock.back).not.toHaveBeenCalled()
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'dataset.newKnowledge.discardDraftTitle',
    })
    expect(confirmation).toHaveTextContent('dataset.newKnowledge.discardDraftDescription')
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'dataset.newKnowledge.discardDraftConfirm',
      }),
    )
    expect(historyBack).toHaveBeenCalledOnce()

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))

    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
  })

  it('protects an unsaved draft from browser unload', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' }),
      'Draft knowledge',
    )
    const event = new Event('beforeunload', { cancelable: true })

    act(() => window.dispatchEvent(event))

    expect(event.defaultPrevented).toBe(true)
  })

  it('asks before leaving an unsaved draft with browser Back', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' }),
      'Draft knowledge',
    )

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))

    const confirmation = await screen.findByRole('alertdialog', {
      name: 'dataset.newKnowledge.discardDraftTitle',
    })
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'dataset.newKnowledge.discardDraftConfirm',
      }),
    )

    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
  })

  it('does not warn after a draft is cleared before browser Back', async () => {
    const user = userEvent.setup()
    renderPage()
    const nameInput = screen.getByRole('textbox', { name: 'dataset.newKnowledge.name' })
    await user.type(nameInput, 'Draft knowledge')
    await user.clear(nameInput)

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))

    expect(
      screen.queryByRole('alertdialog', {
        name: 'dataset.newKnowledge.discardDraftTitle',
      }),
    ).not.toBeInTheDocument()
    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
  })

  it('warns before leaving a partially created knowledge space', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    serviceMock.upload.mockRejectedValueOnce(new Error('upload unavailable'))
    renderPage()
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.createTitle' }))
    expect(await screen.findByText('dataset.newKnowledge.documentUploadFailed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(routerMock.back).not.toHaveBeenCalled()
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'dataset.newKnowledge.leavePartialSetupTitle',
    })
    expect(confirmation).toHaveTextContent('dataset.newKnowledge.leavePartialSetupDescription')
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'dataset.newKnowledge.leavePartialSetupConfirm',
      }),
    )
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources',
    )
  })
})

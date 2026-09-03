import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateKnowledgePage } from '../page'

const serviceMock = vi.hoisted(() => ({
  create: vi.fn(),
  createCrawl: vi.fn(),
  createKfsSource: vi.fn(),
  getKfsSource: vi.fn(),
  getCrawlStatus: vi.fn(),
  cancelWebsitePreview: vi.fn(),
  getWebsitePreview: vi.fn(),
  previewInitialSource: vi.fn(),
  startWebsitePreview: vi.fn(),
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

const fileUploadConfigMock = vi.hoisted(() => ({
  knowledgeFileSizeLimit: 15,
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

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: {
      file_size_limit: 15,
      knowledge_file_size_limit: fileUploadConfigMock.knowledgeFileSizeLimit,
    },
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
        jobs: {
          post: serviceMock.startWebsitePreview,
          byJobId: {
            delete: serviceMock.cancelWebsitePreview,
            get: serviceMock.getWebsitePreview,
          },
        },
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

const tavilyDatasourcePlugin = {
  ...firecrawlDatasourcePlugin,
  declaration: {
    ...firecrawlDatasourcePlugin.declaration,
    datasources: [
      {
        description: { en_US: 'Search and extract', zh_Hans: '搜索与提取' },
        identity: {
          author: 'langgenius',
          label: { en_US: 'Tavily', zh_Hans: 'Tavily' },
          name: 'search_extract',
          provider: 'tavily',
        },
        parameters: [
          {
            label: { en_US: 'Search query', zh_Hans: '搜索词' },
            name: 'query',
            required: true,
            type: 'string',
          },
          {
            default: 'basic',
            label: { en_US: 'Search depth', zh_Hans: '搜索深度' },
            name: 'search_depth',
            options: [
              { label: { en_US: 'Basic', zh_Hans: '基础' }, value: 'basic' },
              { label: { en_US: 'Advanced', zh_Hans: '高级' }, value: 'advanced' },
            ],
            type: 'select',
          },
        ],
      },
    ],
    identity: {
      ...firecrawlDatasourcePlugin.declaration.identity,
      label: { en_US: 'Tavily', zh_Hans: 'Tavily' },
      name: 'tavily',
    },
  },
  plugin_id: 'langgenius/tavily_datasource',
  plugin_unique_identifier: 'langgenius/tavily_datasource:1.0.0@local',
  provider: 'tavily',
}

const tavilyDatasourceAuth = {
  ...firecrawlDatasourceAuth,
  credentials_list: [
    {
      ...firecrawlDatasourceAuth.credentials_list[0],
      id: 'tavily-credential-1',
      name: 'Default Tavily',
    },
  ],
  label: { en_US: 'Tavily' },
  name: 'tavily',
  plugin_id: 'langgenius/tavily_datasource',
  plugin_unique_identifier: 'langgenius/tavily_datasource:1.0.0@local',
  provider: 'tavily',
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

const notionDatasourcePluginWithParameters = {
  ...notionDatasourcePlugin,
  declaration: {
    ...notionDatasourcePlugin.declaration,
    datasources: [
      {
        ...notionDatasourcePlugin.declaration.datasources[0],
        parameters: [
          {
            label: { en_US: 'Workspace', zh_Hans: '工作区' },
            name: 'workspace',
            required: true,
            type: 'string',
          },
        ],
      },
    ],
  },
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

const outlineDatasourcePlugin = {
  ...notionDatasourcePlugin,
  declaration: {
    ...notionDatasourcePlugin.declaration,
    datasources: [
      {
        ...notionDatasourcePlugin.declaration.datasources[0]!,
        description: { en_US: 'Outline', zh_Hans: 'Outline' },
        identity: {
          ...notionDatasourcePlugin.declaration.datasources[0]!.identity,
          label: { en_US: 'Outline', zh_Hans: 'Outline' },
          name: 'outline',
          provider: 'outline',
        },
      },
    ],
    identity: {
      ...notionDatasourcePlugin.declaration.identity,
      label: { en_US: 'Outline', zh_Hans: 'Outline' },
      name: 'outline',
    },
  },
  plugin_id: 'langgenius/outline_datasource',
  plugin_unique_identifier: 'langgenius/outline_datasource:1.0.0@local',
  provider: 'outline',
}

const outlineDatasourceAuth = {
  ...notionDatasourceAuth,
  credentials_list: [
    {
      ...notionDatasourceAuth.credentials_list[0],
      id: 'outline-credential-1',
      name: 'Default Outline',
    },
  ],
  label: { en_US: 'Outline' },
  name: 'outline',
  plugin_id: 'langgenius/outline_datasource',
  plugin_unique_identifier: 'langgenius/outline_datasource:1.0.0@local',
  provider: 'outline',
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

vi.mock('../../upload/knowledge-fs-upload', () => ({
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
    screen.getByRole('textbox', { name: 'knowledgeSpace.name' }),
    '  Product handbook  ',
  )
  await user.type(
    screen.getByRole('textbox', { name: /knowledgeSpace\.description/ }),
    '  Internal answers  ',
  )
}

async function choosePermission(user: ReturnType<typeof userEvent.setup>, optionName: string) {
  await user.click(screen.getByRole('combobox', { name: 'knowledgeSpace.permission' }))
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
    serviceMock.startWebsitePreview.mockResolvedValue({ job_id: 'website-preview-1' })
    serviceMock.getWebsitePreview.mockResolvedValue({
      job_id: 'website-preview-1',
      status: 'completed',
      result: {
        kind: 'website_crawl',
        pages: [
          {
            description: 'Getting started',
            source_url: 'https://docs.dify.ai/getting-started',
            title: 'Getting started',
          },
        ],
      },
    })
    serviceMock.cancelWebsitePreview.mockResolvedValue({
      job_id: 'website-preview-1',
      status: 'canceled',
    })
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
      mode: 'interval',
      next_run_at: null,
      revision: 1,
      source_id: 'source-1',
      updated_at: '2026-08-06T10:00:00Z',
    })
    serviceMock.getDefaultModel.mockImplementation(({ query }: { query: { model_type: string } }) =>
      Promise.resolve({
        data: {
          model:
            query.model_type === 'llm'
              ? 'echo'
              : query.model_type === 'rerank'
                ? 'rerank'
                : 'embed',
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
    fileUploadConfigMock.knowledgeFileSizeLimit = 15
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

  it('lets form validation explain a missing knowledge name', async () => {
    const user = userEvent.setup()
    renderPage()

    const createButton = screen.getByRole('button', {
      name: 'knowledgeSpace.createTitle',
    })
    expect(createButton).toBeEnabled()
    await user.click(createButton)

    expect(screen.getByText('knowledgeSpace.nameRequired')).toBeInTheDocument()
    expect(serviceMock.create).not.toHaveBeenCalled()

    await user.type(screen.getByRole('textbox', { name: 'knowledgeSpace.name' }), 'Handbook')
    expect(createButton).toBeEnabled()
  })

  it('accepts a 40-character name and submits the exact value', async () => {
    const user = userEvent.setup()
    const boundaryName = '知'.repeat(40)
    renderPage()

    await user.type(screen.getByRole('textbox', { name: 'knowledgeSpace.name' }), boundaryName)
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.objectContaining({ name: boundaryName }),
    })
  })

  it('keeps a 41-character name visible, identifies the field, and blocks the request', async () => {
    const user = userEvent.setup()
    const invalidName = '知'.repeat(41)
    renderPage()

    const nameInput = screen.getByRole('textbox', { name: 'knowledgeSpace.name' })
    await user.type(nameInput, invalidName)

    expect(nameInput).toHaveValue(invalidName)
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAccessibleDescription('datasetCreation.stepOne.modal.nameLengthInvalid')
    const createButton = screen.getByRole('button', {
      name: 'knowledgeSpace.createTitle',
    })
    expect(createButton).toBeEnabled()
    await user.click(createButton)
    expect(serviceMock.create).not.toHaveBeenCalled()
  })

  it('creates a private empty knowledge space, invalidates the list, and navigates', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderPage(queryClient)
    await fillRequiredFields(user)
    await choosePermission(user, 'knowledgeSpace.permissionOnlyMe')

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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
            rerank: {
              enabled: true,
              model: {
                model: 'rerank',
                plugin_id: 'langgenius/cohere',
                provider: 'cohere',
              },
            },
            score_threshold: { enabled: false, stage: 'rerank' },
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
    expect(screen.getByRole('combobox', { name: 'knowledgeSpace.permission' })).toHaveTextContent(
      'knowledgeSpace.permissionAllMembers',
    )

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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
      name: 'knowledgeSpace.permission',
    })
    expect(permission).toBeEnabled()
    expect(permission).toHaveTextContent('knowledgeSpace.permissionOnlyMe')
    expect(screen.queryByText('knowledgeSpace.permissionRestricted')).not.toBeInTheDocument()

    await choosePermission(user, 'knowledgeSpace.permissionAllMembers')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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
      name: 'knowledgeSpace.permission',
    })
    expect(permission).toBeDisabled()
    expect(permission).toHaveTextContent('knowledgeSpace.permissionOnlyMe')
    expect(permission).toHaveAccessibleDescription('knowledgeSpace.permissionRestricted')
    expect(screen.getByText('knowledgeSpace.permissionRestricted')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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
      name: 'knowledgeSpace.createTitle',
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

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('knowledgeSpace.createFailed')
    expect(screen.getByRole('textbox', { name: 'knowledgeSpace.name' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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
      screen.getByLabelText('knowledgeSpace.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'guide.txt', { type: 'text/plain' }),
    )

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

    expect(
      await screen.findByRole('dialog', {
        name: 'knowledgeSpace.overview.attention.modelReadiness.title',
      }),
    ).toBeInTheDocument()
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

      await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('knowledgeSpace.createFailed')
      const nameInput = screen.getByRole('textbox', { name: 'knowledgeSpace.name' })
      expect(nameInput).toBeEnabled()
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated handbook')
      await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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

      await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('knowledgeSpace.createFailed')
      expect(screen.getByRole('textbox', { name: 'knowledgeSpace.name' })).toBeDisabled()
      expect(screen.getByRole('combobox', { name: 'knowledgeSpace.permission' })).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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
      screen.getByLabelText('knowledgeSpace.uploadFiles', {
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

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'knowledgeSpace.documentUploadFailed',
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['console', 'knowledgeFs', 'listKnowledgeSpaces'],
    })
    const nameInput = screen.getByRole('textbox', { name: 'knowledgeSpace.name' })
    expect(nameInput).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'knowledgeSpace.permission' })).toBeDisabled()
    await user.type(nameInput, ' changed')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('knowledgeSpace.createFailed')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledTimes(2)
    expect(serviceMock.create.mock.calls[0]?.[0].body.idempotency_key).toBe(
      serviceMock.create.mock.calls[1]?.[0].body.idempotency_key,
    )
  })

  it('enables every atomic source type and only lists installed providers', async () => {
    const user = userEvent.setup()
    renderPage()

    const startEmpty = screen.getByRole('radio', { name: 'knowledgeSpace.startEmpty' })
    expect(startEmpty).toBeChecked()
    expect(startEmpty).toHaveAccessibleDescription('knowledgeSpace.startEmptyDescription')
    const connectSource = screen.getByRole('radio', {
      name: 'knowledgeSpace.connectSource',
    })
    const uploadFiles = screen.getByRole('radio', { name: 'knowledgeSpace.uploadFiles' })
    expect(connectSource).toBeEnabled()
    expect(uploadFiles).toBeEnabled()

    await user.click(connectSource)
    expect(connectSource).toBeChecked()
    expect(screen.getByRole('radio', { name: 'knowledgeSpace.websiteCrawl' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'knowledgeSpace.websiteCrawl' })).toBeChecked()
    const onlineDocuments = screen.getByRole('radio', {
      name: 'knowledgeSpace.onlineDocuments',
    })
    expect(onlineDocuments).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDrive' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Firecrawl' })).toBeChecked()
    expect(screen.queryByRole('radio', { name: 'Jina Reader' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'WaterCrawl' })).not.toBeInTheDocument()
    await user.click(onlineDocuments)
    expect(onlineDocuments).toBeChecked()
    expect(screen.queryByRole('radio', { name: 'Notion' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('plugin.list.notFound')
    expect(screen.queryByText('workflow.nodes.common.pluginNotInstalled')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.websiteCrawl' }))
    expect(screen.getByRole('button', { name: 'knowledgeSpace.moreProviders' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.crawlAndPreview' })).toBeDisabled()
    expect(screen.getByText('knowledgeSpace.pagesAppearTitle')).toBeInTheDocument()
    const rootUrl = screen.getByPlaceholderText('knowledgeSpace.rootUrlPlaceholder')
    const sourceName = screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder')
    expect(rootUrl).toBeEnabled()
    expect(sourceName).toBeEnabled()
    await user.type(rootUrl, 'https://docs.dify.ai')
    await user.type(sourceName, 'Dify docs')
    const crawlAndPreview = screen.getByRole('button', {
      name: 'knowledgeSpace.crawlAndPreview',
    })
    expect(crawlAndPreview).toBeEnabled()
    await user.click(crawlAndPreview)
    expect(serviceMock.create).not.toHaveBeenCalled()
    expect(routerMock.replace).not.toHaveBeenCalled()
    expect(await screen.findByText('Getting started')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/^knowledgeSpace\.pagesCrawled/)).toBeInTheDocument()
    expect(screen.getByText(/^knowledgeSpace\.pagesSelected/)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Getting started' }))
    expect(screen.getByText(/^knowledgeSpace\.pagesSelected/)).toHaveTextContent('1')
    await user.click(uploadFiles)
    expect(uploadFiles).toBeChecked()
    const uploadInput = screen.getByLabelText('knowledgeSpace.uploadFiles', {
      selector: 'input[type="file"]',
    })
    expect(uploadInput).toBeInTheDocument()
    expect(uploadInput).not.toHaveAttribute('hidden')
    expect(uploadInput.nextElementSibling).toHaveClass('peer-focus-visible:ring-2')
    uploadInput.focus()
    expect(uploadInput).toHaveFocus()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' })).toBeDisabled()
  })

  it('prompts for provider installation when source setup has no installed integration', async () => {
    const user = userEvent.setup()
    datasourceQueryMock.plugins.data = []
    datasourceQueryMock.auth.data = { result: [] }

    renderPage()

    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.connectSource' }))

    expect(screen.getByRole('status')).toHaveTextContent('plugin.list.notFound')
    expect(screen.queryByRole('radio', { name: 'Firecrawl' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.moreProviders' })).toBeEnabled()
  })

  it('clears a completed crawl when the installed provider changes during setup', async () => {
    const user = userEvent.setup()
    datasourceQueryMock.plugins.data = [firecrawlDatasourcePlugin, jinaDatasourcePlugin]
    datasourceQueryMock.auth.data = { result: [firecrawlDatasourceAuth, jinaDatasourceAuth] }
    const view = renderPage()

    await fillRequiredFields(user)
    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.connectSource' }))
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.rootUrlPlaceholder'),
      'https://docs.dify.ai',
    )
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Dify docs',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.crawlAndPreview' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' })).toBeEnabled(),
    )

    datasourceQueryMock.plugins.data = [jinaDatasourcePlugin]
    datasourceQueryMock.auth.data = { result: [jinaDatasourceAuth] }
    view.rerender(<CreateKnowledgePage />)

    expect(screen.getByRole('radio', { name: 'Jina Reader' })).toBeChecked()
    expect(screen.queryByText('Getting started')).not.toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.pagesAppearTitle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' })).toBeDisabled()
  })

  it('disables upload before creating a space when direct upload is unavailable', () => {
    navigationMock.startMode = 'upload'
    systemFeaturesStateMock.uploadEnabled = false

    renderPage()

    expect(screen.getByRole('radio', { name: 'knowledgeSpace.startEmpty' })).toBeChecked()
    const uploadFiles = screen.getByRole('radio', { name: 'knowledgeSpace.uploadFiles' })
    expect(uploadFiles).toBeDisabled()
    expect(uploadFiles).toHaveAccessibleDescription(
      'knowledgeSpace.uploadFilesDescription dataset.cornerLabel.unavailable',
    )
    expect(serviceMock.create).not.toHaveBeenCalled()
  })

  it('continues from the upload mode after real creation succeeds', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    renderPage()

    expect(screen.getByRole('radio', { name: 'knowledgeSpace.uploadFiles' })).toBeChecked()
    await user.upload(
      screen.getByLabelText('knowledgeSpace.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )
    await fillRequiredFields(user)
    await choosePermission(user, 'knowledgeSpace.permissionOnlyMe')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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
        screen.getByLabelText('knowledgeSpace.uploadFiles', {
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
      screen.getByPlaceholderText('knowledgeSpace.rootUrlPlaceholder'),
      'https://docs.dify.ai',
    )
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Dify docs',
    )
    expect(screen.getByRole('combobox', { name: 'knowledgeSpace.syncPolicy' })).toHaveTextContent(
      'knowledgeSpace.syncPolicyDaily',
    )
    await user.keyboard('{Enter}')
    expect(serviceMock.create).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.crawlOptions' }))
    await user.click(screen.getByRole('checkbox', { name: 'knowledgeSpace.includeSubpages' }))
    const maxPages = screen.getByRole('spinbutton', { name: 'knowledgeSpace.maxPages' })
    await user.clear(maxPages)
    await user.type(maxPages, '25')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.crawlAndPreview' }))

    expect(serviceMock.create).not.toHaveBeenCalled()
    expect(routerMock.replace).not.toHaveBeenCalled()
    expect(serviceMock.startWebsitePreview).toHaveBeenCalledWith({
      body: expect.objectContaining({
        kind: 'website_crawl',
        parameters: expect.objectContaining({
          crawl_subpages: false,
          limit: 25,
          url: 'https://docs.dify.ai',
        }),
      }),
    })
    expect(await screen.findByText('Getting started')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.crawlAndPreview' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'knowledgeSpace.selectAll' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Getting started' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.reCrawl' })).toBeEnabled()
    const syncPolicy = screen.getByRole('combobox', {
      name: 'knowledgeSpace.syncPolicy',
    })
    expect(syncPolicy).toHaveTextContent('knowledgeSpace.syncPolicyDaily')
    await user.click(syncPolicy)
    await user.click(await screen.findByRole('option', { name: 'knowledgeSpace.syncPolicyManual' }))
    expect(syncPolicy).toHaveTextContent('knowledgeSpace.syncPolicyManual')
    expect(screen.getByText('Getting started')).toBeInTheDocument()
  })

  it('lets users edit website parameters after a successful preview', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()
    await fillRequiredFields(user)
    const rootUrl = screen.getByPlaceholderText('knowledgeSpace.rootUrlPlaceholder')
    await user.type(rootUrl, 'https://docs.dify.ai')
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Dify docs',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.crawlAndPreview' }))
    await screen.findByText('Getting started')

    expect(rootUrl).toBeEnabled()
    await user.clear(rootUrl)

    expect(screen.queryByText('Getting started')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.crawlAndPreview' })).toBeDisabled()
  })

  it('creates an initial source from a Jina Reader preview job', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    datasourceQueryMock.plugins.data = [firecrawlDatasourcePlugin, jinaDatasourcePlugin]
    datasourceQueryMock.auth.data = { result: [firecrawlDatasourceAuth, jinaDatasourceAuth] }
    serviceMock.getWebsitePreview.mockResolvedValueOnce({
      job_id: 'website-preview-1',
      status: 'completed',
      result: {
        kind: 'website_crawl',
        pages: [
          {
            description: 'Introduction',
            source_url: 'https://docs.dify.ai/introduction',
            title: 'Dify introduction',
          },
        ],
      },
    })
    renderPage()
    await fillRequiredFields(user)
    await user.click(screen.getByRole('radio', { name: 'Jina Reader' }))
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.rootUrlPlaceholder'),
      'https://docs.dify.ai/introduction',
    )
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Dify introduction',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.crawlAndPreview' }))

    await user.click(await screen.findByRole('checkbox', { name: 'Dify introduction' }))
    expect(serviceMock.getCrawlStatus).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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

  it('previews and persists a declaration-driven website datasource without a root URL', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    datasourceQueryMock.plugins.data = [firecrawlDatasourcePlugin, tavilyDatasourcePlugin]
    datasourceQueryMock.auth.data = { result: [firecrawlDatasourceAuth, tavilyDatasourceAuth] }
    serviceMock.getWebsitePreview.mockResolvedValueOnce({
      job_id: 'website-preview-1',
      status: 'completed',
      result: {
        kind: 'website_crawl',
        pages: [
          {
            description: 'Tavily result',
            source_url: 'https://example.com/result',
            title: 'Tavily result',
          },
        ],
      },
    })
    renderPage()
    await fillRequiredFields(user)
    await user.click(screen.getByRole('radio', { name: 'Tavily' }))
    await user.type(screen.getByRole('textbox', { name: /Search query/ }), 'agentic RAG')
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Tavily research',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.crawlAndPreview' }))

    expect(serviceMock.startWebsitePreview).toHaveBeenCalledWith({
      body: {
        credentialId: 'tavily-credential-1',
        datasource: 'search_extract',
        kind: 'website_crawl',
        parameters: { query: 'agentic RAG', search_depth: 'basic' },
        pluginId: 'langgenius/tavily_datasource',
        provider: 'tavily',
        providerDisplayName: 'Tavily',
      },
    })
    await user.click(await screen.findByRole('checkbox', { name: 'Tavily result' }))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create.mock.calls[0]?.[0].body.initial_source).toEqual(
      expect.objectContaining({
        parameters: { query: 'agentic RAG', search_depth: 'basic' },
        root_url: expect.stringMatching(/^datasource:\/\//),
      }),
    )
  })

  it('shows and can stop an ongoing website crawl', async () => {
    const user = userEvent.setup()
    let resolveCancellation: ((value: { job_id: string; status: 'canceled' }) => void) | undefined
    serviceMock.cancelWebsitePreview.mockReturnValue(
      new Promise((resolve) => {
        resolveCancellation = resolve
      }),
    )
    navigationMock.startMode = 'source'
    serviceMock.getWebsitePreview.mockResolvedValue({
      job_id: 'website-preview-1',
      status: 'running',
    })
    renderPage()
    await fillRequiredFields(user)
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.rootUrlPlaceholder'),
      'https://docs.dify.ai',
    )
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Dify docs',
    )

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.crawlAndPreview' }))

    expect(await screen.findByRole('status')).toHaveTextContent('knowledgeSpace.crawlingPages')
    const stopButton = screen.getByRole('button', { name: 'knowledgeSpace.stopCrawl' })
    expect(stopButton).toBeEnabled()

    await user.click(stopButton)
    expect(serviceMock.cancelWebsitePreview).toHaveBeenCalledWith({
      params: { job_id: 'website-preview-1' },
    })
    expect(screen.getByRole('status')).toHaveTextContent('knowledgeSpace.crawlingPages')

    resolveCancellation?.({ job_id: 'website-preview-1', status: 'canceled' })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('knowledgeSpace.crawlStopped'),
    )
  })

  it('keeps the preview job available when stopping fails so cancellation can be retried', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    serviceMock.getWebsitePreview.mockResolvedValue({
      job_id: 'website-preview-1',
      status: 'running',
    })
    serviceMock.cancelWebsitePreview
      .mockRejectedValueOnce(new Error('cancel response lost'))
      .mockResolvedValueOnce({
        job_id: 'website-preview-1',
        status: 'canceled',
      })
    renderPage()
    await fillRequiredFields(user)
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.rootUrlPlaceholder'),
      'https://docs.dify.ai',
    )
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Dify docs',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.crawlAndPreview' }))

    const stopButton = await screen.findByRole('button', {
      name: 'knowledgeSpace.stopCrawl',
    })
    await user.click(stopButton)
    await waitFor(() => expect(stopButton).toBeEnabled())

    await user.click(stopButton)

    await waitFor(() => expect(serviceMock.cancelWebsitePreview).toHaveBeenCalledTimes(2))
    expect(serviceMock.cancelWebsitePreview).toHaveBeenNthCalledWith(2, {
      params: { job_id: 'website-preview-1' },
    })
    expect(screen.getByRole('status')).toHaveTextContent('knowledgeSpace.crawlStopped')
  })

  it('submits selected preview URLs for the server-side crawl import', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()
    await fillRequiredFields(user)
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.rootUrlPlaceholder'),
      'https://docs.dify.ai',
    )
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Dify docs',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.crawlAndPreview' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))
    await waitFor(() =>
      expect(screen.getByText(/^knowledgeSpace\.pagesSelected/)).toHaveTextContent('1'),
    )

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(
        '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources?awaitInitialSource=operation-1',
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
          parameters: {
            crawl_subpages: true,
            limit: 100,
            url: 'https://docs.dify.ai',
          },
          pluginId: 'langgenius/firecrawl_datasource',
          previewJobId: 'website-preview-1',
          provider: 'firecrawl',
          providerDisplayName: 'Firecrawl',
          root_url: 'https://docs.dify.ai/',
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

    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDocuments' }))

    expect(
      screen.getByText('knowledgeSpace.providerNotConfigured:{"provider":"Notion"}'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'knowledgeSpace.connectProvider:{"provider":"Notion"}',
      }),
    ).toBeEnabled()
    expect(screen.queryByText('workflow.nodes.common.pluginNotInstalled')).not.toBeInTheDocument()
  })

  it('creates a knowledge space with selected online documents after renaming the source', async () => {
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
    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDocuments' }))
    const sourceName = screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder')
    await user.type(sourceName, 'Notion handbook')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Product handbook' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' })).toBeEnabled(),
    )
    await user.clear(sourceName)
    await user.type(sourceName, 'Renamed handbook')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' })).toBeEnabled(),
    )

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.objectContaining({
        initial_source: {
          credentialId: 'notion-credential-1',
          datasource: 'notion',
          kind: 'online_document',
          name: 'Renamed handbook',
          parameters: {},
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
          sync_policy: 'daily',
        },
      }),
    })
  })

  it('does not inject website defaults when switching connected document providers', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    datasourceQueryMock.plugins.data = [
      firecrawlDatasourcePlugin,
      notionDatasourcePlugin,
      outlineDatasourcePlugin,
    ]
    datasourceQueryMock.auth.data = {
      result: [firecrawlDatasourceAuth, notionDatasourceAuth, outlineDatasourceAuth],
    }
    serviceMock.previewInitialSource.mockResolvedValue({
      documents: [],
      files: [],
      kind: 'online_document',
      next_page_parameters: null,
    })
    renderPage()
    await fillRequiredFields(user)
    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDocuments' }))
    await user.click(screen.getByRole('radio', { name: 'Outline' }))
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Outline handbook',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))

    await waitFor(() => expect(serviceMock.previewInitialSource).toHaveBeenCalledOnce())
    expect(serviceMock.previewInitialSource).toHaveBeenCalledWith({
      body: expect.objectContaining({
        datasource: 'outline',
        parameters: {},
        pluginId: 'langgenius/outline_datasource',
        provider: 'outline',
      }),
    })
  })

  it('resets a connected-source preview when datasource parameters change', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    datasourceQueryMock.plugins.data = [
      firecrawlDatasourcePlugin,
      notionDatasourcePluginWithParameters,
    ]
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
    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDocuments' }))
    await user.type(screen.getByRole('textbox', { name: 'Workspace' }), 'Product')
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Notion handbook',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))
    await screen.findByRole('checkbox', { name: 'Product handbook' })

    const workspace = screen.getByRole('textbox', { name: 'Workspace' })
    expect(workspace).toBeEnabled()
    await user.clear(workspace)

    expect(screen.queryByRole('checkbox', { name: 'Product handbook' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.preview' })).toBeDisabled()
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
    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDrive' }))
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Drive runbook',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Runbook.pdf' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' })).toBeEnabled(),
    )

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith({
      body: expect.objectContaining({
        initial_source: {
          credentialId: 'google-drive-credential-1',
          datasource: 'google_drive',
          kind: 'online_drive',
          name: 'Drive runbook',
          parameters: {},
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
          sync_policy: 'daily',
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
    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDocuments' }))
    await user.click(screen.getByRole('radio', { name: 'Google Docs' }))
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Team docs',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))

    await waitFor(() =>
      expect(serviceMock.previewInitialSource).toHaveBeenCalledWith({
        body: expect.objectContaining({ kind: 'online_drive' }),
      }),
    )
    await user.click(await screen.findByRole('checkbox', { name: 'Launch plan' }))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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
    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDrive' }))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))

    const folderButton = await screen.findByRole('button', { name: 'Plans' })
    expect(folderButton).toHaveAttribute('aria-expanded', 'false')
    await user.click(folderButton)
    expect(folderButton).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('checkbox', { name: 'Folder child.pdf' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.loadMore' }))

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
    await user.click(screen.getByRole('radio', { name: 'knowledgeSpace.onlineDrive' }))
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder'),
      'Drive archive',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))
    await user.click(await screen.findByRole('button', { name: 'knowledgeSpace.loadMore' }))
    await screen.findByRole('checkbox', { name: 'File 201.pdf' })
    await user.click(screen.getByRole('checkbox', { name: 'knowledgeSpace.selectAll' }))

    expect(screen.getByRole('checkbox', { name: 'File 201.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByText(/^knowledgeSpace\.pagesSelected/)).toHaveTextContent('200')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create.mock.calls[0]?.[0].body.initial_source.selection).toHaveLength(200)
  })

  it('requires a selected website preview page before creating with an initial source', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'source'
    renderPage()
    await fillRequiredFields(user)
    const rootUrl = screen.getByPlaceholderText('knowledgeSpace.rootUrlPlaceholder')
    const sourceName = screen.getByPlaceholderText('knowledgeSpace.sourceNamePlaceholder')
    expect(rootUrl).toHaveAttribute('maxlength', '2048')
    expect(sourceName).toHaveAttribute('maxlength', '200')

    await user.type(rootUrl, 'https://user:secret@docs.dify.ai')
    await user.type(sourceName, 'Dify docs')
    expect(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))
    expect(serviceMock.create).not.toHaveBeenCalled()

    await user.clear(rootUrl)
    await user.type(rootUrl, 'https://docs.dify.ai')
    expect(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' })).toBeDisabled()

    const crawlAndPreview = screen.getByRole('button', {
      name: 'knowledgeSpace.crawlAndPreview',
    })
    expect(crawlAndPreview).toBeEnabled()
    await user.click(crawlAndPreview)
    await user.click(await screen.findByRole('checkbox', { name: 'Getting started' }))

    expect(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' })).toBeEnabled()
  })

  it('keeps an invalid upload visible and prevents creating the knowledge space', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    renderPage()
    await fillRequiredFields(user)
    const oversizedFile = new File(['content'], 'oversized.pdf', { type: 'application/pdf' })
    Object.defineProperty(oversizedFile, 'size', { value: 16 * 1024 * 1024 })
    await user.upload(
      screen.getByLabelText('knowledgeSpace.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      oversizedFile,
    )

    expect(screen.getByText('oversized.pdf')).toBeInTheDocument()
    expect(
      screen.getByText(/knowledgeSpace\.documentUploadExclusion\.fileSize/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'knowledgeSpace.preview' })).toBeNull()
    expect(serviceMock.create).not.toHaveBeenCalled()
  })

  it('uses the workspace knowledge file size limit for upload validation and guidance', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    fileUploadConfigMock.knowledgeFileSizeLimit = 50
    renderPage()
    await fillRequiredFields(user)
    const file = new File(['content'], 'handbook.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 })

    expect(screen.getByText(/knowledgeSpace\.documentUploadFormats:.*"size":50/)).toBeVisible()
    await user.upload(
      screen.getByLabelText('knowledgeSpace.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      file,
    )

    await waitFor(() =>
      expect(serviceMock.stageUpload).toHaveBeenCalledWith({
        body: { file: expect.objectContaining({ name: 'handbook.pdf' }) },
      }),
    )
    expect(
      screen.queryByText(/knowledgeSpace\.documentUploadExclusion\.fileSize/),
    ).not.toBeInTheDocument()
  })

  it('rejects an empty upload before staging or creating the knowledge space', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    renderPage()
    await fillRequiredFields(user)
    const emptyFile = new File([], 'empty.txt', { type: 'text/plain' })

    await user.upload(
      screen.getByLabelText('knowledgeSpace.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      emptyFile,
    )

    expect(screen.getByText('empty.txt')).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.documentUploadExclusion.fileEmpty')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' })).toBeDisabled()
    expect(serviceMock.stageUpload).not.toHaveBeenCalled()
    expect(serviceMock.upload).not.toHaveBeenCalled()
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
      screen.getByLabelText('knowledgeSpace.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      [emptyFile, oneByteFile],
    )

    expect(screen.getByText('empty.txt')).toBeInTheDocument()
    expect(screen.getByText(/knowledgeSpace\.selectedFiles:.*"total":2.*"valid":1/)).toBeVisible()
    expect(screen.getByText('knowledgeSpace.documentUploadExclusion.fileEmpty')).toBeVisible()
    await waitFor(() =>
      expect(serviceMock.stageUpload).toHaveBeenCalledWith({
        body: { file: expect.objectContaining({ name: 'one-byte.txt', size: 1 }) },
      }),
    )
    expect(serviceMock.stageUpload).toHaveBeenCalledTimes(1)
    const createButton = screen.getByRole('button', {
      name: 'knowledgeSpace.createTitle',
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
      screen.getByLabelText('knowledgeSpace.uploadFiles', {
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
    const queue = screen.getByRole('list', { name: 'knowledgeSpace.uploadFiles' })
    const handbookRow = within(queue).getByText('handbook.md').closest('li')
    const policyRow = within(queue).getByText('policy.pdf').closest('li')
    expect(handbookRow).not.toBeNull()
    expect(policyRow).not.toBeNull()
    await waitFor(() =>
      expect(within(queue).getAllByRole('button', { name: 'knowledgeSpace.preview' })).toHaveLength(
        2,
      ),
    )
    expect(screen.queryByText('knowledgeSpace.previewUnavailable')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

    expect(
      await within(handbookRow as HTMLElement).findByText('knowledgeSpace.uploadingFiles'),
    ).toBeVisible()
    expect(
      within(handbookRow as HTMLElement).queryByRole('button', {
        name: 'knowledgeSpace.preview',
      }),
    ).toBeNull()
    expect(
      within(policyRow as HTMLElement).getByText('knowledgeSpace.uploadCharactersUnavailable'),
    ).toBeVisible()
    expect(
      within(policyRow as HTMLElement).getByRole('button', {
        name: 'knowledgeSpace.preview',
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
      screen.getByLabelText('knowledgeSpace.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

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
    const file = new File(['# 让状态可分析'], 'handbook.md', { type: 'text/markdown' })
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null)
    renderPage()

    fireEvent.change(
      screen.getByLabelText('knowledgeSpace.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      { target: { files: [file] } },
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole('button', { name: 'knowledgeSpace.preview' }))

    const preview = await screen.findByRole('dialog', { name: 'handbook.md' })
    expect(within(preview).getByLabelText('handbook.md')).toHaveTextContent('# 让状态可分析')
    expect(open).not.toHaveBeenCalled()
    expect(serviceMock.upload).not.toHaveBeenCalled()
  })

  it('retries upload without creating a duplicate knowledge space', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    serviceMock.upload.mockRejectedValueOnce(new Error('KnowledgeFS unavailable'))
    renderPage()
    await fillRequiredFields(user)
    await user.upload(
      screen.getByLabelText('knowledgeSpace.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'knowledgeSpace.documentUploadFailed',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled())
    expect(serviceMock.create).toHaveBeenCalledOnce()
    expect(serviceMock.upload).toHaveBeenCalledTimes(2)
  })

  it('renders the approved creation modal and exposes both dismiss actions', async () => {
    const user = userEvent.setup()
    renderPage()

    const dialog = screen.getByRole('dialog', {
      name: 'knowledgeSpace.createTitle',
    })
    expect(
      within(dialog).getByRole('heading', { name: 'knowledgeSpace.createTitle' }),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('knowledgeSpace.namePlaceholder')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('knowledgeSpace.descriptionPlaceholder')).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: /^knowledgeSpace\.description$/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.descriptionHelp')).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.startWithHelp')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' })).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.illustrationHeadline')).toBeInTheDocument()
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

  it('closes an unsaved draft without confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByRole('textbox', { name: 'knowledgeSpace.name' }), 'Draft knowledge')

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('does not protect an unsaved draft from browser unload', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByRole('textbox', { name: 'knowledgeSpace.name' }), 'Draft knowledge')
    const event = new Event('beforeunload', { cancelable: true })

    act(() => window.dispatchEvent(event))

    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves a partially created knowledge space without confirmation', async () => {
    const user = userEvent.setup()
    navigationMock.startMode = 'upload'
    serviceMock.upload.mockRejectedValueOnce(new Error('upload unavailable'))
    renderPage()
    await user.upload(
      screen.getByLabelText('knowledgeSpace.uploadFiles', {
        selector: 'input[type="file"]',
      }),
      new File(['content'], 'handbook.md', { type: 'text/markdown' }),
    )
    await fillRequiredFields(user)

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.createTitle' }))
    expect(await screen.findByText('knowledgeSpace.documentUploadFailed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(routerMock.replace).toHaveBeenCalledWith(
      '/datasets/new/e735c1dc-d2b8-4dc4-86dc-abaf2fb7d084/sources',
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

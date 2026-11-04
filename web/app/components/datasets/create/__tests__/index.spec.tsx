import type {
  DatasetAndDocumentResponse,
  DatasetDetailWithPartialMembersResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DatasetDetailContext from '@/context/dataset-detail'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import DatasetUpdateForm from '../index'

const api = vi.hoisted(() => ({
  replace: vi.fn(),
  crawl: vi.fn<typeof import('@/service/datasets').createFirecrawlTask>(),
  crawlStatus: vi.fn<typeof import('@/service/datasets').checkFirecrawlTaskStatus>(),
  upload: vi.fn<typeof import('@/service/base').upload>(),
  sources:
    vi.fn<
      typeof import('@/service/console').consoleClient.auth.plugin.datasource.defaultList.get
    >(),
  create: vi.fn<typeof import('@/service/console').consoleClient.datasets.init.post>(),
  add: vi.fn<
    typeof import('@/service/console').consoleClient.datasets.byDatasetId.documents.post
  >(),
  status: vi.fn<typeof import('@/service/datasets').fetchIndexingStatusBatch>(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ replace: api.replace, push: vi.fn() }),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  upload: api.upload,
}))
vi.mock('@/service/datasets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/datasets')>()),
  fetchIndexingStatusBatch: api.status,
  createFirecrawlTask: api.crawl,
  checkFirecrawlTaskStatus: api.crawlStatus,
}))
vi.mock('@tanstack/react-virtual')
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_WEBSITE_FIRECRAWL: true,
  ENABLE_WEBSITE_JINAREADER: false,
  ENABLE_WEBSITE_WATERCRAWL: false,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const { createFileUploadConfigFixture } = await import('@/test/fixtures/file-upload-config')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'auth.plugin.datasource.defaultList.get': api.sources,
      'notion.preImport.pages.get': async () => ({
        notion_info: [
          {
            workspace_id: 'notion-workspace',
            workspace_name: 'Team notes',
            workspace_icon: null,
            pages: [
              {
                page_id: 'page-1',
                page_name: 'Engineering notes',
                page_icon: null,
                parent_id: null,
                type: 'page',
                is_bound: false,
              },
            ],
          },
        ],
      }),
      'files.upload.get': async () => createFileUploadConfigFixture(),
      'workspaces.current.rbac.myPermissions.get': () => new Promise(() => {}),
      'files.supportType.get': async () => ({ allowed_extensions: ['txt'] }),
      'datasets.processRule.get': async () => ({
        mode: 'custom',
        rules: {
          segmentation: { separator: '\\n', max_tokens: 500, chunk_overlap: 50 },
          pre_processing_rules: [{ id: 'remove_extra_spaces', enabled: true }],
        },
        limits: { indexing_max_segmentation_tokens_length: 4000 },
      }),
      'datasets.indexingEstimate.post': async () => ({
        total_segments: 1,
        tokens: 10,
        total_price: 0,
        currency: 'USD',
        preview: [{ content: 'Source content', child_chunks: [] }],
        qa_preview: [],
      }),
      'datasets.init.post': api.create,
      'datasets.byDatasetId.documents.post': api.add,
    }),
  }
})

const creation: DatasetAndDocumentResponse = {
  batch: 'batch-1',
  dataset: { id: 'new-dataset', name: 'Team handbook', indexing_technique: 'high_quality' },
  documents: [
    {
      id: 'doc-1',
      name: 'handbook.txt',
      data_source_type: 'upload_file',
      data_source_detail_dict: {},
    },
  ],
}

function setup({
  dataset,
  hasEmbeddingModel = true,
  pendingPermissions = false,
}: {
  dataset?: DatasetDetailWithPartialMembersResponse
  hasEmbeddingModel?: boolean
  pendingPermissions?: boolean
} = {}) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({
          model: 'text-embedding-ada-002',
          model_type: 'text-embedding',
        }),
      ],
    }),
  ])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: 'text-embedding' } },
    }),
    {
      data: hasEmbeddingModel
        ? createDefaultModelFixture({
            model: 'text-embedding-ada-002',
            model_type: 'text-embedding',
          })
        : null,
    },
  )
  queryClient.setQueryData(consoleQuery.datasets.retrievalSetting.get.queryKey(), {
    retrieval_method: ['semantic_search', 'full_text_search', 'hybrid_search'],
  })
  const { wrapper: UrlProvider, onUrlUpdate } = createNuqsTestWrapper({ hasMemory: true })
  const view = renderWithConsoleQuery(
    <UrlProvider>
      {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector contexts require their Provider rather than React 19 context rendering. */}
      <DatasetDetailContext.Provider value={{ dataset }}>
        <DatasetUpdateForm datasetId={dataset?.id} />
      </DatasetDetailContext.Provider>
    </UrlProvider>,
    {
      queryClient,
      accountProfile: { id: 'user-1' },
      workspacePermissionKeys: pendingPermissions ? null : [],
      features: { billing: { subscription: { plan: 'sandbox' } } },
    },
  )
  return { ...view, onUrlUpdate, user: userEvent.setup() }
}

beforeEach(() => {
  api.replace.mockReset()
  api.crawl.mockReset().mockResolvedValue({ job_id: 'crawl-job' })
  api.crawlStatus.mockReset().mockResolvedValue({
    status: 'completed',
    total: 1,
    data: [
      {
        title: 'Web handbook',
        markdown: 'Source content',
        description: 'Handbook',
        source_url: 'https://example.com/handbook',
      },
    ],
  })
  api.sources.mockReset().mockResolvedValue({ result: [] })
  api.upload
    .mockReset()
    .mockResolvedValue({ id: 'uploaded-file', name: 'handbook.txt', extension: 'txt' })
  api.create.mockReset().mockResolvedValue(creation)
  api.add.mockReset().mockResolvedValue(creation)
  api.status.mockReset().mockResolvedValue({
    data: [
      {
        id: 'doc-1',
        indexing_status: 'completed',
        completed_segments: 1,
        total_segments: 1,
        processing_started_at: null,
        parsing_completed_at: null,
        cleaning_completed_at: null,
        splitting_completed_at: null,
        completed_at: null,
        paused_at: null,
        error: null,
        stopped_at: null,
      },
    ],
  })
})

async function uploadFile(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByLabelText('datasetCreation.stepOne.uploader.browse')
  await user.upload(input, new File(['Source content'], 'handbook.txt', { type: 'text/plain' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'datasetCreation.stepOne.button' })).toBeEnabled(),
  )
}
async function openConfiguration(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepOne.button' }))
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'datasetCreation.stepTwo.maxLength' })).toHaveValue(
      '500',
    ),
  )
}

it('keeps uploaded files when returning to the source step, then carries the creation result into indexing', async () => {
  const pending = createDeferred<DatasetAndDocumentResponse>()
  api.create.mockReturnValue(pending.promise)
  const { user } = setup()
  await uploadFile(user)
  const uploaded = api.upload.mock.calls[0]?.[0].data
  expect(uploaded?.get('file')).toBeInstanceOf(File)
  await openConfiguration(user)
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.previousStep' }))
  expect(
    screen.getByRole('button', { name: 'datasetCreation.stepOne.filePreview handbook.txt' }),
  ).toBeInTheDocument()
  expect(api.upload).toHaveBeenCalledTimes(1)
  await openConfiguration(user)
  const submit = screen.getByRole('button', { name: 'datasetCreation.stepTwo.nextStep' })
  await user.click(submit)
  expect(api.create).toHaveBeenCalledExactlyOnceWith({
    body: expect.objectContaining({
      data_source: {
        type: 'upload_file',
        info_list: {
          data_source_type: 'upload_file',
          file_info_list: { file_ids: ['uploaded-file'] },
        },
      },
      indexing_technique: 'high_quality',
      embedding_model: 'text-embedding-ada-002',
    }),
  })
  expect(
    screen.queryByRole('heading', { name: 'datasetCreation.stepThree.creationTitle' }),
  ).not.toBeInTheDocument()
  await act(async () => pending.resolve(creation))
  expect(
    await screen.findByRole('heading', { name: 'datasetCreation.stepThree.creationTitle' }),
  ).toBeInTheDocument()
  expect(screen.getByText('Team handbook')).toBeInTheDocument()
  expect(api.status).toHaveBeenCalledWith({ datasetId: 'new-dataset', batchId: 'batch-1' })
  expect(await screen.findByText('datasetDocuments.embedding.completed')).toHaveAttribute(
    'role',
    'status',
  )
  expect(screen.getByRole('link', { name: 'datasetCreation.stepThree.navTo' })).toHaveAttribute(
    'href',
    '/datasets/new-dataset/documents',
  )
})

it('keeps a failed creation on the configuration step so the same uploaded source can be retried', async () => {
  api.create.mockRejectedValueOnce(new Error('Creation failed'))
  const { user } = setup()
  await uploadFile(user)
  await openConfiguration(user)
  const submit = screen.getByRole('button', { name: 'datasetCreation.stepTwo.nextStep' })
  await user.click(submit)
  await waitFor(() => expect(submit).toBeEnabled())
  expect(screen.getByRole('textbox', { name: 'datasetCreation.stepTwo.maxLength' })).toHaveValue(
    '500',
  )
  await user.click(submit)
  expect(
    await screen.findByRole('heading', { name: 'datasetCreation.stepThree.creationTitle' }),
  ).toBeInTheDocument()
  expect(api.create).toHaveBeenCalledTimes(2)
  expect(api.create.mock.calls[1]).toEqual(api.create.mock.calls[0])
  expect(api.upload).toHaveBeenCalledTimes(1)
})

it('uses economical indexing when no default embedding model is configured', async () => {
  const { user } = setup({ hasEmbeddingModel: false })
  await uploadFile(user)
  await openConfiguration(user)
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.nextStep' }))
  expect(api.create).toHaveBeenCalledWith({
    body: expect.objectContaining({ indexing_technique: 'economy' }),
  })
  expect(
    await screen.findByRole('heading', { name: 'datasetCreation.stepThree.creationTitle' }),
  ).toBeInTheDocument()
})

it('adds documents using the existing dataset permission and identity', async () => {
  const dataset = createDatasetFixture({
    id: 'existing-dataset',
    name: 'Existing handbook',
    permission_keys: ['dataset.acl.use'],
  })
  const { user } = setup({ dataset })
  await uploadFile(user)
  await openConfiguration(user)
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.nextStep' }))
  expect(api.add).toHaveBeenCalledWith({
    params: { dataset_id: 'existing-dataset' },
    body: expect.objectContaining({ indexing_technique: 'high_quality' }),
  })
  expect(api.create).not.toHaveBeenCalled()
  expect(
    await screen.findByRole('heading', { name: 'datasetCreation.stepThree.additionTitle' }),
  ).toBeInTheDocument()
  expect(api.status).toHaveBeenCalledWith({ datasetId: 'existing-dataset', batchId: 'batch-1' })
})

it('waits for permissions before redirecting a user who cannot add documents', async () => {
  const dataset = createDatasetFixture({ id: 'restricted-dataset', permission_keys: [] })
  const { queryClient } = setup({ dataset, pendingPermissions: true })
  expect(api.replace).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('datasetCreation.stepOne.uploader.browse')).not.toBeInTheDocument()
  const { seedWorkspacePermissionsQuery } = await import('@/test/console/workspace-permissions')
  act(() => seedWorkspacePermissionsQuery(queryClient, []))
  await waitFor(() =>
    expect(api.replace).toHaveBeenCalledWith('/datasets/restricted-dataset/documents'),
  )
  expect(screen.queryByLabelText('datasetCreation.stepOne.uploader.browse')).not.toBeInTheDocument()
})

it('opens datasource settings from the real Notion connection action', async () => {
  const { user, onUrlUpdate } = setup()
  await user.click(
    await screen.findByRole('radio', { name: 'datasetCreation.stepOne.dataSourceType.notion' }),
  )
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepOne.connect' }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('data-source'),
  )
})

it('shows the source step after datasource authorization finishes loading', async () => {
  const pending = createDeferred<Awaited<ReturnType<typeof api.sources>>>()
  api.sources.mockReturnValue(pending.promise)
  setup()
  expect(screen.queryByLabelText('datasetCreation.stepOne.uploader.browse')).not.toBeInTheDocument()
  await act(async () => pending.resolve({ result: [] }))
  expect(
    await screen.findByLabelText('datasetCreation.stepOne.uploader.browse'),
  ).toBeInTheDocument()
})

it('replaces the creation form with the unavailable message when datasource loading fails', async () => {
  api.sources.mockRejectedValue(new Error('Datasource service unavailable'))
  setup()
  expect(await screen.findByText('datasetCreation.error.unavailable')).toBeInTheDocument()
  expect(screen.queryByLabelText('datasetCreation.stepOne.uploader.browse')).not.toBeInTheDocument()
})

function source(provider: string): Awaited<ReturnType<typeof api.sources>>['result'][number] {
  return {
    author: 'Dify',
    name: provider,
    provider,
    plugin_id: 'source-plugin',
    plugin_unique_identifier: 'source-plugin:1',
    label: { en_US: provider },
    description: { en_US: provider },
    icon: '',
    credential_schema: [],
    oauth_schema: null,
    credentials_list: [
      {
        id: 'credential-1',
        name: 'Team account',
        type: provider === 'notion_datasource' ? 'oauth2' : 'api-key',
        credential: {},
        is_default: true,
        avatar_url: null,
      },
    ],
  }
}

it('preserves the selected Notion page and credential across steps and submits them together', async () => {
  api.sources.mockResolvedValue({ result: [source('notion_datasource')] })
  const { user } = setup()
  await user.click(
    await screen.findByRole('radio', { name: 'datasetCreation.stepOne.dataSourceType.notion' }),
  )
  await user.click(await screen.findByRole('checkbox', { name: 'Engineering notes' }))
  await openConfiguration(user)
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.previousStep' }))
  expect(await screen.findByRole('checkbox', { name: 'Engineering notes' })).toBeChecked()
  await openConfiguration(user)
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.nextStep' }))
  expect(api.create).toHaveBeenCalledWith({
    body: expect.objectContaining({
      data_source: {
        type: 'notion_import',
        info_list: {
          data_source_type: 'notion_import',
          notion_info_list: [
            {
              workspace_id: 'notion-workspace',
              credential_id: 'credential-1',
              pages: [
                expect.objectContaining({ page_id: 'page-1', page_name: 'Engineering notes' }),
              ],
            },
          ],
        },
      },
    }),
  })
  expect(
    await screen.findByRole('heading', { name: 'datasetCreation.stepThree.creationTitle' }),
  ).toBeInTheDocument()
})

it('carries the selected crawl provider, job, pages and edited options into document creation', async () => {
  api.sources.mockResolvedValue({ result: [source('firecrawl')] })
  const { user } = setup()
  await user.click(
    await screen.findByRole('radio', { name: 'datasetCreation.stepOne.dataSourceType.web' }),
  )
  await user.click(screen.getByRole('radio', { name: /Firecrawl/ }))
  await user.type(screen.getByPlaceholderText(/^https:\/\//), 'https://example.com/handbook')
  const limit = screen.getByDisplayValue('10')
  await user.clear(limit)
  await user.type(limit, '20')
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepOne.website.run' }))
  expect(await screen.findByText('Web handbook')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepOne.website.preview' }))
  expect(screen.getByText('datasetCreation.stepOne.pagePreview')).toBeInTheDocument()
  expect(screen.getByText('Source content')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(screen.queryByText('datasetCreation.stepOne.pagePreview')).not.toBeInTheDocument()
  expect(api.crawl).toHaveBeenCalledWith({
    url: 'https://example.com/handbook',
    options: expect.objectContaining({ limit: 20 }),
  })
  await openConfiguration(user)
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.previousStep' }))
  await user.click(screen.getByRole('radio', { name: /Firecrawl/ }))
  expect(screen.getByDisplayValue('20')).toBeInTheDocument()
  await openConfiguration(user)
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepTwo.nextStep' }))
  expect(api.create).toHaveBeenCalledWith({
    body: expect.objectContaining({
      data_source: {
        type: 'website_crawl',
        info_list: {
          data_source_type: 'website_crawl',
          website_info_list: expect.objectContaining({
            provider: 'firecrawl',
            job_id: 'crawl-job',
            urls: ['https://example.com/handbook'],
            only_main_content: true,
          }),
        },
      },
    }),
  })
  expect(
    await screen.findByRole('heading', { name: 'datasetCreation.stepThree.creationTitle' }),
  ).toBeInTheDocument()
})

import type { FileResponse } from '@dify/contracts/api/console/files/types.gen'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
// oxlint-disable-next-line no-restricted-imports -- Test the existing datasource SSE and upload transport boundaries without replacing their consumers.
import type { ssePost, upload } from '@/service/base'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createDataSourceStore } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { DataSourceContext } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store/provider'
import { createRagPipelineSliceSlice } from '@/app/components/rag-pipeline/store'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import DatasetDetailContext from '@/context/dataset-detail'
import { DatasourceType, PipelineInputVarType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createPipelineVariable } from '@/test/pipeline-variables'
import Preparation from '../index'

const api = vi.hoisted(() => ({ stream: vi.fn<typeof ssePost>(), upload: vi.fn<typeof upload>() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost: api.stream,
  upload: api.upload,
}))
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))
// Virtualizer measurement is supplied by the browser in production.
vi.mock('@tanstack/react-virtual')

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.draft.processing.parameters.get': async () => ({
        variables: [
          createPipelineVariable({
            variable: 'limit',
            label: 'Limit',
            type: PipelineInputVarType.number,
            default_value: 5,
          }),
        ],
      }),
      'rag.pipelines.byPipelineId.workflows.draft.preProcessing.parameters.get': async () => ({
        variables: [
          createPipelineVariable({
            variable: 'url',
            label: 'URL',
            default_value: 'https://example.com',
          }),
        ],
      }),
    }),
  }
})

const sources = [
  { id: 'local', title: 'Local File', type: DatasourceType.localFile },
  { id: 'document', title: 'Online Document', type: DatasourceType.onlineDocument },
  { id: 'website', title: 'Website', type: DatasourceType.websiteCrawl },
  { id: 'drive', title: 'Online Drive', type: DatasourceType.onlineDrive },
]
const nodes = sources.map((source) =>
  createNode({
    id: source.id,
    data: {
      title: source.title,
      desc: '',
      type: BlockEnum.DataSource,
      provider_type: source.type,
      provider_name: source.title,
      plugin_id: 'datasource-plugin',
      datasource_name: source.id,
      datasource_label: source.title,
      datasource_parameters: {},
      datasource_configurations: {},
      fileExtensions: ['txt', 'pdf'],
    } satisfies DataSourceNodeType,
  }),
)
const document = {
  workspace_id: 'workspace-1',
  page_id: 'page-1',
  page_name: 'Guide',
  page_icon: null,
  parent_id: '',
  type: 'page',
  is_bound: false,
}
const page = {
  source_url: 'https://example.com',
  title: 'Guide',
  markdown: '# Guide',
  description: '',
}
const expectedInfo: Record<string, Record<string, unknown>> = {
  local: {
    related_id: 'file-1',
    name: 'guide.txt',
    size: 4,
    extension: 'txt',
    mime_type: 'text/plain',
    url: '',
    transfer_method: 'local_file',
  },
  document: {
    workspace_id: 'workspace-1',
    credential_id: 'credential-1',
    page: {
      page_id: 'page-1',
      page_name: 'Guide',
      page_icon: null,
      parent_id: '',
      type: 'page',
      is_bound: false,
    },
  },
  website: { ...page, credential_id: 'credential-1' },
  drive: {
    bucket: 'documents',
    id: 'drive-2',
    name: 'Guide.txt',
    type: 'file',
    credential_id: 'credential-1',
  },
}
const uploadedFile = {
  id: 'file-1',
  name: 'guide.txt',
  extension: 'txt',
  mime_type: 'text/plain',
  size: 4,
} satisfies FileResponse
const handleRun = vi.fn()
beforeEach(() => {
  api.upload.mockReset().mockResolvedValue(uploadedFile)
  api.stream.mockReset().mockImplementation(async (_url, { body }, callbacks) => {
    if (!body || typeof body !== 'object' || !('datasource_type' in body))
      throw new Error('Expected a datasource request')
    const hasBucket =
      'inputs' in body &&
      body.inputs &&
      typeof body.inputs === 'object' &&
      'bucket' in body.inputs &&
      Boolean(body.inputs.bucket)
    const data =
      body.datasource_type === DatasourceType.onlineDocument
        ? [
            {
              workspace_id: 'workspace-1',
              workspace_name: 'Workspace',
              workspace_icon: null,
              pages: [document],
            },
          ]
        : body.datasource_type === DatasourceType.websiteCrawl
          ? [page]
          : [
              {
                bucket: 'documents',
                files: hasBucket
                  ? [{ id: 'drive-2', name: 'Guide.txt', type: 'file', size: 4 }]
                  : [],
                is_truncated: false,
              },
            ]
    callbacks.onDataSourceNodeCompleted?.({
      event: 'datasource_completed',
      time_consuming: 1,
      data,
    })
  })
})

const setup = async () => {
  const sourceStore = createDataSourceStore()
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  queryClient.setQueryData(consoleQuery.files.supportType.get.queryKey(), {
    allowed_extensions: ['txt', 'pdf'],
  })
  for (const source of sources) {
    queryClient.setQueryData(
      consoleQuery.auth.plugin.datasource.byProviderId.get.queryKey({
        input: { params: { provider_id: `datasource-plugin/${source.title}` } },
      }),
      {
        result: ['credential-1', 'replacement-credential'].map((id, index) => ({
          id,
          name: index ? 'Second credential' : 'First credential',
          type: 'oauth2',
          is_default: index === 0,
          avatar_url: '',
          credential: {},
        })),
      },
    )
  }
  const rendered = renderWorkflowFlowComponent(
    <NuqsTestingAdapter>
      {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider component. */}
      <DatasetDetailContext.Provider
        value={{ dataset: createDatasetFixture({ pipeline_id: 'pipeline-1' }) }}
      >
        <DataSourceContext value={sourceStore}>
          <Preparation />
        </DataSourceContext>
      </DatasetDetailContext.Provider>
    </NuqsTestingAdapter>,
    {
      nodes,
      queryClient,
      resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
      injectWorkflowStoreSliceFn: createRagPipelineSliceSlice,
      initialStoreState: { isPreparingDataSource: true },
      hooksStoreProps: { handleRun },
    },
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('radio', { name: 'Local File' }))
  return { user, workflowStore: rendered.store }
}
const next = () => screen.getByRole('button', { name: /datasetCreation.stepOne.button/ })
const process = () => screen.getByRole('button', { name: 'datasetPipeline.operations.process' })
const back = () =>
  screen.getByRole('button', { name: 'datasetPipeline.operations.backToDataSource' })
const selectItem = async (id: string, user: ReturnType<typeof userEvent.setup>) => {
  if (id === 'local') {
    await user.upload(
      screen.getByLabelText('datasetCreation.stepOne.uploader.browse'),
      new File(['text'], 'guide.txt', { type: 'text/plain' }),
    )
  } else if (id === 'website') {
    const run = await screen.findByRole('button', { name: 'datasetCreation.stepOne.website.run' })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)
  } else if (id === 'document') {
    await user.click(await screen.findByRole('radio', { name: 'Guide' }))
  } else {
    await user.click(await screen.findByText('documents'))
    await user.click(await screen.findByRole('radio', { name: 'Guide.txt' }))
  }
  await waitFor(() => expect(next()).toBeEnabled())
}

it.each(sources)(
  'requires a selected item before processing $title and sends its complete run payload',
  async ({ id, title, type }) => {
    const { user, workflowStore } = await setup()
    await user.click(screen.getByRole('radio', { name: title }))
    expect(next()).toBeDisabled()
    await user.click(next())
    expect(
      screen.queryByRole('button', { name: 'datasetPipeline.operations.process' }),
    ).not.toBeInTheDocument()
    expect(handleRun).not.toHaveBeenCalled()
    await selectItem(id, user)
    await user.click(next())
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent(
      'datasetPipeline.testRun.steps.documentProcessing',
    )
    await user.click(process())
    await waitFor(() =>
      expect(handleRun).toHaveBeenCalledExactlyOnceWith({
        inputs: { limit: 5 },
        start_node_id: id,
        datasource_type: type,
        datasource_info_list: [expectedInfo[id]],
      }),
    )
    expect(workflowStore.getState().isPreparingDataSource).toBe(false)
  },
)

it('waits for upload completion before opening processing and preserves the source on Back', async () => {
  const uploading = createDeferred<typeof uploadedFile>()
  api.upload.mockReturnValueOnce(uploading.promise)
  const { user } = await setup()
  await user.upload(
    screen.getByLabelText('datasetCreation.stepOne.uploader.browse'),
    new File(['text'], 'guide.txt', { type: 'text/plain' }),
  )
  expect(next()).toBeDisabled()
  await act(async () => uploading.resolve(uploadedFile))
  await waitFor(() => expect(next()).toBeEnabled())
  await user.click(next())
  await user.click(back())
  expect(screen.getByRole('radio', { name: 'Local File' })).toBeChecked()
  expect(screen.getByText('guide.txt')).toBeInTheDocument()
  expect(next()).toBeEnabled()
  await user.click(screen.getByRole('radio', { name: 'Online Document' }))
  expect(next()).toBeDisabled()
})

it.each(sources.filter((source) => source.id !== 'local'))(
  'discards $title selections when credentials change and uses the replacement credential',
  async ({ id, title }) => {
    const { user } = await setup()
    await user.click(screen.getByRole('radio', { name: title }))
    await selectItem(id, user)
    await user.click(screen.getByRole('button', { name: /First credential/ }))
    await user.click(await screen.findByText('Second credential'))
    expect(next()).toBeDisabled()
    await selectItem(id, user)
    await user.click(next())
    await user.click(process())
    await waitFor(() =>
      expect(handleRun).toHaveBeenCalledWith(
        expect.objectContaining({
          start_node_id: id,
          datasource_info_list: [{ ...expectedInfo[id], credential_id: 'replacement-credential' }],
        }),
      ),
    )
  },
)

it('discards the previous selection and credential when returning to a datasource', async () => {
  const { user } = await setup()
  await user.click(screen.getByRole('radio', { name: 'Online Document' }))
  await user.click(await screen.findByRole('button', { name: /First credential/ }))
  await user.click(await screen.findByText('Second credential'))
  await selectItem('document', user)
  await user.click(screen.getByRole('radio', { name: 'Local File' }))
  await user.click(screen.getByRole('radio', { name: 'Online Document' }))
  expect(next()).toBeDisabled()
  expect(await screen.findByRole('button', { name: /First credential/ })).toBeInTheDocument()
  await selectItem('document', user)
  await user.click(next())
  await user.click(process())
  await waitFor(() =>
    expect(handleRun).toHaveBeenCalledExactlyOnceWith({
      inputs: { limit: 5 },
      start_node_id: 'document',
      datasource_type: DatasourceType.onlineDocument,
      datasource_info_list: [expectedInfo.document],
    }),
  )
})

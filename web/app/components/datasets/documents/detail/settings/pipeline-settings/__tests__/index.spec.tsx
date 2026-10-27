import type { ComponentProps } from 'react'
import type ChunkPreview from '../../../../create-from-pipeline/preview/chunk-preview'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DatasourceType, PipelineInputVarType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as render,
} from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import PipelineSettings from '../index'

const mockPush = vi.fn()
const mockBack = vi.fn()
const mockRun = vi.fn()
const mockLog = vi.fn()
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }))
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    select: (state: { dataset: { pipeline_id: string; doc_form: string } }) => unknown,
  ) => select({ dataset: { pipeline_id: 'pipeline-123', doc_form: 'text_model' } }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.workflows.published.processing.parameters.get': async () => ({
        variables: [
          {
            belong_to_node_id: 'source-1',
            type: PipelineInputVarType.textInput,
            variable: 'separator',
            label: 'Separator',
            required: true,
            default_value: '---',
          },
        ],
      }),
      'datasets.byDatasetId.documents.byDocumentId.pipelineExecutionLog.get': (input) =>
        mockLog(input),
      'rag.pipelines.byPipelineId.workflows.published.run.post': (input) => mockRun(input),
    }),
  }
})
// Preview rendering/selection has its own suite; this owner supplies the source and estimate data.
let previewProps: ComponentProps<typeof ChunkPreview>
vi.mock('../../../../create-from-pipeline/preview/chunk-preview', () => ({
  default: (props: ComponentProps<typeof ChunkPreview>) => {
    previewProps = props
    return null
  },
}))

const log = {
  datasource_type: DatasourceType.localFile,
  input_data: { separator: 'previous' },
  datasource_node_id: 'source-1',
  datasource_info: { related_id: 'file-1', name: 'Guide.pdf', extension: 'pdf' },
}
const params = { dataset_id: 'dataset-123', document_id: 'document-456' }
const logKey =
  consoleQuery.datasets.byDatasetId.documents.byDocumentId.pipelineExecutionLog.get.queryKey({
    input: { params },
  })
const listKey = consoleQuery.datasets.byDatasetId.documents.get.queryKey({
  input: { params: { dataset_id: params.dataset_id }, query: { page: 1 } },
})
const detailKey = consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.queryKey({
  input: { params },
})
function setup(lastRunData: object | null = log) {
  const queryClient = createConsoleQueryClient()
  if (lastRunData) {
    queryClient.setQueryData(logKey, lastRunData)
    mockLog.mockResolvedValue(lastRunData)
  }
  queryClient.setQueryData(listKey, { data: [], total: 0, page: 1, limit: 20, has_more: false })
  queryClient.setQueryData(detailKey, { id: 'document-456' })
  queryClient.setQueryData(
    consoleQuery.rag.pipelines.byPipelineId.workflows.published.processing.parameters.get.queryKey({
      input: { params: { pipeline_id: 'pipeline-123' }, query: { node_id: 'source-1' } },
    }),
    {
      variables: [
        {
          belong_to_node_id: 'source-1',
          type: PipelineInputVarType.textInput,
          variable: 'separator',
          label: 'Separator',
          required: true,
          default_value: '---',
        },
      ],
    },
  )
  render(<PipelineSettings datasetId={params.dataset_id} documentId={params.document_id} />, {
    queryClient,
  })
  return queryClient
}
beforeEach(() => {
  mockLog.mockReset().mockResolvedValue(log)
  mockRun
    .mockReset()
    .mockResolvedValue({ data: { outputs: { total_segments: 0, preview: [], qa_preview: [] } } })
})

it('loads the selected document before offering processing controls', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<typeof log>()
  mockLog.mockReturnValueOnce(pending.promise)
  setup(null)
  expect(
    screen.queryByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }),
  ).not.toBeInTheDocument()
  await waitFor(() => expect(mockLog).toHaveBeenCalledWith({ params }))
  await act(async () => pending.resolve(log))
  expect(await screen.findByRole('textbox', { name: /Separator/ })).toHaveValue('previous')
  await user.click(screen.getByRole('button', { name: 'common.operation.back' }))
  expect(mockBack).toHaveBeenCalledOnce()
})

it('shows the unavailable state after an execution-log failure', async () => {
  mockLog.mockRejectedValueOnce(new Error('offline'))
  setup(null)
  expect(await screen.findByText('datasetCreation.error.unavailable')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }),
  ).not.toBeInTheDocument()
})

it.each([true, false])(
  'submits edited inputs with preview=%s and applies the appropriate completion effects',
  async (isPreview) => {
    const user = userEvent.setup()
    const response = createDeferred<{
      data: { outputs: { total_segments: number; preview: string[]; qa_preview: never[] } }
    }>()
    mockRun.mockReturnValueOnce(response.promise)
    const queryClient = setup()
    await screen.findByRole('textbox', { name: /Separator/ })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }),
      ).toBeEnabled(),
    )
    const input = screen.getByRole('textbox', { name: /Separator/ })
    await user.clear(input)
    await user.type(input, '|||')
    const action = screen.getByRole('button', {
      name: isPreview ? /preview/i : 'datasetPipeline.operations.saveAndProcess',
    })
    await user.click(action)
    await waitFor(() =>
      expect(mockRun).toHaveBeenCalledExactlyOnceWith({
        params: { pipeline_id: 'pipeline-123' },
        body: {
          inputs: { separator: '|||' },
          start_node_id: 'source-1',
          datasource_type: DatasourceType.localFile,
          datasource_info_list: [log.datasource_info],
          is_preview: isPreview,
          response_mode: 'blocking',
          ...(!isPreview ? { original_document_id: 'document-456' } : {}),
        },
      }),
    )
    await waitFor(() => expect(action).toBeDisabled())
    expect(previewProps.isPending).toBe(isPreview)
    await user.click(action)
    expect(mockRun).toHaveBeenCalledOnce()
    const outputs = { total_segments: 1, preview: ['Preview chunk'], qa_preview: [] }
    await act(async () => response.resolve({ data: { outputs } }))
    if (isPreview) {
      await waitFor(() =>
        expect(previewProps.estimateData).toEqual(expect.objectContaining(outputs)),
      )
      expect(mockPush).not.toHaveBeenCalled()
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false)
    } else {
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-123/documents'))
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true)
    }
  },
)

it.each([
  [
    DatasourceType.localFile,
    { related_id: 'file-1', name: 'Guide.pdf', extension: 'pdf' },
    'localFiles',
    { id: 'file-1', name: 'Guide.pdf', extension: 'pdf' },
  ],
  [
    DatasourceType.websiteCrawl,
    {
      content: 'Content',
      description: 'Summary',
      source_url: 'https://example.com',
      title: 'Site',
    },
    'websitePages',
    {
      markdown: 'Content',
      description: 'Summary',
      source_url: 'https://example.com',
      title: 'Site',
    },
  ],
  [
    DatasourceType.onlineDocument,
    { workspace_id: 'workspace-1', page: { page_id: 'page-1', page_name: 'Notion' } },
    'onlineDocuments',
    { workspace_id: 'workspace-1', page_id: 'page-1', page_name: 'Notion' },
  ],
  [
    DatasourceType.onlineDrive,
    { id: 'drive-1', name: 'Drive', size: 100, type: 'file' },
    'onlineDriveFiles',
    { id: 'drive-1', name: 'Drive', size: 100, type: 'file' },
  ],
] as const)(
  'converts %s source metadata for preview',
  async (datasourceType, datasourceInfo, field, expected) => {
    setup({ ...log, datasource_type: datasourceType, datasource_info: datasourceInfo })
    await waitFor(() => expect(previewProps[field]).toEqual([expected]))
  },
)

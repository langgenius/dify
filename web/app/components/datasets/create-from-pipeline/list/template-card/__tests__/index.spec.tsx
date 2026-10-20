import type { PipelineTemplate } from '@/models/pipeline'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChunkingMode } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as render,
} from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import TemplateCard from '../index'

const mockPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Mock amplitude tracking
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: mockToastSuccess,
      error: mockToastError,
    },
  }
})

// Mock download utilities
vi.mock('@/utils/download', () => ({
  downloadBlob: vi.fn(),
  downloadUrl: vi.fn(),
}))

vi.mock('@/app/components/workflow/workflow-preview', () => ({
  default: () => <div>Workflow preview</div>,
}))

const mockCreateDataset = vi.fn()
const mockGetPipelineTemplateInfo = vi.fn()
const mockDeletePipeline = vi.fn()
const mockExportPipelineDSL = vi.fn()
const mockHandleCheckPluginDependencies = vi.fn()

// Configurable isPending for export

// Mock plugin dependencies hook
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

const createPipelineTemplate = (overrides: Partial<PipelineTemplate> = {}): PipelineTemplate => ({
  id: 'pipeline-1',
  name: 'Test Pipeline',
  description: 'Test pipeline description',
  icon: {
    icon_type: 'emoji',
    icon: '📊',
    icon_background: '#FFF4ED',
    icon_url: '',
  },
  chunk_structure: ChunkingMode.text,
  position: 1,
  ...overrides,
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipeline.dataset.post': (input) => mockCreateDataset(input),
      'rag.pipeline.templates.byTemplateId.get': (input) => mockGetPipelineTemplateInfo(input),
      'rag.pipeline.customized.templates.byTemplateId.delete': (input) => mockDeletePipeline(input),
      'rag.pipeline.customized.templates.byTemplateId.post': (input) =>
        mockExportPipelineDSL(input),
    }),
  }
})
const template = createPipelineTemplate()
const datasetListKey = consoleQuery.datasets.get.queryKey({ input: { query: { page: 1 } } })
const templateListKey = consoleQuery.rag.pipeline.templates.get.queryKey({
  input: { query: { type: 'customized' } },
})
function setup() {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(datasetListKey, {
    data: [],
    total: 0,
    page: 1,
    limit: 20,
    has_more: false,
  })
  queryClient.setQueryData(templateListKey, { pipeline_templates: [] })
  render(<TemplateCard pipeline={template} type="customized" />, { queryClient })
  return queryClient
}
async function action(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  await user.click(await screen.findByRole('menuitem', { name }))
}
beforeEach(() => {
  mockCreateDataset
    .mockReset()
    .mockResolvedValue({ dataset_id: 'created-dataset', pipeline_id: 'created-pipeline' })
  mockDeletePipeline.mockReset().mockResolvedValue({ result: 'success' })
  mockExportPipelineDSL.mockReset().mockResolvedValue({ data: 'yaml_export' })
  mockHandleCheckPluginDependencies.mockReset().mockResolvedValue(undefined)
  mockGetPipelineTemplateInfo.mockReset().mockResolvedValue({
    id: 'pipeline-1',
    name: 'Test Pipeline',
    description: 'Description',
    export_data: 'yaml_template',
    icon_info: {},
    chunk_structure: 'text_model',
    graph: { nodes: [], edges: [] },
  })
})

it.each(['card', 'details'])(
  'creates a dataset from the %s entry and checks dependencies before navigating',
  async (entry) => {
    const user = userEvent.setup()
    const dependencies = createDeferred()
    mockHandleCheckPluginDependencies.mockReturnValueOnce(dependencies.promise)
    const queryClient = setup()
    if (entry === 'details') {
      await user.click(screen.getByRole('button', { name: 'datasetPipeline.operations.details' }))
      await user.click(
        await screen.findByRole('button', { name: 'datasetPipeline.operations.useTemplate' }),
      )
    } else
      await user.click(screen.getByRole('button', { name: 'datasetPipeline.operations.choose' }))
    await waitFor(() =>
      expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('created-pipeline', true),
    )
    expect(mockGetPipelineTemplateInfo).toHaveBeenCalledWith({
      params: { template_id: 'pipeline-1' },
      query: { type: 'customized' },
    })
    expect(mockCreateDataset).toHaveBeenCalledExactlyOnceWith({
      body: { yaml_content: 'yaml_template' },
    })
    expect(queryClient.getQueryState(datasetListKey)?.isInvalidated).toBe(true)
    expect(mockPush).not.toHaveBeenCalled()
    await act(async () => dependencies.resolve())
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/datasets/created-dataset/pipeline'))
  },
)

it('navigates without a dependency check when the created dataset has no pipeline ID', async () => {
  const user = userEvent.setup()
  mockCreateDataset.mockResolvedValueOnce({ dataset_id: 'created-dataset', pipeline_id: '' })
  setup()
  await user.click(screen.getByRole('button', { name: 'datasetPipeline.operations.choose' }))
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/datasets/created-dataset/pipeline'))
  expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
})

it.each(['fetch', 'create'])('keeps the template available after a %s failure', async (stage) => {
  const user = userEvent.setup()
  if (stage === 'fetch') mockGetPipelineTemplateInfo.mockRejectedValueOnce(new Error('offline'))
  else mockCreateDataset.mockRejectedValueOnce(new Error('offline'))
  const queryClient = setup()
  await user.click(screen.getByRole('button', { name: 'datasetPipeline.operations.choose' }))
  await waitFor(() =>
    expect(mockToastError).toHaveBeenCalledWith('datasetPipeline.creation.errorTip'),
  )
  expect(mockPush).not.toHaveBeenCalled()
  expect(queryClient.getQueryState(datasetListKey)?.isInvalidated).toBe(false)
  if (stage === 'fetch') expect(mockCreateDataset).not.toHaveBeenCalled()
})

it('downloads the exported YAML once while an export is pending', async () => {
  const user = userEvent.setup()
  const { downloadBlob } = await import('@/utils/download')
  const response = createDeferred<{ data: string }>()
  mockExportPipelineDSL.mockReturnValueOnce(response.promise)
  setup()
  await action(user, 'datasetPipeline.operations.exportPipeline')
  await waitFor(() =>
    expect(mockExportPipelineDSL).toHaveBeenCalledExactlyOnceWith({
      params: { template_id: 'pipeline-1' },
    }),
  )
  await action(user, 'datasetPipeline.operations.exportPipeline')
  expect(mockExportPipelineDSL).toHaveBeenCalledOnce()
  await act(async () => response.resolve({ data: 'yaml_export' }))
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce())
  const downloaded = vi.mocked(downloadBlob).mock.calls[0]![0]
  expect(downloaded.fileName).toBe('Test Pipeline.pipeline')
  expect(await downloaded.data.text()).toBe('yaml_export')
})

it('reports an export failure without downloading a file', async () => {
  const user = userEvent.setup()
  const { downloadBlob } = await import('@/utils/download')
  mockExportPipelineDSL.mockRejectedValueOnce(new Error('offline'))
  setup()
  await action(user, 'datasetPipeline.operations.exportPipeline')
  await waitFor(() =>
    expect(mockToastError).toHaveBeenCalledWith('datasetPipeline.exportDSL.errorTip'),
  )
  expect(downloadBlob).not.toHaveBeenCalled()
})

it('deletes only after confirmation and invalidates customized templates', async () => {
  const user = userEvent.setup()
  const queryClient = setup()
  await action(user, 'common.operation.delete')
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.cancel',
    }),
  )
  expect(mockDeletePipeline).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  await action(user, 'common.operation.delete')
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.confirm',
    }),
  )
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(mockDeletePipeline).toHaveBeenCalledExactlyOnceWith({
    params: { template_id: 'pipeline-1' },
  })
  expect(queryClient.getQueryState(templateListKey)?.isInvalidated).toBe(true)
})

it('opens editing for the chosen template and discards canceled changes', async () => {
  const user = userEvent.setup()
  setup()
  await action(user, 'datasetPipeline.operations.editInfo')
  expect(
    await screen.findByRole('textbox', { name: 'datasetPipeline.pipelineNameAndIcon' }),
  ).toHaveValue('Test Pipeline')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryWrapper, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_METHOD } from '@/types/app'
import { DatasetACLPermission } from '@/utils/permission'
import ActionsMenu from '../actions-menu'

let mockDataset: DatasetDetailWithPartialMembersResponse
const mockReplace = vi.fn()
let invalidateQueries: ReturnType<typeof vi.spyOn>
const mockUpdateDatasetSetting = vi.fn()
const datasetListKey = consoleQuery.datasets.get.key()
const datasetDetailKey = consoleQuery.datasets.byDatasetId.get.queryKey({
  input: { params: { dataset_id: 'dataset-1' } },
})
const mockExportPipeline = vi.fn()
const mockCheckIsUsedInApp = vi.fn()
const mockDeleteDataset = vi.fn()
const mockToast = vi.fn()
let mockIsRbacEnabled = true
const mockConsoleState = vi.hoisted(() => ({
  current: {
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: [] as string[],
  },
}))

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) => {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { rbac_enabled: mockIsRbacEnabled },
    accountProfile: mockConsoleState.current.userProfile,
    workspacePermissionKeys: mockConsoleState.current.workspacePermissionKeys,
  })
  invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  return renderWithConsoleQuery(ui, { queryClient })
}

const createDataset = (
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
): DatasetDetailWithPartialMembersResponse => ({
  ...createDatasetFixture(),
  id: 'dataset-1',
  name: 'Dataset Name',
  icon_info: {
    icon: '📙',
    icon_background: '#FFF4ED',
    icon_type: 'emoji',
    icon_url: '',
  },
  description: 'Dataset description',
  permission: PermissionLevel.onlyMe,
  data_source_type: DataSourceType.FILE,
  indexing_technique:
    'high_quality' as DatasetDetailWithPartialMembersResponse['indexing_technique'],
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: 1690000000,
  app_count: 0,
  doc_form: ChunkingMode.text,
  document_count: 1,
  word_count: 1000,
  provider: 'internal',
  embedding_model: 'text-embedding-3',
  embedding_model_provider: 'openai',
  embedding_available: true,
  retrieval_model_dict: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
    top_k: 5,
    score_threshold_enabled: false,
    score_threshold: 0,
  },
  tags: [],
  external_knowledge_info: {
    external_knowledge_id: '',
    external_knowledge_api_id: '',
    external_knowledge_api_name: '',
    external_knowledge_api_endpoint: '',
  },
  external_retrieval_model: {
    top_k: 0,
    score_threshold: 0,
    score_threshold_enabled: false,
  },
  built_in_field_enabled: false,
  runtime_mode: 'rag_pipeline',
  enable_api: false,
  is_multimodal: false,
  permission_keys: [
    DatasetACLPermission.Edit,
    DatasetACLPermission.Delete,
    DatasetACLPermission.ImportExportDSL,
  ],
  ...overrides,
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: { dataset?: DatasetDetailWithPartialMembersResponse }) => unknown,
  ) => selector({ dataset: mockDataset }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.useCheck.get': (input) => mockCheckIsUsedInApp(input),
      'datasets.byDatasetId.delete': (input) => mockDeleteDataset(input),
      'rag.pipelines.byPipelineId.exports.get': (input) => mockExportPipeline(input),
    }),
  }
})

vi.mock('@/service/datasets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/datasets')>()),
  updateDatasetSetting: (...args: unknown[]) => mockUpdateDatasetSetting(...args),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: (...args: unknown[]) => mockToast(...args),
  },
}))

describe('ActionsMenu callback coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsRbacEnabled = true
    mockDataset = createDataset({ pipeline_id: 'pipeline-1', runtime_mode: 'rag_pipeline' })
    mockExportPipeline.mockResolvedValue({ data: 'pipeline-content' })
    mockCheckIsUsedInApp.mockResolvedValue({ is_using: false })
    mockDeleteDataset.mockResolvedValue({})
    mockUpdateDatasetSetting.mockResolvedValue({})
  })

  it('should call refreshDataset when rename succeeds', async () => {
    const user = userEvent.setup()
    render(<ActionsMenu expand />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('common.operation.edit'))

    expect(screen.getByRole('dialog', { name: 'datasetSettings.title' })).toBeInTheDocument()
    const name = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(name)
    await user.type(name, 'Renamed dataset')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({ name: 'Renamed dataset' }),
      }),
    )

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: datasetListKey })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: datasetDetailKey })
    })
  })

  it('should close rename modal when onClose is called', async () => {
    const user = userEvent.setup()
    render(<ActionsMenu expand />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('common.operation.edit'))

    expect(screen.getByRole('dialog', { name: 'datasetSettings.title' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'datasetSettings.title' }),
      ).not.toBeInTheDocument()
    })
  })

  it('should close confirm dialog when cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<ActionsMenu expand />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('common.operation.delete'))

    await waitFor(() => {
      expect(screen.getByText('dataset.deleteDatasetConfirmTitle')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => {
      expect(screen.queryByText('dataset.deleteDatasetConfirmTitle')).not.toBeInTheDocument()
    })
  })

  it('keeps deletion open while pending, then closes and navigates on success', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<void>()
    mockDeleteDataset.mockReturnValueOnce(pending.promise)
    render(<ActionsMenu expand />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('common.operation.delete'))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(mockDeleteDataset).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()

    await act(async () => pending.resolve())
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/datasets'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('should show the used-by-app confirmation copy when the dataset is referenced by apps', async () => {
    const user = userEvent.setup()
    mockCheckIsUsedInApp.mockResolvedValueOnce({ is_using: true })

    render(<ActionsMenu expand />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('common.operation.delete'))

    await waitFor(() => {
      expect(screen.getByText('dataset.datasetUsedByApp')).toBeInTheDocument()
    })
  })

  it('should surface an export failure toast when pipeline export fails', async () => {
    const user = userEvent.setup()
    mockExportPipeline.mockRejectedValueOnce(new Error('export failed'))

    render(<ActionsMenu expand />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('datasetPipeline.operations.exportPipeline'))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('app.exportFailed')
    })
  })

  it('should not attempt export when the dataset has no pipeline id', async () => {
    const user = userEvent.setup()
    mockDataset = createDataset({ pipeline_id: '' })

    render(<ActionsMenu expand={false} />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('datasetPipeline.operations.exportPipeline'))

    expect(mockExportPipeline).not.toHaveBeenCalled()
  })

  it('keeps failed usage checks in the dialog with a retry action', async () => {
    const user = userEvent.setup()
    mockCheckIsUsedInApp.mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 400 }), { message: 'check failed' }),
    )

    render(<ActionsMenu expand />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('common.operation.delete'))

    expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBeEnabled()
    expect(mockDeleteDataset).not.toHaveBeenCalled()
  })
})

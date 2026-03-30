import type { DataSet } from '@/models/datasets'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import {
  ChunkingMode,
  DatasetPermission,
  DataSourceType,
} from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import Dropdown from '../dropdown'

let mockDataset: DataSet
let mockIsDatasetOperator = false
const mockReplace = vi.fn()
const mockInvalidDatasetList = vi.fn()
const mockInvalidDatasetDetail = vi.fn()
const mockExportPipeline = vi.fn()
const mockCheckIsUsedInApp = vi.fn()
const mockDeleteDataset = vi.fn()
const mockToast = vi.fn()
const mockDownloadBlob = vi.fn()

const createDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
  id: 'dataset-1',
  name: 'Dataset Name',
  indexing_status: 'completed',
  icon_info: {
    icon: '📙',
    icon_background: '#FFF4ED',
    icon_type: 'emoji',
    icon_url: '',
  },
  description: 'Dataset description',
  permission: DatasetPermission.onlyMe,
  data_source_type: DataSourceType.FILE,
  indexing_technique: 'high_quality' as DataSet['indexing_technique'],
  created_by: 'user-1',
  updated_by: 'user-1',
  updated_at: 1690000000,
  app_count: 0,
  doc_form: ChunkingMode.text,
  document_count: 1,
  total_document_count: 1,
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
  retrieval_model: {
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
  pipeline_id: 'pipeline-1',
  ...overrides,
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset?: DataSet }) => unknown) => selector({ dataset: mockDataset }),
}))

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: { isCurrentWorkspaceDatasetOperator: boolean }) => unknown) =>
    selector({ isCurrentWorkspaceDatasetOperator: mockIsDatasetOperator }),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  datasetDetailQueryKeyPrefix: ['dataset', 'detail'],
  useInvalidDatasetList: () => mockInvalidDatasetList,
}))

vi.mock('@/service/use-base', () => ({
  useInvalid: () => mockInvalidDatasetDetail,
}))

vi.mock('@/service/use-pipeline', () => ({
  useExportPipelineDSL: () => ({
    mutateAsync: mockExportPipeline,
  }),
}))

vi.mock('@/service/datasets', () => ({
  checkIsUsedInApp: (...args: unknown[]) => mockCheckIsUsedInApp(...args),
  deleteDataset: (...args: unknown[]) => mockDeleteDataset(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}))

vi.mock('@/app/components/datasets/rename-modal', () => ({
  default: ({
    show,
    onClose,
    onSuccess,
  }: {
    show: boolean
    onClose: () => void
    onSuccess: () => void
  }) => (show
    ? (
        <div data-testid="rename-modal">
          <button type="button" onClick={onSuccess}>rename-success</button>
          <button type="button" onClick={onClose}>rename-close</button>
        </div>
      )
    : null),
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({
    isShow,
    content,
    onConfirm,
    onCancel,
  }: {
    isShow: boolean
    content: string
    onConfirm: () => void
    onCancel: () => void
  }) => (
    isShow
      ? (
          <div data-testid="confirm-dialog">
            <span>{content}</span>
            <button type="button" onClick={onConfirm}>confirm</button>
            <button type="button" onClick={onCancel}>cancel</button>
          </div>
        )
      : null
  ),
}))

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>
      {children}
    </div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('Dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createDataset()
    mockIsDatasetOperator = false
    mockExportPipeline.mockResolvedValue({ data: 'pipeline-yaml' })
    mockDeleteDataset.mockResolvedValue({})
    mockCheckIsUsedInApp.mockResolvedValue({ is_using: true })
  })

  it('should export the pipeline configuration and download the exported file', async () => {
    const user = userEvent.setup()

    render(<Dropdown expand />)

    await user.click(screen.getByTestId('portal-trigger'))
    await user.click(screen.getByText('datasetPipeline.operations.exportPipeline'))

    await waitFor(() => {
      expect(mockExportPipeline).toHaveBeenCalledWith({
        pipelineId: 'pipeline-1',
        include: false,
      })
    })
    expect(mockDownloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'Dataset Name.pipeline',
    })
  })

  it('should confirm deletion with usage-aware copy and delete the dataset after confirmation', async () => {
    const user = userEvent.setup()

    render(<Dropdown expand />)

    await user.click(screen.getByTestId('portal-trigger'))
    await user.click(screen.getByText('common.operation.delete'))

    await waitFor(() => {
      expect(mockCheckIsUsedInApp).toHaveBeenCalledWith('dataset-1')
    })
    expect(screen.getByText('dataset.datasetUsedByApp')).toBeInTheDocument()

    await user.click(screen.getByText('confirm'))

    await waitFor(() => {
      expect(mockDeleteDataset).toHaveBeenCalledWith('dataset-1')
    })
    expect(mockInvalidDatasetList).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledWith('/datasets')
  })

  it('should open the rename modal and hide delete actions for dataset operators', async () => {
    const user = userEvent.setup()
    mockIsDatasetOperator = true

    render(<Dropdown expand={false} />)

    await user.click(screen.getByTestId('portal-trigger'))
    await user.click(screen.getByText('common.operation.edit'))

    expect(screen.getByTestId('rename-modal')).toBeInTheDocument()
    expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()

    await user.click(screen.getByText('rename-success'))

    expect(mockInvalidDatasetList).toHaveBeenCalledTimes(1)
    expect(mockInvalidDatasetDetail).toHaveBeenCalledTimes(1)

    await user.click(screen.getByText('rename-close'))

    await waitFor(() => {
      expect(screen.queryByTestId('rename-modal')).not.toBeInTheDocument()
    })
  })

  it('should show the standard delete confirmation copy and close the dialog on cancel', async () => {
    const user = userEvent.setup()
    mockCheckIsUsedInApp.mockResolvedValue({ is_using: false })

    render(<Dropdown expand />)

    await user.click(screen.getByTestId('portal-trigger'))
    await user.click(screen.getByText('common.operation.delete'))

    await waitFor(() => {
      expect(screen.getByText('dataset.deleteDatasetConfirmContent')).toBeInTheDocument()
    })

    await user.click(screen.getByText('cancel'))

    await waitFor(() => {
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })
  })

  it('should show an error toast when dataset usage detection fails', async () => {
    const user = userEvent.setup()
    const json = vi.fn().mockResolvedValue({ message: 'Dataset still linked' })
    mockCheckIsUsedInApp.mockRejectedValue({ json })

    render(<Dropdown expand />)

    await user.click(screen.getByTestId('portal-trigger'))
    await user.click(screen.getByText('common.operation.delete'))

    await waitFor(() => {
      expect(json).toHaveBeenCalledTimes(1)
    })
    expect(mockToast).toHaveBeenCalledWith('Dataset still linked', { type: 'error' })
  })

  it('should not export anything when the dataset has no pipeline id', async () => {
    const user = userEvent.setup()
    mockDataset = createDataset({ pipeline_id: undefined })

    render(<Dropdown expand />)

    await user.click(screen.getByTestId('portal-trigger'))
    await user.click(screen.getByText('datasetPipeline.operations.exportPipeline'))

    expect(mockExportPipeline).not.toHaveBeenCalled()
    expect(mockDownloadBlob).not.toHaveBeenCalled()
  })

  it('should show an error toast when pipeline export fails', async () => {
    const user = userEvent.setup()
    mockExportPipeline.mockRejectedValue(new Error('export failed'))

    render(<Dropdown expand />)

    await user.click(screen.getByTestId('portal-trigger'))
    await user.click(screen.getByText('datasetPipeline.operations.exportPipeline'))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('app.exportFailed', { type: 'error' })
    })
  })
})

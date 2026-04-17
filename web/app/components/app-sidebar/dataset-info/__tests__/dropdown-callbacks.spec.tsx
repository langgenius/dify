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
  useExportPipelineDSL: () => ({ mutateAsync: mockExportPipeline }),
}))

vi.mock('@/service/datasets', () => ({
  checkIsUsedInApp: (...args: unknown[]) => mockCheckIsUsedInApp(...args),
  deleteDataset: (...args: unknown[]) => mockDeleteDataset(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

vi.mock('@/app/components/datasets/rename-modal', () => ({
  default: ({
    show,
    onClose,
    onSuccess,
  }: {
    show: boolean
    onClose: () => void
    onSuccess?: () => void
  }) => {
    if (!show)
      return null
    return (
      <div data-testid="rename-modal">
        <button type="button" onClick={onSuccess}>Success</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    )
  },
}))

describe('Dropdown callback coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createDataset({ pipeline_id: 'pipeline-1', runtime_mode: 'rag_pipeline' })
    mockIsDatasetOperator = false
    mockExportPipeline.mockResolvedValue({ data: 'pipeline-content' })
    mockCheckIsUsedInApp.mockResolvedValue({ is_using: false })
    mockDeleteDataset.mockResolvedValue({})
  })

  it('should call refreshDataset when rename succeeds', async () => {
    const user = userEvent.setup()
    render(<Dropdown expand />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('common.operation.edit'))

    expect(screen.getByTestId('rename-modal')).toBeInTheDocument()
    await user.click(screen.getByText('Success'))

    await waitFor(() => {
      expect(mockInvalidDatasetList).toHaveBeenCalled()
      expect(mockInvalidDatasetDetail).toHaveBeenCalled()
    })
  })

  it('should close rename modal when onClose is called', async () => {
    const user = userEvent.setup()
    render(<Dropdown expand />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('common.operation.edit'))

    expect(screen.getByTestId('rename-modal')).toBeInTheDocument()
    await user.click(screen.getByText('Close'))

    await waitFor(() => {
      expect(screen.queryByTestId('rename-modal')).not.toBeInTheDocument()
    })
  })

  it('should close confirm dialog when cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<Dropdown expand />)

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

  it('should show the used-by-app confirmation copy when the dataset is referenced by apps', async () => {
    const user = userEvent.setup()
    mockCheckIsUsedInApp.mockResolvedValueOnce({ is_using: true })

    render(<Dropdown expand />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('common.operation.delete'))

    await waitFor(() => {
      expect(screen.getByText('dataset.datasetUsedByApp')).toBeInTheDocument()
    })
  })

  it('should surface an export failure toast when pipeline export fails', async () => {
    const user = userEvent.setup()
    mockExportPipeline.mockRejectedValueOnce(new Error('export failed'))

    render(<Dropdown expand />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('datasetPipeline.operations.exportPipeline'))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('app.exportFailed', { type: 'error' })
    })
  })

  it('should not attempt export when the dataset has no pipeline id', async () => {
    const user = userEvent.setup()
    mockDataset = createDataset({ pipeline_id: '' })

    render(<Dropdown expand={false} />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('datasetPipeline.operations.exportPipeline'))

    expect(mockExportPipeline).not.toHaveBeenCalled()
  })

  it('should render and open correctly when collapsed', async () => {
    const user = userEvent.setup()
    render(<Dropdown expand={false} />)

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('common.operation.edit')).toBeInTheDocument()
  })

  it('should surface the backend message when checking app usage fails', async () => {
    const user = userEvent.setup()
    mockCheckIsUsedInApp.mockRejectedValueOnce({
      json: vi.fn().mockResolvedValue({ message: 'check failed' }),
    })

    render(<Dropdown expand />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('common.operation.delete'))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('check failed', { type: 'error' })
    })
    expect(screen.queryByText('dataset.deleteDatasetConfirmTitle')).not.toBeInTheDocument()
  })
})

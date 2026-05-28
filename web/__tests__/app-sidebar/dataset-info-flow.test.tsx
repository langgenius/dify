import type { DataSet } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DatasetInfo from '@/app/components/app-sidebar/dataset-info'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'

const mockReplace = vi.fn()
const mockInvalidDatasetList = vi.fn()
const mockInvalidDatasetDetail = vi.fn()
const mockExportPipeline = vi.fn()
const mockCheckIsUsedInApp = vi.fn()
const mockDeleteDataset = vi.fn()
const mockDownloadBlob = vi.fn()

let mockDataset: DataSet

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset?: DataSet }) => unknown) => selector({
    dataset: mockDataset,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: { isCurrentWorkspaceDatasetOperator: boolean }) => unknown) =>
    selector({ isCurrentWorkspaceDatasetOperator: false }),
}))

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: () => 'indexing-technique',
  }),
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
  }) => show
    ? (
        <div data-testid="rename-dataset-modal">
          <button type="button" onClick={onSuccess}>rename-success</button>
          <button type="button" onClick={onClose}>rename-close</button>
        </div>
      )
    : null,
}))

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
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 5,
    score_threshold_enabled: false,
    score_threshold: 0,
  },
  retrieval_model: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
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
  pipeline_id: 'pipeline-1',
  enable_api: false,
  is_multimodal: false,
  is_published: true,
  ...overrides,
})

const openDropdown = () => {
  fireEvent.click(screen.getByRole('button'))
}

describe('App Sidebar Dataset Info Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createDataset()
    mockExportPipeline.mockResolvedValue({ data: 'pipeline: demo' })
    mockCheckIsUsedInApp.mockResolvedValue({ is_using: false })
    mockDeleteDataset.mockResolvedValue({})
  })

  it('exports the published pipeline from the dropdown menu', async () => {
    render(<DatasetInfo expand />)

    expect(screen.getByText('Dataset Name')).toBeInTheDocument()

    openDropdown()
    fireEvent.click(await screen.findByText('datasetPipeline.operations.exportPipeline'))

    await waitFor(() => {
      expect(mockExportPipeline).toHaveBeenCalledWith({
        pipelineId: 'pipeline-1',
        include: false,
      })
      expect(mockDownloadBlob).toHaveBeenCalledWith(expect.objectContaining({
        fileName: 'Dataset Name.pipeline',
      }))
    })
  })

  it('opens the rename modal and refreshes dataset caches after a successful rename', async () => {
    render(<DatasetInfo expand />)

    openDropdown()
    fireEvent.click(await screen.findByText('common.operation.edit'))

    expect(await screen.findByTestId('rename-dataset-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'rename-success' }))

    expect(mockInvalidDatasetList).toHaveBeenCalledTimes(1)
    expect(mockInvalidDatasetDetail).toHaveBeenCalledTimes(1)
  })

  it('checks app usage before deleting and redirects back to the dataset list after confirmation', async () => {
    render(<DatasetInfo expand />)

    openDropdown()
    fireEvent.click(await screen.findByText('common.operation.delete'))

    await waitFor(() => {
      expect(mockCheckIsUsedInApp).toHaveBeenCalledWith('dataset-1')
      expect(screen.getByText('dataset.deleteDatasetConfirmTitle')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(mockDeleteDataset).toHaveBeenCalledWith('dataset-1')
      expect(mockInvalidDatasetList).toHaveBeenCalled()
      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })
  })
})

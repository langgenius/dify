import type { DataSet } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ChunkingMode,
  DatasetPermission,
  DataSourceType,
} from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import Menu from '../menu'

let mockDataset: Partial<DataSet>

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
  enable_api: false,
  is_multimodal: false,
  ...overrides,
})

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset?: Partial<DataSet> }) => unknown) =>
    selector({ dataset: mockDataset }),
}))

describe('Menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createDataset()
  })

  it('should render edit, export, and delete actions for rag pipeline datasets', () => {
    render(
      <Menu
        showDelete
        openRenameModal={vi.fn()}
        handleExportPipeline={vi.fn()}
        detectIsUsedByApp={vi.fn()}
      />,
    )

    expect(screen.getByText('common.operation.edit')).toBeInTheDocument()
    expect(screen.getByText('datasetPipeline.operations.exportPipeline')).toBeInTheDocument()
    expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
  })

  it('should hide export action when the dataset is not a rag pipeline dataset', () => {
    mockDataset = createDataset({ runtime_mode: 'general' })

    render(
      <Menu
        showDelete
        openRenameModal={vi.fn()}
        handleExportPipeline={vi.fn()}
        detectIsUsedByApp={vi.fn()}
      />,
    )

    expect(screen.queryByText('datasetPipeline.operations.exportPipeline')).not.toBeInTheDocument()
  })

  it('should invoke menu callbacks when actions are clicked', async () => {
    const user = userEvent.setup()
    const openRenameModal = vi.fn()
    const handleExportPipeline = vi.fn()
    const detectIsUsedByApp = vi.fn()

    render(
      <Menu
        showDelete
        openRenameModal={openRenameModal}
        handleExportPipeline={handleExportPipeline}
        detectIsUsedByApp={detectIsUsedByApp}
      />,
    )

    await user.click(screen.getByText('common.operation.edit'))
    await user.click(screen.getByText('datasetPipeline.operations.exportPipeline'))
    await user.click(screen.getByText('common.operation.delete'))

    expect(openRenameModal).toHaveBeenCalledTimes(1)
    expect(handleExportPipeline).toHaveBeenCalledTimes(1)
    expect(detectIsUsedByApp).toHaveBeenCalledTimes(1)
  })
})

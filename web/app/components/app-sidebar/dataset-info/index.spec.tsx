import type { DataSet } from '@/models/datasets'
import { RiEditLine } from '@remixicon/react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import {
  ChunkingMode,
  DatasetPermission,
  DataSourceType,
} from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import Dropdown from './dropdown'
import DatasetInfo from './index'
import Menu from './menu'
import MenuItem from './menu-item'

let mockDataset: DataSet
let mockIsDatasetOperator = false
const mockReplace = vi.fn()
const mockInvalidDatasetList = vi.fn()
const mockInvalidDatasetDetail = vi.fn()
const mockExportPipeline = vi.fn()
const mockCheckIsUsedInApp = vi.fn()
const mockDeleteDataset = vi.fn()

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

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
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

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: () => 'indexing-technique',
  }),
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

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen.getByRole('button')
  await user.click(trigger)
}

describe('DatasetInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createDataset()
    mockIsDatasetOperator = false
  })

  // Rendering of dataset summary details based on expand and dataset state.
  describe('Rendering', () => {
    it('should show dataset details when expanded', () => {
      // Arrange
      mockDataset = createDataset({ is_published: true })
      render(<DatasetInfo expand />)

      // Assert
      expect(screen.getByText('Dataset Name')).toBeInTheDocument()
      expect(screen.getByText('Dataset description')).toBeInTheDocument()
      expect(screen.getByText('dataset.chunkingMode.general')).toBeInTheDocument()
      expect(screen.getByText('indexing-technique')).toBeInTheDocument()
    })

    it('should show external tag when provider is external', () => {
      // Arrange
      mockDataset = createDataset({ provider: 'external', is_published: false })
      render(<DatasetInfo expand />)

      // Assert
      expect(screen.getByText('dataset.externalTag')).toBeInTheDocument()
      expect(screen.queryByText('dataset.chunkingMode.general')).not.toBeInTheDocument()
    })

    it('should hide detailed fields when collapsed', () => {
      // Arrange
      render(<DatasetInfo expand={false} />)

      // Assert
      expect(screen.queryByText('Dataset Name')).not.toBeInTheDocument()
      expect(screen.queryByText('Dataset description')).not.toBeInTheDocument()
    })
  })
})

describe('MenuItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Event handling for menu item interactions.
  describe('Interactions', () => {
    it('should call handler when clicked', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()
      // Arrange
      render(<MenuItem name="Edit" Icon={RiEditLine} handleClick={handleClick} />)

      // Act
      await user.click(screen.getByText('Edit'))

      // Assert
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })
})

describe('Menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createDataset()
  })

  // Rendering of menu options based on runtime mode and delete visibility.
  describe('Rendering', () => {
    it('should show edit, export, and delete options when rag pipeline and deletable', () => {
      // Arrange
      mockDataset = createDataset({ runtime_mode: 'rag_pipeline' })
      render(
        <Menu
          showDelete
          openRenameModal={vi.fn()}
          handleExportPipeline={vi.fn()}
          detectIsUsedByApp={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('common.operation.edit')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.operations.exportPipeline')).toBeInTheDocument()
      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
    })

    it('should hide export and delete options when not rag pipeline and not deletable', () => {
      // Arrange
      mockDataset = createDataset({ runtime_mode: 'general' })
      render(
        <Menu
          showDelete={false}
          openRenameModal={vi.fn()}
          handleExportPipeline={vi.fn()}
          detectIsUsedByApp={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('common.operation.edit')).toBeInTheDocument()
      expect(screen.queryByText('datasetPipeline.operations.exportPipeline')).not.toBeInTheDocument()
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })
  })
})

describe('Dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createDataset({ pipeline_id: 'pipeline-1', runtime_mode: 'rag_pipeline' })
    mockIsDatasetOperator = false
    mockExportPipeline.mockResolvedValue({ data: 'pipeline-content' })
    mockCheckIsUsedInApp.mockResolvedValue({ is_using: false })
    mockDeleteDataset.mockResolvedValue({})
    if (!('createObjectURL' in URL)) {
      Object.defineProperty(URL, 'createObjectURL', {
        value: vi.fn(),
        writable: true,
      })
    }
    if (!('revokeObjectURL' in URL)) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        value: vi.fn(),
        writable: true,
      })
    }
  })

  // Rendering behavior based on workspace role.
  describe('Rendering', () => {
    it('should hide delete option when user is dataset operator', async () => {
      const user = userEvent.setup()
      // Arrange
      mockIsDatasetOperator = true
      render(<Dropdown expand />)

      // Act
      await openMenu(user)

      // Assert
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })
  })

  // User interactions that trigger modals and exports.
  describe('Interactions', () => {
    it('should open rename modal when edit is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      render(<Dropdown expand />)

      // Act
      await openMenu(user)
      await user.click(screen.getByText('common.operation.edit'))

      // Assert
      expect(screen.getByTestId('rename-modal')).toBeInTheDocument()
    })

    it('should export pipeline when export is clicked', async () => {
      const user = userEvent.setup()
      const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL')
      // Arrange
      render(<Dropdown expand />)

      // Act
      await openMenu(user)
      await user.click(screen.getByText('datasetPipeline.operations.exportPipeline'))

      // Assert
      await waitFor(() => {
        expect(mockExportPipeline).toHaveBeenCalledWith({
          pipelineId: 'pipeline-1',
          include: false,
        })
      })
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
      expect(anchorClickSpy).toHaveBeenCalledTimes(1)
    })

    it('should show delete confirmation when delete is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      render(<Dropdown expand />)

      // Act
      await openMenu(user)
      await user.click(screen.getByText('common.operation.delete'))

      // Assert
      await waitFor(() => {
        expect(screen.getByText('dataset.deleteDatasetConfirmContent')).toBeInTheDocument()
      })
    })

    it('should delete dataset and redirect when confirm is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      render(<Dropdown expand />)

      // Act
      await openMenu(user)
      await user.click(screen.getByText('common.operation.delete'))
      await user.click(await screen.findByRole('button', { name: 'common.operation.confirm' }))

      // Assert
      await waitFor(() => {
        expect(mockDeleteDataset).toHaveBeenCalledWith('dataset-1')
      })
      expect(mockInvalidDatasetList).toHaveBeenCalledTimes(1)
      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })
  })
})

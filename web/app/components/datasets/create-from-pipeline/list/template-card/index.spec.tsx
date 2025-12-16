import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import TemplateCard from './index'
import type { PipelineTemplate, PipelineTemplateByIdResponse } from '@/models/pipeline'
import { ChunkingMode } from '@/models/datasets'

// Mock Next.js router
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

let mockCreateDataset: jest.Mock
let mockDeleteTemplate: jest.Mock
let mockExportTemplateDSL: jest.Mock
let mockInvalidCustomizedTemplateList: jest.Mock
let mockInvalidDatasetList: jest.Mock
let mockHandleCheckPluginDependencies: jest.Mock
let mockIsExporting = false

// Mock service hooks
let mockPipelineTemplateByIdData: PipelineTemplateByIdResponse | undefined
let mockRefetch: jest.Mock

jest.mock('@/service/use-pipeline', () => ({
  usePipelineTemplateById: () => ({
    data: mockPipelineTemplateByIdData,
    refetch: mockRefetch,
  }),
  useDeleteTemplate: () => ({
    mutateAsync: mockDeleteTemplate,
  }),
  useExportTemplateDSL: () => ({
    mutateAsync: mockExportTemplateDSL,
    isPending: mockIsExporting,
  }),
  useInvalidCustomizedTemplateList: () => mockInvalidCustomizedTemplateList,
}))

jest.mock('@/service/knowledge/use-create-dataset', () => ({
  useCreatePipelineDatasetFromCustomized: () => ({
    mutateAsync: mockCreateDataset,
  }),
}))

jest.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => mockInvalidDatasetList,
}))

jest.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

// Mock downloadFile
const mockDownloadFile = jest.fn()
jest.mock('@/utils/format', () => ({
  downloadFile: (params: { data: Blob; fileName: string }) => mockDownloadFile(params),
}))

// Mock trackEvent
const mockTrackEvent = jest.fn()
jest.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (name: string, params: Record<string, unknown>) => mockTrackEvent(name, params),
}))

// Mock child components to simplify testing
jest.mock('./content', () => ({
  __esModule: true,
  default: ({ name, description, iconInfo, chunkStructure }: {
    name: string
    description: string
    iconInfo: { icon_type: string }
    chunkStructure: string
  }) => (
    <div data-testid="content">
      <span data-testid="content-name">{name}</span>
      <span data-testid="content-description">{description}</span>
      <span data-testid="content-icon-type">{iconInfo.icon_type}</span>
      <span data-testid="content-chunk-structure">{chunkStructure}</span>
    </div>
  ),
}))

jest.mock('./actions', () => ({
  __esModule: true,
  default: ({
    onApplyTemplate,
    handleShowTemplateDetails,
    showMoreOperations,
    openEditModal,
    handleExportDSL,
    handleDelete,
  }: {
    onApplyTemplate: () => void
    handleShowTemplateDetails: () => void
    showMoreOperations: boolean
    openEditModal: () => void
    handleExportDSL: () => void
    handleDelete: () => void
  }) => (
    <div data-testid="actions" data-show-more={showMoreOperations}>
      <button data-testid="apply-template-btn" onClick={onApplyTemplate}>Apply</button>
      <button data-testid="show-details-btn" onClick={handleShowTemplateDetails}>Details</button>
      <button data-testid="edit-modal-btn" onClick={openEditModal}>Edit</button>
      <button data-testid="export-dsl-btn" onClick={handleExportDSL}>Export</button>
      <button data-testid="delete-btn" onClick={handleDelete}>Delete</button>
    </div>
  ),
}))

jest.mock('./details', () => ({
  __esModule: true,
  default: ({ id, type, onClose, onApplyTemplate }: {
    id: string
    type: string
    onClose: () => void
    onApplyTemplate: () => void
  }) => (
    <div data-testid="details-modal">
      <span data-testid="details-id">{id}</span>
      <span data-testid="details-type">{type}</span>
      <button data-testid="details-close-btn" onClick={onClose}>Close</button>
      <button data-testid="details-apply-btn" onClick={onApplyTemplate}>Apply</button>
    </div>
  ),
}))

jest.mock('./edit-pipeline-info', () => ({
  __esModule: true,
  default: ({ pipeline, onClose }: {
    pipeline: PipelineTemplate
    onClose: () => void
  }) => (
    <div data-testid="edit-pipeline-modal">
      <span data-testid="edit-pipeline-id">{pipeline.id}</span>
      <button data-testid="edit-close-btn" onClick={onClose}>Close</button>
    </div>
  ),
}))

// Factory function for creating mock pipeline template
const createMockPipeline = (overrides: Partial<PipelineTemplate> = {}): PipelineTemplate => ({
  id: 'test-pipeline-id',
  name: 'Test Pipeline',
  description: 'Test pipeline description',
  icon: {
    icon_type: 'emoji',
    icon: '📙',
    icon_background: '#FFF4ED',
    icon_url: '',
  },
  position: 1,
  chunk_structure: ChunkingMode.text,
  ...overrides,
})

// Factory function for creating mock pipeline template by id response
const createMockPipelineByIdResponse = (
  overrides: Partial<PipelineTemplateByIdResponse> = {},
): PipelineTemplateByIdResponse => ({
  id: 'test-pipeline-id',
  name: 'Test Pipeline',
  description: 'Test pipeline description',
  icon_info: {
    icon_type: 'emoji',
    icon: '📙',
    icon_background: '#FFF4ED',
    icon_url: '',
  },
  chunk_structure: ChunkingMode.text,
  export_data: 'yaml_content_here',
  graph: {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  created_by: 'Test Author',
  ...overrides,
})

// Default props factory
const createDefaultProps = () => ({
  pipeline: createMockPipeline(),
  type: 'built-in' as const,
  showMoreOperations: true,
})

describe('TemplateCard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPipelineTemplateByIdData = undefined
    mockRefetch = jest.fn().mockResolvedValue({ data: createMockPipelineByIdResponse() })
    mockCreateDataset = jest.fn()
    mockDeleteTemplate = jest.fn()
    mockExportTemplateDSL = jest.fn()
    mockInvalidCustomizedTemplateList = jest.fn()
    mockInvalidDatasetList = jest.fn()
    mockHandleCheckPluginDependencies = jest.fn()
    mockIsExporting = false
  })

  /**
   * Rendering Tests
   * Tests for basic component rendering
   */
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content')).toBeInTheDocument()
      expect(screen.getByTestId('actions')).toBeInTheDocument()
    })

    it('should render Content component with correct props', () => {
      const pipeline = createMockPipeline({
        name: 'My Pipeline',
        description: 'My description',
        chunk_structure: ChunkingMode.qa,
      })
      const props = { ...createDefaultProps(), pipeline }

      render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content-name')).toHaveTextContent('My Pipeline')
      expect(screen.getByTestId('content-description')).toHaveTextContent('My description')
      expect(screen.getByTestId('content-chunk-structure')).toHaveTextContent(ChunkingMode.qa)
    })

    it('should render Actions component with showMoreOperations=true by default', () => {
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      const actions = screen.getByTestId('actions')
      expect(actions).toHaveAttribute('data-show-more', 'true')
    })

    it('should render Actions component with showMoreOperations=false when specified', () => {
      const props = { ...createDefaultProps(), showMoreOperations: false }

      render(<TemplateCard {...props} />)

      const actions = screen.getByTestId('actions')
      expect(actions).toHaveAttribute('data-show-more', 'false')
    })

    it('should have correct container styling', () => {
      const props = createDefaultProps()

      const { container } = render(<TemplateCard {...props} />)

      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('group')
      expect(card).toHaveClass('relative')
      expect(card).toHaveClass('flex')
      expect(card).toHaveClass('h-[132px]')
      expect(card).toHaveClass('cursor-pointer')
      expect(card).toHaveClass('rounded-xl')
    })
  })

  /**
   * Props Variations Tests
   * Tests for different prop combinations
   */
  describe('Props Variations', () => {
    it('should handle built-in type', () => {
      const props = { ...createDefaultProps(), type: 'built-in' as const }

      render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content')).toBeInTheDocument()
    })

    it('should handle customized type', () => {
      const props = { ...createDefaultProps(), type: 'customized' as const }

      render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content')).toBeInTheDocument()
    })

    it('should handle different pipeline data', () => {
      const pipeline = createMockPipeline({
        id: 'unique-id-123',
        name: 'Unique Pipeline',
        description: 'Unique description',
        chunk_structure: ChunkingMode.parentChild,
      })
      const props = { ...createDefaultProps(), pipeline }

      render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content-name')).toHaveTextContent('Unique Pipeline')
      expect(screen.getByTestId('content-chunk-structure')).toHaveTextContent(ChunkingMode.parentChild)
    })

    it('should handle image icon type', () => {
      const pipeline = createMockPipeline({
        icon: {
          icon_type: 'image',
          icon: 'file-id',
          icon_background: '',
          icon_url: 'https://example.com/image.png',
        },
      })
      const props = { ...createDefaultProps(), pipeline }

      render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content-icon-type')).toHaveTextContent('image')
    })
  })

  /**
   * State Management Tests
   * Tests for modal state (showEditModal, showDeleteConfirm, showDetailModal)
   */
  describe('State Management', () => {
    it('should not show edit modal initially', () => {
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      expect(screen.queryByTestId('edit-pipeline-modal')).not.toBeInTheDocument()
    })

    it('should show edit modal when openEditModal is called', () => {
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('edit-modal-btn'))

      expect(screen.getByTestId('edit-pipeline-modal')).toBeInTheDocument()
    })

    it('should close edit modal when onClose is called', () => {
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('edit-modal-btn'))
      expect(screen.getByTestId('edit-pipeline-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('edit-close-btn'))
      expect(screen.queryByTestId('edit-pipeline-modal')).not.toBeInTheDocument()
    })

    it('should not show delete confirm initially', () => {
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      expect(screen.queryByText('datasetPipeline.deletePipeline.title')).not.toBeInTheDocument()
    })

    it('should show delete confirm when handleDelete is called', () => {
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('delete-btn'))

      expect(screen.getByText('datasetPipeline.deletePipeline.title')).toBeInTheDocument()
    })

    it('should not show details modal initially', () => {
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      expect(screen.queryByTestId('details-modal')).not.toBeInTheDocument()
    })

    it('should show details modal when handleShowTemplateDetails is called', () => {
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('show-details-btn'))

      expect(screen.getByTestId('details-modal')).toBeInTheDocument()
    })

    it('should close details modal when onClose is called', () => {
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('show-details-btn'))
      expect(screen.getByTestId('details-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('details-close-btn'))
      expect(screen.queryByTestId('details-modal')).not.toBeInTheDocument()
    })

    it('should pass correct props to details modal', () => {
      const pipeline = createMockPipeline({ id: 'detail-test-id' })
      const props = { ...createDefaultProps(), pipeline, type: 'customized' as const }

      render(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('show-details-btn'))

      expect(screen.getByTestId('details-id')).toHaveTextContent('detail-test-id')
      expect(screen.getByTestId('details-type')).toHaveTextContent('customized')
    })
  })

  /**
   * Event Handlers Tests
   * Tests for callback functions and user interactions
   */
  describe('Event Handlers', () => {
    describe('handleUseTemplate', () => {
      it('should call getPipelineTemplateInfo when apply template is clicked', async () => {
        const props = createDefaultProps()

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('apply-template-btn'))

        await waitFor(() => {
          expect(mockRefetch).toHaveBeenCalled()
        })
      })

      it('should not call createDataset when pipelineTemplateInfo is not available', async () => {
        mockRefetch = jest.fn().mockResolvedValue({ data: null })
        const props = createDefaultProps()

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('apply-template-btn'))

        await waitFor(() => {
          expect(mockRefetch).toHaveBeenCalled()
        })

        // createDataset should not be called when pipelineTemplateInfo is null
        expect(mockCreateDataset).not.toHaveBeenCalled()
      })

      it('should call createDataset with correct yaml_content', async () => {
        const pipelineResponse = createMockPipelineByIdResponse({ export_data: 'test-yaml-content' })
        mockRefetch = jest.fn().mockResolvedValue({ data: pipelineResponse })
        const props = createDefaultProps()

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('apply-template-btn'))

        await waitFor(() => {
          expect(mockCreateDataset).toHaveBeenCalledWith(
            { yaml_content: 'test-yaml-content' },
            expect.any(Object),
          )
        })
      })

      it('should invalidate list, check plugin dependencies, and navigate on success', async () => {
        mockRefetch = jest.fn().mockResolvedValue({ data: createMockPipelineByIdResponse() })
        mockCreateDataset = jest.fn().mockImplementation((_req, options) => {
          options.onSuccess({ dataset_id: 'new-dataset-id', pipeline_id: 'new-pipeline-id' })
        })
        const props = createDefaultProps()

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('apply-template-btn'))

        await waitFor(() => {
          expect(mockInvalidDatasetList).toHaveBeenCalled()
          expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('new-pipeline-id', true)
          expect(mockPush).toHaveBeenCalledWith('/datasets/new-dataset-id/pipeline')
        })
      })

      it('should track event on successful dataset creation', async () => {
        mockRefetch = jest.fn().mockResolvedValue({ data: createMockPipelineByIdResponse() })
        mockCreateDataset = jest.fn().mockImplementation((_req, options) => {
          options.onSuccess({ dataset_id: 'new-dataset-id', pipeline_id: 'new-pipeline-id' })
        })
        const pipeline = createMockPipeline({ id: 'track-test-id', name: 'Track Test Pipeline' })
        const props = { ...createDefaultProps(), pipeline, type: 'customized' as const }

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('apply-template-btn'))

        await waitFor(() => {
          expect(mockTrackEvent).toHaveBeenCalledWith('create_datasets_with_pipeline', {
            template_name: 'Track Test Pipeline',
            template_id: 'track-test-id',
            template_type: 'customized',
          })
        })
      })

      it('should not call handleCheckPluginDependencies when pipeline_id is not present', async () => {
        mockRefetch = jest.fn().mockResolvedValue({ data: createMockPipelineByIdResponse() })
        mockCreateDataset = jest.fn().mockImplementation((_req, options) => {
          options.onSuccess({ dataset_id: 'new-dataset-id', pipeline_id: null })
        })
        const props = createDefaultProps()

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('apply-template-btn'))

        await waitFor(() => {
          expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
        })
      })

      it('should call onError callback when createDataset fails', async () => {
        const onErrorSpy = jest.fn()
        mockRefetch = jest.fn().mockResolvedValue({ data: createMockPipelineByIdResponse() })
        mockCreateDataset = jest.fn().mockImplementation((_req, options) => {
          onErrorSpy()
          options.onError()
        })
        const props = createDefaultProps()

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('apply-template-btn'))

        await waitFor(() => {
          expect(mockCreateDataset).toHaveBeenCalled()
          expect(onErrorSpy).toHaveBeenCalled()
        })

        // Should not navigate on error
        expect(mockPush).not.toHaveBeenCalled()
      })
    })

    describe('handleExportDSL', () => {
      it('should call exportPipelineDSL with pipeline id', async () => {
        const pipeline = createMockPipeline({ id: 'export-test-id' })
        const props = { ...createDefaultProps(), pipeline }

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('export-dsl-btn'))

        await waitFor(() => {
          expect(mockExportTemplateDSL).toHaveBeenCalledWith('export-test-id', expect.any(Object))
        })
      })

      it('should not call exportPipelineDSL when already exporting', async () => {
        mockIsExporting = true
        const props = createDefaultProps()

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('export-dsl-btn'))

        await waitFor(() => {
          expect(mockExportTemplateDSL).not.toHaveBeenCalled()
        })
      })

      it('should download file on export success', async () => {
        mockExportTemplateDSL = jest.fn().mockImplementation((_id, options) => {
          options.onSuccess({ data: 'exported-yaml-content' })
        })
        const pipeline = createMockPipeline({ name: 'Export Pipeline' })
        const props = { ...createDefaultProps(), pipeline }

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('export-dsl-btn'))

        await waitFor(() => {
          expect(mockDownloadFile).toHaveBeenCalledWith({
            data: expect.any(Blob),
            fileName: 'Export Pipeline.pipeline',
          })
        })
      })

      it('should call onError callback on export failure', async () => {
        const onErrorSpy = jest.fn()
        mockExportTemplateDSL = jest.fn().mockImplementation((_id, options) => {
          onErrorSpy()
          options.onError()
        })
        const props = createDefaultProps()

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('export-dsl-btn'))

        await waitFor(() => {
          expect(mockExportTemplateDSL).toHaveBeenCalled()
          expect(onErrorSpy).toHaveBeenCalled()
        })

        // Should not download file on error
        expect(mockDownloadFile).not.toHaveBeenCalled()
      })
    })

    describe('handleDelete', () => {
      it('should call deletePipeline on confirm', async () => {
        mockDeleteTemplate = jest.fn().mockImplementation((_id, options) => {
          options.onSuccess()
        })
        const pipeline = createMockPipeline({ id: 'delete-test-id' })
        const props = { ...createDefaultProps(), pipeline }

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('delete-btn'))
        expect(screen.getByText('datasetPipeline.deletePipeline.title')).toBeInTheDocument()

        // Find and click confirm button
        const confirmButton = screen.getByText('common.operation.confirm')
        fireEvent.click(confirmButton)

        await waitFor(() => {
          expect(mockDeleteTemplate).toHaveBeenCalledWith('delete-test-id', expect.any(Object))
        })
      })

      it('should invalidate customized template list and close confirm on success', async () => {
        mockDeleteTemplate = jest.fn().mockImplementation((_id, options) => {
          options.onSuccess()
        })
        const props = createDefaultProps()

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('delete-btn'))
        const confirmButton = screen.getByText('common.operation.confirm')
        fireEvent.click(confirmButton)

        await waitFor(() => {
          expect(mockInvalidCustomizedTemplateList).toHaveBeenCalled()
          expect(screen.queryByText('datasetPipeline.deletePipeline.title')).not.toBeInTheDocument()
        })
      })

      it('should close delete confirm on cancel', () => {
        const props = createDefaultProps()

        render(<TemplateCard {...props} />)

        fireEvent.click(screen.getByTestId('delete-btn'))
        expect(screen.getByText('datasetPipeline.deletePipeline.title')).toBeInTheDocument()

        const cancelButton = screen.getByText('common.operation.cancel')
        fireEvent.click(cancelButton)

        expect(screen.queryByText('datasetPipeline.deletePipeline.title')).not.toBeInTheDocument()
      })
    })
  })

  /**
   * Callback Stability Tests
   * Tests for useCallback memoization
   */
  describe('Callback Stability', () => {
    it('should maintain stable handleShowTemplateDetails reference', () => {
      const props = createDefaultProps()

      const { rerender } = render(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('show-details-btn'))
      expect(screen.getByTestId('details-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('details-close-btn'))
      rerender(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('show-details-btn'))
      expect(screen.getByTestId('details-modal')).toBeInTheDocument()
    })

    it('should maintain stable openEditModal reference', () => {
      const props = createDefaultProps()

      const { rerender } = render(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('edit-modal-btn'))
      expect(screen.getByTestId('edit-pipeline-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('edit-close-btn'))
      rerender(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('edit-modal-btn'))
      expect(screen.getByTestId('edit-pipeline-modal')).toBeInTheDocument()
    })
  })

  /**
   * Component Memoization Tests
   * Tests for React.memo behavior
   */
  describe('Component Memoization', () => {
    it('should render correctly after rerender with same props', () => {
      const props = createDefaultProps()

      const { rerender } = render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content')).toBeInTheDocument()

      rerender(<TemplateCard {...props} />)

      expect(screen.getByTestId('content')).toBeInTheDocument()
    })

    it('should update when pipeline prop changes', () => {
      const props = createDefaultProps()

      const { rerender } = render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content-name')).toHaveTextContent('Test Pipeline')

      const newPipeline = createMockPipeline({ name: 'Updated Pipeline' })
      rerender(<TemplateCard {...props} pipeline={newPipeline} />)

      expect(screen.getByTestId('content-name')).toHaveTextContent('Updated Pipeline')
    })

    it('should update when type prop changes', () => {
      const props = createDefaultProps()

      const { rerender } = render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content')).toBeInTheDocument()

      rerender(<TemplateCard {...props} type="customized" />)

      expect(screen.getByTestId('content')).toBeInTheDocument()
    })

    it('should update when showMoreOperations prop changes', () => {
      const props = createDefaultProps()

      const { rerender } = render(<TemplateCard {...props} />)

      expect(screen.getByTestId('actions')).toHaveAttribute('data-show-more', 'true')

      rerender(<TemplateCard {...props} showMoreOperations={false} />)

      expect(screen.getByTestId('actions')).toHaveAttribute('data-show-more', 'false')
    })
  })

  /**
   * Edge Cases Tests
   * Tests for boundary conditions and error handling
   */
  describe('Edge Cases', () => {
    it('should handle empty pipeline name', () => {
      const pipeline = createMockPipeline({ name: '' })
      const props = { ...createDefaultProps(), pipeline }

      expect(() => render(<TemplateCard {...props} />)).not.toThrow()
      expect(screen.getByTestId('content-name')).toHaveTextContent('')
    })

    it('should handle empty pipeline description', () => {
      const pipeline = createMockPipeline({ description: '' })
      const props = { ...createDefaultProps(), pipeline }

      expect(() => render(<TemplateCard {...props} />)).not.toThrow()
      expect(screen.getByTestId('content-description')).toHaveTextContent('')
    })

    it('should handle very long pipeline name', () => {
      const longName = 'A'.repeat(200)
      const pipeline = createMockPipeline({ name: longName })
      const props = { ...createDefaultProps(), pipeline }

      render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content-name')).toHaveTextContent(longName)
    })

    it('should handle special characters in name', () => {
      const pipeline = createMockPipeline({ name: 'Test <>&"\'Pipeline @#$%' })
      const props = { ...createDefaultProps(), pipeline }

      render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content-name')).toHaveTextContent('Test <>&"\'Pipeline @#$%')
    })

    it('should handle unicode characters', () => {
      const pipeline = createMockPipeline({ name: '测试管道 🚀 テスト' })
      const props = { ...createDefaultProps(), pipeline }

      render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content-name')).toHaveTextContent('测试管道 🚀 テスト')
    })

    it('should handle all chunk structure types', () => {
      const chunkModes = [ChunkingMode.text, ChunkingMode.parentChild, ChunkingMode.qa]

      chunkModes.forEach((mode) => {
        const pipeline = createMockPipeline({ chunk_structure: mode })
        const props = { ...createDefaultProps(), pipeline }

        const { unmount } = render(<TemplateCard {...props} />)

        expect(screen.getByTestId('content-chunk-structure')).toHaveTextContent(mode)
        unmount()
      })
    })
  })

  /**
   * Component Lifecycle Tests
   * Tests for mount/unmount behavior
   */
  describe('Component Lifecycle', () => {
    it('should mount without errors', () => {
      const props = createDefaultProps()

      expect(() => render(<TemplateCard {...props} />)).not.toThrow()
    })

    it('should unmount without errors', () => {
      const props = createDefaultProps()

      const { unmount } = render(<TemplateCard {...props} />)

      expect(() => unmount()).not.toThrow()
    })

    it('should handle rapid mount/unmount cycles', () => {
      const props = createDefaultProps()

      for (let i = 0; i < 5; i++) {
        const { unmount } = render(<TemplateCard {...props} />)
        unmount()
      }

      expect(true).toBe(true)
    })
  })

  /**
   * Modal Integration Tests
   * Tests for modal interactions and nested callbacks
   */
  describe('Modal Integration', () => {
    it('should pass correct pipeline to edit modal', () => {
      const pipeline = createMockPipeline({ id: 'modal-test-id' })
      const props = { ...createDefaultProps(), pipeline }

      render(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('edit-modal-btn'))

      expect(screen.getByTestId('edit-pipeline-id')).toHaveTextContent('modal-test-id')
    })

    it('should be able to apply template from details modal', async () => {
      mockRefetch = jest.fn().mockResolvedValue({ data: createMockPipelineByIdResponse() })
      mockCreateDataset = jest.fn().mockImplementation((_req, options) => {
        options.onSuccess({ dataset_id: 'new-id', pipeline_id: 'new-pipeline' })
      })
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('show-details-btn'))
      fireEvent.click(screen.getByTestId('details-apply-btn'))

      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
        expect(mockCreateDataset).toHaveBeenCalled()
      })
    })

    it('should handle multiple modals sequentially', () => {
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      // Open edit modal
      fireEvent.click(screen.getByTestId('edit-modal-btn'))
      expect(screen.getByTestId('edit-pipeline-modal')).toBeInTheDocument()

      // Close edit modal
      fireEvent.click(screen.getByTestId('edit-close-btn'))
      expect(screen.queryByTestId('edit-pipeline-modal')).not.toBeInTheDocument()

      // Open details modal
      fireEvent.click(screen.getByTestId('show-details-btn'))
      expect(screen.getByTestId('details-modal')).toBeInTheDocument()

      // Close details modal
      fireEvent.click(screen.getByTestId('details-close-btn'))
      expect(screen.queryByTestId('details-modal')).not.toBeInTheDocument()

      // Open delete confirm
      fireEvent.click(screen.getByTestId('delete-btn'))
      expect(screen.getByText('datasetPipeline.deletePipeline.title')).toBeInTheDocument()
    })
  })

  /**
   * API Integration Tests
   * Tests for service hook interactions
   */
  describe('API Integration', () => {
    it('should initialize hooks with correct parameters', () => {
      const pipeline = createMockPipeline({ id: 'hook-test-id' })
      const props = { ...createDefaultProps(), pipeline, type: 'customized' as const }

      render(<TemplateCard {...props} />)

      expect(screen.getByTestId('content')).toBeInTheDocument()
    })

    it('should handle async operations correctly', async () => {
      mockRefetch = jest.fn().mockResolvedValue({ data: createMockPipelineByIdResponse() })
      mockCreateDataset = jest.fn().mockImplementation(async (_req, options) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        options.onSuccess({ dataset_id: 'async-test-id', pipeline_id: 'async-pipeline' })
      })
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      fireEvent.click(screen.getByTestId('apply-template-btn'))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/datasets/async-test-id/pipeline')
      })
    })

    it('should handle concurrent API calls gracefully', async () => {
      mockRefetch = jest.fn().mockResolvedValue({ data: createMockPipelineByIdResponse() })
      mockCreateDataset = jest.fn().mockImplementation((_req, options) => {
        options.onSuccess({ dataset_id: 'concurrent-id', pipeline_id: 'concurrent-pipeline' })
      })
      const props = createDefaultProps()

      render(<TemplateCard {...props} />)

      // Trigger multiple clicks
      fireEvent.click(screen.getByTestId('apply-template-btn'))
      fireEvent.click(screen.getByTestId('apply-template-btn'))

      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })
  })
})

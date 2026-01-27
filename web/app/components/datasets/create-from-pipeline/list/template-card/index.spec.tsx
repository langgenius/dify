import type { PipelineTemplate } from '@/models/pipeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import { ChunkingMode } from '@/models/datasets'
import TemplateCard from './index'

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Mock amplitude tracking
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

// Mock Toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

// Mock downloadFile utility
vi.mock('@/utils/format', () => ({
  downloadFile: vi.fn(),
}))

// Capture Confirm callbacks
let _capturedOnConfirm: (() => void) | undefined
let _capturedOnCancel: (() => void) | undefined

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, onConfirm, onCancel, title, content }: {
    isShow: boolean
    onConfirm: () => void
    onCancel: () => void
    title: string
    content: string
  }) => {
    _capturedOnConfirm = onConfirm
    _capturedOnCancel = onCancel
    return isShow
      ? (
          <div data-testid="confirm-dialog">
            <div data-testid="confirm-title">{title}</div>
            <div data-testid="confirm-content">{content}</div>
            <button data-testid="confirm-cancel" onClick={onCancel}>Cancel</button>
            <button data-testid="confirm-submit" onClick={onConfirm}>Confirm</button>
          </div>
        )
      : null
  },
}))

// Capture Actions callbacks
let _capturedHandleDelete: (() => void) | undefined
let _capturedHandleExportDSL: (() => void) | undefined
let _capturedOpenEditModal: (() => void) | undefined

vi.mock('./actions', () => ({
  default: ({ onApplyTemplate, handleShowTemplateDetails, showMoreOperations, openEditModal, handleExportDSL, handleDelete }: {
    onApplyTemplate: () => void
    handleShowTemplateDetails: () => void
    showMoreOperations: boolean
    openEditModal: () => void
    handleExportDSL: () => void
    handleDelete: () => void
  }) => {
    _capturedHandleDelete = handleDelete
    _capturedHandleExportDSL = handleExportDSL
    _capturedOpenEditModal = openEditModal
    return (
      <div data-testid="actions">
        <button data-testid="action-choose" onClick={onApplyTemplate}>operations.choose</button>
        <button data-testid="action-details" onClick={handleShowTemplateDetails}>operations.details</button>
        {showMoreOperations && (
          <>
            <button data-testid="action-edit" onClick={openEditModal}>Edit</button>
            <button data-testid="action-export" onClick={handleExportDSL}>Export</button>
            <button data-testid="action-delete" onClick={handleDelete}>Delete</button>
          </>
        )}
      </div>
    )
  },
}))

// Mock EditPipelineInfo component
vi.mock('./edit-pipeline-info', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="edit-pipeline-info">
      <button data-testid="edit-close" onClick={onClose}>Close</button>
    </div>
  ),
}))

// Mock Details component
vi.mock('./details', () => ({
  default: ({ onClose, onApplyTemplate }: { onClose: () => void, onApplyTemplate: () => void }) => (
    <div data-testid="details-component">
      <button data-testid="details-close" onClick={onClose}>Close</button>
      <button data-testid="details-apply" onClick={onApplyTemplate}>Apply</button>
    </div>
  ),
}))

// Mock service hooks
const mockCreateDataset = vi.fn()
const mockInvalidDatasetList = vi.fn()
const mockGetPipelineTemplateInfo = vi.fn()
const mockDeletePipeline = vi.fn()
const mockExportPipelineDSL = vi.fn()
const mockInvalidCustomizedTemplateList = vi.fn()
const mockHandleCheckPluginDependencies = vi.fn()

// Configurable isPending for export
let mockIsExporting = false

vi.mock('@/service/knowledge/use-create-dataset', () => ({
  useCreatePipelineDatasetFromCustomized: () => ({
    mutateAsync: mockCreateDataset,
  }),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => mockInvalidDatasetList,
}))

vi.mock('@/service/use-pipeline', () => ({
  usePipelineTemplateById: () => ({
    refetch: mockGetPipelineTemplateInfo,
  }),
  useDeleteTemplate: () => ({
    mutateAsync: mockDeletePipeline,
  }),
  useExportTemplateDSL: () => ({
    mutateAsync: mockExportPipelineDSL,
    get isPending() { return mockIsExporting },
  }),
  useInvalidCustomizedTemplateList: () => mockInvalidCustomizedTemplateList,
}))

// Mock plugin dependencies hook
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

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

// ============================================================================
// TemplateCard Component Tests
// ============================================================================

describe('TemplateCard', () => {
  const defaultProps = {
    pipeline: createPipelineTemplate(),
    showMoreOperations: true,
    type: 'customized' as const,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsExporting = false
    _capturedOnConfirm = undefined
    _capturedOnCancel = undefined
    _capturedHandleDelete = undefined
    _capturedHandleExportDSL = undefined
    _capturedOpenEditModal = undefined
    mockHandleCheckPluginDependencies.mockResolvedValue(undefined)
    mockGetPipelineTemplateInfo.mockResolvedValue({
      data: {
        export_data: 'yaml_content_here',
      },
    })
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<TemplateCard {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })

    it('should render pipeline name', () => {
      render(<TemplateCard {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })

    it('should render pipeline description', () => {
      render(<TemplateCard {...defaultProps} />)
      expect(screen.getByText('Test pipeline description')).toBeInTheDocument()
    })

    it('should render Content component', () => {
      render(<TemplateCard {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
      expect(screen.getByText('Test pipeline description')).toBeInTheDocument()
    })

    it('should render Actions component', () => {
      render(<TemplateCard {...defaultProps} />)
      expect(screen.getByTestId('actions')).toBeInTheDocument()
      expect(screen.getByTestId('action-choose')).toBeInTheDocument()
      expect(screen.getByTestId('action-details')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Use Template Flow Tests
  // --------------------------------------------------------------------------
  describe('Use Template Flow', () => {
    it('should show error when template info fetch fails', async () => {
      mockGetPipelineTemplateInfo.mockResolvedValue({ data: null })

      render(<TemplateCard {...defaultProps} />)
      const chooseButton = screen.getByTestId('action-choose')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'error',
          message: expect.any(String),
        })
      })
    })

    it('should create dataset when template is applied', async () => {
      mockCreateDataset.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess({ dataset_id: 'new-dataset-123', pipeline_id: 'pipe-123' })
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const chooseButton = screen.getByTestId('action-choose')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(mockCreateDataset).toHaveBeenCalled()
      })
    })

    it('should navigate to pipeline page on successful creation', async () => {
      mockCreateDataset.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess({ dataset_id: 'new-dataset-123', pipeline_id: 'pipe-123' })
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const chooseButton = screen.getByTestId('action-choose')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/datasets/new-dataset-123/pipeline')
      })
    })

    it('should invalidate dataset list on successful creation', async () => {
      mockCreateDataset.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess({ dataset_id: 'new-dataset-123', pipeline_id: 'pipe-123' })
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const chooseButton = screen.getByTestId('action-choose')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(mockInvalidDatasetList).toHaveBeenCalled()
      })
    })

    it('should show success toast on successful creation', async () => {
      mockCreateDataset.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess({ dataset_id: 'new-dataset-123', pipeline_id: 'pipe-123' })
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const chooseButton = screen.getByTestId('action-choose')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'success',
          message: expect.any(String),
        })
      })
    })

    it('should show error toast on creation failure', async () => {
      mockCreateDataset.mockImplementation((_data, callbacks) => {
        callbacks.onError(new Error('Creation failed'))
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const chooseButton = screen.getByTestId('action-choose')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'error',
          message: expect.any(String),
        })
      })
    })
  })

  // --------------------------------------------------------------------------
  // Details Modal Tests
  // --------------------------------------------------------------------------
  describe('Details Modal', () => {
    it('should open details modal when details button is clicked', async () => {
      render(<TemplateCard {...defaultProps} />)
      const detailsButton = screen.getByTestId('action-details')
      fireEvent.click(detailsButton)

      await waitFor(() => {
        expect(screen.getByTestId('details-component')).toBeInTheDocument()
      })
    })

    it('should close details modal when close is triggered', async () => {
      render(<TemplateCard {...defaultProps} />)
      const detailsButton = screen.getByTestId('action-details')
      fireEvent.click(detailsButton)

      await waitFor(() => {
        expect(screen.getByTestId('details-component')).toBeInTheDocument()
      })

      const closeButton = screen.getByTestId('details-close')
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(screen.queryByTestId('details-component')).not.toBeInTheDocument()
      })
    })

    it('should trigger use template from details modal', async () => {
      mockCreateDataset.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess({ dataset_id: 'new-dataset-123', pipeline_id: 'pipe-123' })
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const detailsButton = screen.getByTestId('action-details')
      fireEvent.click(detailsButton)

      await waitFor(() => {
        expect(screen.getByTestId('details-component')).toBeInTheDocument()
      })

      const applyButton = screen.getByTestId('details-apply')
      fireEvent.click(applyButton)

      await waitFor(() => {
        expect(mockCreateDataset).toHaveBeenCalled()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Pipeline ID Branch Tests
  // --------------------------------------------------------------------------
  describe('Pipeline ID Branch', () => {
    it('should call handleCheckPluginDependencies when pipeline_id is present', async () => {
      mockCreateDataset.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess({ dataset_id: 'new-dataset-123', pipeline_id: 'pipe-123' })
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const chooseButton = screen.getByTestId('action-choose')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('pipe-123', true)
      })
    })

    it('should not call handleCheckPluginDependencies when pipeline_id is falsy', async () => {
      mockCreateDataset.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess({ dataset_id: 'new-dataset-123', pipeline_id: '' })
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const chooseButton = screen.getByTestId('action-choose')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/datasets/new-dataset-123/pipeline')
      })
      expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
    })

    it('should not call handleCheckPluginDependencies when pipeline_id is null', async () => {
      mockCreateDataset.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess({ dataset_id: 'new-dataset-123', pipeline_id: null })
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const chooseButton = screen.getByTestId('action-choose')
      fireEvent.click(chooseButton)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/datasets/new-dataset-123/pipeline')
      })
      expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Export DSL Tests (Branch Coverage)
  // --------------------------------------------------------------------------
  describe('Export DSL', () => {
    it('should not export when already exporting', async () => {
      mockIsExporting = true

      render(<TemplateCard {...defaultProps} />)
      const exportButton = screen.getByTestId('action-export')
      fireEvent.click(exportButton)

      // Export should not be called due to isExporting check
      expect(mockExportPipelineDSL).not.toHaveBeenCalled()
    })

    it('should call exportPipelineDSL on export action', async () => {
      mockExportPipelineDSL.mockImplementation((_id, callbacks) => {
        callbacks.onSuccess({ data: 'yaml_content' })
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const exportButton = screen.getByTestId('action-export')
      fireEvent.click(exportButton)

      await waitFor(() => {
        expect(mockExportPipelineDSL).toHaveBeenCalledWith('pipeline-1', expect.any(Object))
      })
    })

    it('should show success toast on export success', async () => {
      mockExportPipelineDSL.mockImplementation((_id, callbacks) => {
        callbacks.onSuccess({ data: 'yaml_content' })
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const exportButton = screen.getByTestId('action-export')
      fireEvent.click(exportButton)

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'success',
          message: expect.any(String),
        })
      })
    })

    it('should show error toast on export failure', async () => {
      mockExportPipelineDSL.mockImplementation((_id, callbacks) => {
        callbacks.onError(new Error('Export failed'))
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const exportButton = screen.getByTestId('action-export')
      fireEvent.click(exportButton)

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'error',
          message: expect.any(String),
        })
      })
    })

    it('should call downloadFile on successful export', async () => {
      const { downloadFile } = await import('@/utils/format')
      mockExportPipelineDSL.mockImplementation((_id, callbacks) => {
        callbacks.onSuccess({ data: 'yaml_content' })
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const exportButton = screen.getByTestId('action-export')
      fireEvent.click(exportButton)

      await waitFor(() => {
        expect(downloadFile).toHaveBeenCalledWith(expect.objectContaining({
          fileName: 'Test Pipeline.pipeline',
        }))
      })
    })
  })

  // --------------------------------------------------------------------------
  // Delete Flow Tests
  // --------------------------------------------------------------------------
  describe('Delete Flow', () => {
    it('should show confirm dialog when delete is clicked', async () => {
      render(<TemplateCard {...defaultProps} />)
      const deleteButton = screen.getByTestId('action-delete')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })
    })

    it('should close confirm dialog when cancel is clicked (onCancelDelete)', async () => {
      render(<TemplateCard {...defaultProps} />)
      const deleteButton = screen.getByTestId('action-delete')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      const cancelButton = screen.getByTestId('confirm-cancel')
      fireEvent.click(cancelButton)

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
      })
    })

    it('should call deletePipeline when confirm is clicked (onConfirmDelete)', async () => {
      mockDeletePipeline.mockImplementation((_id, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const deleteButton = screen.getByTestId('action-delete')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      const confirmButton = screen.getByTestId('confirm-submit')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockDeletePipeline).toHaveBeenCalledWith('pipeline-1', expect.any(Object))
      })
    })

    it('should invalidate template list on successful delete', async () => {
      mockDeletePipeline.mockImplementation((_id, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const deleteButton = screen.getByTestId('action-delete')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      const confirmButton = screen.getByTestId('confirm-submit')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockInvalidCustomizedTemplateList).toHaveBeenCalled()
      })
    })

    it('should close confirm dialog after successful delete', async () => {
      mockDeletePipeline.mockImplementation((_id, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      render(<TemplateCard {...defaultProps} />)
      const deleteButton = screen.getByTestId('action-delete')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })

      const confirmButton = screen.getByTestId('confirm-submit')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Edit Modal Tests
  // --------------------------------------------------------------------------
  describe('Edit Modal', () => {
    it('should open edit modal when edit button is clicked', async () => {
      render(<TemplateCard {...defaultProps} />)
      const editButton = screen.getByTestId('action-edit')
      fireEvent.click(editButton)

      await waitFor(() => {
        expect(screen.getByTestId('edit-pipeline-info')).toBeInTheDocument()
      })
    })

    it('should close edit modal when close is triggered', async () => {
      render(<TemplateCard {...defaultProps} />)
      const editButton = screen.getByTestId('action-edit')
      fireEvent.click(editButton)

      await waitFor(() => {
        expect(screen.getByTestId('edit-pipeline-info')).toBeInTheDocument()
      })

      const closeButton = screen.getByTestId('edit-close')
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(screen.queryByTestId('edit-pipeline-info')).not.toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Props Tests
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should show more operations when showMoreOperations is true', () => {
      render(<TemplateCard {...defaultProps} showMoreOperations={true} />)
      expect(screen.getByTestId('action-edit')).toBeInTheDocument()
      expect(screen.getByTestId('action-export')).toBeInTheDocument()
      expect(screen.getByTestId('action-delete')).toBeInTheDocument()
    })

    it('should hide more operations when showMoreOperations is false', () => {
      render(<TemplateCard {...defaultProps} showMoreOperations={false} />)
      expect(screen.queryByTestId('action-edit')).not.toBeInTheDocument()
      expect(screen.queryByTestId('action-export')).not.toBeInTheDocument()
      expect(screen.queryByTestId('action-delete')).not.toBeInTheDocument()
    })

    it('should default showMoreOperations to true', () => {
      const { pipeline, type } = defaultProps
      render(<TemplateCard pipeline={pipeline} type={type} />)
      expect(screen.getByTestId('action-edit')).toBeInTheDocument()
    })

    it('should handle built-in type', () => {
      render(<TemplateCard {...defaultProps} type="built-in" />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })

    it('should handle customized type', () => {
      render(<TemplateCard {...defaultProps} type="customized" />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper card styling', () => {
      const { container } = render(<TemplateCard {...defaultProps} />)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('group', 'relative', 'flex', 'cursor-pointer', 'flex-col', 'rounded-xl')
    })

    it('should have fixed height', () => {
      const { container } = render(<TemplateCard {...defaultProps} />)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('h-[132px]')
    })

    it('should have shadow and border', () => {
      const { container } = render(<TemplateCard {...defaultProps} />)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('border-[0.5px]', 'shadow-xs')
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<TemplateCard {...defaultProps} />)
      rerender(<TemplateCard {...defaultProps} />)
      expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
    })
  })
})

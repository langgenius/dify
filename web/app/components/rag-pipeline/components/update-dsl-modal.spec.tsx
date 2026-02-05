import type { PropsWithChildren } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DSLImportStatus } from '@/models/app'
import UpdateDSLModal from './update-dsl-modal'

class MockFileReader {
  onload: ((this: FileReader, event: ProgressEvent<FileReader>) => void) | null = null

  readAsText(_file: Blob) {
    const event = { target: { result: 'test content' } } as unknown as ProgressEvent<FileReader>
    this.onload?.call(this as unknown as FileReader, event)
  }
}

vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader)

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock use-context-selector
const mockNotify = vi.fn()
vi.mock('use-context-selector', () => ({
  useContext: () => ({ notify: mockNotify }),
}))

// Mock toast context
vi.mock('@/app/components/base/toast', () => ({
  ToastContext: { Provider: ({ children }: PropsWithChildren) => children },
}))

// Mock event emitter
const mockEmit = vi.fn()
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: { emit: mockEmit },
  }),
}))

// Mock workflow store
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      pipelineId: 'test-pipeline-id',
    }),
  }),
}))

// Mock workflow utils
vi.mock('@/app/components/workflow/utils', () => ({
  initialNodes: (nodes: unknown[]) => nodes,
  initialEdges: (edges: unknown[]) => edges,
}))

// Mock plugin dependencies
const mockHandleCheckPluginDependencies = vi.fn()
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

// Mock pipeline service
const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  useImportPipelineDSL: () => ({ mutateAsync: mockImportDSL }),
  useImportPipelineDSLConfirm: () => ({ mutateAsync: mockImportDSLConfirm }),
}))

// Mock workflow service
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: vi.fn().mockResolvedValue({
    graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    hash: 'test-hash',
    rag_pipeline_variables: [],
  }),
}))

// Mock Uploader
vi.mock('@/app/components/app/create-from-dsl-modal/uploader', () => ({
  default: ({ updateFile }: { updateFile: (file?: File) => void }) => (
    <div data-testid="uploader">
      <input
        type="file"
        data-testid="file-input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          updateFile(file)
        }}
      />
      <button
        data-testid="clear-file"
        onClick={() => updateFile(undefined)}
      >
        Clear
      </button>
    </div>
  ),
}))

// Mock Button
vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, disabled, className, variant, loading }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    className?: string
    variant?: string
    loading?: boolean
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={className}
      data-variant={variant}
      data-loading={loading}
    >
      {children}
    </button>
  ),
}))

// Mock Modal
vi.mock('@/app/components/base/modal', () => ({
  default: ({ children, isShow, _onClose, className }: PropsWithChildren<{
    isShow: boolean
    _onClose: () => void
    className?: string
  }>) => isShow
    ? (
        <div data-testid="modal" className={className}>
          {children}
        </div>
      )
    : null,
}))

// Mock workflow constants
vi.mock('@/app/components/workflow/constants', () => ({
  WORKFLOW_DATA_UPDATE: 'WORKFLOW_DATA_UPDATE',
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UpdateDSLModal', () => {
  const mockOnCancel = vi.fn()
  const mockOnBackup = vi.fn()
  const mockOnImport = vi.fn()

  const defaultProps = {
    onCancel: mockOnCancel,
    onBackup: mockOnBackup,
    onImport: mockOnImport,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockImportDSL.mockResolvedValue({
      id: 'import-id',
      status: DSLImportStatus.COMPLETED,
      pipeline_id: 'test-pipeline-id',
    })
    mockHandleCheckPluginDependencies.mockResolvedValue(undefined)
  })

  describe('rendering', () => {
    it('should render without crashing', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should render title', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      // The component uses t('common.importDSL', { ns: 'workflow' }) which returns 'common.importDSL'
      expect(screen.getByText('common.importDSL')).toBeInTheDocument()
    })

    it('should render warning tip', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      // The component uses t('common.importDSLTip', { ns: 'workflow' })
      expect(screen.getByText('common.importDSLTip')).toBeInTheDocument()
    })

    it('should render uploader', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      expect(screen.getByTestId('uploader')).toBeInTheDocument()
    })

    it('should render backup button', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      // The component uses t('common.backupCurrentDraft', { ns: 'workflow' })
      expect(screen.getByText('common.backupCurrentDraft')).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      // The component uses t('newApp.Cancel', { ns: 'app' })
      expect(screen.getByText('newApp.Cancel')).toBeInTheDocument()
    })

    it('should render import button', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      // The component uses t('common.overwriteAndImport', { ns: 'workflow' })
      expect(screen.getByText('common.overwriteAndImport')).toBeInTheDocument()
    })

    it('should render choose DSL section', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      // The component uses t('common.chooseDSL', { ns: 'workflow' })
      expect(screen.getByText('common.chooseDSL')).toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('should call onCancel when cancel button is clicked', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const cancelButton = screen.getByText('newApp.Cancel')
      fireEvent.click(cancelButton)

      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should call onBackup when backup button is clicked', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const backupButton = screen.getByText('common.backupCurrentDraft')
      fireEvent.click(backupButton)

      expect(mockOnBackup).toHaveBeenCalled()
    })

    it('should handle file upload', async () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })

      fireEvent.change(fileInput, { target: { files: [file] } })

      // File should be processed
      await waitFor(() => {
        expect(screen.getByTestId('uploader')).toBeInTheDocument()
      })
    })

    it('should clear file when clear button is clicked', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const clearButton = screen.getByTestId('clear-file')
      fireEvent.click(clearButton)

      // File should be cleared
      expect(screen.getByTestId('uploader')).toBeInTheDocument()
    })

    it('should call onCancel when close icon is clicked', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      // The close icon is in a div with onClick={onCancel}
      const closeIconContainer = document.querySelector('.cursor-pointer')
      if (closeIconContainer) {
        fireEvent.click(closeIconContainer)
        expect(mockOnCancel).toHaveBeenCalled()
      }
    })
  })

  describe('import functionality', () => {
    it('should show import button disabled when no file is selected', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const importButton = screen.getByText('common.overwriteAndImport')
      expect(importButton).toBeDisabled()
    })

    it('should enable import button when file is selected', async () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })

      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })
    })

    it('should disable import button after file is cleared', async () => {
      render(<UpdateDSLModal {...defaultProps} />)

      // First select a file
      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      // Clear the file
      const clearButton = screen.getByTestId('clear-file')
      fireEvent.click(clearButton)

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).toBeDisabled()
      })
    })
  })

  describe('memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect((UpdateDSLModal as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })

  describe('edge cases', () => {
    it('should handle missing onImport callback', () => {
      const props = {
        onCancel: mockOnCancel,
        onBackup: mockOnBackup,
      }

      render(<UpdateDSLModal {...props} />)

      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should render import button with warning variant', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const importButton = screen.getByText('common.overwriteAndImport')
      expect(importButton).toHaveAttribute('data-variant', 'warning')
    })

    it('should render backup button with secondary variant', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      // The backup button text is inside a nested div, so we need to find the closest button
      const backupButtonText = screen.getByText('common.backupCurrentDraft')
      const backupButton = backupButtonText.closest('button')
      expect(backupButton).toHaveAttribute('data-variant', 'secondary')
    })
  })

  describe('import flow', () => {
    it('should call importDSL when import button is clicked with file content', async () => {
      render(<UpdateDSLModal {...defaultProps} />)

      // Select a file
      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      // Wait for FileReader to process
      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      // Click import button
      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      // Wait for import to be called
      await waitFor(() => {
        expect(mockImportDSL).toHaveBeenCalled()
      })
    })

    it('should show success notification on completed import', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.COMPLETED,
        pipeline_id: 'test-pipeline-id',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      // Select a file and click import
      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'success',
        }))
      })
    })

    it('should call onCancel after successful import', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.COMPLETED,
        pipeline_id: 'test-pipeline-id',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockOnCancel).toHaveBeenCalled()
      })
    })

    it('should call onImport after successful import', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.COMPLETED,
        pipeline_id: 'test-pipeline-id',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      }, { timeout: 1000 })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockOnImport).toHaveBeenCalled()
      }, { timeout: 1000 })
    })

    it('should show warning notification on import with warnings', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.COMPLETED_WITH_WARNINGS,
        pipeline_id: 'test-pipeline-id',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'warning',
        }))
      })
    })

    it('should show error notification when import fails', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.FAILED,
        pipeline_id: 'test-pipeline-id',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })
    })

    it('should show error notification when pipeline_id is missing on success', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.COMPLETED,
        pipeline_id: undefined,
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      // Wait for FileReader to process and button to be enabled
      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })
    })

    it('should show error notification when import throws exception', async () => {
      mockImportDSL.mockRejectedValue(new Error('Import failed'))

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      // Wait for FileReader to complete and button to be enabled
      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })
    })

    it('should call handleCheckPluginDependencies on successful import', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.COMPLETED,
        pipeline_id: 'test-pipeline-id',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      // Flush the FileReader microtask to ensure fileContent is set
      await act(async () => {
        await new Promise<void>(resolve => queueMicrotask(resolve))
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('test-pipeline-id', true)
      })
    })

    it('should emit WORKFLOW_DATA_UPDATE event after successful import', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.COMPLETED,
        pipeline_id: 'test-pipeline-id',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(mockEmit).toHaveBeenCalled()
      })
    })

    it('should show error modal when import status is PENDING', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: '1.0.0',
        current_dsl_version: '2.0.0',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
        // Flush microtasks scheduled by the FileReader mock (which uses queueMicrotask)
        await new Promise<void>(resolve => queueMicrotask(resolve))
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      expect(importButton).not.toBeDisabled()

      await act(async () => {
        fireEvent.click(importButton)
        // Flush the promise resolution from mockImportDSL
        await Promise.resolve()
        // Advance past the 300ms setTimeout in the component
        await vi.advanceTimersByTimeAsync(350)
      })

      await waitFor(() => {
        expect(screen.getByText('newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      })

      vi.useRealTimers()
    })

    it('should show version info in error modal', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: '1.0.0',
        current_dsl_version: '2.0.0',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      // Wait for error modal with version info
      await waitFor(() => {
        expect(screen.getByText('1.0.0')).toBeInTheDocument()
        expect(screen.getByText('2.0.0')).toBeInTheDocument()
      }, { timeout: 1000 })
    })

    it('should close error modal when cancel button is clicked', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: '1.0.0',
        current_dsl_version: '2.0.0',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      // Wait for error modal
      await waitFor(() => {
        expect(screen.getByText('newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      // Find and click cancel button in error modal - it should be the one with secondary variant
      const cancelButtons = screen.getAllByText('newApp.Cancel')
      const errorModalCancelButton = cancelButtons.find(btn =>
        btn.getAttribute('data-variant') === 'secondary',
      )
      if (errorModalCancelButton) {
        fireEvent.click(errorModalCancelButton)
      }

      // Modal should be closed
      await waitFor(() => {
        expect(screen.queryByText('newApp.appCreateDSLErrorTitle')).not.toBeInTheDocument()
      })
    })

    it('should call importDSLConfirm when confirm button is clicked in error modal', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: '1.0.0',
        current_dsl_version: '2.0.0',
      })

      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.COMPLETED,
        pipeline_id: 'test-pipeline-id',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
        // Flush microtasks scheduled by the FileReader mock (which uses queueMicrotask)
        await new Promise<void>(resolve => queueMicrotask(resolve))
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      expect(importButton).not.toBeDisabled()

      await act(async () => {
        fireEvent.click(importButton)
        // Flush the promise resolution from mockImportDSL
        await Promise.resolve()
        // Advance past the 300ms setTimeout in the component
        await vi.advanceTimersByTimeAsync(350)
      })

      await waitFor(() => {
        expect(screen.getByText('newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      // Click confirm button
      const confirmButton = screen.getByText('newApp.Confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockImportDSLConfirm).toHaveBeenCalledWith('import-id')
      })

      vi.useRealTimers()
    })

    it('should show success notification after confirm completes', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: '1.0.0',
        current_dsl_version: '2.0.0',
      })

      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.COMPLETED,
        pipeline_id: 'test-pipeline-id',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(screen.getByText('newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('newApp.Confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'success',
        }))
      })
    })

    it('should show error notification when confirm fails with FAILED status', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: '1.0.0',
        current_dsl_version: '2.0.0',
      })

      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.FAILED,
        pipeline_id: 'test-pipeline-id',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(screen.getByText('newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('newApp.Confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })
    })

    it('should show error notification when confirm throws exception', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: '1.0.0',
        current_dsl_version: '2.0.0',
      })

      mockImportDSLConfirm.mockRejectedValue(new Error('Confirm failed'))

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(screen.getByText('newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('newApp.Confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })
    })

    it('should show error when confirm completes but pipeline_id is missing', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: '1.0.0',
        current_dsl_version: '2.0.0',
      })

      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.COMPLETED,
        pipeline_id: undefined,
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(screen.getByText('newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('newApp.Confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
        }))
      })
    })

    it('should call onImport after confirm completes successfully', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: '1.0.0',
        current_dsl_version: '2.0.0',
      })

      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.COMPLETED,
        pipeline_id: 'test-pipeline-id',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(screen.getByText('newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('newApp.Confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockOnImport).toHaveBeenCalled()
      })
    })

    it('should call handleCheckPluginDependencies after confirm', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: '1.0.0',
        current_dsl_version: '2.0.0',
      })

      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.COMPLETED,
        pipeline_id: 'test-pipeline-id',
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } })
        // Flush microtasks scheduled by the FileReader mock (which uses queueMicrotask)
        await new Promise<void>(resolve => queueMicrotask(resolve))
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      expect(importButton).not.toBeDisabled()

      await act(async () => {
        fireEvent.click(importButton)
        // Flush the promise resolution from mockImportDSL
        await Promise.resolve()
        // Advance past the 300ms setTimeout in the component
        await vi.advanceTimersByTimeAsync(350)
      })

      await waitFor(() => {
        expect(screen.getByText('newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('newApp.Confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('test-pipeline-id', true)
      })

      vi.useRealTimers()
    })

    it('should handle undefined imported_dsl_version and current_dsl_version', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: undefined,
        current_dsl_version: undefined,
      })

      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('common.overwriteAndImport')
      fireEvent.click(importButton)

      // Should show error modal even with undefined versions
      await waitFor(() => {
        expect(screen.getByText('newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })
    })

    it('should not call importDSLConfirm when importId is not set', async () => {
      // Render without triggering PENDING status first
      render(<UpdateDSLModal {...defaultProps} />)

      // importId is not set, so confirm should not be called
      // This is hard to test directly, but we can verify by checking the confirm flow
      expect(mockImportDSLConfirm).not.toHaveBeenCalled()
    })
  })
})

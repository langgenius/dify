import type { PropsWithChildren } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DSLImportStatus } from '@/models/app'
import UpdateDSLModal from '../update-dsl-modal'

class MockFileReader {
  onload: ((this: FileReader, event: ProgressEvent<FileReader>) => void) | null = null

  readAsText(_file: Blob) {
    const event = { target: { result: 'test content' } } as unknown as ProgressEvent<FileReader>
    this.onload?.call(this as unknown as FileReader, event)
  }
}

vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader)

const mockNotify = vi.fn()
vi.mock('use-context-selector', () => ({
  useContext: () => ({ notify: mockNotify }),
}))

vi.mock('@/app/components/base/toast', () => ({
  ToastContext: { Provider: ({ children }: PropsWithChildren) => children },
}))

const mockEmit = vi.fn()
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: { emit: mockEmit },
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      pipelineId: 'test-pipeline-id',
    }),
  }),
}))

vi.mock('@/app/components/workflow/utils', () => ({
  initialNodes: (nodes: unknown[]) => nodes,
  initialEdges: (edges: unknown[]) => edges,
}))

const mockHandleCheckPluginDependencies = vi.fn()
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  useImportPipelineDSL: () => ({ mutateAsync: mockImportDSL }),
  useImportPipelineDSLConfirm: () => ({ mutateAsync: mockImportDSLConfirm }),
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: vi.fn().mockResolvedValue({
    graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    hash: 'test-hash',
    rag_pipeline_variables: [],
  }),
}))

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

vi.mock('@/app/components/workflow/constants', () => ({
  WORKFLOW_DATA_UPDATE: 'WORKFLOW_DATA_UPDATE',
}))

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

      expect(screen.getByText('workflow.common.importDSL')).toBeInTheDocument()
    })

    it('should render warning tip', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      expect(screen.getByText('workflow.common.importDSLTip')).toBeInTheDocument()
    })

    it('should render uploader', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      expect(screen.getByTestId('uploader')).toBeInTheDocument()
    })

    it('should render backup button', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      expect(screen.getByText('workflow.common.backupCurrentDraft')).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      expect(screen.getByText('app.newApp.Cancel')).toBeInTheDocument()
    })

    it('should render import button', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      expect(screen.getByText('workflow.common.overwriteAndImport')).toBeInTheDocument()
    })

    it('should render choose DSL section', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      expect(screen.getByText('workflow.common.chooseDSL')).toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('should call onCancel when cancel button is clicked', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const cancelButton = screen.getByText('app.newApp.Cancel')
      fireEvent.click(cancelButton)

      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should call onBackup when backup button is clicked', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const backupButton = screen.getByText('workflow.common.backupCurrentDraft')
      fireEvent.click(backupButton)

      expect(mockOnBackup).toHaveBeenCalled()
    })

    it('should handle file upload', async () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })

      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByTestId('uploader')).toBeInTheDocument()
      })
    })

    it('should clear file when clear button is clicked', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const clearButton = screen.getByTestId('clear-file')
      fireEvent.click(clearButton)

      expect(screen.getByTestId('uploader')).toBeInTheDocument()
    })

    it('should call onCancel when close icon is clicked', () => {
      render(<UpdateDSLModal {...defaultProps} />)

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

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      expect(importButton).toBeDisabled()
    })

    it('should enable import button when file is selected', async () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })

      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })
    })

    it('should disable import button after file is cleared', async () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const clearButton = screen.getByTestId('clear-file')
      fireEvent.click(clearButton)

      await waitFor(() => {
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
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

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      expect(importButton).toHaveAttribute('data-variant', 'warning')
    })

    it('should render backup button with secondary variant', () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const backupButtonText = screen.getByText('workflow.common.backupCurrentDraft')
      const backupButton = backupButtonText.closest('button')
      expect(backupButton).toHaveAttribute('data-variant', 'secondary')
    })
  })

  describe('import flow', () => {
    it('should call importDSL when import button is clicked with file content', async () => {
      render(<UpdateDSLModal {...defaultProps} />)

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      fireEvent.click(importButton)

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

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['test content'], 'test.pipeline', { type: 'text/yaml' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      }, { timeout: 1000 })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
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

      await waitFor(() => {
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
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

      await waitFor(() => {
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      await act(async () => {
        await new Promise<void>(resolve => queueMicrotask(resolve))
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
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
        await new Promise<void>(resolve => queueMicrotask(resolve))
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      expect(importButton).not.toBeDisabled()

      await act(async () => {
        fireEvent.click(importButton)
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(350)
      })

      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      fireEvent.click(importButton)

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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const cancelButtons = screen.getAllByText('app.newApp.Cancel')
      const errorModalCancelButton = cancelButtons.find(btn =>
        btn.getAttribute('data-variant') === 'secondary',
      )
      if (errorModalCancelButton) {
        fireEvent.click(errorModalCancelButton)
      }

      await waitFor(() => {
        expect(screen.queryByText('app.newApp.appCreateDSLErrorTitle')).not.toBeInTheDocument()
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
        await new Promise<void>(resolve => queueMicrotask(resolve))
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      expect(importButton).not.toBeDisabled()

      await act(async () => {
        fireEvent.click(importButton)
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(350)
      })

      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('app.newApp.Confirm')
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('app.newApp.Confirm')
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('app.newApp.Confirm')
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('app.newApp.Confirm')
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('app.newApp.Confirm')
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('app.newApp.Confirm')
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
        await new Promise<void>(resolve => queueMicrotask(resolve))
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      expect(importButton).not.toBeDisabled()

      await act(async () => {
        fireEvent.click(importButton)
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(350)
      })

      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })

      const confirmButton = screen.getByText('app.newApp.Confirm')
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
        const importButton = screen.getByText('workflow.common.overwriteAndImport')
        expect(importButton).not.toBeDisabled()
      })

      const importButton = screen.getByText('workflow.common.overwriteAndImport')
      fireEvent.click(importButton)

      await waitFor(() => {
        expect(screen.getByText('app.newApp.appCreateDSLErrorTitle')).toBeInTheDocument()
      }, { timeout: 1000 })
    })

    it('should not call importDSLConfirm when importId is not set', async () => {
      render(<UpdateDSLModal {...defaultProps} />)

      expect(mockImportDSLConfirm).not.toHaveBeenCalled()
    })
  })
})

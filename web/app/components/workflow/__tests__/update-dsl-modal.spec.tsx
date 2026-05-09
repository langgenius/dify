import type { EventEmitter } from 'ahooks/lib/useEventEmitter'
import type { EventEmitterValue } from '@/context/event-emitter'
import { toast } from '@langgenius/dify-ui/toast'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EventEmitterContext } from '@/context/event-emitter'
import { DSLImportStatus } from '@/models/app'
import UpdateDSLModal from '../update-dsl-modal'

class MockFileReader {
  onload: ((this: FileReader, event: ProgressEvent<FileReader>) => void) | null = null

  readAsText(_file: Blob) {
    const event = { target: { result: 'workflow:\n  graph:\n    nodes:\n      - data:\n          type: tool\n' } } as unknown as ProgressEvent<FileReader>
    this.onload?.call(this as unknown as FileReader, event)
  }
}

vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader)
const mockEmit = vi.fn()
const mockEmitWorkflowUpdate = vi.hoisted(() => vi.fn())

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
vi.mock('@/service/apps', () => ({
  importDSL: (payload: unknown) => mockImportDSL(payload),
  importDSLConfirm: (payload: unknown) => mockImportDSLConfirm(payload),
}))

const mockFetchWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (path: string) => mockFetchWorkflowDraft(path),
}))

vi.mock('../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    emitWorkflowUpdate: mockEmitWorkflowUpdate,
  },
}))

const mockHandleCheckPluginDependencies = vi.fn()
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: { id: string, mode: string } }) => unknown) => selector({
    appDetail: {
      id: 'app-1',
      mode: 'chat',
    },
  }),
}))

vi.mock('@/app/components/app/create-from-dsl-modal/uploader', () => ({
  default: ({ updateFile }: { updateFile: (file?: File) => void }) => (
    <input
      data-testid="dsl-file-input"
      type="file"
      onChange={event => updateFile(event.target.files?.[0])}
    />
  ),
}))

describe('UpdateDSLModal', () => {
  const mockToastError = vi.mocked(toast.error)
  const defaultProps = {
    onCancel: vi.fn(),
    onBackup: vi.fn(),
    onImport: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockFetchWorkflowDraft.mockResolvedValue({
      graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      features: {},
      hash: 'hash-1',
      conversation_variables: [],
      environment_variables: [],
    })
    mockImportDSL.mockResolvedValue({
      id: 'import-1',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-1',
    })
    mockImportDSLConfirm.mockResolvedValue({
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-1',
    })
    mockHandleCheckPluginDependencies.mockResolvedValue(undefined)
  })

  const renderModal = (props = defaultProps) => {
    const eventEmitter = { emit: mockEmit } as unknown as EventEmitter<EventEmitterValue>

    return render(
      <EventEmitterContext.Provider value={{ eventEmitter }}>
        <UpdateDSLModal {...props} />
      </EventEmitterContext.Provider>,
    )
  }

  it('should keep import disabled until a file is selected', () => {
    renderModal()

    expect(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' })).toBeDisabled()
  })

  it('should call backup handler from the warning area', () => {
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.backupCurrentDraft' }))

    expect(defaultProps.onBackup).toHaveBeenCalledTimes(1)
  })

  it('should call cancel handler when the import dialog requests close', () => {
    const onCancel = vi.fn()
    renderModal({ ...defaultProps, onCancel })

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should import a valid file and emit workflow update payload', async () => {
    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(mockImportDSL).toHaveBeenCalledWith(expect.objectContaining({
        app_id: 'app-1',
        yaml_content: expect.stringContaining('workflow:'),
      }))
    })

    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'WORKFLOW_DATA_UPDATE',
    }))
    expect(mockEmitWorkflowUpdate).toHaveBeenCalledWith('app-1')
    expect(defaultProps.onImport).toHaveBeenCalledTimes(1)
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
  })

  it('should show an error notification when import fails', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-1',
      status: DSLImportStatus.FAILED,
      app_id: 'app-1',
    })

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['invalid'], 'workflow.yml', { type: 'text/yaml' })] },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled()
    })
  })

  it('should open the version warning modal for pending imports and confirm them', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-2',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'app.newApp.Confirm' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Confirm' }))

    await waitFor(() => {
      expect(mockImportDSLConfirm).toHaveBeenCalledWith({ import_id: 'import-2' })
    })
    expect(mockEmitWorkflowUpdate).toHaveBeenCalledWith('app-1')
  })

  it('should open the pending modal after the timeout and allow dismissing it', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-5',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(mockImportDSL).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'app.newApp.Confirm' })).toBeInTheDocument()
    }, { timeout: 1000 })

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'app.newApp.Confirm' })).not.toBeInTheDocument()
    })
  })

  it('should close the pending modal when dialog requests close', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-8',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'app.newApp.Confirm' })).toBeInTheDocument()
    })

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'app.newApp.Confirm' })).not.toBeInTheDocument()
    })
  })

  it('should show an error when the selected file content is invalid for the current app mode', async () => {
    class InvalidDSLFileReader extends MockFileReader {
      override readAsText(_file: Blob) {
        const event = { target: { result: 'workflow:\n  graph:\n    nodes:\n      - data:\n          type: answer\n' } } as unknown as ProgressEvent<FileReader>
        this.onload?.call(this as unknown as FileReader, event)
      }
    }

    vi.stubGlobal('FileReader', InvalidDSLFileReader as unknown as typeof FileReader)
    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled()
    })
    expect(mockImportDSL).not.toHaveBeenCalled()

    vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader)
  })

  it('should show an error notification when import throws', async () => {
    mockImportDSL.mockRejectedValue(new Error('boom'))

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled()
    })
  })

  it('should show an error when completed import does not return an app id', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-3',
      status: DSLImportStatus.COMPLETED,
    })

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled()
    })
  })

  it('should show an error when confirming a pending import fails', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-4',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })
    mockImportDSLConfirm.mockResolvedValue({
      status: DSLImportStatus.FAILED,
    })

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'app.newApp.Confirm' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Confirm' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled()
    })
  })

  it('should show an error when confirming a pending import throws', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-6',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })
    mockImportDSLConfirm.mockRejectedValue(new Error('boom'))

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'app.newApp.Confirm' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Confirm' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled()
    })
  })

  it('should show an error when a confirmed pending import completes without an app id', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-7',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })
    mockImportDSLConfirm.mockResolvedValue({
      status: DSLImportStatus.COMPLETED,
    })

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'app.newApp.Confirm' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Confirm' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled()
    })
  })
})

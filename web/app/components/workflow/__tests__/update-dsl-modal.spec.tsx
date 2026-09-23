import type { EventEmitter } from 'ahooks/lib/useEventEmitter'
import type { ReactNode } from 'react'
import type { EventEmitterValue } from '@/context/event-emitter'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { EventEmitterContext } from '@/context/event-emitter'
import { DSLImportStatus } from '@/models/app'
import UpdateDSLModal from '../update-dsl-modal'

const mockEmit = vi.fn()
const mockEmitWorkflowUpdate = vi.hoisted(() => vi.fn())
const mockIsCollaborationConnected = vi.hoisted(() => vi.fn(() => true))
const mockReplaceGraphFromCommittedDraft = vi.hoisted(() => vi.fn((..._args: unknown[]) => true))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
vi.mock('@/service/console', () => ({
  consoleQuery: {
    apps: {
      imports: {
        post: {
          mutationOptions: (options: Record<string, unknown>) => ({
            ...options,
            mutationFn: ({ body }: { body: unknown }) => mockImportDSL(body),
          }),
        },
        byImportId: {
          confirm: {
            post: {
              mutationOptions: (options: Record<string, unknown>) => ({
                ...options,
                mutationFn: ({ params }: { params: unknown }) => mockImportDSLConfirm(params),
              }),
            },
          },
        },
      },
    },
  },
}))

const mockFetchWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (path: string) => mockFetchWorkflowDraft(path),
}))

vi.mock('../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    emitWorkflowUpdate: mockEmitWorkflowUpdate,
    isConnected: mockIsCollaborationConnected,
    replaceGraphFromCommittedDraft: mockReplaceGraphFromCommittedDraft,
  },
}))

const mockHandleCheckPluginDependencies = vi.fn()
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: { id: string; mode: string } }) => unknown) =>
    selector({
      appDetail: {
        id: 'app-1',
        mode: 'chat',
      },
    }),
}))

vi.mock('@/app/components/app/create-from-dsl-modal/uploader', () => ({
  Uploader: ({ updateFile }: { updateFile: (file?: File) => void }) => (
    <input
      data-testid="dsl-file-input"
      type="file"
      onChange={(event) => updateFile(event.target.files?.[0])}
    />
  ),
}))

function render(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
}

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
    Object.defineProperty(File.prototype, 'text', {
      configurable: true,
      value: vi
        .fn()
        .mockResolvedValue(
          'workflow:\n  graph:\n    nodes:\n      - data:\n          type: tool\n',
        ),
    })
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
    mockIsCollaborationConnected.mockReturnValue(true)
    mockReplaceGraphFromCommittedDraft.mockReturnValue(true)
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

  it('uploads an ifpkg without decoding it as YAML when overwriting a workflow', async () => {
    mockImportDSL.mockResolvedValue({ status: DSLImportStatus.COMPLETED, app_id: 'app-1' })
    render(<UpdateDSLModal {...defaultProps} />)
    const file = new File([new Uint8Array([0x50, 0x4b, 0xff])], 'workflow.IFPKG')
    fireEvent.change(screen.getByTestId('dsl-file-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))
    await waitFor(() => expect(mockImportDSL).toHaveBeenCalledWith({ file, app_id: 'app-1' }))
    await waitFor(() => expect(defaultProps.onCancel).toHaveBeenCalled())
  })

  it('should keep import disabled until a file is selected', () => {
    renderModal()

    expect(
      screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }),
    ).toBeDisabled()
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

  it('should call cancel handler when the close button is clicked', () => {
    const onCancel = vi.fn()
    renderModal({ ...defaultProps, onCancel })

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should import a valid file and emit workflow update payload', async () => {
    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(mockImportDSL).toHaveBeenCalledWith(
        expect.objectContaining({
          app_id: 'app-1',
          yaml_content: expect.stringContaining('workflow:'),
        }),
      )
    })

    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'WORKFLOW_DATA_UPDATE',
      }),
    )
    expect(mockEmitWorkflowUpdate).toHaveBeenCalledWith('app-1')
    expect(defaultProps.onImport).toHaveBeenCalledTimes(1)
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
  })

  it('commits the imported graph to collaboration before updating the canvas or other clients', async () => {
    const importedNode = {
      id: 'imported-start',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: { type: 'start', title: 'Start', desc: '' },
    }
    mockFetchWorkflowDraft.mockResolvedValueOnce({
      graph: { nodes: [importedNode], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      features: {},
      hash: 'imported-hash',
      conversation_variables: [],
      environment_variables: [],
    })
    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => expect(defaultProps.onCancel).toHaveBeenCalledTimes(1))
    const [appId, nodes, edges] = mockReplaceGraphFromCommittedDraft.mock.calls[0]!
    expect(appId).toBe('app-1')
    expect(nodes).toEqual([expect.objectContaining({ id: 'imported-start' })])
    expect(edges).toEqual([])
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'WORKFLOW_DATA_UPDATE',
        payload: expect.objectContaining({ nodes, edges, hash: 'imported-hash' }),
      }),
    )
    expect(mockReplaceGraphFromCommittedDraft.mock.invocationCallOrder[0]).toBeLessThan(
      mockEmit.mock.invocationCallOrder[0]!,
    )
    expect(mockEmit.mock.invocationCallOrder[0]).toBeLessThan(
      mockEmitWorkflowUpdate.mock.invocationCallOrder[0]!,
    )
  })

  it('updates the imported canvas when collaboration is disconnected', async () => {
    mockIsCollaborationConnected.mockReturnValue(false)
    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => expect(defaultProps.onCancel).toHaveBeenCalledTimes(1))
    expect(mockReplaceGraphFromCommittedDraft).not.toHaveBeenCalled()
    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'WORKFLOW_DATA_UPDATE' }))
  })

  it('reloads instead of showing a graph that collaboration cannot accept', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    mockReplaceGraphFromCommittedDraft.mockReturnValue(false)
    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(mockEmit).not.toHaveBeenCalled()
    expect(defaultProps.onCancel).not.toHaveBeenCalled()
    reload.mockRestore()
  })

  it('should show Agent package warnings returned by a completed import', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-with-agent-warnings',
      status: DSLImportStatus.COMPLETED_WITH_WARNINGS,
      app_id: 'app-1',
      warnings: [
        {
          code: 'agent_file_omitted',
          path: 'agent_packages.agent_1.omitted_assets',
          message: "Agent file 'brief.pdf' was not included in the portable package.",
          details: { kind: 'file', name: 'brief.pdf' },
        },
        {
          code: 'agent_tool_authorization_required',
          path: 'agent_packages.agent_1.soul.tools.dify_tools.0',
          message: "Agent tool 'web_search' requires authorization.",
          details: { tool_name: 'web_search' },
        },
      ],
    })

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith('workflow.common.importWarning', {
        description: expect.anything(),
      })
    })
  })

  it('should show an error notification when import fails', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-1',
      status: DSLImportStatus.FAILED,
      error: 'Invalid workflow package',
      app_id: 'app-1',
    })

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['invalid'], 'workflow.yml', { type: 'text/yaml' })] },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledExactlyOnceWith('workflow.common.importFailure', {
        description: 'Invalid workflow package',
      })
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

  it('should show Agent package warnings returned after confirming a pending import', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-pending-agent',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '0.8.0',
      current_dsl_version: '0.7.0',
    })
    mockImportDSLConfirm.mockResolvedValue({
      status: DSLImportStatus.COMPLETED_WITH_WARNINGS,
      app_id: 'app-1',
      warnings: [
        {
          code: 'agent_secret_required',
          path: 'agent_packages.agent_1.soul.env.secret_refs',
          message: "Agent secret 'SEARCH_TOKEN' must be configured.",
          details: { name: 'SEARCH_TOKEN' },
        },
      ],
    })

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    const confirmButton = await screen.findByRole('button', { name: 'app.newApp.Confirm' })
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith('workflow.common.importWarning', {
        description: expect.anything(),
      })
    })
  })

  it('should close the owner when cancelling a pending import', async () => {
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

    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'app.newApp.Confirm' })).toBeInTheDocument()
      },
      { timeout: 1000 },
    )

    fireEvent.click(screen.getByRole('button', { name: 'app.newApp.Cancel' }))

    await waitFor(() => {
      expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
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
      expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps a successful import successful when refreshing the draft fails', async () => {
    const user = userEvent.setup()
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    mockFetchWorkflowDraft.mockRejectedValue(new Error('Draft refresh unavailable'))
    renderModal()
    await user.upload(screen.getByTestId('dsl-file-input'), new File(['workflow'], 'workflow.yml'))
    await user.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledExactlyOnceWith('common.error', {
        description: 'Draft refresh unavailable',
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('workflow.common.importSuccess', undefined)
    expect(defaultProps.onCancel).not.toHaveBeenCalled()
    expect(mockEmitWorkflowUpdate).toHaveBeenCalledWith('app-1')
    expect(mockReplaceGraphFromCommittedDraft).not.toHaveBeenCalled()
    expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
    reload.mockRestore()
  })

  it('keeps the import pending until the committed graph has replaced the canvas', async () => {
    const user = userEvent.setup()
    let resolveDraft!: (value: unknown) => void
    mockFetchWorkflowDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDraft = resolve
      }),
    )
    renderModal()
    await user.upload(screen.getByTestId('dsl-file-input'), new File(['workflow'], 'workflow.yml'))
    const submit = screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' })
    await user.click(submit)
    await waitFor(() => expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(1))
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    await user.click(submit)
    await user.keyboard('{Escape}')
    expect(mockImportDSL).toHaveBeenCalledTimes(1)
    expect(defaultProps.onCancel).not.toHaveBeenCalled()

    await act(async () =>
      resolveDraft({ graph: { nodes: [], edges: [], viewport: {} }, features: {} }),
    )
    await waitFor(() => expect(defaultProps.onCancel).toHaveBeenCalledTimes(1))
    expect(mockEmit).toHaveBeenCalled()
  })

  it('prevents closing and duplicate confirmation while a pending import is submitted, and allows retry after failure', async () => {
    const user = userEvent.setup()
    mockImportDSL.mockResolvedValue({ id: 'pending-1', status: DSLImportStatus.PENDING })
    let resolveRequest!: (value: { status: DSLImportStatus; error?: string }) => void
    mockImportDSLConfirm.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )
    renderModal()
    await user.upload(screen.getByTestId('dsl-file-input'), new File(['workflow'], 'workflow.yml'))
    await user.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))
    const confirm = await screen.findByRole('button', { name: 'app.newApp.Confirm' })
    await user.click(confirm)
    await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'))
    await user.click(confirm)
    await user.keyboard('{Escape}')
    expect(mockImportDSLConfirm).toHaveBeenCalledTimes(1)
    expect(defaultProps.onCancel).not.toHaveBeenCalled()

    await act(async () => resolveRequest({ status: DSLImportStatus.FAILED, error: 'Retry import' }))
    await waitFor(() => expect(confirm).not.toHaveAttribute('aria-disabled', 'true'))
    await user.click(confirm)
    await waitFor(() => expect(mockImportDSLConfirm).toHaveBeenCalledTimes(2))
    expect(mockImportDSLConfirm).toHaveBeenLastCalledWith({ import_id: 'pending-1' })
    await waitFor(() => expect(defaultProps.onCancel).toHaveBeenCalledTimes(1))
  })

  it('imports the submitted file snapshot even when selection changes while reading', async () => {
    const user = userEvent.setup()
    let resolveContent!: (value: string) => void
    const file = new File(['first'], 'first.yml')
    vi.spyOn(file, 'text').mockReturnValueOnce(
      new Promise((resolve) => {
        resolveContent = resolve
      }),
    )
    renderModal()
    const input = screen.getByTestId('dsl-file-input')
    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))
    expect(mockImportDSL).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { files: [new File(['second'], 'second.yml')] } })
    await act(async () => resolveContent('workflow: { graph: { nodes: [] } }'))
    await waitFor(() =>
      expect(mockImportDSL).toHaveBeenCalledExactlyOnceWith({
        app_id: 'app-1',
        mode: 'yaml-content',
        yaml_content: 'workflow: { graph: { nodes: [] } }',
      }),
    )
  })

  it('should show an error when the selected file content is invalid for the current app mode', async () => {
    vi.mocked(File.prototype.text).mockResolvedValueOnce(
      'workflow:\n  graph:\n    nodes:\n      - data:\n          type: answer\n',
    )
    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled()
    })
    expect(mockImportDSL).not.toHaveBeenCalled()
  })

  it('should show an error notification when import throws', async () => {
    mockImportDSL.mockRejectedValue(
      Response.json({ message: 'Invalid app package' }, { status: 400 }),
    )

    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledExactlyOnceWith('workflow.common.importFailure', {
        description: 'Invalid app package',
      })
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
      error: 'Import session expired',
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
      expect(mockToastError).toHaveBeenCalledExactlyOnceWith('workflow.common.importFailure', {
        description: 'Import session expired',
      })
    })
  })

  it('should show an error when confirming a pending import throws', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-6',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })
    mockImportDSLConfirm.mockRejectedValue(
      Response.json({ message: 'Invalid app package' }, { status: 400 }),
    )

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
      expect(mockToastError).toHaveBeenCalledExactlyOnceWith('workflow.common.importFailure', {
        description: 'Invalid app package',
      })
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

import type { Import } from '@dify/contracts/api/console/apps/types.gen'
import type { EventEmitter } from 'ahooks/lib/useEventEmitter'
import type { ReactNode } from 'react'
import type { EventEmitterValue } from '@/context/event-emitter'
import type { FetchAppWorkflowDraftResponse } from '@/types/workflow'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { EventEmitterContext } from '@/context/event-emitter'
import { DSLImportStatus } from '@/models/app'
import { AppModeEnum } from '@/types/app'
import { useStore as usePluginDependenciesStore } from '../plugin-dependency/store'
import UpdateDSLModal from '../update-dsl-modal'

const mockEmit = vi.fn()
const mockBeginWorkflowReplacement = vi.hoisted(() => vi.fn())
const mockIsWorkflowReplacementCurrent = vi.hoisted(() => vi.fn())
const EventEmitterProvider = EventEmitterContext.Provider
const baseDraftResponse = {
  id: 'draft-1',
  graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  features: {},
  hash: 'hash-1',
  last_replacement_id: 'import-1',
  conversation_variables: [],
  environment_variables: [],
  rag_pipeline_variables: [],
  created_at: 0,
  created_by: { id: 'user-1', name: 'User', email: 'user@example.com' },
  updated_at: 1,
  updated_by: { id: 'user-1', name: 'User', email: 'user@example.com' },
  tool_published: false,
  version: '1',
  marked_name: '',
  marked_comment: '',
} satisfies FetchAppWorkflowDraftResponse

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
const mockCheckDependencies = vi.fn()
vi.mock('@/service/console', () => ({
  consoleQuery: {
    apps: {
      imports: {
        byAppId: {
          checkDependencies: {
            get: {
              mutationOptions: (options: Record<string, unknown>) => ({
                ...options,
                mutationFn: ({ params }: { params: unknown }) => mockCheckDependencies(params),
              }),
            },
          },
        },
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
  fetchAppWorkflowDraft: (appId: string) => mockFetchWorkflowDraft(appId),
}))

vi.mock('../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    beginWorkflowReplacement: mockBeginWorkflowReplacement,
    isWorkflowReplacementCurrent: mockIsWorkflowReplacementCurrent,
  },
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
    appId: 'app-1',
    appMode: AppModeEnum.CHAT,
    onCancel: vi.fn(),
    onBackup: vi.fn(),
    onImport: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockBeginWorkflowReplacement.mockReturnValue(null)
    mockIsWorkflowReplacementCurrent.mockReturnValue(true)
    vi.useRealTimers()
    Object.defineProperty(File.prototype, 'text', {
      configurable: true,
      value: vi
        .fn()
        .mockResolvedValue(
          'workflow:\n  graph:\n    nodes:\n      - data:\n          type: tool\n',
        ),
    })
    mockFetchWorkflowDraft.mockResolvedValue(baseDraftResponse)
    mockImportDSL.mockResolvedValue({
      id: 'import-1',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-1',
    })
    mockImportDSLConfirm.mockResolvedValue({
      id: 'import-1',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-1',
    })
    mockCheckDependencies.mockResolvedValue({ leaked_dependencies: [] })
    usePluginDependenciesStore.setState({ dependencies: [] })
  })

  const renderModal = (props = defaultProps) => {
    const eventEmitter = { emit: mockEmit } as unknown as EventEmitter<EventEmitterValue>

    return render(
      <EventEmitterProvider value={{ eventEmitter }}>
        <UpdateDSLModal {...props} />
      </EventEmitterProvider>,
    )
  }

  it.each(['import', 'confirmation'] as const)(
    'does not block a new canvas when an old %s request completes after unmount',
    async (phase) => {
      const user = userEvent.setup()
      let resolveRequest!: (response: Import) => void
      const request = new Promise<Import>((resolve) => {
        resolveRequest = resolve
      })
      if (phase === 'confirmation') {
        mockImportDSL.mockResolvedValueOnce({ id: 'import-1', status: DSLImportStatus.PENDING })
        mockImportDSLConfirm.mockReturnValueOnce(request)
      } else {
        mockImportDSL.mockReturnValueOnce(request)
      }
      const first = renderModal()
      await user.upload(
        screen.getByTestId('dsl-file-input'),
        new File(['workflow'], 'workflow.ifpkg'),
      )
      await user.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))
      if (phase === 'confirmation') {
        await user.click(await screen.findByRole('button', { name: 'app.newApp.Confirm' }))
        await waitFor(() => expect(mockImportDSLConfirm).toHaveBeenCalledOnce())
      } else {
        await waitFor(() => expect(mockImportDSL).toHaveBeenCalledOnce())
      }
      first.unmount()
      renderModal()
      mockBeginWorkflowReplacement.mockReturnValue(7)

      await act(async () => {
        resolveRequest({ id: 'import-1', status: DSLImportStatus.COMPLETED, app_id: 'app-1' })
      })

      expect(mockBeginWorkflowReplacement).not.toHaveBeenCalled()
      expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
      expect(mockEmit).not.toHaveBeenCalled()
      expect(defaultProps.onImport).not.toHaveBeenCalled()
    },
  )

  it.each(['import', 'confirmation'] as const)(
    'keeps %s submission disabled until its committed draft is ready',
    async (phase) => {
      const user = userEvent.setup()
      let resolveDraft!: (draft: FetchAppWorkflowDraftResponse) => void
      mockFetchWorkflowDraft.mockReturnValueOnce(
        new Promise<FetchAppWorkflowDraftResponse>((resolve) => {
          resolveDraft = resolve
        }),
      )
      if (phase === 'confirmation')
        mockImportDSL.mockResolvedValueOnce({ id: 'import-1', status: DSLImportStatus.PENDING })
      renderModal()
      await user.upload(
        screen.getByTestId('dsl-file-input'),
        new File(['workflow'], 'workflow.ifpkg'),
      )
      await user.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))
      const button =
        phase === 'confirmation'
          ? await screen.findByRole('button', { name: 'app.newApp.Confirm' })
          : screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' })
      if (phase === 'confirmation') await user.click(button)
      await waitFor(() => expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('app-1'))

      expect(button).toHaveAttribute('aria-disabled', 'true')
      await user.click(button)
      expect(mockImportDSL).toHaveBeenCalledOnce()
      expect(mockImportDSLConfirm).toHaveBeenCalledTimes(phase === 'confirmation' ? 1 : 0)
      expect(defaultProps.onImport).not.toHaveBeenCalled()

      await act(async () => resolveDraft(baseDraftResponse))

      await waitFor(() => expect(defaultProps.onImport).toHaveBeenCalledOnce())
      expect(mockEmit).toHaveBeenCalledOnce()
    },
  )

  it('does not replace the active graph when an old import completes after its session unmounts', async () => {
    let resolveDraft!: (value: unknown) => void
    mockFetchWorkflowDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDraft = resolve
      }),
    )
    const { unmount } = renderModal()
    const file = new File(['workflow'], 'workflow.ifpkg')
    fireEvent.change(screen.getByTestId('dsl-file-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))
    await waitFor(() => expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('app-1'))
    unmount()

    await act(async () => {
      resolveDraft({ graph: { nodes: [], edges: [] }, features: {}, hash: 'old-app-hash' })
    })

    expect(mockEmit).not.toHaveBeenCalled()
    expect(defaultProps.onImport).not.toHaveBeenCalled()
    expect(defaultProps.onCancel).not.toHaveBeenCalled()
  })

  it('does not replace dependency UI when an old import finishes after a new modal opens', async () => {
    let resolveDependencies!: (value: { leaked_dependencies: unknown[] }) => void
    mockCheckDependencies.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDependencies = resolve
      }),
    )
    const first = renderModal()
    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.ifpkg')] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))
    await waitFor(() => expect(mockCheckDependencies).toHaveBeenCalledWith({ app_id: 'app-1' }))
    expect(mockEmit).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }),
    ).toHaveAttribute('aria-disabled', 'true')
    first.unmount()
    renderModal()
    const currentDependencies = [
      { type: 'marketplace' as const, value: { plugin: 'current-plugin' } },
    ]
    usePluginDependenciesStore.setState({ dependencies: currentDependencies })

    await act(async () =>
      resolveDependencies({
        leaked_dependencies: [{ type: 'marketplace', value: { plugin: 'old-plugin' } }],
      }),
    )

    expect(usePluginDependenciesStore.getState().dependencies).toEqual(currentDependencies)
    expect(mockEmit).toHaveBeenCalledOnce()
    expect(defaultProps.onImport).toHaveBeenCalledOnce()
    expect(defaultProps.onCancel).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledOnce()
  })

  it('does not reload the new page when an old committed draft refresh fails', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    let rejectDraft!: (reason: Error) => void
    mockFetchWorkflowDraft.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectDraft = reject
      }),
    )
    const first = renderModal()
    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.ifpkg')] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))
    await waitFor(() => expect(mockFetchWorkflowDraft).toHaveBeenCalled())
    first.unmount()
    renderModal()

    await act(async () => rejectDraft(new Error('Old draft unavailable')))

    expect(reload).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(defaultProps.onCancel).not.toHaveBeenCalled()
    reload.mockRestore()
  })

  it('applies imported dependencies and keeps dependency errors separate from import success', async () => {
    mockCheckDependencies.mockRejectedValueOnce(new Error('Dependencies unavailable'))
    renderModal()
    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.ifpkg')] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => expect(defaultProps.onCancel).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith('workflow.common.importSuccess', undefined)
    expect(toast.error).toHaveBeenCalledWith('common.error', {
      description: 'Dependencies unavailable',
    })
    expect(mockEmit).toHaveBeenCalled()
    expect(usePluginDependenciesStore.getState().dependencies).toEqual([])
  })

  it('uploads an ifpkg without decoding it as YAML when overwriting a workflow', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-1',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-1',
    })
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
        type: 'WORKFLOW_DRAFT_REPLACED',
        payload: expect.objectContaining({ appId: 'app-1' }),
      }),
    )
    expect(defaultProps.onImport).toHaveBeenCalledTimes(1)
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
  })

  it('sends the committed draft and raw features to the local canvas', async () => {
    const importedNode = {
      id: 'imported-start',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: { type: BlockEnum.Start, title: 'Start', desc: '' },
    }
    const importedDraft = {
      ...baseDraftResponse,
      graph: { nodes: [importedNode], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      features: { file_upload: { enabled: true } },
      hash: 'imported-hash',
    } satisfies FetchAppWorkflowDraftResponse
    mockFetchWorkflowDraft.mockResolvedValueOnce(importedDraft)
    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => expect(defaultProps.onCancel).toHaveBeenCalledTimes(1))
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'WORKFLOW_DRAFT_REPLACED',
        payload: expect.objectContaining({
          appId: 'app-1',
          appliedReplacementId: 'import-1',
          replacementId: 'import-1',
          draft: importedDraft,
          workflowData: expect.objectContaining({
            nodes: [expect.objectContaining({ id: 'imported-start' })],
            edges: [],
            hash: 'imported-hash',
            features: { file_upload: { enabled: true } },
          }),
        }),
      }),
    )
  })

  it('uses the latest draft when a restore follows the completed import before its GET', async () => {
    const restoredDraft = {
      ...baseDraftResponse,
      hash: 'restored-hash',
      last_replacement_id: 'restore-C',
    }
    mockFetchWorkflowDraft.mockResolvedValueOnce(restoredDraft)
    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.ifpkg')] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => expect(defaultProps.onCancel).toHaveBeenCalledOnce())
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          replacementId: 'import-1',
          appliedReplacementId: 'restore-C',
          draft: restoredDraft,
          workflowData: expect.objectContaining({ hash: 'restored-hash' }),
        }),
      }),
    )
  })

  it('claims the replacement before fetching and applies only its current token', async () => {
    mockBeginWorkflowReplacement.mockReturnValue(7)
    let resolveDraft: ((draft: unknown) => void) | undefined
    mockFetchWorkflowDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDraft = resolve
      }),
    )
    mockEmit.mockImplementationOnce(() => {
      mockIsWorkflowReplacementCurrent.mockReturnValue(false)
    })
    renderModal()
    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.ifpkg')] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))
    await waitFor(() => expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('app-1'))
    expect(mockBeginWorkflowReplacement).toHaveBeenCalledWith('app-1')

    await act(async () => {
      resolveDraft?.({
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        features: {},
        hash: 'imported-hash',
        last_replacement_id: 'import-1',
      })
    })
    await waitFor(() => expect(defaultProps.onImport).toHaveBeenCalledOnce())
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ workflowReplacementToken: 7 }),
      }),
    )
  })

  it('does not apply a delayed local import after a newer notification supersedes its token', async () => {
    mockBeginWorkflowReplacement.mockReturnValue(7)
    let resolveDraft: ((draft: unknown) => void) | undefined
    mockFetchWorkflowDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDraft = resolve
      }),
    )
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    renderModal()
    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.ifpkg')] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))
    await waitFor(() => expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('app-1'))
    mockIsWorkflowReplacementCurrent.mockReturnValue(false)

    await act(async () => {
      resolveDraft?.({
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        features: {},
        hash: 'older-import-hash',
        last_replacement_id: 'import-1',
      })
    })
    await waitFor(() => expect(defaultProps.onImport).toHaveBeenCalledOnce())
    expect(mockEmit).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    reload.mockRestore()
  })

  it('reloads instead of showing a graph that collaboration cannot accept', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    mockEmit.mockImplementationOnce(() => {
      throw new Error('Collaborative graph is not ready to apply the imported draft.')
    })
    renderModal()

    fireEvent.change(screen.getByTestId('dsl-file-input'), {
      target: { files: [new File(['workflow'], 'workflow.yml', { type: 'text/yaml' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.overwriteAndImport' }))

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(mockEmit).toHaveBeenCalledOnce()
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
    expect(mockCheckDependencies).not.toHaveBeenCalled()
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

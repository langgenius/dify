import type { WorkflowProps } from '@/app/components/workflow'
import type { SnippetDetailPayload, SnippetInputField } from '@/models/snippet'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { PipelineInputVarType } from '@/models/pipeline'
import SnippetMain from '../snippet-main'

const mockSyncInputFieldsDraft = vi.fn()
const mockCloseEditor = vi.fn()
const mockOpenEditor = vi.fn()
const mockReset = vi.fn()
const mockSetFields = vi.fn()
const mockSetInputPanelOpen = vi.fn()
const mockSetPublishMenuOpen = vi.fn()
const mockToggleInputPanel = vi.fn()
const mockTogglePublishMenu = vi.fn()
const mockPublishSnippetMutateAsync = vi.fn()
const mockFetchInspectVars = vi.fn()
const mockHandleBackupDraft = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()
const mockHandleRestoreFromPublishedWorkflow = vi.fn()
const mockHandleRun = vi.fn()
const mockHandleStartWorkflowRun = vi.fn()
const mockHandleStopRun = vi.fn()
const mockHandleWorkflowStartRunInWorkflow = vi.fn()
const mockHandleCheckBeforePublish = vi.fn()
const mockInspectVarsCrud = {
  hasNodeInspectVars: vi.fn(),
  hasSetInspectVar: vi.fn(),
  fetchInspectVarValue: vi.fn(),
  editInspectVarValue: vi.fn(),
  renameInspectVarName: vi.fn(),
  appendNodeInspectVars: vi.fn(),
  deleteInspectVar: vi.fn(),
  deleteNodeInspectorVars: vi.fn(),
  deleteAllInspectorVars: vi.fn(),
  isInspectVarEdited: vi.fn(),
  resetToLastRunVar: vi.fn(),
  invalidateSysVarValues: vi.fn(),
  resetConversationVar: vi.fn(),
  invalidateConversationVarValues: vi.fn(),
}
let capturedHooksStore: Record<string, unknown> | undefined
let snippetDetailStoreState: {
  editingField: SnippetInputField | null
  fields: SnippetInputField[]
  isEditorOpen: boolean
  isInputPanelOpen: boolean
  isPublishMenuOpen: boolean
  closeEditor: typeof mockCloseEditor
  openEditor: typeof mockOpenEditor
  reset: typeof mockReset
  setFields: typeof mockSetFields
  setInputPanelOpen: typeof mockSetInputPanelOpen
  setPublishMenuOpen: typeof mockSetPublishMenuOpen
  toggleInputPanel: typeof mockToggleInputPanel
  togglePublishMenu: typeof mockTogglePublishMenu
}

vi.mock('@/app/components/snippets/store', () => ({
  useSnippetDetailStore: (selector: (state: typeof snippetDetailStoreState) => unknown) => selector(snippetDetailStoreState),
}))

vi.mock('@/service/use-snippet-workflows', () => ({
  usePublishSnippetWorkflowMutation: () => ({
    mutateAsync: mockPublishSnippetMutateAsync,
    isPending: false,
  }),
}))

vi.mock('@/app/components/snippets/hooks/use-configs-map', () => ({
  useConfigsMap: () => ({
    flowId: 'snippet-1',
    flowType: 'snippet',
    fileSettings: {},
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({
    fetchInspectVars: mockFetchInspectVars,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-checklist', () => ({
  useChecklistBeforePublish: () => ({
    handleCheckBeforePublish: mockHandleCheckBeforePublish,
  }),
}))

vi.mock('@/app/components/snippets/hooks/use-inspect-vars-crud', () => ({
  useInspectVarsCrud: () => mockInspectVarsCrud,
}))

vi.mock('@/app/components/snippets/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: vi.fn(),
    syncInputFieldsDraft: mockSyncInputFieldsDraft,
    syncWorkflowDraftWhenPageClose: vi.fn(),
  }),
}))

vi.mock('@/app/components/snippets/hooks/use-snippet-refresh-draft', () => ({
  useSnippetRefreshDraft: () => ({
    handleRefreshWorkflowDraft: vi.fn(),
  }),
}))

vi.mock('@/app/components/snippets/hooks/use-snippet-run', () => ({
  useSnippetRun: () => ({
    handleBackupDraft: mockHandleBackupDraft,
    handleLoadBackupDraft: mockHandleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow: mockHandleRestoreFromPublishedWorkflow,
    handleRun: mockHandleRun,
    handleStopRun: mockHandleStopRun,
  }),
}))

vi.mock('@/app/components/snippets/hooks/use-snippet-start-run', () => ({
  useSnippetStartRun: () => ({
    handleStartWorkflowRun: mockHandleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow: mockHandleWorkflowStartRunInWorkflow,
  }),
}))

vi.mock('@/app/components/workflow', () => ({
  WorkflowWithInnerContext: ({
    children,
    hooksStore,
  }: {
    children: React.ReactNode
    hooksStore?: Record<string, unknown>
  }) => {
    capturedHooksStore = hooksStore

    return (
      <div data-testid="workflow-inner-context">{children}</div>
    )
  },
}))

vi.mock('@/app/components/snippets/components/snippet-children', () => ({
  default: ({
    onRemoveField,
    onPublish,
    onSubmitField,
  }: {
    onRemoveField: (index: number) => void
    onPublish: () => void
    onSubmitField: (field: SnippetInputField) => void
  }) => (
    <div>
      <button type="button" onClick={() => onRemoveField(0)}>remove</button>
      <button type="button" onClick={onPublish}>publish</button>
      <button
        type="button"
        onClick={() => onSubmitField({
          type: PipelineInputVarType.textInput,
          label: 'New Field',
          variable: 'new_field',
          required: true,
        })}
      >
        submit
      </button>
    </div>
  ),
}))

const payload: SnippetDetailPayload = {
  snippet: {
    id: 'snippet-1',
    name: 'Snippet',
    description: 'desc',
    updatedAt: '2026-03-29 10:00',
    usage: '0',
    icon: '',
    iconBackground: '',
  },
  graph: {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  inputFields: [
    {
      type: PipelineInputVarType.textInput,
      label: 'Blog URL',
      variable: 'blog_url',
      required: true,
    },
  ],
  uiMeta: {
    inputFieldCount: 1,
    checklistCount: 0,
    autoSavedAt: '2026-03-29 10:00',
  },
}

const renderSnippetMain = () => {
  return renderWorkflowComponent(
    <SnippetMain
      payload={payload}
      snippetId="snippet-1"
      nodes={[] as WorkflowProps['nodes']}
      edges={[] as WorkflowProps['edges']}
      viewport={{ x: 0, y: 0, zoom: 1 }}
    />,
  )
}

describe('SnippetMain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncInputFieldsDraft.mockResolvedValue(undefined)
    mockPublishSnippetMutateAsync.mockResolvedValue({ created_at: 1_744_000_000 })
    mockHandleCheckBeforePublish.mockResolvedValue(true)
    capturedHooksStore = undefined
    snippetDetailStoreState = {
      editingField: null,
      fields: [...payload.inputFields],
      isEditorOpen: false,
      isInputPanelOpen: true,
      isPublishMenuOpen: false,
      closeEditor: mockCloseEditor,
      openEditor: mockOpenEditor,
      reset: mockReset,
      setFields: mockSetFields,
      setInputPanelOpen: mockSetInputPanelOpen,
      setPublishMenuOpen: mockSetPublishMenuOpen,
      toggleInputPanel: mockToggleInputPanel,
      togglePublishMenu: mockTogglePublishMenu,
    }
  })

  describe('Input Fields Sync', () => {
    it('should sync draft input_fields when removing a field from the panel', async () => {
      renderSnippetMain()

      fireEvent.click(screen.getByRole('button', { name: 'remove' }))

      await waitFor(() => {
        expect(mockSyncInputFieldsDraft).toHaveBeenCalledWith([], {
          onRefresh: expect.any(Function),
        })
      })
    })

    it('should sync draft input_fields when submitting a field from the editor', async () => {
      renderSnippetMain()

      fireEvent.click(screen.getByRole('button', { name: 'submit' }))

      await waitFor(() => {
        expect(mockSyncInputFieldsDraft).toHaveBeenCalledWith([
          payload.inputFields[0],
          {
            type: PipelineInputVarType.textInput,
            label: 'New Field',
            variable: 'new_field',
            required: true,
          },
        ], {
          onRefresh: expect.any(Function),
        })
      })
    })
  })

  describe('Publish', () => {
    it('should call the publish mutation and close the publish menu', async () => {
      renderSnippetMain()

      fireEvent.click(screen.getByRole('button', { name: 'publish' }))

      await waitFor(() => {
        expect(mockPublishSnippetMutateAsync).toHaveBeenCalledWith({
          params: { snippetId: 'snippet-1' },
        })
      })
      expect(mockSetPublishMenuOpen).toHaveBeenCalledWith(false)
    })
  })

  describe('Inspect Vars', () => {
    it('should pass inspect vars handlers to WorkflowWithInnerContext', () => {
      renderSnippetMain()

      expect(capturedHooksStore?.fetchInspectVars).toBe(mockFetchInspectVars)
      expect(capturedHooksStore?.hasNodeInspectVars).toBe(mockInspectVarsCrud.hasNodeInspectVars)
      expect(capturedHooksStore?.hasSetInspectVar).toBe(mockInspectVarsCrud.hasSetInspectVar)
      expect(capturedHooksStore?.fetchInspectVarValue).toBe(mockInspectVarsCrud.fetchInspectVarValue)
      expect(capturedHooksStore?.editInspectVarValue).toBe(mockInspectVarsCrud.editInspectVarValue)
      expect(capturedHooksStore?.renameInspectVarName).toBe(mockInspectVarsCrud.renameInspectVarName)
      expect(capturedHooksStore?.appendNodeInspectVars).toBe(mockInspectVarsCrud.appendNodeInspectVars)
      expect(capturedHooksStore?.deleteInspectVar).toBe(mockInspectVarsCrud.deleteInspectVar)
      expect(capturedHooksStore?.deleteNodeInspectorVars).toBe(mockInspectVarsCrud.deleteNodeInspectorVars)
      expect(capturedHooksStore?.deleteAllInspectorVars).toBe(mockInspectVarsCrud.deleteAllInspectorVars)
      expect(capturedHooksStore?.isInspectVarEdited).toBe(mockInspectVarsCrud.isInspectVarEdited)
      expect(capturedHooksStore?.resetToLastRunVar).toBe(mockInspectVarsCrud.resetToLastRunVar)
      expect(capturedHooksStore?.invalidateSysVarValues).toBe(mockInspectVarsCrud.invalidateSysVarValues)
      expect(capturedHooksStore?.resetConversationVar).toBe(mockInspectVarsCrud.resetConversationVar)
      expect(capturedHooksStore?.invalidateConversationVarValues).toBe(mockInspectVarsCrud.invalidateConversationVarValues)
    })
  })

  describe('Run Hooks', () => {
    it('should pass snippet run handlers to WorkflowWithInnerContext', () => {
      renderSnippetMain()

      expect(capturedHooksStore?.handleBackupDraft).toBe(mockHandleBackupDraft)
      expect(capturedHooksStore?.handleLoadBackupDraft).toBe(mockHandleLoadBackupDraft)
      expect(capturedHooksStore?.handleRestoreFromPublishedWorkflow).toBe(mockHandleRestoreFromPublishedWorkflow)
      expect(capturedHooksStore?.handleRun).toBe(mockHandleRun)
      expect(capturedHooksStore?.handleStopRun).toBe(mockHandleStopRun)
      expect(capturedHooksStore?.handleStartWorkflowRun).toBe(mockHandleStartWorkflowRun)
      expect(capturedHooksStore?.handleWorkflowStartRunInWorkflow).toBe(mockHandleWorkflowStartRunInWorkflow)
    })

    it('should pass snippet workflow run detail urls to WorkflowWithInnerContext', () => {
      renderSnippetMain()

      const getWorkflowRunAndTraceUrl = capturedHooksStore?.getWorkflowRunAndTraceUrl as ((runId?: string) => { runUrl: string, traceUrl: string }) | undefined

      expect(getWorkflowRunAndTraceUrl?.('run-1')).toEqual({
        runUrl: '/snippets/snippet-1/workflow-runs/run-1',
        traceUrl: '/snippets/snippet-1/workflow-runs/run-1/node-executions',
      })
    })
  })
})

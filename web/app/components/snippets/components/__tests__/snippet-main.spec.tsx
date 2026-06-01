import type { ReactNode } from 'react'
import type { WorkflowProps } from '@/app/components/workflow'
import type { SnippetDetailPayload, SnippetInputField } from '@/models/snippet'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import SnippetMain from '../snippet-main'

const mockSyncInputFieldsDraft = vi.fn()
const mockDoSyncWorkflowDraft = vi.fn()
const mockReset = vi.fn()
const mockSetFields = vi.fn()
const mockPublishSnippetMutateAsync = vi.fn()
const mockUseSnippetPublishedWorkflow = vi.fn()
const mockFetchInspectVars = vi.fn()
const mockHandleBackupDraft = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()
const mockHandleRestoreFromPublishedWorkflow = vi.fn()
const mockHandleRun = vi.fn()
const mockHandleStartWorkflowRun = vi.fn()
const mockHandleStopRun = vi.fn()
const mockHandleWorkflowStartRunInWorkflow = vi.fn()
const mockHandleCheckBeforePublish = vi.fn()
const mockPush = vi.hoisted(() => vi.fn())
const mockUseAvailableNodesMetaData = vi.hoisted(() => vi.fn())
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
let capturedWorkflowNodes: WorkflowProps['nodes'] | undefined
let snippetDetailStoreState: {
  fields: SnippetInputField[]
  reset: typeof mockReset
  setFields: typeof mockSetFields
}

vi.mock('@/app/components/snippets/store', () => ({
  useSnippetDetailStore: (selector: (state: typeof snippetDetailStoreState) => unknown) => selector(snippetDetailStoreState),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/service/use-snippet-workflows', () => ({
  usePublishSnippetWorkflowMutation: () => ({
    mutateAsync: mockPublishSnippetMutateAsync,
    isPending: false,
  }),
  useSnippetPublishedWorkflow: () => mockUseSnippetPublishedWorkflow(),
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

vi.mock('@/app/components/workflow-app/hooks', () => ({
  useAvailableNodesMetaData: () => mockUseAvailableNodesMetaData(),
}))

vi.mock('@/app/components/snippets/hooks/use-inspect-vars-crud', () => ({
  useInspectVarsCrud: () => mockInspectVarsCrud,
}))

vi.mock('@/app/components/snippets/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
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
    nodes,
  }: {
    children: ReactNode
    hooksStore?: Record<string, unknown>
    nodes?: WorkflowProps['nodes']
  }) => {
    capturedHooksStore = hooksStore
    capturedWorkflowNodes = nodes

    return (
      <div data-testid="workflow-inner-context">{children}</div>
    )
  },
}))

vi.mock('@/app/components/snippets/components/snippet-children', () => ({
  default: ({
    onCancel,
    onEdit,
    onExitEditingWithoutSave,
    onPublish,
    isEditing,
  }: {
    isEditing: boolean
    onCancel: () => void
    onEdit: () => void
    onExitEditingWithoutSave: () => void
    onPublish: () => void
  }) => (
    <div>
      {!isEditing && <button type="button" onClick={onEdit}>edit</button>}
      <a href="/snippets">snippets list</a>
      <button type="button" onClick={onExitEditingWithoutSave}>exit without save</button>
      <button type="button" onClick={onPublish}>publish</button>
      <button type="button" onClick={onCancel}>cancel</button>
    </div>
  ),
}))

vi.mock('@/app/components/snippets/components/snippet-sidebar', () => ({
  default: ({
    fields,
    onFieldsChange,
  }: {
    fields: SnippetInputField[]
    onFieldsChange: (fields: SnippetInputField[]) => void
  }) => (
    <div>
      <button type="button" onClick={() => onFieldsChange([])}>remove</button>
      <button
        type="button"
        onClick={() => onFieldsChange([
          ...fields,
          {
            type: PipelineInputVarType.textInput,
            label: 'New Field',
            variable: 'new_field',
            required: true,
          },
        ])}
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
    tags: [],
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

const renderSnippetMain = ({
  hasInitialDraftChanges = false,
}: {
  hasInitialDraftChanges?: boolean
} = {}) => {
  return renderWorkflowComponent(
    <SnippetMain
      payload={payload}
      draftPayload={payload}
      hasInitialDraftChanges={hasInitialDraftChanges}
      hasPublishedWorkflow
      snippetId="snippet-1"
      nodes={[] as WorkflowProps['nodes']}
      edges={[] as WorkflowProps['edges']}
      viewport={{ x: 0, y: 0, zoom: 1 }}
      draftNodes={[] as WorkflowProps['nodes']}
      draftEdges={[] as WorkflowProps['edges']}
      draftViewport={{ x: 0, y: 0, zoom: 1 }}
    />,
  )
}

const createNodeMetadata = (type: BlockEnum) => ({
  metaData: {
    type,
  },
  defaultValue: {},
  checkValid: vi.fn(),
})

describe('SnippetMain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    mockSyncInputFieldsDraft.mockResolvedValue(undefined)
    mockPublishSnippetMutateAsync.mockResolvedValue({ created_at: 1_744_000_000 })
    mockUseSnippetPublishedWorkflow.mockReturnValue({
      data: {
        graph: payload.graph,
        input_fields: payload.inputFields,
      },
      refetch: vi.fn(),
    })
    const llmNodeMetadata = createNodeMetadata(BlockEnum.LLM)
    const humanInputNodeMetadata = createNodeMetadata(BlockEnum.HumanInput)
    const endNodeMetadata = createNodeMetadata(BlockEnum.End)
    const knowledgeRetrievalNodeMetadata = createNodeMetadata(BlockEnum.KnowledgeRetrieval)
    mockUseAvailableNodesMetaData.mockReturnValue({
      nodes: [
        llmNodeMetadata,
        humanInputNodeMetadata,
        endNodeMetadata,
        knowledgeRetrievalNodeMetadata,
      ],
      nodesMap: {
        [BlockEnum.LLM]: llmNodeMetadata,
        [BlockEnum.HumanInput]: humanInputNodeMetadata,
        [BlockEnum.End]: endNodeMetadata,
        [BlockEnum.KnowledgeRetrieval]: knowledgeRetrievalNodeMetadata,
      },
    })
    mockHandleCheckBeforePublish.mockResolvedValue(true)
    capturedHooksStore = undefined
    capturedWorkflowNodes = undefined
    snippetDetailStoreState = {
      fields: [...payload.inputFields],
      reset: mockReset,
      setFields: mockSetFields,
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

    it('should sync draft input_fields when adding a field from the sidebar', async () => {
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

  describe('Draft Sync', () => {
    it('should sync workflow draft during normal editing changes', async () => {
      renderSnippetMain()

      const doSyncWorkflowDraft = capturedHooksStore?.doSyncWorkflowDraft as (() => Promise<void>)
      await doSyncWorkflowDraft()

      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledWith()
    })

    it('should sync workflow draft before routing without saving changes', async () => {
      renderSnippetMain({ hasInitialDraftChanges: true })

      fireEvent.click(screen.getByRole('link', { name: 'snippets list' }))
      fireEvent.click(await screen.findByRole('button', { name: 'snippet.doNotSave' }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/snippets')
      })
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledWith(true)
      expect(mockDoSyncWorkflowDraft.mock.invocationCallOrder[0]!).toBeLessThan(mockPush.mock.invocationCallOrder[0]!)
      expect(mockHandleRestoreFromPublishedWorkflow).not.toHaveBeenCalled()
      expect(mockSyncInputFieldsDraft).not.toHaveBeenCalled()
    })

    it('should sync workflow draft before exiting editing without saving changes', async () => {
      renderSnippetMain({ hasInitialDraftChanges: true })

      fireEvent.click(screen.getByRole('button', { name: 'exit without save' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'edit' })).toBeInTheDocument()
      })
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledWith(true)
      expect(mockHandleRestoreFromPublishedWorkflow).not.toHaveBeenCalled()
      expect(mockSyncInputFieldsDraft).not.toHaveBeenCalled()
    })

    it('should skip forced draft sync caused by re-entering editing mode', async () => {
      renderSnippetMain({ hasInitialDraftChanges: true })

      fireEvent.click(screen.getByRole('button', { name: 'exit without save' }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'edit' })).toBeInTheDocument()
      })
      mockDoSyncWorkflowDraft.mockClear()

      fireEvent.click(screen.getByRole('button', { name: 'edit' }))
      const doSyncWorkflowDraft = capturedHooksStore?.doSyncWorkflowDraft as ((notRefreshWhenSyncError?: boolean) => Promise<void>)
      await doSyncWorkflowDraft(true)

      expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should use latest synced draft when re-entering editing mode', async () => {
      const latestDraftNode = {
        id: 'latest-node',
        position: { x: 10, y: 20 },
        data: { type: BlockEnum.Code, title: 'Latest draft node' },
      } as WorkflowProps['nodes'][number]
      mockDoSyncWorkflowDraft.mockResolvedValueOnce({
        graph: {
          nodes: [latestDraftNode],
          edges: [],
          viewport: { x: 30, y: 40, zoom: 1.2 },
        },
        input_fields: [payload.inputFields[0]],
      })
      renderSnippetMain({ hasInitialDraftChanges: true })

      fireEvent.click(screen.getByRole('button', { name: 'exit without save' }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'edit' })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'edit' }))

      await waitFor(() => {
        expect(capturedWorkflowNodes?.map(node => node.id)).toContain('latest-node')
      })
    })
  })

  describe('Publish', () => {
    it('should call the publish mutation', async () => {
      renderSnippetMain()

      fireEvent.click(screen.getByRole('button', { name: 'publish' }))

      await waitFor(() => {
        expect(mockPublishSnippetMutateAsync).toHaveBeenCalledWith({
          params: { snippetId: 'snippet-1' },
        })
      })
    })
  })

  describe('Cancel', () => {
    it('should restore from the published workflow and reset published input fields', async () => {
      renderSnippetMain()

      fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

      await waitFor(() => {
        expect(mockHandleRestoreFromPublishedWorkflow).toHaveBeenCalledWith({
          graph: payload.graph,
          input_fields: payload.inputFields,
        })
        expect(mockSetFields).toHaveBeenCalledWith(payload.inputFields)
        expect(mockSyncInputFieldsDraft).toHaveBeenCalledWith(payload.inputFields, {
          onRefresh: expect.any(Function),
        })
      })
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

  describe('Block Selector', () => {
    it('should filter unsupported snippet block types from available node metadata', () => {
      renderSnippetMain()

      const availableNodesMetaData = capturedHooksStore?.availableNodesMetaData as {
        nodes: Array<{ metaData: { type: BlockEnum } }>
        nodesMap: Partial<Record<BlockEnum, unknown>>
      }

      expect(availableNodesMetaData.nodes.map(node => node.metaData.type)).toEqual([BlockEnum.LLM])
      expect(availableNodesMetaData.nodesMap[BlockEnum.LLM]).toBeDefined()
      expect(availableNodesMetaData.nodesMap[BlockEnum.HumanInput]).toBeUndefined()
      expect(availableNodesMetaData.nodesMap[BlockEnum.End]).toBeUndefined()
      expect(availableNodesMetaData.nodesMap[BlockEnum.KnowledgeRetrieval]).toBeUndefined()
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

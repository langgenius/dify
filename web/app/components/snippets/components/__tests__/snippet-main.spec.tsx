import type { ReactNode } from 'react'
import type { WorkflowProps } from '@/app/components/workflow'
import type { SnippetDetail, SnippetDetailPayload, SnippetInputField } from '@/models/snippet'
import { toast } from '@langgenius/dify-ui/toast'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetDraftStore } from '../../draft-store'
import SnippetMain from '../snippet-main'

const mockSyncInputFieldsDraft = vi.fn()
const mockDoSyncWorkflowDraft = vi.fn()
const mockSyncWorkflowDraftWhenPageClose = vi.fn()
const mockReset = vi.fn()
const mockSetNavigationState = vi.fn()
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
const mockUseAvailableNodesMetaData = vi.hoisted(() => vi.fn())
const mockAppContext = vi.hoisted(() => ({
  workspacePermissionKeys: ['snippets.create_and_modify'] as string[],
}))
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

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockAppContext.workspacePermissionKeys,
  }))
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockAppContext.workspacePermissionKeys,
  }))
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockAppContext.workspacePermissionKeys,
  }))
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockAppContext.workspacePermissionKeys,
  }))
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockAppContext.workspacePermissionKeys,
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

let capturedHooksStore: Record<string, unknown> | undefined
let capturedWorkflowNodes: WorkflowProps['nodes'] | undefined
let snippetDetailStoreState: {
  onFieldsChange?: (fields: SnippetInputField[]) => void
  readonly: boolean
  reset: typeof mockReset
  setNavigationState: typeof mockSetNavigationState
  snippet?: SnippetDetail
  snippetId?: string
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
    syncWorkflowDraftWhenPageClose: mockSyncWorkflowDraftWhenPageClose,
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
    onPublish,
    canSave,
    canEdit,
  }: {
    canSave: boolean
    canEdit: boolean
    onPublish: () => void
  }) => (
    <div>
      <a href="/snippets">snippets list</a>
      {canEdit && <button type="button" disabled={!canSave} onClick={onPublish}>publish</button>}
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
  hasPublishedWorkflow = false,
  currentNodes = [],
  workflowNodes = [],
  workflowDraftNodes = [],
}: {
  hasInitialDraftChanges?: boolean
  hasPublishedWorkflow?: boolean
  currentNodes?: WorkflowProps['nodes']
  workflowNodes?: WorkflowProps['nodes']
  workflowDraftNodes?: WorkflowProps['nodes']
} = {}) => {
  return renderWorkflowComponent(
    <SnippetMain
      payload={payload}
      draftPayload={payload}
      hasInitialDraftChanges={hasInitialDraftChanges}
      hasPublishedWorkflow={hasPublishedWorkflow}
      snippetId="snippet-1"
      nodes={workflowNodes}
      edges={[] as WorkflowProps['edges']}
      viewport={{ x: 0, y: 0, zoom: 1 }}
      draftNodes={workflowDraftNodes}
      draftEdges={[] as WorkflowProps['edges']}
      draftViewport={{ x: 0, y: 0, zoom: 1 }}
    />,
    {
      initialStoreState: {
        nodes: currentNodes,
      },
    },
  )
}

const createNodeMetadata = (type: BlockEnum) => ({
  metaData: {
    type,
  },
  defaultValue: {},
  checkValid: vi.fn(),
})

const createDraftNode = (id = 'draft-node') => ({
  id,
  position: { x: 10, y: 20 },
  data: { type: BlockEnum.Code, title: 'Draft node' },
}) as WorkflowProps['nodes'][number]

describe('SnippetMain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppContext.workspacePermissionKeys = ['snippets.create_and_modify']
    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    mockSyncInputFieldsDraft.mockResolvedValue(undefined)
    mockPublishSnippetMutateAsync.mockResolvedValue({ created_at: 1_744_000_000 })
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
    mockSetNavigationState.mockImplementation((state) => {
      snippetDetailStoreState = {
        ...snippetDetailStoreState,
        ...state,
      }
    })
    capturedHooksStore = undefined
    capturedWorkflowNodes = undefined
    useSnippetDraftStore.getState().reset()
    snippetDetailStoreState = {
      readonly: true,
      reset: mockReset,
      setNavigationState: mockSetNavigationState,
    }
  })

  describe('Initial Mode', () => {
    it('should render the draft graph by default when there is no published workflow', () => {
      const draftNode = createDraftNode('draft-node')

      renderSnippetMain({
        hasPublishedWorkflow: false,
        workflowDraftNodes: [draftNode],
      })

      expect(screen.queryByRole('button', { name: 'edit' })).not.toBeInTheDocument()
      expect(capturedWorkflowNodes?.map(node => node.id)).toEqual(['draft-node'])
    })

    it('should keep the snippet canvas editable and sync draft changes with create-and-modify permission', async () => {
      const draftNode = createDraftNode('draft-node')

      const { store } = renderSnippetMain({
        hasPublishedWorkflow: false,
        workflowDraftNodes: [draftNode],
      })

      expect(screen.queryByRole('button', { name: 'edit' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'publish' })).toBeInTheDocument()
      expect(store.getState().canvasReadOnly).toBe(false)
      expect(mockSetNavigationState).toHaveBeenCalledWith(expect.objectContaining({
        readonly: false,
      }))

      const doSyncWorkflowDraft = capturedHooksStore?.doSyncWorkflowDraft as (() => Promise<void>)
      await doSyncWorkflowDraft()

      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    })

    it('should make the snippet canvas readonly and skip draft sync without create-and-modify permission', async () => {
      mockAppContext.workspacePermissionKeys = ['snippets.management']

      const { store } = renderSnippetMain({
        hasPublishedWorkflow: false,
        workflowDraftNodes: [createDraftNode('draft-node')],
      })

      expect(screen.queryByRole('button', { name: 'publish' })).not.toBeInTheDocument()
      expect(store.getState().canvasReadOnly).toBe(true)
      expect(mockSetNavigationState).toHaveBeenCalledWith(expect.objectContaining({
        readonly: true,
      }))

      const doSyncWorkflowDraft = capturedHooksStore?.doSyncWorkflowDraft as (() => Promise<void>)
      await doSyncWorkflowDraft()
      const syncWorkflowDraftWhenPageClose = capturedHooksStore?.syncWorkflowDraftWhenPageClose as (() => void)
      syncWorkflowDraftWhenPageClose()
      snippetDetailStoreState.onFieldsChange?.([
        {
          type: PipelineInputVarType.textInput,
          label: 'Question',
          variable: 'question',
          required: false,
        },
      ])

      expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(mockSyncWorkflowDraftWhenPageClose).not.toHaveBeenCalled()
      expect(mockSyncInputFieldsDraft).not.toHaveBeenCalled()
    })

    it('should render the draft graph even when a published workflow exists', async () => {
      const publishedNode = createDraftNode('published-node')
      const draftNode = createDraftNode('draft-node')

      renderSnippetMain({
        hasPublishedWorkflow: true,
        workflowNodes: [publishedNode],
        workflowDraftNodes: [draftNode],
      })

      expect(screen.queryByRole('button', { name: 'edit' })).not.toBeInTheDocument()
      expect(capturedWorkflowNodes?.map(node => node.id)).toEqual(['draft-node'])

      const doSyncWorkflowDraft = capturedHooksStore?.doSyncWorkflowDraft as (() => Promise<void>)
      await doSyncWorkflowDraft()

      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    })
  })

  describe('Input Fields Sync', () => {
    it('should sync draft input_fields when removing a field from the panel', async () => {
      renderSnippetMain({ currentNodes: [createDraftNode()] })

      await waitFor(() => {
        expect(snippetDetailStoreState.onFieldsChange).toEqual(expect.any(Function))
      })
      act(() => {
        snippetDetailStoreState.onFieldsChange?.([])
      })

      await waitFor(() => {
        expect(mockSyncInputFieldsDraft).toHaveBeenCalledWith([], {
          onRefresh: expect.any(Function),
        })
      })
    })

    it('should sync draft input_fields when adding a field from the sidebar', async () => {
      renderSnippetMain({ currentNodes: [createDraftNode()] })

      await waitFor(() => {
        expect(snippetDetailStoreState.onFieldsChange).toEqual(expect.any(Function))
      })
      act(() => {
        snippetDetailStoreState.onFieldsChange?.([
          ...payload.inputFields,
          {
            type: PipelineInputVarType.textInput,
            label: 'New Field',
            variable: 'new_field',
            required: true,
          },
        ])
      })

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
      renderSnippetMain({ currentNodes: [createDraftNode()] })

      const doSyncWorkflowDraft = capturedHooksStore?.doSyncWorkflowDraft as (() => Promise<void>)
      await doSyncWorkflowDraft()

      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledWith()
    })

    it('should sync workflow draft when the page closes', () => {
      renderSnippetMain({ hasInitialDraftChanges: true })

      const syncWorkflowDraftWhenPageClose = capturedHooksStore?.syncWorkflowDraftWhenPageClose as (() => void)
      syncWorkflowDraftWhenPageClose()

      expect(mockSyncWorkflowDraftWhenPageClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Publish', () => {
    it('should call the publish mutation', async () => {
      mockDoSyncWorkflowDraft.mockResolvedValueOnce({
        graph: {
          ...payload.graph,
          nodes: [createDraftNode()],
        },
        input_fields: payload.inputFields,
      })
      renderSnippetMain({ currentNodes: [createDraftNode()] })

      fireEvent.click(screen.getByRole('button', { name: 'publish' }))

      await waitFor(() => {
        expect(mockPublishSnippetMutateAsync).toHaveBeenCalledWith({
          params: { snippetId: 'snippet-1' },
        })
      })
    })

    it('should not publish when the synced draft graph has no nodes', async () => {
      mockDoSyncWorkflowDraft.mockResolvedValueOnce({
        graph: payload.graph,
        input_fields: payload.inputFields,
      })
      renderSnippetMain({ currentNodes: [createDraftNode()] })

      fireEvent.click(screen.getByRole('button', { name: 'publish' }))

      await waitFor(() => {
        expect(mockDoSyncWorkflowDraft).toHaveBeenCalledWith(true)
      })
      expect(mockPublishSnippetMutateAsync).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('snippet.emptyGraphSaveError')
    })

    it('should disable publish when current graph has no nodes', () => {
      renderSnippetMain()

      const publishButton = screen.getByRole('button', { name: 'publish' })

      expect(publishButton).toBeDisabled()
      fireEvent.click(publishButton)
      expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(mockPublishSnippetMutateAsync).not.toHaveBeenCalled()
    })

    it('should not publish when syncing the latest draft fails', async () => {
      mockDoSyncWorkflowDraft.mockResolvedValueOnce(undefined)
      renderSnippetMain({ hasInitialDraftChanges: true, currentNodes: [createDraftNode()] })

      fireEvent.click(screen.getByRole('button', { name: 'publish' }))

      await waitFor(() => {
        expect(mockDoSyncWorkflowDraft).toHaveBeenCalledWith(true)
      })
      expect(mockPublishSnippetMutateAsync).not.toHaveBeenCalled()
    })

    it('should update local draft state with latest synced graph after publishing', async () => {
      const latestDraftNode = createDraftNode('published-draft-node')
      mockDoSyncWorkflowDraft.mockResolvedValueOnce({
        graph: {
          nodes: [latestDraftNode],
          edges: [],
          viewport: { x: 30, y: 40, zoom: 1.2 },
        },
        input_fields: [payload.inputFields[0]],
      })
      renderSnippetMain({ hasInitialDraftChanges: true, currentNodes: [createDraftNode()] })

      fireEvent.click(screen.getByRole('button', { name: 'publish' }))

      await waitFor(() => {
        expect(mockPublishSnippetMutateAsync).toHaveBeenCalled()
      })
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledWith(true)
      expect(mockDoSyncWorkflowDraft.mock.invocationCallOrder[0]!).toBeLessThan(mockPublishSnippetMutateAsync.mock.invocationCallOrder[0]!)

      await waitFor(() => {
        expect(capturedWorkflowNodes?.map(node => node.id)).toContain('published-draft-node')
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

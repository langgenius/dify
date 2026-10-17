import type { ReactNode } from 'react'
import type { WorkflowProps } from '@/app/components/workflow'
import type { SnippetDetailPayload } from '@/models/snippet'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { PipelineInputVarType } from '@/models/pipeline'
import { createDeferred } from '@/test/deferred'
import { useSnippetDraftStore } from '../../draft-store'
import { useSnippetDetailStore } from '../../store'
import SnippetMain from '../snippet-main'

const mockSyncInputFieldsDraft = vi.fn()
const mockDoSyncWorkflowDraft = vi.fn()
const mockSyncWorkflowDraftWhenPageClose = vi.fn()
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
const mockHandleExportDSL = vi.fn()
const mockUseAvailableNodesMetaData = vi.hoisted(() => vi.fn())
const mockConsoleState = vi.hoisted(() => ({
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

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
  }))
})

let capturedHooksStore: Record<string, unknown> | undefined
let capturedWorkflowNodes: WorkflowProps['nodes'] | undefined
vi.mock('../../hooks/use-file-settings', () => ({ useFileSettings: () => ({ enabled: true }) }))

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

vi.mock('@/app/components/workflow/node-catalog', () => ({
  useWorkflowNodeCatalog: () => mockUseAvailableNodesMetaData(),
}))

vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud-common', () => ({
  useInspectVarsCrudCommon: () => mockInspectVarsCrud,
}))

vi.mock('../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
    syncInputFieldsDraft: mockSyncInputFieldsDraft,
    syncWorkflowDraftWhenPageClose: mockSyncWorkflowDraftWhenPageClose,
  }),
}))

vi.mock('../../hooks/use-snippet-refresh-draft', () => ({
  useSnippetRefreshDraft: () => ({
    handleRefreshWorkflowDraft: vi.fn(),
  }),
}))

vi.mock('../../hooks/use-snippet-run', () => ({
  useSnippetRun: () => ({
    handleBackupDraft: mockHandleBackupDraft,
    handleLoadBackupDraft: mockHandleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow: mockHandleRestoreFromPublishedWorkflow,
    handleRun: mockHandleRun,
    handleStopRun: mockHandleStopRun,
  }),
}))

vi.mock('../../hooks/use-snippet-start-run', () => ({
  useSnippetStartRun: () => ({
    handleStartWorkflowRun: mockHandleStartWorkflowRun,
    handleWorkflowStartRunInWorkflow: mockHandleWorkflowStartRunInWorkflow,
  }),
}))

vi.mock('../hooks/use-snippet-dsl', () => ({
  useSnippetDSL: () => ({
    handleExportDSL: mockHandleExportDSL,
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

    return <div data-testid="workflow-inner-context">{children}</div>
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
      {canEdit && (
        <button type="button" disabled={!canSave} onClick={onPublish}>
          publish
        </button>
      )}
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
      nodes={workflowNodes}
      edges={[] as WorkflowProps['edges']}
      viewport={{ x: 0, y: 0, zoom: 1 }}
      draftNodes={workflowDraftNodes}
      draftEdges={[] as WorkflowProps['edges']}
      draftViewport={{ x: 0, y: 0, zoom: 1 }}
    />,
    {
      resource: { kind: 'snippet', snippetId: 'snippet-1' },
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

const createDraftNode = (id = 'draft-node') =>
  ({
    id,
    position: { x: 10, y: 20 },
    data: { type: BlockEnum.Code, title: 'Draft node' },
  }) as WorkflowProps['nodes'][number]

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'snippets.bySnippetId.workflows.publish.post': (...args: unknown[]) =>
        mockPublishSnippetMutateAsync(...args),
    }),
  }
})

describe('SnippetMain', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockConsoleState.workspacePermissionKeys = ['snippets.create_and_modify']
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
    capturedHooksStore = undefined
    capturedWorkflowNodes = undefined
    useSnippetDraftStore.getState().reset()
    useSnippetDetailStore.getState().reset()
  })

  describe('Initial Mode', () => {
    it('should keep the snippet canvas editable and sync draft changes with create-and-modify permission', async () => {
      const draftNode = createDraftNode('draft-node')

      const { store } = renderSnippetMain({
        hasPublishedWorkflow: false,
        workflowDraftNodes: [draftNode],
      })

      expect(screen.getByRole('button', { name: 'publish' })).toBeInTheDocument()
      expect(store.getState().canvasReadOnly).toBe(false)
      expect(capturedWorkflowNodes?.map((node) => node.id)).toEqual(['draft-node'])
      expect(useSnippetDetailStore.getState().readonly).toBe(false)

      const doSyncWorkflowDraft = capturedHooksStore?.doSyncWorkflowDraft as () => Promise<void>
      await doSyncWorkflowDraft()

      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    })

    it('should make the snippet canvas readonly and skip draft sync without create-and-modify permission', async () => {
      mockConsoleState.workspacePermissionKeys = ['snippets.management']

      const { store } = renderSnippetMain({
        hasPublishedWorkflow: false,
        workflowDraftNodes: [createDraftNode('draft-node')],
      })

      expect(screen.queryByRole('button', { name: 'publish' })).not.toBeInTheDocument()
      expect(store.getState().canvasReadOnly).toBe(true)
      expect(useSnippetDetailStore.getState().readonly).toBe(true)

      const doSyncWorkflowDraft = capturedHooksStore?.doSyncWorkflowDraft as () => Promise<void>
      await doSyncWorkflowDraft()
      const syncWorkflowDraftWhenPageClose =
        capturedHooksStore?.syncWorkflowDraftWhenPageClose as () => void
      syncWorkflowDraftWhenPageClose()
      useSnippetDetailStore.getState().onFieldsChange?.([
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
      expect(useSnippetDraftStore.getState().inputFields).toEqual(payload.inputFields)
    })

    it('should render the draft graph even when a published workflow exists', async () => {
      const publishedNode = createDraftNode('published-node')
      const draftNode = createDraftNode('draft-node')

      renderSnippetMain({
        hasPublishedWorkflow: true,
        workflowNodes: [publishedNode],
        workflowDraftNodes: [draftNode],
      })

      expect(capturedWorkflowNodes?.map((node) => node.id)).toEqual(['draft-node'])

      const doSyncWorkflowDraft = capturedHooksStore?.doSyncWorkflowDraft as () => Promise<void>
      await doSyncWorkflowDraft()

      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    })
  })

  describe('Input Fields Sync', () => {
    it('should sync draft input_fields when removing a field from the panel', async () => {
      renderSnippetMain({ currentNodes: [createDraftNode()] })

      await waitFor(() => {
        expect(useSnippetDetailStore.getState().onFieldsChange).toEqual(expect.any(Function))
      })
      act(() => {
        useSnippetDetailStore.getState().onFieldsChange?.([])
      })

      await waitFor(() => {
        expect(useSnippetDraftStore.getState().inputFields).toEqual([])
        expect(mockSyncInputFieldsDraft).toHaveBeenCalledWith([], {
          onRefresh: expect.any(Function),
        })
      })
    })

    it('should sync draft input_fields when adding a field from the sidebar', async () => {
      renderSnippetMain({ currentNodes: [createDraftNode()] })

      await waitFor(() => {
        expect(useSnippetDetailStore.getState().onFieldsChange).toEqual(expect.any(Function))
      })
      act(() => {
        useSnippetDetailStore.getState().onFieldsChange?.([
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
        expect(mockSyncInputFieldsDraft).toHaveBeenCalledWith(
          [
            payload.inputFields[0],
            {
              type: PipelineInputVarType.textInput,
              label: 'New Field',
              variable: 'new_field',
              required: true,
            },
          ],
          {
            onRefresh: expect.any(Function),
          },
        )
      })
      expect(useSnippetDraftStore.getState().inputFields).toEqual([
        payload.inputFields[0],
        {
          type: PipelineInputVarType.textInput,
          label: 'New Field',
          variable: 'new_field',
          required: true,
        },
      ])
      const { onRefresh } = mockSyncInputFieldsDraft.mock.calls[0]![1]
      act(() => onRefresh(payload.inputFields))
      expect(useSnippetDraftStore.getState().inputFields).toEqual(payload.inputFields)
    })
  })

  describe('Draft Sync', () => {
    it('should sync workflow draft when the page closes', () => {
      renderSnippetMain({ hasInitialDraftChanges: true })

      const syncWorkflowDraftWhenPageClose =
        capturedHooksStore?.syncWorkflowDraftWhenPageClose as () => void
      syncWorkflowDraftWhenPageClose()

      expect(mockSyncWorkflowDraftWhenPageClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Publish', () => {
    it('should not publish when the synced draft graph has no nodes', async () => {
      mockDoSyncWorkflowDraft.mockResolvedValueOnce({
        graph: payload.graph,
        input_fields: payload.inputFields,
      })
      renderSnippetMain({ currentNodes: [createDraftNode()] })

      await userEvent.setup().click(screen.getByRole('button', { name: 'publish' }))

      await waitFor(() => {
        expect(mockDoSyncWorkflowDraft).toHaveBeenCalledWith(true)
      })
      expect(mockPublishSnippetMutateAsync).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('snippet.emptyGraphSaveError')
    })

    it('should disable publish when current graph has no nodes', async () => {
      renderSnippetMain()

      const publishButton = screen.getByRole('button', { name: 'publish' })

      expect(publishButton).toBeDisabled()
      await userEvent.setup().click(publishButton)
      expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(mockPublishSnippetMutateAsync).not.toHaveBeenCalled()
    })

    it('should not publish when syncing the latest draft fails', async () => {
      mockDoSyncWorkflowDraft.mockResolvedValueOnce(undefined)
      renderSnippetMain({ hasInitialDraftChanges: true, currentNodes: [createDraftNode()] })

      await userEvent.setup().click(screen.getByRole('button', { name: 'publish' }))

      await waitFor(() => {
        expect(mockDoSyncWorkflowDraft).toHaveBeenCalledWith(true)
      })
      expect(mockPublishSnippetMutateAsync).not.toHaveBeenCalled()
    })

    it('should update local draft state with latest synced graph after publishing', async () => {
      const latestDraftNode = createDraftNode('published-draft-node')
      const latestDraft = {
        graph: {
          nodes: [latestDraftNode],
          edges: [],
          viewport: { x: 30, y: 40, zoom: 1.2 },
        },
        input_fields: [payload.inputFields[0]],
      }
      const sync = createDeferred<typeof latestDraft>()
      mockDoSyncWorkflowDraft.mockReturnValueOnce(sync.promise)
      renderSnippetMain({ hasInitialDraftChanges: true, currentNodes: [createDraftNode()] })

      await userEvent.setup().click(screen.getByRole('button', { name: 'publish' }))

      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledWith(true)
      expect(mockPublishSnippetMutateAsync).not.toHaveBeenCalled()
      await act(async () => sync.resolve(latestDraft))
      await waitFor(() =>
        expect(mockPublishSnippetMutateAsync).toHaveBeenCalledExactlyOnceWith({
          params: { snippet_id: 'snippet-1' },
          body: {},
        }),
      )

      await waitFor(() => {
        expect(capturedWorkflowNodes?.map((node) => node.id)).toContain('published-draft-node')
      })
    })
  })

  describe('Block Selector', () => {
    it('should filter unsupported snippet block types from available node metadata', () => {
      renderSnippetMain()

      const availableNodesMetaData = capturedHooksStore?.availableNodesMetaData as {
        nodes: Array<{ metaData: { type: BlockEnum } }>
        nodesMap: Partial<Record<BlockEnum, unknown>>
      }

      expect(availableNodesMetaData.nodes.map((node) => node.metaData.type)).toEqual([
        BlockEnum.LLM,
      ])
      expect(availableNodesMetaData.nodesMap[BlockEnum.LLM]).toBeDefined()
      expect(availableNodesMetaData.nodesMap[BlockEnum.HumanInput]).toBeUndefined()
      expect(availableNodesMetaData.nodesMap[BlockEnum.End]).toBeUndefined()
      expect(availableNodesMetaData.nodesMap[BlockEnum.KnowledgeRetrieval]).toBeUndefined()
    })
  })

  describe('Run Hooks', () => {
    it('should pass snippet workflow run detail urls to WorkflowWithInnerContext', () => {
      renderSnippetMain()

      const getWorkflowRunAndTraceUrl = capturedHooksStore?.getWorkflowRunAndTraceUrl as
        | ((runId?: string) => { runUrl: string; traceUrl: string })
        | undefined

      expect(getWorkflowRunAndTraceUrl?.('run-1')).toEqual({
        runUrl: '/snippets/snippet-1/workflow-runs/run-1',
        traceUrl: '/snippets/snippet-1/workflow-runs/run-1/node-executions',
      })
    })
  })
})

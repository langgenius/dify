import type {
  AppMode,
  SyncDraftWorkflowPayload,
  SyncDraftWorkflowResponse,
  WorkflowResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Features } from '@/app/components/base/features/types'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { EnvironmentVariablePatch } from '@/service/workflow'
import { act, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { BlockEnum } from '@/app/components/workflow/types'
import { markAppDeletionFailed, markAppDeletionStarted } from '@/service/app-deletion'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryWrapper, seedAppDetail } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { useNodesSyncDraft } from '../use-nodes-sync-draft'
import { useWorkflowRefreshDraft } from '../use-workflow-refresh-draft'

const mockDraftRequestContext = vi.fn()
const mockFetchDraft = vi.fn()
const mockCollaborationIsConnected = vi.fn()
const mockCollaborationGetIsLeader = vi.fn()
const mockCollaborationRequestWorkflowSync = vi.fn()
const mockCollaborationCanPersistLocalGraph = vi.fn()
const mockCollaborationCanFlushGraphOnPageClose = vi.fn()
const mockCollaborationCanUseLocalDraftFallback = vi.fn()

// The realtime collaboration session is an external connection boundary.
vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    isConnected: (...args: unknown[]) => mockCollaborationIsConnected(...args),
    getIsLeader: (...args: unknown[]) => mockCollaborationGetIsLeader(...args),
    requestWorkflowSync: (...args: unknown[]) => mockCollaborationRequestWorkflowSync(...args),
    canPersistLocalGraph: (...args: unknown[]) => mockCollaborationCanPersistLocalGraph(...args),
    canFlushGraphOnPageClose: (...args: unknown[]) =>
      mockCollaborationCanFlushGraphOnPageClose(...args),
    canUseLocalDraftFallback: (...args: unknown[]) =>
      mockCollaborationCanUseLocalDraftFallback(...args),
  },
}))

const mockSyncWorkflowDraft =
  vi.fn<
    (request: {
      url: string
      params: SyncDraftWorkflowPayload
    }) => Promise<Omit<SyncDraftWorkflowResponse, 'result'>>
  >()
const mockFetchWorkflowDraft = vi.fn()
// Stand in for the draft sync request at the client boundary. Calls are recorded as the
// request they send (endpoint and body), and rejections pass through the console link's
// contract error validation, as they do in production.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { apps } = await import('@dify/contracts/api/console/apps/orpc.gen')
  const { validateDefinedErrors } = await import('@/service/console/defined-errors')
  const validate = validateDefinedErrors({ apps })
  const get = (input: { params: { app_id: string } }) =>
    validate({
      context: {},
      input,
      path: ['apps', 'byAppId', 'workflows', 'draft', 'get'],
      next: () => mockFetchWorkflowDraft(input),
    })
  const post = (
    input: { params: { app_id: string }; body: SyncDraftWorkflowPayload },
    options?: unknown,
  ) => {
    mockDraftRequestContext(options)
    return validate({
      context: {},
      input,
      path: ['apps', 'byAppId', 'workflows', 'draft', 'post'],
      next: () =>
        mockSyncWorkflowDraft({
          url: `/apps/${input.params.app_id}/workflows/draft`,
          params: input.body,
        }),
    })
  }
  return {
    ...actual,
    consoleClient: { apps: { byAppId: { workflows: { draft: { get, post } } } } },
  }
})

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchDraft(...args),
}))

type SyncDraftCanvas = {
  nodes?: Node[]
  edges?: Edge[]
  transform?: [number, number, number]
  appMode?: AppMode
  isCollaborationEnabled?: boolean
  features?: Features
  initialStoreState?: Partial<Shape>
}

const startNode = createNode({
  id: 'n1',
  data: { type: BlockEnum.Start, title: 'Start' },
})
const savedStartNode = expect.objectContaining({
  id: 'n1',
  position: { x: 0, y: 0 },
  data: { type: BlockEnum.Start, title: 'Start', desc: '' },
})
const draftRequest = (params: unknown) => ({ url: '/apps/app-1/workflows/draft', params })

const renderSyncDraft = <R>(
  hook: () => R,
  {
    nodes = [startNode],
    edges = [],
    transform,
    appMode = 'workflow',
    isCollaborationEnabled = false,
    features,
    initialStoreState,
  }: SyncDraftCanvas = {},
) => {
  const featuresStore = createFeaturesStore(features ? { features } : undefined)
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_collaboration_mode: isCollaborationEnabled },
  })
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode: appMode }))

  return renderWorkflowCanvasHook(hook, {
    queryClient,
    resource: {
      kind: 'app',
      appId: 'app-1',
      mode: appMode === 'advanced-chat' ? 'advanced-chat' : 'workflow',
    },
    nodes,
    edges,
    transform,
    initialStoreState: {
      isWorkflowDataLoaded: true,
      syncWorkflowDraftHash: 'hash-123',
      ...initialStoreState,
    },
    wrapper: ({ children }) =>
      createElement(FeaturesContext.Provider, { value: featuresStore }, children),
  })
}

const renderUseNodesSyncDraft = (canvas?: SyncDraftCanvas) =>
  renderSyncDraft(() => useNodesSyncDraft(), canvas)

const startEmptySave = async (
  result: { current: ReturnType<typeof useNodesSyncDraft> },
  ...args: Parameters<ReturnType<typeof useNodesSyncDraft>['doSyncWorkflowDraft']>
) => {
  let syncPromise!: ReturnType<ReturnType<typeof useNodesSyncDraft>['doSyncWorkflowDraft']>
  await act(async () => {
    syncPromise = result.current.doSyncWorkflowDraft(...args)
  })
  return { syncPromise }
}

const draftNotSyncError = () =>
  createHttpError(new Response(null, { status: 409 }), {
    code: 'draft_workflow_not_sync',
    message: 'Workflow not synced.',
    status: 409,
  })

const useCollaborationSession = ({
  connected,
  leader,
  canPersistLocalGraph = true,
  canFlushGraphOnPageClose = true,
  canUseLocalDraftFallback = false,
}: {
  connected: boolean
  leader: boolean
  canPersistLocalGraph?: boolean
  canFlushGraphOnPageClose?: boolean
  canUseLocalDraftFallback?: boolean
}) => {
  mockCollaborationIsConnected.mockReturnValue(connected)
  mockCollaborationGetIsLeader.mockReturnValue(leader)
  mockCollaborationCanPersistLocalGraph.mockReturnValue(canPersistLocalGraph)
  mockCollaborationCanFlushGraphOnPageClose.mockReturnValue(canFlushGraphOnPageClose)
  mockCollaborationCanUseLocalDraftFallback.mockReturnValue(canUseLocalDraftFallback)
}

describe('useNodesSyncDraft', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockSyncWorkflowDraft.mockResolvedValue({ hash: 'new', updated_at: 1 })
    mockFetchWorkflowDraft.mockResolvedValue(
      createWorkflowResponseFixture({ hash: 'hash-123', graph: { nodes: [startNode], edges: [] } }),
    )
    useCollaborationSession({ connected: false, leader: true })
    mockCollaborationRequestWorkflowSync.mockResolvedValue({ hash: 'remote-hash', updatedAt: 2 })
  })

  describe('payload', () => {
    it('saves drafts when randomUUID is unavailable in the hosting context', async () => {
      vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
      try {
        const { result } = renderUseNodesSyncDraft()
        await act(async () => {
          await result.current.doSyncWorkflowDraft()
        })
        expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
        expect(mockSyncWorkflowDraft.mock.calls[0]?.[0].params.client_save_id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        )
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it.each(['draft sync', 'page close'] as const)(
      'removes Workflow LLM memory from %s without changing the canvas nodes',
      async (savePath) => {
        const memory = {
          enabled: false,
          role_prefix: { user: '', assistant: '' },
          window: { enabled: false, size: 10 },
        }
        const containers = [
          createNode({ id: 'iteration', data: { type: BlockEnum.Iteration, title: 'Iteration' } }),
          createNode({ id: 'loop', data: { type: BlockEnum.Loop, title: 'Loop' } }),
        ]
        const canvasNodes = [
          createNode({ id: 'llm', data: { type: BlockEnum.LLM, title: 'LLM', memory } }),
          createNode({
            id: 'iteration-llm',
            parentId: 'iteration',
            data: { type: BlockEnum.LLM, title: 'Iteration LLM', memory },
          }),
          createNode({
            id: 'loop-llm',
            parentId: 'loop',
            data: { type: BlockEnum.LLM, title: 'Loop LLM', memory },
          }),
        ]
        const { result } = renderUseNodesSyncDraft({ nodes: [...containers, ...canvasNodes] })

        await act(async () => {
          if (savePath === 'draft sync') await result.current.doSyncWorkflowDraft()
          else result.current.syncWorkflowDraftWhenPageClose()
        })

        const expectedPayload = expect.objectContaining({
          graph: expect.objectContaining({
            nodes: expect.arrayContaining(
              canvasNodes.map((node) =>
                expect.objectContaining({
                  id: node.id,
                  data: { type: BlockEnum.LLM, title: node.data.title, desc: '' },
                }),
              ),
            ),
          }),
        })
        expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(draftRequest(expectedPayload))
        canvasNodes.forEach((node) => expect(node.data).toHaveProperty('memory', memory))
      },
    )

    it('preserves LLM memory in chatflow apps', async () => {
      const memory = {
        role_prefix: { user: 'Human', assistant: 'Assistant' },
        window: { enabled: true, size: 10 },
      }
      const { result } = renderUseNodesSyncDraft({
        appMode: 'advanced-chat',
        nodes: [createNode({ id: 'llm', data: { type: BlockEnum.LLM, title: 'LLM', memory } })],
      })

      await act(async () => {
        await result.current.doSyncWorkflowDraft()
        result.current.syncWorkflowDraftWhenPageClose()
      })

      const expectedPayload = expect.objectContaining({
        graph: expect.objectContaining({
          nodes: [
            expect.objectContaining({
              data: { type: BlockEnum.LLM, title: 'LLM', desc: '', memory },
            }),
          ],
        }),
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(draftRequest(expectedPayload))
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
    })

    it('strips temporary entities and private data, uses the latest hash, and stores the result', async () => {
      const conversationVariables = [
        {
          id: 'conversation-1',
          name: 'topic',
          value_type: ChatVarType.String,
          value: 'conversation',
          description: '',
        },
      ]
      const callbacks = { onSuccess: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
      const { result, store } = renderUseNodesSyncDraft({
        nodes: [
          createNode({
            id: 'n1',
            data: { type: BlockEnum.Start, title: 'Start', _tempField: 'drop' },
          }),
          createNode({
            id: 'start-placeholder',
            position: { x: 1, y: 1 },
            data: { type: BlockEnum.StartPlaceholder },
          }),
          createNode({
            id: 'temp-node',
            position: { x: 2, y: 2 },
            data: { type: BlockEnum.Answer, _isTempNode: true },
          }),
        ],
        edges: [
          createEdge({
            id: 'edge-1',
            source: 'n1',
            target: 'n2',
            data: { _isTemp: false, _hovering: true, isInIteration: false },
          }),
          createEdge({ id: 'placeholder-edge', source: 'start-placeholder', target: 'n1' }),
          createEdge({ id: 'temp-edge', source: 'n2', target: 'n3', data: { _isTemp: true } }),
        ],
        transform: [10, 20, 1.5],
        features: {
          opening: { enabled: true, opening_statement: 'Hello', suggested_questions: ['Q1'] },
          suggested: { enabled: true },
          text2speech: { enabled: true },
          speech2text: { enabled: true },
          citation: { enabled: true },
          moderation: { enabled: false },
          file: { enabled: true },
        },
        initialStoreState: { syncWorkflowDraftHash: 'latest-hash', conversationVariables },
      })

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, callbacks)
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        draftRequest({
          graph: {
            nodes: [savedStartNode],
            edges: [
              createEdge({
                id: 'edge-1',
                source: 'n1',
                target: 'n2',
                data: { isInIteration: false },
              }),
            ],
            viewport: { x: 10, y: 20, zoom: 1.5 },
          },
          features: {
            opening_statement: 'Hello',
            suggested_questions: ['Q1'],
            suggested_questions_after_answer: { enabled: true },
            text_to_speech: { enabled: true },
            speech_to_text: { enabled: true },
            retriever_resource: { enabled: true },
            sensitive_word_avoidance: { enabled: false },
            file_upload: { enabled: true },
          },
          conversation_variables: conversationVariables,
          hash: 'latest-hash',
          client_save_id: expect.any(String),
        }),
      )
      expect(store.getState()).toMatchObject({
        showConfirm: undefined,
        syncWorkflowDraftHash: 'new',
        draftUpdatedAt: 1000,
      })
      expect(callbacks.onSuccess).toHaveBeenCalledOnce()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
    })

    it('includes an environment variable patch in a full draft sync', async () => {
      const environmentVariablePatch: EnvironmentVariablePatch = {
        environmentVariables: [
          {
            id: 'env-1',
            name: 'for_summarize',
            description: '',
            value_type: 'llm',
            value: { provider: 'langgenius/openai/openai', name: 'gpt-4.1', mode: 'chat' },
          },
        ],
        deletedEnvironmentVariableIds: ['env-2'],
      }
      const { result } = renderUseNodesSyncDraft()

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, undefined, { environmentVariablePatch })
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            environment_variable_patch: {
              environment_variables: environmentVariablePatch.environmentVariables,
              deleted_environment_variable_ids:
                environmentVariablePatch.deletedEnvironmentVariableIds,
            },
          }),
        }),
      )
    })

    it('keeps pending inline Agent v2 nodes in draft without incomplete bindings', async () => {
      const agentData = {
        type: BlockEnum.Agent,
        title: 'Agent',
        desc: '',
        agent_node_kind: 'dify_agent',
        version: '2',
        agent_binding: { binding_type: 'inline_agent' },
        selected: true,
      }
      const { result } = renderUseNodesSyncDraft({
        nodes: [
          startNode,
          createNode({
            id: 'pending-agent',
            position: { x: 1, y: 1 },
            data: { ...agentData, _isTempNode: true, _openInlineAgentPanel: true },
          }),
          createNode({
            id: 'temp-node',
            position: { x: 2, y: 2 },
            data: { type: BlockEnum.Answer, _isTempNode: true },
          }),
        ],
        edges: [
          createEdge({
            id: 'edge-1',
            source: 'n1',
            target: 'pending-agent',
            data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Agent },
          }),
          createEdge({ id: 'temp-edge', source: 'temp-node', target: 'pending-agent' }),
        ],
      })

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false)
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            graph: expect.objectContaining({
              nodes: [
                savedStartNode,
                expect.objectContaining({ id: 'pending-agent', data: agentData }),
              ],
              edges: [
                createEdge({
                  id: 'edge-1',
                  source: 'n1',
                  target: 'pending-agent',
                  data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Agent },
                }),
              ],
            }),
          }),
        }),
      )
    })

    it('captures the graph before a queued sync runs after the canvas is torn down', async () => {
      const draftEdge = createEdge({ id: 'edge-1', source: 'n1', target: 'n2' })
      const { result, setCanvas } = renderUseNodesSyncDraft({
        edges: [draftEdge],
        transform: [10, 20, 1.5],
      })
      let syncPromise!: ReturnType<typeof result.current.doSyncWorkflowDraft>

      act(() => {
        syncPromise = result.current.doSyncWorkflowDraft(false)
        // ReactFlow clears its store immediately after the page starts unmounting.
        setCanvas({ nodes: [], edges: [], transform: [0, 0, 1] })
      })

      await act(async () => {
        await syncPromise
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            graph: {
              nodes: [savedStartNode],
              edges: [draftEdge],
              viewport: { x: 10, y: 20, zoom: 1.5 },
            },
          }),
        }),
      )
    })
  })

  describe('empty graph confirmation', () => {
    it.each([
      { scenario: 'no nodes', nodes: [] },
      {
        scenario: 'only the local start placeholder',
        nodes: [
          createNode({ id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } }),
        ],
      },
    ])('saves an already empty draft with $scenario without confirmation', async ({ nodes }) => {
      const callbacks = { onSuccess: vi.fn(), onSettled: vi.fn() }
      const { result, store } = renderUseNodesSyncDraft({
        nodes,
        initialStoreState: { syncWorkflowDraftIsEmpty: true },
      })
      const { syncPromise } = await startEmptySave(result, false, callbacks)

      expect(store.getState().showConfirm).toBeUndefined()

      await act(async () => {
        await expect(syncPromise).resolves.toEqual({ hash: 'new', updatedAt: 1 })
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          params: expect.objectContaining({
            graph: expect.objectContaining({ nodes: [], edges: [] }),
            force: true,
          }),
        }),
      )
      expect(callbacks.onSuccess).toHaveBeenCalledOnce()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
    })

    it('waits for confirmation before force-saving an empty graph', async () => {
      const callbacks = { onSuccess: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
      const { result, store } = renderUseNodesSyncDraft({
        nodes: [],
        initialStoreState: { syncWorkflowDraftIsEmpty: false },
      })
      const { syncPromise } = await startEmptySave(result, false, callbacks)

      expect(store.getState().showConfirm).toEqual(
        expect.objectContaining({
          title: 'workflow.common.clearCanvasConfirmTitle',
          desc: 'workflow.common.clearCanvasConfirmDescription',
        }),
      )
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(callbacks.onSettled).not.toHaveBeenCalled()

      await act(async () => {
        store.getState().showConfirm?.onConfirm()
        await expect(syncPromise).resolves.toEqual({ hash: 'new', updatedAt: 1 })
      })

      expect(store.getState().showConfirm).toBeUndefined()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          params: expect.objectContaining({
            graph: expect.objectContaining({ nodes: [], edges: [] }),
            force: true,
          }),
        }),
      )
      expect(callbacks.onSuccess).toHaveBeenCalledOnce()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
    })

    it('does not confirm again when another hook saves the successfully cleared draft', async () => {
      const { result, store } = renderSyncDraft(
        () => [useNodesSyncDraft(), useNodesSyncDraft()] as const,
        { nodes: [], initialStoreState: { syncWorkflowDraftIsEmpty: false } },
      )
      const [first, second] = result.current
      const { syncPromise: firstSave } = await startEmptySave({ current: first })

      expect(store.getState().showConfirm).toBeDefined()

      await act(async () => {
        store.getState().showConfirm?.onConfirm()
        await firstSave
      })

      const { syncPromise: secondSave } = await startEmptySave({ current: second })

      expect(store.getState().showConfirm).toBeUndefined()

      await act(async () => {
        await expect(secondSave).resolves.toEqual({ hash: 'new', updatedAt: 1 })
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
    })

    it('requires confirmation again when clearing the draft failed to save', async () => {
      mockSyncWorkflowDraft.mockRejectedValueOnce(
        createHttpError(new Response(null, { status: 500 })),
      )
      const { result, store } = renderUseNodesSyncDraft({
        nodes: [],
        initialStoreState: { syncWorkflowDraftIsEmpty: false },
      })
      const { syncPromise: firstSave } = await startEmptySave(result)

      await act(async () => {
        store.getState().showConfirm?.onConfirm()
        await expect(firstSave).resolves.toBeNull()
      })

      const { syncPromise: retry } = await startEmptySave(result)

      expect(store.getState().showConfirm).toBeDefined()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()

      await act(async () => {
        store.getState().showConfirm?.onCancel?.()
        await expect(retry).resolves.toBeNull()
      })
    })

    it('confirms clearing a previously empty draft after another hook saved nodes', async () => {
      const { result, store, setCanvas } = renderSyncDraft(
        () => [useNodesSyncDraft(), useNodesSyncDraft()] as const,
        { initialStoreState: { syncWorkflowDraftIsEmpty: true } },
      )
      const [first, second] = result.current

      await act(async () => {
        await first.doSyncWorkflowDraft()
      })
      setCanvas({ nodes: [] })

      const { syncPromise } = await startEmptySave({ current: second })

      expect(store.getState().showConfirm).toBeDefined()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()

      await act(async () => {
        store.getState().showConfirm?.onConfirm()
        await syncPromise
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
    })

    it('confirms a queued clear when an earlier save populates an initially empty draft', async () => {
      let finishEarlierSave!: (response: { hash: string; updated_at: number }) => void
      mockSyncWorkflowDraft.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishEarlierSave = resolve
          }),
      )
      const { result, store, setCanvas } = renderUseNodesSyncDraft({
        initialStoreState: { syncWorkflowDraftIsEmpty: true },
      })
      const { syncPromise: earlierSave } = await startEmptySave(result)
      setCanvas({ nodes: [] })
      const { syncPromise: emptySave } = await startEmptySave(result)

      expect(store.getState().showConfirm).toBeUndefined()

      await act(async () => {
        await expect(result.current.doSyncWorkflowDraft()).resolves.toBeNull()
      })

      await act(async () => {
        finishEarlierSave({ hash: 'populated-draft', updated_at: 1 })
        await earlierSave
      })

      expect(store.getState().showConfirm).toBeDefined()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()

      await act(async () => {
        store.getState().showConfirm?.onConfirm()
        await emptySave
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
    })

    it('settles a canceled empty save without posting or reporting an error', async () => {
      const callbacks = { onSuccess: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
      const { result, store } = renderUseNodesSyncDraft({
        nodes: [],
        initialStoreState: { syncWorkflowDraftIsEmpty: false },
      })
      const { syncPromise } = await startEmptySave(result, false, callbacks)

      await act(async () => {
        store.getState().showConfirm?.onCancel?.()
        await expect(syncPromise).resolves.toBeNull()
      })

      expect(store.getState().showConfirm).toBeUndefined()
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(callbacks.onSuccess).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
    })

    it('treats a graph with only placeholders and temporary entities as empty', async () => {
      const { result, store } = renderUseNodesSyncDraft({
        initialStoreState: { syncWorkflowDraftIsEmpty: false },
        nodes: [
          createNode({ id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } }),
          createNode({
            id: 'temp-node',
            position: { x: 1, y: 1 },
            data: { type: BlockEnum.Answer, _isTempNode: true },
          }),
        ],
        edges: [
          createEdge({
            id: 'temp-edge',
            source: 'start-placeholder',
            target: 'temp-node',
            data: { _isTemp: true },
          }),
        ],
      })
      const { syncPromise } = await startEmptySave(result)

      expect(store.getState().showConfirm).toBeDefined()
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()

      await act(async () => {
        store.getState().showConfirm?.onConfirm()
        await syncPromise
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            graph: expect.objectContaining({ nodes: [], edges: [] }),
            force: true,
          }),
        }),
      )
    })

    it('skips an empty page-close save without opening confirmation', () => {
      const { result, store } = renderUseNodesSyncDraft({
        nodes: [],
        initialStoreState: { syncWorkflowDraftIsEmpty: false },
      })

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(store.getState().showConfirm).toBeUndefined()
    })

    it('skips repeated saves from the same hook while confirmation is open', async () => {
      const { result, store } = renderUseNodesSyncDraft({
        nodes: [],
        initialStoreState: { syncWorkflowDraftIsEmpty: false },
      })
      const callbacks = { onSettled: vi.fn() }
      const { syncPromise: firstSave } = await startEmptySave(result)
      const { syncPromise: repeatedSave } = await startEmptySave(result, false, callbacks)

      expect(callbacks.onSettled).toHaveBeenCalledOnce()

      await act(async () => {
        store.getState().showConfirm?.onCancel?.()
        await expect(firstSave).resolves.toBeNull()
        await expect(repeatedSave).resolves.toBeNull()
      })

      expect(store.getState().showConfirm).toBeUndefined()
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    })

    it('keeps one confirmation when another hook instance tries to save the empty graph', async () => {
      const { result, store } = renderSyncDraft(
        () => [useNodesSyncDraft(), useNodesSyncDraft()] as const,
        { nodes: [], initialStoreState: { syncWorkflowDraftIsEmpty: false } },
      )
      const [first, second] = result.current
      const secondCallbacks = { onError: vi.fn(), onSettled: vi.fn() }
      let firstSave!: ReturnType<typeof first.doSyncWorkflowDraft>

      await act(async () => {
        firstSave = first.doSyncWorkflowDraft()
      })
      const confirmation = store.getState().showConfirm

      await act(async () => {
        await expect(second.doSyncWorkflowDraft(false, secondCallbacks)).resolves.toBeNull()
      })

      expect(store.getState().showConfirm).toBe(confirmation)
      expect(secondCallbacks.onError).not.toHaveBeenCalled()
      expect(secondCallbacks.onSettled).toHaveBeenCalledOnce()

      await act(async () => {
        confirmation?.onConfirm()
        await firstSave
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
    })

    it('does not save the old empty graph when a node is added before confirmation', async () => {
      const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
      const { result, setCanvas, store } = renderUseNodesSyncDraft({
        nodes: [],
        initialStoreState: { syncWorkflowDraftIsEmpty: false },
      })
      const { syncPromise } = await startEmptySave(result, false, callbacks)

      setCanvas({ nodes: [createNode({ id: 'new-node', data: { type: BlockEnum.Start } })] })

      await act(async () => {
        store.getState().showConfirm?.onConfirm()
        await expect(syncPromise).resolves.toBeNull()
      })

      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
    })

    it('rechecks the canvas before saving a queued empty graph', async () => {
      let finishEarlierSave!: (response: { hash: string; updated_at: number }) => void
      mockSyncWorkflowDraft.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishEarlierSave = resolve
          }),
      )
      const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
      const { result, setCanvas, store } = renderUseNodesSyncDraft({
        initialStoreState: { syncWorkflowDraftIsEmpty: false },
      })
      const { syncPromise: earlierSave } = await startEmptySave(result)
      setCanvas({ nodes: [] })
      const { syncPromise: emptySave } = await startEmptySave(result, false, callbacks)
      setCanvas({ nodes: [createNode({ id: 'restored-node', data: { type: BlockEnum.Start } })] })

      await act(async () => {
        finishEarlierSave({ hash: 'earlier-save', updated_at: 1 })
        await earlierSave
        await expect(emptySave).resolves.toBeNull()
      })

      expect(store.getState().showConfirm).toBeUndefined()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
    })

    it('cancels a pending empty save when its owning hook unmounts', async () => {
      const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
      const { result, store, unmount } = renderUseNodesSyncDraft({
        nodes: [],
        initialStoreState: { syncWorkflowDraftIsEmpty: false },
      })
      const { syncPromise } = await startEmptySave(result, false, callbacks)
      expect(store.getState().showConfirm).toBeDefined()

      unmount()
      await expect(syncPromise).resolves.toBeNull()

      expect(store.getState().showConfirm).toBeUndefined()
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
    })

    it('confirms and saves an empty collaborative follower graph in the initiating tab', async () => {
      useCollaborationSession({ connected: true, leader: false })
      const { result, store } = renderUseNodesSyncDraft({
        nodes: [],
        isCollaborationEnabled: true,
        initialStoreState: { syncWorkflowDraftIsEmpty: false },
      })
      const { syncPromise } = await startEmptySave(result)

      expect(store.getState().showConfirm).toBeDefined()
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()

      await act(async () => {
        store.getState().showConfirm?.onConfirm()
        await syncPromise
      })

      expect(mockCollaborationRequestWorkflowSync).not.toHaveBeenCalled()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ force: true, _is_collaborative: true }),
        }),
      )
    })
  })

  describe('failures and skipped saves', () => {
    it.each([400, 408, 429])(
      'preserves earlier uncertain patches while handling a later HTTP %s rejection',
      async (status) => {
        mockSyncWorkflowDraft
          .mockRejectedValueOnce(new TypeError('Failed to fetch'))
          .mockRejectedValueOnce(
            createHttpError(new Response(null, { status }), { code: 'save_rejected', status }),
          )
        const earlierVariables: EnvironmentVariablePatch['environmentVariables'] = [
          {
            id: 'earlier',
            name: 'earlier',
            value_type: 'string',
            value: 'Earlier edit',
            description: '',
          },
        ]
        const latestVariables: EnvironmentVariablePatch['environmentVariables'] = [
          {
            id: 'latest',
            name: 'latest',
            value_type: 'string',
            value: 'Latest edit',
            description: '',
          },
        ]
        const { result, store } = renderUseNodesSyncDraft()
        await act(async () => {
          await result.current.doSyncWorkflowDraft(false, undefined, {
            environmentVariablePatch: {
              environmentVariables: earlierVariables,
              deletedEnvironmentVariableIds: [],
            },
          })
          await result.current.doSyncWorkflowDraft(false, undefined, {
            environmentVariablePatch: {
              environmentVariables: latestVariables,
              deletedEnvironmentVariableIds: [],
            },
          })
          await result.current.doSyncWorkflowDraft()
        })
        expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(3)
        const retry = mockSyncWorkflowDraft.mock.calls[2]?.[0].params
        expect(retry?.predecessor_saves).toEqual([
          {
            client_save_id: mockSyncWorkflowDraft.mock.calls[0]?.[0].params.client_save_id,
            environment_variable_patch: {
              environment_variables: earlierVariables,
              deleted_environment_variable_ids: [],
            },
          },
          {
            client_save_id: mockSyncWorkflowDraft.mock.calls[1]?.[0].params.client_save_id,
            ...(status === 400
              ? {}
              : {
                  environment_variable_patch: {
                    environment_variables: latestVariables,
                    deleted_environment_variable_ids: [],
                  },
                }),
          },
        ])
        expect(retry?.environment_variable_patch).toBeUndefined()
        expect(store.getState().hasWorkflowDraftConflict).toBe(false)
      },
    )

    it.each([
      {
        scenario: 'an out-of-date draft',
        error: draftNotSyncError,
        notRefresh: false,
      },
      {
        scenario: 'an out-of-date draft with refresh disabled',
        error: draftNotSyncError,
        notRefresh: true,
      },
      {
        scenario: 'another API error',
        error: () => createHttpError(new Response(null, { status: 400 }), { code: 'other_error' }),
        notRefresh: false,
      },
      {
        scenario: 'a non-JSON error',
        error: () => createHttpError(new Response(null, { status: 502 })),
        notRefresh: false,
      },
    ])('reports $scenario while preserving the local canvas', async ({ error, notRefresh }) => {
      mockSyncWorkflowDraft.mockRejectedValue(error())
      const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
      const { result, store } = renderUseNodesSyncDraft()

      await act(async () => {
        await expect(result.current.doSyncWorkflowDraft(notRefresh, callbacks)).resolves.toBeNull()
      })

      expect(mockFetchDraft).not.toHaveBeenCalled()
      expect(callbacks.onError).toHaveBeenCalledOnce()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
      expect(store.getState().syncWorkflowDraftHash).toBe('hash-123')
    })

    it.each([
      {
        scenario: 'workflow data is not loaded',
        initialStoreState: { isWorkflowDataLoaded: false },
      },
      { scenario: 'the canvas is read-only', initialStoreState: { canvasReadOnly: true } },
    ])('skips persistence without an error when $scenario', async ({ initialStoreState }) => {
      const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
      const { result } = renderUseNodesSyncDraft({ initialStoreState })

      await act(async () => {
        await expect(result.current.doSyncWorkflowDraft(false, callbacks)).resolves.toBeNull()
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
    })

    it('skips draft persistence without reporting an error while the app is being deleted', async () => {
      const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
      markAppDeletionStarted('app-1')

      try {
        const { result } = renderUseNodesSyncDraft()

        await act(async () => {
          await result.current.doSyncWorkflowDraft(false, callbacks)
          result.current.syncWorkflowDraftWhenPageClose()
        })

        expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
        expect(callbacks.onError).not.toHaveBeenCalled()
        expect(callbacks.onSettled).toHaveBeenCalledOnce()
      } finally {
        markAppDeletionFailed('app-1')
      }
    })

    it('does not report an in-flight draft failure after app deletion starts', async () => {
      let rejectSync!: (reason?: unknown) => void
      let resolveStarted!: () => void
      const started = new Promise<void>((resolve) => {
        resolveStarted = resolve
      })
      mockSyncWorkflowDraft.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectSync = reject
            resolveStarted()
          }),
      )
      const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
      const { result } = renderUseNodesSyncDraft()
      const { syncPromise } = await startEmptySave(result, false, callbacks)
      await started
      markAppDeletionStarted('app-1')

      try {
        await act(async () => {
          rejectSync(new Error('App not found'))
          await syncPromise
        })

        expect(callbacks.onError).not.toHaveBeenCalled()
        expect(callbacks.onSettled).toHaveBeenCalledOnce()
      } finally {
        markAppDeletionFailed('app-1')
      }
    })
  })

  describe('page close', () => {
    it('posts the draft with keepalive and leaves out the local start placeholder', async () => {
      const { result } = renderUseNodesSyncDraft({
        nodes: [
          createNode({ id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } }),
          startNode,
        ],
        edges: [createEdge({ id: 'placeholder-edge', source: 'start-placeholder', target: 'n1' })],
        transform: [1, 2, 3],
      })

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      expect(mockDraftRequestContext).toHaveBeenLastCalledWith({
        context: { silent: true, keepalive: true },
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        draftRequest(
          expect.objectContaining({
            graph: { nodes: [savedStartNode], edges: [], viewport: { x: 1, y: 2, zoom: 3 } },
            hash: 'hash-123',
          }),
        ),
      )
    })

    it.each([
      {
        scenario: 'a follower cannot flush the shared graph',
        session: { connected: true, leader: false, canFlushGraphOnPageClose: false },
        posts: 0,
      },
      {
        scenario: 'the trusted sole leader flushes while hidden',
        session: { connected: true, leader: true, canFlushGraphOnPageClose: true },
        posts: 1,
      },
      {
        // Without a connection there is no leader election; skipping would drop the edits.
        scenario: 'collaboration never connected',
        session: {
          connected: false,
          leader: false,
          canFlushGraphOnPageClose: false,
          canUseLocalDraftFallback: true,
        },
        posts: 1,
      },
      {
        scenario: 'an established collaboration disconnected',
        session: {
          connected: false,
          leader: true,
          canFlushGraphOnPageClose: false,
          canUseLocalDraftFallback: false,
        },
        posts: 0,
      },
    ])('posts $posts keepalive save(s) when $scenario', async ({ session, posts }) => {
      useCollaborationSession(session)
      const { result } = renderUseNodesSyncDraft({ isCollaborationEnabled: true })

      await act(async () => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(posts)
    })
  })

  describe('collaboration', () => {
    it('saves without confirmation after another collaborator has already cleared the draft', async () => {
      useCollaborationSession({ connected: true, leader: false })
      const { result, store, setCanvas } = renderUseNodesSyncDraft({
        isCollaborationEnabled: true,
        initialStoreState: { syncWorkflowDraftIsEmpty: false },
      })
      // The peer's committed clear arrives through CRDT without updating this client's save metadata.
      mockFetchWorkflowDraft.mockResolvedValue(
        createWorkflowResponseFixture({ hash: 'peer-empty-hash' }),
      )
      setCanvas({ nodes: [] })
      const { syncPromise } = await startEmptySave(result)

      expect(store.getState().showConfirm).toBeUndefined()

      await act(async () => {
        await expect(syncPromise).resolves.toEqual({ hash: 'new', updatedAt: 1 })
      })

      expect(mockFetchWorkflowDraft).toHaveBeenCalledExactlyOnceWith({
        params: { app_id: 'app-1' },
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledExactlyOnceWith(
        draftRequest(
          expect.objectContaining({
            hash: 'peer-empty-hash',
            graph: expect.objectContaining({ nodes: [], edges: [] }),
            force: true,
          }),
        ),
      )
      expect(mockCollaborationRequestWorkflowSync).not.toHaveBeenCalled()
    })

    it('confirms a newly populated server draft even when the last local save was empty', async () => {
      useCollaborationSession({ connected: true, leader: false })
      mockFetchWorkflowDraft.mockResolvedValue(
        createWorkflowResponseFixture({
          hash: 'peer-populated-hash',
          graph: { nodes: [startNode], edges: [] },
        }),
      )
      const { result, store } = renderUseNodesSyncDraft({
        nodes: [],
        isCollaborationEnabled: true,
        initialStoreState: { syncWorkflowDraftIsEmpty: true },
      })
      const { syncPromise } = await startEmptySave(result)

      expect(store.getState().showConfirm).toBeDefined()
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()

      await act(async () => {
        store.getState().showConfirm?.onConfirm()
        await syncPromise
      })

      // Refreshing persisted metadata must leave the initiating client's empty canvas intact.
      expect(mockSyncWorkflowDraft).toHaveBeenCalledExactlyOnceWith(
        draftRequest(
          expect.objectContaining({
            hash: 'peer-populated-hash',
            graph: expect.objectContaining({ nodes: [], edges: [] }),
            force: true,
          }),
        ),
      )
    })

    it('does not clear a collaborative draft when its persisted state cannot be refreshed', async () => {
      useCollaborationSession({ connected: true, leader: false })
      mockFetchWorkflowDraft.mockRejectedValue(new Error('Draft refresh failed'))
      const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
      const { result, store } = renderUseNodesSyncDraft({
        nodes: [],
        isCollaborationEnabled: true,
        initialStoreState: { syncWorkflowDraftIsEmpty: true },
      })

      await act(async () => {
        await expect(result.current.doSyncWorkflowDraft(false, callbacks)).resolves.toBeNull()
      })

      expect(store.getState().showConfirm).toBeUndefined()
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(callbacks.onError).toHaveBeenCalledOnce()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
    })

    it('serializes persisted-state refreshes and empty saves across hook instances', async () => {
      useCollaborationSession({ connected: true, leader: false })
      const firstRefresh = createDeferred<WorkflowResponse>()
      mockFetchWorkflowDraft
        .mockReturnValueOnce(firstRefresh.promise)
        .mockResolvedValueOnce(createWorkflowResponseFixture({ hash: 'new' }))
      const { result, store } = renderSyncDraft(
        () => [useNodesSyncDraft(), useNodesSyncDraft()] as const,
        {
          nodes: [],
          isCollaborationEnabled: true,
          initialStoreState: { syncWorkflowDraftIsEmpty: true },
        },
      )
      const [first, second] = result.current
      const { syncPromise: firstSave } = await startEmptySave({ current: first })
      const { syncPromise: secondSave } = await startEmptySave({ current: second })
      expect(mockFetchWorkflowDraft).toHaveBeenCalledOnce()
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()

      await act(async () => {
        firstRefresh.resolve(createWorkflowResponseFixture({ hash: 'peer-empty-hash' }))
        await Promise.all([firstSave, secondSave])
      })

      expect(store.getState().showConfirm).toBeUndefined()
      expect(mockFetchWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(mockSyncWorkflowDraft.mock.invocationCallOrder[0]).toBeLessThan(
        mockFetchWorkflowDraft.mock.invocationCallOrder[1]!,
      )
      expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
        draftRequest(
          expect.objectContaining({ hash: 'new', graph: expect.objectContaining({ nodes: [] }) }),
        ),
      )
    })

    it.each([
      'a node is restored',
      'the hook unmounts',
      'the graph becomes untrusted',
      'the draft generation changes',
    ] as const)(
      'skips a collaborative clear when %s during persisted-state refresh',
      async (change) => {
        useCollaborationSession({ connected: true, leader: false })
        const refresh = createDeferred<WorkflowResponse>()
        mockFetchWorkflowDraft.mockReturnValue(refresh.promise)
        const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
        const { result, store, setCanvas, unmount } = renderUseNodesSyncDraft({
          nodes: [],
          isCollaborationEnabled: true,
          initialStoreState: { syncWorkflowDraftIsEmpty: true },
        })
        const { syncPromise } = await startEmptySave(result, false, callbacks)

        if (change === 'a node is restored') setCanvas({ nodes: [startNode] })
        else if (change === 'the hook unmounts') unmount()
        else if (change === 'the draft generation changes')
          store.getState().invalidateWorkflowDraftSync()
        else mockCollaborationCanPersistLocalGraph.mockReturnValue(false)

        await act(async () => {
          refresh.resolve(createWorkflowResponseFixture({ hash: 'peer-empty-hash' }))
          await expect(syncPromise).resolves.toBeNull()
        })

        expect(store.getState().showConfirm).toBeUndefined()
        expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
        expect(callbacks.onError).not.toHaveBeenCalled()
        expect(callbacks.onSettled).toHaveBeenCalledOnce()
      },
    )

    it('adopts the leader receipt before this follower saves locally', async () => {
      useCollaborationSession({ connected: true, leader: false })
      const leaderClientSaveId = '00000000-0000-4000-8000-000000000001'
      mockCollaborationRequestWorkflowSync.mockResolvedValue({
        hash: 'remote-hash',
        updatedAt: 2,
        clientSaveId: leaderClientSaveId,
      })
      const callbacks = { onSuccess: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
      const { result, store } = renderUseNodesSyncDraft({ isCollaborationEnabled: true })

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, callbacks)
      })

      expect(mockCollaborationRequestWorkflowSync).toHaveBeenCalled()
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(store.getState()).toMatchObject({
        syncWorkflowDraftHash: 'remote-hash',
        syncWorkflowDraftSaveId: leaderClientSaveId,
        draftUpdatedAt: 2000,
      })
      expect(callbacks.onSuccess).toHaveBeenCalledOnce()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
      useCollaborationSession({ connected: true, leader: true })
      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        draftRequest(
          expect.objectContaining({
            hash: 'remote-hash',
            base_client_save_id: leaderClientSaveId,
          }),
        ),
      )
    })

    it('reports a failed leader save to the follower caller', async () => {
      useCollaborationSession({ connected: true, leader: false })
      mockCollaborationRequestWorkflowSync.mockRejectedValue(new Error('sync timeout'))
      const callbacks = { onSuccess: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
      const { result } = renderUseNodesSyncDraft({ isCollaborationEnabled: true })

      await act(async () => {
        await expect(result.current.doSyncWorkflowDraft(false, callbacks)).resolves.toBeNull()
      })

      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(callbacks.onSuccess).not.toHaveBeenCalled()
      expect(callbacks.onError).toHaveBeenCalledOnce()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
    })

    it('saves a directed sync request locally even before leader status arrives', async () => {
      useCollaborationSession({ connected: true, leader: false })
      mockSyncWorkflowDraft.mockImplementationOnce(async ({ params }) => ({
        hash: 'directed-save',
        updated_at: 1,
        client_save_id: params.client_save_id,
      }))
      const { result } = renderUseNodesSyncDraft({ isCollaborationEnabled: true })

      await act(async () => {
        const saved = await result.current.doSyncWorkflowDraft(false, undefined, {
          forceLocal: true,
        })
        expect(saved).toEqual({
          hash: 'directed-save',
          updatedAt: 1,
          clientSaveId: mockSyncWorkflowDraft.mock.calls[0]?.[0].params.client_save_id,
        })
      })

      expect(mockCollaborationRequestWorkflowSync).not.toHaveBeenCalled()
      expect(mockSyncWorkflowDraft).toHaveBeenCalled()
    })

    it('does not queue a directed local save behind the requester waiting for its ack', async () => {
      useCollaborationSession({ connected: true, leader: false })
      let resolveRemoteSync: ((result: { hash: string; updatedAt: number }) => void) | undefined
      mockCollaborationRequestWorkflowSync.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRemoteSync = resolve
        }),
      )
      const { result } = renderUseNodesSyncDraft({ isCollaborationEnabled: true })

      let requesterSync: Promise<unknown> | undefined
      await act(async () => {
        requesterSync = result.current.doSyncWorkflowDraft()
        await Promise.resolve()
      })

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, undefined, { forceLocal: true })
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(1)

      resolveRemoteSync?.({ hash: 'remote-hash', updatedAt: 2 })
      await act(async () => {
        await requesterSync
      })
    })

    it('does not persist an untrusted collaborative graph', async () => {
      useCollaborationSession({ connected: true, leader: true, canPersistLocalGraph: false })
      const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
      const { result } = renderUseNodesSyncDraft({ isCollaborationEnabled: true })

      await act(async () => {
        await expect(result.current.doSyncWorkflowDraft(false, callbacks)).resolves.toBeNull()
      })

      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
    })
  })

  describe('draft conflict and save ordering', () => {
    it('pauses every save entry after a conflict without refreshing away local edits', async () => {
      mockSyncWorkflowDraft.mockRejectedValueOnce(draftNotSyncError())
      const { result, store } = renderUseNodesSyncDraft()
      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })
      expect(store.getState().hasWorkflowDraftConflict).toBe(true)
      await act(async () => {
        expect(await result.current.doSyncWorkflowDraft(true)).toBeNull()
        expect(
          await result.current.doSyncWorkflowDraft(false, undefined, { forceLocal: true }),
        ).toBeNull()
        result.current.syncWorkflowDraftWhenPageClose()
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
      expect(mockFetchDraft).not.toHaveBeenCalled()
    })

    it('drops queued saves after a conflict and settles both callers', async () => {
      const pending = createDeferred<{ hash: string; updated_at: number }>()
      mockSyncWorkflowDraft.mockReturnValueOnce(pending.promise)
      const { result } = renderUseNodesSyncDraft()
      const firstSettled = vi.fn()
      const secondSettled = vi.fn()
      const first = result.current.doSyncWorkflowDraft(false, { onSettled: firstSettled })
      await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      const second = result.current.doSyncWorkflowDraft(false, { onSettled: secondSettled })
      await act(async () => {
        pending.reject(draftNotSyncError())
        await Promise.all([first, second])
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
      expect(firstSettled).toHaveBeenCalledOnce()
      expect(secondSettled).toHaveBeenCalledOnce()
    })

    it.each(['success', 'conflict'] as const)(
      'ignores a stale %s response after a newer draft reload',
      async (outcome) => {
        const pending = createDeferred<Omit<SyncDraftWorkflowResponse, 'result'>>()
        mockSyncWorkflowDraft.mockReturnValueOnce(pending.promise)
        const { result, store } = renderUseNodesSyncDraft()
        const onSuccess = vi.fn()
        const onError = vi.fn()
        const saving = result.current.doSyncWorkflowDraft(false, { onSuccess, onError })
        await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
        store.getState().invalidateWorkflowDraftSync()
        store.getState().setSyncWorkflowDraftHash('reloaded-hash')
        await act(async () => {
          if (outcome === 'success')
            pending.resolve({
              hash: 'old-save',
              updated_at: 1,
              client_save_id: mockSyncWorkflowDraft.mock.calls[0]?.[0].params.client_save_id,
            })
          else pending.reject(draftNotSyncError())
          expect(await saving).toBeNull()
        })
        expect(store.getState().syncWorkflowDraftHash).toBe('reloaded-hash')
        expect(store.getState().syncWorkflowDraftSaveId).toBeNull()
        expect(store.getState().hasWorkflowDraftConflict).toBe(false)
        expect(onSuccess).not.toHaveBeenCalled()
        expect(onError).not.toHaveBeenCalled()
      },
    )

    it.each(['generation', 'hash'] as const)(
      'does not lend an external %s to a queued old graph',
      async (change) => {
        const { result, store } = renderUseNodesSyncDraft({
          initialStoreState: { syncWorkflowDraftSaveId: '00000000-0000-4000-8000-000000000001' },
        })
        const saving = result.current.doSyncWorkflowDraft()
        if (change === 'generation') store.getState().invalidateWorkflowDraftSync()
        store.getState().setSyncWorkflowDraftHash('external-hash')
        expect(await saving).toBeNull()
        expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
        await act(async () => {
          await result.current.doSyncWorkflowDraft()
        })
        expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
        expect(mockSyncWorkflowDraft.mock.calls[0]?.[0].params.hash).toBe('external-hash')
        expect(mockSyncWorkflowDraft.mock.calls[0]?.[0].params.base_client_save_id).toBeUndefined()
      },
    )

    it('shares successful queued saves, hashes, and receipts across hook instances', async () => {
      mockSyncWorkflowDraft
        .mockImplementationOnce(async ({ params }) => ({
          hash: 'saved-1',
          updated_at: 1,
          client_save_id: params.client_save_id,
        }))
        .mockImplementationOnce(async ({ params }) => ({
          hash: 'saved-2',
          updated_at: 2,
          client_save_id: params.client_save_id,
        }))
      const { result, store, setCanvas } = renderSyncDraft(
        () => [useNodesSyncDraft(), useNodesSyncDraft()] as const,
      )
      const first = result.current[0].doSyncWorkflowDraft()
      setCanvas({ nodes: [createNode({ id: 'latest' })] })
      const second = result.current[1].doSyncWorkflowDraft()
      await act(async () => {
        await Promise.all([first, second])
      })
      expect(mockSyncWorkflowDraft).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          params: expect.objectContaining({
            hash: 'saved-1',
            base_client_save_id: mockSyncWorkflowDraft.mock.calls[0]?.[0].params.client_save_id,
            graph: expect.objectContaining({ nodes: [expect.objectContaining({ id: 'latest' })] }),
          }),
        }),
      )
      expect(store.getState().syncWorkflowDraftHash).toBe('saved-2')
      expect(store.getState().syncWorkflowDraftSaveId).toBe(
        mockSyncWorkflowDraft.mock.calls[1]?.[0].params.client_save_id,
      )
    })

    it('blocks normal and keepalive saves while a draft is being applied', async () => {
      const { result } = renderUseNodesSyncDraft({
        initialStoreState: { isSyncingWorkflowDraft: true },
      })
      expect(await result.current.doSyncWorkflowDraft()).toBeNull()
      result.current.syncWorkflowDraftWhenPageClose()
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    })

    it('pauses follower saves when the selected saver reports a conflict', async () => {
      useCollaborationSession({ connected: true, leader: false })
      mockCollaborationRequestWorkflowSync.mockRejectedValue(new Error('draft_workflow_not_sync'))
      const { result, store } = renderUseNodesSyncDraft({ isCollaborationEnabled: true })
      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })
      expect(store.getState().hasWorkflowDraftConflict).toBe(true)
      expect(await result.current.doSyncWorkflowDraft()).toBeNull()
      expect(mockCollaborationRequestWorkflowSync).toHaveBeenCalledOnce()
    })
  })

  describe('save and refresh ordering', () => {
    it('uses a refreshed hash and receipt instead of an earlier save receipt', async () => {
      const refreshedClientSaveId = '00000000-0000-4000-8000-000000000002'
      mockSyncWorkflowDraft.mockImplementationOnce(async ({ params }) => ({
        hash: 'saved-locally',
        updated_at: 1,
        client_save_id: params.client_save_id,
      }))
      const { result, store } = renderUseNodesSyncDraft()
      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })
      expect(store.getState().syncWorkflowDraftSaveId).toBe(
        mockSyncWorkflowDraft.mock.calls[0]?.[0].params.client_save_id,
      )
      await act(async () => {
        store.getState().invalidateWorkflowDraftSync()
        store
          .getState()
          .setSyncWorkflowDraftHash(
            'saved-remotely',
            { nodes: [startNode], edges: [] },
            refreshedClientSaveId,
          )
        await result.current.doSyncWorkflowDraft()
      })
      expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
        draftRequest(
          expect.objectContaining({
            hash: 'saved-remotely',
            base_client_save_id: refreshedClientSaveId,
          }),
        ),
      )
    })

    it('preserves an accepted variable patch queued after a background refresh request', async () => {
      const pending = createDeferred<{ hash: string; updated_at: number }>()
      mockSyncWorkflowDraft.mockReturnValueOnce(pending.promise)
      const { result, store } = renderSyncDraft(() => ({
        save: useNodesSyncDraft(),
        refresh: useWorkflowRefreshDraft(),
      }))
      const saving = result.current.save.doSyncWorkflowDraft()
      await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      const reading = result.current.refresh.handleRefreshWorkflowDraft(false, { background: true })
      const variables: Shape['environmentVariables'] = [
        { id: 'env-1', name: 'topic', value_type: 'string', value: 'Local edit', description: '' },
      ]
      store.getState().setEnvironmentVariables(variables)
      const patch = { environmentVariables: variables, deletedEnvironmentVariableIds: [] }
      const patched = result.current.save.doSyncWorkflowDraft(false, undefined, {
        environmentVariablePatch: patch,
      })
      await act(async () => {
        pending.resolve({ hash: 'saved-before-patch', updated_at: 2 })
        await saving
        expect(await reading).toBe('superseded')
        expect(await patched).not.toBeNull()
      })
      expect(mockFetchDraft).not.toHaveBeenCalled()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            hash: 'saved-before-patch',
            environment_variable_patch: {
              environment_variables: variables,
              deleted_environment_variable_ids: [],
            },
          }),
        }),
      )
    })

    it('yields a queued background read to Builder preparation without canceling its saved baseline', async () => {
      const pending = createDeferred<{ hash: string; updated_at: number }>()
      mockSyncWorkflowDraft.mockReturnValueOnce(pending.promise)
      const { result, store } = renderSyncDraft(() => ({
        save: useNodesSyncDraft(),
        refresh: useWorkflowRefreshDraft(),
      }))
      const saving = result.current.save.doSyncWorkflowDraft()
      await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      const reading = result.current.refresh.handleRefreshWorkflowDraft(false, { background: true })
      const preparing = result.current.save.prepareWorkflowDraftForBuilder(
        true,
        new AbortController().signal,
      )
      const completed = Promise.all([saving, reading, preparing])
      await act(async () => {
        pending.resolve({ hash: 'saved-before-builder', updated_at: 2 })
        const [, refreshed] = await completed
        expect(refreshed).toBe('superseded')
      })
      expect(mockFetchDraft).not.toHaveBeenCalled()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ hash: 'saved-before-builder' }),
        }),
      )
      expect(store.getState().workflowDraftSyncPhase).toBe('builder')
      expect(store.getState().hasWorkflowDraftConflict).toBe(false)
    })

    it('drains an accepted keepalive save before starting a background full read', async () => {
      const pending = createDeferred<{ hash: string; updated_at: number }>()
      const unloading = createDeferred<{ hash: string; updated_at: number }>()
      mockSyncWorkflowDraft
        .mockReturnValueOnce(pending.promise)
        .mockReturnValueOnce(unloading.promise)
      mockFetchDraft.mockResolvedValue({
        hash: 'latest-saved-hash',
        graph: { nodes: [startNode], edges: [] },
      })
      const { result, store, setCanvas } = renderSyncDraft(() => ({
        save: useNodesSyncDraft(),
        refresh: useWorkflowRefreshDraft(),
      }))
      store.getState().markWorkflowDraftDirty()
      const saving = result.current.save.doSyncWorkflowDraft()
      await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      setCanvas({ nodes: [createNode({ id: 'latest-local-edit' })] })
      store.getState().markWorkflowDraftDirty()
      result.current.save.syncWorkflowDraftWhenPageClose()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
      const reading = result.current.refresh.handleRefreshWorkflowDraft(false, {
        background: true,
        preserveViewport: true,
      })
      expect(mockFetchDraft).not.toHaveBeenCalled()
      await act(async () => {
        pending.resolve({ hash: 'first-saved-hash', updated_at: 2 })
        await saving
      })
      expect(mockFetchDraft).not.toHaveBeenCalled()
      await act(async () => {
        unloading.resolve({ hash: 'latest-saved-hash', updated_at: 3 })
        await reading
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            hash: 'hash-123',
            predecessor_saves: [
              { client_save_id: mockSyncWorkflowDraft.mock.calls[0]?.[0].params.client_save_id },
            ],
            graph: expect.objectContaining({
              nodes: [expect.objectContaining({ id: 'latest-local-edit' })],
            }),
          }),
        }),
      )
      expect(mockFetchDraft).toHaveBeenCalledOnce()
      expect(mockSyncWorkflowDraft.mock.invocationCallOrder[1]).toBeLessThan(
        mockFetchDraft.mock.invocationCallOrder[0]!,
      )
      expect(store.getState().syncWorkflowDraftHash).toBe('latest-saved-hash')
      expect(store.getState().hasWorkflowDraftConflict).toBe(false)
    })

    it('dispatches the final keepalive snapshot before the pending save completes or the hook unmounts', async () => {
      const pending = createDeferred<{ hash: string; updated_at: number }>()
      mockSyncWorkflowDraft.mockReturnValueOnce(pending.promise)
      const { result, setCanvas, unmount } = renderUseNodesSyncDraft()
      const saving = result.current.doSyncWorkflowDraft()
      await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      setCanvas({ nodes: [createNode({ id: 'latest-local-edit' })] })
      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            hash: 'hash-123',
            client_save_id: expect.any(String),
            predecessor_saves: [
              { client_save_id: mockSyncWorkflowDraft.mock.calls[0]?.[0].params.client_save_id },
            ],
            graph: expect.objectContaining({
              nodes: [expect.objectContaining({ id: 'latest-local-edit' })],
            }),
          }),
        }),
      )
      expect(mockDraftRequestContext).toHaveBeenLastCalledWith({
        context: { silent: true, keepalive: true },
      })
      unmount()
      await act(async () => {
        pending.resolve({ hash: 'first-saved-hash', updated_at: 2 })
        await saving
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
    })

    it.each([
      { firstResponse: 'autosave', autosaveOutcome: 'success' },
      { firstResponse: 'unload', autosaveOutcome: 'success' },
      { firstResponse: 'autosave', autosaveOutcome: 'conflict' },
      { firstResponse: 'unload', autosaveOutcome: 'conflict' },
    ] as const)(
      'keeps the final save when $firstResponse responds first and autosave returns $autosaveOutcome',
      async ({ firstResponse, autosaveOutcome }) => {
        const autosave = createDeferred<{ hash: string; updated_at: number }>()
        const unload = createDeferred<{ hash: string; updated_at: number }>()
        mockSyncWorkflowDraft
          .mockReturnValueOnce(autosave.promise)
          .mockReturnValueOnce(unload.promise)
        const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
        const { result, store, setCanvas } = renderSyncDraft(
          () => [useNodesSyncDraft(), useNodesSyncDraft()] as const,
        )
        const saving = result.current[0].doSyncWorkflowDraft(false, callbacks)
        await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
        setCanvas({ nodes: [createNode({ id: 'final-edit' })] })
        result.current[1].syncWorkflowDraftWhenPageClose()
        expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)

        const finishAutosave = () => {
          if (autosaveOutcome === 'success') autosave.resolve({ hash: 'older-save', updated_at: 2 })
          else autosave.reject(draftNotSyncError())
        }
        if (firstResponse === 'autosave') {
          await act(async () => {
            finishAutosave()
            await saving
          })
          expect(store.getState().hasWorkflowDraftConflict).toBe(false)
        }
        await act(async () => {
          unload.resolve({ hash: 'final-save', updated_at: 3 })
        })
        await waitFor(() => expect(store.getState().syncWorkflowDraftHash).toBe('final-save'))
        if (firstResponse === 'unload') {
          await act(async () => {
            finishAutosave()
            await saving
          })
        }

        expect(store.getState()).toMatchObject({
          syncWorkflowDraftHash: 'final-save',
          draftUpdatedAt: 3000,
          hasWorkflowDraftConflict: false,
        })
        expect(callbacks.onError).not.toHaveBeenCalled()
        expect(callbacks.onSettled).toHaveBeenCalledOnce()
      },
    )

    it('keeps a real conflict from the final keepalive save despite an older successful response', async () => {
      const autosave = createDeferred<{ hash: string; updated_at: number }>()
      const unload = createDeferred<{ hash: string; updated_at: number }>()
      mockSyncWorkflowDraft
        .mockReturnValueOnce(autosave.promise)
        .mockReturnValueOnce(unload.promise)
      const { result, store, setCanvas } = renderUseNodesSyncDraft()
      const saving = result.current.doSyncWorkflowDraft()
      await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      setCanvas({ nodes: [createNode({ id: 'unsaved-local-edit' })] })
      result.current.syncWorkflowDraftWhenPageClose()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)

      await act(async () => {
        unload.reject(draftNotSyncError())
      })
      await waitFor(() => expect(store.getState().hasWorkflowDraftConflict).toBe(true))
      await act(async () => {
        autosave.resolve({ hash: 'older-save', updated_at: 2 })
        await saving
      })

      expect(store.getState().hasWorkflowDraftConflict).toBe(true)
      expect(await result.current.doSyncWorkflowDraft()).toBeNull()
      expect(mockFetchDraft).not.toHaveBeenCalled()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
    })

    it('includes pending variable patches in the final snapshot without replaying queued older graphs', async () => {
      const pending = createDeferred<{ hash: string; updated_at: number }>()
      const unloading = createDeferred<{ hash: string; updated_at: number }>()
      mockSyncWorkflowDraft
        .mockReturnValueOnce(pending.promise)
        .mockReturnValueOnce(unloading.promise)
      const firstVariables: EnvironmentVariablePatch['environmentVariables'] = [
        { id: 'edited', name: 'edited', value_type: 'string', value: 'old', description: '' },
        { id: 'removed', name: 'removed', value_type: 'string', value: 'old', description: '' },
      ]
      const latestVariables: EnvironmentVariablePatch['environmentVariables'] = [
        { id: 'edited', name: 'edited', value_type: 'string', value: 'latest', description: '' },
        {
          id: 'restored',
          name: 'restored',
          value_type: 'string',
          value: 'restored',
          description: '',
        },
      ]
      const { result, setCanvas, store } = renderSyncDraft(
        () => [useNodesSyncDraft(), useNodesSyncDraft()] as const,
      )
      const saving = result.current[0].doSyncWorkflowDraft(false, undefined, {
        environmentVariablePatch: {
          environmentVariables: firstVariables,
          deletedEnvironmentVariableIds: ['restored'],
        },
      })
      await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      setCanvas({ nodes: [createNode({ id: 'queued-old-graph' })] })
      const queued = result.current[0].doSyncWorkflowDraft(false, undefined, {
        environmentVariablePatch: {
          environmentVariables: latestVariables,
          deletedEnvironmentVariableIds: ['removed'],
        },
      })
      setCanvas({ nodes: [createNode({ id: 'final-edit' })] })
      result.current[1].syncWorkflowDraftWhenPageClose()

      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
        draftRequest(
          expect.objectContaining({
            hash: 'hash-123',
            predecessor_saves: [
              {
                client_save_id: mockSyncWorkflowDraft.mock.calls[0]?.[0].params.client_save_id,
                environment_variable_patch: {
                  environment_variables: firstVariables,
                  deleted_environment_variable_ids: ['restored'],
                },
              },
              {
                client_save_id: expect.any(String),
                environment_variable_patch: {
                  environment_variables: latestVariables,
                  deleted_environment_variable_ids: ['removed'],
                },
              },
            ],
            graph: expect.objectContaining({
              nodes: [expect.objectContaining({ id: 'final-edit' })],
            }),
          }),
        ),
      )
      expect(
        mockSyncWorkflowDraft.mock.calls[1]?.[0].params.environment_variable_patch,
      ).toBeUndefined()
      await act(async () => {
        unloading.resolve({ hash: 'final-save', updated_at: 3 })
        pending.reject(draftNotSyncError())
        await Promise.all([saving, queued])
        await store.getState().enqueueWorkflowDraftOperation(async () => undefined)
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(store.getState().syncWorkflowDraftHash).toBe('final-save')
      expect(store.getState().hasWorkflowDraftConflict).toBe(false)
    })

    it('retains each predecessor patch once across repeated unload saves', async () => {
      const pending = createDeferred<Omit<SyncDraftWorkflowResponse, 'result'>>()
      const unloading = createDeferred<Omit<SyncDraftWorkflowResponse, 'result'>>()
      const finalUnload = createDeferred<Omit<SyncDraftWorkflowResponse, 'result'>>()
      mockSyncWorkflowDraft
        .mockReturnValueOnce(pending.promise)
        .mockReturnValueOnce(unloading.promise)
        .mockReturnValueOnce(finalUnload.promise)
      const variables: EnvironmentVariablePatch['environmentVariables'] = [
        { id: 'env-1', name: 'topic', value_type: 'string', value: 'Local edit', description: '' },
      ]
      const { result, store, setCanvas } = renderUseNodesSyncDraft()
      const saving = result.current.doSyncWorkflowDraft(false, undefined, {
        environmentVariablePatch: {
          environmentVariables: variables,
          deletedEnvironmentVariableIds: ['removed'],
        },
      })
      await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      const firstClientSaveId = mockSyncWorkflowDraft.mock.calls[0]?.[0].params.client_save_id
      result.current.syncWorkflowDraftWhenPageClose()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
      const unloadingClientSaveId = mockSyncWorkflowDraft.mock.calls[1]?.[0].params.client_save_id
      await act(async () => {
        pending.resolve({ hash: 'first-save', updated_at: 1, client_save_id: firstClientSaveId })
        await saving
      })
      setCanvas({ nodes: [createNode({ id: 'final-edit' })] })
      result.current.syncWorkflowDraftWhenPageClose()

      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(3)
      const finalRequest = mockSyncWorkflowDraft.mock.calls[2]?.[0].params
      expect(finalRequest).toMatchObject({
        hash: 'hash-123',
        predecessor_saves: [
          {
            client_save_id: firstClientSaveId,
            environment_variable_patch: {
              environment_variables: variables,
              deleted_environment_variable_ids: ['removed'],
            },
          },
          { client_save_id: unloadingClientSaveId },
        ],
        graph: expect.objectContaining({ nodes: [expect.objectContaining({ id: 'final-edit' })] }),
      })
      expect(finalRequest?.environment_variable_patch).toBeUndefined()
      expect(finalRequest?.predecessor_saves?.[1]?.environment_variable_patch).toBeUndefined()
      await act(async () => {
        finalUnload.resolve({
          hash: 'final-save',
          updated_at: 3,
          client_save_id: finalRequest?.client_save_id,
        })
        unloading.reject(draftNotSyncError())
        await store.getState().enqueueWorkflowDraftOperation(async () => undefined)
      })
      expect(store.getState()).toMatchObject({
        syncWorkflowDraftHash: 'final-save',
        syncWorkflowDraftSaveId: finalRequest?.client_save_id,
        hasWorkflowDraftConflict: false,
      })
    })

    it('retries queued variable changes with the latest graph after an unload transport failure', async () => {
      const pending = createDeferred<Omit<SyncDraftWorkflowResponse, 'result'>>()
      const unloading = createDeferred<Omit<SyncDraftWorkflowResponse, 'result'>>()
      mockSyncWorkflowDraft
        .mockReturnValueOnce(pending.promise)
        .mockReturnValueOnce(unloading.promise)
        .mockImplementationOnce(async ({ params }) => ({
          hash: 'recovered-save',
          updated_at: 3,
          client_save_id: params.client_save_id,
        }))
      const variables: Shape['environmentVariables'] = [
        { id: 'env-1', name: 'topic', value_type: 'string', value: 'Queued edit', description: '' },
      ]
      const { result, store, setCanvas } = renderUseNodesSyncDraft()
      const saving = result.current.doSyncWorkflowDraft()
      await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      store.getState().setEnvironmentVariables(variables)
      const queued = result.current.doSyncWorkflowDraft(false, undefined, {
        environmentVariablePatch: {
          environmentVariables: variables,
          deletedEnvironmentVariableIds: ['removed'],
        },
      })
      setCanvas({ nodes: [createNode({ id: 'unload-edit' })] })
      result.current.syncWorkflowDraftWhenPageClose()
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
      const unloadRequest = mockSyncWorkflowDraft.mock.calls[1]?.[0].params
      expect(unloadRequest?.predecessor_saves).toEqual([
        { client_save_id: mockSyncWorkflowDraft.mock.calls[0]?.[0].params.client_save_id },
        {
          client_save_id: expect.any(String),
          environment_variable_patch: {
            environment_variables: variables,
            deleted_environment_variable_ids: ['removed'],
          },
        },
      ])
      await act(async () => {
        unloading.reject(new TypeError('Failed to fetch'))
        pending.resolve({
          hash: 'older-save',
          updated_at: 1,
          client_save_id: mockSyncWorkflowDraft.mock.calls[0]?.[0].params.client_save_id,
        })
        await Promise.all([saving, queued])
        await store.getState().enqueueWorkflowDraftOperation(async () => undefined)
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(2)
      expect(store.getState().hasWorkflowDraftConflict).toBe(false)
      setCanvas({ nodes: [createNode({ id: 'latest-retry-edit' })] })
      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })

      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(3)
      const retryRequest = mockSyncWorkflowDraft.mock.calls[2]?.[0].params
      expect(retryRequest).toMatchObject({
        predecessor_saves: [
          ...(unloadRequest?.predecessor_saves ?? []),
          { client_save_id: unloadRequest?.client_save_id },
        ],
        graph: {
          nodes: [expect.objectContaining({ id: 'latest-retry-edit' })],
        },
      })
      expect(retryRequest?.environment_variable_patch).toBeUndefined()
      expect(store.getState()).toMatchObject({
        syncWorkflowDraftHash: 'recovered-save',
        syncWorkflowDraftSaveId: retryRequest?.client_save_id,
        environmentVariables: variables,
        hasWorkflowDraftConflict: false,
      })
      await act(async () => {
        await result.current.doSyncWorkflowDraft()
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(4)
      const nextRequest = mockSyncWorkflowDraft.mock.calls[3]?.[0].params
      expect(nextRequest?.base_client_save_id).toBe(retryRequest?.client_save_id)
      expect(nextRequest?.predecessor_saves).toBeUndefined()
    })

    it.each(['autosave', 'builder'] as const)(
      'keeps an in-flight save acknowledged through metadata refresh before %s',
      async (nextAction) => {
        const pending = createDeferred<{ hash: string; updated_at: number }>()
        mockSyncWorkflowDraft.mockReturnValueOnce(pending.promise)
        mockFetchDraft.mockResolvedValue({
          hash: 'self-saved-hash',
          graph: { nodes: [startNode], edges: [] },
          environment_variables: [],
          conversation_variables: [],
        })
        const { result, store } = renderSyncDraft(() => ({
          save: useNodesSyncDraft(),
          refresh: useWorkflowRefreshDraft(),
        }))
        store.getState().markWorkflowDraftDirty()
        const saving = result.current.save.doSyncWorkflowDraft()
        await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
        const metadata = result.current.refresh.handleRefreshWorkflowDraft(true)
        await act(async () => {
          pending.resolve({ hash: 'self-saved-hash', updated_at: 2 })
          expect(await saving).toEqual({ hash: 'self-saved-hash', updatedAt: 2 })
          await metadata
        })
        expect(store.getState().syncWorkflowDraftHash).toBe('self-saved-hash')
        await act(async () => {
          if (nextAction === 'builder')
            await result.current.save.prepareWorkflowDraftForBuilder(
              true,
              new AbortController().signal,
            )
          else await result.current.save.doSyncWorkflowDraft()
        })
        expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
          expect.objectContaining({
            params: expect.objectContaining({ hash: 'self-saved-hash' }),
          }),
        )
        expect(store.getState().hasWorkflowDraftConflict).toBe(false)
      },
    )

    it.each([false, true])(
      'drains an acknowledged keepalive save before Builder preparation (collaboration: %s)',
      async (collaboration) => {
        useCollaborationSession({ connected: collaboration, leader: true })
        const pending = createDeferred<{ hash: string; updated_at: number }>()
        mockSyncWorkflowDraft.mockReturnValueOnce(pending.promise)
        const { result, store } = renderUseNodesSyncDraft({ isCollaborationEnabled: collaboration })
        result.current.syncWorkflowDraftWhenPageClose()
        await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
        expect(mockDraftRequestContext).toHaveBeenLastCalledWith({
          context: { silent: true, keepalive: true },
        })
        const preparing = result.current.prepareWorkflowDraftForBuilder(
          true,
          new AbortController().signal,
        )
        expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
        await act(async () => {
          pending.resolve({ hash: 'keepalive-hash', updated_at: 2 })
          await preparing
        })
        expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
          expect.objectContaining({
            params: expect.objectContaining({ hash: 'keepalive-hash' }),
          }),
        )
        expect(store.getState().hasWorkflowDraftConflict).toBe(false)
      },
    )
  })

  describe('Builder draft barrier', () => {
    it('drains accepted saves and variable patches, saves the latest snapshot, and blocks later autosaves', async () => {
      const pending = createDeferred<{ hash: string; updated_at: number }>()
      mockSyncWorkflowDraft
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce({ hash: 'saved-2', updated_at: 2 })
      const { result, store, setCanvas } = renderSyncDraft(
        () => [useNodesSyncDraft(), useNodesSyncDraft()] as const,
      )
      const [autosave, builder] = result.current
      const saving = autosave.doSyncWorkflowDraft()
      await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      setCanvas({ nodes: [createNode({ id: 'queued' })] })
      const queued = autosave.doSyncWorkflowDraft(false, undefined, {
        environmentVariablePatch: {
          environmentVariables: [],
          deletedEnvironmentVariableIds: ['old-variable'],
        },
      })
      setCanvas({ nodes: [createNode({ id: 'latest' })] })
      store.getState().setBuilderViewportManuallyChanged(true)
      const preparing = builder.prepareWorkflowDraftForBuilder(true, new AbortController().signal)
      expect(store.getState().workflowDraftSyncPhase).toBe('preparing')
      expect(store.getState().builderViewportManuallyChanged).toBe(false)
      store.getState().setBuilderViewportManuallyChanged(true)
      expect(await autosave.doSyncWorkflowDraft()).toBeNull()
      autosave.syncWorkflowDraftWhenPageClose()
      await act(async () => {
        pending.resolve({ hash: 'saved-1', updated_at: 1 })
        await Promise.all([saving, queued, preparing])
      })
      expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(3)
      expect(mockSyncWorkflowDraft).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          params: expect.objectContaining({
            hash: 'saved-1',
            environment_variable_patch: {
              environment_variables: [],
              deleted_environment_variable_ids: ['old-variable'],
            },
          }),
        }),
      )
      expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            hash: 'saved-2',
            graph: expect.objectContaining({ nodes: [expect.objectContaining({ id: 'latest' })] }),
          }),
        }),
      )
      expect(store.getState().workflowDraftSyncPhase).toBe('builder')
      expect(store.getState().builderViewportManuallyChanged).toBe(true)
      expect(await autosave.doSyncWorkflowDraft(false, undefined, { forceLocal: true })).toBeNull()
    })

    it('releases the barrier without discarding local edits after save failure', async () => {
      mockSyncWorkflowDraft.mockRejectedValueOnce(new Error('offline'))
      const { result, store } = renderUseNodesSyncDraft()
      await expect(
        result.current.prepareWorkflowDraftForBuilder(true, new AbortController().signal),
      ).rejects.toThrow('workflow.common.draftSaveFailed')
      expect(store.getState().workflowDraftSyncPhase).toBe('idle')
      expect(mockFetchDraft).not.toHaveBeenCalled()
      expect(await result.current.doSyncWorkflowDraft()).toEqual({ hash: 'new', updatedAt: 1 })
    })

    it('does not authorize clearing the canvas during Builder preparation', async () => {
      mockSyncWorkflowDraft.mockRejectedValueOnce(
        createHttpError(new Response(null, { status: 400 }), {
          message: 'Saving an empty workflow requires force=true.',
        }),
      )
      const { result, store } = renderUseNodesSyncDraft({ nodes: [] })
      await expect(
        result.current.prepareWorkflowDraftForBuilder(true, new AbortController().signal),
      ).rejects.toThrow('workflow.common.draftSaveFailed')
      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.not.objectContaining({ force: true }) }),
      )
      expect(store.getState().workflowDraftSyncPhase).toBe('idle')
    })

    it.each([true, false])(
      'preserves a conflict found while draining saves with saveDraft=%s',
      async (saveDraft) => {
        const pending = createDeferred<{ hash: string; updated_at: number }>()
        mockSyncWorkflowDraft.mockReturnValueOnce(pending.promise)
        const { result, store } = renderUseNodesSyncDraft()
        const saving = result.current.doSyncWorkflowDraft()
        await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
        const preparing = expect(
          result.current.prepareWorkflowDraftForBuilder(saveDraft, new AbortController().signal),
        ).rejects.toThrow('workflow.draftConflict.message')
        await act(async () => {
          pending.reject(draftNotSyncError())
          await saving
          await preparing
        })
        expect(store.getState().hasWorkflowDraftConflict).toBe(true)
        expect(store.getState().workflowDraftSyncPhase).toBe('idle')
        expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
      },
    )

    it('serves directed saves while waiting for the collaborator acknowledgment', async () => {
      useCollaborationSession({ connected: true, leader: false })
      const acknowledgment = createDeferred<{ hash: string; updatedAt: number }>()
      mockCollaborationRequestWorkflowSync.mockReturnValueOnce(acknowledgment.promise)
      const { result, store } = renderUseNodesSyncDraft({ isCollaborationEnabled: true })
      const preparing = result.current.prepareWorkflowDraftForBuilder(
        true,
        new AbortController().signal,
      )
      await waitFor(() => expect(mockCollaborationRequestWorkflowSync).toHaveBeenCalledOnce())
      const saved = await result.current.doSyncWorkflowDraft(false, undefined, { forceLocal: true })
      expect(saved).toEqual({ hash: 'new', updatedAt: 1 })
      expect(store.getState().workflowDraftSyncPhase).toBe('preparing')
      acknowledgment.resolve(saved!)
      await preparing
      expect(store.getState().workflowDraftSyncPhase).toBe('builder')
    })

    it('drains in-flight saves without writing an old graph when restoring Builder', async () => {
      const pending = createDeferred<{ hash: string; updated_at: number }>()
      mockSyncWorkflowDraft.mockReturnValueOnce(pending.promise)
      const { result, store } = renderUseNodesSyncDraft()
      const saving = result.current.doSyncWorkflowDraft()
      await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce())
      const preparing = result.current.prepareWorkflowDraftForBuilder(
        false,
        new AbortController().signal,
      )
      pending.resolve({ hash: 'saved', updated_at: 1 })
      await Promise.all([saving, preparing])
      expect(mockSyncWorkflowDraft).toHaveBeenCalledOnce()
      expect(store.getState().workflowDraftSyncPhase).toBe('builder')
    })

    it('allows a replacement restore to take over canceled preparation without saving', async () => {
      const { result, store } = renderUseNodesSyncDraft()
      const controller = new AbortController()
      const canceled = expect(
        result.current.prepareWorkflowDraftForBuilder(false, controller.signal),
      ).rejects.toThrow()
      controller.abort()
      await Promise.all([
        canceled,
        result.current.prepareWorkflowDraftForBuilder(false, new AbortController().signal),
      ])
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(store.getState().workflowDraftSyncPhase).toBe('builder')
    })

    it('retains an accepted snapshot after cancellation and canvas teardown', async () => {
      const { result, setCanvas } = renderUseNodesSyncDraft()
      const controller = new AbortController()
      const preparing = expect(
        result.current.prepareWorkflowDraftForBuilder(true, controller.signal),
      ).rejects.toThrow()
      controller.abort()
      setCanvas({ nodes: [] })
      await preparing
      expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            graph: expect.objectContaining({ nodes: [savedStartNode] }),
          }),
        }),
      )
    })
  })
})

import type { AppMode, WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { Features } from '@/app/components/base/features/types'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { EnvironmentVariablePatch } from '@/service/workflow'
import { act } from '@testing-library/react'
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

const mockPostWithKeepalive = vi.fn()
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

const mockSyncWorkflowDraft = vi.fn()
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
  const post = (input: { params: { app_id: string }; body: unknown }) =>
    validate({
      context: {},
      input,
      path: ['apps', 'byAppId', 'workflows', 'draft', 'post'],
      next: () =>
        mockSyncWorkflowDraft({
          url: `/apps/${input.params.app_id}/workflows/draft`,
          params: input.body,
        }),
    })
  return {
    ...actual,
    consoleClient: { apps: { byAppId: { workflows: { draft: { get, post } } } } },
  }
})

vi.mock('@/service/fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/fetch')>()
  return {
    ...actual,
    postWithKeepalive: (...args: unknown[]) => mockPostWithKeepalive(...args),
  }
})
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return { ...actual, API_PREFIX: '/api' }
})

const mockHandleRefreshWorkflowDraft = vi.fn()
vi.mock('../use-workflow-refresh-draft', () => ({
  useWorkflowRefreshDraft: () => ({ handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft }),
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
        if (savePath === 'draft sync')
          expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(draftRequest(expectedPayload))
        else
          expect(mockPostWithKeepalive).toHaveBeenCalledWith(
            '/api/apps/app-1/workflows/draft',
            expectedPayload,
          )
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
      expect(mockPostWithKeepalive).toHaveBeenCalledWith(
        '/api/apps/app-1/workflows/draft',
        expectedPayload,
      )
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

      expect(mockPostWithKeepalive).not.toHaveBeenCalled()
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
    it.each([
      {
        scenario: 'an out-of-date draft',
        error: draftNotSyncError,
        notRefresh: false,
        refreshes: 1,
      },
      {
        scenario: 'an out-of-date draft with refresh disabled',
        error: draftNotSyncError,
        notRefresh: true,
        refreshes: 0,
      },
      {
        scenario: 'another API error',
        error: () => createHttpError(new Response(null, { status: 400 }), { code: 'other_error' }),
        notRefresh: false,
        refreshes: 0,
      },
      {
        scenario: 'a non-JSON error',
        error: () => createHttpError(new Response(null, { status: 502 })),
        notRefresh: false,
        refreshes: 0,
      },
    ])(
      'reports $scenario and refreshes $refreshes time(s)',
      async ({ error, notRefresh, refreshes }) => {
        mockSyncWorkflowDraft.mockRejectedValue(error())
        const callbacks = { onError: vi.fn(), onSettled: vi.fn() }
        const { result, store } = renderUseNodesSyncDraft()

        await act(async () => {
          await expect(
            result.current.doSyncWorkflowDraft(notRefresh, callbacks),
          ).resolves.toBeNull()
        })

        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(refreshes)
        if (refreshes) expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledWith(true)
        expect(callbacks.onError).toHaveBeenCalledOnce()
        expect(callbacks.onSettled).toHaveBeenCalledOnce()
        expect(store.getState().syncWorkflowDraftHash).toBe('hash-123')
      },
    )

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
      expect(mockPostWithKeepalive).not.toHaveBeenCalled()
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
        expect(mockPostWithKeepalive).not.toHaveBeenCalled()
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
    it('posts the draft with keepalive and leaves out the local start placeholder', () => {
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

      expect(mockPostWithKeepalive).toHaveBeenCalledWith(
        '/api/apps/app-1/workflows/draft',
        expect.objectContaining({
          graph: { nodes: [savedStartNode], edges: [], viewport: { x: 1, y: 2, zoom: 3 } },
          hash: 'hash-123',
        }),
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
    ])('posts $posts keepalive save(s) when $scenario', ({ session, posts }) => {
      useCollaborationSession(session)
      const { result } = renderUseNodesSyncDraft({ isCollaborationEnabled: true })

      act(() => {
        result.current.syncWorkflowDraftWhenPageClose()
      })

      expect(mockPostWithKeepalive).toHaveBeenCalledTimes(posts)
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

    it('keeps a newer successful save when another hook finishes an older metadata refresh', async () => {
      useCollaborationSession({ connected: true, leader: false })
      const olderRefresh = createDeferred<WorkflowResponse>()
      const newerRefresh = createDeferred<WorkflowResponse>()
      mockFetchWorkflowDraft
        .mockReturnValueOnce(olderRefresh.promise)
        .mockReturnValueOnce(newerRefresh.promise)
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

      await act(async () => {
        newerRefresh.resolve(createWorkflowResponseFixture({ hash: 'peer-empty-hash' }))
        await secondSave
      })
      await act(async () => {
        olderRefresh.resolve(
          createWorkflowResponseFixture({
            hash: 'hash-123',
            graph: { nodes: [startNode], edges: [] },
          }),
        )
      })

      expect(store.getState().showConfirm).toBeUndefined()

      await act(async () => {
        await firstSave
      })

      expect(mockSyncWorkflowDraft).toHaveBeenLastCalledWith(
        draftRequest(
          expect.objectContaining({ hash: 'new', graph: expect.objectContaining({ nodes: [] }) }),
        ),
      )
    })

    it.each(['a node is restored', 'the hook unmounts', 'the graph becomes untrusted'] as const)(
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

    it('waits for the leader save result when the current user is a follower', async () => {
      useCollaborationSession({ connected: true, leader: false })
      const callbacks = { onSuccess: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
      const { result, store } = renderUseNodesSyncDraft({ isCollaborationEnabled: true })

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, callbacks)
      })

      expect(mockCollaborationRequestWorkflowSync).toHaveBeenCalled()
      expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(store.getState()).toMatchObject({
        syncWorkflowDraftHash: 'remote-hash',
        draftUpdatedAt: 2000,
      })
      expect(callbacks.onSuccess).toHaveBeenCalledOnce()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onSettled).toHaveBeenCalledOnce()
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
      const { result } = renderUseNodesSyncDraft({ isCollaborationEnabled: true })

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, undefined, { forceLocal: true })
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
})

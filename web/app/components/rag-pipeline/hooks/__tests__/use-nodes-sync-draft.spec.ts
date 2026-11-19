import type { Edge, EnvironmentVariable, Node } from '@/app/components/workflow/types'
import type { RAGPipelineVariables } from '@/models/pipeline'
import { act } from '@testing-library/react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { createHttpError } from '@/service/http-error'
import { useNodesSyncDraft } from '../use-nodes-sync-draft'

const mockSyncWorkflowDraft = vi.fn()
// Stand in for the draft sync request at the client boundary: record the request it sends
// and validate rejections against the contract, as the console link does.
vi.mock('@/service/console', async (importOriginal) => {
  const { rag } = await import('@dify/contracts/api/console/rag/orpc.gen')
  const { validateDefinedErrors } = await import('@/service/console/defined-errors')
  const validate = validateDefinedErrors({ rag })
  const post = (input: { params: { pipeline_id: string }; body: unknown }) =>
    validate({
      context: {},
      input,
      path: ['rag', 'pipelines', 'byPipelineId', 'workflows', 'draft', 'post'],
      next: () =>
        mockSyncWorkflowDraft({
          url: `/rag/pipelines/${input.params.pipeline_id}/workflows/draft`,
          params: input.body,
        }),
    })
  return {
    ...(await importOriginal<typeof import('@/service/console')>()),
    consoleClient: { rag: { pipelines: { byPipelineId: { workflows: { draft: { post } } } } } },
  }
})

const mockHandleRefreshWorkflowDraft = vi.fn()
vi.mock('../use-pipeline-refresh-draft', () => ({
  usePipelineRefreshDraft: () => ({
    handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft,
  }),
}))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  API_PREFIX: '/api',
}))

const mockPostWithKeepalive = vi.fn()
vi.mock('@/service/fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/fetch')>()),
  postWithKeepalive: (...args: unknown[]) => mockPostWithKeepalive(...args),
}))

const startNode = createNode({ id: 'node-1', data: { type: BlockEnum.Start, title: 'Start' } })
const savedStartData = { type: BlockEnum.Start, title: 'Start', desc: '' }
const draftUrl = '/rag/pipelines/test-pipeline-id/workflows/draft'

const renderPipelineDraftSync = ({
  nodes = [startNode],
  edges = [],
  transform,
  canvasReadOnly = false,
  syncWorkflowDraftHash = 'test-hash',
  environmentVariables = [],
  ragPipelineVariables = [],
}: {
  nodes?: Node[]
  edges?: Edge[]
  transform?: [number, number, number]
  canvasReadOnly?: boolean
  syncWorkflowDraftHash?: string
  environmentVariables?: EnvironmentVariable[]
  ragPipelineVariables?: RAGPipelineVariables
} = {}) =>
  renderWorkflowCanvasHook(() => useNodesSyncDraft(), {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
    nodes,
    edges,
    transform,
    initialStoreState: {
      canvasReadOnly,
      syncWorkflowDraftHash,
      environmentVariables,
      ragPipelineVariables,
    },
  })

const draftNotSyncError = () =>
  createHttpError(new Response(null, { status: 409 }), {
    code: 'draft_workflow_not_sync',
    message: 'Workflow not synced.',
    status: 409,
  })

describe('useNodesSyncDraft', () => {
  beforeEach(() => {
    mockSyncWorkflowDraft.mockResolvedValue({ hash: 'new-hash', updated_at: 1_704_067_200 })
  })

  it.each(['page close', 'queued sync'] as const)(
    'sends the complete sanitized draft on %s without changing the canvas',
    async (mode) => {
      const node = createNode({
        id: 'node-1',
        data: { type: BlockEnum.Start, title: 'Start', _privateData: 'secret' },
      })
      const temp = createNode({
        id: 'temp',
        position: { x: 50, y: 0 },
        data: { type: BlockEnum.Start, _isTempNode: true },
      })
      const edge = createEdge({
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        data: { _hidden: true, isInIteration: false },
      })
      const environmentVariables: EnvironmentVariable[] = [
        {
          id: 'env',
          name: 'URL',
          value_type: 'string',
          value: 'https://example.com',
          description: '',
        },
      ]
      const ragPipelineVariables = [
        { variable: 'input', type: 'text-input', label: 'Input', belong_to_node_id: 'shared' },
      ] as RAGPipelineVariables
      const { result, store } = renderPipelineDraftSync({
        nodes: [node, temp],
        edges: [edge],
        transform: [100, 200, 1.5],
        environmentVariables,
        ragPipelineVariables,
      })
      const payload = {
        graph: {
          nodes: [expect.objectContaining({ id: 'node-1', data: savedStartData })],
          edges: [
            {
              ...edge,
              data: {
                sourceType: BlockEnum.Start,
                targetType: BlockEnum.Code,
                isInIteration: false,
              },
            },
          ],
          viewport: { x: 100, y: 200, zoom: 1.5 },
        },
        environment_variables: environmentVariables,
        rag_pipeline_variables: ragPipelineVariables,
        hash: 'test-hash',
      }
      if (mode === 'page close') {
        act(() => result.current.syncWorkflowDraftWhenPageClose())
        expect(mockPostWithKeepalive).toHaveBeenCalledExactlyOnceWith(`/api${draftUrl}`, payload)
      } else {
        await act(async () => {
          await result.current.doSyncWorkflowDraft()
        })
        expect(mockSyncWorkflowDraft).toHaveBeenCalledExactlyOnceWith({
          url: draftUrl,
          params: payload,
        })
        expect(store.getState()).toMatchObject({
          syncWorkflowDraftHash: 'new-hash',
          draftUpdatedAt: 1_704_067_200_000,
        })
      }
      expect(node.data).toHaveProperty('_privateData', 'secret')
      expect(edge.data).toHaveProperty('_hidden', true)
    },
  )

  it.each([
    { scenario: 'the canvas is read-only', canvasReadOnly: true, nodes: [startNode] },
    { scenario: 'the canvas has no nodes', canvasReadOnly: false, nodes: [] },
    {
      scenario: 'the canvas only has temporary nodes',
      canvasReadOnly: false,
      nodes: [createNode({ data: { type: BlockEnum.Start, _isTempNode: true } })],
    },
  ])('does not persist the draft when $scenario', async ({ canvasReadOnly, nodes }) => {
    const { result } = renderPipelineDraftSync({ canvasReadOnly, nodes })

    await act(async () => {
      result.current.syncWorkflowDraftWhenPageClose()
      await result.current.doSyncWorkflowDraft()
    })

    expect(mockPostWithKeepalive).not.toHaveBeenCalled()
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('captures the graph before a queued sync runs after the canvas is torn down', async () => {
    const draftEdge = createEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' })
    const { result, setCanvas } = renderPipelineDraftSync({
      edges: [draftEdge],
      transform: [10, 20, 1.5],
    })
    let syncPromise!: ReturnType<typeof result.current.doSyncWorkflowDraft>

    act(() => {
      syncPromise = result.current.doSyncWorkflowDraft()
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
            nodes: [expect.objectContaining({ id: 'node-1', data: savedStartData })],
            edges: [draftEdge],
            viewport: { x: 10, y: 20, zoom: 1.5 },
          },
        }),
      }),
    )
  })

  it('uses the latest hash when sending a previously captured queued graph', async () => {
    mockSyncWorkflowDraft
      .mockResolvedValueOnce({ hash: 'hash-after-first-sync', updated_at: 1 })
      .mockResolvedValueOnce({ hash: 'hash-after-second-sync', updated_at: 2 })
    const { result, store } = renderPipelineDraftSync({ syncWorkflowDraftHash: 'initial-hash' })
    let firstSync!: ReturnType<typeof result.current.doSyncWorkflowDraft>
    let secondSync!: ReturnType<typeof result.current.doSyncWorkflowDraft>

    act(() => {
      firstSync = result.current.doSyncWorkflowDraft()
      secondSync = result.current.doSyncWorkflowDraft()
    })

    await act(async () => {
      await Promise.all([firstSync, secondSync])
    })

    expect(mockSyncWorkflowDraft).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ params: expect.objectContaining({ hash: 'initial-hash' }) }),
    )
    expect(mockSyncWorkflowDraft).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        params: expect.objectContaining({ hash: 'hash-after-first-sync' }),
      }),
    )
    expect(store.getState().syncWorkflowDraftHash).toBe('hash-after-second-sync')
  })

  it('reports success and failure through the sync callbacks', async () => {
    const callbacks = { onError: vi.fn(), onSuccess: vi.fn(), onSettled: vi.fn() }
    mockSyncWorkflowDraft.mockRejectedValueOnce(new Error('Sync failed'))
    const { result, store } = renderPipelineDraftSync()

    await act(async () => {
      await result.current.doSyncWorkflowDraft(false, callbacks)
    })

    expect(callbacks.onError).toHaveBeenCalledOnce()
    expect(callbacks.onSuccess).not.toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalledOnce()
    expect(store.getState().syncWorkflowDraftHash).toBe('test-hash')

    await act(async () => {
      await result.current.doSyncWorkflowDraft(false, callbacks)
    })

    expect(callbacks.onSuccess).toHaveBeenCalledOnce()
    expect(callbacks.onSettled).toHaveBeenCalledTimes(2)
    expect(store.getState().syncWorkflowDraftHash).toBe('new-hash')
  })

  it.each([
    { notRefreshWhenSyncError: false, refreshes: 1 },
    { notRefreshWhenSyncError: true, refreshes: 0 },
  ])(
    'refreshes an out-of-date draft $refreshes time(s) when notRefreshWhenSyncError=$notRefreshWhenSyncError',
    async ({ notRefreshWhenSyncError, refreshes }) => {
      mockSyncWorkflowDraft.mockRejectedValue(draftNotSyncError())
      const { result } = renderPipelineDraftSync()

      await act(async () => {
        await result.current.doSyncWorkflowDraft(notRefreshWhenSyncError)
      })

      expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(refreshes)
    },
  )
})

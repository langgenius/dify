import type { InputVar } from '@/models/pipeline'
import { ORPCError } from '@orpc/client'
import { act, renderHook, waitFor } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import { createDeferred } from '@/test/deferred'
import { useSnippetDraftStore } from '../../draft-store'
import { useNodesSyncDraft } from '../use-nodes-sync-draft'

const mockRefreshDraft = vi.fn()
const mockGetNodes = vi.fn()
const mockGetNodesReadOnly = vi.fn()
const mockUseNodesReadOnlyByCanEdit = vi.fn()
const mockPostWithKeepalive = vi.fn()
const mockSyncDraftWorkflow = vi.fn()
const mockSetDraftUpdatedAt = vi.fn()
const mockSetSyncWorkflowDraftHash = vi.fn()

let reactFlowState: {
  getNodes: typeof mockGetNodes
  edges: Array<Record<string, unknown>>
  transform: [number, number, number]
}

let workflowStoreState: {
  syncWorkflowDraftHash: string | null
  setDraftUpdatedAt: typeof mockSetDraftUpdatedAt
  setSyncWorkflowDraftHash: typeof mockSetSyncWorkflowDraftHash
}

vi.mock('reactflow', () => ({
  useStoreApi: () => ({ getState: () => reactFlowState }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnlyByCanEdit: (canEdit: boolean) => mockUseNodesReadOnlyByCanEdit(canEdit),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => workflowStoreState,
  }),
}))

// Rejections pass through the console link's contract error validation, as in production.
vi.mock('@/service/console', async () => {
  const { snippets } = await import('@dify/contracts/api/console/snippets/orpc.gen')
  const { validateDefinedErrors } = await import('@/service/console/defined-errors')
  const validate = validateDefinedErrors({ snippets })
  const post = (...args: unknown[]) =>
    validate({
      context: {},
      input: args[0],
      path: ['snippets', 'bySnippetId', 'workflows', 'draft', 'post'],
      next: () => mockSyncDraftWorkflow(...args),
    })
  return { consoleClient: { snippets: { bySnippetId: { workflows: { draft: { post } } } } } }
})

vi.mock('@/service/fetch', () => ({
  postWithKeepalive: (...args: unknown[]) => mockPostWithKeepalive(...args),
}))

vi.mock('@/config', () => ({ API_PREFIX: '/api' }))

vi.mock('../use-snippet-refresh-draft', () => ({
  useSnippetRefreshDraft: () => ({
    handleRefreshWorkflowDraft: mockRefreshDraft,
  }),
}))

const createInputField = (variable: string): InputVar => ({
  type: PipelineInputVarType.textInput,
  label: variable,
  variable,
  required: false,
})

describe('snippet/use-nodes-sync-draft', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useSnippetDraftStore.getState().reset()
    reactFlowState = {
      getNodes: mockGetNodes,
      edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2', data: { stable: true } }],
      transform: [12, 24, 1.5],
    }
    workflowStoreState = {
      syncWorkflowDraftHash: 'draft-hash',
      setDraftUpdatedAt: mockSetDraftUpdatedAt,
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
    }
    mockUseNodesReadOnlyByCanEdit.mockReturnValue({ getNodesReadOnly: mockGetNodesReadOnly })
    mockGetNodesReadOnly.mockReturnValue(false)
    mockGetNodes.mockReturnValue([
      { id: 'node-1', position: { x: 0, y: 0 }, data: { title: 'Start', _temp: 'drop' } },
    ])
    mockSyncDraftWorkflow.mockResolvedValue({
      hash: 'next-hash',
      updated_at: 123,
    })
    mockSetSyncWorkflowDraftHash.mockImplementation((hash: string) => {
      workflowStoreState.syncWorkflowDraftHash = hash
    })
    useSnippetDraftStore.getState().setInputFields([createInputField('topic')])
  })

  it.each([
    { code: 'draft_workflow_not_sync', skipRefresh: false, refreshes: 1 },
    { code: 'draft_workflow_not_sync', skipRefresh: true, refreshes: 0 },
    { code: 'forbidden', skipRefresh: false, refreshes: 0 },
  ])(
    'recovers from $code with skipRefresh=$skipRefresh and allows retry',
    async ({ code, skipRefresh, refreshes }) => {
      mockSyncDraftWorkflow.mockRejectedValueOnce(
        new ORPCError(code, {
          status: code === 'forbidden' ? 403 : 409,
          message: 'Draft could not be saved',
          data: {
            code,
            message: 'Draft could not be saved',
            status: code === 'forbidden' ? 403 : 409,
          },
        }),
      )
      const callback = { onError: vi.fn(), onSuccess: vi.fn(), onSettled: vi.fn() }
      const { result } = renderHook(() => useNodesSyncDraft('snippet-1'))

      await act(async () => {
        expect(await result.current.doSyncWorkflowDraft(skipRefresh, callback)).toBeUndefined()
      })

      expect(mockRefreshDraft).toHaveBeenCalledTimes(refreshes)
      expect(callback.onError).toHaveBeenCalledOnce()
      expect(callback.onSuccess).not.toHaveBeenCalled()
      expect(callback.onSettled).toHaveBeenCalledOnce()
      expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalled()
      expect(useSnippetDraftStore.getState().inputFields).toEqual([createInputField('topic')])

      await act(async () => {
        await result.current.doSyncWorkflowDraft(false, callback)
      })

      expect(callback.onSuccess).toHaveBeenCalledOnce()
      expect(callback.onSettled).toHaveBeenCalledTimes(2)
      expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('next-hash')
    },
  )

  it('should include current input_fields when syncing the draft graph', async () => {
    const { result } = renderHook(() => useNodesSyncDraft('snippet-1'))

    await act(async () => {
      await result.current.doSyncWorkflowDraft()
    })

    expect(mockSyncDraftWorkflow).toHaveBeenCalledWith({
      params: { snippet_id: 'snippet-1' },
      body: {
        graph: {
          nodes: [{ id: 'node-1', position: { x: 0, y: 0 }, data: { title: 'Start' } }],
          edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2', data: { stable: true } }],
          viewport: { x: 12, y: 24, zoom: 1.5 },
        },
        input_fields: [createInputField('topic')],
        hash: 'draft-hash',
      },
    })
  })

  it('should include the latest graph when syncing input fields', async () => {
    const { result } = renderHook(() => useNodesSyncDraft('snippet-1'))
    const nextFields = [createInputField('summary')]

    await act(async () => {
      await result.current.syncInputFieldsDraft(nextFields)
    })

    expect(mockSyncDraftWorkflow).toHaveBeenCalledWith({
      params: { snippet_id: 'snippet-1' },
      body: {
        graph: {
          nodes: [{ id: 'node-1', position: { x: 0, y: 0 }, data: { title: 'Start' } }],
          edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2', data: { stable: true } }],
          viewport: { x: 12, y: 24, zoom: 1.5 },
        },
        input_fields: nextFields,
        hash: 'draft-hash',
      },
    })
  })

  it('queues saves across hook instances while preserving captured graphs and advancing the hash', async () => {
    const firstSave = createDeferred<{ hash: string; updated_at: number }>()
    mockSyncDraftWorkflow.mockReturnValueOnce(firstSave.promise)
    const { result: firstHook } = renderHook(() => useNodesSyncDraft('snippet-1'))
    const { result: secondHook } = renderHook(() => useNodesSyncDraft('snippet-1'))
    let first!: ReturnType<typeof firstHook.current.doSyncWorkflowDraft>
    let second!: ReturnType<typeof secondHook.current.doSyncWorkflowDraft>
    act(() => {
      first = firstHook.current.doSyncWorkflowDraft()
    })
    await waitFor(() => expect(mockSyncDraftWorkflow).toHaveBeenCalledOnce())

    const queuedNode = { id: 'queued-node', position: { x: 2, y: 3 }, data: { title: 'Queued' } }
    mockGetNodes.mockReturnValue([queuedNode])
    reactFlowState.edges = []
    reactFlowState.transform = [20, 30, 1.2]
    act(() => {
      second = secondHook.current.doSyncWorkflowDraft()
    })
    expect(mockSyncDraftWorkflow).toHaveBeenCalledOnce()
    // Changes made after enqueueing must not replace the captured graph.
    mockGetNodes.mockReturnValue([])
    reactFlowState.transform = [0, 0, 1]
    await act(async () => {
      firstSave.resolve({ hash: 'hash-after-first', updated_at: 123 })
      await Promise.all([first, second])
    })

    expect(mockSyncDraftWorkflow).toHaveBeenNthCalledWith(1, {
      params: { snippet_id: 'snippet-1' },
      body: expect.objectContaining({ hash: 'draft-hash' }),
    })
    expect(mockSyncDraftWorkflow).toHaveBeenNthCalledWith(2, {
      params: { snippet_id: 'snippet-1' },
      body: {
        graph: { nodes: [queuedNode], edges: [], viewport: { x: 20, y: 30, zoom: 1.2 } },
        input_fields: [createInputField('topic')],
        hash: 'hash-after-first',
      },
    })
    expect(workflowStoreState.syncWorkflowDraftHash).toBe('next-hash')
  })

  it('should send input_fields together with graph on page close', () => {
    const { result } = renderHook(() => useNodesSyncDraft('snippet-1'))

    act(() => {
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockPostWithKeepalive).toHaveBeenCalledWith('/api/snippets/snippet-1/workflows/draft', {
      graph: {
        nodes: [{ id: 'node-1', position: { x: 0, y: 0 }, data: { title: 'Start' } }],
        edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2', data: { stable: true } }],
        viewport: { x: 12, y: 24, zoom: 1.5 },
      },
      input_fields: [createInputField('topic')],
      hash: 'draft-hash',
    })
  })
})

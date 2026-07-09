import type { SnippetInputField } from '@/models/snippet'
import { act, renderHook } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetDraftStore } from '../../draft-store'
import { useNodesSyncDraft } from '../use-nodes-sync-draft'

const mockGetNodes = vi.fn()
const mockGetNodesReadOnly = vi.fn()
const mockUseNodesReadOnlyByCanEdit = vi.fn()
const mockPostWithKeepalive = vi.fn()
const mockSyncDraftWorkflow = vi.fn()
const mockSetDraftUpdatedAt = vi.fn()
const mockSetSyncWorkflowDraftHash = vi.fn()
let deferSerialCallbacks = false
let queuedSerialCallbacks: Array<() => Promise<void> | void> = []

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
  useNodesReadOnly: () => {
    throw new Error('Missing HooksStoreContext.Provider in the tree')
  },
  useNodesReadOnlyByCanEdit: (canEdit: boolean) => mockUseNodesReadOnlyByCanEdit(canEdit),
}))

vi.mock('@/app/components/workflow/hooks/use-serial-async-callback', () => ({
  useSerialAsyncCallback: (fn: (...args: unknown[]) => Promise<void>, checkFn?: () => boolean) =>
    (...args: unknown[]) => {
      if (checkFn?.())
        return

      if (deferSerialCallbacks) {
        queuedSerialCallbacks.push(() => fn(...args))
        return Promise.resolve()
      }

      return fn(...args)
    },
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => workflowStoreState,
  }),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    snippets: {
      bySnippetId: {
        workflows: {
          draft: {
            post: (...args: unknown[]) => mockSyncDraftWorkflow(...args),
          },
        },
      },
    },
  },
}))

vi.mock('@/service/fetch', () => ({
  postWithKeepalive: (...args: unknown[]) => mockPostWithKeepalive(...args),
}))

vi.mock('@/config', () => ({ API_PREFIX: '/api' }))

vi.mock('../use-snippet-refresh-draft', () => ({
  useSnippetRefreshDraft: () => ({
    handleRefreshWorkflowDraft: vi.fn(),
  }),
}))

const createInputField = (variable: string): SnippetInputField => ({
  type: PipelineInputVarType.textInput,
  label: variable,
  variable,
  required: false,
})

describe('snippet/use-nodes-sync-draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deferSerialCallbacks = false
    queuedSerialCallbacks = []
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
    expect(mockUseNodesReadOnlyByCanEdit).toHaveBeenCalledWith(true)
  })

  it('should keep draft input_fields when the navigation store is reset during route leave', () => {
    const { result } = renderHook(() => useNodesSyncDraft('snippet-1'))

    act(() => {
      result.current.syncWorkflowDraftWhenPageClose()
    })

    expect(mockPostWithKeepalive).toHaveBeenCalledWith('/api/snippets/snippet-1/workflows/draft', expect.objectContaining({
      input_fields: [createInputField('topic')],
    }))
  })

  it('should snapshot graph before queued draft sync executes', async () => {
    deferSerialCallbacks = true
    const { result } = renderHook(() => useNodesSyncDraft('snippet-1'))

    await act(async () => {
      await result.current.doSyncWorkflowDraft()
    })

    mockGetNodes.mockReturnValue([
      { id: 'late-node', position: { x: 9, y: 9 }, data: { title: 'Late' } },
    ])
    reactFlowState.edges = [{ id: 'late-edge', source: 'late-node', target: 'late-target', data: { stable: false } }]
    reactFlowState.transform = [99, 88, 0.5]

    await act(async () => {
      await Promise.all(queuedSerialCallbacks.map(run => run()))
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

  it('should serialize draft sync across hook instances and use the latest returned hash', async () => {
    const { result: firstHook } = renderHook(() => useNodesSyncDraft('snippet-1'))
    const { result: secondHook } = renderHook(() => useNodesSyncDraft('snippet-1'))

    mockSyncDraftWorkflow
      .mockResolvedValueOnce({
        hash: 'hash-after-first-sync',
        updated_at: 123,
      })
      .mockResolvedValueOnce({
        hash: 'hash-after-second-sync',
        updated_at: 124,
      })

    await act(async () => {
      await Promise.all([
        firstHook.current.doSyncWorkflowDraft(),
        secondHook.current.doSyncWorkflowDraft(),
      ])
    })

    expect(mockSyncDraftWorkflow).toHaveBeenNthCalledWith(1, {
      params: { snippet_id: 'snippet-1' },
      body: expect.objectContaining({
        hash: 'draft-hash',
      }),
    })
    expect(mockSyncDraftWorkflow).toHaveBeenNthCalledWith(2, {
      params: { snippet_id: 'snippet-1' },
      body: expect.objectContaining({
        hash: 'hash-after-first-sync',
      }),
    })
    expect(workflowStoreState.syncWorkflowDraftHash).toBe('hash-after-second-sync')
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

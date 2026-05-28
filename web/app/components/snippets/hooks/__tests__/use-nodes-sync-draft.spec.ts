import type { SnippetInputField } from '@/models/snippet'
import { act, renderHook } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetDetailStore } from '../../store'
import { useNodesSyncDraft } from '../use-nodes-sync-draft'

const mockGetNodes = vi.fn()
const mockGetNodesReadOnly = vi.fn()
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
  useNodesReadOnly: () => ({ getNodesReadOnly: mockGetNodesReadOnly }),
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
      syncDraftWorkflow: (...args: unknown[]) => mockSyncDraftWorkflow(...args),
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
    mockGetNodesReadOnly.mockReturnValue(false)
    mockGetNodes.mockReturnValue([
      { id: 'node-1', position: { x: 0, y: 0 }, data: { title: 'Start', _temp: 'drop' } },
    ])
    mockSyncDraftWorkflow.mockResolvedValue({
      hash: 'next-hash',
      updated_at: 123,
    })
    useSnippetDetailStore.setState({
      fields: [createInputField('topic')],
    })
  })

  it('should include current input_fields when syncing the draft graph', async () => {
    const { result } = renderHook(() => useNodesSyncDraft('snippet-1'))

    await act(async () => {
      await result.current.doSyncWorkflowDraft()
    })

    expect(mockSyncDraftWorkflow).toHaveBeenCalledWith({
      params: { snippetId: 'snippet-1' },
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
      params: { snippetId: 'snippet-1' },
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
      params: { snippetId: 'snippet-1' },
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

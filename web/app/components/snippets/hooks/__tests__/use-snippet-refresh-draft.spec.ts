import type { SnippetWorkflow } from '@/types/snippet'
import { renderHook, waitFor } from '@testing-library/react'
import { useSnippetRefreshDraft } from '../use-snippet-refresh-draft'

const mockFetchSnippetDraftWorkflow = vi.fn()
const mockHandleUpdateWorkflowCanvas = vi.fn()
const mockSnippetSetState = vi.fn()
const mockSetDraftUpdatedAt = vi.fn()
const mockSetIsSyncingWorkflowDraft = vi.fn()
const mockSetSyncWorkflowDraftHash = vi.fn()

const workflowStoreState = {
  setDraftUpdatedAt: mockSetDraftUpdatedAt,
  setIsSyncingWorkflowDraft: mockSetIsSyncingWorkflowDraft,
  setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
}

vi.mock('@/service/use-snippet-workflows', () => ({
  fetchSnippetDraftWorkflow: (...args: unknown[]) => mockFetchSnippetDraftWorkflow(...args),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowUpdate: () => ({
    handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas,
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => workflowStoreState,
  }),
}))

vi.mock('../../draft-store', () => ({
  useSnippetDraftStore: {
    setState: (...args: unknown[]) => mockSnippetSetState(...args),
  },
}))

const createDraftWorkflow = (overrides: Partial<SnippetWorkflow> = {}): SnippetWorkflow =>
  ({
    id: 'draft-1',
    graph: {
      nodes: [{ id: 'node-1' }],
      edges: [],
      viewport: { x: 10, y: 20, zoom: 1.2 },
    },
    features: {},
    input_fields: [],
    hash: 'draft-hash',
    created_at: 1_712_300_000,
    updated_at: 1_712_345_678,
    ...overrides,
  }) as SnippetWorkflow

describe('useSnippetRefreshDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should refresh the draft workflow through the silent draft fetcher', async () => {
    const draftWorkflow = createDraftWorkflow()
    const onSuccess = vi.fn()
    mockFetchSnippetDraftWorkflow.mockResolvedValueOnce(draftWorkflow)

    const { result } = renderHook(() => useSnippetRefreshDraft('snippet-1'))

    result.current.handleRefreshWorkflowDraft(onSuccess)

    await waitFor(() => {
      expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledWith({
        nodes: [{ id: 'node-1' }],
        edges: [],
        viewport: { x: 10, y: 20, zoom: 1.2 },
      })
    })
    expect(mockFetchSnippetDraftWorkflow).toHaveBeenCalledWith('snippet-1')
    expect(mockSnippetSetState).toHaveBeenCalledWith({
      inputFields: [],
    })
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('draft-hash')
    expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith(1_712_345_678)
    expect(onSuccess).toHaveBeenCalledWith(draftWorkflow)
    expect(mockSetIsSyncingWorkflowDraft).toHaveBeenNthCalledWith(1, true)
    expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false)
  })

  it('should silently finish when the draft workflow does not exist yet', async () => {
    mockFetchSnippetDraftWorkflow.mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useSnippetRefreshDraft('snippet-1'))

    result.current.handleRefreshWorkflowDraft()

    await waitFor(() => {
      expect(mockSetIsSyncingWorkflowDraft).toHaveBeenLastCalledWith(false)
    })
    expect(mockFetchSnippetDraftWorkflow).toHaveBeenCalledWith('snippet-1')
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
    expect(mockSnippetSetState).not.toHaveBeenCalled()
  })
})

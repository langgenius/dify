import type { SnippetWorkflow } from '@/types/snippet'
import { act, waitFor } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { PipelineInputVarType } from '@/models/pipeline'
import { createDeferred } from '@/test/deferred'
import { useSnippetDraftStore } from '../../draft-store'
import { useSnippetRefreshDraft } from '../use-snippet-refresh-draft'

const mockFetchSnippetDraftWorkflow = vi.fn()
const mockHandleUpdateWorkflowCanvas = vi.fn()
vi.mock('@/service/use-snippet-workflows', () => ({
  fetchSnippetDraftWorkflow: (...args: unknown[]) => mockFetchSnippetDraftWorkflow(...args),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({ handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas }),
}))

const initialFields = [
  {
    type: PipelineInputVarType.textInput,
    label: 'Query',
    variable: 'query',
    required: true,
  },
]

beforeEach(() => {
  vi.resetAllMocks()
  useSnippetDraftStore.getState().reset()
  useSnippetDraftStore.getState().setInputFields(initialFields)
})

it('keeps syncing until the draft arrives, then replaces canvas, fields and version state', async () => {
  const pending = createDeferred<SnippetWorkflow>()
  const draft: SnippetWorkflow = {
    id: 'draft-1',
    graph: {
      nodes: [createNode({ id: 'node-1' })],
      edges: [],
      viewport: { x: 10, y: 20, zoom: 1.2 },
    },
    features: {},
    input_fields: [],
    hash: 'draft-hash',
    created_at: 1_712_300_000,
    updated_at: 1_712_345_678,
  }
  mockFetchSnippetDraftWorkflow.mockReturnValueOnce(pending.promise)
  const onSuccess = vi.fn()
  const { result, store } = renderWorkflowHook(() => useSnippetRefreshDraft('snippet-1'), {
    resource: { kind: 'snippet', snippetId: 'snippet-1' },
  })

  act(() => result.current.handleRefreshWorkflowDraft(onSuccess))
  expect(store.getState().isSyncingWorkflowDraft).toBe(true)
  expect(onSuccess).not.toHaveBeenCalled()
  expect(useSnippetDraftStore.getState().inputFields).toEqual(initialFields)
  await act(async () => pending.resolve(draft))

  await waitFor(() => expect(store.getState().isSyncingWorkflowDraft).toBe(false))
  expect(mockFetchSnippetDraftWorkflow).toHaveBeenCalledExactlyOnceWith('snippet-1')
  expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledExactlyOnceWith(draft.graph)
  expect(useSnippetDraftStore.getState().inputFields).toEqual([])
  expect(store.getState().syncWorkflowDraftHash).toBe('draft-hash')
  expect(store.getState().draftUpdatedAt).toBe(1_712_345_678_000)
  expect(onSuccess).toHaveBeenCalledExactlyOnceWith(draft)
})

it('finishes without replacing editor state when no draft exists yet', async () => {
  mockFetchSnippetDraftWorkflow.mockResolvedValueOnce(undefined)
  const onSuccess = vi.fn()
  const { result, store } = renderWorkflowHook(() => useSnippetRefreshDraft('snippet-1'), {
    resource: { kind: 'snippet', snippetId: 'snippet-1' },
    initialStoreState: { syncWorkflowDraftHash: 'existing-hash', draftUpdatedAt: 1000 },
  })
  act(() => result.current.handleRefreshWorkflowDraft(onSuccess))
  await waitFor(() => expect(store.getState().isSyncingWorkflowDraft).toBe(false))

  expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()
  expect(useSnippetDraftStore.getState().inputFields).toEqual(initialFields)
  expect(store.getState().syncWorkflowDraftHash).toBe('existing-hash')
  expect(store.getState().draftUpdatedAt).toBe(1000)
  expect(onSuccess).not.toHaveBeenCalled()
})

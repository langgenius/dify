import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store/workflow'
import { act, waitFor } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { createDeferred } from '@/test/deferred'
import { createRagPipelineSliceSlice } from '../../store'
import { usePipelineRefreshDraft } from '../use-pipeline-refresh-draft'

// Canvas replacement is delivered through the workflow event bus, owned by its own suite.
const mockHandleUpdateWorkflowCanvas = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-workflow-update', () => ({
  useWorkflowUpdate: () => ({
    handleUpdateWorkflowCanvas: mockHandleUpdateWorkflowCanvas,
  }),
}))

const mockFetchWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (url: string) => mockFetchWorkflowDraft(url),
}))

const createDraft = (overrides: Record<string, unknown> = {}) => ({
  graph: {
    nodes: [createNode({ id: 'source', data: { type: BlockEnum.DataSource } })],
    edges: [],
    viewport: { x: 10, y: 20, zoom: 1.5 },
  },
  hash: 'new-hash',
  environment_variables: [],
  rag_pipeline_variables: [],
  ...overrides,
})

const renderRefreshDraft = () =>
  renderWorkflowCanvasHook(() => usePipelineRefreshDraft(), {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
    injectWorkflowStoreSliceFn: createRagPipelineSliceSlice as InjectWorkflowStoreSliceFn,
    initialStoreState: { syncWorkflowDraftHash: 'old-hash' },
  })

describe('usePipelineRefreshDraft', () => {
  it('marks the draft as syncing until the server draft replaces the canvas and pipeline state', async () => {
    const draft = createDraft({
      rag_pipeline_variables: [{ variable: 'query', type: 'text-input' }],
    })
    const pending = createDeferred<typeof draft>()
    mockFetchWorkflowDraft.mockReturnValue(pending.promise)
    const { result, store } = renderRefreshDraft()

    act(() => result.current.handleRefreshWorkflowDraft())

    expect(mockFetchWorkflowDraft).toHaveBeenCalledExactlyOnceWith(
      '/rag/pipelines/test-pipeline-id/workflows/draft',
    )
    expect(store.getState().isSyncingWorkflowDraft).toBe(true)
    expect(mockHandleUpdateWorkflowCanvas).not.toHaveBeenCalled()

    await act(async () => pending.resolve(draft))

    await waitFor(() => expect(store.getState().isSyncingWorkflowDraft).toBe(false))
    expect(mockHandleUpdateWorkflowCanvas).toHaveBeenCalledExactlyOnceWith(draft.graph)
    expect(store.getState()).toMatchObject({
      syncWorkflowDraftHash: 'new-hash',
      ragPipelineVariables: draft.rag_pipeline_variables,
    })
  })

  it('keeps secret environment values out of the visible variables', async () => {
    mockFetchWorkflowDraft.mockResolvedValue(
      createDraft({
        environment_variables: [
          { id: 'env-1', value_type: 'secret', value: 'secret-value' },
          { id: 'env-2', value_type: 'string', value: 'plain-value' },
        ],
      }),
    )
    const { result, store } = renderRefreshDraft()

    act(() => result.current.handleRefreshWorkflowDraft())

    await waitFor(() => expect(store.getState().isSyncingWorkflowDraft).toBe(false))
    expect(store.getState()).toMatchObject({
      envSecrets: { 'env-1': 'secret-value' },
      environmentVariables: [
        { id: 'env-1', value_type: 'secret', value: '[__HIDDEN__]' },
        { id: 'env-2', value_type: 'string', value: 'plain-value' },
      ],
    })
  })

  it('clears environment state when the draft has no environment variables', async () => {
    mockFetchWorkflowDraft.mockResolvedValue(createDraft({ environment_variables: undefined }))
    const { result, store } = renderRefreshDraft()
    act(() => {
      store.setState({
        envSecrets: { stale: 'value' },
        environmentVariables: [
          { id: 'stale', name: 'STALE', value_type: 'string', value: 'x', description: '' },
        ],
      })
    })

    act(() => result.current.handleRefreshWorkflowDraft())

    await waitFor(() => expect(store.getState().isSyncingWorkflowDraft).toBe(false))
    expect(store.getState()).toMatchObject({ envSecrets: {}, environmentVariables: [] })
  })
})

import type { DatasetDetailWithPartialMembersResponse as DataSet } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode } from 'react'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store/workflow'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import DatasetDetailContext from '@/context/dataset-detail'
import { createHttpError } from '@/service/http-error'
import { createDeferred } from '@/test/deferred'
import { createRagPipelineSliceSlice } from '../../store'
import { usePipelineInit } from '../use-pipeline-init'

const mockFetchWorkflowDraft = vi.fn()
const mockSyncWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (url: string) => mockFetchWorkflowDraft(url),
  syncWorkflowDraft: (params: unknown) => mockSyncWorkflowDraft(params),
}))

// Default block/publish/upload config queries are covered by use-pipeline-config.spec.
vi.mock('../use-pipeline-config', () => ({
  usePipelineConfig: vi.fn(),
}))

const createDraft = (overrides: Record<string, unknown> = {}) => ({
  graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  hash: 'test-hash',
  updated_at: 1_704_067_200,
  tool_published: true,
  environment_variables: [],
  rag_pipeline_variables: [],
  ...overrides,
})

const knowledgeDataset = {
  name: 'Test Knowledge',
  icon_info: { icon: 'test-icon', icon_type: 'emoji' },
} as unknown as DataSet

const renderPipelineInit = ({ dataset }: { dataset?: DataSet } = { dataset: knowledgeDataset }) =>
  renderWorkflowCanvasHook(() => usePipelineInit(), {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
    injectWorkflowStoreSliceFn: createRagPipelineSliceSlice as InjectWorkflowStoreSliceFn,
    wrapper: ({ children }: { children: ReactNode }) => (
      <DatasetDetailContext.Provider value={{ dataset }}>{children}</DatasetDetailContext.Provider>
    ),
  })

describe('usePipelineInit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchWorkflowDraft.mockResolvedValue(createDraft())
  })

  it('shows the dataset name and icon in the pipeline editor', () => {
    const { store } = renderPipelineInit()

    expect(store.getState()).toMatchObject({
      knowledgeName: 'Test Knowledge',
      knowledgeIcon: { icon: 'test-icon', icon_type: 'emoji' },
    })
  })

  it('still loads the draft when the dataset has no presentation metadata', async () => {
    const { result, store } = renderPipelineInit({})

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(store.getState().knowledgeName).toBeUndefined()
  })

  it('stays loading until the draft arrives, then loads draft metadata into the editor', async () => {
    const draft = createDraft({
      rag_pipeline_variables: [{ variable: 'query', type: 'text-input' }],
    })
    const pending = createDeferred<typeof draft>()
    mockFetchWorkflowDraft.mockReturnValue(pending.promise)
    const { result, store } = renderPipelineInit()

    expect(result.current).toEqual({ data: undefined, isLoading: true })
    expect(mockFetchWorkflowDraft).toHaveBeenCalledExactlyOnceWith(
      '/rag/pipelines/test-pipeline-id/workflows/draft',
    )
    expect(store.getState().isWorkflowDataLoaded).toBe(false)

    await act(async () => pending.resolve(draft))

    await waitFor(() => expect(result.current).toEqual({ data: draft, isLoading: false }))
    expect(store.getState()).toMatchObject({
      isWorkflowDataLoaded: true,
      draftUpdatedAt: draft.updated_at * 1000,
      toolPublished: true,
      syncWorkflowDraftHash: 'test-hash',
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
    const { result, store } = renderPipelineInit()

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(store.getState()).toMatchObject({
      envSecrets: { 'env-1': 'secret-value' },
      environmentVariables: [
        { id: 'env-1', value_type: 'secret', value: '[__HIDDEN__]' },
        { id: 'env-2', value_type: 'string', value: 'plain-value' },
      ],
    })
  })

  it('treats missing pipeline variables as an empty list', async () => {
    mockFetchWorkflowDraft.mockResolvedValue(createDraft({ rag_pipeline_variables: undefined }))
    const { result, store } = renderPipelineInit()
    act(() => store.setState({ ragPipelineVariables: [{ variable: 'stale' }] } as never))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(store.getState().ragPipelineVariables).toEqual([])
  })

  it('creates the knowledge base template draft when the pipeline has no draft yet', async () => {
    mockFetchWorkflowDraft.mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 404 }), {
        code: 'draft_workflow_not_exist',
        message: 'Draft workflow not exist.',
        status: 404,
      }),
    )
    mockFetchWorkflowDraft.mockResolvedValueOnce(createDraft({ hash: 'new-hash' }))
    mockSyncWorkflowDraft.mockResolvedValue({ updated_at: 1_704_153_600 })
    const { result, store } = renderPipelineInit()

    await waitFor(() => expect(result.current.data?.hash).toBe('new-hash'))
    expect(store.getState()).toMatchObject({
      notInitialWorkflow: true,
      shouldAutoOpenStartNodeSelector: true,
      isWorkflowDataLoaded: true,
    })
    expect(mockSyncWorkflowDraft).toHaveBeenCalledExactlyOnceWith({
      url: '/rag/pipelines/test-pipeline-id/workflows/draft',
      params: {
        graph: {
          nodes: [expect.objectContaining({ id: 'knowledgeBase' })],
          edges: [],
        },
        environment_variables: [],
      },
    })
  })
})

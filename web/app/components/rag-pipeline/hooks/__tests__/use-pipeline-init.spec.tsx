import type { DatasetDetailWithPartialMembersResponse as DataSet } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode } from 'react'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store/workflow'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { toast } from '@/app/notifications'
import DatasetDetailContext from '@/context/dataset-detail'
import { createHttpError } from '@/service/http-error'
import { createDeferred } from '@/test/deferred'
import { createRagPipelineSliceSlice } from '../../store'
import { usePipelineInit } from '../use-pipeline-init'

const mockFetchWorkflowDraft = vi.fn()
const mockRequest = vi.hoisted(() => vi.fn<typeof import('@/service/base').request>())
vi.mock('@/service/base', () => ({
  request: mockRequest,
}))
// Validate rejections against the contract, as the console link does.
vi.mock('@/service/workflow', async () => {
  const { rag } = await import('@dify/contracts/api/console/rag/orpc.gen')
  const { validateDefinedErrors } = await import('@/service/console/defined-errors')
  const validate = validateDefinedErrors({ rag })
  return {
    fetchPipelineWorkflowDraft: (pipelineId: string) =>
      validate({
        context: {},
        input: { params: { pipeline_id: pipelineId } },
        path: ['rag', 'pipelines', 'byPipelineId', 'workflows', 'draft', 'get'],
        next: () => mockFetchWorkflowDraft(pipelineId),
      }),
  }
})

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

const notExistError = () =>
  createHttpError(new Response(null, { status: 404 }), {
    code: 'draft_workflow_not_exist',
    message: 'Draft workflow not exist.',
    status: 404,
  })
const draftUnavailableError = () =>
  createHttpError(
    { status: 500, statusText: '', headers: new Headers() },
    { message: 'Draft unavailable' },
  )
const toastError = vi.spyOn(toast, 'error')

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
    expect(mockFetchWorkflowDraft).toHaveBeenCalledExactlyOnceWith('test-pipeline-id')
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
    mockFetchWorkflowDraft.mockRejectedValueOnce(notExistError())
    mockFetchWorkflowDraft.mockResolvedValueOnce(createDraft({ hash: 'new-hash' }))
    mockRequest.mockResolvedValue(Response.json({ updated_at: 1_704_153_600 }))
    const { result, store } = renderPipelineInit()

    await waitFor(() => expect(result.current.data?.hash).toBe('new-hash'))
    expect(store.getState()).toMatchObject({
      notInitialWorkflow: true,
      shouldAutoOpenStartNodeSelector: true,
      isWorkflowDataLoaded: true,
    })
    expect(mockRequest).toHaveBeenCalledOnce()
    const request = mockRequest.mock.calls[0]![2]!.request!
    expect(new URL(request.url).pathname).toBe(
      '/console/api/rag/pipelines/test-pipeline-id/workflows/draft',
    )
    expect(request.method).toBe('POST')
    await expect(request.json()).resolves.toEqual({
      graph: {
        nodes: [expect.objectContaining({ id: 'knowledgeBase' })],
        edges: [],
      },
      environment_variables: [],
    })
  })

  it('reports a missing-draft code the contract does not document for that status', async () => {
    mockFetchWorkflowDraft.mockRejectedValue(
      createHttpError(new Response(null, { status: 500 }), {
        code: 'draft_workflow_not_exist',
        message: 'Draft workflow not exist.',
        status: 500,
      }),
    )
    const { result } = renderPipelineInit()

    await waitFor(() => expect(toastError).toHaveBeenCalledOnce())
    expect(result.current.isLoading).toBe(true)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('shows the server message when the draft fails to load', async () => {
    mockFetchWorkflowDraft.mockRejectedValue(draftUnavailableError())
    const { result } = renderPipelineInit()

    await waitFor(() => expect(toastError).toHaveBeenCalledExactlyOnceWith('Draft unavailable'))
    expect(result.current.isLoading).toBe(true)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('shows the server message when creating the template draft fails', async () => {
    mockFetchWorkflowDraft.mockRejectedValueOnce(notExistError())
    // The transport rejects a failed response with the decoded backend envelope.
    mockRequest.mockRejectedValue(
      createHttpError(new Response(null, { status: 500 }), { message: 'Draft unavailable' }),
    )
    const { result } = renderPipelineInit()

    await waitFor(() => expect(toastError).toHaveBeenCalledExactlyOnceWith('Draft unavailable'))
    expect(result.current.isLoading).toBe(true)
  })
})

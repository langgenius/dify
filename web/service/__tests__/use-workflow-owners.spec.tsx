import type { ReactNode } from 'react'
import type { WorkflowVersionOwner } from '../use-workflow'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  useDeleteWorkflow,
  useInvalidateWorkflowRunHistory,
  usePublishPipelineWorkflow,
  useUpdateWorkflow,
  useWorkflowRunHistory,
  useWorkflowVersionHistory,
} from '../use-workflow'

const mockCall = vi.hoisted(() => vi.fn())

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: mockCall },
}))

const createQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

const renderWithClient = <Result,>(hook: () => Result, queryClient = createQueryClient()) =>
  renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })

const owners: Array<[WorkflowVersionOwner, string[], Record<string, string>]> = [
  [{ kind: 'app', appId: 'app-1' }, ['apps', 'byAppId'], { app_id: 'app-1' }],
  [
    { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    ['rag', 'pipelines', 'byPipelineId'],
    { pipeline_id: 'pipeline-1' },
  ],
  [
    { kind: 'snippet', snippetId: 'snippet-1' },
    ['snippets', 'bySnippetId'],
    { snippet_id: 'snippet-1' },
  ],
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useWorkflowRunHistory', () => {
  const resources: Array<[EditorResource, string[], Record<string, string>]> = [
    [
      { kind: 'app', appId: 'app-1', mode: 'workflow' },
      ['apps', 'byAppId', 'workflowRuns', 'get'],
      { app_id: 'app-1' },
    ],
    [
      { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
      ['apps', 'byAppId', 'advancedChat', 'workflowRuns', 'get'],
      { app_id: 'app-1' },
    ],
    [
      { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
      ['rag', 'pipelines', 'byPipelineId', 'workflowRuns', 'get'],
      { pipeline_id: 'pipeline-1' },
    ],
    [
      { kind: 'snippet', snippetId: 'snippet-1' },
      ['snippets', 'bySnippetId', 'workflowRuns', 'get'],
      { snippet_id: 'snippet-1' },
    ],
  ]

  it.each(resources)('lists %o runs as history items', async (resource, path, params) => {
    mockCall.mockResolvedValue({
      data: [
        {
          id: 'run-1',
          status: 'succeeded',
          conversation_id: null,
          created_at: 10,
          finished_at: null,
          created_by_account: { id: 'u1', name: 'Alice', email: 'a@example.com' },
        },
      ],
      has_more: false,
      limit: 20,
    })

    const { result } = renderWithClient(() => useWorkflowRunHistory(resource))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockCall).toHaveBeenCalledWith(path, { params }, expect.any(Object))
    expect(result.current.data).toEqual([
      {
        id: 'run-1',
        status: 'succeeded',
        conversation_id: undefined,
        created_at: 10,
        finished_at: undefined,
        created_by_name: 'Alice',
      },
    ])
  })

  it.each(resources)('invalidates the %o run history', async (resource) => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderWithClient(
      () => useInvalidateWorkflowRunHistory(resource),
      queryClient,
    )

    await act(() => result.current())

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: expect.any(Array) })
  })
})

describe('useWorkflowVersionHistory', () => {
  it.each(owners)('pages %o versions through the draft mapper', async (owner, prefix, params) => {
    mockCall.mockResolvedValue({
      items: [
        {
          id: 'version-1',
          graph: { nodes: [{ id: 'start', data: { type: BlockEnum.Start } }], edges: [] },
          features: {},
          hash: 'hash-1',
          version: '1',
          marked_name: '',
          marked_comment: '',
          created_at: 1,
          updated_at: 1,
          tool_published: false,
          environment_variables: [],
          conversation_variables: [],
          rag_pipeline_variables: [],
        },
      ],
      has_more: false,
      page: 1,
      limit: 10,
    })

    const { result } = renderWithClient(() =>
      useWorkflowVersionHistory({
        owner,
        initialPage: 1,
        limit: 10,
        userId: 'u1',
        namedOnly: true,
      }),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const query =
      owner.kind === 'snippet'
        ? { page: 1, limit: 10 }
        : { page: 1, limit: 10, user_id: 'u1', named_only: true }
    expect(mockCall).toHaveBeenCalledWith(
      [...prefix, 'workflows', 'get'],
      { params, query },
      expect.any(Object),
    )
    expect(result.current.data?.pages[0]?.items[0]?.graph.nodes[0]?.data).toMatchObject({
      type: BlockEnum.Start,
      title: '',
    })
    expect(result.current.hasNextPage).toBe(false)
  })
})

describe('version mutations', () => {
  it.each(owners)('deletes a %o version', async (owner, prefix, params) => {
    mockCall.mockResolvedValue(undefined)
    const { result } = renderWithClient(() => useDeleteWorkflow())

    await act(() => result.current.mutateAsync({ owner, workflowId: 'version-1' }))

    expect(mockCall).toHaveBeenCalledWith(
      [...prefix, 'workflows', 'byWorkflowId', 'delete'],
      { params: { ...params, workflow_id: 'version-1' } },
      expect.any(Object),
    )
  })

  it.each(owners.slice(1))(
    'updates a %o version without touching app caches',
    async (owner, prefix, params) => {
      mockCall.mockResolvedValue({ id: 'version-1' })
      const queryClient = createQueryClient()
      const setQueryData = vi.spyOn(queryClient, 'setQueryData')
      const { result } = renderWithClient(() => useUpdateWorkflow(), queryClient)

      await act(() =>
        result.current.mutateAsync({
          owner,
          workflowId: 'version-1',
          title: 'Release',
          releaseNotes: 'Notes',
        }),
      )

      expect(mockCall).toHaveBeenCalledWith(
        [...prefix, 'workflows', 'byWorkflowId', 'patch'],
        {
          params: { ...params, workflow_id: 'version-1' },
          body: { marked_name: 'Release', marked_comment: 'Notes' },
        },
        expect.any(Object),
      )
      expect(setQueryData).not.toHaveBeenCalled()
    },
  )

  it('publishes a knowledge pipeline', async () => {
    mockCall.mockResolvedValue({ result: 'success', created_at: 1 })
    const { result } = renderWithClient(() => usePublishPipelineWorkflow())

    await act(() => result.current.mutateAsync('pipeline-1'))

    expect(mockCall).toHaveBeenCalledWith(
      ['rag', 'pipelines', 'byPipelineId', 'workflows', 'publish', 'post'],
      { params: { pipeline_id: 'pipeline-1' } },
      expect.any(Object),
    )
  })
})

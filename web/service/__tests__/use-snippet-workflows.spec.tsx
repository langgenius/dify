import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { consoleClient, consoleQuery } from '@/service/client'
import {
  fetchSnippetDraftWorkflow,
  usePublishSnippetWorkflowMutation,
  useSnippetDefaultBlockConfigs,
  useSnippetPublishedWorkflow,
} from '../use-snippet-workflows'

const {
  mockDefaultBlockConfigsQueryOptions,
  mockDraftWorkflow,
  mockDraftWorkflowKey,
  mockLastRunKey,
  mockPublishedWorkflow,
  mockPublishedWorkflowKey,
  mockPublishedWorkflowQueryOptions,
  mockPublishWorkflow,
  mockWorkflowRunsKey,
} = vi.hoisted(() => ({
  mockDefaultBlockConfigsQueryOptions: vi.fn((options: { input: unknown, enabled?: boolean }) => ({
    enabled: options.enabled,
    queryKey: ['snippet-workflow-default-block-configs', options.input],
    queryFn: () => Promise.resolve([{ type: 'llm' }]),
  })),
  mockDraftWorkflow: vi.fn(),
  mockDraftWorkflowKey: vi.fn((input?: unknown) => ['snippet-workflow-draft', input]),
  mockLastRunKey: vi.fn((input?: unknown) => ['snippet-workflow-last-run', input]),
  mockPublishedWorkflow: vi.fn(),
  mockPublishedWorkflowKey: vi.fn((input?: unknown) => ['snippet-workflow-published', input]),
  mockPublishedWorkflowQueryOptions: vi.fn((options: { input: unknown, enabled?: boolean }) => ({
    enabled: options.enabled,
    queryKey: ['snippet-workflow-published', options.input],
    queryFn: () => mockPublishedWorkflow(options.input),
  })),
  mockPublishWorkflow: vi.fn(),
  mockWorkflowRunsKey: vi.fn((input?: unknown) => ['snippet-workflow-runs', input]),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    snippets: {
      bySnippetId: {
        workflows: {
          draft: {
            get: mockDraftWorkflow,
            nodes: {
              byNodeId: {
                lastRun: {
                  get: {
                    key: mockLastRunKey,
                  },
                },
              },
            },
          },
          publish: {
            post: mockPublishWorkflow,
          },
        },
      },
    },
  },
  consoleQuery: {
    snippets: {
      bySnippetId: {
        workflowRuns: {
          get: {
            key: mockWorkflowRunsKey,
          },
        },
        workflows: {
          defaultWorkflowBlockConfigs: {
            get: {
              queryOptions: mockDefaultBlockConfigsQueryOptions,
            },
          },
          draft: {
            get: {
              key: mockDraftWorkflowKey,
            },
            nodes: {
              byNodeId: {
                lastRun: {
                  get: {
                    key: mockLastRunKey,
                  },
                },
              },
            },
          },
          publish: {
            get: {
              key: mockPublishedWorkflowKey,
              queryOptions: mockPublishedWorkflowQueryOptions,
            },
            post: {
              mutationKey: () => ['snippet-workflow-publish'],
            },
          },
        },
      },
    },
  },
}))

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    mutations: { retry: false },
    queries: { retry: false },
  },
})

const createWrapper = (queryClient = createQueryClient()) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const workflow = {
  created_at: 1_704_067_200,
  features: {},
  graph: {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  hash: 'hash-1',
  id: 'workflow-1',
  updated_at: 1_704_153_600,
}

describe('use-snippet-workflows service hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDraftWorkflow.mockResolvedValue(workflow)
    mockPublishedWorkflow.mockResolvedValue(workflow)
    mockPublishWorkflow.mockResolvedValue({
      created_at: 1_704_153_600,
      result: 'success',
    })
  })

  it('should fetch draft workflow through the generated draft workflow client', async () => {
    const result = await fetchSnippetDraftWorkflow('snippet-1')

    expect(result).toEqual(workflow)
    expect(consoleClient.snippets.bySnippetId.workflows.draft.get).toHaveBeenCalledWith({
      params: { snippet_id: 'snippet-1' },
    })
  })

  it('should return undefined when draft workflow is not found', async () => {
    mockDraftWorkflow.mockRejectedValue({ status: 404 })

    await expect(fetchSnippetDraftWorkflow('missing-snippet')).resolves.toBeUndefined()
  })

  it('should call onSuccess after fetching the published workflow', async () => {
    const onSuccess = vi.fn()
    const { result } = renderHook(
      () => useSnippetPublishedWorkflow('snippet-1', onSuccess),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.current.data).toEqual(workflow)
    })
    expect(consoleQuery.snippets.bySnippetId.workflows.publish.get.queryOptions).toHaveBeenCalledWith({
      enabled: true,
      input: {
        params: { snippet_id: 'snippet-1' },
      },
    })
    expect(onSuccess).toHaveBeenCalledWith(workflow)
  })

  it('should call onSuccess after fetching default block configs', async () => {
    const onSuccess = vi.fn()
    const { result } = renderHook(
      () => useSnippetDefaultBlockConfigs('snippet-1', onSuccess),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.current.data).toEqual([{ type: 'llm' }])
    })
    expect(consoleQuery.snippets.bySnippetId.workflows.defaultWorkflowBlockConfigs.get.queryOptions).toHaveBeenCalledWith({
      enabled: true,
      input: {
        params: { snippet_id: 'snippet-1' },
      },
    })
    expect(onSuccess).toHaveBeenCalledWith([{ type: 'llm' }])
  })

  it('should publish workflow through generated params and invalidate workflow query keys', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(
      () => usePublishSnippetWorkflowMutation('snippet-1'),
      { wrapper: createWrapper(queryClient) },
    )

    await result.current.mutateAsync({ params: { snippetId: 'snippet-1' } })

    expect(mockPublishWorkflow).toHaveBeenCalledWith({
      body: {},
      params: { snippet_id: 'snippet-1' },
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['snippet-workflow-draft', {
        input: {
          params: { snippet_id: 'snippet-1' },
        },
        type: 'query',
      }],
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['snippet-workflow-published', {
        input: {
          params: { snippet_id: 'snippet-1' },
        },
        type: 'query',
      }],
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['snippet-workflow-runs', { type: 'query' }],
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['snippet-workflow-last-run', { type: 'query' }],
    })
  })
})

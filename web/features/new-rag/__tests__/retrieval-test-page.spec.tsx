import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { RetrievalTestPage } from '../retrieval-test-page'

const apiMock = vi.hoisted(() => ({
  cancelResearch: vi.fn(),
  createBadCase: vi.fn(),
  createGolden: vi.fn(),
  createResearch: vi.fn(),
  planResearch: vi.fn(),
  queryAdmission: vi.fn(),
  refetchPartials: vi.fn(),
  refetchTasks: vi.fn(),
  refetchTraces: vi.fn(),
  traceDetail: undefined as Record<string, unknown> | undefined,
  traces: [] as Array<Record<string, unknown>>,
}))

const navigationMock = vi.hoisted(() => ({
  trace: undefined as string | undefined,
}))

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'trace' ? navigationMock.trace : undefined),
  }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useQuery: (options: { queryKey?: string[] }) => {
      const resource = options.queryKey?.[0]
      if (resource === 'traces')
        return {
          data: { data: apiMock.traces },
          isPending: false,
          refetch: apiMock.refetchTraces,
        }
      if (resource === 'trace-detail')
        return {
          data: apiMock.traceDetail,
          isPending: false,
        }
      if (resource === 'tasks')
        return {
          data: { data: [] },
          refetch: apiMock.refetchTasks,
        }
      if (resource === 'partials')
        return {
          data: undefined,
          refetch: apiMock.refetchPartials,
        }
      return { data: undefined, isPending: false }
    },
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          queries: { admission: { post: apiMock.queryAdmission } },
          goldenQuestions: { post: apiMock.createGolden },
          quality: { badCases: { post: apiMock.createBadCase } },
          researchTasks: {
            byTaskId: { delete: apiMock.cancelResearch },
            plan: { post: apiMock.planResearch },
            post: apiMock.createResearch,
          },
        },
      },
    },
  },
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          researchTasks: {
            byTaskId: {
              partials: {
                get: {
                  queryOptions: () => ({ queryKey: ['partials'] }),
                },
              },
            },
            get: {
              queryOptions: () => ({ queryKey: ['tasks'] }),
            },
          },
          traces: {
            byTraceId: {
              get: {
                queryOptions: () => ({ queryKey: ['trace-detail'] }),
              },
              evidence: {
                get: {
                  queryOptions: () => ({ queryKey: ['evidence'] }),
                },
              },
            },
            get: {
              queryOptions: () => ({ queryKey: ['traces'] }),
            },
          },
        },
      },
    },
  },
}))

describe('RetrievalTestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.planResearch.mockResolvedValue({
      budget: { budget_usd: 1, exceeds_budget: false },
      estimates: {},
      knowledge_space_id: 'space-1',
      query: 'Compare the refund policies',
      retrieval_plan: { top_k: 8 },
      steps: [],
      strategy_version: 'research-dry-run-planner-v1',
    })
    apiMock.createResearch.mockResolvedValue({
      cost: {},
      created_at: 1_800_000_000,
      id: 'research-1',
      knowledge_space_id: 'space-1',
      metadata: {},
      query: 'Compare the refund policies',
      stage: 'queued',
      updated_at: 1_800_000_000,
    })
    apiMock.refetchTasks.mockResolvedValue(undefined)
    apiMock.createBadCase.mockResolvedValue({ id: 'bad-case-1' })
    apiMock.traceDetail = undefined
    apiMock.traces = []
    navigationMock.trace = undefined
  })

  it('starts research from the segmented composer with the planned budget', async () => {
    const user = userEvent.setup()
    render(<RetrievalTestPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.retrievalTest.title' }),
    ).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.retrievalTest.emptyTitle')).toBeInTheDocument()

    await user.type(
      screen.getByLabelText('dataset.newKnowledge.retrievalTest.queryPlaceholder'),
      'Compare the refund policies',
    )
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.retrievalMode.research',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.retrievalTest.startResearch' }),
    )

    await waitFor(() =>
      expect(apiMock.planResearch).toHaveBeenCalledWith({
        body: { mode: 'research', query: 'Compare the refund policies' },
        params: { control_space_id: 'space-1' },
      }),
    )
    expect(apiMock.createResearch).toHaveBeenCalledWith({
      body: {
        budgetUsd: 1,
        mode: 'research',
        query: 'Compare the refund policies',
        topK: 8,
      },
      params: { control_space_id: 'space-1' },
    })
  })

  it('persists a selected trace as a production bad case', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'Why did retrieval miss the refund exception?',
        scores: {},
        stages: [],
      },
    ]
    const user = userEvent.setup()
    render(<RetrievalTestPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByText('Why did retrieval miss the refund exception?'))
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.retrievalTest.makeBadCase',
      }),
    )

    await waitFor(() =>
      expect(apiMock.createBadCase).toHaveBeenCalledWith({
        body: {
          reason: 'Why did retrieval miss the refund exception?',
          tags: ['retrieval-test'],
          trace_id: 'trace-1',
        },
        params: { control_space_id: 'space-1' },
      }),
    )
    expect(screen.getByText('dataset.newKnowledge.retrievalTest.savedBadCase')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'dataset.newKnowledge.retrievalTest.viewInQuality' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/quality')
  })

  it('loads a deep-linked trace detail when it is not present in the first list page', async () => {
    navigationMock.trace = 'trace-old'
    apiMock.traceDetail = {
      completed: true,
      created_at: '2026-07-01T00:00:00.000Z',
      id: 'trace-old',
      mode: 'deep',
      profile: {},
      query: 'An older production question',
      scores: {},
      stages: [],
    }
    const user = userEvent.setup()
    render(<RetrievalTestPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('heading', { name: 'An older production question' }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.retrievalTest.makeBadCase',
      }),
    )

    await waitFor(() =>
      expect(apiMock.createBadCase).toHaveBeenCalledWith({
        body: {
          reason: 'An older production question',
          tags: ['retrieval-test'],
          trace_id: 'trace-old',
        },
        params: { control_space_id: 'space-1' },
      }),
    )
  })
})

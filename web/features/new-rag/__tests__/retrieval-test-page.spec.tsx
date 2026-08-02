import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
  partials: [] as Array<Record<string, unknown>>,
  queryAdmission: vi.fn(),
  refetchPartials: vi.fn(),
  refetchTasks: vi.fn(),
  refetchTraces: vi.fn(),
  researchTasks: [] as Array<Record<string, unknown>>,
  streamCapability: vi.fn(),
  streamQuery: vi.fn(),
  streamResearchEvents: vi.fn(),
  documentReferences: {} as Record<string, { id: string; title: string }>,
  evidence: undefined as Record<string, unknown> | undefined,
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

vi.mock('../services/knowledge-query-events', () => ({
  streamKnowledgeQuery: apiMock.streamQuery,
}))

vi.mock('../services/research-task-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/research-task-events')>()),
  streamResearchTaskEvents: apiMock.streamResearchEvents,
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
      if (resource === 'evidence')
        return {
          data: apiMock.evidence,
          isPending: false,
        }
      if (resource === 'retrieval-document-references')
        return {
          data: apiMock.documentReferences,
          isPending: false,
        }
      if (resource === 'tasks')
        return {
          data: { data: apiMock.researchTasks },
          refetch: apiMock.refetchTasks,
        }
      if (resource === 'partials')
        return {
          data: { data: apiMock.partials },
          refetch: apiMock.refetchPartials,
        }
      return { data: undefined, isPending: false }
    },
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      tasks: {
        byTaskId: {
          streamCapability: { post: apiMock.streamCapability },
        },
      },
      spaces: {
        byControlSpaceId: {
          queries: { admission: { post: apiMock.queryAdmission } },
          logicalDocuments: { get: vi.fn() },
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
          goldenQuestions: {
            get: {
              key: () => ['quality', 'golden'],
            },
          },
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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return {
    queryClient,
    ...render(<RetrievalTestPage knowledgeSpaceId="space-1" />, { wrapper: Wrapper }),
  }
}

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
    apiMock.refetchTraces.mockResolvedValue(undefined)
    apiMock.researchTasks = []
    apiMock.streamCapability.mockResolvedValue({
      expires_at: '2026-07-31T10:30:00.000Z',
      operation_id: 'streamResearchTask',
      token: 'capability-token',
      url: 'https://knowledge.example.test/research/events',
    })
    apiMock.streamQuery.mockResolvedValue(undefined)
    apiMock.streamResearchEvents.mockResolvedValue({
      reconnect: false,
      terminal: false,
    })
    apiMock.queryAdmission.mockResolvedValue({})
    apiMock.createBadCase.mockResolvedValue({ id: 'bad-case-1' })
    apiMock.createGolden.mockResolvedValue({ id: 'golden-1' })
    apiMock.documentReferences = {}
    apiMock.evidence = undefined
    apiMock.partials = []
    apiMock.traceDetail = undefined
    apiMock.traces = []
    navigationMock.trace = undefined
  })

  it('starts research from the segmented composer with the planned budget', async () => {
    const user = userEvent.setup()
    renderPage()

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

  it('replays research progress events and shows actual stage durations', async () => {
    apiMock.researchTasks = [
      {
        completed_at: 1_800_000_025,
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-completed',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'Compare the refund policies',
        stage: 'completed',
        updated_at: 1_800_000_025,
      },
    ]
    apiMock.streamResearchEvents.mockImplementation(
      async ({
        onEvent,
      }: {
        onEvent: (event: {
          createdAt: string
          id: string
          payload: Record<string, unknown>
          researchTaskJobId: string
          sequence: number
          stage: string
          type: string
        }) => void
      }) => {
        const stages = [
          ['planning', 0],
          ['retrieving', 2],
          ['analyzing', 7],
          ['generating', 14],
          ['completed', 25],
        ] as const
        stages.forEach(([stage, seconds], index) =>
          onEvent({
            createdAt: new Date(1_800_000_000_000 + seconds * 1000).toISOString(),
            id: `event-${index + 1}`,
            payload: {},
            researchTaskJobId: 'research-completed',
            sequence: index + 1,
            stage,
            type: index ? 'research_task.stage_changed' : 'research_task.started',
          }),
        )
        return { cursor: '5', reconnect: false, terminal: true }
      },
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByText('Compare the refund policies'))
    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.retrievalTest.processLog',
      }),
    ).toHaveAttribute('aria-pressed', 'true')

    await waitFor(() =>
      expect(apiMock.streamCapability).toHaveBeenCalledWith({
        body: { control_space_id: 'space-1' },
        params: { task_id: 'research-completed' },
      }),
    )
    expect(apiMock.streamResearchEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: expect.objectContaining({ operation_id: 'streamResearchTask' }),
      }),
    )
    expect(await screen.findByText('2s')).toBeInTheDocument()
    expect(screen.getByText('5s')).toBeInTheDocument()
    expect(screen.getByText('7s')).toBeInTheDocument()
    expect(screen.getByText('11s')).toBeInTheDocument()
    expect(apiMock.refetchTasks).not.toHaveBeenCalled()
    expect(apiMock.refetchPartials).not.toHaveBeenCalled()
  })

  it('renders generated Research answer deltas while the task is still active', async () => {
    apiMock.researchTasks = [
      {
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-active',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'What is the warranty?',
        stage: 'generating',
        updated_at: 1_800_000_005,
      },
    ]
    apiMock.streamResearchEvents.mockImplementation(
      async ({ onEvent }: { onEvent: (event: Record<string, unknown>) => void }) => {
        onEvent({
          createdAt: '2027-01-15T08:00:10.000Z',
          id: 'answer-1',
          payload: { delta: 'The warranty ', executionAttempt: 1, offset: 0 },
          researchTaskJobId: 'research-active',
          sequence: 1,
          stage: 'generating',
          type: 'research_task.answer_delta',
        })
        onEvent({
          createdAt: '2027-01-15T08:00:11.000Z',
          id: 'answer-2',
          payload: { delta: 'is two years.', executionAttempt: 1, offset: 13 },
          researchTaskJobId: 'research-active',
          sequence: 2,
          stage: 'generating',
          type: 'research_task.answer_delta',
        })
        return { cursor: '2', reconnect: false, terminal: false }
      },
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByText('What is the warranty?'))

    const answer = await screen.findByText('The warranty is two years.')
    expect(answer.closest('[aria-live="polite"]')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: 'dataset.newKnowledge.retrievalTest.generatingActive',
      }),
    ).toBeInTheDocument()
  })

  it('shows the persisted final answer when reopening completed Research history', async () => {
    apiMock.researchTasks = [
      {
        completed_at: 1_800_000_025,
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-completed',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'What is the warranty?',
        stage: 'completed',
        updated_at: 1_800_000_025,
      },
    ]
    apiMock.partials = [
      {
        answer: 'The persisted warranty answer.',
        evidence_bundle: {},
        knowledge_space_id: 'space-1',
        research_task_job_id: 'research-completed',
        sequence: 1,
      },
    ]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByText('What is the warranty?'))

    expect(await screen.findByText('The persisted warranty answer.')).toBeInTheDocument()
    expect(
      screen.queryByText('dataset.newKnowledge.retrievalTest.noChunksTitle'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.retrievalTest.generating' }),
    ).toBeInTheDocument()
  })

  it('reconnects an active research event stream from its latest cursor', async () => {
    apiMock.researchTasks = [
      {
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-active',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'Compare the refund policies',
        stage: 'retrieving',
        updated_at: 1_800_000_005,
      },
    ]
    apiMock.streamResearchEvents
      .mockResolvedValueOnce({ cursor: '3', reconnect: true, terminal: false })
      .mockResolvedValueOnce({ cursor: '4', reconnect: false, terminal: true })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByText('Compare the refund policies'))

    await waitFor(() => expect(apiMock.streamCapability).toHaveBeenCalledTimes(2))
    expect(apiMock.streamResearchEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: '3' }),
    )
  })

  it('refreshes final partials only once when a streamed task completes', async () => {
    const activeTask = {
      cost: {},
      created_at: 1_800_000_000,
      id: 'research-active',
      knowledge_space_id: 'space-1',
      metadata: {},
      mode: 'research',
      query: 'Compare the refund policies',
      stage: 'retrieving',
      updated_at: 1_800_000_005,
    }
    apiMock.researchTasks = [activeTask]
    apiMock.refetchTasks.mockImplementation(async () => {
      apiMock.researchTasks = [
        {
          ...activeTask,
          completed_at: 1_800_000_025,
          stage: 'completed',
          updated_at: 1_800_000_025,
        },
      ]
    })
    apiMock.streamResearchEvents.mockImplementation(
      async ({
        onEvent,
      }: {
        onEvent: (event: {
          createdAt: string
          id: string
          payload: Record<string, unknown>
          researchTaskJobId: string
          sequence: number
          stage: string
          type: string
        }) => void
      }) => {
        onEvent({
          createdAt: '2027-01-15T08:00:25.000Z',
          id: 'event-completed',
          payload: {},
          researchTaskJobId: 'research-active',
          sequence: 5,
          stage: 'completed',
          type: 'research_task.stage_changed',
        })
        return { cursor: '5', reconnect: false, terminal: true }
      },
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByText('Compare the refund policies'))

    await waitFor(() => expect(apiMock.refetchTasks).toHaveBeenCalledOnce())
    await waitFor(() => expect(apiMock.refetchPartials).toHaveBeenCalledOnce())
  })

  it('does not let the composer shortcut bypass an active research task', async () => {
    apiMock.researchTasks = [
      {
        cost: {},
        created_at: 1_800_000_000,
        id: 'research-active',
        knowledge_space_id: 'space-1',
        metadata: {},
        mode: 'research',
        query: 'Compare the refund policies',
        stage: 'retrieving',
        updated_at: 1_800_000_005,
      },
    ]
    const user = userEvent.setup()
    renderPage()

    expect(
      screen.getByText('dataset.newKnowledge.retrievalTest.retrievingActive · 2/4'),
    ).toBeInTheDocument()
    await user.click(screen.getByText('Compare the refund policies'))
    const queryInput = screen.getByLabelText('dataset.newKnowledge.retrievalTest.queryPlaceholder')
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.retrievalTest.startResearch' }),
    ).toBeDisabled()

    await user.click(queryInput)
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(apiMock.planResearch).not.toHaveBeenCalled()
    expect(apiMock.queryAdmission).not.toHaveBeenCalled()
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
    renderPage()

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

  it('invalidates the quality list after keeping a golden question', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'What is useEffect?',
        scores: {},
        stages: [],
      },
    ]
    apiMock.evidence = {
      data: [
        {
          kind: 'resource',
          metadata: {
            score: 0.9,
            text: 'useEffect synchronizes a component with an external system.',
          },
          name: 'chunk-1',
          path: '/queries/trace-1/evidence/chunk-1',
          resourceType: 'node',
          targetId: 'chunk-1',
        },
      ],
    }
    const user = userEvent.setup()
    const { queryClient } = renderPage()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByText('What is useEffect?'))
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.retrievalTest.keepGoldenQuestion',
      }),
    )

    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['quality', 'golden'],
      }),
    )
    expect(
      screen.getByText('dataset.newKnowledge.retrievalTest.savedGoldenQuestion'),
    ).toBeInTheDocument()
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
    renderPage()

    expect(
      screen.getByRole('heading', {
        name: 'dataset.newKnowledge.retrievalTest.result',
      }),
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

  it('opens retrieval evidence through its logical document instead of its asset', async () => {
    apiMock.traces = [
      {
        completed: true,
        created_at: '2026-07-29T00:00:00.000Z',
        id: 'trace-1',
        mode: 'fast',
        profile: {},
        query: 'What is the refund policy?',
        scores: {},
        stages: [],
      },
    ]
    apiMock.evidence = {
      data: [
        {
          kind: 'resource',
          metadata: {
            documentId: 'asset-1',
            score: 0.9,
            text: 'Refunds are available within 30 days.',
          },
          name: 'chunk-1',
          path: '/queries/trace-1/evidence/chunk-1',
          resourceType: 'node',
          targetId: 'chunk-1',
        },
      ],
    }
    apiMock.documentReferences = {
      'asset-1': { id: 'document-1', title: 'refund-policy.txt' },
    }
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByText('What is the refund policy?'))

    expect(
      screen.getByRole('link', { name: 'dataset.newKnowledge.retrievalTest.open' }),
    ).toHaveAttribute('href', '/datasets/new/space-1/documents/document-1')
    expect(screen.getByText('refund-policy.txt')).toBeInTheDocument()
  })

  it('keeps a failed run in Records and renders the failure inline', async () => {
    apiMock.streamQuery.mockRejectedValueOnce(new Error('provider timed out'))
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText('dataset.newKnowledge.retrievalTest.queryPlaceholder'),
      'Why did this fail?',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retrievalTest.run' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.retrievalTest.failedTitle',
    )
    expect(screen.getAllByText('Why did this fail?')).toHaveLength(2)
    expect(screen.getByText('provider timed out')).toBeInTheDocument()
  })

  it('maps an empty unpublished knowledge space to the designed no-results state', async () => {
    apiMock.streamQuery.mockRejectedValueOnce(
      new Response('Published runtime snapshot unavailable', { status: 503 }),
    )
    const user = userEvent.setup()
    renderPage()

    await user.type(
      screen.getByLabelText('dataset.newKnowledge.retrievalTest.queryPlaceholder'),
      'Anything here?',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retrievalTest.run' }))

    expect(
      await screen.findByText('dataset.newKnowledge.retrievalTest.noChunksTitle'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('dataset.newKnowledge.retrievalTest.failedTitle'),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText('Anything here?')).toHaveLength(2)
  })
})

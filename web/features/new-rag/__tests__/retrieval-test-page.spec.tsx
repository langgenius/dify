import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { RetrievalTestPage } from '../retrieval-test-page'

const apiMock = vi.hoisted(() => ({
  cancelResearch: vi.fn(),
  createResearch: vi.fn(),
  planResearch: vi.fn(),
  queryAdmission: vi.fn(),
  refetchPartials: vi.fn(),
  refetchTasks: vi.fn(),
  refetchTraces: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useQuery: (options: { queryKey?: string[] }) => {
      const resource = options.queryKey?.[0]
      if (resource === 'traces')
        return {
          data: { data: [] },
          isPending: false,
          refetch: apiMock.refetchTraces,
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
})

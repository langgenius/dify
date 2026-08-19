import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { QualityEvaluationPanel } from '../quality/quality-evaluation-panel'

const serviceMock = vi.hoisted(() => ({
  createReplay: vi.fn(),
  getReplay: vi.fn(),
  listReplays: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          quality: {
            replayRuns: {
              byRunId: {
                get: {
                  queryOptions: ({ input }: { input: unknown }) => ({
                    queryFn: () => serviceMock.getReplay(input),
                    queryKey: ['quality', 'evaluation', 'detail', input],
                  }),
                },
              },
              get: {
                infiniteOptions: (options: {
                  getNextPageParam: (page: { next_cursor?: string | null }) => string | undefined
                  initialPageParam: string | null
                  input: (pageParam: string | null) => unknown
                }) => ({
                  getNextPageParam: options.getNextPageParam,
                  initialPageParam: options.initialPageParam,
                  queryFn: ({ pageParam }: { pageParam: string | null }) =>
                    serviceMock.listReplays(options.input(pageParam)),
                  queryKey: ['quality', 'evaluation', 'list'],
                }),
              },
              post: {
                mutationOptions: () => ({ mutationFn: serviceMock.createReplay }),
              },
            },
          },
        },
      },
    },
  },
}))

const completedRun = {
  attempt: 1,
  created_at: '2026-08-19T12:00:00.000Z',
  id: 'run-1',
  items: [
    {
      golden_question_id: 'question-1',
      id: 'item-1',
      match_policy: 'any',
      ordinal: 0,
      question: 'Who can change workspace permissions?',
      result: {
        evidence_diff: {
          expected_count: 2,
          matched_count: 1,
          missing_count: 1,
          retrieved_count: 10,
        },
        metrics: { total_ms: 1250 },
        passed: true,
      },
      state: 'passed',
    },
  ],
  knowledge_space_id: 'space-1',
  mode: 'fast',
  provenance: {
    projection: { projection_version: 7 },
    retrieval: {
      profile_revision: 4,
      reasoning_model: 'gpt-5.6',
      rerank_model: 'rerank-v3.5',
    },
  },
  revision: 2,
  state: 'passed',
  summary: { completed: 1, failed: 0, hit_rate: 1, passed: 1, total: 1 },
  updated_at: '2026-08-19T12:00:02.000Z',
} as const

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(<QualityEvaluationPanel knowledgeSpaceId="space-1" />, { wrapper: Wrapper })
}

describe('QualityEvaluationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMock.listReplays.mockResolvedValue({ data: [], next_cursor: null })
    serviceMock.createReplay.mockResolvedValue({ ...completedRun, state: 'queued' })
    serviceMock.getReplay.mockResolvedValue(completedRun)
  })

  it('explains the empty state before the first evaluation run', async () => {
    renderPanel()

    expect(
      await screen.findByText('dataset.newKnowledge.qualityPage.evaluation.emptyTitle'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.run',
      }),
    ).toBeEnabled()
  })

  it('queues every active golden question and opens the persisted evidence report', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByText('dataset.newKnowledge.qualityPage.evaluation.emptyTitle')
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.run',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.start',
      }),
    )

    await waitFor(() =>
      expect(serviceMock.createReplay).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { selection: 'all-active' },
          headers: { 'Idempotency-Key': expect.any(String) },
          params: { control_space_id: 'space-1' },
        }),
        expect.anything(),
      ),
    )
    expect(await screen.findByText('Who can change workspace permissions?')).toBeVisible()
    expect(screen.getByText('1/2')).toBeVisible()
    expect(screen.getByText('dataset.newKnowledge.qualityPage.matchPolicy.any')).toBeVisible()
    expect(serviceMock.getReplay).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', run_id: 'run-1' },
    })
  })
})

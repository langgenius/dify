import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
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

const completedRunWithEvidence = {
  ...completedRun,
  items: [
    {
      ...completedRun.items[0],
      result: {
        ...completedRun.items[0].result,
        evidence_diff: {
          ...completedRun.items[0].result.evidence_diff,
          evidence_items: [
            {
              available: true,
              document_name: 'Workspace permissions.pdf',
              matched: true,
              ordinal: 1,
              page_number: 2,
              section_path: ['Permissions', 'Roles'],
              text: 'Workspace owners can change member permissions.',
            },
            {
              available: true,
              document_name: 'Workspace permissions.pdf',
              matched: false,
              ordinal: 2,
              page_number: 3,
              section_path: ['Permissions', 'Limitations'],
              text: 'Editors cannot promote themselves to owner.',
            },
          ],
        },
      },
    },
  ],
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

  it('opens evaluation settings in an accessible centered modal', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByText('dataset.newKnowledge.qualityPage.evaluation.emptyTitle')
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.run',
      }),
    )

    const dialog = screen.getByRole('dialog', {
      name: 'dataset.newKnowledge.qualityPage.evaluation.dialogTitle',
    })
    expect(dialog).toHaveClass(
      'fixed',
      'top-1/2',
      'left-1/2',
      '-translate-x-1/2',
      '-translate-y-1/2',
    )
    expect(dialog).toHaveAccessibleDescription(
      'dataset.newKnowledge.qualityPage.evaluation.dialogDescription',
    )
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

  it('opens evidence hit details and identifies matched and missing passages', async () => {
    const user = userEvent.setup()
    serviceMock.listReplays.mockResolvedValue({ data: [completedRun], next_cursor: null })
    serviceMock.getReplay.mockImplementation(async (input) =>
      'query' in input && input.query.evidence_item_id ? completedRunWithEvidence : completedRun,
    )
    renderPanel()

    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.viewReport',
      }),
    )
    await screen.findByText('Who can change workspace permissions?')
    await user.click(
      screen.getByRole('button', {
        name: /^dataset\.newKnowledge\.qualityPage\.evaluation\.openEvidenceDetails/,
      }),
    )

    expect(
      await screen.findByRole('dialog', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.evidenceDetailsTitle',
      }),
    ).toBeVisible()
    const matchedSection = screen.getByRole('region', {
      name: 'dataset.newKnowledge.qualityPage.evaluation.passed',
    })
    const missingSection = screen.getByRole('region', {
      name: 'dataset.newKnowledge.qualityPage.evaluation.missed',
    })
    expect(
      within(matchedSection).getByText('Workspace owners can change member permissions.'),
    ).toBeVisible()
    expect(
      within(missingSection).getByText('Editors cannot promote themselves to owner.'),
    ).toBeVisible()
    expect(serviceMock.getReplay).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', run_id: 'run-1' },
      query: { evidence_item_id: 'item-1' },
    })

    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.closeDialog' }),
    )
    expect(
      screen.queryByRole('dialog', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.evidenceDetailsTitle',
      }),
    ).not.toBeInTheDocument()
  })
})

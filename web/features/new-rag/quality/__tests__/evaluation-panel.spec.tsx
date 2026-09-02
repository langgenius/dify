import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { render } from '@/test/console/render'
import { EvaluationReport, QualityEvaluationPanel } from '../quality-evaluation-panel'

const serviceMock = vi.hoisted(() => ({
  createReplay: vi.fn(),
  getReplay: vi.fn(),
  listGoldenQuestions: vi.fn(),
  listReplays: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('../../space/context', () => ({
  useKnowledgeSpace: () => ({ space: { control_space_id: 'space-1' } }),
  useKnowledgeSpacePermission: () => true,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          goldenQuestions: {
            get: {
              queryOptions: ({ input }: { input: unknown }) => ({
                queryFn: () => serviceMock.listGoldenQuestions(input),
                queryKey: ['quality', 'golden-questions', input],
              }),
            },
          },
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
                key: () => ['quality', 'evaluation', 'list'],
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

const queuedRun = {
  ...completedRun,
  items: completedRun.items.map((item) => ({
    ...item,
    result: null,
    state: 'queued' as const,
  })),
  revision: 1,
  state: 'queued' as const,
  summary: { completed: 0, failed: 0, hit_rate: 0, passed: 0, total: 1 },
  updated_at: completedRun.created_at,
}

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

function renderPanel(
  queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  }),
) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  function Harness() {
    const [runId, setRunId] = useState<string>()
    return runId ? (
      <EvaluationReport runId={runId} onBack={() => setRunId(undefined)} onRunStarted={setRunId} />
    ) : (
      <QualityEvaluationPanel onOpenReport={setRunId} />
    )
  }
  return render(<Harness />, { wrapper: Wrapper })
}

describe('QualityEvaluationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMock.listGoldenQuestions.mockResolvedValue({
      data: Array.from({ length: 6 }, (_, index) => ({
        id: `golden-${index + 1}`,
        status: 'active',
      })),
      next_cursor: null,
    })
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

  it('shows evaluation creation time as a relative list label', async () => {
    const now = Date.parse(completedRun.created_at) + 2 * 60 * 60 * 1000
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    serviceMock.listReplays.mockResolvedValue({
      data: [
        { ...completedRun, created_at: new Date(now).toISOString(), id: 'run-now' },
        completedRun,
      ],
      next_cursor: null,
    })

    renderPanel()

    expect(await screen.findByText('dataset.newKnowledge.retrievalTest.justNow')).toBeVisible()
    expect(await screen.findByText('2 hours ago')).toBeVisible()
    dateNowSpy.mockRestore()
  })

  it('separates the report date and time with a middle dot', async () => {
    const user = userEvent.setup()
    const createdAt = new Date(completedRun.created_at)
    const expected = `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(createdAt)} · ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(createdAt)}`
    serviceMock.listReplays.mockResolvedValue({ data: [completedRun], next_cursor: null })

    renderPanel()
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.viewReport',
      }),
    )

    expect(await screen.findByText(expected)).toBeVisible()
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
      'dataset.newKnowledge.qualityPage.evaluation.dialogDescription_other:{"count":6}',
    )
    expect(
      screen.getByRole('radio', {
        name: 'dataset.newKnowledge.settings.retrievalMode.fast',
      }),
    ).toBeChecked()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('uses singular copy for one active golden question', async () => {
    const user = userEvent.setup()
    serviceMock.listGoldenQuestions.mockResolvedValue({
      data: [{ id: 'golden-1', status: 'active' }],
      next_cursor: null,
    })
    renderPanel()

    await screen.findByText('dataset.newKnowledge.qualityPage.evaluation.emptyTitle')
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.run',
      }),
    )

    expect(
      screen.getByRole('dialog', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.dialogTitle',
      }),
    ).toHaveAccessibleDescription(
      'dataset.newKnowledge.qualityPage.evaluation.dialogDescription_one:{"count":1}',
    )
  })

  it('starts each evaluation dialog session with the default retrieval mode', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByText('dataset.newKnowledge.qualityPage.evaluation.emptyTitle')
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.run',
      }),
    )
    await user.click(
      screen.getByRole('radio', {
        name: 'dataset.newKnowledge.settings.retrievalMode.deep',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.cancel' }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.run',
      }),
    )

    expect(
      screen.getByRole('radio', {
        name: 'dataset.newKnowledge.settings.retrievalMode.fast',
      }),
    ).toBeChecked()
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
          body: { mode: 'fast', selection: 'all-active' },
          headers: { 'Idempotency-Key': expect.any(String) },
          params: { control_space_id: 'space-1' },
        }),
        expect.anything(),
      ),
    )
    expect(await screen.findByText('Who can change workspace permissions?')).toBeVisible()
    expect(screen.getByText('1 of 2')).toBeVisible()
    expect(serviceMock.getReplay).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', run_id: 'run-1' },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.singleRun.reRun' }))
    expect(
      screen.getByRole('dialog', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.dialogTitle',
      }),
    ).toBeVisible()
  })

  it('shows the queued run without waiting for the evaluation list to refresh', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    })
    let listRequestCount = 0
    serviceMock.createReplay.mockResolvedValue(queuedRun)
    serviceMock.getReplay.mockImplementation(() => new Promise(() => {}))
    serviceMock.listReplays.mockImplementation(() => {
      listRequestCount += 1
      return listRequestCount === 1
        ? Promise.resolve({ data: [], next_cursor: null })
        : new Promise(() => {})
    })

    renderPanel(queryClient)

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

    expect(
      await screen.findByRole('heading', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.reportTitle',
      }),
    ).toBeVisible()
    expect(
      screen.getAllByText('dataset.newKnowledge.qualityPage.evaluation.state.queued'),
    ).not.toHaveLength(0)
  })

  it('opens a completed evaluation with the latest progress from the list', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    })
    let detailRequestCount = 0
    serviceMock.listReplays
      .mockResolvedValueOnce({ data: [queuedRun], next_cursor: null })
      .mockResolvedValueOnce({ data: [completedRun], next_cursor: null })
    serviceMock.getReplay.mockImplementation(() => {
      detailRequestCount += 1
      return detailRequestCount === 1 ? Promise.resolve(queuedRun) : new Promise(() => {})
    })

    renderPanel(queryClient)

    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.viewReport',
      }),
    )
    await screen.findAllByText('dataset.newKnowledge.qualityPage.evaluation.state.queued')
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluationTab',
      }),
    )

    expect(
      await screen.findAllByText('dataset.newKnowledge.qualityPage.evaluation.state.passed'),
    ).not.toHaveLength(0)
    expect(serviceMock.listReplays).toHaveBeenCalledTimes(2)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.viewReport',
      }),
    )

    expect(
      await screen.findAllByText('dataset.newKnowledge.qualityPage.evaluation.state.passed'),
    ).not.toHaveLength(0)
    expect(screen.getByText('1/1')).toBeVisible()
  })

  it('keeps newer report progress when the evaluation list is stale', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    })
    let detailRequestCount = 0
    serviceMock.listReplays.mockResolvedValue({ data: [queuedRun], next_cursor: null })
    serviceMock.getReplay.mockImplementation(() => {
      detailRequestCount += 1
      return detailRequestCount === 1 ? Promise.resolve(completedRun) : new Promise(() => {})
    })

    renderPanel(queryClient)

    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.viewReport',
      }),
    )
    expect(
      await screen.findAllByText('dataset.newKnowledge.qualityPage.evaluation.state.passed'),
    ).not.toHaveLength(0)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluationTab',
      }),
    )
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.qualityPage.evaluation.viewReport',
      }),
    )

    expect(
      screen.getAllByText('dataset.newKnowledge.qualityPage.evaluation.state.passed'),
    ).not.toHaveLength(0)
    expect(screen.getByText('1/1')).toBeVisible()
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

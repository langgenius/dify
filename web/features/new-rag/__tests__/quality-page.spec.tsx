import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { QualityPage } from '../quality/quality-page'

const serviceMock = vi.hoisted(() => ({
  bulkImport: vi.fn(),
  createGolden: vi.fn(),
  createReplay: vi.fn(),
  deleteGolden: vi.fn(),
  getBadCase: vi.fn(),
  getBadCases: vi.fn(),
  getGolden: vi.fn(),
  getTraceReference: vi.fn(),
  matchEvidence: vi.fn(),
  updateBadCase: vi.fn(),
  updateGolden: vi.fn(),
}))

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}))

const navigationMock = vi.hoisted(() => ({
  tab: undefined as string | undefined,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => ({
    get: (key: string) => (key === 'tab' ? navigationMock.tab : undefined),
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          quality: {
            badCases: {
              byBadCaseId: {
                get: serviceMock.getBadCase,
                patch: serviceMock.updateBadCase,
                traceReference: { get: serviceMock.getTraceReference },
              },
            },
            replayRuns: { post: serviceMock.createReplay },
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
            bulkImport: {
              post: {
                mutationOptions: () => ({ mutationFn: serviceMock.bulkImport }),
              },
            },
            byQuestionId: {
              delete: {
                mutationOptions: () => ({ mutationFn: serviceMock.deleteGolden }),
              },
              patch: {
                mutationOptions: () => ({ mutationFn: serviceMock.updateGolden }),
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
                  serviceMock.getGolden(options.input(pageParam)),
                queryKey: ['quality', 'golden'],
              }),
            },
            evidenceMatches: {
              post: {
                mutationOptions: () => ({ mutationFn: serviceMock.matchEvidence }),
              },
            },
            post: {
              mutationOptions: () => ({ mutationFn: serviceMock.createGolden }),
            },
          },
          quality: {
            badCases: {
              get: {
                infiniteOptions: (options: {
                  getNextPageParam: (page: { next_cursor?: string | null }) => string | undefined
                  initialPageParam: string | null
                  input: (pageParam: string | null) => unknown
                }) => ({
                  getNextPageParam: options.getNextPageParam,
                  initialPageParam: options.initialPageParam,
                  queryFn: ({ pageParam }: { pageParam: string | null }) =>
                    serviceMock.getBadCases(options.input(pageParam)),
                  queryKey: ['quality', 'bad-cases'],
                }),
              },
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
  return render(<QualityPage knowledgeSpaceId="space-1" />, { wrapper: Wrapper })
}

describe('QualityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMock.tab = undefined
    serviceMock.getGolden.mockResolvedValue({
      data: [
        {
          annotation: 'Must cite the refund clause.',
          created_at: '2026-07-28T00:00:00Z',
          id: 'golden-1',
          question: 'What is the refund policy?',
          tags: ['billing'],
          updated_at: '2026-07-28T00:00:00Z',
        },
      ],
      next_cursor: null,
    })
    serviceMock.getBadCases.mockResolvedValue({
      data: [
        {
          created_at: '2026-07-28T00:00:00Z',
          id: 'bad-1',
          question: 'Refund after activation',
          reason: 'coverage gap',
          revision: 1,
          status: 'open',
          tags: ['billing'],
          updated_at: '2026-07-28T00:00:00Z',
        },
      ],
      next_cursor: null,
    })
    serviceMock.createGolden.mockResolvedValue({
      annotation: 'Expected answer',
      created_at: '2026-07-29T00:00:00Z',
      id: 'golden-2',
      question: 'New question',
      tags: ['billing'],
      updated_at: '2026-07-29T00:00:00Z',
    })
    serviceMock.matchEvidence.mockResolvedValue({ candidates: [], evidence: '', matched: false })
    serviceMock.bulkImport.mockResolvedValue({ active_count: 0, draft_count: 0, items: [] })
    serviceMock.getTraceReference.mockResolvedValue({ trace_id: 'trace-42' })
    serviceMock.getBadCase.mockResolvedValue({
      created_at: '2026-07-28T00:00:00Z',
      id: 'bad-1',
      question: 'Refund after activation',
      reason: 'coverage gap',
      replay_run_id: null,
      revision: 1,
      status: 'open',
      tags: ['billing'],
      updated_at: '2026-07-28T00:00:00Z',
    })
  })

  it('renders persisted quality data and creates a golden question through the API', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('What is the refund policy?')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.addGolden' }),
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.qualityPage.questionPlaceholder'),
      'New question',
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.qualityPage.annotationPlaceholder'),
      'Expected answer',
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.save' }))

    await waitFor(() => expect(serviceMock.createGolden).toHaveBeenCalled())
    expect(serviceMock.createGolden.mock.calls[0]?.[0]).toEqual({
      body: {
        annotation: 'Expected answer',
        evidence_text: '',
        expected_evidence_ids: [],
        match_policy: 'all',
        question: 'New question',
        tags: [],
      },
      params: { control_space_id: 'space-1' },
    })
  })

  it('submits comma-separated tags', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What is the refund policy?')
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.addGolden' }),
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.qualityPage.questionPlaceholder'),
      'New question',
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.qualityPage.annotationPlaceholder'),
      'Expected answer',
    )
    const dialog = screen.getByRole('dialog')
    const tagsInput = within(dialog).getByPlaceholderText(
      'dataset.newKnowledge.qualityPage.tagsPlaceholder',
    )
    await user.type(tagsInput, 'billing, sso')

    expect(tagsInput).toHaveValue('billing, sso')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.save' }))

    await waitFor(() =>
      expect(serviceMock.createGolden.mock.calls[0]?.[0]).toEqual({
        body: {
          annotation: 'Expected answer',
          evidence_text: '',
          expected_evidence_ids: [],
          match_policy: 'all',
          question: 'New question',
          tags: ['billing', 'sso'],
        },
        params: { control_space_id: 'space-1' },
      }),
    )
  })

  it('matches a human-readable evidence passage and stores the selected node id', async () => {
    serviceMock.matchEvidence.mockResolvedValue({
      candidates: [
        {
          document_asset_id: 'document-1',
          node_id: 'node-1',
          projection_id: 'projection-1',
          score: 0.91,
          section_path: ['Refund policy'],
          text: 'Customers can request a refund within 30 days.',
        },
      ],
      evidence: 'refund within 30 days',
      matched: true,
    })
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What is the refund policy?')
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.addGolden' }),
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.qualityPage.questionPlaceholder'),
      'When can I request a refund?',
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.qualityPage.annotationPlaceholder'),
      'The answer must cite the refund window.',
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.qualityPage.evidencePlaceholder'),
      'refund within 30 days',
    )
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.findEvidence' }),
    )
    await user.click(await screen.findByText('Customers can request a refund within 30 days.'))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.save' }))

    expect(serviceMock.matchEvidence.mock.calls[0]?.[0]).toEqual({
      body: { evidence: 'refund within 30 days' },
      params: { control_space_id: 'space-1' },
    })
    await waitFor(() =>
      expect(serviceMock.createGolden.mock.calls[0]?.[0]).toEqual({
        body: {
          annotation: 'The answer must cite the refund window.',
          evidence_text: 'refund within 30 days',
          expected_evidence_ids: ['node-1'],
          match_policy: 'all',
          question: 'When can I request a refund?',
          tags: [],
        },
        params: { control_space_id: 'space-1' },
      }),
    )
  })

  it('parses a CSV and sends all rows through one bulk-import mutation', async () => {
    serviceMock.bulkImport.mockResolvedValue({ active_count: 1, draft_count: 1, items: [] })
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What is the refund policy?')
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.importCsv' }),
    )
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    await user.upload(
      fileInput!,
      new File(
        [
          'question,evidence,tags\nWhat is the refund window?,Refunds are available for 30 days,"billing,policy"\nHow is SSO enabled?,Enable SSO in settings,enterprise',
        ],
        'golden-questions.csv',
        { type: 'text/csv' },
      ),
    )

    expect(await screen.findByText('What is the refund window?')).toBeInTheDocument()
    const importButtons = screen.getAllByRole('button', {
      name: 'dataset.newKnowledge.qualityPage.importCsv',
    })
    await user.click(importButtons.at(-1)!)

    await waitFor(() =>
      expect(serviceMock.bulkImport.mock.calls[0]?.[0]).toEqual({
        body: {
          rows: [
            {
              evidence: 'Refunds are available for 30 days',
              question: 'What is the refund window?',
              tags: ['billing', 'policy'],
            },
            {
              evidence: 'Enable SSO in settings',
              question: 'How is SSO enabled?',
              tags: ['enterprise'],
            },
          ],
        },
        params: { control_space_id: 'space-1' },
      }),
    )
  })

  it('clears each required-field message as soon as that field becomes valid', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What is the refund policy?')
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.addGolden' }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.save' }))

    expect(
      screen.getByText('dataset.newKnowledge.qualityPage.questionRequired'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('dataset.newKnowledge.qualityPage.annotationRequired'),
    ).toBeInTheDocument()
    expect(serviceMock.createGolden).not.toHaveBeenCalled()

    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.qualityPage.questionPlaceholder'),
      'New question',
    )
    expect(
      screen.queryByText('dataset.newKnowledge.qualityPage.questionRequired'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('dataset.newKnowledge.qualityPage.annotationRequired'),
    ).toBeInTheDocument()

    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.qualityPage.annotationPlaceholder'),
      'Expected answer',
    )
    expect(
      screen.queryByText('dataset.newKnowledge.qualityPage.questionRequired'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('dataset.newKnowledge.qualityPage.annotationRequired'),
    ).not.toBeInTheDocument()
    expect(serviceMock.createGolden).not.toHaveBeenCalled()
  })

  it('explains when evidence matching is unavailable instead of showing an unknown error', async () => {
    serviceMock.matchEvidence.mockRejectedValueOnce(new Response(null, { status: 503 }))
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What is the refund policy?')
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.addGolden' }),
    )
    await user.type(
      screen.getByPlaceholderText('dataset.newKnowledge.qualityPage.evidencePlaceholder'),
      'refund within 30 days',
    )
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.findEvidence' }),
    )

    expect(
      await screen.findByText('dataset.newKnowledge.qualityPage.noEvidenceMatch'),
    ).toBeInTheDocument()
    expect(screen.queryByText('dataset.unknownError')).not.toBeInTheDocument()
  })

  it('reveals the full annotation and submits edits through the update contract', async () => {
    const user = userEvent.setup()
    serviceMock.updateGolden.mockResolvedValue({})
    renderPage()

    await screen.findByText('What is the refund policy?')
    const annotation = screen.getByRole('button', { name: 'Must cite the refund clause.' })
    await user.hover(annotation)
    await waitFor(() => expect(screen.getAllByText('Must cite the refund clause.')).toHaveLength(2))

    await user.click(
      screen.getByRole('button', {
        name: /dataset\.newKnowledge\.qualityPage\.questionActions/,
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'dataset.newKnowledge.qualityPage.edit' }),
    )
    const annotationInput = screen.getByPlaceholderText(
      'dataset.newKnowledge.qualityPage.annotationPlaceholder',
    )
    const tagsInput = screen.getByPlaceholderText(
      'dataset.newKnowledge.qualityPage.tagsPlaceholder',
    )
    expect(tagsInput).toHaveValue('billing')
    await user.click(tagsInput)
    expect(tagsInput).toHaveFocus()
    await user.clear(tagsInput)
    await user.type(tagsInput, 'billing, sso')
    await user.clear(annotationInput)
    await user.type(annotationInput, 'Updated expected answer')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.save' }))

    await waitFor(() =>
      expect(serviceMock.updateGolden).toHaveBeenCalledWith(
        {
          body: {
            annotation: 'Updated expected answer',
            evidence_text: '',
            expected_evidence_ids: [],
            match_policy: 'all',
            question: 'What is the refund policy?',
            tags: ['billing', 'sso'],
          },
          params: { control_space_id: 'space-1', question_id: 'golden-1' },
        },
        expect.anything(),
      ),
    )
    expect(
      screen.queryByRole('dialog', { name: 'dataset.newKnowledge.qualityPage.editTitle' }),
    ).not.toBeInTheDocument()
  })

  it('resolves the protected trace reference before navigating', async () => {
    const user = userEvent.setup()
    navigationMock.tab = 'bad-cases'
    renderPage()

    await screen.findByText('Refund after activation')
    await user.click(
      await screen.findByRole('button', {
        name: /dataset\.newKnowledge\.qualityPage\.questionActions/,
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'dataset.newKnowledge.qualityPage.openTrace',
      }),
    )

    await waitFor(() =>
      expect(serviceMock.getTraceReference).toHaveBeenCalledWith({
        params: { bad_case_id: 'bad-1', control_space_id: 'space-1' },
      }),
    )
    expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/retrieval?trace=trace-42')
  })

  it('presents legacy retrieval-test reasons that duplicated the question as retrieval misses', async () => {
    serviceMock.getBadCases.mockResolvedValue({
      data: [
        {
          created_at: '2026-07-28T00:00:00Z',
          id: 'bad-legacy-retrieval-test',
          question: 'Why is the Earth square?',
          reason: 'Why is the Earth square?',
          revision: 1,
          status: 'open',
          tags: ['retrieval-test'],
          updated_at: '2026-07-28T00:00:00Z',
        },
      ],
      next_cursor: null,
    })
    navigationMock.tab = 'bad-cases'

    renderPage()

    expect(await screen.findAllByText('Why is the Earth square?')).toHaveLength(1)
    expect(
      screen.getByText('dataset.newKnowledge.qualityPage.reasonValues.retrievalMiss'),
    ).toBeInTheDocument()
  })

  it('loads the next page of golden questions through the cursor contract', async () => {
    serviceMock.getGolden.mockImplementation(
      async (input: { query?: { cursor?: string } } | undefined) =>
        input?.query?.cursor === 'golden-cursor-2'
          ? {
              data: [
                {
                  annotation: 'Second-page answer',
                  created_at: '2026-07-27T00:00:00Z',
                  id: 'golden-2',
                  question: 'Second-page question',
                  tags: [],
                  updated_at: '2026-07-27T00:00:00Z',
                },
              ],
              next_cursor: null,
            }
          : {
              data: [
                {
                  annotation: 'Must cite the refund clause.',
                  created_at: '2026-07-28T00:00:00Z',
                  id: 'golden-1',
                  question: 'What is the refund policy?',
                  tags: ['billing'],
                  updated_at: '2026-07-28T00:00:00Z',
                },
              ],
              next_cursor: 'golden-cursor-2',
            },
    )
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What is the refund policy?')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))

    expect(await screen.findByText('Second-page question')).toBeInTheDocument()
    expect(serviceMock.getGolden).toHaveBeenLastCalledWith({
      params: { control_space_id: 'space-1' },
      query: { cursor: 'golden-cursor-2', limit: 50 },
    })
  })

  it('keeps loading bad cases when a page only contains dismissed rows', async () => {
    serviceMock.getBadCases.mockImplementation(
      async (input: { query?: { cursor?: string } } | undefined) =>
        input?.query?.cursor === 'bad-case-cursor-2'
          ? {
              data: [
                {
                  created_at: '2026-07-27T00:00:00Z',
                  id: 'bad-2',
                  question: 'Visible second-page case',
                  reason: 'retrieval miss',
                  revision: 1,
                  status: 'open',
                  tags: [],
                  updated_at: '2026-07-27T00:00:00Z',
                },
              ],
              next_cursor: null,
            }
          : {
              data: [
                {
                  created_at: '2026-07-28T00:00:00Z',
                  id: 'bad-dismissed',
                  question: 'Dismissed first-page case',
                  reason: 'resolved',
                  revision: 2,
                  status: 'dismissed',
                  tags: [],
                  updated_at: '2026-07-28T00:00:00Z',
                },
              ],
              next_cursor: 'bad-case-cursor-2',
            },
    )
    navigationMock.tab = 'bad-cases'
    const user = userEvent.setup()
    renderPage()

    expect(
      await screen.findByText('dataset.newKnowledge.qualityPage.badCasesEmptyTitle'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))

    expect(await screen.findByText('Visible second-page case')).toBeInTheDocument()
    expect(serviceMock.getBadCases).toHaveBeenLastCalledWith({
      params: { control_space_id: 'space-1' },
      query: { cursor: 'bad-case-cursor-2', limit: 50 },
    })
  })

  it('requires confirmation and clears hidden selections when switching tabs', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What is the refund policy?')
    await user.click(
      screen.getByRole('checkbox', {
        name: /dataset\.newKnowledge\.qualityPage\.selectQuestion/,
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.qualityPage.deleteEllipsis' }),
    )

    expect(serviceMock.deleteGolden).not.toHaveBeenCalled()
    expect(screen.getByText('common.operation.deleteConfirmTitle')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await user.click(
      screen.getByRole('tab', { name: /dataset\.newKnowledge\.qualityPage\.badCasesTab/ }),
    )

    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.qualityPage.deleteEllipsis' }),
    ).not.toBeInTheDocument()
  })

  it('reuses the replay idempotency key after a partial failure', async () => {
    let linked = false
    let rejectReplayPatch = true
    serviceMock.getBadCase.mockImplementation(async () => ({
      created_at: '2026-07-28T00:00:00Z',
      id: 'bad-1',
      question: 'Refund after activation',
      reason: 'coverage gap',
      replay_run_id: null,
      revision: linked ? 2 : 1,
      status: 'open',
      tags: linked ? ['billing', 'golden-question:golden-2'] : ['billing'],
      updated_at: '2026-07-28T00:00:00Z',
    }))
    serviceMock.updateBadCase.mockImplementation(
      async (input: { body: { status: string; tags?: string[] } }) => {
        if (input.body.status === 'open') {
          linked = true
          return {
            ...(await serviceMock.getBadCase()),
            revision: 2,
            tags: input.body.tags,
          }
        }
        if (rejectReplayPatch) {
          rejectReplayPatch = false
          throw new Error('response lost')
        }
        return {
          ...(await serviceMock.getBadCase()),
          replay_run_id: 'replay-1',
          revision: 3,
          status: 'replaying',
        }
      },
    )
    serviceMock.createReplay.mockResolvedValue({ id: 'replay-1', revision: 1, state: 'queued' })
    navigationMock.tab = 'bad-cases'
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Refund after activation')
    const replay = async () => {
      await user.click(
        screen.getByRole('button', {
          name: /dataset\.newKnowledge\.qualityPage\.questionActions/,
        }),
      )
      await user.click(
        await screen.findByRole('menuitem', {
          name: 'dataset.newKnowledge.qualityPage.replay',
        }),
      )
    }
    await replay()
    await waitFor(() => expect(serviceMock.createReplay).toHaveBeenCalledTimes(1))
    await replay()
    await waitFor(() => expect(serviceMock.createReplay).toHaveBeenCalledTimes(2))

    expect(serviceMock.createGolden).toHaveBeenCalledTimes(2)
    const firstHeaders = serviceMock.createReplay.mock.calls[0]?.[0].headers
    expect(serviceMock.createReplay.mock.calls[1]?.[0].headers).toEqual(firstHeaders)
  })

  it('replaces a stale golden-question link before replaying a bad case', async () => {
    serviceMock.getBadCase.mockResolvedValue({
      created_at: '2026-07-28T00:00:00Z',
      id: 'bad-1',
      question: 'Refund after activation',
      reason: 'coverage gap',
      replay_run_id: null,
      revision: 1,
      status: 'open',
      tags: ['billing', 'golden-question:deleted-golden'],
      updated_at: '2026-07-28T00:00:00Z',
    })
    serviceMock.createGolden.mockResolvedValue({
      annotation: 'coverage gap',
      created_at: '2026-07-29T00:00:00Z',
      id: 'replacement-golden',
      question: 'Refund after activation',
      tags: ['billing'],
      updated_at: '2026-07-29T00:00:00Z',
    })
    serviceMock.updateBadCase
      .mockResolvedValueOnce({
        ...(await serviceMock.getBadCase()),
        revision: 2,
        tags: ['billing', 'golden-question:replacement-golden'],
      })
      .mockResolvedValueOnce({
        ...(await serviceMock.getBadCase()),
        replay_run_id: 'replay-1',
        revision: 3,
        status: 'replaying',
        tags: ['billing', 'golden-question:replacement-golden'],
      })
    serviceMock.createReplay.mockResolvedValue({ id: 'replay-1', revision: 1, state: 'queued' })
    navigationMock.tab = 'bad-cases'
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Refund after activation')
    await user.click(
      screen.getByRole('button', {
        name: /dataset\.newKnowledge\.qualityPage\.questionActions/,
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'dataset.newKnowledge.qualityPage.replay',
      }),
    )

    await waitFor(() =>
      expect(serviceMock.createReplay).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { golden_question_ids: ['replacement-golden'] },
        }),
      ),
    )
    expect(serviceMock.createGolden.mock.calls[0]?.[0]).toEqual({
      body: {
        annotation: 'coverage gap',
        evidence_text: '',
        expected_evidence_ids: [],
        match_policy: 'all',
        question: 'Refund after activation',
        source_bad_case_id: 'bad-1',
        tags: ['billing'],
      },
      params: { control_space_id: 'space-1' },
    })
    expect(serviceMock.updateBadCase.mock.calls[0]?.[0]).toEqual({
      body: {
        expected_revision: 1,
        status: 'open',
        tags: ['billing', 'golden-question:replacement-golden'],
      },
      params: { bad_case_id: 'bad-1', control_space_id: 'space-1' },
    })
  })
})

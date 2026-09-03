import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs as render } from '@/test/nuqs-testing'
import { QualityPage } from '../page'

vi.mock('../quality-evaluation-panel', () => ({
  EvaluationReport: ({ onBack, runId }: { onBack: () => void; runId: string }) => (
    <div>
      Report {runId}
      <button type="button" onClick={onBack}>
        Back to evaluations
      </button>
    </div>
  ),
  QualityEvaluationPanel: ({ onOpenReport }: { onOpenReport: (runId: string) => void }) => (
    <div>
      Evaluation panel
      <button type="button" onClick={() => onOpenReport('run-1')}>
        Open report
      </button>
    </div>
  ),
}))

const serviceMock = vi.hoisted(() => ({
  bulkImport: vi.fn(),
  createGolden: vi.fn(),
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
  run: undefined as string | undefined,
  tab: undefined as string | undefined,
}))
const knowledgeSpacePermissionState = vi.hoisted(() => ({
  keys: ['knowledge_space_edit'],
}))
vi.mock('../../space/context', () => ({
  useKnowledgeSpace: () => ({ space: { control_space_id: 'space-1' } }),
  useKnowledgeSpacePermission: (permission: string) =>
    knowledgeSpacePermissionState.keys.includes(permission),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          goldenQuestions: {
            evidenceMatches: { post: serviceMock.matchEvidence },
          },
          quality: {
            badCases: {
              byBadCaseId: {
                get: serviceMock.getBadCase,
                patch: serviceMock.updateBadCase,
                traceReference: { get: serviceMock.getTraceReference },
              },
            },
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
              key: () => ['quality', 'golden'],
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
                key: () => ['quality', 'bad-cases'],
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
  return render(
    <QueryClientProvider client={queryClient}>
      <QualityPage />
    </QueryClientProvider>,
    {
      searchParams: new URLSearchParams({
        ...(navigationMock.run ? { run: navigationMock.run } : {}),
        ...(navigationMock.tab ? { tab: navigationMock.tab } : {}),
      }).toString(),
    },
  )
}

describe('QualityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledgeSpacePermissionState.keys = ['knowledge_space_edit']
    navigationMock.run = undefined
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

  it('renders tab labels without item counts', async () => {
    renderPage()

    await screen.findByText('What is the refund policy?')
    expect(
      screen.getByRole('tab', { name: 'knowledgeSpace.qualityPage.goldenTab' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'knowledgeSpace.qualityPage.badCasesTab' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'knowledgeSpace.qualityPage.evaluationTab' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
  })

  it('does not load golden questions or bad cases for the evaluation tab', async () => {
    navigationMock.tab = 'evaluations'

    renderPage()

    expect(await screen.findByText('Evaluation panel')).toBeInTheDocument()
    expect(serviceMock.getGolden).not.toHaveBeenCalled()
    expect(serviceMock.getBadCases).not.toHaveBeenCalled()
  })

  it('keeps quality mutations hidden for viewers while preserving trace access', async () => {
    const user = userEvent.setup()
    knowledgeSpacePermissionState.keys = []
    const rendered = renderPage()

    await screen.findByText('What is the refund policy?')
    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.qualityPage.addGolden' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.qualityPage.importCsv' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /knowledgeSpace\.qualityPage\.questionActions/,
      }),
    ).not.toBeInTheDocument()

    rendered.unmount()
    navigationMock.tab = 'bad-cases'
    renderPage()
    await screen.findByText('Refund after activation')
    await user.click(
      screen.getByRole('button', {
        name: /knowledgeSpace\.qualityPage\.questionActions/,
      }),
    )
    expect(
      await screen.findByRole('menuitem', {
        name: 'knowledgeSpace.qualityPage.openTrace',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'knowledgeSpace.qualityPage.replay' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'knowledgeSpace.qualityPage.ignore' }),
    ).not.toBeInTheDocument()
  })

  it('uses tab primitive relationships and keeps route state in sync', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderPage()

    const goldenTab = await screen.findByRole('tab', {
      name: 'knowledgeSpace.qualityPage.goldenTab',
    })
    const badCasesTab = screen.getByRole('tab', {
      name: 'knowledgeSpace.qualityPage.badCasesTab',
    })
    expect(goldenTab).toHaveAttribute('aria-controls')
    expect(badCasesTab).toHaveAttribute('tabindex', '-1')
    await user.click(badCasesTab)

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('tab')).toBe('bad-cases')
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options.history).toBe('replace')
  })

  it('owns evaluation report navigation in the URL', async () => {
    const user = userEvent.setup()
    navigationMock.tab = 'evaluations'
    const { onUrlUpdate } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Open report' }))

    await waitFor(() =>
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('run')).toBe('run-1'),
    )
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options.history).toBe('push')
  })

  it('renders a URL-selected evaluation report outside the tab chrome', async () => {
    const user = userEvent.setup()
    navigationMock.run = 'run-1'
    navigationMock.tab = 'evaluations'
    const { onUrlUpdate } = renderPage()

    expect(await screen.findByText('Report run-1')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to evaluations' }))

    await waitFor(() =>
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('run')).toBeNull(),
    )
  })

  it('renders an empty golden-question annotation without an empty interactive control', async () => {
    serviceMock.getGolden.mockResolvedValue({
      data: [
        {
          annotation: '',
          created_at: '2026-07-28T00:00:00Z',
          id: 'golden-1',
          question: 'What is the refund policy?',
          tags: ['billing'],
          updated_at: '2026-07-28T00:00:00Z',
        },
      ],
      next_cursor: null,
    })

    renderPage()

    await screen.findByText('What is the refund policy?')
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '' })).not.toBeInTheDocument()
  })

  it('renders persisted quality data and creates a golden question through the API', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('What is the refund policy?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.addGolden' }))
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.qualityPage.questionPlaceholder'),
      'New question',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.save' }))

    await waitFor(() => expect(serviceMock.createGolden).toHaveBeenCalled())
    expect(serviceMock.createGolden.mock.calls[0]?.[0]).toEqual({
      body: {
        annotation: '',
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
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.addGolden' }))
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.qualityPage.questionPlaceholder'),
      'New question',
    )
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.qualityPage.annotationPlaceholder'),
      'Expected answer',
    )
    const dialog = screen.getByRole('dialog')
    const tagsInput = within(dialog).getByPlaceholderText(
      'knowledgeSpace.qualityPage.tagsPlaceholder',
    )
    await user.type(tagsInput, 'billing, sso')

    expect(tagsInput).toHaveValue('billing, sso')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.save' }))

    await waitFor(() =>
      expect(serviceMock.createGolden.mock.calls[0]?.[0]).toEqual({
        body: {
          annotation: 'Expected answer',
          expected_evidence_ids: [],
          match_policy: 'all',
          question: 'New question',
          tags: ['billing', 'sso'],
        },
        params: { control_space_id: 'space-1' },
      }),
    )
  })

  it('uses a human-readable search only to select the persisted evidence node id', async () => {
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
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.addGolden' }))
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.qualityPage.questionPlaceholder'),
      'When can I request a refund?',
    )
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.qualityPage.annotationPlaceholder'),
      'The answer must cite the refund window.',
    )
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.qualityPage.evidencePlaceholder'),
      'refund within 30 days',
    )
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.findEvidence' }),
    )
    await user.click(await screen.findByText('Customers can request a refund within 30 days.'))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.save' }))

    expect(serviceMock.matchEvidence.mock.calls[0]?.[0]).toEqual({
      body: { evidence: 'refund within 30 days' },
      params: { control_space_id: 'space-1' },
    })
    await waitFor(() =>
      expect(serviceMock.createGolden.mock.calls[0]?.[0]).toEqual({
        body: {
          annotation: 'The answer must cite the refund window.',
          expected_evidence_ids: ['node-1'],
          match_policy: 'all',
          question: 'When can I request a refund?',
          tags: [],
        },
        params: { control_space_id: 'space-1' },
      }),
    )
  })

  it('keeps one evidence match policy selected and submits the chosen value', async () => {
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
        {
          document_asset_id: 'document-2',
          node_id: 'node-2',
          projection_id: 'projection-2',
          score: 0.82,
          section_path: ['Cancellation policy'],
          text: 'Subscriptions can be cancelled before renewal.',
        },
      ],
      evidence: 'refund and cancellation policy',
      matched: true,
    })
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What is the refund policy?')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.addGolden' }))
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.qualityPage.questionPlaceholder'),
      'When can I request a refund?',
    )
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.qualityPage.annotationPlaceholder'),
      'The answer must cite both policies.',
    )
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.qualityPage.evidencePlaceholder'),
      'refund and cancellation policy',
    )
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.findEvidence' }),
    )
    await user.click(
      await screen.findByRole('checkbox', {
        name: /Customers can request a refund within 30 days\./,
      }),
    )
    await user.click(
      screen.getByRole('checkbox', {
        name: /Subscriptions can be cancelled before renewal\./,
      }),
    )

    const matchPolicy = screen.getByRole('radiogroup', {
      name: 'knowledgeSpace.qualityPage.matchPolicyLabel',
    })
    expect(matchPolicy).toBeRequired()
    const all = within(matchPolicy).getByRole('radio', {
      name: 'knowledgeSpace.qualityPage.matchPolicy.all',
    })
    const any = within(matchPolicy).getByRole('radio', {
      name: 'knowledgeSpace.qualityPage.matchPolicy.any',
    })
    expect(all).toHaveAttribute('type', 'button')
    expect(any).toHaveAttribute('type', 'button')
    expect(all).toBeChecked()
    expect(any).not.toBeChecked()

    await user.click(all)
    expect(all).toBeChecked()
    await user.click(any)
    expect(all).not.toBeChecked()
    expect(any).toBeChecked()
    expect(serviceMock.createGolden).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.save' }))

    await waitFor(() =>
      expect(serviceMock.createGolden.mock.calls[0]?.[0]).toEqual({
        body: {
          annotation: 'The answer must cite both policies.',
          expected_evidence_ids: ['node-1', 'node-2'],
          match_policy: 'any',
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
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.importCsv' }))
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
      name: 'knowledgeSpace.qualityPage.importCsv',
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

  it('requires only the question and allows an empty annotation', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What is the refund policy?')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.addGolden' }))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.save' }))

    expect(screen.getByText('knowledgeSpace.qualityPage.questionRequired')).toBeInTheDocument()
    expect(
      screen.queryByText('knowledgeSpace.qualityPage.annotationRequired'),
    ).not.toBeInTheDocument()
    expect(serviceMock.createGolden).not.toHaveBeenCalled()

    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.qualityPage.questionPlaceholder'),
      'New question',
    )
    expect(
      screen.queryByText('knowledgeSpace.qualityPage.questionRequired'),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.save' }))

    await waitFor(() =>
      expect(serviceMock.createGolden.mock.calls[0]?.[0]).toEqual({
        body: {
          annotation: '',
          expected_evidence_ids: [],
          match_policy: 'all',
          question: 'New question',
          tags: [],
        },
        params: { control_space_id: 'space-1' },
      }),
    )
  })

  it('explains when evidence matching is unavailable instead of showing an unknown error', async () => {
    serviceMock.matchEvidence.mockRejectedValueOnce(new Response(null, { status: 503 }))
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('What is the refund policy?')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.addGolden' }))
    await user.type(
      screen.getByPlaceholderText('knowledgeSpace.qualityPage.evidencePlaceholder'),
      'refund within 30 days',
    )
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.findEvidence' }),
    )

    expect(
      await screen.findByText('knowledgeSpace.qualityPage.noEvidenceMatch'),
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
        name: /knowledgeSpace\.qualityPage\.questionActions/,
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'knowledgeSpace.qualityPage.edit' }),
    )
    const annotationInput = screen.getByPlaceholderText(
      'knowledgeSpace.qualityPage.annotationPlaceholder',
    )
    const tagsInput = screen.getByPlaceholderText('knowledgeSpace.qualityPage.tagsPlaceholder')
    expect(tagsInput).toHaveValue('billing')
    await user.click(tagsInput)
    expect(tagsInput).toHaveFocus()
    await user.clear(tagsInput)
    await user.type(tagsInput, 'billing, sso')
    await user.clear(annotationInput)
    await user.type(annotationInput, 'Updated expected answer')
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.save' }))

    await waitFor(() =>
      expect(serviceMock.updateGolden).toHaveBeenCalledWith(
        {
          body: {
            annotation: 'Updated expected answer',
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
      screen.queryByRole('dialog', { name: 'knowledgeSpace.qualityPage.editTitle' }),
    ).not.toBeInTheDocument()
  })

  it('resolves and displays saved evidence passages while keeping the search query ephemeral', async () => {
    serviceMock.getGolden.mockResolvedValue({
      data: [
        {
          annotation: 'Must cite both permission rules.',
          created_at: '2026-07-28T00:00:00Z',
          evidence_text: '权限',
          expected_evidence_ids: ['node-1', 'node-2'],
          id: 'golden-1',
          match_policy: 'all',
          question: 'Who can change permissions?',
          status: 'active',
          tags: ['permissions'],
          updated_at: '2026-07-28T00:00:00Z',
        },
      ],
      next_cursor: null,
    })
    serviceMock.matchEvidence.mockImplementation(
      async ({ body }: { body: { evidence?: string; node_ids?: string[] } }) => {
        if (body.node_ids) {
          return {
            candidates: [
              {
                document_asset_id: 'document-1',
                node_id: 'node-1',
                section_path: ['Permissions', 'Owners'],
                text: 'Workspace owners can change member permissions.',
              },
              {
                document_asset_id: 'document-1',
                node_id: 'node-2',
                section_path: ['Permissions', 'Admins'],
                text: 'Administrators can assign application roles.',
              },
            ],
            evidence: '',
            matched: false,
          }
        }
        return { candidates: [], evidence: body.evidence ?? '', matched: false }
      },
    )
    serviceMock.updateGolden.mockResolvedValue({})
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Who can change permissions?')
    await user.click(
      screen.getByRole('button', {
        name: /knowledgeSpace\.qualityPage\.questionActions/,
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'knowledgeSpace.qualityPage.edit' }),
    )

    expect(await screen.findByText('Workspace owners can change member permissions.')).toBeVisible()
    expect(screen.getByText('Administrators can assign application roles.')).toBeVisible()
    expect(serviceMock.matchEvidence.mock.calls[0]?.[0]).toEqual({
      body: { node_ids: ['node-1', 'node-2'] },
      params: { control_space_id: 'space-1' },
    })

    const search = screen.getByRole('searchbox', {
      name: 'knowledgeSpace.qualityPage.findEvidence',
    })
    expect(search).toHaveValue('')
    await user.type(search, '权限')
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.findEvidence' }),
    )
    await waitFor(() => expect(search).toHaveValue(''))
    expect(screen.getByText('Workspace owners can change member permissions.')).toBeVisible()
    expect(screen.getByText('Administrators can assign application roles.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.save' }))
    await waitFor(() =>
      expect(serviceMock.updateGolden).toHaveBeenCalledWith(
        {
          body: {
            annotation: 'Must cite both permission rules.',
            expected_evidence_ids: ['node-1', 'node-2'],
            match_policy: 'all',
            question: 'Who can change permissions?',
            tags: ['permissions'],
          },
          params: { control_space_id: 'space-1', question_id: 'golden-1' },
        },
        expect.anything(),
      ),
    )
  })

  it('resolves the protected trace reference before navigating', async () => {
    const user = userEvent.setup()
    navigationMock.tab = 'bad-cases'
    renderPage()

    await screen.findByText('Refund after activation')
    await user.click(
      await screen.findByRole('button', {
        name: /knowledgeSpace\.qualityPage\.questionActions/,
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'knowledgeSpace.qualityPage.openTrace',
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
      screen.getByText('knowledgeSpace.qualityPage.reasonValues.retrievalMiss'),
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
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.loadMore' }))

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
      await screen.findByText('knowledgeSpace.qualityPage.badCasesEmptyTitle'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.loadMore' }))

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
        name: /knowledgeSpace\.qualityPage\.selectQuestion/,
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.deleteEllipsis' }),
    )

    expect(serviceMock.deleteGolden).not.toHaveBeenCalled()
    expect(screen.getByText('common.operation.deleteConfirmTitle')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await user.click(screen.getByRole('tab', { name: /knowledgeSpace\.qualityPage\.badCasesTab/ }))

    expect(
      screen.queryByRole('button', { name: 'knowledgeSpace.qualityPage.deleteEllipsis' }),
    ).not.toBeInTheDocument()
  })

  it('opens the source trace in retrieval test and requests one retest', async () => {
    navigationMock.tab = 'bad-cases'
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Refund after activation')
    await user.click(
      screen.getByRole('button', {
        name: /knowledgeSpace\.qualityPage\.questionActions/,
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'knowledgeSpace.qualityPage.replay',
      }),
    )

    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith(
        '/datasets/new/space-1/retrieval?retest=trace-42&trace=trace-42',
      ),
    )
    expect(serviceMock.createGolden).not.toHaveBeenCalled()
    expect(serviceMock.updateBadCase).not.toHaveBeenCalled()
  })

  it('ignores a bad case by dismissing it without creating a golden question', async () => {
    let ignored = false
    serviceMock.getBadCases.mockImplementation(async () => ({
      data: [
        {
          created_at: '2026-07-28T00:00:00Z',
          id: 'bad-1',
          question: 'Refund after activation',
          reason: 'coverage gap',
          revision: ignored ? 2 : 1,
          status: ignored ? 'dismissed' : 'open',
          tags: ['billing'],
          updated_at: '2026-07-28T00:00:00Z',
        },
      ],
      next_cursor: null,
    }))
    serviceMock.updateBadCase.mockImplementation(async () => {
      ignored = true
      return {
        ...(await serviceMock.getBadCase()),
        revision: 2,
        status: 'dismissed',
      }
    })
    navigationMock.tab = 'bad-cases'
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Refund after activation')
    await user.click(
      screen.getByRole('button', {
        name: /knowledgeSpace\.qualityPage\.questionActions/,
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'knowledgeSpace.qualityPage.ignore',
      }),
    )

    await waitFor(() =>
      expect(serviceMock.updateBadCase).toHaveBeenCalledWith({
        body: {
          expected_revision: 1,
          status: 'dismissed',
          tags: ['billing'],
        },
        params: { bad_case_id: 'bad-1', control_space_id: 'space-1' },
      }),
    )
    await waitFor(() =>
      expect(screen.queryByText('Refund after activation')).not.toBeInTheDocument(),
    )
    expect(serviceMock.createGolden).not.toHaveBeenCalled()
  })

  it('creates a golden question and dismisses its source bad case', async () => {
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
    serviceMock.updateBadCase.mockResolvedValue({
      ...(await serviceMock.getBadCase()),
      revision: 2,
      status: 'dismissed',
      tags: ['billing'],
    })
    navigationMock.tab = 'bad-cases'
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Refund after activation')
    await user.click(
      screen.getByRole('button', {
        name: /knowledgeSpace\.qualityPage\.questionActions/,
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'knowledgeSpace.qualityPage.toGolden',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.promote' }))

    await waitFor(() => expect(serviceMock.createGolden).toHaveBeenCalledTimes(1))
    expect(serviceMock.createGolden.mock.calls[0]?.[0]).toEqual({
      body: {
        annotation: '',
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
        status: 'dismissed',
        tags: ['billing'],
      },
      params: { bad_case_id: 'bad-1', control_space_id: 'space-1' },
    })
  })

  it('resumes a partially promoted bad case without creating a duplicate', async () => {
    navigationMock.tab = 'bad-cases'
    serviceMock.updateBadCase
      .mockRejectedValueOnce(new Error('dismiss failed'))
      .mockResolvedValueOnce({ status: 'dismissed' })
    serviceMock.deleteGolden.mockRejectedValueOnce(new Error('rollback failed'))
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Refund after activation')
    await user.click(
      screen.getByRole('button', {
        name: /knowledgeSpace\.qualityPage\.questionActions/,
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'knowledgeSpace.qualityPage.toGolden',
      }),
    )
    const promote = screen.getByRole('button', {
      name: 'knowledgeSpace.qualityPage.promote',
    })

    await user.click(promote)
    await screen.findByText('dataset.unknownError')
    await user.click(promote)

    await waitFor(() => expect(serviceMock.updateBadCase).toHaveBeenCalledTimes(2))
    expect(serviceMock.createGolden).toHaveBeenCalledTimes(1)
    expect(serviceMock.deleteGolden).toHaveBeenCalledTimes(1)
  })

  it('keeps only failed items selected after a partial bulk delete', async () => {
    serviceMock.getGolden.mockResolvedValue({
      data: [
        {
          annotation: '',
          created_at: '2026-07-28T00:00:00Z',
          id: 'golden-1',
          question: 'First question',
          tags: [],
          updated_at: '2026-07-28T00:00:00Z',
        },
        {
          annotation: '',
          created_at: '2026-07-28T00:00:00Z',
          id: 'golden-2',
          question: 'Second question',
          tags: [],
          updated_at: '2026-07-28T00:00:00Z',
        },
      ],
      next_cursor: null,
    })
    serviceMock.deleteGolden.mockImplementation(
      async (input: { params: { question_id: string } }) => {
        if (input.params.question_id === 'golden-2') throw new Error('temporary failure')
      },
    )
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('First question')
    await user.click(screen.getByRole('checkbox', { name: 'knowledgeSpace.qualityPage.selectAll' }))
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.deleteEllipsis' }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => expect(serviceMock.deleteGolden).toHaveBeenCalledTimes(2))
    expect(
      screen.getByRole('checkbox', {
        hidden: true,
        name: /knowledgeSpace\.qualityPage\.selectQuestion.*First question/,
      }),
    ).not.toBeChecked()
    expect(
      screen.getByRole('checkbox', {
        hidden: true,
        name: /knowledgeSpace\.qualityPage\.selectQuestion.*Second question/,
      }),
    ).toBeChecked()

    serviceMock.deleteGolden.mockResolvedValue(undefined)
    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => expect(serviceMock.deleteGolden).toHaveBeenCalledTimes(3))
    expect(serviceMock.deleteGolden.mock.calls[2]?.[0]).toMatchObject({
      params: { question_id: 'golden-2' },
    })
  })
})

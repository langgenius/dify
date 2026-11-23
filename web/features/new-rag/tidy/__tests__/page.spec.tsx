import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createHttpError } from '@/service/http-error'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { TidyPage } from '../page'

const service = vi.hoisted(() => ({
  settings: vi.fn(),
  summary: vi.fn(),
  configure: vi.fn(),
  findings: vi.fn(),
  scans: vi.fn(),
  act: vi.fn(),
  retry: vi.fn(),
}))
vi.mock('@/service/console', async (original) => {
  const actual = await original<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const path = 'knowledgeFs.spaces.byControlSpaceId.tidy'
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      [`${path}.settings.get`]: service.settings,
      [`${path}.summary.get`]: service.summary,
      [`${path}.settings.patch`]: service.configure,
      [`${path}.findings.get`]: service.findings,
      [`${path}.scans.get`]: service.scans,
      [`${path}.findings.byFindingId.actions.post`]: service.act,
      [`${path}.retry.post`]: service.retry,
    }),
  }
})
function renderPage(edit = true) {
  return renderWithConsoleQuery(
    <NuqsTestingAdapter>
      <KnowledgeSpaceTestProvider
        space={createKnowledgeSpaceFixture({
          permission_keys: edit
            ? ['knowledge_space_read', 'knowledge_space_edit']
            : ['knowledge_space_read'],
        })}
      >
        <TidyPage />
      </KnowledgeSpaceTestProvider>
    </NuqsTestingAdapter>,
  )
}
describe('Tidy', () => {
  beforeEach(() => {
    service.settings.mockResolvedValue({
      enabled: false,
      conflicts: true,
      revision: 0,
      lastError: null,
      updatedAt: '2026-11-03',
    })
    service.summary.mockResolvedValue({
      findings: [],
      documents: { pending: 0, scanning: 0, complete: 0, failed: 0 },
      modelCalls: 0,
    })
    service.configure.mockResolvedValue({
      enabled: true,
      conflicts: true,
      revision: 1,
      lastError: null,
      updatedAt: '2026-11-03',
    })
    service.findings.mockResolvedValue({ items: [], nextCursor: null })
    service.scans.mockResolvedValue({ items: [], nextCursor: null })
  })
  it('requires confirmation of token consumption before enabling and has no token quota input', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('switch'))
    expect(service.configure).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('tidy.tokenNotice')
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() =>
      expect(service.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            enabled: true,
            conflicts: true,
            expectedRevision: 0,
            acknowledgeTokenUsage: true,
          },
        }),
      ),
    )
  })
  it('enables free duplicate detection without token consent when conflicts are unchecked', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('switch'))
    const dialog = screen.getByRole('dialog')
    await user.click(screen.getByRole('checkbox', { name: 'knowledgeSpace.tidy.consentConflicts' }))
    expect(dialog).toHaveTextContent('tidy.freeNotice')
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() =>
      expect(service.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            enabled: true,
            conflicts: false,
            expectedRevision: 0,
            acknowledgeTokenUsage: false,
          },
        }),
      ),
    )
  })
  it('shows progress, explains a pause and asks before turning on conflict detection', async () => {
    service.settings.mockResolvedValue({
      enabled: true,
      conflicts: false,
      revision: 4,
      lastError: 'authorization_failed',
      updatedAt: '2026-11-04',
    })
    service.summary.mockResolvedValue({
      findings: [
        { status: 'open', kind: 'similar', count: 2 },
        { status: 'open', kind: 'duplicate', count: 1 },
      ],
      documents: { pending: 1, scanning: 0, complete: 3, failed: 1 },
      modelCalls: 0,
      current: { documentId: 'doc-a', title: 'Big.txt', passagesDone: 179, passagesTotal: 285 },
    })
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText(/knowledgeSpace\.tidy\.progressSummary/)).toBeVisible()
    // A long document counts by passage: 4 of 5 documents done plus 63% of the current one.
    expect(screen.getByText(/knowledgeSpace\.tidy\.progressCurrent/)).toBeVisible()
    expect(
      screen.getByRole('progressbar', { name: 'knowledgeSpace.tidy.progress' }),
    ).toHaveAttribute('aria-valuenow', '93')
    expect(screen.getByRole('alert')).toHaveTextContent('knowledgeSpace.tidy.pausedAuthorization')
    expect(screen.getByText(/knowledgeSpace\.tidy\.failedCount/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'knowledgeSpace.tidy.similar 2' })).toBeVisible()
    await user.click(screen.getByRole('switch', { name: 'knowledgeSpace.tidy.conflicts' }))
    expect(service.configure).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('tidy.tokenNotice')
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() =>
      expect(service.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            enabled: true,
            conflicts: true,
            expectedRevision: 4,
            acknowledgeTokenUsage: true,
          },
        }),
      ),
    )
  })
  it('filters by kind and explains reworded duplicates found by stored vectors', async () => {
    const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 5 }
    service.findings.mockResolvedValue({
      items: [
        {
          id: 's',
          kind: 'similar',
          left: { ...evidence, documentId: 'a', title: 'Refunds', text: '十四天内退款' },
          right: { ...evidence, documentId: 'b', title: 'Returns', text: '签收两周内可退' },
          reason: 'semantic_overlap',
          similarity: 0.75,
          status: 'open',
          revision: 1,
          actionId: null,
          createdAt: '2026-11-04',
          stale: false,
        },
      ],
      nextCursor: null,
    })
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('knowledgeSpace.tidy.semanticReason')).toBeVisible()
    expect(screen.getByText(/knowledgeSpace\.tidy\.semanticCoverage/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.tidy.similar 0' }))
    await waitFor(() =>
      expect(service.findings).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: { status: 'open', kind: 'similar' } }),
      ),
    )
  })
  it('allows readers to compare evidence without management controls', async () => {
    renderPage(false)
    expect(await screen.findByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
  })
  it('keeps source comparison visible and explicitly confirms the document to disable', async () => {
    const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 5 }
    service.findings.mockResolvedValue({
      items: [
        {
          id: 'f',
          kind: 'conflict',
          left: { ...evidence, documentId: 'a', title: 'Policy A', text: '十四天退款' },
          right: { ...evidence, documentId: 'b', title: 'Policy B', text: '七天退款' },
          reason: '期限不一致',
          similarity: null,
          status: 'open',
          revision: 1,
          actionId: null,
          createdAt: '2026-11-03',
          stale: false,
        },
      ],
      nextCursor: null,
    })
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('十四天退款')).toBeVisible()
    expect(screen.getByText('七天退款')).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: /knowledgeSpace\.tidy\.disableOne.*Policy B/ }),
    )
    expect(service.act).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('Policy B')
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() =>
      expect(service.act).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { expectedRevision: 1, action: 'disable_document', documentId: 'b' },
        }),
      ),
    )
  })
  it('keeps the cost confirmation open on failure and allows an explicit retry', async () => {
    service.configure.mockRejectedValueOnce(new Error('unavailable'))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('switch'))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('knowledgeSpace.tidy.error')
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(service.configure).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(service.configure).toHaveBeenCalledTimes(2)
  })
  it('sends the saved review revision for undo and explains a stale-document refusal', async () => {
    const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 3, text: '原文' }
    service.findings.mockResolvedValue({
      items: [
        {
          id: 'f',
          kind: 'duplicate',
          left: { ...evidence, documentId: 'a', title: 'A' },
          right: { ...evidence, documentId: 'b', title: 'B' },
          reason: 'identical_content_hash',
          similarity: 1,
          status: 'disabled',
          revision: 2,
          actionId: 'action',
          createdAt: '2026-11-03',
          stale: false,
        },
      ],
      nextCursor: null,
    })
    service.act.mockRejectedValueOnce(createHttpError(new Response(null, { status: 409 })))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'knowledgeSpace.tidy.undo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('knowledgeSpace.tidy.stale')
    expect(service.act).toHaveBeenCalledWith(
      expect.objectContaining({ body: { action: 'undo', expectedRevision: 2 } }),
    )
    expect(screen.getByRole('button', { name: 'knowledgeSpace.tidy.undo' })).toBeEnabled()
  })
  it('groups identical copies, keeps the newest and disables each other copy once', async () => {
    const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 7, text: 'Welcome' }
    const copy = (id: string, left: string, right: string) => ({
      id,
      kind: 'duplicate',
      left: { ...evidence, documentId: left, title: 'Handbook' },
      right: { ...evidence, documentId: right, title: 'Handbook' },
      reason: 'identical_content_hash',
      similarity: 1,
      status: 'open',
      revision: 1,
      actionId: null,
      createdAt: '2026-11-09',
      stale: false,
    })
    const card = (title: string, publishedAt: string) => ({
      title,
      mimeType: 'text/html',
      sizeBytes: 2048,
      publishedAt,
      enabled: true,
    })
    service.findings.mockResolvedValue({
      items: [copy('d1', 'c', 'd'), copy('d2', 'd', 'e')],
      nextCursor: null,
      documents: {
        c: card('Handbook', '2026-01-01T00:00:00Z'),
        d: card('Handbook v3', '2026-08-01T00:00:00Z'),
        e: card('Handbook (copy)', '2026-03-01T00:00:00Z'),
      },
    })
    service.act.mockImplementation(async ({ params }: { params: { finding_id: string } }) => ({
      ...copy(params.finding_id, 'c', 'd'),
      status: 'disabled',
      revision: 2,
    }))
    const user = userEvent.setup()
    renderPage()
    const keep = await screen.findByRole('radiogroup', { name: 'knowledgeSpace.tidy.chooseKeep' })
    expect(screen.getByRole('radio', { name: 'Handbook v3' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(keep).toHaveTextContent('knowledgeSpace.tidy.latest')
    expect(screen.getAllByText('knowledgeSpace.tidy.exactCopy')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.tidy.keepNewestMerge' }))
    expect(service.act).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('Handbook v3')
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    // Each step waits for the previous one (and its cache refresh) before the next disable.
    await waitFor(() => expect(service.act).toHaveBeenCalledTimes(2), { timeout: 3000 })
    // Walking outward from the kept copy: one disable per other copy, through the finding that reaches it.
    expect(service.act.mock.calls.map(([input]) => [input.params.finding_id, input.body])).toEqual([
      ['d1', { action: 'disable_document', expectedRevision: 1, documentId: 'c' }],
      ['d2', { action: 'disable_document', expectedRevision: 1, documentId: 'e' }],
    ])
  })
  it('lets an editor choose another copy to keep', async () => {
    const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 7, text: 'Welcome' }
    const finding = {
      id: 'd1',
      kind: 'duplicate',
      left: { ...evidence, documentId: 'c', title: 'Handbook' },
      right: { ...evidence, documentId: 'd', title: 'Handbook v3' },
      reason: 'identical_content_hash',
      similarity: 1,
      status: 'open',
      revision: 1,
      actionId: null,
      createdAt: '2026-11-09',
      stale: false,
    }
    service.findings.mockResolvedValue({ items: [finding], nextCursor: null })
    service.act.mockResolvedValue({ ...finding, status: 'disabled', revision: 2 })
    const user = userEvent.setup()
    renderPage()
    // Without document cards the first copy counts as the newest.
    expect(await screen.findByRole('radio', { name: 'Handbook' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(screen.getByRole('radio', { name: 'Handbook v3' }))
    expect(screen.getByRole('radio', { name: 'Handbook v3' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.tidy.keepSelectedMerge' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() =>
      expect(service.act).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { action: 'disable_document', expectedRevision: 1, documentId: 'c' },
        }),
      ),
    )
  })
  it('shows review cards to readers without any actions', async () => {
    const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 5 }
    service.findings.mockResolvedValue({
      items: [
        {
          id: 'f',
          kind: 'conflict',
          left: { ...evidence, documentId: 'a', title: 'Policy A', text: '十四天退款' },
          right: { ...evidence, documentId: 'b', title: 'Policy B', text: '七天退款' },
          reason: '期限不一致',
          similarity: null,
          status: 'open',
          revision: 1,
          actionId: null,
          createdAt: '2026-11-03',
          stale: false,
        },
      ],
      nextCursor: null,
    })
    renderPage(false)
    const card = await screen.findByRole('article', { name: '期限不一致' })
    expect(card).toHaveTextContent('七天退款')
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
  })
})

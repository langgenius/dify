import { ORPCError } from '@orpc/client'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createHttpError } from '@/service/http-error'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { CARDS_PER_PAGE } from '../findings-list'
import { TidyPage } from '../page'
import { OPEN_FINDING_PAGE_CAP } from '../use-tidy'

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
function renderAt(searchParams: string) {
  return renderWithConsoleQuery(
    <NuqsTestingAdapter hasMemory searchParams={searchParams}>
      <KnowledgeSpaceTestProvider
        space={createKnowledgeSpaceFixture({
          permission_keys: ['knowledge_space_read', 'knowledge_space_edit'],
        })}
      >
        <TidyPage />
      </KnowledgeSpaceTestProvider>
    </NuqsTestingAdapter>,
  )
}
const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 7, text: 'Welcome' }
const copyOf = (id: string, left: string, right: string) => ({
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
const documentCard = (title: string, publishedAt: string) => ({
  title,
  mimeType: 'text/html',
  sizeBytes: 2048,
  publishedAt,
  enabled: true,
})
const tidyOn = {
  enabled: true,
  conflicts: false,
  revision: 1,
  lastError: null,
  updatedAt: '2026-11-04',
}
const summaryWith = ({ pending }: { pending: number }) => ({
  findings: [],
  documents: { pending, scanning: 0, complete: 3, failed: 0 },
  modelCalls: 0,
})
/** A handled overlap between document `a` and `right`, as the findings API lists it. */
const handledPair = (id: string, right: string) => ({
  ...copyOf(id, 'a', right),
  kind: 'similar',
  right: { ...evidence, documentId: right, title: `Guide ${right}` },
  reason: 'textual_overlap',
  similarity: 0.5,
  status: 'reviewed',
})
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
    // Exact copies and overlapping documents share one tab and one count.
    expect(screen.getByRole('button', { name: 'knowledgeSpace.tidy.overlapKind 3' })).toBeVisible()
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
    // The merged tab asks for both kinds; the API filters one kind per request.
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.tidy.overlapKind 0' }))
    await waitFor(() =>
      expect(service.findings.mock.calls.map(([input]) => input.query)).toEqual(
        expect.arrayContaining([
          { status: 'open', kind: 'duplicate' },
          { status: 'open', kind: 'similar' },
        ]),
      ),
    )
  })
  it('lists handled copies and overlapping documents together, most overlap first, and pages both by cursor', async () => {
    const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 5 }
    const finding = (id: string, kind: string, similarity: number, right: string) => ({
      id,
      kind,
      left: { ...evidence, documentId: 'a', title: 'Guide A', text: `${id} A` },
      right: { ...evidence, documentId: right, title: `Guide ${right}`, text: `${id} ${right}` },
      reason: kind === 'duplicate' ? 'identical_content_hash' : 'textual_overlap',
      similarity,
      status: 'reviewed',
      revision: 1,
      actionId: null,
      createdAt: '2026-11-04',
      stale: false,
    })
    service.findings.mockImplementation(async ({ query }) =>
      query.kind === 'duplicate'
        ? { items: query.cursor ? [] : [finding('copy', 'duplicate', 1, 'b')], nextCursor: null }
        : query.cursor
          ? { items: [finding('later', 'similar', 0.5, 'e')], nextCursor: null }
          : {
              items: [
                finding('loose', 'similar', 0.6, 'c'),
                finding('close', 'similar', 0.999, 'd'),
              ],
              nextCursor: 'more',
            },
    )
    const user = userEvent.setup()
    renderWithConsoleQuery(
      <NuqsTestingAdapter hasMemory searchParams="?tidyKind=overlap&tidyStatus=reviewed">
        <KnowledgeSpaceTestProvider space={createKnowledgeSpaceFixture()}>
          <TidyPage />
        </KnowledgeSpaceTestProvider>
      </NuqsTestingAdapter>,
    )
    const section = await screen.findByRole('region', {
      name: 'knowledgeSpace.tidy.sectionOverlap',
    })
    const cards = within(section).getAllByRole('article')
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      expect.stringContaining('copiesTitle'),
      expect.stringContaining('Guide d'),
      expect.stringContaining('Guide c'),
    ])
    // Only identical content may read as a full match.
    expect(cards[0]).toHaveTextContent('knowledgeSpace.tidy.identical')
    expect(cards[1]).toHaveTextContent('"percent":99')

    // Copies ran out; the next page still shows the remaining overlapping documents.
    await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    expect(await screen.findByRole('article', { name: /Guide e/ })).toBeVisible()
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'common.pagination.next' })).not.toBeInTheDocument()
  })
  it('lists open overlapping documents of every API page together, most overlap first', async () => {
    const pair = (id: string, similarity: number, right: string) => ({
      ...copyOf(id, 'a', right),
      kind: 'similar',
      right: { ...evidence, documentId: right, title: `Guide ${right}` },
      reason: 'textual_overlap',
      similarity,
    })
    service.findings.mockImplementation(async ({ query }) =>
      query.kind === 'duplicate'
        ? { items: [copyOf('copy', 'a', 'b')], nextCursor: null }
        : query.cursor
          ? { items: [pair('closest', 0.9, 'e')], nextCursor: null }
          : { items: [pair('loose', 0.6, 'c'), pair('close', 0.8, 'd')], nextCursor: 'more' },
    )
    renderAt('?tidyKind=overlap')
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(4))
    expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual([
      expect.stringContaining('copiesTitle'),
      expect.stringContaining('Guide e'),
      expect.stringContaining('Guide d'),
      expect.stringContaining('Guide c'),
    ])
    expect(screen.queryByRole('button', { name: 'common.pagination.next' })).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
  it('groups copies whose findings span API pages and merges them in one request', async () => {
    service.findings.mockImplementation(async ({ query }) =>
      query.cursor
        ? {
            items: [copyOf('d2', 'd', 'e'), copyOf('d3', 'c', 'e')],
            nextCursor: null,
            documents: { e: documentCard('Handbook v4', '2026-10-01T00:00:00Z') },
          }
        : {
            items: [copyOf('d1', 'c', 'd')],
            nextCursor: 'second',
            documents: {
              c: documentCard('Handbook', '2026-01-01T00:00:00Z'),
              d: documentCard('Handbook v3', '2026-08-01T00:00:00Z'),
            },
          },
    )
    service.act.mockResolvedValue({})
    const user = userEvent.setup()
    renderPage()
    // The first page alone would show two copies and call "Handbook v3" the newest.
    expect(await screen.findByRole('radio', { name: 'Handbook v4' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(service.findings.mock.calls.map(([input]) => input.query)).toEqual([
      { status: 'open' },
      { status: 'open', cursor: 'second' },
    ])
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.tidy.keepNewestMerge' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Handbook v4')
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(service.act).toHaveBeenCalledTimes(1))
    expect(service.act.mock.calls.map(([input]) => [input.params.finding_id, input.body])).toEqual([
      [
        'd2',
        {
          action: 'disable_document',
          expectedRevision: 1,
          documentId: 'd',
          also: [
            { findingId: 'd3', action: 'disable_document', expectedRevision: 1, documentId: 'c' },
            { findingId: 'd1', action: 'review', expectedRevision: 1 },
          ],
        },
      ],
    ])
  })
  it('stops loading at the page cap, says the list is incomplete and withholds whole-group actions', async () => {
    const conflict = {
      ...copyOf('amount', 'x', 'y'),
      kind: 'conflict',
      left: { ...evidence, documentId: 'x', title: 'Policy X' },
      right: { ...evidence, documentId: 'y', title: 'Policy Y' },
      reason: 'amount',
      similarity: null,
    }
    service.findings.mockImplementation(async ({ query }) => {
      const at = Number(query.cursor ?? 0)
      return {
        items: [copyOf(`d${at}`, 'a', `b${at}`), ...(at === 0 ? [conflict] : [])],
        nextCursor: String(at + 1),
      }
    })
    service.act.mockResolvedValue({})
    const user = userEvent.setup()
    // A URL that keeps what is written to it: the cursor has to stay once Next was pressed.
    renderAt('')
    expect(await screen.findByRole('note')).toHaveTextContent('knowledgeSpace.tidy.incomplete')
    expect(service.findings).toHaveBeenCalledTimes(OPEN_FINDING_PAGE_CAP)
    // The groups are still shown, built from what was loaded.
    const copies = screen.getByRole('article', {
      name: new RegExp(`copiesTitle.*"count":${OPEN_FINDING_PAGE_CAP + 1}`),
    })
    expect(within(copies).queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(within(copies).queryByRole('button', { name: /Merge/ })).not.toBeInTheDocument()
    const pair = screen.getByRole('article', { name: /pairConflictTitle.*Policy X.*Policy Y/ })
    expect(within(pair).queryByRole('button', { name: /tidy\.disableOne/ })).not.toBeInTheDocument()
    // What settles one finding stays available.
    await user.click(within(pair).getByRole('button', { name: 'knowledgeSpace.tidy.notConflict' }))
    await waitFor(() =>
      expect(service.act).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ finding_id: 'amount' }),
          body: { expectedRevision: 1, action: 'dismiss' },
        }),
      ),
    )
    // The findings after the cap are reached by cursor.
    service.findings.mockResolvedValue({ items: [copyOf('last', 'a', 'z')], nextCursor: null })
    await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    await waitFor(() =>
      expect(service.findings).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: { status: 'open', cursor: String(OPEN_FINDING_PAGE_CAP) },
        }),
      ),
    )
    expect(await screen.findByRole('article', { name: /copiesTitle.*"count":2/ })).toBeVisible()
    // A list that does not start at the beginning cannot know its groups either.
    expect(screen.getByRole('note')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Merge/ })).not.toBeInTheDocument()
  })
  it('still merges copies when only the overlap list beside them is too long to load', async () => {
    service.findings.mockImplementation(async ({ query }) => {
      if (query.kind === 'duplicate') return { items: [copyOf('copy', 'c', 'd')], nextCursor: null }
      const at = Number(query.cursor ?? 0)
      return {
        items: [{ ...copyOf(`s${at}`, 'a', `b${at}`), kind: 'similar', similarity: 0.5 }],
        nextCursor: String(at + 1),
      }
    })
    renderAt('?tidyKind=overlap')
    expect(await screen.findByRole('note')).toHaveTextContent('knowledgeSpace.tidy.incomplete')
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.tidy.keepNewestMerge' }),
    ).toBeEnabled()
  })
  it('pages the loaded review cards in the browser without asking the API again', async () => {
    service.findings.mockResolvedValue({
      items: Array.from({ length: CARDS_PER_PAGE + 1 }, (_, index) => ({
        ...copyOf(`s${index}`, 'a', `b${index}`),
        kind: 'similar',
        similarity: 0.9 - index / 100,
      })),
      nextCursor: null,
    })
    const user = userEvent.setup()
    renderAt('')
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(CARDS_PER_PAGE))
    expect(screen.queryByRole('button', { name: 'common.operation.back' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))
    expect(screen.queryByRole('button', { name: 'common.pagination.next' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.back' }))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(CARDS_PER_PAGE))
    expect(service.findings).toHaveBeenCalledTimes(1)
  })
  it('polls a list of several API pages with one request while its first page is unchanged', async () => {
    const pages = (first: string) =>
      service.findings.mockImplementation(async ({ query }) =>
        query.cursor
          ? { items: [copyOf('d2', 'd', 'e')], nextCursor: null }
          : { items: [copyOf(first, 'c', 'd')], nextCursor: 'second' },
      )
    pages('d1')
    // The list is only polled while a scan can add to it.
    service.settings.mockResolvedValue(tidyOn)
    service.summary.mockResolvedValue(summaryWith({ pending: 1 }))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderPage()
      expect(await screen.findAllByRole('radio')).toHaveLength(3)
      expect(service.findings).toHaveBeenCalledTimes(2)
      await act(() => vi.advanceTimersByTimeAsync(15_000))
      expect(service.findings).toHaveBeenCalledTimes(3)
      expect(service.findings).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: { status: 'open' } }),
      )
      // A first page that changed says the list did: every page is read again.
      pages('d0')
      await act(() => vi.advanceTimersByTimeAsync(15_000))
      expect(service.findings).toHaveBeenCalledTimes(5)
    } finally {
      vi.useRealTimers()
    }
  })
  it('asks for nothing but the summary while no scan runs and polls again once one does', async () => {
    service.settings.mockResolvedValue(tidyOn)
    service.summary.mockResolvedValue(summaryWith({ pending: 0 }))
    const requests = () => ({
      findings: service.findings.mock.calls.length,
      scans: service.scans.mock.calls.length,
      settings: service.settings.mock.calls.length,
      summary: service.summary.mock.calls.length,
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderPage()
      expect(await screen.findByText('knowledgeSpace.tidy.empty')).toBeVisible()
      await waitFor(() =>
        expect(requests()).toEqual({ findings: 1, scans: 1, settings: 1, summary: 1 }),
      )
      // Idle: almost a minute passes without a request.
      await act(() => vi.advanceTimersByTimeAsync(59_000))
      expect(requests()).toEqual({ findings: 1, scans: 1, settings: 1, summary: 1 })

      // The slow summary poll finds documents published elsewhere waiting for a scan.
      service.summary.mockResolvedValue(summaryWith({ pending: 2 }))
      await act(() => vi.advanceTimersByTimeAsync(2_000))
      expect(requests()).toEqual({ findings: 1, scans: 1, settings: 1, summary: 2 })
      expect(screen.getByRole('progressbar')).toBeVisible()
      // From then on everything is polled at the pace of a scan.
      await act(() => vi.advanceTimersByTimeAsync(16_000))
      expect(requests()).toEqual({ findings: 2, scans: 2, settings: 2, summary: 3 })

      // The scan ends having found something: the lists are read one last time, then left alone.
      service.summary.mockResolvedValue({
        ...summaryWith({ pending: 0 }),
        findings: [{ status: 'open', kind: 'duplicate', count: 1 }],
      })
      service.findings.mockResolvedValue({ items: [copyOf('d1', 'c', 'd')], nextCursor: null })
      await act(() => vi.advanceTimersByTimeAsync(15_000))
      expect(await screen.findByRole('article', { name: /copiesTitle/ })).toBeVisible()
      const settled = requests()
      expect(settled.summary).toBe(4)
      await act(() => vi.advanceTimersByTimeAsync(50_000))
      expect(requests()).toEqual(settled)
    } finally {
      vi.useRealTimers()
    }
  })
  it('polls nothing while Tidy is off', async () => {
    // Documents wait, but with Tidy off no scan will take them.
    service.summary.mockResolvedValue(summaryWith({ pending: 2 }))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderPage()
      expect(await screen.findByText('knowledgeSpace.tidy.empty')).toBeVisible()
      await waitFor(() => expect(service.scans).toHaveBeenCalledTimes(1))
      await act(() => vi.advanceTimersByTimeAsync(180_000))
      expect(service.summary).toHaveBeenCalledTimes(1)
      expect(service.settings).toHaveBeenCalledTimes(1)
      expect(service.findings).toHaveBeenCalledTimes(1)
      expect(service.scans).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('goes back one page of handled findings at a time', async () => {
    const pages: Record<string, { items: unknown[]; nextCursor: string | null }> = {
      first: { items: [handledPair('f1', 'b')], nextCursor: 'second' },
      second: { items: [handledPair('f2', 'c')], nextCursor: 'third' },
      third: { items: [handledPair('f3', 'd')], nextCursor: null },
    }
    service.findings.mockImplementation(async ({ query }) => pages[query.cursor ?? 'first'])
    const user = userEvent.setup()
    const next = () => user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    const back = () => user.click(screen.getByRole('button', { name: 'common.operation.back' }))
    renderAt('?tidyStatus=reviewed')
    expect(await screen.findByRole('article', { name: /Guide b/ })).toBeVisible()
    await next()
    expect(await screen.findByRole('article', { name: /Guide c/ })).toBeVisible()
    await next()
    expect(await screen.findByRole('article', { name: /Guide d/ })).toBeVisible()

    await back()
    expect(await screen.findByRole('article', { name: /Guide c/ })).toBeVisible()
    expect(screen.getAllByRole('article')).toHaveLength(1)
    // A page that is opened again is read again.
    await waitFor(() =>
      expect(service.findings).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: { status: 'reviewed', cursor: 'second' } }),
      ),
    )
    expect(screen.getByRole('button', { name: 'common.pagination.next' })).toBeVisible()
    await back()
    expect(await screen.findByRole('article', { name: /Guide b/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'common.operation.back' })).not.toBeInTheDocument()
  })
  it('goes back to the first page from a linked page, whose earlier pages it cannot know', async () => {
    service.findings.mockImplementation(async ({ query }) =>
      query.cursor
        ? { items: [handledPair('f3', 'd')], nextCursor: null }
        : { items: [handledPair('f1', 'b')], nextCursor: 'second' },
    )
    const user = userEvent.setup()
    renderAt('?tidyStatus=reviewed&tidyCursor=third')
    expect(await screen.findByRole('article', { name: /Guide d/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'common.operation.back' }))
    expect(await screen.findByRole('article', { name: /Guide b/ })).toBeVisible()
    expect(service.findings).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: { status: 'reviewed' } }),
    )
    expect(screen.queryByRole('button', { name: 'common.operation.back' })).not.toBeInTheDocument()
  })
  it('returns from the findings past the cap to the page of cards it left', async () => {
    const pair = (id: string) => ({
      ...copyOf(id, 'a', id),
      kind: 'similar',
      right: { ...evidence, documentId: id, title: `Guide ${id}` },
      reason: 'textual_overlap',
      similarity: 0.5,
    })
    // Every API page holds two findings, so the capped list fills two pages of cards.
    service.findings.mockImplementation(async ({ query }) => {
      const at = Number(query.cursor ?? 0)
      return at < OPEN_FINDING_PAGE_CAP
        ? { items: [pair(`p${at}`), pair(`q${at}`)], nextCursor: String(at + 1) }
        : { items: [pair('last')], nextCursor: null }
    })
    const user = userEvent.setup()
    const next = () => user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    renderAt('')
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(CARDS_PER_PAGE))
    await next()
    await waitFor(() =>
      expect(screen.getAllByRole('article')).toHaveLength(
        2 * OPEN_FINDING_PAGE_CAP - CARDS_PER_PAGE,
      ),
    )
    const lastCard = screen.getAllByRole('article').at(-1)?.getAttribute('aria-label')
    await next()
    expect(await screen.findByRole('article', { name: /Guide last/ })).toBeVisible()
    expect(screen.getAllByRole('article')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'common.operation.back' }))
    await waitFor(() =>
      expect(screen.getAllByRole('article').at(-1)).toHaveAttribute('aria-label', lastCard),
    )
    // Not the first page of cards: there is still one before it.
    await user.click(screen.getByRole('button', { name: 'common.operation.back' }))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(CARDS_PER_PAGE))
    expect(screen.queryByRole('button', { name: 'common.operation.back' })).not.toBeInTheDocument()
  })
  it('goes back one page of scanned documents at a time', async () => {
    const scan = (title: string) => ({
      documentId: title,
      title,
      state: 'complete',
      windows: 1,
      modelCalls: 0,
    })
    const pages: Record<string, { items: unknown[]; nextCursor: string | null }> = {
      first: { items: [scan('One.md')], nextCursor: 'second' },
      second: { items: [scan('Two.md')], nextCursor: 'third' },
      third: { items: [scan('Three.md')], nextCursor: null },
    }
    service.scans.mockImplementation(async ({ query }) => pages[query.cursor ?? 'first'])
    const user = userEvent.setup()
    const next = () => user.click(screen.getByRole('button', { name: 'common.pagination.next' }))
    const back = () => user.click(screen.getByRole('button', { name: 'common.operation.back' }))
    renderAt('')
    await user.click(await screen.findByText('knowledgeSpace.tidy.progress'))
    expect(await screen.findByText('One.md')).toBeVisible()
    await next()
    expect(await screen.findByText('Two.md')).toBeVisible()
    await next()
    expect(await screen.findByText('Three.md')).toBeVisible()

    await back()
    expect(await screen.findByText('Two.md')).toBeVisible()
    expect(screen.queryByText('Three.md')).not.toBeInTheDocument()
    await back()
    expect(await screen.findByText('One.md')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'common.operation.back' })).not.toBeInTheDocument()
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
  it('leaves a failure of a cancelled confirmation in the dialog, not on the page', async () => {
    service.configure.mockRejectedValueOnce(new Error('unavailable'))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('switch'))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'knowledgeSpace.tidy.error',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Nothing failed on the page itself, and the next opening starts clean.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch'))
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument()
  })
  it('names each switch through ids of its own, so two pages in one document do not collide', async () => {
    service.settings.mockResolvedValue({
      enabled: true,
      conflicts: false,
      revision: 1,
      lastError: null,
      updatedAt: '2026-11-04',
    })
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <KnowledgeSpaceTestProvider space={createKnowledgeSpaceFixture()}>
          <TidyPage />
          <TidyPage />
        </KnowledgeSpaceTestProvider>
      </NuqsTestingAdapter>,
    )
    const switches = [
      ...(await screen.findAllByRole('switch', { name: 'knowledgeSpace.tidy.enabled' })),
      ...(await screen.findAllByRole('switch', { name: 'knowledgeSpace.tidy.conflicts' })),
    ]
    expect(switches).toHaveLength(4)
    expect(new Set(switches.map((node) => node.getAttribute('aria-labelledby'))).size).toBe(4)
  })
  it('lists findings whose decision is outdated when that status is asked for', async () => {
    renderWithConsoleQuery(
      <NuqsTestingAdapter searchParams="?tidyStatus=outdated">
        <KnowledgeSpaceTestProvider space={createKnowledgeSpaceFixture()}>
          <TidyPage />
        </KnowledgeSpaceTestProvider>
      </NuqsTestingAdapter>,
    )
    expect(
      await screen.findByRole('combobox', { name: 'knowledgeSpace.tidy.statusFilter' }),
    ).toHaveTextContent('knowledgeSpace.tidy.outdated')
    await waitFor(() =>
      expect(service.findings).toHaveBeenCalledWith(
        expect.objectContaining({ query: { status: 'outdated' } }),
      ),
    )
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
    // One request carries the whole merge, so every other copy is disabled or none is.
    await waitFor(() => expect(service.act).toHaveBeenCalledTimes(1))
    // Walking outward from the kept copy: one disable per other copy, through the finding that reaches it.
    expect(service.act.mock.calls.map(([input]) => [input.params.finding_id, input.body])).toEqual([
      [
        'd1',
        {
          action: 'disable_document',
          expectedRevision: 1,
          documentId: 'c',
          also: [
            { findingId: 'd2', action: 'disable_document', expectedRevision: 1, documentId: 'e' },
          ],
        },
      ],
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
    const card = await screen.findByRole('article', {
      name: /pairConflictTitle.*Policy A.*Policy B/,
    })
    expect(within(card).getByRole('listitem', { name: '期限不一致' })).toHaveTextContent('七天退款')
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
  })
  it('reviews everything two documents disagree on in one card, settling each difference on its own', async () => {
    const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 5 }
    const finding = (id: string, kind: string, extra: object) => ({
      id,
      kind,
      left: { ...evidence, documentId: 'a', title: 'Policy A', text: `${id} A` },
      right: { ...evidence, documentId: 'b', title: 'Policy B', text: `${id} B` },
      reason: id,
      similarity: null,
      status: 'open',
      revision: 1,
      actionId: null,
      createdAt: '2026-11-03',
      stale: false,
      ...extra,
    })
    service.findings.mockResolvedValue({
      items: [
        finding('amount', 'conflict', {}),
        // The scanner may quote the same pair the other way round.
        finding('duration', 'conflict', {
          left: { ...evidence, documentId: 'b', title: 'Policy B', text: 'duration B' },
          right: { ...evidence, documentId: 'a', title: 'Policy A', text: 'duration A' },
        }),
        finding('overlap', 'similar', { reason: 'text_overlap', similarity: 0.9 }),
        finding('elsewhere', 'similar', {
          reason: 'text_overlap',
          similarity: 0.8,
          right: { ...evidence, documentId: 'c', title: 'Policy C', text: 'elsewhere C' },
        }),
      ],
      nextCursor: null,
    })
    service.act.mockResolvedValue({})
    const user = userEvent.setup()
    renderPage()

    // One card for the pair's conflicts; every overlap finding keeps its own card under "similar".
    const card = await screen.findByRole('article', { name: /pairConflictTitle.*"count":2/ })
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(card).toHaveTextContent('knowledgeSpace.tidy.pairAlsoSimilar')
    const duration = within(card).getByRole('listitem', { name: 'duration' })
    const passages = within(duration).getAllByText(/duration [AB]/)
    expect(passages.map((node) => node.textContent)).toEqual(['duration A', 'duration B'])

    await user.click(
      within(duration).getByRole('button', { name: 'knowledgeSpace.tidy.notConflict' }),
    )
    await waitFor(() =>
      expect(service.act).toHaveBeenLastCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ finding_id: 'duration' }),
          body: { expectedRevision: 1, action: 'dismiss' },
        }),
      ),
    )
    await user.click(
      within(within(card).getByRole('listitem', { name: 'amount' })).getByRole('button', {
        name: 'knowledgeSpace.tidy.markHandled',
      }),
    )
    await waitFor(() =>
      expect(service.act).toHaveBeenLastCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ finding_id: 'amount' }),
          body: { expectedRevision: 1, action: 'review' },
        }),
      ),
    )

    // Disabling a whole document settles the pair's other findings in the same run.
    service.act.mockClear()
    await user.click(within(card).getByRole('button', { name: /tidy\.disableOne.*Policy B/ }))
    expect(screen.getByRole('dialog').textContent).toMatch(/disableAlsoResolves.*"count":2/)
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(service.act).toHaveBeenCalledTimes(1))
    const [disableRequest] = service.act.mock.calls[0] ?? []
    expect([
      [disableRequest.params.finding_id, disableRequest.body.action],
      ...disableRequest.body.also.map((step: { findingId: string; action: string }) => [
        step.findingId,
        step.action,
      ]),
    ]).toEqual([
      ['overlap', 'disable_document'],
      ['amount', 'review'],
      ['duration', 'review'],
    ])
    expect(service.act.mock.calls[0]?.[0].body.documentId).toBe('b')

    // The same holds when the document is disabled from the pair's overlap card.
    service.act.mockClear()
    const overlap = screen.getByRole('article', { name: /similarTitle.*Policy A.*Policy B/ })
    await user.click(
      within(overlap).getByRole('button', { name: 'knowledgeSpace.tidy.keepSelectedDisableOther' }),
    )
    expect(screen.getByRole('dialog').textContent).toMatch(/disableAlsoResolves.*"count":2/)
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(service.act).toHaveBeenCalledTimes(1))
    const [request] = service.act.mock.calls[0] ?? []
    expect([
      [request.params.finding_id, request.body.action],
      ...request.body.also.map((step: { findingId: string; action: string }) => [
        step.findingId,
        step.action,
      ]),
    ]).toEqual([
      ['overlap', 'disable_document'],
      ['amount', 'review'],
      ['duration', 'review'],
    ])
  })
  it('adopts one side of a conflict by rewriting the passage in the other document, after showing the edit', async () => {
    const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 5 }
    const card = (title: string, mimeType: string) => ({
      title,
      mimeType,
      sizeBytes: 1,
      publishedAt: '2026-11-03T00:00:00Z',
      enabled: true,
    })
    const finding = (id: string, rightId: string, rightTitle: string) => ({
      id,
      kind: 'conflict',
      left: { ...evidence, documentId: 'a', title: 'Notes A', text: '报销15000元' },
      right: { ...evidence, documentId: rightId, title: rightTitle, text: '报销5000元' },
      reason: id,
      similarity: null,
      status: 'open',
      revision: 4,
      actionId: null,
      createdAt: '2026-11-03',
      stale: false,
    })
    service.findings.mockResolvedValue({
      items: [finding('amount', 'b', 'Notes B'), finding('scanned', 'p', 'Scan.pdf')],
      documents: {
        a: card('Notes A', 'text/markdown'),
        b: card('Notes B', 'text/markdown; charset=utf-8'),
        p: card('Scan.pdf', 'application/pdf'),
      },
      nextCursor: null,
    })
    service.act.mockRejectedValueOnce(
      new ORPCError('knowledge_fs_conflict', {
        status: 409,
        data: { details: { parameters: { status: 'too_long' } } },
      }),
    )
    service.act.mockResolvedValue({})
    const user = userEvent.setup()
    renderPage()

    // Any document type can be patched: only the indexed passage changes, never the source file.
    const scanned = within(await screen.findByRole('listitem', { name: 'scanned' }))
    for (const button of scanned.getAllByRole('button', { name: 'knowledgeSpace.tidy.adopt' }))
      expect(button).toBeEnabled()

    // Notes A is right: the passage in Notes B is replaced by A's statement, editable first.
    const amount = within(screen.getByRole('listitem', { name: 'amount' }))
    await user.click(amount.getAllByRole('button', { name: 'knowledgeSpace.tidy.adopt' })[0]!)
    const dialog = within(screen.getByRole('dialog'))
    expect(service.act).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog').textContent).toMatch(/rewriteDescription.*Notes B/)
    expect(dialog.getByText('报销5000元')).toBeVisible()
    const replacement = dialog.getByRole('textbox')
    expect(replacement).toHaveValue('报销15000元')
    await user.clear(replacement)
    await user.type(replacement, '报销 15,000 元')

    // The server names why it refused; the dialog stays open for another try.
    await user.click(dialog.getByRole('button', { name: 'knowledgeSpace.tidy.rewriteConfirm' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('knowledgeSpace.tidy.rewriteTooLong')
    await user.click(dialog.getByRole('button', { name: 'knowledgeSpace.tidy.rewriteConfirm' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(service.act).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ finding_id: 'amount' }),
        body: {
          action: 'adopt',
          expectedRevision: 4,
          documentId: 'a',
          replacement: '报销 15,000 元',
        },
      }),
    )
    expect(service.act).toHaveBeenCalledTimes(2)
  })
  it('accepts a replacement as long as the API does and refuses a blank one', async () => {
    const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 5 }
    service.findings.mockResolvedValue({
      items: [
        {
          id: 'amount',
          kind: 'conflict',
          left: { ...evidence, documentId: 'a', title: 'Notes A', text: '报销15000元' },
          right: { ...evidence, documentId: 'b', title: 'Notes B', text: '报销5000元' },
          reason: 'amount',
          similarity: null,
          status: 'open',
          revision: 4,
          actionId: null,
          createdAt: '2026-11-03',
          stale: false,
        },
      ],
      nextCursor: null,
    })
    const user = userEvent.setup()
    renderPage()
    await user.click(
      (await screen.findAllByRole('button', { name: 'knowledgeSpace.tidy.adopt' }))[0]!,
    )
    const dialog = within(screen.getByRole('dialog'))
    const replacement = dialog.getByRole('textbox')
    expect(replacement).toHaveAttribute('maxlength', '20000')
    await user.clear(replacement)
    await user.type(replacement, '   ')
    expect(
      dialog.getByRole('button', { name: 'knowledgeSpace.tidy.rewriteConfirm' }),
    ).toBeDisabled()
    // A disabled default button also stops Enter in the form from sending it.
    await user.type(replacement, '{Enter}')
    expect(service.act).not.toHaveBeenCalled()
  })
  it('offers keeping both overlapping documents on equal footing with disabling one', async () => {
    const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 5 }
    service.findings.mockResolvedValue({
      items: [
        {
          id: 'f',
          kind: 'similar',
          left: { ...evidence, documentId: 'a', title: 'Guide A', text: 'shared A' },
          right: { ...evidence, documentId: 'b', title: 'Guide B', text: 'shared B' },
          reason: 'text_overlap',
          similarity: 0.7,
          status: 'open',
          revision: 1,
          actionId: null,
          createdAt: '2026-11-03',
          stale: false,
        },
      ],
      nextCursor: null,
    })
    service.act.mockResolvedValue({})
    const user = userEvent.setup()
    renderPage()
    const card = await screen.findByRole('article')
    expect(
      within(card).getByRole('button', { name: 'knowledgeSpace.tidy.keepSelectedDisableOther' }),
    ).toBeVisible()
    await user.click(within(card).getByRole('button', { name: 'knowledgeSpace.tidy.keepBoth' }))
    await waitFor(() =>
      expect(service.act).toHaveBeenCalledWith(
        expect.objectContaining({ body: { expectedRevision: 1, action: 'review' } }),
      ),
    )
  })
})

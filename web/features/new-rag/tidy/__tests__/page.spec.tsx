import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createHttpError } from '@/service/http-error'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { TidyPage } from '../page'

const service = vi.hoisted(() => ({
  settings: vi.fn(),
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
      revision: 0,
      lastError: null,
      updatedAt: '2026-11-03',
    })
    service.configure.mockResolvedValue({
      enabled: true,
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
          body: { enabled: true, expectedRevision: 0, acknowledgeTokenUsage: true },
        }),
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
      screen.getByRole('button', { name: 'knowledgeSpace.tidy.disableDocument Policy B' }),
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
})

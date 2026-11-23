import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { TidyPage } from '../page'
const service = vi.hoisted(() => ({
  settings: vi.fn(),
  configure: vi.fn(),
  findings: vi.fn(),
  act: vi.fn(),
}))
vi.mock('@/service/console', async (original) => {
  const actual = await original<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.byControlSpaceId.tidy.settings.get': service.settings,
      'knowledgeFs.spaces.byControlSpaceId.tidy.summary.get': async () => ({
        findings: [],
        documents: { pending: 0, scanning: 0, complete: 0, failed: 0 },
        modelCalls: 0,
      }),
      'knowledgeFs.spaces.byControlSpaceId.tidy.settings.patch': service.configure,
      'knowledgeFs.spaces.byControlSpaceId.tidy.findings.get': service.findings,
      'knowledgeFs.spaces.byControlSpaceId.tidy.scans.get': async () => ({
        items: [],
        nextCursor: null,
      }),
      'knowledgeFs.spaces.byControlSpaceId.tidy.findings.byFindingId.actions.post': service.act,
    }),
  }
})
async function setup(withFinding = false) {
  service.settings.mockResolvedValue({
    enabled: false,
    conflicts: true,
    revision: 0,
    lastError: null,
    updatedAt: '2026-11-03',
  })
  const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 3 }
  const finding = {
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
  }
  service.findings.mockResolvedValue({ items: withFinding ? [finding] : [], nextCursor: null })
  service.act.mockImplementation(async () => {
    service.findings.mockResolvedValue({ items: [], nextCursor: null })
    return { ...finding, status: 'disabled', revision: 2 }
  })
  const { queryClient } = createConsoleQueryWrapper()
  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <KnowledgeSpaceTestProvider
          space={createKnowledgeSpaceFixture({
            permission_keys: ['knowledge_space_read', 'knowledge_space_edit'],
          })}
        >
          <TidyPage />
        </KnowledgeSpaceTestProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
}
// A controlled popup opens from either a switch or a card button removed after processing.
// Real focus and animation completion prove restoration when that original target disappears.
describe('Tidy confirmation focus', () => {
  beforeEach(() => vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false))
  afterEach(() => vi.unstubAllGlobals())
  it('restores keyboard focus to the toggle when token consent is cancelled', async () => {
    await page.viewport(390, 844)
    const screen = await setup()
    const toggle = screen.getByRole('switch', { name: 'knowledgeSpace.tidy.enabled' })
    await toggle.click()
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(toggle).toHaveFocus()
    expect(service.configure).not.toHaveBeenCalled()
  })
  it('keeps focus on the review queue after processing removes the evidence button', async () => {
    const screen = await setup(true)
    await screen.getByRole('button', { name: /knowledgeSpace\.tidy\.disableOne.*Policy B/ }).click()
    await screen.getByRole('button', { name: 'common.operation.confirm' }).click()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    // Focus returns to the active type tab at the top of the review queue.
    await expect
      .element(
        screen.getByRole('button', { name: /knowledgeSpace\.tidy\.allKinds/, pressed: true }),
      )
      .toHaveFocus()
  })
})

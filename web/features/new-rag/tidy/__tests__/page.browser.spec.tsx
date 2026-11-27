import type {
  KnowledgeFsTidyFindingResponse,
  KnowledgeFsTidySettingsResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { setupFakeApi } from '@/test/fake-api'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { TidyPage } from '../page'

const space = createKnowledgeSpaceFixture({
  permission_keys: ['knowledge_space_read', 'knowledge_space_edit'],
})
const settings: KnowledgeFsTidySettingsResponse = {
  enabled: false,
  conflicts: true,
  revision: 0,
  lastError: null,
  updatedAt: '2026-11-03',
}
const evidence = { revision: 1, chunkId: 'chunk', start: 0, end: 3 }
const finding: KnowledgeFsTidyFindingResponse = {
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
// The server's open findings: the list handler reads it and a reviewer action empties it, so the
// reload that follows an action finds the card gone, as it would against the real API.
let openFindings: KnowledgeFsTidyFindingResponse[] = []
beforeEach(() => {
  openFindings = []
})

const fake = setupFakeApi({
  console: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          tidy: {
            settings: { get: () => settings, patch: () => settings },
            summary: {
              get: () => ({
                findings: [],
                documents: { pending: 0, scanning: 0, complete: 0, failed: 0 },
                modelCalls: 0,
              }),
            },
            findings: {
              get: () => ({ items: openFindings, nextCursor: null }),
              byFindingId: {
                actions: {
                  post: () => {
                    openFindings = []
                    return { ...finding, status: 'disabled' as const, revision: 2 }
                  },
                },
              },
            },
            scans: { get: () => ({ items: [], nextCursor: null }) },
          },
        },
      },
    },
  },
})
const tidy = () => fake.console.knowledgeFs.spaces.byControlSpaceId.tidy

async function setup(withFinding = false) {
  if (withFinding) openFindings = [finding]
  const { queryClient } = createConsoleQueryWrapper()
  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <KnowledgeSpaceTestProvider space={space}>
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
    const params = { control_space_id: space.control_space_id }
    expect(tidy().settings.get).toHaveBeenCalledWith({ params })
    expect(tidy().findings.get).toHaveBeenCalledWith({ params, query: { status: 'open' } })
    expect(tidy().settings.patch).not.toHaveBeenCalled()
  })
  it('keeps showing what was asked while the dialog animates out', async () => {
    const screen = await setup(true)
    await screen.getByRole('button', { name: /knowledgeSpace\.tidy\.disableOne.*Policy B/ }).click()
    const dialog = screen.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    // Every text the closing dialog shows, from the moment it is dismissed until it is gone.
    const shown: string[] = []
    const element = dialog.element()
    const observer = new MutationObserver(() => shown.push(element.textContent))
    observer.observe(element, { childList: true, characterData: true, subtree: true })
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    observer.disconnect()
    for (const text of shown) expect(text).toContain('Policy B')
    expect(tidy().findings.byFindingId.actions.post).not.toHaveBeenCalled()
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
    expect(tidy().findings.byFindingId.actions.post).toHaveBeenCalledExactlyOnceWith({
      params: { control_space_id: space.control_space_id, finding_id: finding.id },
      body: { action: 'disable_document', expectedRevision: finding.revision, documentId: 'b' },
    })
  })
})

import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { KnowledgeUpgrade } from '../knowledge-upgrade-context-value'
import type { consoleClient } from '@/service/console'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { upgradeDataset, upgradeJob } from '@/test/new-rag-upgrade'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { KnowledgeUpgradeCard } from '../knowledge-upgrade-card'
import { KnowledgeUpgradeProvider } from '../knowledge-upgrade-context'
import { useKnowledgeUpgrade } from '../knowledge-upgrade-context-value'

const api = vi.hoisted(() => ({
  status: vi.fn<typeof consoleClient.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get': api.status,
    }),
  }
})

const job: KnowledgeFsUpgradeJobResponse = {
  ...upgradeJob,
  completed_documents: 12,
  completed_sources: 1,
  new_control_space_id: 'space-1',
  status: 'running',
  stage: 'submitting_documents',
  total_documents: 52,
  total_sources: 1,
}
const upgrade: KnowledgeUpgrade = {
  canRetry: false,
  dataset: { ...upgradeDataset, app_count: 2, description: 'Support articles', document_count: 52 },
  job,
}
async function renderCard(value = upgrade) {
  const { wrapper: QueryProvider } = createConsoleQueryWrapper()
  const ui = (next: KnowledgeUpgrade) => (
    <QueryProvider>
      <ul className="w-80">
        <KnowledgeUpgradeCard upgrade={next} />
      </ul>
    </QueryProvider>
  )
  const screen = await render(ui(value))
  return { rerender: (next: KnowledgeUpgrade) => screen.rerender(ui(next)) }
}
function PollingOwner() {
  const { settleUpgrade, upgrades } = useKnowledgeUpgrade()
  const [destination, setDestination] = useState<string>()
  return (
    <>
      <ul className="w-80">
        <KnowledgeUpgradeCard
          upgrade={upgrades[0] ?? upgrade}
          onSettled={settleUpgrade}
          onSucceeded={setDestination}
        />
      </ul>
      <output aria-label="Tracked upgrade">
        {upgrades.map((entry) => `${entry.job.id}:${entry.job.status}`).join(',')}
      </output>
      {destination && <a href={`/datasets/new/${destination}`}>Continue to knowledge</a>}
    </>
  )
}

beforeEach(async ({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  await page.viewport(640, 600)
  api.status.mockReset().mockImplementation(() => new Promise(() => {}))
  // Only the query polling interval is controlled; browser input and rendering stay real.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})
afterEach(() => vi.useRealTimers())

it('replaces live progress with the completed total and a usable knowledge link after polling settles', async () => {
  const response = createDeferred<KnowledgeFsUpgradeJobResponse>()
  api.status.mockReturnValue(response.promise)
  const { wrapper: QueryProvider } = createConsoleQueryWrapper()
  await render(
    <QueryProvider>
      <KnowledgeUpgradeProvider onUpgradeStarted={() => {}}>
        <PollingOwner />
      </KnowledgeUpgradeProvider>
    </QueryProvider>,
  )
  await expect.element(page.getByLabelText('knowledgeSpace.documents: 12/52')).toBeVisible()
  await expect
    .element(page.getByText('knowledgeUpgrade.upgrade.statusUpgrading', { exact: true }))
    .toBeVisible()
  await vi.advanceTimersByTimeAsync(2000)
  await expect.poll(() => api.status.mock.calls.length).toBe(1)
  response.resolve({ ...job, completed_documents: 52, stage: 'completed', status: 'succeeded' })

  const link = page.getByRole('link', { name: 'Support knowledge', exact: true })
  await expect.element(link).toBeVisible()
  await expect.element(link).toHaveAttribute('href', '/datasets/new/space-1')
  await expect.element(link.getByLabelText('knowledgeSpace.documents: 52')).toBeVisible()
  await expect
    .element(page.getByText('knowledgeUpgrade.upgrade.statusUpgrading', { exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByLabelText('Tracked upgrade'))
    .toHaveTextContent('upgrade-1:succeeded')
  await expect
    .element(page.getByRole('link', { name: 'Continue to knowledge' }))
    .toHaveAttribute('href', '/datasets/new/space-1')
  // The completed card is a native keyboard target rather than the fake header from the old suite.
  await userEvent.keyboard('{Tab}')
  await expect.element(link).toHaveFocus()
})

it.each(['failed', 'succeeded'] as const)(
  'shows total documents for a %s migration and does not poll a terminal job',
  async (status) => {
    await renderCard({
      ...upgrade,
      job: { ...job, status, stage: status === 'succeeded' ? 'completed' : 'submitting_documents' },
    })
    await expect.element(page.getByLabelText('knowledgeSpace.documents: 52')).toBeVisible()
    await vi.advanceTimersByTimeAsync(4000)
    expect(api.status).not.toHaveBeenCalled()
  },
)

it('shows the backend failure and exposes retry only when discovery permits it', async () => {
  const failedUpgrade: KnowledgeUpgrade = {
    ...upgrade,
    canRetry: true,
    job: { ...job, status: 'failed', last_error_message: 'The source could not be migrated' },
  }
  const screen = await renderCard(failedUpgrade)
  await expect
    .element(page.getByText('The source could not be migrated', { exact: true }))
    .toBeVisible()
  const retry = page.getByRole('button', { name: 'common.operation.retry', exact: true })
  await expect.element(retry).toBeVisible()
  await screen.rerender({ ...failedUpgrade, canRetry: false })
  await expect.element(retry).not.toBeInTheDocument()
  await expect
    .element(page.getByText('The source could not be migrated', { exact: true }))
    .toBeVisible()
})

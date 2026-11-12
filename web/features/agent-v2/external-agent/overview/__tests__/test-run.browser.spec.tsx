import { detectPlatform } from '@tanstack/react-hotkeys'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createExternalRosterPreview } from '@/features/agent-v2/roster/external-roster-preview'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { createExternalAgentOverviewPreview } from '../../preview'
import { ExternalAgentOverviewPage } from '../page'
import { ExternalAgentTestPanel } from '../test-run'

const router = vi.hoisted(() => ({ push: vi.fn() }))
// boundary: restore real translations so this fixture's I18nextProvider supplies rendered labels.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
// boundary: Browser Mode has no application router; the overview only reads its current route.
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => router,
  usePathname: () => '/external-agent/contract-review/overview',
}))

async function createI18n() {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, app, common } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  return i18n
}

async function setup() {
  await page.viewport(1512, 982)
  const i18n = await createI18n()
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
  })
  onTestFinished(() => queryClient.clear())
  await render(
    <QueryProvider>
      <NuqsTestingAdapter hasMemory>
        <I18nextProvider i18n={i18n}>
          <div className="flex h-screen min-w-0 flex-col">
            <ExternalAgentOverviewPage agentId="contract-review" />
            <AppToaster timeout={0} />
          </div>
        </I18nextProvider>
      </NuqsTestingAdapter>
    </QueryProvider>,
  )
  await expect
    .element(page.getByRole('heading', { name: 'Contract Review Agent', exact: true }))
    .toBeVisible()
}

function mockRunClock(mockDate = true) {
  vi.useFakeTimers({
    toFake: mockDate ? ['setTimeout', 'clearTimeout', 'Date'] : ['setTimeout', 'clearTimeout'],
  })
  onTestFinished(() => {
    vi.useRealTimers()
  })
}

beforeEach(({ onTestFinished }) => {
  router.push.mockReset()
  onTestFinished(guardUnexpectedFetch())
  onTestFinished(() => toast.dismiss())
})

it('runs a skill example for five seconds and shows its result inline without a duplicate toast', async () => {
  await setup()
  const example = 'Review this payment clause and suggest a safer alternative.'
  await page.getByRole('button', { name: 'Example requests', exact: true }).first().click()
  await expect.element(page.getByText(example, { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Test agent', exact: true })
  const task = panel.getByRole('textbox', { name: 'Task', exact: true })
  const run = panel.getByRole('button', { name: 'Run test', exact: true })
  const status = panel.getByRole('status')
  const result = panel.getByRole('tab', { name: 'Result', exact: true })
  const tracing = panel.getByRole('tab', { name: 'Tracing', exact: true })
  await expect.element(task).toHaveFocus()
  await expect.element(task).toHaveValue('')
  await expect.element(run).toBeDisabled()
  await task.fill('   ')
  await expect.element(run).toBeDisabled()

  await panel.getByRole('button', { name: 'Contract review', exact: true }).click()
  await expect.element(task).toHaveValue(example)
  await expect.element(run).toBeEnabled()
  mockRunClock()
  await run.click()
  await expect.element(status.getByText('Running', { exact: true })).toBeVisible()
  await expect
    .element(panel)
    .toHaveAccessibleDescription('You can close this panel. The test will continue.')
  await expect.element(task).toHaveAttribute('readonly')
  await expect.element(panel.getByRole('button', { name: 'Stop test', exact: true })).toBeVisible()
  await expect.element(tracing).toHaveAttribute('aria-selected', 'true')
  await expect
    .element(panel.getByRole('tabpanel', { name: 'Tracing', exact: true }))
    .toHaveTextContent('No trace received yet')

  await vi.advanceTimersByTimeAsync(4999)
  await expect.element(status.getByText('Running', { exact: true })).toBeVisible()
  await vi.advanceTimersByTimeAsync(1)
  await expect.element(status.getByText('Success', { exact: true })).toBeVisible()
  await expect.element(status.getByText('5.0 s', { exact: true })).toBeVisible()
  await expect.element(status.getByText('1,240 tokens', { exact: true })).toBeVisible()
  await expect.element(result).toHaveAttribute('aria-selected', 'true')
  await expect
    .element(
      panel
        .getByRole('tabpanel', { name: 'Result', exact: true })
        .getByText('The 90-day payment period conflicts with your 30-day payment policy.', {
          exact: true,
        }),
    )
    .toBeVisible()
  await expect
    .element(
      panel
        .getByRole('tabpanel', { name: 'Result', exact: true })
        .getByText(
          'Suggested wording: “Payment is due within 30 days of invoice. Late fees apply only after a 10-day grace period agreed in writing.”',
          { exact: true },
        ),
    )
    .toBeVisible()
  await expect.element(task).not.toHaveAttribute('readonly')
  await expect
    .element(page.getByRole('dialog', { name: 'Agent test finished.', exact: true }))
    .not.toBeInTheDocument()
  await tracing.click()
  const trace = panel.getByRole('tabpanel', { name: 'Tracing', exact: true })
  await expect.element(trace.getByText('1 step received', { exact: true })).toBeVisible()
  const step = trace.getByRole('button', { name: /search_contract_policy/ })
  await expect.element(step).toHaveAttribute('aria-expanded', 'false')
  await step.click()
  await expect.element(step).toHaveAttribute('aria-expanded', 'true')
  await expect.element(trace.getByText('Input', { exact: true })).toBeVisible()
  await expect.element(trace.getByText('Output', { exact: true })).toBeVisible()

  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await vi.advanceTimersByTimeAsync(300)
  await expect.element(panel).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('dialog', { name: 'Agent test finished.', exact: true }))
    .not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await task.fill('Review our revised payment terms.')
  await expect.element(status).not.toBeInTheDocument()
  await expect.element(result).not.toBeInTheDocument()
  await expect.element(run).toBeEnabled()
})

it('reveals more skill examples and preserves the task while resizing, then resets on reopening', async () => {
  await setup()
  const example = 'When must we give notice to avoid renewing this contract?'
  await page.getByRole('button', { name: 'Example requests', exact: true }).nth(5).click()
  await expect.element(page.getByText(example, { exact: true })).toBeVisible()

  const trigger = page.getByRole('button', { name: 'Test agent', exact: true })
  await trigger.click()
  const panel = page.getByRole('dialog', { name: 'Test agent', exact: true })
  const task = panel.getByRole('textbox', { name: 'Task', exact: true })
  const renewal = panel.getByRole('button', { name: 'Renewal planning', exact: true })
  await expect.element(renewal).not.toBeInTheDocument()
  await panel.getByRole('button', { name: '+3 more', exact: true }).click()
  await renewal.click()
  await expect.element(task).toHaveValue(example)

  await panel.getByRole('button', { name: 'Show fewer', exact: true }).click()
  await expect.element(renewal).not.toBeInTheDocument()
  await expect.element(task).toHaveValue(example)
  await panel.getByRole('button', { name: 'Expand test panel', exact: true }).click()
  await expect.element(task).toHaveValue(example)
  await panel.getByRole('button', { name: 'Collapse test panel', exact: true }).click()
  await expect.element(task).toHaveValue(example)

  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(panel).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await expect.element(task).toHaveValue('')
  await expect.element(panel.getByRole('button', { name: 'Run test', exact: true })).toBeDisabled()
  await expect.element(panel.getByRole('button', { name: '+3 more', exact: true })).toBeVisible()
})

it('reopens a running test through Testing and opens its completed result from the toast', async () => {
  await setup()
  const trigger = page.getByRole('button', { name: 'Test agent', exact: true })
  await trigger.click()
  const panel = page.getByRole('dialog', { name: 'Test agent', exact: true })
  const task = panel.getByRole('textbox', { name: 'Task', exact: true })
  const draft = 'Review our payment terms.'
  await task.fill(draft)
  const attachment = 'https://files.example/contract.pdf'
  await panel.getByRole('button', { name: 'Paste file link', exact: true }).click()
  const linkDialog = page.getByRole('dialog', { name: 'Paste file link', exact: true })
  await linkDialog.getByRole('textbox', { name: 'File link', exact: true }).fill(attachment)
  await linkDialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect.element(linkDialog).not.toBeInTheDocument()
  mockRunClock()
  await panel.getByRole('button', { name: 'Run test', exact: true }).click()
  await expect
    .element(panel.getByRole('status').getByText('Running', { exact: true }))
    .toBeVisible()
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await vi.advanceTimersByTimeAsync(300)
  await expect.element(panel).not.toBeInTheDocument()
  const testing = page.getByRole('button', { name: 'Testing…', exact: true })
  await expect.element(testing).toBeEnabled()
  await testing.click()
  await expect
    .element(panel.getByRole('status').getByText('Running', { exact: true }))
    .toBeVisible()
  await expect.element(task).toHaveValue(draft)
  await expect.element(task).toHaveAttribute('readonly')

  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await vi.advanceTimersByTimeAsync(5000)
  await expect.element(panel).not.toBeInTheDocument()
  await expect.element(trigger).toBeVisible()
  const notification = page.getByRole('dialog', { name: 'Agent test finished.', exact: true })
  await expect.element(notification).toBeVisible()
  await notification.getByRole('button', { name: 'View result', exact: true }).click()
  await expect.element(notification).not.toBeInTheDocument()
  await expect
    .element(panel.getByRole('status').getByText('Success', { exact: true }))
    .toBeVisible()
  await expect.element(task).toHaveValue(draft)
  await expect.element(task).not.toHaveAttribute('readonly')
  await expect.element(panel.getByText(attachment, { exact: true })).toBeVisible()
  await expect
    .element(panel.getByRole('tab', { name: 'Result', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
})

it('retains a stopped test and its trace across reopening, then allows a fresh run', async () => {
  await setup()
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Test agent', exact: true })
  const task = panel.getByRole('textbox', { name: 'Task', exact: true })
  const draft =
    'Review this payment clause against our 30-day payment policy and suggest a safer alternative that preserves the original intent.'
  await task.fill(draft)
  mockRunClock(false)
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  onTestFinished(() => now.mockRestore())
  await panel.getByRole('button', { name: 'Run test', exact: true }).click()
  await vi.advanceTimersByTimeAsync(2000)
  await panel.getByRole('button', { name: 'Stop test', exact: true }).click()
  // Browser locator actions also tick fake timers; keep elapsed wall time deterministic.
  now.mockReturnValue(5000)
  const stopping = panel.getByRole('button', { name: 'Stopping…', exact: true })
  const status = panel.getByRole('status')
  await expect.element(stopping).toHaveAttribute('aria-disabled', 'true')
  await expect.element(stopping).toHaveFocus()
  await expect.element(status.getByText('Stopping', { exact: true })).toBeVisible()
  await expect
    .element(panel)
    .toHaveAccessibleDescription('You can close this panel. The test will continue.')
  await expect.element(task).toHaveValue(draft)
  await expect.element(task).toHaveAttribute('readonly')
  await expect
    .element(panel.getByRole('tab', { name: 'Tracing', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  const trace = panel.getByRole('tabpanel', { name: 'Tracing', exact: true })
  await expect.element(trace.getByText('1 step received', { exact: true })).toBeVisible()
  await expect.element(trace.getByRole('button', { name: /search_contract_policy/ })).toBeVisible()
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await vi.advanceTimersByTimeAsync(300)
  await expect.element(panel).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Testing…', exact: true }).click()
  await expect.element(stopping).toHaveAttribute('aria-disabled', 'true')
  await expect.element(task).toHaveValue(draft)
  await expect.element(task).toHaveAttribute('readonly')
  await vi.advanceTimersByTimeAsync(1699)
  await expect.element(status.getByText('Stopping', { exact: true })).toBeVisible()
  await vi.advanceTimersByTimeAsync(1)
  await expect.element(task).not.toHaveAttribute('readonly')
  await expect.element(task).toHaveValue(draft)
  const run = panel.getByRole('button', { name: 'Run test', exact: true })
  await expect.element(run).toBeEnabled()
  await expect
    .element(panel.getByRole('button', { name: 'Paste file link', exact: true }))
    .toBeVisible()
  await expect.element(status.getByText('Stopped', { exact: true })).toBeVisible()
  await expect.element(status.getByText('4.0 s', { exact: true })).toBeVisible()
  await expect.element(status.getByText('Not provided', { exact: true })).toBeVisible()
  await expect
    .element(
      panel.getByText('The agent stopped this test. Actions it already took aren’t undone.', {
        exact: true,
      }),
    )
    .toBeVisible()
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await vi.advanceTimersByTimeAsync(5000)
  await expect.element(panel).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('dialog', { name: 'Agent test finished.', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByRole('dialog', { name: 'Agent test failed.', exact: true }))
    .not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  await expect.element(task).toHaveValue(draft)
  await expect.element(task).not.toHaveAttribute('readonly')
  await expect.element(status.getByText('Stopped', { exact: true })).toBeVisible()
  await expect.element(status.getByText('4.0 s', { exact: true })).toBeVisible()
  await expect
    .element(panel.getByRole('tab', { name: 'Tracing', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect.element(trace.getByText('1 step received', { exact: true })).toBeVisible()
  await expect.element(trace.getByRole('button', { name: /search_contract_policy/ })).toBeVisible()

  await run.click()
  await expect.element(status.getByText('Running', { exact: true })).toBeVisible()
  await expect.element(task).toHaveAttribute('readonly')
  await expect.element(trace).toHaveTextContent('No trace received yet')
  await vi.advanceTimersByTimeAsync(5000)
  await expect.element(status.getByText('Success', { exact: true })).toBeVisible()
  await expect.element(status.getByText('5.0 s', { exact: true })).toBeVisible()
})

it('notifies a failed background test and reopens its failure result', async () => {
  await page.viewport(1512, 982)
  const i18n = await createI18n()
  const preview = createExternalAgentOverviewPreview(createExternalRosterPreview()[1]!)
  await render(
    <I18nextProvider i18n={i18n}>
      <ExternalAgentTestPanel {...preview} sampleOutcome="failed" />
      <AppToaster timeout={0} />
    </I18nextProvider>,
  )
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Test agent', exact: true })
  const task = panel.getByRole('textbox', { name: 'Task', exact: true })
  const draft = 'Review our payment terms.'
  await task.fill(draft)
  mockRunClock()
  await panel.getByRole('button', { name: 'Run test', exact: true }).click()
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await vi.advanceTimersByTimeAsync(5000)
  await expect.element(panel).not.toBeInTheDocument()
  const notification = page.getByRole('dialog', { name: 'Agent test failed.', exact: true })
  await expect.element(notification).toBeVisible()
  await expect
    .element(page.getByRole('dialog', { name: 'Agent test finished.', exact: true }))
    .not.toBeInTheDocument()
  await notification.getByRole('button', { name: 'View result', exact: true }).click()
  await expect.element(notification).not.toBeInTheDocument()
  await expect.element(panel.getByRole('status').getByText('Failed', { exact: true })).toBeVisible()
  await expect
    .element(panel.getByRole('tab', { name: 'Result', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect.element(task).toHaveValue(draft)
  await expect.element(task).not.toHaveAttribute('readonly')
})

it('waits on Result and completes without trace steps when Tracing is turned off', async () => {
  await setup()
  await page.getByRole('switch', { name: 'Tracing', exact: true }).click()
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Test agent', exact: true })
  await panel.getByRole('textbox', { name: 'Task', exact: true }).fill('Review our payment terms.')
  mockRunClock()
  await panel.getByRole('button', { name: 'Run test', exact: true }).click()
  await expect
    .element(panel.getByRole('tab', { name: 'Result', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(panel.getByRole('tabpanel', { name: 'Result', exact: true }))
    .toHaveTextContent('Waiting for the agent response')
  await vi.advanceTimersByTimeAsync(5000)
  await expect
    .element(panel.getByRole('status').getByText('Success', { exact: true }))
    .toBeVisible()
  await panel.getByRole('tab', { name: 'Tracing', exact: true }).click()
  const trace = panel.getByRole('tabpanel', { name: 'Tracing', exact: true })
  await expect.element(trace).toHaveTextContent('Tracing is turned off')
  await expect
    .element(trace.getByRole('button', { name: /search_contract_policy/ }))
    .not.toBeInTheDocument()
})

it('runs a task with the displayed modifier shortcut without submitting composition keystrokes', async () => {
  await setup()
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Test agent', exact: true })
  const task = panel.getByRole('textbox', { name: 'Task', exact: true })
  const status = panel.getByRole('status')
  await task.fill('Review our payment terms.')
  await userEvent.keyboard('{Enter}')
  await expect.element(status).not.toBeInTheDocument()

  const mac = detectPlatform() === 'mac'
  task.element().dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      metaKey: mac,
      ctrlKey: !mac,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    }),
  )
  await expect.element(status).not.toBeInTheDocument()
  mockRunClock()
  await userEvent.keyboard(mac ? '{Meta>}{Enter}{/Meta}' : '{Control>}{Enter}{/Control}')
  await expect.element(status.getByText('Running', { exact: true })).toBeVisible()
})

it('validates file links independently of the task and removes attachments without running it', async () => {
  await setup()
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Test agent', exact: true })
  const task = panel.getByRole('textbox', { name: 'Task', exact: true })
  const run = panel.getByRole('button', { name: 'Run test', exact: true })
  const taskError = page.getByText('Enter a task.', { exact: true })
  const status = panel.getByRole('status')
  await panel.getByRole('button', { name: 'Paste file link', exact: true }).click()
  const linkDialog = page.getByRole('dialog', { name: 'Paste file link', exact: true })
  const link = linkDialog.getByRole('textbox', { name: 'File link', exact: true })
  await link.fill('ftp://files.example/contract.pdf')
  await linkDialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect
    .element(linkDialog.getByText('Enter a valid HTTP or HTTPS file link.', { exact: true }))
    .toBeVisible()
  await expect.element(taskError).not.toBeInTheDocument()
  await expect.element(run).toBeDisabled()

  const url = 'https://files.example/contract.pdf'
  await link.fill(url)
  await linkDialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect.element(linkDialog).not.toBeInTheDocument()
  await expect.element(panel.getByText(url, { exact: true })).toBeVisible()
  await expect.element(taskError).not.toBeInTheDocument()
  await expect.element(run).toBeDisabled()
  await panel.getByRole('button', { name: `Remove ${url}`, exact: true }).click()
  await expect.element(panel.getByText(url, { exact: true })).not.toBeInTheDocument()

  await task.fill('Review this contract.')
  await panel.getByRole('button', { name: 'Paste file link', exact: true }).click()
  await link.fill('https://files.example/revised-contract.pdf')
  await linkDialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect.element(linkDialog).not.toBeInTheDocument()
  await expect.element(run).toBeEnabled()
  await expect.element(status).not.toBeInTheDocument()
})

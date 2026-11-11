import { detectPlatform } from '@tanstack/react-hotkeys'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRef } from 'react'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ExternalAgentActions } from '@/features/agent-v2/roster/components/external-agent-actions'
import { createExternalRosterPreview } from '@/features/agent-v2/roster/external-roster-preview'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ExternalAgentOverviewPage } from '../page'

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('react-i18next', async (importOriginal) => importOriginal())
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
          </div>
        </I18nextProvider>
      </NuqsTestingAdapter>
    </QueryProvider>,
  )
  await expect
    .element(page.getByRole('heading', { name: 'Contract Review Agent', exact: true }))
    .toBeVisible()
}

async function manage(action: string) {
  await page.getByRole('button', { name: 'Manage agent', exact: true }).click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

function mockRunClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
}

beforeEach(({ onTestFinished }) => {
  router.push.mockReset()
  onTestFinished(guardUnexpectedFetch())
})

it('reveals skill examples and connection details while retaining the tracing choice', async () => {
  await setup()
  const reviewDescription = page.getByText(
    'Reads a contract clause by clause and flags terms that conflict with your policies.',
    { exact: true },
  )
  const example = page.getByText('Review this payment clause and suggest a safer alternative.', {
    exact: true,
  })
  const examples = page.getByRole('button', { name: 'Example requests', exact: true }).first()
  await expect.element(example).not.toBeInTheDocument()
  await examples.click()
  await expect.element(example).toBeVisible()
  await examples.click()
  await expect.element(example).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Contract review', exact: true }).click()
  await expect.element(reviewDescription).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Contract review', exact: true }).click()
  await expect.element(reviewDescription).toBeVisible()

  const tracing = page.getByRole('switch', { name: 'Tracing', exact: true })
  await expect.element(tracing).toBeChecked()
  await tracing.click()
  await expect.element(tracing).not.toBeChecked()
  const endpoint = page.getByText('https://agents.acme.example/contract-review', { exact: true })
  await page.getByRole('button', { name: 'Connection', exact: true }).click()
  await expect.element(endpoint).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Connection', exact: true }).click()
  await expect.element(endpoint).toBeVisible()
  const provider = page.getByText('Acme', { exact: true })
  await page.getByRole('button', { name: 'Service details', exact: true }).click()
  await expect.element(provider).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Service details', exact: true }).click()
  await expect.element(provider).toBeVisible()
  await expect.element(tracing).not.toBeChecked()
})

it('keeps the header and connection rail visible while skill headings hand over during scrolling', async () => {
  await setup()
  const title = page.getByRole('heading', { name: 'Contract Review Agent', exact: true }).element()
  const testAgent = page.getByRole('button', { name: 'Test agent', exact: true }).element()
  const firstSkill = page.getByRole('heading', { name: 'Contract review', exact: true }).element()
  const nextSkill = page.getByRole('heading', { name: 'Clause rewrite', exact: true }).element()
  const connection = page.getByRole('heading', { name: 'Connection', exact: true }).element()
  const viewport = firstSkill.closest<HTMLElement>('[data-external-agent-overview-scroll]')
  if (!viewport) throw new Error('The overview must provide its own content scroll area')

  await expect.poll(() => viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)
  const viewportTop = viewport.getBoundingClientRect().top
  const initialTitleTop = title.getBoundingClientRect().top
  const initialActionTop = testAgent.getBoundingClientRect().top
  const initialSkillTop = firstSkill.getBoundingClientRect().top

  viewport.scrollTo({ top: initialSkillTop - viewportTop + 32 })
  await expect
    .poll(() => Math.abs(firstSkill.getBoundingClientRect().top - viewportTop))
    .toBeLessThan(1)
  expect(title.getBoundingClientRect().top).toBe(initialTitleTop)
  expect(testAgent.getBoundingClientRect().top).toBe(initialActionTop)
  const pinnedConnectionTop = connection.getBoundingClientRect().top
  expect(pinnedConnectionTop).toBeGreaterThan(viewportTop)
  expect(pinnedConnectionTop).toBeLessThan(viewportTop + viewport.clientHeight)

  const nextSkillOffset = nextSkill.getBoundingClientRect().top - viewportTop + viewport.scrollTop
  viewport.scrollTo({ top: nextSkillOffset - firstSkill.getBoundingClientRect().height / 2 })
  await expect.poll(() => firstSkill.getBoundingClientRect().top).toBeLessThan(viewportTop)
  expect(firstSkill.getBoundingClientRect().bottom).toBeGreaterThan(viewportTop)
  expect(firstSkill.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    nextSkill.getBoundingClientRect().top,
  )

  viewport.scrollTo({ top: nextSkillOffset + 32 })
  await expect
    .poll(() => Math.abs(nextSkill.getBoundingClientRect().top - viewportTop))
    .toBeLessThan(1)
  expect(firstSkill.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewportTop)
  expect(title.getBoundingClientRect().top).toBe(initialTitleTop)
  expect(testAgent.getBoundingClientRect().top).toBe(initialActionTop)
  expect(connection.getBoundingClientRect().top).toBe(pinnedConnectionTop)

  viewport.scrollTo({ top: 0 })
  await expect
    .poll(() => Math.abs(firstSkill.getBoundingClientRect().top - initialSkillTop))
    .toBeLessThan(1)
})

it('runs a skill example for five seconds, exposes its result and trace, and clears them when edited', async () => {
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
  await tracing.click()
  const trace = panel.getByRole('tabpanel', { name: 'Tracing', exact: true })
  await expect.element(trace.getByText('1 step received', { exact: true })).toBeVisible()
  const step = trace.getByRole('button', { name: /search_contract_policy/ })
  await expect.element(step).toHaveAttribute('aria-expanded', 'false')
  await step.click()
  await expect.element(step).toHaveAttribute('aria-expanded', 'true')
  await expect.element(trace.getByText('Input', { exact: true })).toBeVisible()
  await expect.element(trace.getByText('Output', { exact: true })).toBeVisible()

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

it('continues a test while the panel is closed and restores its active run and completed result', async () => {
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
  await trigger.click()
  await expect
    .element(panel.getByRole('status').getByText('Running', { exact: true }))
    .toBeVisible()
  await expect.element(task).toHaveValue(draft)
  await expect.element(task).toHaveAttribute('readonly')

  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await vi.advanceTimersByTimeAsync(5000)
  await expect.element(panel).not.toBeInTheDocument()
  await trigger.click()
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

it('stops a local test while retaining the draft and prevents its pending completion', async () => {
  await setup()
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Test agent', exact: true })
  const task = panel.getByRole('textbox', { name: 'Task', exact: true })
  const draft = 'Review our payment terms.'
  await task.fill(draft)
  mockRunClock()
  await panel.getByRole('button', { name: 'Run test', exact: true }).click()
  await vi.advanceTimersByTimeAsync(2000)
  await panel.getByRole('button', { name: 'Stop test', exact: true }).click()
  await expect.element(task).toHaveValue(draft)
  await expect.element(task).not.toHaveAttribute('readonly')
  await expect.element(panel.getByRole('button', { name: 'Run test', exact: true })).toBeEnabled()
  await expect.element(panel.getByRole('status')).not.toBeInTheDocument()
  await vi.advanceTimersByTimeAsync(5000)
  await expect.element(panel.getByRole('status')).not.toBeInTheDocument()
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

it('offers only enablement and deletion and changes enablement only after confirmation', async () => {
  await setup()
  const trigger = page.getByRole('button', { name: 'Manage agent', exact: true })
  const create = page.getByRole('button', { name: 'Create app', exact: true })
  const disabled = page.getByText('Disabled', { exact: true })
  await trigger.click()
  await expect
    .element(page.getByRole('menuitem', { name: 'Disable agent', exact: true }))
    .toBeVisible()
  await expect
    .element(page.getByRole('menuitem', { name: 'Delete agent', exact: true }))
    .toBeVisible()
  expect(page.getByRole('menuitem').all()).toHaveLength(2)
  await page.getByRole('menuitem', { name: 'Disable agent', exact: true }).click()

  const disable = page.getByRole('alertdialog', { name: 'Disable agent?', exact: true })
  await expect
    .element(disable)
    .toHaveAccessibleDescription(
      'Block new app calls and node tests. Submitted tasks continue. Testing in Overview remains available.',
    )
  await disable.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(disable).not.toBeInTheDocument()
  await expect.element(disabled).not.toBeInTheDocument()
  await expect.element(create).toBeEnabled()
  await expect.element(trigger).toHaveFocus()

  await manage('Disable agent')
  await disable.getByRole('button', { name: 'Disable agent', exact: true }).click()
  await expect.element(disable).not.toBeInTheDocument()
  await expect.element(disabled).toBeVisible()
  await expect.element(create).toBeDisabled()

  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  const testDialog = page.getByRole('dialog', { name: 'Test agent', exact: true })
  await testDialog
    .getByRole('textbox', { name: 'Task', exact: true })
    .fill('Review our payment terms.')
  mockRunClock()
  await testDialog.getByRole('button', { name: 'Run test', exact: true }).click()
  await expect
    .element(testDialog.getByRole('status').getByText('Running', { exact: true }))
    .toBeVisible()
  await vi.advanceTimersByTimeAsync(5000)
  await expect
    .element(testDialog.getByRole('status').getByText('Success', { exact: true }))
    .toBeVisible()
  vi.useRealTimers()
  await testDialog.getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect.element(testDialog).not.toBeInTheDocument()

  await manage('Enable agent')
  const enable = page.getByRole('alertdialog', { name: 'Enable agent?', exact: true })
  await expect.element(enable).toHaveAccessibleDescription('Allow new app calls and node tests.')
  await enable.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(enable).not.toBeInTheDocument()
  await expect.element(disabled).toBeVisible()
  await expect.element(create).toBeDisabled()

  await manage('Enable agent')
  await enable.getByRole('button', { name: 'Enable agent', exact: true }).click()
  await expect.element(enable).not.toBeInTheDocument()
  await expect.element(disabled).not.toBeInTheDocument()
  await expect.element(create).toBeEnabled()
})

it('explains deletion and requires confirmation when choosing disable instead', async () => {
  await setup()
  await manage('Delete agent')
  const deletion = page.getByRole('alertdialog', { name: 'Delete agent?', exact: true })
  await expect.element(deletion.getByText('Contract Review Agent', { exact: true })).toBeVisible()
  await expect.element(deletion.getByText('3 apps', { exact: true })).toBeVisible()
  await expect
    .element(deletion)
    .toHaveAccessibleDescription(
      '3 apps use this agent. Deleting it will disconnect their agent nodes. There may be tasks still in progress. Node configurations will be kept. The external agent and its data will not be deleted. Historical runs remain available according to retention settings.',
    )
  await deletion.getByRole('button', { name: 'Disable agent', exact: true }).click()
  const disable = page.getByRole('alertdialog', { name: 'Disable agent?', exact: true })
  await expect.element(deletion).not.toBeInTheDocument()
  await expect.element(disable).toBeVisible()
  expect(router.push).not.toHaveBeenCalled()
  await disable.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(disable).not.toBeInTheDocument()
  await expect.element(page.getByText('Disabled', { exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Create app', exact: true })).toBeEnabled()
  await expect
    .element(page.getByRole('button', { name: 'Manage agent', exact: true }))
    .toHaveFocus()

  await manage('Delete agent')
  await deletion.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(deletion).not.toBeInTheDocument()
  expect(router.push).not.toHaveBeenCalled()
  await manage('Delete agent')
  await deletion.getByRole('button', { name: 'Delete agent', exact: true }).click()
  await expect.poll(() => router.push.mock.calls).toEqual([['/agents?agent_type=external']])
})

it('links each app type to the existing app creation flow with the matching default selection', async () => {
  await setup()
  await page.getByRole('button', { name: 'Create app', exact: true }).click()
  await expect
    .element(page.getByRole('menuitem', { name: 'Workflow', exact: true }))
    .toHaveAttribute('href', '/apps?create=blank&mode=workflow')
  await expect
    .element(page.getByRole('menuitem', { name: 'Chatflow', exact: true }))
    .toHaveAttribute('href', '/apps?create=blank&mode=advanced-chat')
})

it.each([
  { count: 0, usage: '0 apps use this agent.', nodes: 'their agent nodes' },
  { count: 1, usage: '1 app uses this agent.', nodes: 'its agent nodes' },
])(
  'uses the actual app count and correct grammar for $count connected apps',
  async ({ count, usage, nodes }) => {
    const i18n = await createI18n()
    const agent = createExternalRosterPreview()[1]!
    await render(
      <I18nextProvider i18n={i18n}>
        <ExternalAgentActions
          request={{
            kind: 'delete',
            agent: { ...agent, apps: agent.apps.slice(0, count) },
            trigger: null,
            adjacentFocusTargets: [],
          }}
          open
          onOpenChange={vi.fn()}
          fallbackFocus={createRef()}
          onEdit={vi.fn()}
          onToggle={vi.fn()}
          onDelete={vi.fn()}
          onRequest={vi.fn()}
        />
      </I18nextProvider>,
    )
    const deletion = page.getByRole('alertdialog', { name: 'Delete agent?', exact: true })
    await expect
      .element(deletion)
      .toHaveAccessibleDescription(
        `${usage} Deleting it will disconnect ${nodes}. There may be tasks still in progress. Node configurations will be kept. The external agent and its data will not be deleted. Historical runs remain available according to retention settings.`,
      )
  },
)

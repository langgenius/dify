import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
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

async function setup() {
  await page.viewport(1512, 982)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, app, common } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
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

it('updates the overview identity after saving the management edit', async () => {
  await setup()
  await manage('Edit info')
  const dialog = page.getByRole('dialog', { name: 'Edit info', exact: true })
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Contract Analyzer')
  await dialog.getByRole('textbox', { name: /Role/ }).fill('Legal operations')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('heading', { name: 'Contract Analyzer', exact: true }))
    .toBeVisible()
  await expect.element(page.getByText('Legal operations', { exact: true })).toBeVisible()
  await expect
    .element(page.getByRole('heading', { name: 'Contract Review Agent', exact: true }))
    .not.toBeInTheDocument()
})

it('updates the disabled status and navigates away only after deletion is confirmed', async () => {
  await setup()
  await manage('Disable agent')
  const disable = page.getByRole('alertdialog', { name: 'Disable agent?', exact: true })
  await disable.getByRole('button', { name: 'Disable agent', exact: true }).click()
  await expect.element(disable).not.toBeInTheDocument()
  await expect.element(page.getByText('Disabled', { exact: true })).toBeVisible()
  await manage('Delete agent')
  const canceled = page.getByRole('alertdialog', { name: 'Delete agent?', exact: true })
  await canceled.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(canceled).not.toBeInTheDocument()
  expect(router.push).not.toHaveBeenCalled()
  await manage('Delete agent')
  const confirmed = page.getByRole('alertdialog', { name: 'Delete agent?', exact: true })
  await confirmed.getByRole('button', { name: 'Delete agent', exact: true }).click()
  await expect.poll(() => router.push.mock.calls).toEqual([['/agents?agent_type=external']])
})

it('shows a local test response and adds a newly created app to the overview', async () => {
  await setup()
  await page.getByRole('button', { name: 'Test agent', exact: true }).click()
  const testDialog = page.getByRole('dialog', { name: 'Test agent', exact: true })
  await testDialog
    .getByRole('textbox', { name: 'Request', exact: true })
    .fill('Review our payment terms.')
  await testDialog.getByRole('button', { name: 'Send request', exact: true }).click()
  await expect
    .element(testDialog.getByRole('heading', { name: 'Sample response', exact: true }))
    .toBeVisible()
  await expect
    .element(
      testDialog
        .getByRole('status')
        .getByText(
          'The clause allows payment beyond your company’s 30-day policy. Consider revising the payment term to 30 days from receipt of a valid invoice.',
          { exact: true },
        ),
    )
    .toBeVisible()
  await testDialog.getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect.element(testDialog).not.toBeInTheDocument()

  await page.getByRole('button', { name: 'Create app', exact: true }).click()
  await page.getByRole('menuitem', { name: /Workflow/ }).click()
  const createDialog = page.getByRole('dialog', { name: 'Create app', exact: true })
  await createDialog
    .getByRole('textbox', { name: 'App name', exact: true })
    .fill('Legal review workflow')
  await createDialog.getByRole('button', { name: 'Create app', exact: true }).click()
  await expect.element(createDialog).not.toBeInTheDocument()
  await expect.element(page.getByRole('link', { name: /Legal review workflow/ })).toBeVisible()
})

import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import agentV2 from '@/i18n/locales/en-US/agent-v-2.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import time from '@/i18n/locales/en-US/time.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ExternalAgentMonitoringPage } from '../page'

// boundary: restore real translations so this fixture's I18nextProvider supplies rendered labels.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
// boundary: Browser Mode has no application router; this page only reads its current route.
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  usePathname: () => '/external-agent/contract-review/monitoring',
}))

async function setup() {
  await page.viewport(1512, 982)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, agentV2, app, common, time } },
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
            <ExternalAgentMonitoringPage agentId="contract-review" />
          </div>
        </I18nextProvider>
      </NuqsTestingAdapter>
    </QueryProvider>,
  )
}

function metric(name: RegExp) {
  return page.getByRole('article', { name })
}

beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-11T04:00:00Z'))
  onTestFinished(() => {
    vi.useRealTimers()
  })
})

it('shows today by default and updates metrics when choosing another time range', async () => {
  await setup()
  const timeRange = page.getByRole('combobox', { name: 'Time range', exact: true })
  const apps = page.getByRole('combobox', { name: 'Apps', exact: true })
  const calls = metric(/^Calls$/i)
  const tokens = metric(/^Reported tokens$/i)
  const duration = metric(/^Average call duration$/i)
  const coverage = metric(/^Token reporting coverage$/i)
  await expect.element(timeRange).toHaveTextContent('Today')
  await expect.element(apps).toMatchTextContent('All apps')
  await expect.element(calls.getByText('6', { exact: true }).first()).toBeVisible()
  await expect.element(tokens.getByText('3,600', { exact: true }).first()).toBeVisible()
  await expect.element(duration.getByText('10.3 s', { exact: true }).first()).toBeVisible()
  await expect.element(coverage.getByText('83%', { exact: true }).first()).toBeVisible()
  await expect.element(coverage.getByText('5 of 6 calls', { exact: true })).toBeVisible()
  await timeRange.click()
  await page.getByRole('option', { name: 'Last 7 days', exact: true }).click()
  await expect.element(timeRange).toHaveTextContent('Last 7 days')
  await expect.element(calls.getByText('25', { exact: true })).toBeVisible()
  await expect.element(tokens.getByText('14,000', { exact: true })).toBeVisible()
  await expect.element(duration.getByText('10.0 s', { exact: true })).toBeVisible()
  await expect.element(coverage.getByText('84%', { exact: true })).toBeVisible()
  await expect.element(coverage.getByText('21 of 25 calls', { exact: true })).toBeVisible()

  await timeRange.click()
  await page.getByRole('option', { name: 'Today', exact: true }).click()
  await expect.element(timeRange).toHaveTextContent('Today')
  await expect.element(calls.getByText('6', { exact: true }).first()).toBeVisible()
  await expect.element(tokens.getByText('3,600', { exact: true }).first()).toBeVisible()
})

it('filters by one app, shows an empty period, and restores all-app metrics', async () => {
  await setup()
  await page.getByRole('combobox', { name: 'Time range', exact: true }).click()
  await page.getByRole('option', { name: 'Last 7 days', exact: true }).click()
  const apps = page.getByRole('combobox', { name: 'Apps', exact: true })
  const calls = metric(/^Calls$/i)
  const tokens = metric(/^Reported tokens$/i)
  const duration = metric(/^Average call duration$/i)
  const coverage = metric(/^Token reporting coverage$/i)
  await apps.click()
  await expect
    .element(page.getByRole('option', { name: 'Contract Review Assistant', exact: true }))
    .toBeVisible()
  await page.getByRole('option', { name: 'Procurement Contract Review', exact: true }).click()
  await expect.element(apps).toMatchTextContent('Procurement Contract Review')
  await expect.element(calls.getByText('13', { exact: true })).toBeVisible()
  await expect.element(tokens.getByText('6,500', { exact: true })).toBeVisible()

  await apps.click()
  await page.getByRole('option', { name: 'Contract Renewal Review', exact: true }).click()
  await expect.element(apps).toMatchTextContent('Contract Renewal Review')
  await expect.element(calls.getByText('0', { exact: true })).toBeVisible()
  for (const card of [tokens, duration, coverage]) {
    await expect.element(card.getByText('—', { exact: true })).toBeVisible()
  }
  for (const card of [calls, tokens, duration, coverage]) {
    await expect.element(card.getByText('No calls in this period.', { exact: true })).toBeVisible()
  }
  await expect
    .element(coverage.getByText('21 of 25 calls', { exact: true }))
    .not.toBeInTheDocument()

  await apps.click()
  await page.getByRole('option', { name: 'All apps', exact: true }).click()
  await expect.element(apps).toMatchTextContent('All apps')
  await expect.element(calls.getByText('25', { exact: true })).toBeVisible()
  await expect.element(tokens.getByText('14,000', { exact: true })).toBeVisible()
  await expect
    .element(page.getByText('No calls in this period.', { exact: true }))
    .not.toBeInTheDocument()
})

it('uses custom dates to select an empty period and restores the preset dates and metrics', async () => {
  await setup()
  const timeRange = page.getByRole('combobox', { name: 'Time range', exact: true })
  const startDate = page.getByRole('button', { name: /^Start date/ })
  const endDate = page.getByRole('button', { name: /^End date/ })
  await startDate.click()
  const startCalendar = page.getByRole('dialog', { name: 'Start date', exact: true })
  await startCalendar.getByRole('button', { name: /^1: .*November 1st, 2026/ }).click()
  await expect.element(startCalendar).not.toBeInTheDocument()
  await endDate.click()
  const endCalendar = page.getByRole('dialog', { name: 'End date', exact: true })
  await endCalendar.getByRole('button', { name: /^4: .*November 4th, 2026/ }).click()
  await expect.element(endCalendar).not.toBeInTheDocument()
  await expect.element(timeRange).toHaveTextContent('Custom')
  await expect.element(startDate).toHaveAccessibleName('Start date Nov 1')
  await expect.element(endDate).toHaveAccessibleName('End date Nov 4')
  await expect.element(metric(/^Calls$/i).getByText('0', { exact: true })).toBeVisible()
  await expect
    .element(metric(/^Calls$/i).getByText('No calls in this period.', { exact: true }))
    .toBeVisible()

  await timeRange.click()
  await page.getByRole('option', { name: 'Last 7 days', exact: true }).click()
  await expect.element(startDate).toHaveAccessibleName('Start date Nov 4')
  await expect.element(endDate).toHaveAccessibleName('End date Nov 11')
  await expect.element(metric(/^Calls$/i).getByText('25', { exact: true })).toBeVisible()
})

it('keeps local tracing settings and provider edits when closing and reopening the configuration', async () => {
  await setup()
  await page.getByRole('button', { name: /Tracing app performance.*LangSmith.*In Service/ }).click()
  const tracing = page.getByRole('dialog', { name: 'Tracing', exact: true })
  const enabled = tracing.getByRole('switch', { name: 'Tracing', exact: true })
  await expect.element(enabled).toBeChecked()
  await enabled.click()
  await expect.element(enabled).not.toBeChecked()
  await userEvent.keyboard('{Escape}')
  await expect.element(tracing).not.toBeInTheDocument()
  await page.getByRole('button', { name: /Tracing app performance.*LangSmith.*Disabled/ }).click()
  await expect.element(enabled).not.toBeChecked()
  await enabled.click()
  const provider = tracing.getByRole('group', { name: 'LangSmith', exact: true })
  await provider.getByRole('button', { name: 'Config', exact: true }).click()
  const config = page.getByRole('dialog', { name: 'Config LangSmith', exact: true })
  await config
    .getByRole('textbox', { name: 'Project', exact: true })
    .fill('Agent monitoring preview')
  await config.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(config).not.toBeInTheDocument()

  await page.getByRole('button', { name: /Tracing app performance.*LangSmith.*In Service/ }).click()
  await expect.element(enabled).toBeChecked()
  await provider.getByRole('button', { name: 'Config', exact: true }).click()
  await expect
    .element(config.getByRole('textbox', { name: 'Project', exact: true }))
    .toHaveValue('Agent monitoring preview')
  await config.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(config).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: /Tracing app performance.*LangSmith.*In Service/ }))
    .toBeVisible()
})

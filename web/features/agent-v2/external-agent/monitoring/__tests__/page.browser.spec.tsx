import type { ExternalMonitoringResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { ORPCError } from '@orpc/client'
import { page } from 'vite-plus/test/browser'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
  agentId,
  appId,
  metrics,
  providerOverview,
  renderMonitoring,
  response,
} from './monitoring-fixture'

const api = vi.hoisted(() => ({
  monitoring:
    vi.fn<
      typeof import('@/service/console').consoleClient.externalAgents.byAgentId.monitoring.get
    >(),
  getOverview:
    vi.fn<
      typeof import('@/service/console').consoleClient.externalAgents.byAgentId.tracingConfig.get
    >(),
  getConfig:
    vi.fn<
      typeof import('@/service/console').consoleClient.externalAgents.byAgentId.tracingConfig.byProvider.get
    >(),
  replace: vi.fn(),
}))

// boundary: the actual i18n provider supplies labels for all real form and overlay controls.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
// boundary: Browser Mode has no application router; redirects are observed at the router boundary.
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  usePathname: () => '/external-agent/22222222-2222-4222-8222-222222222222/monitoring',
  useRouter: () => ({ replace: api.replace }),
}))
// boundary: generated server responses replace HTTP; date conversion, permissions, forms and cache policies stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'externalAgents.byAgentId.monitoring.get': api.monitoring,
      'externalAgents.byAgentId.tracingConfig.get': api.getOverview,
      'externalAgents.byAgentId.tracingConfig.byProvider.get': api.getConfig,
    }),
  }
})

async function setup({
  waitForHeading = true,
  ...options
}: {
  role?: 'owner' | 'normal'
  timezone?: string
  waitForHeading?: boolean
} = {}) {
  const queryClient = await renderMonitoring(options)
  onTestFinished(() => queryClient.clear())
  if (waitForHeading)
    await expect
      .element(page.getByRole('heading', { name: 'Monitoring', exact: true }))
      .toBeVisible()
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
  api.monitoring.mockReset().mockResolvedValue(response())
  api.getOverview.mockReset().mockResolvedValue(providerOverview())
  api.getConfig.mockReset().mockResolvedValue({ configuration: null })
  api.replace.mockReset()
})

it.each([404, 410])('returns to the external roster when monitoring answers %i', async (status) => {
  api.monitoring.mockRejectedValue(new ORPCError('NOT_FOUND', { status }))
  await setup({ waitForHeading: false })
  await expect.poll(() => api.replace.mock.calls).toEqual([['/agents?agent_type=external']])
  await expect
    .element(page.getByRole('heading', { name: 'Monitoring', exact: true }))
    .not.toBeInTheDocument()
})

it('keeps Today consistent with the browser calendar while requesting account-timezone App metrics across DST', async () => {
  api.monitoring.mockImplementation(async ({ query }) =>
    response(query.app_id ? metrics({ calls: 9, reported_tokens: 1800 }) : metrics()),
  )
  const calendarDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(today.getDate() + 1)
  // Both possible browser-calendar dates at this fixed clock are after LA's DST transition.
  const todayWindow = {
    start: `${calendarDate(today)}T08:00:00.000Z`,
    end: `${calendarDate(tomorrow)}T08:00:00.000Z`,
    timezone: 'America/Los_Angeles',
  }
  await setup()
  await expect
    .poll(() => api.monitoring.mock.calls.at(-1)?.[0])
    .toEqual({
      params: { agent_id: agentId },
      query: todayWindow,
    })
  await expect
    .element(
      metric(/^Calls$/i)
        .getByText('41', { exact: true })
        .first(),
    )
    .toBeVisible()
  await expect
    .element(
      metric(/^Reported tokens$/i)
        .getByText('8,200', { exact: true })
        .first(),
    )
    .toBeVisible()
  await page.getByRole('button', { name: /^Start date/ }).click()
  await page
    .getByRole('dialog', { name: 'Start date', exact: true })
    .getByRole('button', { name: /^1: .*November 1st, 2026/ })
    .click()
  await page.getByRole('button', { name: /^End date/ }).click()
  await page
    .getByRole('dialog', { name: 'End date', exact: true })
    .getByRole('button', { name: /^4: .*November 4th, 2026/ })
    .click()
  await page.getByRole('combobox', { name: 'Apps', exact: true }).click()
  await page.getByRole('option', { name: 'Procurement Contract Review', exact: true }).click()
  await expect
    .poll(() => api.monitoring.mock.calls.at(-1)?.[0])
    .toEqual({
      params: { agent_id: agentId },
      query: {
        start: '2026-11-01T07:00:00.000Z',
        end: '2026-11-05T08:00:00.000Z',
        timezone: 'America/Los_Angeles',
        app_id: appId,
      },
    })
  await expect
    .element(
      metric(/^Calls$/i)
        .getByText('9', { exact: true })
        .first(),
    )
    .toBeVisible()
  await expect
    .element(
      metric(/^Reported tokens$/i)
        .getByText('1,800', { exact: true })
        .first(),
    )
    .toBeVisible()
  await page.getByRole('combobox', { name: 'Time range', exact: true }).click()
  await page.getByRole('option', { name: 'Today', exact: true }).click()
  await expect
    .poll(() => api.monitoring.mock.calls.at(-1)?.[0])
    .toEqual({
      params: { agent_id: agentId },
      query: { ...todayWindow, app_id: appId },
    })
})

it('shows Normal aggregate data without App or provider access and distinguishes unknown, zero and an empty period', async () => {
  api.monitoring
    .mockResolvedValueOnce(
      response(
        metrics({
          calls: 2,
          reported_tokens: 0,
          average_call_duration: null,
          token_reporting_coverage: 0,
          token_reporting_numerator: 0,
          token_reporting_denominator: 2,
        }),
        false,
      ),
    )
    .mockResolvedValue(
      response(
        metrics({
          calls: 0,
          reported_tokens: null,
          average_call_duration: null,
          token_reporting_coverage: null,
          token_reporting_numerator: 0,
          token_reporting_denominator: 0,
        }),
        false,
      ),
    )
  await setup({ role: 'normal', timezone: 'UTC' })
  await expect
    .element(
      metric(/^Reported tokens$/i)
        .getByText('0', { exact: true })
        .first(),
    )
    .toBeVisible()
  await expect
    .element(
      metric(/^Average call duration$/i)
        .getByText('—', { exact: true })
        .first(),
    )
    .toBeVisible()
  await expect
    .element(
      metric(/^Token reporting coverage$/i)
        .getByText('0%', { exact: true })
        .first(),
    )
    .toBeVisible()
  await expect
    .element(page.getByRole('combobox', { name: 'Apps', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: /Tracing app performance/ }))
    .not.toBeInTheDocument()
  expect(api.getConfig).not.toHaveBeenCalled()
  expect(api.getOverview).not.toHaveBeenCalled()
  await page.getByRole('combobox', { name: 'Time range', exact: true }).click()
  await page.getByRole('option', { name: 'Last 7 days', exact: true }).click()
  await expect.element(metric(/^Calls$/i).getByText('0', { exact: true })).toBeVisible()
  for (const card of [
    metric(/^Reported tokens$/i),
    metric(/^Average call duration$/i),
    metric(/^Token reporting coverage$/i),
  ]) {
    await expect.element(card.getByText('—', { exact: true })).toBeVisible()
  }
  for (const title of [
    /^Calls$/i,
    /^Reported tokens$/i,
    /^Average call duration$/i,
    /^Token reporting coverage$/i,
  ]) {
    await expect
      .element(metric(title).getByText('No calls in this period.', { exact: true }))
      .toBeVisible()
  }
  expect(api.monitoring.mock.calls.at(-1)?.[0].query).not.toHaveProperty('app_id')
  expect(api.getConfig).not.toHaveBeenCalled()
  expect(api.getOverview).not.toHaveBeenCalled()
  const failedRequest = createDeferred<ExternalMonitoringResponse>()
  api.monitoring.mockImplementationOnce(() => failedRequest.promise)
  await page.getByRole('combobox', { name: 'Time range', exact: true }).click()
  await page.getByRole('option', { name: 'Last 30 days', exact: true }).click()
  await expect.element(page.getByText('Loading external agent…', { exact: true })).toBeVisible()
  failedRequest.reject(new ORPCError('SERVICE_UNAVAILABLE', { status: 503 }))
  await expect
    .element(page.getByText('Loading external agent…', { exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'Retry', exact: true }))
    .not.toBeInTheDocument()
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  await expect.element(metric(/^Calls$/i)).not.toBeInTheDocument()
  await expect
    .element(page.getByText('No calls in this period.', { exact: true }))
    .not.toBeInTheDocument()
})

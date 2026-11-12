import type {
  ExternalMetricValuesResponse,
  ExternalMonitoringResponse,
  ExternalTracingConfigurationResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import { ORPCError } from '@orpc/client'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import agentV2 from '@/i18n/locales/en-US/agent-v-2.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import time from '@/i18n/locales/en-US/time.json'
import { createExternalAgentAsset } from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ExternalAgentMonitoringPage } from '../page'

const api = vi.hoisted(() => ({
  monitoring:
    vi.fn<
      typeof import('@/service/console').consoleClient.externalAgents.byAgentId.monitoring.get
    >(),
  getConfig:
    vi.fn<
      typeof import('@/service/console').consoleClient.externalAgents.byAgentId.tracingConfig.byProvider.get
    >(),
  putConfig:
    vi.fn<
      typeof import('@/service/console').consoleClient.externalAgents.byAgentId.tracingConfig.byProvider.put
    >(),
  deleteConfig:
    vi.fn<
      typeof import('@/service/console').consoleClient.externalAgents.byAgentId.tracingConfig.byProvider.delete
    >(),
}))

// boundary: the actual i18n provider supplies labels for all real form and overlay controls.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
// boundary: Browser Mode has no application router; the page reads its current route only.
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  usePathname: () => '/external-agent/22222222-2222-4222-8222-222222222222/monitoring',
}))
// boundary: generated server responses replace HTTP; date conversion, permissions, forms and cache policies stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'externalAgents.byAgentId.monitoring.get': api.monitoring,
      'externalAgents.byAgentId.tracingConfig.byProvider.get': api.getConfig,
      'externalAgents.byAgentId.tracingConfig.byProvider.put': api.putConfig,
      'externalAgents.byAgentId.tracingConfig.byProvider.delete': api.deleteConfig,
    }),
  }
})

const agentId = createExternalAgentAsset().id
const appId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const apps: NonNullable<ExternalMonitoringResponse['apps']> = [
  { id: appId, name: 'Procurement Contract Review', type: 'workflow' },
]
function metrics(
  overrides: Partial<ExternalMetricValuesResponse> = {},
): ExternalMetricValuesResponse {
  return {
    calls: 41,
    reported_tokens: 8200,
    average_call_duration: 12.5,
    token_reporting_coverage: 0.5,
    token_reporting_numerator: 20,
    token_reporting_denominator: 40,
    ...overrides,
  }
}
function response(summary = metrics(), includeApps = true): ExternalMonitoringResponse {
  return {
    summary,
    days: [{ date: '2026-11-10', metrics: summary }],
    ...(includeApps ? { apps } : {}),
  }
}
function configuration(
  overrides: Partial<ExternalTracingConfigurationResponse> = {},
): ExternalTracingConfigurationResponse {
  return {
    provider: 'langsmith',
    revision: 4,
    enabled: true,
    capture_content: false,
    configured_secrets: ['api_key'],
    values: { project: 'Saved production project', endpoint: 'https://api.smith.langchain.com' },
    ...overrides,
  }
}
async function setup({
  role = 'owner',
  timezone = 'America/Los_Angeles',
}: { role?: 'owner' | 'normal'; timezone?: string } = {}) {
  await page.viewport(1512, 982)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, agentV2, app, common, time } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role },
    accountProfile: { timezone },
  })
  onTestFinished(() => queryClient.clear())
  await render(
    <QueryProvider>
      <NuqsTestingAdapter hasMemory>
        <I18nextProvider i18n={i18n}>
          <div className="flex h-screen min-w-0 flex-col">
            <ExternalAgentMonitoringPage agentId={agentId} />
          </div>
        </I18nextProvider>
      </NuqsTestingAdapter>
    </QueryProvider>,
  )
  await expect.element(page.getByRole('heading', { name: 'Monitoring', exact: true })).toBeVisible()
}
function metric(name: RegExp) {
  return page.getByRole('article', { name })
}
async function openProvider() {
  await page.getByRole('button', { name: /Tracing app performance/ }).click()
  const tracing = page.getByRole('dialog', { name: 'Tracing', exact: true })
  await tracing
    .getByRole('group', { name: 'LangSmith', exact: true })
    .getByRole('button', { name: 'Config', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Config LangSmith', exact: true })
  await expect.element(dialog).toBeVisible()
  return dialog
}

beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-11T04:00:00Z'))
  onTestFinished(() => {
    vi.useRealTimers()
  })
  api.monitoring.mockReset().mockResolvedValue(response())
  api.getConfig.mockReset().mockResolvedValue({ configuration: null })
  api.putConfig.mockReset()
  api.deleteConfig.mockReset().mockResolvedValue(undefined)
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

it('saves a write-only provider secret with CAS, reads back the saved configuration, disables it and confirms deletion', async () => {
  let stored: ExternalTracingConfigurationResponse | null = null
  api.getConfig.mockImplementation(async ({ params }) => ({
    configuration: params.provider === 'langsmith' ? stored : null,
  }))
  api.putConfig.mockImplementation(async ({ body, params }) => {
    const { api_key: _secret, ...values } = body.config
    stored = configuration({
      provider: params.provider,
      revision: body.expected_revision + 1,
      values,
      enabled: body.enabled,
      capture_content: body.capture_content,
    })
    return stored
  })
  api.deleteConfig.mockImplementation(async () => {
    stored = null
  })
  await setup()
  let dialog = await openProvider()
  await dialog.getByLabelText(/^API Key/).fill('test-write-only-secret')
  await dialog.getByRole('textbox', { name: 'Project', exact: true }).fill('BYOA monitoring')
  await dialog
    .getByRole('textbox', { name: 'Endpoint', exact: true })
    .fill('https://api.smith.langchain.com')
  await dialog.getByRole('switch', { name: 'Capture content', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save & Enable', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(api.putConfig).toHaveBeenNthCalledWith(1, {
    params: { agent_id: agentId, provider: 'langsmith' },
    body: {
      expected_revision: 0,
      enabled: true,
      capture_content: true,
      config: {
        api_key: 'test-write-only-secret',
        project: 'BYOA monitoring',
        endpoint: 'https://api.smith.langchain.com',
      },
    },
  })
  dialog = await openProvider()
  await expect.element(dialog.getByLabelText('API Key', { exact: true })).toHaveValue('')
  await expect
    .element(dialog.getByRole('textbox', { name: 'Project', exact: true }))
    .toHaveValue('BYOA monitoring')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: /Tracing app performance.*LangSmith.*In Service/ }).click()
  const tracing = page.getByRole('dialog', { name: 'Tracing', exact: true })
  await tracing.getByRole('switch', { name: 'Tracing', exact: true }).click()
  await expect
    .element(tracing.getByRole('switch', { name: 'Tracing', exact: true }))
    .not.toBeChecked()
  expect(api.putConfig.mock.calls.at(-1)?.[0]).toEqual({
    params: { agent_id: agentId, provider: 'langsmith' },
    body: {
      expected_revision: 1,
      enabled: false,
      capture_content: true,
      config: { project: 'BYOA monitoring', endpoint: 'https://api.smith.langchain.com' },
    },
  })
  await tracing
    .getByRole('group', { name: 'LangSmith', exact: true })
    .getByRole('button', { name: 'Config', exact: true })
    .click()
  dialog = page.getByRole('dialog', { name: 'Config LangSmith', exact: true })
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
  const confirmation = page.getByRole('alertdialog', {
    name: 'Remove LangSmith configuration?',
    exact: true,
  })
  await confirmation.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(api.deleteConfig).toHaveBeenCalledWith({
    params: { agent_id: agentId, provider: 'langsmith' },
    query: { expected_revision: 2 },
  })
  await page.getByRole('button', { name: 'Tracing app performance', exact: true }).click()
  await expect
    .element(
      page
        .getByRole('dialog', { name: 'Tracing', exact: true })
        .getByRole('switch', { name: 'Tracing', exact: true }),
    )
    .toBeDisabled()
})

it('keeps provider input after a revision conflict and resubmits with the revision loaded from the server', async () => {
  let stored = configuration()
  api.getConfig.mockImplementation(async ({ params }) => ({
    configuration: params.provider === 'langsmith' ? stored : null,
  }))
  api.putConfig
    .mockImplementationOnce(async () => {
      stored = configuration({ revision: 5, values: { project: 'Another administrator project' } })
      throw new ORPCError('CONFLICT', {
        status: 409,
        message: 'Configuration changed on the server.',
      })
    })
    .mockImplementation(async ({ body }) => {
      stored = configuration({ revision: body.expected_revision + 1, values: body.config })
      return stored
    })
  await setup()
  const dialog = await openProvider()
  const project = dialog.getByRole('textbox', { name: 'Project', exact: true })
  await expect.element(project).toHaveValue('Saved production project')
  await expect.element(dialog.getByLabelText('API Key', { exact: true })).toHaveValue('')
  await project.fill('Keep my authored project')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .element(dialog.getByRole('alert'))
    .toMatchTextContent('Configuration changed on the server.')
  await expect.element(project).toHaveValue('Keep my authored project')
  await dialog.getByRole('button', { name: 'Load latest configuration', exact: true }).click()
  await expect
    .poll(
      () =>
        api.getConfig.mock.calls.filter(([input]) => input.params.provider === 'langsmith').length,
    )
    .toBeGreaterThan(1)
  await expect.element(project).toHaveValue('Keep my authored project')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(api.putConfig.mock.calls.at(-1)?.[0]).toMatchObject({
    body: { expected_revision: 5, config: { project: 'Keep my authored project', api_key: '' } },
  })
})

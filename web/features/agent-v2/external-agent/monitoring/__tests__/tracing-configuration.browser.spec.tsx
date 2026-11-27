import type { ExternalTracingConfigurationResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { ORPCError } from '@orpc/client'
import { page } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
  agentId,
  configuration,
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
  putConfig:
    vi.fn<
      typeof import('@/service/console').consoleClient.externalAgents.byAgentId.tracingConfig.byProvider.put
    >(),
  deleteConfig:
    vi.fn<
      typeof import('@/service/console').consoleClient.externalAgents.byAgentId.tracingConfig.byProvider.delete
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
      'externalAgents.byAgentId.tracingConfig.byProvider.put': api.putConfig,
      'externalAgents.byAgentId.tracingConfig.byProvider.delete': api.deleteConfig,
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
  api.getOverview.mockReset().mockResolvedValue(providerOverview())
  api.getConfig.mockReset().mockResolvedValue({ configuration: null })
  api.putConfig.mockReset()
  api.deleteConfig.mockReset().mockResolvedValue(undefined)
  api.replace.mockReset()
})

it('uses the provider overview for status and only reads the destination explicitly selected for an update', async () => {
  let configs = [
    configuration({
      provider: 'langfuse',
      enabled: false,
      revision: 8,
      capture_content: true,
      values: { host: 'https://cloud.langfuse.com' },
      configured_secrets: ['public_key', 'secret_key'],
    }),
    configuration(),
  ]
  api.getOverview.mockImplementation(async () => providerOverview(configs))
  api.getConfig.mockImplementation(async ({ params }) => ({
    configuration: configs.find((config) => config.provider === params.provider) ?? null,
  }))
  api.putConfig.mockImplementation(async ({ params, body }) => {
    configs = configs.map((config) => ({
      ...config,
      enabled: config.provider === params.provider,
      revision: config.provider === params.provider ? body.expected_revision + 1 : config.revision,
    }))
    return configs.find((config) => config.provider === params.provider)!
  })
  await setup()
  const trigger = page.getByRole('button', {
    name: /Tracing app performance.*LangSmith.*In Service/,
  })
  await expect.element(trigger).toBeVisible()
  expect(api.getConfig).not.toHaveBeenCalled()
  await trigger.click()
  const tracing = page.getByRole('dialog', { name: 'Tracing', exact: true })
  await expect.element(tracing.getByRole('radio', { name: /LangSmith/ })).toBeChecked()
  expect(api.getOverview).toHaveBeenCalledWith({ params: { agent_id: agentId } })
  expect(api.getConfig).not.toHaveBeenCalled()
  await tracing.getByRole('radio', { name: /Langfuse/ }).click()
  await expect.element(tracing.getByRole('radio', { name: /Langfuse/ })).toBeChecked()
  expect(api.getConfig.mock.calls.map(([input]) => input.params.provider)).toEqual(['langfuse'])
  expect(api.putConfig).toHaveBeenCalledWith({
    params: { agent_id: agentId, provider: 'langfuse' },
    body: {
      expected_revision: 8,
      enabled: true,
      capture_content: true,
      config: { host: 'https://cloud.langfuse.com' },
    },
  })
})

it('does not open an editable draft after a failed provider read and reloads when Config is chosen again', async () => {
  api.getOverview.mockResolvedValue(providerOverview([configuration()]))
  api.getConfig
    .mockRejectedValueOnce(
      new ORPCError('SERVICE_UNAVAILABLE', {
        status: 503,
        message: 'Provider configuration is unavailable.',
      }),
    )
    .mockResolvedValue({ configuration: configuration() })
  await setup()
  await page.getByRole('button', { name: /Tracing app performance/ }).click()
  const tracing = page.getByRole('dialog', { name: 'Tracing', exact: true })
  const configure = tracing
    .getByRole('group', { name: 'LangSmith', exact: true })
    .getByRole('button', { name: 'Config', exact: true })
  await configure.click()
  await expect
    .element(tracing.getByRole('alert'))
    .toHaveTextContent('Provider configuration is unavailable.')
  await expect
    .element(page.getByRole('dialog', { name: 'Config LangSmith', exact: true }))
    .not.toBeInTheDocument()
  expect(api.putConfig).not.toHaveBeenCalled()
  await configure.click()
  const dialog = page.getByRole('dialog', { name: 'Config LangSmith', exact: true })
  await expect
    .element(dialog.getByRole('textbox', { name: 'Project', exact: true }))
    .toHaveValue('Saved production project')
  await expect.element(dialog.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  expect(api.getConfig.mock.calls.map(([input]) => input.params.provider)).toEqual([
    'langsmith',
    'langsmith',
  ])
})

it('saves a write-only provider secret with CAS, reads back the saved configuration, disables it and confirms deletion', async () => {
  let stored: ExternalTracingConfigurationResponse | null = null
  api.getOverview.mockImplementation(async () => providerOverview(stored ? [stored] : []))
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
  await expect.element(page.getByRole('button', { name: /Tracing app performance/ })).toBeVisible()
  expect(api.getConfig).not.toHaveBeenCalled()
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
  api.getOverview.mockImplementation(async () => providerOverview([stored]))
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
    .mockRejectedValueOnce(
      new ORPCError('CONFLICT', {
        status: 409,
        message: 'Configuration changed on the server.',
      }),
    )
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
  expect(api.getConfig).toHaveBeenCalledTimes(1)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => api.putConfig.mock.calls.length).toBe(2)
  expect(api.putConfig.mock.calls.at(-1)?.[0].body.expected_revision).toBe(4)
  await expect
    .element(dialog.getByRole('button', { name: 'Load latest configuration', exact: true }))
    .toBeEnabled()
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

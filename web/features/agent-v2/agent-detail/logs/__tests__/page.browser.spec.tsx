import type {
  AgentLogListResponse,
  AgentLogSourceListResponse,
  GetAgentByAgentIdLogsData,
} from '@dify/contracts/api/console/agent/types.gen'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { initialWorkspaceSummary } from '@/context/app-context-defaults'
import agentV2 from '@/i18n/locales/en-US/agent-v-2.json'
import appLog from '@/i18n/locales/en-US/app-log.json'
import common from '@/i18n/locales/en-US/common.json'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper, createFeaturesFixture } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { AgentLogsPage } from '../page'

const mocks = vi.hoisted(() => ({
  logs: vi.fn(),
  sources: vi.fn(),
  preview: vi.fn(),
  create: vi.fn(),
  latest: vi.fn(),
  workspace: vi.fn(),
  features: vi.fn(),
}))

vi.unmock('react-i18next')
// boundary: generated Console transport supplies the log-list server responses.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': mocks.features,
      'workspaces.current.summary.get': mocks.workspace,
      'agent.byAgentId.get': async () => ({ name: 'Agent log export test' }),
      'agent.byAgentId.logSources.get': mocks.sources,
      'agent.byAgentId.logs.get': mocks.logs,
      'agent.byAgentId.logs.identityOptions.get': async () => ({
        data: [
          { id: 'end-user-1', label: 'customer-001', source: 'end-user' },
          { id: 'account-1', label: 'operator-001', source: 'account' },
        ],
      }),
      'agent.byAgentId.logExports.latest.get': mocks.latest,
      'agent.byAgentId.logExports.preview.get': mocks.preview,
      'agent.byAgentId.logExports.post': mocks.create,
    }),
  }
})

const emptyLogs: AgentLogListResponse = {
  data: [],
  has_more: false,
  limit: 25,
  page: 1,
  total: 0,
}

const emptySources: AgentLogSourceListResponse = { data: [], groups: [] }

async function createLogsI18n() {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentV2, appLog, common } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  return i18n
}

it('keeps log filters and pagination reachable at a 320 by 256 viewport', async () => {
  await page.viewport(320, 256)
  mocks.logs.mockResolvedValue(emptyLogs)
  mocks.sources.mockResolvedValue(emptySources)
  mocks.workspace.mockResolvedValue(initialWorkspaceSummary)
  const i18n = await createLogsI18n()
  const { queryClient } = createConsoleQueryWrapper({ currentWorkspace: initialWorkspaceSummary })

  try {
    const screen = await render(
      <QueryClientTestProvider queryClient={queryClient}>
        <I18nextProvider i18n={i18n}>
          <div style={{ width: 224, height: 256 }}>
            <AgentLogsPage agentId="agent-1" />
          </div>
        </I18nextProvider>
      </QueryClientTestProvider>,
    )

    await expect.element(screen.getByText('No logs found')).toBeVisible()
    await expect
      .element(screen.getByRole('link', { name: 'Learn more' }))
      .toHaveAttribute('href', 'https://docs.dify.ai/en/self-host/use-dify/monitor/logs')
    const section = screen.getByRole('region', { name: 'Logs' }).first().element()
    const panel = section.firstElementChild as HTMLElement
    const controls = [
      screen.getByRole('combobox', { name: 'Last 7 days' }),
      screen.getByRole('combobox', { name: 'Log source' }),
      screen.getByRole('combobox', { name: 'End user or account' }),
      screen.getByRole('searchbox', { name: 'Search logs' }),
      screen.getByRole('button', { name: /Sort by:/ }),
    ]
    const bounds = panel.getBoundingClientRect()
    const controlBounds = controls.map((control) => control.element().getBoundingClientRect())

    for (const rect of controlBounds) {
      expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1)
      expect(rect.right).toBeLessThanOrEqual(bounds.right + 1)
    }
    for (let index = 1; index < controlBounds.length; index++) {
      const previous = controlBounds[index - 1]!
      const current = controlBounds[index]!
      expect(current.left >= previous.right || current.top >= previous.bottom).toBe(true)
    }

    const tableViewport = screen.getByRole('region', { name: 'Logs' }).last().element()
    const table = screen.getByRole('table').element()
    expect(table.getBoundingClientRect().width).toBeGreaterThan(tableViewport.clientWidth)
    tableViewport.scrollLeft = 100
    expect(tableViewport.scrollLeft).toBeGreaterThan(0)

    expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight)
    panel.scrollTop = panel.scrollHeight
    expect(panel.scrollTop).toBeGreaterThan(0)
    await expect.element(screen.getByRole('button', { name: /Edit page number/ })).toBeVisible()
    await expect.element(screen.getByRole('radiogroup', { name: 'Items per page' })).toBeVisible()
  } finally {
    queryClient.clear()
    await page.viewport(1280, 720)
  }
})

it('keeps identities selectable after narrowing the list and exports both selected types', async () => {
  const logs: AgentLogListResponse['data'] = [
    {
      id: 'account-log',
      conversation_id: 'account-log',
      account_id: 'account-1',
      message_count: 1,
      unread: false,
      status: 'success',
    },
    {
      id: 'end-user-log',
      conversation_id: 'end-user-log',
      end_user_id: 'end-user-1',
      message_count: 1,
      unread: false,
      status: 'success',
    },
  ]
  mocks.logs.mockImplementation(({ query }: GetAgentByAgentIdLogsData) => {
    const endUserIds = query?.end_user_ids ?? []
    const accountIds = query?.account_ids ?? []
    const data =
      endUserIds.length || accountIds.length
        ? logs.filter(
            ({ end_user_id, account_id }) =>
              endUserIds.includes(end_user_id ?? '') || accountIds.includes(account_id ?? ''),
          )
        : logs
    return { ...emptyLogs, data, total: data.length } satisfies AgentLogListResponse
  })
  mocks.sources.mockResolvedValue(emptySources)
  mocks.preview.mockResolvedValue({ counts: { log_count: 1, row_count: 1 } })
  mocks.create.mockResolvedValue({ task_id: 'test-export', status: 'pending' })
  mocks.latest.mockResolvedValue({ task: null })
  const workspace = { ...initialWorkspaceSummary, id: 'workspace-1', role: 'owner' } as const
  mocks.workspace.mockResolvedValue(workspace)
  const i18n = await createLogsI18n()
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'COMMUNITY' },
    currentWorkspace: workspace,
  })

  try {
    const screen = await render(
      <QueryClientTestProvider queryClient={queryClient}>
        <I18nextProvider i18n={i18n}>
          <AgentLogsPage agentId="agent-1" />
        </I18nextProvider>
      </QueryClientTestProvider>,
    )
    const exportButton = screen.getByRole('button', { name: 'Export logs' })
    await expect.element(exportButton).toBeVisible()
    await expect.element(screen.getByRole('cell', { name: 'account-1' })).toBeVisible()
    const identityFilter = screen.getByRole('combobox', { name: 'End user or account' })
    await identityFilter.click()
    const search = screen.getByRole('combobox', { name: 'Search', exact: true })
    await search.fill('001')
    await screen.getByRole('option', { name: 'customer-001' }).click()
    await expect.element(search).toHaveValue('001')
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('cell', { name: 'account-1' })).not.toBeInTheDocument()
    await identityFilter.click()
    await expect.element(search).toHaveValue('')
    await screen.getByRole('option', { name: 'account-1' }).click()
    await userEvent.keyboard('{Escape}')
    const identities = { end_user_ids: ['end-user-1'], account_ids: ['account-1'] }
    await exportButton.click()
    await expect.poll(() => mocks.logs.mock.lastCall?.[0].query).toMatchObject(identities)

    const dialog = screen.getByRole('dialog', { name: 'Export logs' })
    await expect.element(dialog.getByText('Log 1 · CSV row 1.')).toBeVisible()
    expect(mocks.preview.mock.lastCall?.[0].query).toMatchObject(identities)
    await dialog.getByRole('button', { name: 'Export as CSV' }).click()
    await expect.poll(() => mocks.create.mock.lastCall?.[0].body).toMatchObject(identities)
  } finally {
    queryClient.clear()
  }
})

it('falls back to the default date preset when Cloud custom dates become unavailable', async () => {
  mocks.logs.mockResolvedValue(emptyLogs)
  mocks.sources.mockResolvedValue(emptySources)
  mocks.workspace.mockResolvedValue(initialWorkspaceSummary)
  const paidPlan = createFeaturesFixture({ billing: { subscription: { plan: 'professional' } } })
  mocks.features.mockResolvedValue(paidPlan)
  const i18n = await createLogsI18n()
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
    currentWorkspace: initialWorkspaceSummary,
    features: paidPlan,
  })

  try {
    const screen = await render(
      <QueryClientTestProvider queryClient={queryClient}>
        <I18nextProvider i18n={i18n}>
          <AgentLogsPage agentId="agent-1" />
        </I18nextProvider>
      </QueryClientTestProvider>,
    )
    await screen.getByRole('combobox', { name: 'Last 7 days' }).click()
    await screen.getByRole('option', { name: 'Custom' }).click()
    await expect.element(screen.getByRole('combobox', { name: 'Custom' })).toBeVisible()

    mocks.features.mockResolvedValue(
      createFeaturesFixture({ billing: { subscription: { plan: 'sandbox' } } }),
    )
    await queryClient.invalidateQueries({ queryKey: consoleQuery.features.get.queryKey() })
    await screen.getByRole('combobox', { name: 'Last 7 days' }).click()
    await expect.element(screen.getByRole('option', { name: 'Last 30 days' })).toBeVisible()
    await expect.element(screen.getByRole('option', { name: 'Custom' })).not.toBeInTheDocument()
  } finally {
    queryClient.clear()
  }
})

import type {
  AgentLogListResponse,
  AgentLogSourceListResponse,
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
import { TEST_AGENT_ID, TEST_WORKSPACE_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper, createFeaturesFixture } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { setupFakeApi } from '@/test/fake-api'
import { createAgentFixture } from '@/test/fixtures/agent'
import { AgentLogsPage } from '../page'

vi.unmock('react-i18next')

const emptyLogs: AgentLogListResponse = {
  data: [],
  has_more: false,
  limit: 25,
  page: 1,
  total: 0,
}

const emptySources: AgentLogSourceListResponse = { data: [], groups: [] }
const endUserId = '318c3264-a6bc-4e08-ade7-5537a5fa5e49'
const accountId = 'd0cf95f6-d61e-45c0-baf0-70eae7bdbf68'
const exportTaskId = '41d982c1-6581-44c9-ae35-b6a7365aa446'

const fake = setupFakeApi({
  console: {
    features: { get: () => createFeaturesFixture() },
    workspaces: { current: { summary: { get: () => initialWorkspaceSummary } } },
    agent: {
      byAgentId: {
        get: () => createAgentFixture({ name: 'Agent log export test' }),
        logSources: { get: () => emptySources },
        logs: {
          get: () => emptyLogs,
          identityOptions: {
            get: () => ({
              data: [
                { id: endUserId, label: 'customer-001', source: 'end-user' },
                { id: accountId, label: 'operator-001', source: 'account' },
              ],
            }),
          },
        },
        logExports: {
          latest: { get: () => ({ task: null }) },
          preview: { get: () => ({ counts: { log_count: 1, row_count: 3 } }) },
          byTaskId: {
            get: () => ({ task_id: exportTaskId, status: 'ready', estimated_rows: 3 }),
          },
          post: () => ({ task_id: exportTaskId, status: 'pending', estimated_rows: 3 }),
        },
      },
    },
  },
})

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
  const i18n = await createLogsI18n()
  const { queryClient } = createConsoleQueryWrapper({ currentWorkspace: initialWorkspaceSummary })

  try {
    const screen = await render(
      <QueryClientTestProvider queryClient={queryClient}>
        <I18nextProvider i18n={i18n}>
          <div style={{ width: 224, height: 256 }}>
            <AgentLogsPage agentId={TEST_AGENT_ID} />
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
      account_id: accountId,
      message_count: 1,
      unread: false,
      status: 'success',
    },
    {
      id: 'end-user-log',
      conversation_id: 'end-user-log',
      end_user_id: endUserId,
      message_count: 1,
      unread: false,
      status: 'success',
    },
  ]
  const { logs: logApi, logExports: exportApi } = fake.console.agent.byAgentId
  logApi.get.mockImplementation(({ query }) => {
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
  const workspace = { ...initialWorkspaceSummary, id: TEST_WORKSPACE_ID, role: 'owner' } as const
  fake.console.workspaces.current.summary.get.mockResolvedValue(workspace)
  const i18n = await createLogsI18n()
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'COMMUNITY' },
    currentWorkspace: workspace,
  })

  try {
    const screen = await render(
      <QueryClientTestProvider queryClient={queryClient}>
        <I18nextProvider i18n={i18n}>
          <AgentLogsPage agentId={TEST_AGENT_ID} />
        </I18nextProvider>
      </QueryClientTestProvider>,
    )
    const exportButton = screen.getByRole('button', { name: 'Export logs' })
    await expect.element(exportButton).toBeVisible()
    await expect.element(screen.getByRole('cell', { name: accountId })).toBeVisible()
    const identityFilter = screen.getByRole('combobox', { name: 'End user or account' })
    await identityFilter.click()
    const search = screen.getByRole('combobox', { name: 'Search', exact: true })
    await search.fill('001')
    await screen.getByRole('option', { name: 'customer-001' }).click()
    await expect.element(search).toHaveValue('001')
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('cell', { name: accountId })).not.toBeInTheDocument()
    await identityFilter.click()
    await expect.element(search).toHaveValue('')
    await screen.getByRole('option', { name: accountId }).click()
    await userEvent.keyboard('{Escape}')
    const identities = { end_user_ids: [endUserId], account_ids: [accountId] }
    await exportButton.click()
    await expect.poll(() => logApi.get.mock.lastCall?.[0].query).toMatchObject(identities)

    const dialog = screen.getByRole('dialog', { name: 'Export logs' })
    await expect.element(dialog.getByText('Log 1 · CSV rows 3.')).toBeVisible()
    expect(exportApi.preview.get.mock.lastCall?.[0].query).toMatchObject(identities)
    await dialog.getByRole('button', { name: 'Export as CSV' }).click()
    await expect
      .poll(() => exportApi.post.mock.lastCall?.[0].body)
      .toMatchObject({
        ...identities,
        estimated_rows: 3,
      })
    await expect.element(dialog).not.toBeInTheDocument()
    const progress = screen.getByRole('dialog', { name: 'Export', exact: true })
    await expect.element(progress.getByRole('button', { name: 'Download' })).toBeEnabled()
    expect(exportApi.byTaskId.get.mock.lastCall?.[0].params).toEqual({
      agent_id: TEST_AGENT_ID,
      task_id: exportTaskId,
    })
  } finally {
    queryClient.clear()
  }
})

it('falls back to the default date preset when Cloud custom dates become unavailable', async () => {
  const paidPlan = createFeaturesFixture({ billing: { subscription: { plan: 'professional' } } })
  fake.console.features.get.mockResolvedValue(paidPlan)
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
          <AgentLogsPage agentId={TEST_AGENT_ID} />
        </I18nextProvider>
      </QueryClientTestProvider>,
    )
    await screen.getByRole('combobox', { name: 'Last 7 days' }).click()
    await screen.getByRole('option', { name: 'Custom' }).click()
    await expect.element(screen.getByRole('combobox', { name: 'Custom' })).toBeVisible()

    fake.console.features.get.mockResolvedValue(
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

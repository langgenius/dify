import type {
  AgentLogListResponse,
  AgentLogSourceListResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import agentV2 from '@/i18n/locales/en-US/agent-v-2.json'
import appLog from '@/i18n/locales/en-US/app-log.json'
import common from '@/i18n/locales/en-US/common.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { AgentLogsPage } from '../page'

const mocks = vi.hoisted(() => ({
  logs: vi.fn(),
  sources: vi.fn(),
}))

vi.unmock('react-i18next')
// boundary: generated Console transport supplies the log-list server responses.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.logSources.get': mocks.sources,
      'agent.byAgentId.logs.get': mocks.logs,
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

it('keeps log filters and pagination reachable at a 320 by 256 viewport', async () => {
  await page.viewport(320, 256)
  mocks.logs.mockResolvedValue(emptyLogs)
  mocks.sources.mockResolvedValue(emptySources)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentV2, appLog, common } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient } = createConsoleQueryWrapper()

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

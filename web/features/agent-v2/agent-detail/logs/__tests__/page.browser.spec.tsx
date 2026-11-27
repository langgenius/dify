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
import { installFakeApi } from '@/test/fake-api'
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

it('keeps log filters and pagination reachable at a 320 by 256 viewport', async () => {
  await page.viewport(320, 256)
  onTestFinished(
    installFakeApi({
      console: {
        agent: {
          byAgentId: {
            logSources: { get: () => emptySources },
            logs: { get: () => emptyLogs },
          },
        },
      },
    }),
  )
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
            <AgentLogsPage agentId="00000000-0000-4000-8000-000000000001" />
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

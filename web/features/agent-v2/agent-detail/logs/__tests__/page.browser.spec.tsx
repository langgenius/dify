import type {
  AgentLogListResponse,
  AgentLogSourceListResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { AgentLogsPage } from '../page'

const mocks = vi.hoisted(() => ({
  logs: vi.fn(),
  sources: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: agentV2 } = await import('@/i18n/locales/en-US/agent-v-2.json')
  const { default: appLog } = await import('@/i18n/locales/en-US/app-log.json')
  const { default: common } = await import('@/i18n/locales/en-US/common.json')
  return createReactI18nextMock({ ...agentV2, ...appLog, ...common })
})

vi.mock('@/context/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/i18n')>()),
  useDocLink: () => (path: string) => path,
}))
vi.mock('@/hooks/use-timestamp', () => ({ default: () => ({ formatTime: () => '' }) }))
vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleQuery: {
    agent: {
      byAgentId: {
        feedbacks: { post: { mutationOptions: () => ({ mutationFn: vi.fn() }) } },
        logSources: {
          get: { queryOptions: () => ({ queryKey: ['log-sources'], queryFn: mocks.sources }) },
        },
        logs: {
          get: {
            key: () => ['agent-logs'],
            queryOptions: () => ({ queryKey: ['agent-logs'], queryFn: mocks.logs }),
          },
          byConversationId: {
            messages: {
              get: {
                key: () => ['agent-log-messages'],
                queryOptions: () => ({ queryKey: ['agent-log-messages'], queryFn: vi.fn() }),
              },
            },
          },
        },
      },
    },
  },
}))

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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  try {
    const screen = await render(
      <QueryClientTestProvider queryClient={queryClient}>
        <div style={{ width: 224, height: 256 }}>
          <AgentLogsPage agentId="agent-1" />
        </div>
      </QueryClientTestProvider>,
    )

    await expect.element(screen.getByText('No logs found')).toBeVisible()
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

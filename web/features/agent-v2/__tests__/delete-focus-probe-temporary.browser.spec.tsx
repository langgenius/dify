import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AgentPermission } from '@/features/agent-v2/acl'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { createAgentFixture } from '@/test/fixtures/agent'
import { AgentRosterList } from '../roster/components/agent-roster-list'

const deleteAgent = vi.hoisted(() => vi.fn())
vi.mock('react-i18next', async (importOriginal) => importOriginal())
vi.mock('@/features/agent-v2/permissions', () => ({ useCanCreateAgents: () => false }))
vi.mock('@/hooks/use-timestamp', () => ({ default: () => ({ formatTime: () => '' }) }))
vi.mock('@/app/components/app/use-export-app-dsl', () => ({
  useExportAppDsl: () => ({ exportAppDsl: vi.fn(), isExporting: false }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.delete': deleteAgent,
    }),
  }
})

const agent = {
  ...createAgentFixture({
    id: 'agent-1',
    name: 'Research Agent',
    permission_keys: [AgentPermission.Delete, AgentPermission.Edit],
  }),
  active_config_is_published: false,
  is_starred: false,
  published_reference_count: 0,
}
const listOptions = consoleQuery.agent.get.queryOptions({
  input: { query: { page: 1, limit: 30 } },
  enabled: false,
})

function Roster() {
  const { data } = useQuery(listOptions)
  return (
    <AgentRosterList
      label="Agents"
      state={{
        status: 'ready',
        agents: data?.data ?? [],
        emptyState: 'roster',
        footer: { status: 'none' },
        isFetching: false,
      }}
    />
  )
}

it.each(['fresh', 'first-card-pointer', 'first-card-keyboard'] as const)(
  'focus probe: %s',
  async (mode) => {
    const i18n = createInstance()
    await i18n.init({
      lng: 'en-US',
      resources: { 'en-US': { agentRoster, common } },
      keySeparator: false,
      interpolation: { escapeValue: false },
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(listOptions.queryKey, {
      data: [{ ...agent, id: 'agent-0', name: 'First Agent' }, agent],
      publication_counts: { drafts: 2, published: 0 },
      total: 2,
      has_more: false,
      page: 1,
      limit: 30,
    })
    const pending = createDeferred<void>()
    deleteAgent.mockReturnValueOnce(pending.promise)
    try {
      const screen = await render(
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <button type="button">Stable button</button>
            <DropdownMenu>
              <DropdownMenuTrigger>Stable menu</DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Stable option</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Roster />
          </QueryClientProvider>
        </I18nextProvider>,
      )
      if (mode !== 'fresh') {
        const firstTrigger = screen.getByRole('button', { name: 'More actions for First Agent' })
        await screen.getByRole('link', { name: 'First Agent' }).hover()
        if (mode === 'first-card-keyboard') {
          firstTrigger.element().focus()
          await userEvent.keyboard('{Enter}')
        } else await firstTrigger.click()
        await expect.element(screen.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
        await userEvent.keyboard('{Escape}')
        await expect.element(firstTrigger).toHaveFocus()
      }
      const trigger = screen.getByRole('button', { name: 'More actions for Research Agent' })
      const link = screen.getByRole('link', { name: 'Research Agent' })
      await link.hover()
      await trigger.click()
      await screen.getByRole('menuitem', { name: 'Delete' }).click()
      const input = screen.getByRole('textbox', { name: 'Type Research Agent to confirm' })
      await expect.element(input).toHaveFocus()
      await screen.getByRole('button', { name: 'Autofill' }).click()
      await input.click()
      await userEvent.keyboard('{Enter}')
      await expect.poll(() => deleteAgent.mock.calls.length).toBe(1)
      pending.resolve()
      await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
      await expect.element(link).not.toBeInTheDocument()
      console.warn(
        'FOCUS_PROBE',
        mode,
        JSON.stringify({
          tag: document.activeElement?.tagName,
          text: document.activeElement?.textContent?.slice(0, 90),
          ariaLabel: document.activeElement?.getAttribute('aria-label'),
        }),
      )
      expect(document.activeElement).not.toBeNull()
    } finally {
      queryClient.clear()
    }
  },
)

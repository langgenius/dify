import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import type { consoleClient } from '@/service/console'
import { zAgentAppPagination } from '@dify/contracts/api/console/agent/zod.gen'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AgentPermission } from '@/features/agent-v2/acl'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { createAgentFixture } from '@/test/fixtures/agent'
import RosterPage from '../roster/page'

const api = vi.hoisted(() => ({
  agents: vi.fn<typeof consoleClient.agent.get>(),
  delete: vi.fn<typeof consoleClient.agent.byAgentId.delete>(),
}))
vi.mock('react-i18next', async (importOriginal) => importOriginal())
vi.mock('@/features/agent-v2/permissions', () => ({
  useCanCreateAgents: () => false,
  useCanImportAgents: () => false,
}))
vi.mock('@/context/i18n', () => ({ useDocLink: () => (path: string) => path }))
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
      'agent.get': api.agents,
      'agent.byAgentId.delete': api.delete,
    }),
  }
})

const agent = (id: string, name: string): AgentAppPartial => ({
  ...createAgentFixture({
    id,
    name,
    permission_keys: [AgentPermission.Delete, AgentPermission.Edit],
  }),
  active_config_is_published: false,
  is_starred: false,
  published_reference_count: 0,
})
const agentPage = (data: AgentAppPartial[]) =>
  zAgentAppPagination.parse({
    data,
    publication_counts: { drafts: data.length, published: 0 },
    total: data.length,
    has_more: false,
    page: 1,
    limit: 30,
  })
const animationSettings = globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
let previousAnimationSetting: boolean
beforeEach(() => {
  previousAnimationSetting = animationSettings.BASE_UI_ANIMATIONS_DISABLED
  animationSettings.BASE_UI_ANIMATIONS_DISABLED = false
})
afterEach(() => {
  animationSettings.BASE_UI_ANIMATIONS_DISABLED = previousAnimationSetting
})

async function setup(initialAgents: AgentAppPartial[]) {
  await page.viewport(1024, 768)
  let agents = initialAgents
  api.agents.mockReset().mockImplementation(async () => agentPage(agents))
  api.delete.mockReset().mockImplementation(async ({ params }) => {
    agents = agents.filter(({ id }) => id !== params.agent_id)
  })
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, common } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient } = createConsoleQueryWrapper({ systemFeatures: {} })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <I18nextProvider i18n={i18n}>
          <div className="flex h-screen flex-col">
            <RosterPage />
          </div>
        </I18nextProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  await expect.element(screen.getByRole('list', { name: 'Agent list', exact: true })).toBeVisible()
  const actions = (name: string) => screen.getByRole('button', { name: `More actions for ${name}` })
  const openDelete = async (name: string) => {
    await screen.getByRole('link', { name, exact: true }).hover()
    await actions(name).click()
    await expect.element(screen.getByRole('menu')).toBeVisible()
    const menu = screen.getByRole('menu').element()
    await screen.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    await expect.poll(() => menu.isConnected).toBe(false)
  }
  return { screen, queryClient, openDelete, actions }
}

it('focuses the next agent after deletion and keeps the next canceled action keyboard-operable', async () => {
  const target = agent('target', 'Research Agent')
  const remaining = agent('remaining', 'Writing Agent')
  const { screen, queryClient, openDelete, actions } = await setup([target, remaining])
  const pending = createDeferred<void>()
  const deleteAgent = api.delete.getMockImplementation()!
  api.delete.mockImplementationOnce(async (input) => {
    await pending.promise
    return deleteAgent(input)
  })
  try {
    const deletedCard = screen.getByRole('link', { name: target.name, exact: true }).element()
    await openDelete(target.name)
    const dialog = screen.getByRole('alertdialog').element()
    const input = screen.getByRole('textbox', { name: `Type ${target.name} to confirm` })
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await input.click()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => api.delete.mock.calls.length).toBe(1)
    await expect.element(input).toHaveFocus()
    pending.resolve()
    await expect.poll(() => deletedCard.isConnected).toBe(false)
    await expect.poll(() => dialog.isConnected).toBe(false)
    await expect
      .element(screen.getByRole('link', { name: remaining.name, exact: true }))
      .toHaveFocus()

    await openDelete(remaining.name)
    const canceledDialog = screen.getByRole('alertdialog').element()
    await screen.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.poll(() => canceledDialog.isConnected).toBe(false)
    await expect.element(actions(remaining.name)).toHaveFocus()
    await expect.element(actions(remaining.name)).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await expect.element(screen.getByRole('menu')).toBeVisible()
    expect(api.delete).toHaveBeenCalledExactlyOnceWith({ params: { agent_id: target.id } })
  } finally {
    pending.resolve()
    queryClient.clear()
  }
})

it('focuses the empty roster when its last agent is deleted without an exit transition', async () => {
  const target = agent('target', 'Last Agent')
  const { screen, queryClient, openDelete } = await setup([target])
  const noMotionStyle = document.createElement('style')
  try {
    noMotionStyle.textContent =
      '[role="alertdialog"] { transition: none !important; animation: none !important; }'
    document.head.append(noMotionStyle)
    const deletedCard = screen.getByRole('link', { name: target.name, exact: true }).element()
    await openDelete(target.name)
    const dialog = screen.getByRole('alertdialog').element()
    expect(getComputedStyle(dialog).transitionDuration).toBe('0s')
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await screen.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.poll(() => deletedCard.isConnected).toBe(false)
    await expect.poll(() => dialog.isConnected).toBe(false)
    await expect.element(screen.getByRole('region', { name: 'Agents', exact: true })).toHaveFocus()
  } finally {
    noMotionStyle.remove()
    queryClient.clear()
  }
})

it('focuses the next card without moving the roster scroll position', async () => {
  const agents = Array.from({ length: 30 }, (_, index) => agent(`agent-${index}`, `Agent ${index}`))
  const targetName = 'Agent 15'
  const { screen, queryClient, openDelete } = await setup(agents)
  try {
    const viewport = screen.getByRole('region', { name: 'Agents', exact: true }).element()
    await expect.poll(() => viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)
    viewport.scrollTo({ top: 600 })
    await expect.poll(() => viewport.scrollTop).toBeGreaterThan(0)
    const deletedCard = screen.getByRole('link', { name: targetName, exact: true }).element()
    await openDelete(targetName)
    const scrollTop = viewport.scrollTop
    const dialog = screen.getByRole('alertdialog').element()
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await screen.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.poll(() => deletedCard.isConnected).toBe(false)
    await expect.poll(() => dialog.isConnected).toBe(false)
    await expect.element(screen.getByRole('link', { name: 'Agent 16', exact: true })).toHaveFocus()
    expect(viewport.scrollTop).toBe(scrollTop)
  } finally {
    queryClient.clear()
  }
})

it.each([
  { deleted: 1, focused: 2 },
  { deleted: 2, focused: 1 },
])('focuses agent $focused after deleting agent $deleted', async ({ deleted, focused }) => {
  const agents = [agent('a', 'First Agent'), agent('b', 'Middle Agent'), agent('c', 'Last Agent')]
  const { screen, queryClient, openDelete } = await setup(agents)
  try {
    await openDelete(agents[deleted]!.name)
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await screen.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: agents[deleted]!.name }))
      .not.toBeInTheDocument()
    const target = screen.getByRole('link', { name: agents[focused]!.name })
    await expect.element(target).toHaveFocus()
    await expect.element(target).toBeVisible()
    await userEvent.keyboard('{Tab}')
    await expect
      .element(screen.getByRole('button', { name: `More actions for ${agents[focused]!.name}` }))
      .toHaveFocus()
  } finally {
    queryClient.clear()
  }
})

it('focuses the next agent primary control when that agent has no actions', async () => {
  const target = agent('target', 'Editable Agent')
  const remaining = {
    ...agent('remaining', 'Preview Agent'),
    permission_keys: [AgentPermission.Preview],
  }
  const { screen, queryClient, openDelete } = await setup([target, remaining])
  try {
    await openDelete(target.name)
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await screen.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: remaining.name, exact: true }))
      .toHaveFocus()
  } finally {
    queryClient.clear()
  }
})

import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import { zAgentAppPagination } from '@dify/contracts/api/console/agent/zod.gen'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AgentPermission } from '@/features/agent-v2/acl'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { hold, installFakeApi } from '@/test/fake-api'
import { createAgentFixture } from '@/test/fixtures/agent'
import RosterPage from '../roster/page'

vi.unmock('react-i18next')

// Agent ids are UUIDs in the contract; derive a stable one from each readable key.
const agentIds = new Map<string, string>()
const agentId = (key: string) => {
  if (!agentIds.has(key))
    agentIds.set(key, `00000000-0000-4000-8000-${String(agentIds.size + 1).padStart(12, '0')}`)
  return agentIds.get(key)!
}
const agent = (key: string, name: string): AgentAppPartial => ({
  ...createAgentFixture({
    id: agentId(key),
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
  const fake = installFakeApi({
    console: {
      tags: { get: () => [] },
      agent: {
        get: () => agentPage(agents),
        byAgentId: {
          delete: ({ params }) => {
            agents = agents.filter(({ id }) => id !== params.agent_id)
          },
        },
      },
    },
  })
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, app, common } },
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
  // Unmount before the fake API leaves, so a late refetch cannot reach the real network.
  onTestFinished(async () => {
    await screen.unmount()
    await fake()
  })
  await expect.element(screen.getByRole('list', { name: 'Agent list', exact: true })).toBeVisible()
  await expect
    .element(screen.getByRole('link', { name: 'Learn more about Agent' }))
    .toHaveAttribute('href', 'https://docs.dify.ai/en/self-host/use-dify/build/new-agent/overview')
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
  return { screen, queryClient, openDelete, actions, fake }
}

it('focuses the next agent after deletion and keeps the next canceled action keyboard-operable', async () => {
  const target = agent('target', 'Research Agent')
  const remaining = agent('remaining', 'Writing Agent')
  const { screen, queryClient, openDelete, actions, fake } = await setup([target, remaining])
  const deleteRequest = fake.console.agent.byAgentId.delete
  const pending = hold(deleteRequest)
  try {
    const deletedCard = screen.getByRole('link', { name: target.name, exact: true }).element()
    await openDelete(target.name)
    const dialog = screen.getByRole('alertdialog').element()
    const input = screen.getByRole('textbox', { name: `Type ${target.name} to confirm` })
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await input.click()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => deleteRequest.mock.calls.length).toBe(1)
    await expect.element(input).toHaveFocus()
    pending.release()
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
    expect(deleteRequest).toHaveBeenCalledExactlyOnceWith({ params: { agent_id: target.id } })
  } finally {
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
    const target = screen.getByRole('link', { name: targetName, exact: true })
    await expect.element(target).toBeInTheDocument()
    target.element().scrollIntoView({ block: 'center' })
    // A surviving card above the deletion keeps the same painted position only if
    // restoring focus does not scroll the roster.
    const anchor = screen.getByRole('link', { name: 'Agent 12', exact: true })
    await expect.element(anchor).toBeInTheDocument()
    const anchorElement = anchor.element()
    const deletedCard = screen.getByRole('link', { name: targetName, exact: true }).element()
    await openDelete(targetName)
    const anchorTop = anchorElement.getBoundingClientRect().top
    const dialog = screen.getByRole('alertdialog').element()
    await screen.getByRole('button', { name: 'Autofill' }).click()
    await screen.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.poll(() => deletedCard.isConnected).toBe(false)
    await expect.poll(() => dialog.isConnected).toBe(false)
    await expect.element(screen.getByRole('link', { name: 'Agent 16', exact: true })).toHaveFocus()
    expect(anchorElement.getBoundingClientRect().top).toBeCloseTo(anchorTop)
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

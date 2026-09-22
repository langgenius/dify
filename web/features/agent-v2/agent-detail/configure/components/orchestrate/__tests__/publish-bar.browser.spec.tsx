import { zAgentAppComposerResponse } from '@dify/contracts/api/console/agent/zod.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createAgentFixture } from '@/test/fixtures/agent'
import { createTestQueryClient } from '@/test/query-client'
import { AgentConfigurePublishBar } from '../publish-bar'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({ formatTimeFromNow: () => 'just now' }),
}))
vi.mock('@/hooks/use-timestamp', () => ({ default: () => ({ formatTime: () => '' }) }))
vi.mock('../../version-restore', () => ({ AgentVersionRestore: () => null }))

const successTitle = 'agentV2.agentDetail.configure.publishSuccess.updateTitle'
const dismissLabel = 'agentV2.agentDetail.configure.publishSuccess.dismiss'

async function setup() {
  const queryClient = createTestQueryClient()
  const store = createStore()
  const input = { params: { agent_id: 'agent-1' } }
  queryClient.setQueryData(
    consoleQuery.agent.byAgentId.composer.get.queryKey({ input }),
    zAgentAppComposerResponse.parse({
      active_config_is_published: false,
      active_config_snapshot: null,
      agent: {
        id: 'agent-1',
        name: 'Agent',
        description: '',
        scope: 'roster',
        status: 'active',
        hidden_app_backed: false,
      },
      agent_soul: { schema_version: 1, config_note: '' },
      save_options: ['save_to_current_version'],
      variant: 'agent_app',
    }),
  )
  queryClient.setQueryData(
    consoleQuery.agent.byAgentId.get.queryKey({ input }),
    createAgentFixture({
      access_ready: true,
      enable_site: true,
      site: {
        access_token: 'published-token',
        app_base_url: 'https://apps.example.test',
        icon_url: null,
      },
    }),
  )
  queryClient.setQueryData(
    systemFeaturesQueryOptions().queryKey,
    createSystemFeaturesFixture({ webapp_auth: { enabled: false } }),
  )
  // Only the reference lookup crosses the network in this publication UI test.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ data: [] }))
  let completePublish!: () => void
  const published = new Promise<void>((resolve) => {
    completePublish = resolve
  })
  function Harness() {
    const [isPublishing, setIsPublishing] = useState(false)
    return (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <input aria-label="Other editor" />
          <div className="w-96">
            <AgentConfigurePublishBar
              agentId="agent-1"
              isPublishing={isPublishing}
              onPublish={async () => {
                const draft = store.get(agentComposerDraftAtom)
                setIsPublishing(true)
                await published
                setIsPublishing(false)
                return { kind: 'update', draft }
              }}
            />
          </div>
        </Provider>
      </QueryClientProvider>
    )
  }
  const screen = await render(<Harness />)
  return { screen, completePublish, queryClient }
}

afterEach(() => vi.restoreAllMocks())

it('preserves keyboard focus through loading, publication, and dismissal', async () => {
  // Native tab order, disabled-button focus, and focus-visible require a browser.
  const { screen, completePublish, queryClient } = await setup()
  const editor = screen.getByRole('textbox', { name: 'Other editor' })
  await editor.click()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: /versionHistory$/ })).toHaveFocus()
  await userEvent.tab()
  const publish = screen.getByRole('button', { name: /agentV2.agentDetail.publish/ })
  await expect.element(publish).toHaveFocus()
  const bar = publish.element().closest('[tabindex="-1"]')!
  const liveRegion = bar.querySelector('[role="status"][aria-atomic="true"]')!
  expect(liveRegion.textContent).toBe('')
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('button', { name: /publishing/ })).toHaveFocus()
  completePublish()
  await expect.poll(() => liveRegion.textContent).toBe(successTitle)
  await expect.poll(() => document.activeElement).toBe(bar)
  expect(bar.matches(':focus-visible')).toBe(true)
  expect(bar.querySelector('[role="status"]')).toBe(liveRegion)
  await userEvent.tab()
  const dismiss = screen.getByRole('button', { name: dismissLabel })
  await expect.element(dismiss).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('link', { name: /accessMethods$/ })).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('link', { name: /openWebApp$/ })).toHaveFocus()
  await userEvent.tab({ shift: true })
  await userEvent.tab({ shift: true })
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => document.activeElement).toBe(bar)
  expect(liveRegion.textContent).toBe('')
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: /versionHistory$/ })).toHaveFocus()
  queryClient.clear()
})

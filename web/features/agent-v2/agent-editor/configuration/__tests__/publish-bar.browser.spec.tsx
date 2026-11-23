import { zAgentAppComposerResponse } from '@dify/contracts/api/console/agent/zod.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { createStore, Provider } from 'jotai'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import agentV2 from '@/i18n/locales/en-US/agent-v-2.json'
import billing from '@/i18n/locales/en-US/billing.json'
import common from '@/i18n/locales/en-US/common.json'
import workflowHistory from '@/i18n/locales/en-US/workflow-history.json'
import { consoleQuery } from '@/service/console'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createAgentFixture } from '@/test/fixtures/agent'
import { createAppSiteFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { AgentConfigurePublishBar } from '../publish-bar'

vi.unmock('react-i18next')
// boundary: generated Console transport supplies the referenced-workflow server response.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.referencingWorkflows.get': async () => ({ data: [] }),
    }),
  }
})

const successTitle = 'Changes published'
const dismissLabel = 'Dismiss publish guidance'

async function setup() {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentV2, billing, common, workflowHistory } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
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
      site: createAppSiteFixture({
        access_token: 'published-token',
        app_base_url: 'https://apps.example.test',
      }),
    }),
  )
  queryClient.setQueryData(
    systemFeaturesQueryOptions().queryKey,
    createSystemFeaturesFixture({ webapp_auth: { enabled: false } }),
  )
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
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  )
  return { screen, completePublish, queryClient }
}

afterEach(() => vi.restoreAllMocks())

it('preserves keyboard focus through loading, publication, and dismissal', async () => {
  // Native tab order, disabled-button focus, and focus-visible require a browser.
  const { screen, completePublish, queryClient } = await setup()
  const editor = screen.getByRole('textbox', { name: 'Other editor' })
  await editor.click()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Open version history' })).toHaveFocus()
  await userEvent.tab()
  const publish = screen.getByRole('button', { name: 'Publish', exact: true })
  await expect.element(publish).toHaveFocus()
  const liveRegion = screen.getByRole('status', { name: '', exact: true })
  await expect.element(liveRegion).toHaveTextContent('')
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('button', { name: 'Publishing…' })).toHaveFocus()
  completePublish()
  await expect.element(liveRegion).toHaveTextContent(successTitle)
  await expect.poll(() => document.activeElement?.matches(':focus-visible')).toBe(true)
  await userEvent.tab()
  const dismiss = screen.getByRole('button', { name: dismissLabel })
  await expect.element(dismiss).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('link', { name: 'View all access methods' })).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('link', { name: 'Open Web App' })).toHaveFocus()
  await userEvent.tab({ shift: true })
  await userEvent.tab({ shift: true })
  await userEvent.keyboard('{Enter}')
  await expect.element(liveRegion).toHaveTextContent('')
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Open version history' })).toHaveFocus()
  queryClient.clear()
})

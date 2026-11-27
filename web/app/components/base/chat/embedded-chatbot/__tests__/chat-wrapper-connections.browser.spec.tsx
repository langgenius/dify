import type { ConnectionsState } from '@/app/components/share/connections/use-connections'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { createEmbeddedChatbotContextFixture } from '@/test/fixtures/embedded-chatbot'
import { createTestNavigation } from '@/test/next-navigation'
import { createTestQueryClient } from '@/test/query-client'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
  createChatConnections,
  withChatConnections,
} from '../../chat-with-history/__tests__/connection-fixture'
import ChatWrapper from '../chat-wrapper'
import { EmbeddedChatbotContext } from '../context'

it('shows neutral loading before opening required connection setup in an embedded Chatflow', async () => {
  onTestFinished(guardUnexpectedFetch())
  const { NavigationProvider } = createTestNavigation({
    url: '/chatbot/test-token',
    params: { token: 'test-token' },
  })
  const context = createEmbeddedChatbotContextFixture({
    appData: {
      app_id: 'test-app',
      mode: 'advanced-chat',
      custom_config: null,
      site: { title: 'Repository assistant' },
    },
    appParams: createChatConfigFixture(),
    appMeta: { tool_icons: {} },
  })
  const client = createTestQueryClient()
  const tree = (state: ConnectionsState) => (
    <QueryClientProvider client={client}>
      <NavigationProvider>
        {withChatConnections({
          state,
          children: (
            // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector exposes its own Provider contract.
            <EmbeddedChatbotContext.Provider value={context}>
              <ChatWrapper />
            </EmbeddedChatbotContext.Provider>
          ),
        })}
      </NavigationProvider>
    </QueryClientProvider>
  )
  const state = createChatConnections()
  const screen = await render(tree({ ...state, status: 'loading', canRun: false }))
  const setup = screen.getByRole('button', { name: 'share.connections.setup.startUsingApp' })
  const loading = screen.getByRole('progressbar', { name: 'common.loading' })
  await expect.element(loading).toBeVisible()
  await expect.element(setup).not.toBeInTheDocument()

  await screen.rerender(tree(state))
  await expect.element(setup).toBeEnabled()
  await expect.element(loading).not.toBeInTheDocument()
})

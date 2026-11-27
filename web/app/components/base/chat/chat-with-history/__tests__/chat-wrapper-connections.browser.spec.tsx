import type { ChatWithHistoryContextValue } from '../context'
import type { ConnectionsState } from '@/app/components/share/connections/use-connections'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { InstalledAppConnectionsProvider } from '@/app/components/explore/installed-app/connections/provider'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { TEST_APP_ID } from '@/test/console/ids'
import { apiError, hold, installFakeApi } from '@/test/fake-api'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { createTestNavigation } from '@/test/next-navigation'
import { createTestQueryClient } from '@/test/query-client'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import ChatWrapper from '../chat-wrapper'
import { ChatWithHistoryContext } from '../context'
import {
  createChatAccountEntry,
  createChatConnections,
  withChatConnections,
} from './connection-fixture'

const createHistoryContext = (): ChatWithHistoryContextValue => ({
  appData: {
    app_id: 'test-app',
    mode: 'advanced-chat',
    custom_config: null,
    site: { title: 'Repository assistant' },
  },
  appMeta: { tool_icons: {} },
  appParams: createChatConfigFixture(),
  currentConversationId: 'saved-conversation',
  currentConversationItem: {
    id: 'saved-conversation',
    name: 'Repository research',
    inputs: {},
    introduction: '',
  },
  appPrevChatTree: [],
  newConversationInputs: {},
  newConversationInputsRef: { current: {} },
  inputsForms: [],
  isInstalledApp: false,
  currentChatInstanceRef: { current: { handleStop: vi.fn() } },
  setIsResponding: vi.fn(),
  setClearChatList: vi.fn(),
  conversationList: [],
  sidebarCollapseState: false,
  handleSidebarCollapse: vi.fn(),
  handlePinConversation: vi.fn(),
  handleUnpinConversation: vi.fn(),
  handleDeleteConversation: vi.fn(),
  conversationRenaming: false,
  handleRenameConversation: vi.fn(),
  handleNewConversation: vi.fn(),
  handleNewConversationInputsChange: vi.fn(),
  handleStartChat: (callback) => callback?.(),
  handleChangeConversation: vi.fn(),
  handleNewConversationCompleted: vi.fn(),
  handleFeedback: vi.fn().mockResolvedValue(undefined),
  pinnedConversationList: [],
  chatShouldReloadKey: '',
  isBelowSm: false,
  currentConversationInputs: {},
  setCurrentConversationInputs: vi.fn(),
  allInputsHidden: false,
  appId: 'test-app',
})

it('preserves the chat description when the account introduction is disabled', async () => {
  onTestFinished(guardUnexpectedFetch())
  const { NavigationProvider } = createTestNavigation({
    url: '/chat/test-token',
    params: { token: 'test-token' },
  })
  const title = 'Research assistant'
  const description = 'Find sources for your research.'
  const context: ChatWithHistoryContextValue = {
    ...createHistoryContext(),
    appData: {
      app_id: 'test-app',
      mode: 'advanced-chat',
      custom_config: null,
      site: { title, description },
    },
    currentConversationId: '',
    currentConversationItem: undefined,
  }
  const client = createTestQueryClient()
  const tree = (accountLoginEnabled: boolean) => (
    <QueryClientProvider client={client}>
      <NavigationProvider>
        {withChatConnections({
          entry: createChatAccountEntry(accountLoginEnabled),
          children: (
            // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector exposes its own Provider contract.
            <ChatWithHistoryContext.Provider value={context}>
              <ChatWrapper />
            </ChatWithHistoryContext.Provider>
          ),
        })}
      </NavigationProvider>
    </QueryClientProvider>
  )
  const screen = await render(tree(false))
  const appHeading = screen.getByRole('heading', { name: title })
  const appDescription = screen.getByText(description)
  await expect.element(appDescription).toBeVisible()
  await expect.element(appHeading).not.toBeInTheDocument()

  await screen.rerender(tree(true))
  await expect.element(appHeading).toBeVisible()
  await expect.element(appDescription).toBeVisible()
})

it('lets an installed Chatflow retry loading its settings without opening connection setup', async () => {
  const fake = installFakeApi({
    console: {
      installedApps: {
        byInstalledAppId: {
          parameters: {
            get: () => ({
              annotation_reply: {},
              connection_requirements: [],
              connection_revision: null,
              file_upload: {},
              more_like_this: {},
              requires_end_user_connections: false,
              retriever_resource: {},
              sensitive_word_avoidance: {},
              speech_to_text: {},
              suggested_questions: [],
              suggested_questions_after_answer: {},
              system_parameters: {
                audio_file_size_limit: 10,
                file_size_limit: 10,
                image_file_size_limit: 10,
                video_file_size_limit: 10,
                workflow_file_upload_limit: 10,
              },
              text_to_speech: {},
              user_input_form: [],
            }),
          },
        },
      },
    },
  })
  onTestFinished(fake)
  const request = hold(fake.console.installedApps.byInstalledAppId.parameters.get)
  const { NavigationProvider } = createTestNavigation({
    url: `/explore/installed/${TEST_APP_ID}`,
    params: { appId: TEST_APP_ID },
  })
  const description = 'Find sources for your research.'
  const context: ChatWithHistoryContextValue = {
    ...createHistoryContext(),
    appData: {
      app_id: TEST_APP_ID,
      mode: 'advanced-chat',
      custom_config: null,
      site: { title: 'Installed research assistant', description },
    },
    currentConversationId: '',
    currentConversationItem: undefined,
    isInstalledApp: true,
    appId: TEST_APP_ID,
  }
  const client = createTestQueryClient()
  seedAccountProfileQuery(client)
  const screen = await render(
    <QueryClientProvider client={client}>
      <NavigationProvider>
        <InstalledAppConnectionsProvider installedAppId={TEST_APP_ID}>
          {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector exposes its own Provider contract. */}
          <ChatWithHistoryContext.Provider value={context}>
            <ChatWrapper />
          </ChatWithHistoryContext.Provider>
        </InstalledAppConnectionsProvider>
      </NavigationProvider>
    </QueryClientProvider>,
  )
  await request.arrived
  const title = screen.getByRole('heading', { name: 'share.connections.setup.title' })
  const loading = screen.getByRole('progressbar', { name: 'common.loading' })
  await expect.element(loading).toBeVisible()
  await expect.element(title).not.toBeInTheDocument()

  request.reject(apiError({ status: 500, message: 'Settings unavailable' }))
  await expect.element(screen.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
  await expect.element(title).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'common.operation.retry' }).click()

  await expect.element(screen.getByPlaceholder(/common.chat.inputPlaceholder/)).toBeEnabled()
  await expect.element(screen.getByText(description)).toBeVisible()
  await expect
    .element(screen.getByRole('heading', { name: 'Installed research assistant' }))
    .not.toBeInTheDocument()
  await expect.element(title).not.toBeInTheDocument()
})

it('opens connection configuration from the disabled composer and restores normal input after connections become ready', async () => {
  onTestFinished(guardUnexpectedFetch())
  const { NavigationProvider } = createTestNavigation({
    url: '/chat/test-token',
    params: { token: 'test-token' },
  })
  // Chromium proves pointer hit testing over the native disabled textarea and
  // dialog keyboard activation / focus restoration through the real portal.
  const ready = createChatConnections()
  const missing = createChatConnections({
    canRun: false,
    runConfiguration: null,
    selections: {},
    services: ready.services.map((service) => ({
      ...service,
      selectedConnectionId: undefined,
      availableConnections: [],
    })),
  })
  const context = createHistoryContext()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (state: ConnectionsState) => (
    <QueryClientProvider client={client}>
      {withChatConnections({
        state,
        children: (
          // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector exposes its own Provider contract.
          <ChatWithHistoryContext.Provider value={context}>
            <div className="h-150 w-200">
              <NavigationProvider>
                <ChatWrapper />
              </NavigationProvider>
            </div>
          </ChatWithHistoryContext.Provider>
        ),
      })}
    </QueryClientProvider>
  )
  const screen = await render(tree(missing))
  const input = screen.getByPlaceholder(/common.chat.inputPlaceholder/)
  const configure = screen.getByRole('button', {
    name: 'share.connections.configure.title',
    includeHidden: true,
  })
  await expect.element(input).toBeDisabled()
  await expect.element(configure).toBeVisible()

  const inputBounds = input.element().getBoundingClientRect()
  const triggerBounds = configure.element().getBoundingClientRect()
  await configure.click({
    position: {
      x: inputBounds.x + inputBounds.width / 2 - triggerBounds.x,
      y: inputBounds.y + inputBounds.height / 2 - triggerBounds.y,
    },
  })
  const dialog = page.getByRole('dialog', { name: 'share.connections.configure.title' })
  await expect.element(dialog).toBeVisible()

  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(configure).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog).toBeVisible()

  await screen.rerender(tree(ready))
  await expect.element(input).toBeEnabled()
  await expect.element(configure).not.toBeInTheDocument()
  await expect.element(dialog).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(input).toHaveFocus()
  await input.fill('Find repository examples')
  await expect.element(input).toHaveValue('Find repository examples')
  await expect.element(dialog).not.toBeInTheDocument()
})

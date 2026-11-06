import type { ChatWithHistoryContextValue } from '../context'
import type { ConnectionsState } from '@/app/components/share/connections/use-connections'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import ChatWrapper from '../chat-wrapper'
import { ChatWithHistoryContext } from '../context'
import { createChatConnections, withChatConnections } from './connection-fixture'

const { ssePost, unexpectedFetch } = vi.hoisted(() => ({
  ssePost: vi.fn(),
  unexpectedFetch: vi.fn<typeof fetch>(() => Promise.reject(new Error('Unexpected request'))),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/chat/test-token',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ token: 'test-token' }),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost,
}))

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

beforeEach(() => {
  vi.stubGlobal('fetch', unexpectedFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(unexpectedFetch).not.toHaveBeenCalled()
})

it('opens connection configuration from the disabled composer and restores normal input after connections become ready', async () => {
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
              <ChatWrapper />
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
  expect(ssePost).not.toHaveBeenCalled()

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
  expect(ssePost).not.toHaveBeenCalled()
})

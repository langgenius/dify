import type { InstalledAppResponse } from '@dify/contracts/api/console/installed-apps/types.gen'
import type {
  WebAccountProfileResponse,
  WebSystemFeatureResponse,
} from '@dify/contracts/api/web/types.gen'
import type { ChatWithHistoryContextValue } from '../../context'
import type { ConnectionsState } from '@/app/components/share/connections/use-connections'
import type { WebAppEntryState } from '@/app/components/share/webapp-entry'
import type { AppData } from '@/models/share'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ConnectionsContext } from '@/app/components/share/connections/use-connections'
import { WebAppEntryContext } from '@/app/components/share/webapp-entry'
import { useWebAppStore } from '@/context/web-app-context'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { installFakeApi, route } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../../constants'
import { createChatHistoryTestEnvironment } from '../../__tests__/chat-history-test-env'
import { createChatConnections } from '../../__tests__/connection-fixture'
import { ChatWithHistoryContext } from '../../context'
import Header from '../../header'
import { useChatWithHistory } from '../../hooks'
import Sidebar from '../index'

const conversation = (id: string, name: string) => ({ id, name, inputs: {}, introduction: '' })
const conversations = [
  conversation('1', 'First conversation'),
  conversation('2', 'Second conversation'),
]
const pinnedConversations = [conversation('p1', 'Pinned conversation')]
// Answers the conversation list for the `pinned` query with the given rows.
const conversationLists =
  (pinned: ReturnType<typeof conversation>[], unpinned: ReturnType<typeof conversation>[]) =>
  ({ url }: { url: URL }) => ({
    data: url.searchParams.get('pinned') === 'true' ? pinned : unpinned,
    has_more: false,
    limit: 100,
  })
const customLogo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="blue"/></svg>')}`
const noBranding = { enabled: false, workspace_logo: '' }
const appInfo: AppData = {
  app_id: 'app-1',
  end_user_id: 'user-1',
  site: { title: 'Test App' },
  custom_config: { replace_webapp_logo: customLogo },
}

const profile: WebAccountProfileResponse = {
  email: 'joel@example.com',
  is_password_set: false,
  interface_language: 'en-US',
  interface_theme: 'system',
  timezone: 'UTC',
  name: 'Test Account',
  avatar: null,
  avatar_url: null,
  has_owned_tenant: false,
  has_tenant: false,
}
const webSystemFeatures = {
  ...createSystemFeaturesFixture(),
  console_web_url: 'https://console.example.com/dify',
} satisfies WebSystemFeatureResponse
export function setupSidebarBrowser() {
  let hasTenant = false
  const setHasTenant = (value: boolean) => {
    hasTenant = value
  }

  const success = () => ({ result: 'success' })
  let fake: ReturnType<typeof installFakeApi>
  const conversationsRoute = () => fake.route('GET', 'public', '/conversations')
  const pinRoute = () => fake.route('PATCH', 'public', '/conversations/:id/pin')
  const unpinRoute = () => fake.route('PATCH', 'public', '/conversations/:id/unpin')
  const renameRoute = () => fake.route('POST', 'public', '/conversations/:id/name')
  const deleteRoute = () => fake.route('DELETE', 'public', '/conversations/:id')

  beforeEach(async ({ onTestFinished }) => {
    hasTenant = false
    fake = installFakeApi({
      routes: [
        route('GET', 'public', '/account/profile', () => ({ ...profile, has_tenant: hasTenant })),
        route('GET', 'public', '/system-features', () => webSystemFeatures),
        route('GET', 'public', '/messages', () => ({ data: [] })),
        route(
          'GET',
          'public',
          '/conversations',
          conversationLists(pinnedConversations, conversations),
        ),
        route('PATCH', 'public', '/conversations/:id/pin', success),
        route('PATCH', 'public', '/conversations/:id/unpin', success),
        route('POST', 'public', '/conversations/:id/name', success),
        route('DELETE', 'public', '/conversations/:id', success),
      ],
    })
    onTestFinished(fake)
    const oldUrl = window.location.href
    window.history.replaceState({}, '', '/')
    onTestFinished(() => {
      window.history.replaceState({}, '', oldUrl)
    })
    useWebAppStore.setState(useWebAppStore.getInitialState(), true)
    localStorage.removeItem(CONVERSATION_ID_INFO)
    sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
    localStorage.removeItem('webappSidebarCollapse')
    await page.viewport(900, 700)
  })
  afterEach(() => {
    useWebAppStore.setState(useWebAppStore.getInitialState(), true)
    localStorage.removeItem(CONVERSATION_ID_INFO)
    sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
    localStorage.removeItem('webappSidebarCollapse')
  })

  async function renderSidebar(
    options: Parameters<typeof createChatHistoryTestEnvironment>[0] = {},
    branding = noBranding,
    showCurrentConversation = false,
    entry: WebAppEntryState | null = null,
    connections: ConnectionsState = createChatConnections(),
    installedAppInfo?: InstalledAppResponse,
  ) {
    const { Owner, queryClient } = createChatHistoryTestEnvironment({
      currentConversationId: '1',
      conversations,
      pinnedConversations,
      appInfo,
      ...options,
    })
    const { wrapper: QueryProvider } = createConsoleQueryWrapper({
      queryClient,
      systemFeatures: { branding },
    })
    function InstalledOwner({ children, displayProps }: Parameters<typeof Owner>[0]) {
      const value = useChatWithHistory(installedAppInfo)
      return (
        // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector exposes a Provider component, not a renderable React 19 Context.
        <ChatWithHistoryContext.Provider value={{ ...value, isBelowSm: false, ...displayProps }}>
          {children}
        </ChatWithHistoryContext.Provider>
      )
    }
    const HistoryOwner = installedAppInfo ? InstalledOwner : Owner
    const { NavigationProvider } = createTestNavigation({ url: '/chat/app-1' })
    const view = (displayProps = options.ownerProps) => (
      <NavigationProvider>
        <QueryProvider>
          <HistoryOwner displayProps={displayProps}>
            {showCurrentConversation && (
              <section aria-label="Current conversation">
                <Header />
              </section>
            )}
            <aside
              aria-label="Conversation history"
              style={{ display: 'flex', height: 600, width: 320 }}
            >
              <WebAppEntryContext value={entry}>
                <ConnectionsContext value={connections}>
                  <Sidebar />
                </ConnectionsContext>
              </WebAppEntryContext>
            </aside>
          </HistoryOwner>
        </QueryProvider>
      </NavigationProvider>
    )
    const rendered = await render(view())
    return {
      updateDisplay: (
        props: Pick<Partial<ChatWithHistoryContextValue>, 'isBelowSm' | 'isResponding'>,
      ) => rendered.rerender(view(props)),
    }
  }
  function conversationHistory() {
    return page.getByRole('complementary', { name: 'Conversation history' })
  }
  function currentConversation() {
    return page.getByRole('region', { name: 'Current conversation' })
  }
  function selectedConversation() {
    return JSON.parse(sessionStorage.getItem(TAB_CONVERSATION_ID_INFO)!)['app-1']['user-1']
  }
  async function openOperations(name: string) {
    const row = conversationHistory().getByRole('button', { name })
    await expect.element(row).toBeVisible()
    // Start at the named row; Tab reaches its actual adjacent operation control without DOM traversal.
    row.element().focus()
    await userEvent.tab()
    await expect
      .element(document.activeElement as HTMLElement)
      .toHaveAccessibleName('common.operation.more')
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('menu')).toBeVisible()
  }
  async function operate(name: string, action: 'pin' | 'unpin' | 'rename' | 'delete') {
    await openOperations(name)
    await page.getByRole('menuitem', { name: `explore.sidebar.action.${action}` }).click()
  }

  return {
    appInfo,
    conversationHistory,
    conversationLists,
    conversations,
    conversationsRoute,
    currentConversation,
    customLogo,
    deleteRoute,
    getFakeApi: () => fake,
    noBranding,
    openOperations,
    operate,
    pinnedConversations,
    pinRoute,
    renderSidebar,
    renameRoute,
    selectedConversation,
    setHasTenant,
    unpinRoute,
  }
}

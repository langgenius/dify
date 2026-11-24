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
import share from '@/i18n/locales/en-US/share.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createDeferred } from '@/test/deferred'
import { installFakeApi, route } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../../constants'
import { createChatHistoryTestEnvironment } from '../../__tests__/chat-history-test-env'
import { chatConnectionEntry, createChatConnections } from '../../__tests__/connection-fixture'
import { ChatWithHistoryContext } from '../../context'
import Header from '../../header'
import { useChatWithHistory } from '../../hooks'
import Sidebar from '../index'

// boundary: use the actual warning copy to verify readable wrapping in the narrow sidebar.
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: messages } = await import('@/i18n/locales/en-US/share.json')
  return createReactI18nextMock({
    'share.auth.unofficialAppWarning': messages['auth.unofficialAppWarning'],
  })
})

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
const workspaceLogo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="20"><rect width="60" height="20" fill="red"/></svg>')}`
const noBranding = { enabled: false, workspace_logo: '' }
const appInfo: AppData = {
  app_id: 'app-1',
  end_user_id: 'user-1',
  site: { title: 'Test App' },
  custom_config: { replace_webapp_logo: customLogo },
}

const buildAppLabel = 'app.endUser.buildYourOwnApp'
const unofficialAppWarning = share['auth.unofficialAppWarning']
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
let hasTenant = false

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

function anonymousEntry(allowAnonymous = false): WebAppEntryState {
  if (!('parameters' in chatConnectionEntry)) throw new Error('Connection entry required')
  return {
    ...chatConnectionEntry,
    account: 'anonymous',
    showSignIn: true,
    parameters: {
      ...chatConnectionEntry.parameters,
      allow_anonymous_end_user_auth: allowAnonymous,
    },
  }
}

it.each([
  { hasTenant: true, destination: 'https://console.example.com/dify/' },
  { hasTenant: false, destination: 'https://console.example.com/dify/create-workspace' },
])('offers $destination above the authenticated account avatar', async (scenario) => {
  hasTenant = scenario.hasTenant
  await renderSidebar({}, noBranding, false, chatConnectionEntry)
  const link = conversationHistory().getByRole('link', { name: buildAppLabel })
  const avatar = conversationHistory().getByRole('button', { name: 'Test Account' })
  await expect.element(link).toBeVisible()
  await expect.element(link).toHaveAttribute('href', scenario.destination)
  await expect.element(link).toHaveAttribute('target', '_blank')
  await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect.element(avatar).toBeVisible()
  await expect.element(conversationHistory().getByText(unofficialAppWarning)).toBeVisible()
  expect(link.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
    avatar.element().getBoundingClientRect().top,
  )
})

it('keeps the connection warning readable below history and above the account footer', async () => {
  await renderSidebar({}, noBranding, false, chatConnectionEntry)
  const warning = conversationHistory().getByRole('note')
  const text = warning.getByText(unofficialAppWarning)
  await expect.element(text).toBeVisible()
  const footer = conversationHistory().getByRole('button', { name: 'Test Account' })
  await expect.element(footer).toBeVisible()
  const textElement = text.element()
  expect(textElement.scrollWidth).toBeLessThanOrEqual(textElement.clientWidth)
  expect(textElement.scrollHeight).toBeLessThanOrEqual(textElement.clientHeight)
  const warningRect = warning.element().getBoundingClientRect()
  const sidebarRect = conversationHistory().element().getBoundingClientRect()
  expect(warningRect.left).toBeGreaterThanOrEqual(sidebarRect.left)
  expect(warningRect.right).toBeLessThanOrEqual(sidebarRect.right)
  expect(warningRect.bottom).toBeLessThanOrEqual(footer.element().getBoundingClientRect().top)
})

it('hides the connection warning when the Webapp has no connection requirements', async () => {
  if (!('parameters' in chatConnectionEntry)) throw new Error('Connection entry required')
  await renderSidebar({}, noBranding, false, {
    ...chatConnectionEntry,
    status: 'ready',
    canRun: true,
    parameters: {
      ...chatConnectionEntry.parameters,
      requires_end_user_connections: false,
      connection_requirements: [],
    },
  })
  await expect.element(page.getByRole('button', { name: 'Test Account' })).toBeVisible()
  await expect.element(page.getByText(unofficialAppWarning)).not.toBeInTheDocument()
})

it('keeps the build link, connection warning and public Console discovery out of installed apps', async () => {
  await renderSidebar({}, noBranding, false, chatConnectionEntry, createChatConnections(), {
    id: 'app-1',
    app_owner_tenant_id: 'tenant-1',
    editable: true,
    is_pinned: false,
    last_used_at: null,
    app: {
      id: 'source-app-1',
      name: 'Installed App',
      description: '',
      mode: 'chat',
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#ffffff',
      icon_url: null,
      use_icon_as_answer_icon: false,
    },
  })
  await expect.element(page.getByRole('button', { name: 'Test Account' })).toBeVisible()
  await expect.element(page.getByRole('link', { name: buildAppLabel })).not.toBeInTheDocument()
  await expect.element(page.getByText(unofficialAppWarning)).not.toBeInTheDocument()
  expect(fake.route('GET', 'public', '/system-features')).not.toHaveBeenCalled()
})

it.each([false, true])(
  'places My apps before application information in the narrow=%s sidebar',
  async (isBelowSm) => {
    await page.viewport(isBelowSm ? 390 : 900, 700)
    await renderSidebar(
      { sidebarCollapsed: false, ownerProps: { isBelowSm } },
      noBranding,
      false,
      chatConnectionEntry,
    )
    const navigation = page.getByRole('link', { name: 'app.endUser.myApps' })
    await expect.element(navigation).toBeVisible()
    await expect.element(navigation).toHaveAttribute('href', '/my-apps')
    const appTitle = conversationHistory().getByText('Test App')
    await expect.element(appTitle).toBeVisible()
    expect(navigation.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      appTitle.element().getBoundingClientRect().top,
    )
    await expect.element(page.getByRole('button', { name: 'Test Account' })).toBeVisible()
  },
)

it('offers sign-in instead of the footer menu and blocks new chat while personal connections require login', async () => {
  const connections = createChatConnections()
  await renderSidebar(
    { currentConversationId: '1', conversations: [], pinnedConversations: [] },
    noBranding,
    false,
    anonymousEntry(),
    createChatConnections({
      status: 'sign-in-required',
      canRun: false,
      selections: {},
      services: connections.services.map((service) => ({
        ...service,
        selectedConnectionId: undefined,
        availableConnections: [],
      })),
      runConfiguration: null,
      preflight: { ...connections.preflight, status: 'pending', response: null },
    }),
  )
  await expect.element(page.getByRole('button', { name: 'share.chat.newChat' })).toBeDisabled()
  await expect.element(page.getByRole('button', { name: 'share.auth.signIn' })).toBeVisible()
  await expect.element(conversationHistory().getByText(unofficialAppWarning)).toBeVisible()
  await expect
    .element(page.getByRole('link', { name: 'app.endUser.myApps' }))
    .not.toBeInTheDocument()
  await expect.element(page.getByRole('link', { name: buildAppLabel })).not.toBeInTheDocument()
  expect(fake.route('GET', 'public', '/account/profile')).not.toHaveBeenCalled()
  expect(fake.route('GET', 'public', '/system-features')).not.toHaveBeenCalled()
  await expect
    .element(page.getByRole('button', { name: 'common.operation.more' }))
    .not.toBeInTheDocument()
  await expect.element(page.getByText('share.chat.emptyConversation')).toBeVisible()
  expect(selectedConversation()).toBe('1')
})

it('keeps new chat available for an anonymous user allowed to configure connections', async () => {
  await renderSidebar(
    { currentConversationId: '1', conversations: [], pinnedConversations: [] },
    noBranding,
    false,
    anonymousEntry(true),
  )
  const start = page.getByRole('button', { name: 'share.chat.newChat' })
  await expect.element(start).toBeEnabled()
  await start.click()
  expect(selectedConversation()).toBe('')
})

it('selects conversations from both lists and persists the visible result', async () => {
  await renderSidebar({}, noBranding, true)
  await expect.element(page.getByText('share.chat.pinnedTitle')).toBeVisible()
  await expect.element(page.getByText('share.chat.unpinnedTitle')).toBeVisible()
  await conversationHistory().getByRole('button', { name: 'Second conversation' }).click()
  await expect
    .element(currentConversation().getByRole('button', { name: 'Second conversation' }))
    .toBeVisible()
  expect(selectedConversation()).toBe('2')
  await conversationHistory().getByRole('button', { name: 'Pinned conversation' }).click()
  await expect
    .element(currentConversation().getByRole('button', { name: 'Pinned conversation' }))
    .toBeVisible()
  expect(selectedConversation()).toBe('p1')
})

it('applies pin changes without changing the selected conversation', async () => {
  await renderSidebar({ currentConversationId: 'p1' }, noBranding, true)
  await expect
    .element(currentConversation().getByRole('button', { name: 'Pinned conversation' }))
    .toBeVisible()
  conversationsRoute().mockImplementation(
    conversationLists([...pinnedConversations, conversations[0]!], [conversations[1]!]),
  )
  await operate('First conversation', 'pin')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await expect
    .poll(pinRoute)
    .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ params: { id: '1' } }))
  // Wait for the refreshed lists so the row is not moved while its operations are opened.
  await expect
    .poll(() => conversationHistory().element().textContent)
    .toMatch(/pinnedTitle.*Pinned conversation.*First conversation.*unpinnedTitle.*Second/)
  await openOperations('First conversation')
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.unpin' }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  conversationsRoute().mockImplementation(
    conversationLists([conversations[0]!], [conversations[1]!, ...pinnedConversations]),
  )
  await operate('Pinned conversation', 'unpin')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await expect
    .poll(unpinRoute)
    .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ params: { id: 'p1' } }))
  await expect
    .poll(() => conversationHistory().element().textContent)
    .toMatch(/pinnedTitle.*First conversation.*unpinnedTitle.*Second.*Pinned conversation/)
  await openOperations('Pinned conversation')
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await expect
    .element(currentConversation().getByRole('button', { name: 'Pinned conversation' }))
    .toBeVisible()
  expect(selectedConversation()).toBe('p1')
})

it('enables a new conversation after the caller finishes generating a response', async () => {
  const view = await renderSidebar(
    {
      ownerProps: { isResponding: true },
      conversations: [],
      pinnedConversations: [],
    },
    noBranding,
    true,
  )
  const newChat = page.getByRole('button', { name: 'share.chat.newChat' })
  await expect.element(newChat).toBeDisabled()
  expect(selectedConversation()).toBe('1')
  await expect.element(page.getByText('share.chat.pinnedTitle')).not.toBeInTheDocument()
  await expect.element(page.getByText('share.chat.unpinnedTitle')).not.toBeInTheDocument()
  await view.updateDisplay({ isResponding: false })
  await expect.element(newChat).toBeEnabled()
  await newChat.click()
  await expect
    .element(conversationHistory().getByRole('button', { name: 'share.chat.newChatDefaultName' }))
    .toBeVisible()
  await expect.element(currentConversation().getByText('Test App')).toBeVisible()
  expect(selectedConversation()).toBe('')
})

it('persists desktop collapse and expansion through the live owner', async () => {
  await renderSidebar({ sidebarCollapsed: false })
  await page.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }).click()
  const expand = page.getByRole('button', { name: 'layout.sidebar.expandSidebar' })
  await expect.element(expand).toBeVisible()
  expect(localStorage.getItem('webappSidebarCollapse')).toBe('collapsed')
  await expand.click()
  await expect
    .element(page.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }))
    .toBeVisible()
  expect(localStorage.getItem('webappSidebarCollapse')).toBe('expanded')
})

it('keeps desktop collapse actions out of the mobile sidebar', async () => {
  await page.viewport(390, 700)
  await renderSidebar({ ownerProps: { isBelowSm: true } })
  await expect
    .element(page.getByRole('button', { name: /layout.sidebar.(expand|collapse)Sidebar/ }))
    .not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'share.chat.newChat' })).toBeVisible()
})

it('keeps the chosen conversation until deletion succeeds, then removes its dialog and row', async () => {
  const pending = createDeferred<unknown>()
  deleteRoute().mockReturnValueOnce(pending.promise)
  await renderSidebar({ currentConversationId: '2' }, noBranding, true)
  await expect
    .element(currentConversation().getByRole('button', { name: 'Second conversation' }))
    .toBeVisible()
  await operate('Second conversation', 'delete')
  const dialog = page.getByRole('alertdialog', { name: 'share.chat.deleteConversation.title' })
  await expect.element(dialog).toBeVisible()
  expect(deleteRoute()).not.toHaveBeenCalled()
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect
    .poll(deleteRoute)
    .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ params: { id: '2' } }))
  await expect.element(dialog).toBeVisible()
  expect(selectedConversation()).toBe('2')
  conversationsRoute().mockImplementation(
    conversationLists(pinnedConversations, [conversations[0]!]),
  )
  pending.resolve({ result: 'success' })
  await expect.element(dialog).not.toBeInTheDocument()
  await expect
    .element(conversationHistory().getByRole('button', { name: 'Second conversation' }))
    .not.toBeInTheDocument()
  await expect
    .element(conversationHistory().getByRole('button', { name: 'share.chat.newChatDefaultName' }))
    .toBeVisible()
  await expect.element(currentConversation().getByText('Test App')).toBeVisible()
  expect(selectedConversation()).toBe('')
})

it('cancels deletion without changing the conversation', async () => {
  await renderSidebar({}, noBranding, true)
  await operate('First conversation', 'delete')
  const dialog = page.getByRole('alertdialog', { name: 'share.chat.deleteConversation.title' })
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(deleteRoute()).not.toHaveBeenCalled()
  await expect
    .element(currentConversation().getByRole('button', { name: 'First conversation' }))
    .toBeVisible()
  await expect
    .element(conversationHistory().getByRole('button', { name: 'First conversation' }))
    .toBeVisible()
  expect(selectedConversation()).toBe('1')
})

it('submits the chosen conversation name and blocks native Enter and click resubmission until saved', async () => {
  const pending = createDeferred<unknown>()
  renameRoute().mockReturnValueOnce(pending.promise)
  await renderSidebar({}, noBranding, true)
  await operate('Second conversation', 'rename')
  const input = page.getByRole('textbox', { name: 'common.chat.conversationName' })
  await expect.element(input).toHaveValue('Second conversation')
  await expect.element(input).toHaveFocus()
  await input.fill('New name')
  await userEvent.keyboard('{Enter}')
  await expect.poll(renameRoute).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      params: { id: '2' },
      body: expect.objectContaining({ name: 'New name' }),
    }),
  )
  const save = page.getByRole('button', { name: 'common.operation.save' })
  await expect.element(save).toHaveAttribute('aria-disabled', 'true')
  await userEvent.tab()
  await userEvent.tab()
  await expect.element(save).toHaveFocus()
  await userEvent.keyboard(' ')
  await input.click()
  await userEvent.keyboard('{Enter}')
  expect(renameRoute()).toHaveBeenCalledTimes(1)
  pending.resolve({ result: 'success' })
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'New name' })).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: 'Second conversation' }))
    .not.toBeInTheDocument()
  await expect
    .element(currentConversation().getByRole('button', { name: 'First conversation' }))
    .toBeVisible()
  await expect
    .element(conversationHistory().getByRole('button', { name: 'First conversation' }))
    .toBeVisible()
  expect(selectedConversation()).toBe('1')
})

it('discards a cancelled rename before opening another conversation', async () => {
  await renderSidebar()
  await operate('First conversation', 'rename')
  const input = page.getByRole('textbox', { name: 'common.chat.conversationName' })
  await input.fill('First conversation unsaved')
  await page.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await operate('Second conversation', 'rename')
  await expect.element(input).toHaveValue('Second conversation')
  await expect.element(input).toHaveFocus()
  expect(renameRoute()).not.toHaveBeenCalled()
})

it.each([
  { enabled: false, workspace_logo: '', expected: customLogo },
  { enabled: true, workspace_logo: workspaceLogo, expected: workspaceLogo },
  { enabled: true, workspace_logo: '', expected: customLogo },
])(
  'loads the effective branding image for $enabled / $workspace_logo',
  async ({ expected, ...branding }) => {
    await renderSidebar({}, branding)
    const logo = page.getByRole('img', { name: 'logo' })
    await expect.element(logo).toHaveAttribute('src', expected)
    await expect.poll(() => (logo.element() as HTMLImageElement).naturalWidth).toBeGreaterThan(0)
    await expect.element(logo).toBeVisible()
  },
)

it('removes branding when the application disables it', async () => {
  await renderSidebar(
    { appInfo: { ...appInfo, custom_config: { remove_webapp_brand: true } } },
    { enabled: true, workspace_logo: workspaceLogo },
  )
  await expect.element(page.getByRole('button', { name: 'share.chat.newChat' })).toBeVisible()
  await expect.element(page.getByText('share.chat.poweredBy')).not.toBeInTheDocument()
  await expect.element(page.getByRole('img', { name: 'logo' })).not.toBeInTheDocument()
})

import type { InstalledAppResponse } from '@dify/contracts/api/console/installed-apps/types.gen'
import type {
  WebAccountProfileResponse,
  WebSystemFeatureResponse,
} from '@dify/contracts/api/web/types.gen'
import type { WebAppEntryState } from '@/app/components/share/webapp-entry'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { useWebAppStore } from '@/context/web-app-context'
import share from '@/i18n/locales/en-US/share.json'
import { fetchChatList, fetchConversations } from '@/service/share'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../../constants'
import {
  conversation,
  createChatHistoryTestEnvironment,
} from '../../__tests__/chat-history-test-env'
import {
  chatConnectionEntry,
  withChatConnections as ChatConnections,
  createChatConnections,
} from '../../__tests__/connection-fixture'
import { ChatWithHistoryContext } from '../../context'
import { useChatWithHistory } from '../../hooks'
import Sidebar from '../index'

// boundary: supply history responses while keeping sidebar rendering and query state real.
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchChatList: vi.fn(),
  fetchConversations: vi.fn(),
}))
// boundary: Browser Mode does not provide the application's Next.js router.
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/chat/app-1',
  useSearchParams: () => new URLSearchParams(),
}))
// boundary: use the actual warning copy to verify readable wrapping in the narrow sidebar.
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: messages } = await import('@/i18n/locales/en-US/share.json')
  return createReactI18nextMock({
    'share.auth.unofficialAppWarning': messages['auth.unofficialAppWarning'],
  })
})

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

beforeEach(({ onTestFinished }) => {
  const oldUrl = window.location.href
  onTestFinished(() => {
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', oldUrl)
    useWebAppStore.setState(useWebAppStore.getInitialState(), true)
    localStorage.removeItem(CONVERSATION_ID_INFO)
    sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
    localStorage.removeItem('webappSidebarCollapse')
  })
  vi.mocked(fetchChatList).mockResolvedValue({ data: [] })
})

async function renderSidebar({
  hasTenant = false,
  isBelowSm = false,
  app,
  entry = chatConnectionEntry,
  connections = createChatConnections(),
  conversations = [conversation],
}: {
  hasTenant?: boolean
  isBelowSm?: boolean
  app?: InstalledAppResponse
  entry?: WebAppEntryState
  connections?: ReturnType<typeof createChatConnections>
  conversations?: (typeof conversation)[]
} = {}) {
  const requests: string[] = []
  // boundary: exercise the generated Webapp client with deterministic account and discovery responses.
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(new Request(input, init).url).pathname
      requests.push(path)
      if (path === '/api/account/profile')
        return Response.json({ ...profile, has_tenant: hasTenant })
      if (path === '/api/system-features') return Response.json(webSystemFeatures)
      throw new Error(`Unexpected request: ${path}`)
    }),
  )
  vi.mocked(fetchConversations).mockImplementation(async (_source, _app, _last, pinned) => ({
    data: pinned ? [] : conversations,
    has_more: false,
    limit: 100,
  }))
  const { Owner, queryClient } = createChatHistoryTestEnvironment({
    conversations,
    sidebarCollapsed: false,
    ownerProps: { isBelowSm },
  })
  const { wrapper: QueryProvider } = createConsoleQueryWrapper({ queryClient })
  function InstalledOwner({ children }: Parameters<typeof Owner>[0]) {
    const value = useChatWithHistory(app)
    return (
      // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector exposes a Provider component rather than a renderable Context.
      <ChatWithHistoryContext.Provider value={{ ...value, isBelowSm }}>
        {children}
      </ChatWithHistoryContext.Provider>
    )
  }
  const HistoryOwner = app ? InstalledOwner : Owner
  await page.viewport(isBelowSm ? 390 : 900, 700)
  await render(
    <QueryProvider>
      <HistoryOwner>
        <aside
          aria-label="Conversation history"
          style={{ display: 'flex', height: 600, width: 320 }}
        >
          <ChatConnections state={connections} entry={entry}>
            <Sidebar />
          </ChatConnections>
        </aside>
      </HistoryOwner>
    </QueryProvider>,
  )
  return { sidebar: page.getByRole('complementary', { name: 'Conversation history' }), requests }
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
])(
  'offers $destination above the authenticated account avatar',
  async ({ hasTenant, destination }) => {
    const { sidebar } = await renderSidebar({ hasTenant })
    const link = sidebar.getByRole('link', { name: buildAppLabel })
    const avatar = sidebar.getByRole('button', { name: 'Test Account' })
    await expect.element(link).toBeVisible()
    await expect.element(link).toHaveAttribute('href', destination)
    await expect.element(link).toHaveAttribute('target', '_blank')
    await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect.element(avatar).toBeVisible()
    expect(link.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      avatar.element().getBoundingClientRect().top,
    )
  },
)

it('keeps the connection warning readable below history and above the account footer', async () => {
  const { sidebar } = await renderSidebar()
  const warning = sidebar.getByRole('note')
  const text = warning.getByText(unofficialAppWarning)
  const historyRow = sidebar.getByRole('button', { name: conversation.name })
  const footer = sidebar.getByRole('button', { name: 'Test Account' })
  await expect.element(text).toBeVisible()
  await expect.element(historyRow).toBeVisible()
  await expect.element(footer).toBeVisible()
  const textElement = text.element()
  expect(textElement.scrollWidth).toBeLessThanOrEqual(textElement.clientWidth)
  expect(textElement.scrollHeight).toBeLessThanOrEqual(textElement.clientHeight)
  const warningRect = warning.element().getBoundingClientRect()
  const sidebarRect = sidebar.element().getBoundingClientRect()
  expect(warningRect.left).toBeGreaterThanOrEqual(sidebarRect.left)
  expect(warningRect.right).toBeLessThanOrEqual(sidebarRect.right)
  expect(warningRect.top).toBeGreaterThanOrEqual(
    historyRow.element().getBoundingClientRect().bottom,
  )
  expect(warningRect.bottom).toBeLessThanOrEqual(footer.element().getBoundingClientRect().top)
})

it('hides the connection warning when the Webapp has no connection requirements', async () => {
  if (!('parameters' in chatConnectionEntry)) throw new Error('Connection entry required')
  const { sidebar } = await renderSidebar({
    entry: {
      ...chatConnectionEntry,
      status: 'ready',
      canRun: true,
      parameters: {
        ...chatConnectionEntry.parameters,
        requires_end_user_connections: false,
        connection_requirements: [],
      },
    },
  })
  await expect.element(sidebar.getByRole('button', { name: 'Test Account' })).toBeVisible()
  await expect.element(sidebar.getByText(unofficialAppWarning)).not.toBeInTheDocument()
})

it('keeps the build link, connection warning and public Console discovery out of installed apps', async () => {
  const { sidebar, requests } = await renderSidebar({
    app: {
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
    },
  })
  await expect.element(sidebar.getByRole('button', { name: 'Test Account' })).toBeVisible()
  await expect.element(sidebar.getByRole('link', { name: buildAppLabel })).not.toBeInTheDocument()
  await expect.element(sidebar.getByText(unofficialAppWarning)).not.toBeInTheDocument()
  expect(requests).not.toContain('/api/system-features')
})

it.each([false, true])(
  'places My apps before application information in the narrow=%s sidebar',
  async (isBelowSm) => {
    const { sidebar } = await renderSidebar({ isBelowSm })
    const navigation = sidebar.getByRole('link', { name: 'app.endUser.myApps' })
    await expect.element(navigation).toBeVisible()
    await expect.element(navigation).toHaveAttribute('href', '/my-apps')
    const appTitle = sidebar.getByText('Test Chat')
    await expect.element(appTitle).toBeVisible()
    expect(navigation.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      appTitle.element().getBoundingClientRect().top,
    )
    await expect.element(sidebar.getByRole('button', { name: 'Test Account' })).toBeVisible()
  },
)

it('offers sign-in instead of the footer menu and blocks new chat while personal connections require login', async () => {
  const connections = createChatConnections()
  const { sidebar, requests } = await renderSidebar({
    conversations: [],
    entry: anonymousEntry(),
    connections: createChatConnections({
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
  })
  await expect.element(sidebar.getByRole('button', { name: 'share.chat.newChat' })).toBeDisabled()
  await expect.element(sidebar.getByRole('button', { name: 'share.auth.signIn' })).toBeVisible()
  await expect.element(sidebar.getByText(unofficialAppWarning)).toBeVisible()
  await expect
    .element(sidebar.getByRole('link', { name: 'app.endUser.myApps' }))
    .not.toBeInTheDocument()
  await expect.element(sidebar.getByRole('link', { name: buildAppLabel })).not.toBeInTheDocument()
  expect(requests).toEqual([])
  await expect
    .element(sidebar.getByRole('button', { name: 'common.operation.more' }))
    .not.toBeInTheDocument()
  await expect.element(sidebar.getByText('share.chat.emptyConversation')).toBeVisible()
})

it('keeps new chat available for an anonymous user allowed to configure connections', async () => {
  const { sidebar } = await renderSidebar({ entry: anonymousEntry(true), conversations: [] })
  const start = sidebar.getByRole('button', { name: 'share.chat.newChat' })
  await expect.element(start).toBeEnabled()
  await start.click()
  expect(JSON.parse(sessionStorage.getItem(TAB_CONVERSATION_ID_INFO)!)['app-1']['user-1']).toBe('')
})

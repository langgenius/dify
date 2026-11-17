import type { WebSystemFeatureResponse } from '@dify/contracts/api/web/types.gen'
import type { WebAppEntryState } from '@/app/components/share/webapp-entry'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ConnectionsContext } from '@/app/components/share/connections/use-connections'
import { WebAppEntryContext } from '@/app/components/share/webapp-entry'
import { fetchChatList, fetchConversations } from '@/service/share'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createWebAccountProfile } from '@/test/webapp-account-profile'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../../constants'
import { createChatHistoryTestEnvironment } from '../../__tests__/chat-history-test-env'
import { chatConnectionEntry, createChatConnections } from '../../__tests__/connection-fixture'
import Sidebar from '../index'

// boundary: conversation requests are external; retain the real history state owner.
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchChatList: vi.fn(),
  fetchConversations: vi.fn(),
}))
// boundary: Browser Mode does not provide the application's Next router.
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/chat/app-1',
  useSearchParams: () => new URLSearchParams(),
}))

beforeEach(() => {
  vi.mocked(fetchChatList).mockResolvedValue({ data: [] })
  vi.mocked(fetchConversations).mockResolvedValue({ data: [], has_more: false, limit: 100 })
  // boundary: the real account menu loads its profile through the Web API.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (new URL(url).pathname.endsWith('/account/profile'))
      return Response.json(createWebAccountProfile({ name: 'Test Account' }))
    if (new URL(url).pathname.endsWith('/system-features'))
      return Response.json({
        ...createSystemFeaturesFixture(),
        console_web_url: 'https://console.example.com/dify',
        account_login_url: 'https://console.example.com/dify/signin',
      } satisfies WebSystemFeatureResponse)
    throw new Error(`Unexpected request: ${url}`)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(CONVERSATION_ID_INFO)
  sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
  localStorage.removeItem('webappSidebarCollapse')
})

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

async function setup({ anonymous = false, allowAnonymous = false, narrow = false } = {}) {
  await page.viewport(narrow ? 320 : 900, 700)
  const { Owner, queryClient } = createChatHistoryTestEnvironment({
    currentConversationId: '1',
    conversations: [],
    pinnedConversations: [],
    sidebarCollapsed: false,
    ownerProps: { isBelowSm: narrow },
  })
  onTestFinished(() => queryClient.clear())
  const { wrapper: QueryProvider } = createConsoleQueryWrapper({ queryClient })
  return render(
    <QueryProvider>
      <Owner>
        <WebAppEntryContext
          value={anonymous ? anonymousEntry(allowAnonymous) : chatConnectionEntry}
        >
          <ConnectionsContext
            value={createChatConnections({
              status: anonymous && !allowAnonymous ? 'sign-in-required' : 'ready',
              canRun: !anonymous || allowAnonymous,
            })}
          >
            <aside aria-label="Conversation history" className="flex h-150 w-80">
              <Sidebar />
            </aside>
          </ConnectionsContext>
        </WebAppEntryContext>
      </Owner>
    </QueryProvider>,
  )
}

it.each([false, true])(
  'places My apps before application information when narrow=%s',
  async (narrow) => {
    const screen = await setup({ narrow })
    const link = screen.getByRole('link', { name: 'app.endUser.myApps' })
    await expect.element(link).toBeVisible()
    await expect.element(link).toHaveAttribute('href', '/my-apps')
    const information = screen.getByText('Test Chat', { exact: true })
    await expect.element(information).toBeVisible()
    expect(
      link.element().compareDocumentPosition(information.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await expect.element(screen.getByRole('button', { name: 'Test Account' })).toBeVisible()
  },
)

it('offers sign-in and blocks a new chat while personal connections require login', async () => {
  const screen = await setup({ anonymous: true })
  await expect.element(screen.getByRole('button', { name: 'share.chat.newChat' })).toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'share.auth.signIn' })).toBeVisible()
  await expect
    .element(screen.getByRole('link', { name: 'app.endUser.myApps' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'common.operation.more' }))
    .not.toBeInTheDocument()
})

it('allows a new chat when anonymous users can configure connections', async () => {
  const screen = await setup({ anonymous: true, allowAnonymous: true })
  const start = screen.getByRole('button', { name: 'share.chat.newChat' })
  await expect.element(start).toBeEnabled()
  await start.click()
  expect(JSON.parse(sessionStorage.getItem(TAB_CONVERSATION_ID_INFO)!)['app-1']['user-1']).toBe('')
})

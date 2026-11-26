import type { WebAppEntryState } from '@/app/components/share/webapp-entry'
import { page } from 'vite-plus/test/browser'
import share from '@/i18n/locales/en-US/share.json'
import { TEST_APP_ID } from '@/test/console/ids'
import { chatConnectionEntry, createChatConnections } from '../../__tests__/connection-fixture'
import { setupSidebarBrowser } from './sidebar-browser-fixture'

// boundary: use the actual warning copy to verify readable wrapping in the narrow sidebar.
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: messages } = await import('@/i18n/locales/en-US/share.json')
  return createReactI18nextMock({
    'share.auth.unofficialAppWarning': messages['auth.unofficialAppWarning'],
  })
})

const {
  appInfo,
  conversationHistory,
  customLogo,
  getFakeApi,
  noBranding,
  renderSidebar,
  selectedConversation,
  setHasTenant,
} = setupSidebarBrowser()
const workspaceLogo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="20"><rect width="60" height="20" fill="red"/></svg>')}`
const buildAppLabel = 'app.endUser.buildYourOwnApp'
const unofficialAppWarning = share['auth.unofficialAppWarning']

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
  setHasTenant(scenario.hasTenant)
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
  getFakeApi().use({
    console: {
      installedApps: {
        byInstalledAppId: {
          conversations: { get: () => ({ data: [], has_more: false, limit: 100 }) },
        },
      },
    },
  })
  await renderSidebar({}, noBranding, false, chatConnectionEntry, createChatConnections(), {
    id: TEST_APP_ID,
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
  expect(getFakeApi().route('GET', 'public', '/system-features')).not.toHaveBeenCalled()
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
  expect(getFakeApi().route('GET', 'public', '/account/profile')).not.toHaveBeenCalled()
  expect(getFakeApi().route('GET', 'public', '/system-features')).not.toHaveBeenCalled()
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

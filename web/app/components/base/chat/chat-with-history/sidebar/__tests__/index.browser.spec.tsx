import type { ChatWithHistoryContextValue } from '../../context'
import type { AppData } from '@/models/share'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { useWebAppStore } from '@/context/web-app-context'
import {
  AppSourceType,
  delConversation,
  fetchChatList,
  fetchConversations,
  pinConversation,
  renameConversation,
  unpinConversation,
} from '@/service/share'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../../constants'
import { createChatHistoryTestEnvironment } from '../../__tests__/chat-history-test-env'
import Header from '../../header'
import Sidebar from '../index'

// boundary: share requests are the network boundary; the query and feature owners stay real.
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchChatList: vi.fn(),
  fetchConversations: vi.fn(),
  pinConversation: vi.fn(),
  unpinConversation: vi.fn(),
  renameConversation: vi.fn(),
  delConversation: vi.fn(),
}))
// boundary: Browser Mode does not provide the application's Next.js router.
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/chat/app-1',
}))

const conversation = (id: string, name: string) => ({ id, name, inputs: {}, introduction: '' })
const conversations = [
  conversation('1', 'First conversation'),
  conversation('2', 'Second conversation'),
]
const pinnedConversations = [conversation('p1', 'Pinned conversation')]
const customLogo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="blue"/></svg>')}`
const workspaceLogo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="20"><rect width="60" height="20" fill="red"/></svg>')}`
const noBranding = { enabled: false, workspace_logo: '' }
const appInfo: AppData = {
  app_id: 'app-1',
  end_user_id: 'user-1',
  site: { title: 'Test App' },
  custom_config: { replace_webapp_logo: customLogo },
}

beforeEach(async ({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  const oldUrl = window.location.href
  window.history.replaceState({}, '', '/')
  onTestFinished(() => {
    window.history.replaceState({}, '', oldUrl)
  })
  useWebAppStore.setState(useWebAppStore.getInitialState(), true)
  localStorage.removeItem(CONVERSATION_ID_INFO)
  sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
  localStorage.removeItem('webappSidebarCollapse')
  vi.mocked(fetchChatList).mockResolvedValue({ data: [] })
  vi.mocked(fetchConversations).mockImplementation(async (_source, _app, _last, pinned) => ({
    data: pinned ? pinnedConversations : conversations,
    has_more: false,
    limit: 100,
  }))
  vi.mocked(pinConversation).mockResolvedValue(undefined)
  vi.mocked(unpinConversation).mockResolvedValue(undefined)
  vi.mocked(renameConversation).mockResolvedValue(undefined)
  vi.mocked(delConversation).mockResolvedValue(undefined)
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
  const view = (displayProps = options.ownerProps) => (
    <QueryProvider>
      <Owner displayProps={displayProps}>
        {showCurrentConversation && (
          <section aria-label="Current conversation">
            <Header />
          </section>
        )}
        <aside
          aria-label="Conversation history"
          style={{ display: 'flex', height: 600, width: 320 }}
        >
          <Sidebar />
        </aside>
      </Owner>
    </QueryProvider>
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
  vi.mocked(fetchConversations).mockImplementation(async (_source, _app, _last, pinned) => ({
    data: pinned ? [...pinnedConversations, conversations[0]!] : [conversations[1]!],
    has_more: false,
    limit: 100,
  }))
  await operate('First conversation', 'pin')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  expect(pinConversation).toHaveBeenCalledExactlyOnceWith(AppSourceType.webApp, 'app-1', '1')
  await openOperations('First conversation')
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.unpin' }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  vi.mocked(fetchConversations).mockImplementation(async (_source, _app, _last, pinned) => ({
    data: pinned ? [conversations[0]!] : [conversations[1]!, ...pinnedConversations],
    has_more: false,
    limit: 100,
  }))
  await operate('Pinned conversation', 'unpin')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  expect(unpinConversation).toHaveBeenCalledExactlyOnceWith(AppSourceType.webApp, 'app-1', 'p1')
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
  const pending = createDeferred<void>()
  vi.mocked(delConversation).mockReturnValueOnce(pending.promise)
  await renderSidebar({ currentConversationId: '2' }, noBranding, true)
  await expect
    .element(currentConversation().getByRole('button', { name: 'Second conversation' }))
    .toBeVisible()
  await operate('Second conversation', 'delete')
  const dialog = page.getByRole('alertdialog', { name: 'share.chat.deleteConversation.title' })
  await expect.element(dialog).toBeVisible()
  expect(delConversation).not.toHaveBeenCalled()
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  expect(delConversation).toHaveBeenCalledExactlyOnceWith(AppSourceType.webApp, 'app-1', '2')
  await expect.element(dialog).toBeVisible()
  expect(selectedConversation()).toBe('2')
  vi.mocked(fetchConversations).mockImplementation(async (_source, _app, _last, pinned) => ({
    data: pinned ? pinnedConversations : [conversations[0]!],
    has_more: false,
    limit: 100,
  }))
  pending.resolve()
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
  expect(delConversation).not.toHaveBeenCalled()
  await expect
    .element(currentConversation().getByRole('button', { name: 'First conversation' }))
    .toBeVisible()
  await expect
    .element(conversationHistory().getByRole('button', { name: 'First conversation' }))
    .toBeVisible()
  expect(selectedConversation()).toBe('1')
})

it('submits the chosen conversation name and blocks native Enter and click resubmission until saved', async () => {
  const pending = createDeferred<void>()
  vi.mocked(renameConversation).mockReturnValueOnce(pending.promise)
  await renderSidebar({}, noBranding, true)
  await operate('Second conversation', 'rename')
  const input = page.getByRole('textbox', { name: 'common.chat.conversationName' })
  await expect.element(input).toHaveValue('Second conversation')
  await expect.element(input).toHaveFocus()
  await input.fill('New name')
  await userEvent.keyboard('{Enter}')
  expect(renameConversation).toHaveBeenCalledExactlyOnceWith(
    AppSourceType.webApp,
    'app-1',
    '2',
    'New name',
  )
  const save = page.getByRole('button', { name: 'common.operation.save' })
  await expect.element(save).toHaveAttribute('aria-disabled', 'true')
  await userEvent.tab()
  await userEvent.tab()
  await expect.element(save).toHaveFocus()
  await userEvent.keyboard(' ')
  await input.click()
  await userEvent.keyboard('{Enter}')
  expect(renameConversation).toHaveBeenCalledTimes(1)
  pending.resolve()
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
  expect(renameConversation).not.toHaveBeenCalled()
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

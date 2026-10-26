import type { ChatWithHistoryContextValue } from '../../context'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AppSourceType,
  delConversation,
  fetchChatList,
  fetchConversations,
  pinConversation,
  renameConversation,
  unpinConversation,
} from '@/service/share'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../../constants'
import { renderChatHistory } from '../../__tests__/chat-history-test-env'
import { ChatWithHistoryContext, useChatWithHistoryContext } from '../../context'
import Sidebar from '../index'

vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchChatList: vi.fn(),
  fetchConversations: vi.fn(),
  pinConversation: vi.fn(),
  unpinConversation: vi.fn(),
  renameConversation: vi.fn(),
  delConversation: vi.fn(),
}))
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
const appData = {
  site: {
    title: 'Test App',
    icon_type: 'image',
    icon: 'icon-url',
    icon_background: '#fff',
    icon_url: 'https://example.com/icon.png',
  },
  custom_config: {},
} as ChatWithHistoryContextValue['appData']

beforeEach(() => {
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
})
afterEach(() => {
  localStorage.removeItem(CONVERSATION_ID_INFO)
  sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
  localStorage.removeItem('webappSidebarCollapse')
})

function renderSidebar(options: Parameters<typeof renderChatHistory>[1] = {}) {
  return {
    ...renderChatHistory(<Sidebar />, {
      currentConversationId: '1',
      conversations,
      pinnedConversations,
      ...options,
    }),
    user: userEvent.setup(),
  }
}
function selectedConversation() {
  return JSON.parse(sessionStorage.getItem(TAB_CONVERSATION_ID_INFO)!)['app-1']['user-1']
}

// Branding is a display contract with caller-supplied application metadata.
function renderBranding(
  overrides: Partial<ChatWithHistoryContextValue>,
  branding: { enabled: boolean; workspace_logo: string },
) {
  function View() {
    const defaults = useChatWithHistoryContext()
    return (
      <ChatWithHistoryContext.Provider value={{ ...defaults, appData, ...overrides }}>
        <Sidebar />
      </ChatWithHistoryContext.Provider>
    )
  }
  return renderWithConsoleQuery(<View />, { systemFeatures: { branding } })
}

async function openOperations(user: ReturnType<typeof userEvent.setup>, name: string) {
  const row = screen.getByRole('button', { name }).parentElement!
  await user.hover(row)
  await user.click(within(row).getByRole('button', { name: 'common.operation.more' }))
}
async function operate(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  action: 'pin' | 'unpin' | 'rename' | 'delete',
) {
  await openOperations(user, name)
  await user.click(
    await screen.findByRole('menuitem', { name: `explore.sidebar.action.${action}` }),
  )
}

describe('Conversation sidebar', () => {
  it('selects conversations from both lists and keeps operations separate from selection', async () => {
    const { user, queryClient, listKey } = renderSidebar()
    expect(screen.getByText('share.chat.pinnedTitle')).toBeInTheDocument()
    expect(screen.getByText('share.chat.unpinnedTitle')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Second conversation' }))
    expect(selectedConversation()).toBe('2')
    await user.click(screen.getByRole('button', { name: 'Pinned conversation' }))
    expect(selectedConversation()).toBe('p1')
    vi.mocked(fetchConversations).mockImplementation(async (_source, _app, _last, pinned) => ({
      data: pinned ? [...pinnedConversations, conversations[0]!] : [conversations[1]!],
      has_more: false,
      limit: 100,
    }))
    await operate(user, 'First conversation', 'pin')
    await waitFor(() =>
      expect(queryClient.getQueryData(listKey(true))).toMatchObject({
        data: [...pinnedConversations, conversations[0]!],
      }),
    )
    expect(pinConversation).toHaveBeenCalledExactlyOnceWith(AppSourceType.webApp, 'app-1', '1')
    await openOperations(user, 'First conversation')
    expect(
      await screen.findByRole('menuitem', { name: 'explore.sidebar.action.unpin' }),
    ).toBeVisible()
    await user.keyboard('{Escape}')
    vi.mocked(fetchConversations).mockImplementation(async (_source, _app, _last, pinned) => ({
      data: pinned ? [conversations[0]!] : [conversations[1]!, ...pinnedConversations],
      has_more: false,
      limit: 100,
    }))
    await operate(user, 'Pinned conversation', 'unpin')
    await waitFor(() =>
      expect(queryClient.getQueryData(listKey(false))).toMatchObject({
        data: [conversations[1]!, ...pinnedConversations],
      }),
    )
    expect(unpinConversation).toHaveBeenCalledExactlyOnceWith(AppSourceType.webApp, 'app-1', 'p1')
    await openOperations(user, 'Pinned conversation')
    expect(
      await screen.findByRole('menuitem', { name: 'explore.sidebar.action.pin' }),
    ).toBeVisible()
    await user.keyboard('{Escape}')
    expect(selectedConversation()).toBe('p1')
  })

  it('starts a conversation only while no response is being generated', async () => {
    const { user, unmount } = renderSidebar({
      ownerProps: { isResponding: true },
      conversations: [],
      pinnedConversations: [],
    })
    const newChat = screen.getByRole('button', { name: 'share.chat.newChat' })
    await user.click(newChat)
    expect(newChat).toBeDisabled()
    expect(selectedConversation()).toBe('1')
    expect(screen.queryByText('share.chat.pinnedTitle')).not.toBeInTheDocument()
    expect(screen.queryByText('share.chat.unpinnedTitle')).not.toBeInTheDocument()
    unmount()
    renderSidebar({ conversations: [], pinnedConversations: [] })
    await user.click(screen.getByRole('button', { name: 'share.chat.newChat' }))
    expect(selectedConversation()).toBe('')
  })

  it.each([false, true])('toggles the desktop sidebar when collapsed=%s', async (collapsed) => {
    const { user } = renderSidebar({ sidebarCollapsed: collapsed })
    await user.click(
      screen.getByRole('button', {
        name: collapsed ? 'layout.sidebar.expandSidebar' : 'layout.sidebar.collapseSidebar',
      }),
    )
    expect(
      screen.getByRole('button', {
        name: collapsed ? 'layout.sidebar.collapseSidebar' : 'layout.sidebar.expandSidebar',
      }),
    ).toBeVisible()
    expect(localStorage.getItem('webappSidebarCollapse')).toBe(collapsed ? 'expanded' : 'collapsed')
  })

  it('keeps desktop collapse actions out of the mobile sidebar', () => {
    renderSidebar({ ownerProps: { isMobile: true } })
    expect(
      screen.queryByRole('button', { name: /layout.sidebar.(expand|collapse)Sidebar/ }),
    ).not.toBeInTheDocument()
  })

  it('confirms deletion for the chosen conversation and closes only after success', async () => {
    const pending = createDeferred<void>()
    vi.mocked(delConversation).mockReturnValueOnce(pending.promise)
    const { user } = renderSidebar({ currentConversationId: '2' })
    await operate(user, 'Second conversation', 'delete')
    const dialog = await screen.findByRole('alertdialog', {
      name: 'share.chat.deleteConversation.title',
    })
    expect(delConversation).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
    expect(delConversation).toHaveBeenCalledExactlyOnceWith(AppSourceType.webApp, 'app-1', '2')
    expect(dialog).toBeInTheDocument()
    expect(selectedConversation()).toBe('2')
    vi.mocked(fetchConversations).mockImplementation(async (_source, _app, _last, pinned) => ({
      data: pinned ? pinnedConversations : [conversations[0]!],
      has_more: false,
      limit: 100,
    }))
    await act(async () => pending.resolve())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Second conversation' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'First conversation' })).toBeVisible()
    expect(selectedConversation()).toBe('')
  })

  it('cancels deletion without changing the conversation', async () => {
    const { user } = renderSidebar()
    await operate(user, 'First conversation', 'delete')
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.cancel',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(delConversation).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'First conversation' })).toBeVisible()
    expect(selectedConversation()).toBe('1')
  })

  it('saves the edited name for the chosen conversation and blocks resubmission while saving', async () => {
    const pending = createDeferred<void>()
    vi.mocked(renameConversation).mockReturnValueOnce(pending.promise)
    const { user } = renderSidebar()
    await operate(user, 'Second conversation', 'rename')
    const input = await screen.findByRole('textbox', { name: 'common.chat.conversationName' })
    expect(input).toHaveValue('Second conversation')
    await user.clear(input)
    await user.type(input, 'New name{Enter}')
    expect(renameConversation).toHaveBeenCalledExactlyOnceWith(
      AppSourceType.webApp,
      'app-1',
      '2',
      'New name',
    )
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await user.type(input, '{Enter}')
    expect(renameConversation).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByRole('button', { name: 'New name' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Second conversation' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'First conversation' })).toBeVisible()
  })

  it('discards a cancelled rename before opening a different conversation', async () => {
    const { user } = renderSidebar()
    await operate(user, 'First conversation', 'rename')
    await user.type(
      await screen.findByRole('textbox', { name: 'common.chat.conversationName' }),
      ' unsaved',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await operate(user, 'Second conversation', 'rename')
    expect(
      await screen.findByRole('textbox', { name: 'common.chat.conversationName' }),
    ).toHaveValue('Second conversation')
    expect(renameConversation).not.toHaveBeenCalled()
  })

  it.each([
    { enabled: false, workspace_logo: '', expected: 'https://example.com/custom.png' },
    {
      enabled: true,
      workspace_logo: 'https://example.com/workspace.png',
      expected: 'https://example.com/workspace.png',
    },
    { enabled: true, workspace_logo: '', expected: 'https://example.com/custom.png' },
  ])('chooses the effective branding logo: $expected', ({ expected, ...branding }) => {
    renderBranding(
      {
        appData: {
          ...appData!,
          custom_config: { replace_webapp_logo: 'https://example.com/custom.png' },
        },
      },
      branding,
    )
    expect(screen.getByRole('img', { name: 'logo' })).toHaveAttribute('src', expected)
  })

  it('removes branding when the application disables it', () => {
    renderBranding(
      { appData: { ...appData!, custom_config: { remove_webapp_brand: true } } },
      { enabled: true, workspace_logo: 'https://example.com/workspace.png' },
    )
    expect(screen.queryByText('share.chat.poweredBy')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'logo' })).not.toBeInTheDocument()
  })
})

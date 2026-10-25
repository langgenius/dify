import type { ChatWithHistoryContextValue } from '../../context'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ChatWithHistoryContext, useChatWithHistoryContext } from '../../context'
import Sidebar from '../index'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/chat/app-1',
}))

const conversation = (id: string, name: string) => ({ id, name, inputs: {}, introduction: '' })
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

function renderSidebar(
  overrides: Partial<ChatWithHistoryContextValue> = {},
  branding = { enabled: false, workspace_logo: '' },
) {
  const handlers = {
    handleNewConversation: vi.fn(),
    handleChangeConversation: vi.fn(),
    handlePinConversation: vi.fn(),
    handleUnpinConversation: vi.fn(),
    handleDeleteConversation: vi.fn(),
    handleRenameConversation: vi.fn(),
    handleSidebarCollapse: vi.fn(),
  }
  function Harness({ state }: { state: Partial<ChatWithHistoryContextValue> }) {
    const defaults = useChatWithHistoryContext()
    return (
      <ChatWithHistoryContext.Provider
        value={{
          ...defaults,
          ...handlers,
          appData,
          conversationList: [
            conversation('1', 'First conversation'),
            conversation('2', 'Second conversation'),
          ],
          pinnedConversationList: [conversation('p1', 'Pinned conversation')],
          ...state,
        }}
      >
        <Sidebar />
      </ChatWithHistoryContext.Provider>
    )
  }
  const result = renderWithConsoleQuery(<Harness state={overrides} />, {
    systemFeatures: { branding },
  })
  return {
    ...result,
    ...handlers,
    user: userEvent.setup(),
    update: (state: Partial<ChatWithHistoryContextValue>) =>
      result.rerender(<Harness state={{ ...overrides, ...state }} />),
  }
}

async function operate(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  action: 'pin' | 'unpin' | 'rename' | 'delete',
) {
  const row = screen.getByRole('button', { name }).parentElement!
  await user.hover(row)
  await user.click(within(row).getByRole('button', { name: 'common.operation.more' }))
  await user.click(
    await screen.findByRole('menuitem', { name: `explore.sidebar.action.${action}` }),
  )
}

describe('Conversation sidebar', () => {
  it('selects conversations from both lists and keeps operations separate from selection', async () => {
    const { user, handleChangeConversation, handlePinConversation, handleUnpinConversation } =
      renderSidebar()
    expect(screen.getByText('share.chat.pinnedTitle')).toBeInTheDocument()
    expect(screen.getByText('share.chat.unpinnedTitle')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Second conversation' }))
    await user.click(screen.getByRole('button', { name: 'Pinned conversation' }))
    expect(handleChangeConversation.mock.calls).toEqual([['2'], ['p1']])
    await operate(user, 'First conversation', 'pin')
    await operate(user, 'Pinned conversation', 'unpin')
    expect(handlePinConversation).toHaveBeenCalledExactlyOnceWith('1')
    expect(handleUnpinConversation).toHaveBeenCalledExactlyOnceWith('p1')
    expect(handleChangeConversation).toHaveBeenCalledTimes(2)
  })

  it('starts a conversation only while no response is being generated', async () => {
    const { user, update, handleNewConversation } = renderSidebar({
      isResponding: true,
      pinnedConversationList: [],
      conversationList: [],
    })
    const newChat = screen.getByRole('button', { name: 'share.chat.newChat' })
    await user.click(newChat)
    expect(newChat).toBeDisabled()
    expect(handleNewConversation).not.toHaveBeenCalled()
    expect(screen.queryByText('share.chat.pinnedTitle')).not.toBeInTheDocument()
    expect(screen.queryByText('share.chat.unpinnedTitle')).not.toBeInTheDocument()
    update({ isResponding: false })
    await user.click(newChat)
    expect(handleNewConversation).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('toggles the desktop sidebar when collapsed=%s', async (collapsed) => {
    const { user, handleSidebarCollapse } = renderSidebar({ sidebarCollapseState: collapsed })
    await user.click(
      screen.getByRole('button', {
        name: collapsed ? 'layout.sidebar.expandSidebar' : 'layout.sidebar.collapseSidebar',
      }),
    )
    expect(handleSidebarCollapse).toHaveBeenCalledExactlyOnceWith(!collapsed)
  })

  it('keeps desktop collapse actions out of the mobile sidebar', () => {
    renderSidebar({ isMobile: true })
    expect(
      screen.queryByRole('button', { name: /layout.sidebar.(expand|collapse)Sidebar/ }),
    ).not.toBeInTheDocument()
  })

  it('confirms deletion for the chosen conversation and closes only after success', async () => {
    const { user, handleDeleteConversation } = renderSidebar()
    await operate(user, 'Second conversation', 'delete')
    const dialog = await screen.findByRole('alertdialog', {
      name: 'share.chat.deleteConversation.title',
    })
    expect(handleDeleteConversation).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
    expect(handleDeleteConversation).toHaveBeenCalledExactlyOnceWith('2', {
      onSuccess: expect.any(Function),
    })
    expect(dialog).toBeInTheDocument()
    act(() => handleDeleteConversation.mock.calls[0]![1].onSuccess())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('cancels deletion without changing the conversation', async () => {
    const { user, handleDeleteConversation } = renderSidebar()
    await operate(user, 'First conversation', 'delete')
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(handleDeleteConversation).not.toHaveBeenCalled()
  })

  it('saves the edited name for the chosen conversation and blocks resubmission while saving', async () => {
    const { user, update, handleRenameConversation } = renderSidebar()
    await operate(user, 'Second conversation', 'rename')
    const input = await screen.findByRole('textbox', { name: 'common.chat.conversationName' })
    expect(input).toHaveValue('Second conversation')
    await user.clear(input)
    await user.type(input, 'New name{Enter}')
    expect(handleRenameConversation).toHaveBeenCalledExactlyOnceWith('2', 'New name', {
      onSuccess: expect.any(Function),
    })
    update({ conversationRenaming: true })
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await user.type(input, '{Enter}')
    expect(handleRenameConversation).toHaveBeenCalledTimes(1)
    act(() => handleRenameConversation.mock.calls[0]![2].onSuccess())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('discards a cancelled rename before opening a different conversation', async () => {
    const { user, handleRenameConversation } = renderSidebar()
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
    expect(handleRenameConversation).not.toHaveBeenCalled()
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
    renderSidebar(
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
    renderSidebar(
      { appData: { ...appData!, custom_config: { remove_webapp_brand: true } } },
      { enabled: true, workspace_logo: 'https://example.com/workspace.png' },
    )
    expect(screen.queryByText('share.chat.poweredBy')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'logo' })).not.toBeInTheDocument()
  })
})

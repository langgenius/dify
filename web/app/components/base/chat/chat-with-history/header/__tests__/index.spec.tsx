import { screen, waitFor } from '@testing-library/react'
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
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../../constants'
import { conversation, renderChatHistory } from '../../__tests__/chat-history-test-env'
import Header from '../index'

vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchChatList: vi.fn(),
  fetchConversations: vi.fn(),
  pinConversation: vi.fn(),
  unpinConversation: vi.fn(),
  renameConversation: vi.fn(),
  delConversation: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(fetchChatList).mockResolvedValue({ data: [] })
  vi.mocked(fetchConversations).mockResolvedValue({ data: [], has_more: false, limit: 100 })
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

async function operate(user: ReturnType<typeof userEvent.setup>, action: string) {
  await user.click(await screen.findByRole('button', { name: 'My Chat' }))
  await user.click(
    await screen.findByRole('menuitem', { name: `explore.sidebar.action.${action}` }),
  )
}

it('resets the selected conversation and persists New Chat from the reset button', async () => {
  const user = userEvent.setup()
  renderChatHistory(<Header />)
  await user.click(screen.getByRole('button', { name: 'share.chat.resetChat' }))
  expect(await screen.findByText('Test Chat')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'My Chat' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'share.chat.resetChat' })).not.toBeInTheDocument()
  expect(JSON.parse(sessionStorage.getItem(TAB_CONVERSATION_ID_INFO)!)).toEqual({
    'app-1': { 'user-1': '' },
  })
  expect(JSON.parse(localStorage.getItem(CONVERSATION_ID_INFO)!)).toEqual({
    'app-1': { 'user-1': '' },
  })
})

it('expands and persists the sidebar, removing the collapsed-header actions', async () => {
  const user = userEvent.setup()
  renderChatHistory(<Header />)
  await user.click(screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' }))
  expect(
    screen.queryByRole('button', { name: 'layout.sidebar.expandSidebar' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'My Chat' })).not.toBeInTheDocument()
  expect(localStorage.getItem('webappSidebarCollapse')).toBe('expanded')
})

it.each([false, true])('refreshes the pin action after saving pinned=%s', async (pinned) => {
  const user = userEvent.setup()
  const { queryClient, listKey } = renderChatHistory(<Header />, {
    conversations: pinned ? [] : [conversation],
    pinnedConversations: pinned ? [conversation] : [],
  })
  vi.mocked(fetchConversations).mockImplementation(
    async (_source, _app, _last, requestedPinned) => ({
      data: requestedPinned === !pinned ? [conversation] : [],
      has_more: false,
      limit: 100,
    }),
  )
  await operate(user, pinned ? 'unpin' : 'pin')
  await waitFor(() =>
    expect(queryClient.getQueryData(listKey(!pinned))).toMatchObject({ data: [conversation] }),
  )
  await user.click(await screen.findByRole('button', { name: 'My Chat' }))
  expect(
    await screen.findByRole('menuitem', {
      name: `explore.sidebar.action.${pinned ? 'pin' : 'unpin'}`,
    }),
  ).toBeVisible()
  expect(pinned ? unpinConversation : pinConversation).toHaveBeenCalledExactlyOnceWith(
    AppSourceType.webApp,
    'app-1',
    'conversation-1',
  )
})

it('saves the edited conversation name and closes the dialog through the real owner', async () => {
  const user = userEvent.setup()
  renderChatHistory(<Header />)
  await operate(user, 'rename')
  const input = await screen.findByRole('textbox', { name: 'common.chat.conversationName' })
  await user.clear(input)
  await user.type(input, 'Renamed conversation')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(await screen.findByRole('button', { name: 'Renamed conversation' })).toBeVisible()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(renameConversation).toHaveBeenCalledExactlyOnceWith(
    AppSourceType.webApp,
    'app-1',
    'conversation-1',
    'Renamed conversation',
  )
})

it.each(['rename', 'delete'])(
  'cancels %s without changing the selected conversation',
  async (action) => {
    const user = userEvent.setup()
    renderChatHistory(<Header />)
    await operate(user, action)
    if (action === 'rename') await user.type(await screen.findByRole('textbox'), ' unsaved')
    await user.click(await screen.findByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() =>
      expect(
        screen.queryByRole(action === 'rename' ? 'dialog' : 'alertdialog'),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'My Chat' })).toBeVisible()
    expect(renameConversation).not.toHaveBeenCalled()
    expect(delConversation).not.toHaveBeenCalled()
  },
)

it('deletes the selected conversation, refreshes the list and returns to New Chat', async () => {
  const user = userEvent.setup()
  const { queryClient, listKey } = renderChatHistory(<Header />)
  await operate(user, 'delete')
  expect(delConversation).not.toHaveBeenCalled()
  await user.click(await screen.findByRole('button', { name: 'common.operation.confirm' }))
  expect(await screen.findByText('Test Chat')).toBeVisible()
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  await waitFor(() => expect(queryClient.getQueryData(listKey(false))).toMatchObject({ data: [] }))
  expect(delConversation).toHaveBeenCalledExactlyOnceWith(
    AppSourceType.webApp,
    'app-1',
    'conversation-1',
  )
  expect(JSON.parse(sessionStorage.getItem(TAB_CONVERSATION_ID_INFO)!)).toEqual({
    'app-1': { 'user-1': '' },
  })
})

it('opens chat settings with the configured inputs and closes with Escape', async () => {
  const user = userEvent.setup()
  renderChatHistory(<Header />, {
    appParams: createChatConfigFixture({
      user_input_form: [
        { 'text-input': { label: 'Topic', variable: 'topic', required: false, default: 'Travel' } },
      ],
    }),
  })
  await user.click(await screen.findByRole('button', { name: 'share.chat.viewChatSettings' }))
  expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('Travel')
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
})

it.each([
  { currentConversationId: '', responding: false },
  { currentConversationId: 'conversation-1', responding: true },
])(
  'disables New Chat for selection=$currentConversationId and responding=$responding',
  ({ currentConversationId, responding }) => {
    renderChatHistory(<Header />, {
      currentConversationId,
      ownerProps: { isResponding: responding },
    })
    expect(screen.getByRole('button', { name: 'share.chat.newChatTip' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'share.chat.viewChatSettings' }),
    ).not.toBeInTheDocument()
  },
)

it('hides conversation operations while the sidebar is expanded', () => {
  renderChatHistory(<Header />, { sidebarCollapsed: false })
  expect(screen.queryByRole('button', { name: 'My Chat' })).not.toBeInTheDocument()
})

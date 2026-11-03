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
import { createDeferred } from '@/test/deferred'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../constants'
import HeaderInMobile from '../header-in-mobile'
import { conversation, renderChatHistory } from './chat-history-test-env'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchChatList: vi.fn(),
  fetchConversations: vi.fn(),
  pinConversation: vi.fn(),
  unpinConversation: vi.fn(),
  renameConversation: vi.fn(),
  delConversation: vi.fn(),
}))

const setup = (options: Parameters<typeof renderChatHistory>[1] = {}) =>
  renderChatHistory(<HeaderInMobile />, { ...options, ownerProps: { isMobile: true } })

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

it('contains sidebar focus and restores the trigger after Escape', async () => {
  const user = userEvent.setup()
  setup({ currentConversationId: '' })
  const trigger = screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' })
  const backgroundMore = screen.getByRole('button', { name: 'common.operation.more' })
  await user.click(trigger)
  const sidebar = await screen.findByRole('dialog', { name: 'Test Chat' })
  await waitFor(() => expect(sidebar).toContainElement(document.activeElement as HTMLElement))
  expect(screen.queryAllByRole('button', { name: 'common.operation.more' })).not.toContain(
    backgroundMore,
  )
  await user.tab({ shift: true })
  expect(sidebar).toContainElement(document.activeElement as HTMLElement)
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
})

it('provides a keyboard-operable sidebar close button', async () => {
  const user = userEvent.setup()
  setup({ currentConversationId: '' })
  const trigger = screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' })
  await user.click(trigger)
  const sidebar = await screen.findByRole('dialog', { name: 'Test Chat' })
  const close = within(sidebar).getByRole('button', { name: 'common.operation.close' })
  close.focus()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
})

it('opens named modal chat settings and closes with Escape', async () => {
  const user = userEvent.setup()
  setup({
    appParams: createChatConfigFixture({
      user_input_form: [{ 'text-input': { variable: 'topic', label: 'Topic', required: true } }],
    }),
  })
  const trigger = screen.getByRole('button', { name: 'common.operation.more' })
  await user.click(trigger)
  await user.click(await screen.findByRole('menuitem', { name: 'share.chat.viewChatSettings' }))
  const settings = await screen.findByRole('dialog', { name: 'share.chat.chatSettingsTitle' })
  await waitFor(() => expect(settings).toContainElement(document.activeElement as HTMLElement))
  expect(within(settings).getByRole('textbox', { name: /Topic/ })).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
})

it('hides chat settings when the application has no input forms', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  expect(
    screen.queryByRole('menuitem', { name: 'share.chat.viewChatSettings' }),
  ).not.toBeInTheDocument()
})

it('resets the active conversation from the More menu and persists New Chat', async () => {
  const user = userEvent.setup()
  setup()
  expect(await screen.findByRole('button', { name: 'My Chat' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  await user.click(await screen.findByRole('menuitem', { name: 'share.chat.resetChat' }))
  expect(await screen.findByText('Test Chat')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'My Chat' })).not.toBeInTheDocument()
  expect(JSON.parse(sessionStorage.getItem(TAB_CONVERSATION_ID_INFO)!)).toEqual({
    'app-1': { 'user-1': '' },
  })
  expect(JSON.parse(localStorage.getItem(CONVERSATION_ID_INFO)!)).toEqual({
    'app-1': { 'user-1': '' },
  })
})

it.each([false, true])(
  'refreshes the available pin action after saving pinned=%s',
  async (pinned) => {
    const user = userEvent.setup()
    const { queryClient, listKey } = setup({
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
  },
)

it('renames the conversation after saving, with pending state blocking duplicate submissions', async () => {
  const user = userEvent.setup()
  const request = createDeferred<Awaited<ReturnType<typeof renameConversation>>>()
  vi.mocked(renameConversation).mockReturnValue(request.promise)
  setup()
  await operate(user, 'rename')
  const input = await screen.findByRole('textbox', { name: 'common.chat.conversationName' })
  await user.clear(input)
  await user.type(input, 'New Name')
  const save = screen.getByRole('button', { name: 'common.operation.save' })
  await user.click(save)
  expect(save).toHaveAttribute('aria-disabled', 'true')
  await user.click(save)
  expect(renameConversation).toHaveBeenCalledExactlyOnceWith(
    AppSourceType.webApp,
    'app-1',
    'conversation-1',
    'New Name',
  )
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await act(async () => request.resolve(undefined))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'New Name' })).toBeVisible()
})

it.each(['rename', 'delete'])(
  'cancels %s and preserves the current conversation',
  async (action) => {
    const user = userEvent.setup()
    setup()
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

it('deletes the selected conversation and returns to the application title after refreshing', async () => {
  const user = userEvent.setup()
  const { queryClient, listKey } = setup()
  await operate(user, 'delete')
  expect(delConversation).not.toHaveBeenCalled()
  await user.click(await screen.findByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(screen.getByText('Test Chat')).toBeVisible()
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

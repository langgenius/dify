import type { ChatConfig } from '../../types'
import type { ChatWithHistoryContextValue } from '../context'
import type { AppData, AppMeta } from '@/models/share'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ChatWithHistoryContext } from '../context'
import HeaderInMobile from '../header-in-mobile'

vi.mock('@/hooks/use-breakpoints', () => ({
  default: vi.fn(),
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  })),
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useParams: vi.fn(() => ({})),
}))

const mockAppData: AppData = {
  app_id: 'test-app',
  custom_config: null,
  site: {
    title: 'Test Chat',
    chat_color_theme: 'blue',
  },
}
const defaultContextValue: ChatWithHistoryContextValue = {
  appData: mockAppData,
  currentConversationId: '',
  currentConversationItem: undefined,
  inputsForms: [],
  handlePinConversation: vi.fn(),
  handleUnpinConversation: vi.fn(),
  handleDeleteConversation: vi.fn(),
  handleRenameConversation: vi.fn(),
  handleNewConversation: vi.fn(),
  handleNewConversationInputsChange: vi.fn(),
  handleStartChat: vi.fn(),
  handleChangeConversation: vi.fn(),
  handleNewConversationCompleted: vi.fn(),
  handleFeedback: vi.fn(),
  sidebarCollapseState: false,
  handleSidebarCollapse: vi.fn(),
  pinnedConversationList: [],
  conversationList: [],
  isInstalledApp: false,
  currentChatInstanceRef: {
    current: { handleStop: vi.fn() },
  } as ChatWithHistoryContextValue['currentChatInstanceRef'],
  setIsResponding: vi.fn(),
  setClearChatList: vi.fn(),
  appParams: {
    system_parameters: {
      audio_file_size_limit: 10,
      file_size_limit: 10,
      image_file_size_limit: 10,
      video_file_size_limit: 10,
      workflow_file_upload_limit: 10,
    },
    more_like_this: { enabled: false },
  } as ChatConfig,
  appMeta: { tool_icons: {} } as AppMeta,
  appPrevChatTree: [],
  newConversationInputs: {},
  newConversationInputsRef: { current: {} },
  appChatListDataLoading: false,
  chatShouldReloadKey: '',
  isMobile: true,
  currentConversationInputs: null,
  setCurrentConversationInputs: vi.fn(),
  allInputsHidden: false,
  conversationRenaming: false,
}

let context = defaultContextValue
const setContext = (value: ChatWithHistoryContextValue) => {
  context = value
}
const render = (ui: React.ReactElement) =>
  renderWithConsoleQuery(
    <ChatWithHistoryContext.Provider value={context}>{ui}</ChatWithHistoryContext.Provider>,
  )

describe('HeaderInMobile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useBreakpoints).mockReturnValue(MediaType.mobile)
    setContext(defaultContextValue)
  })

  it('should render title when no conversation', () => {
    render(<HeaderInMobile />)
    expect(screen.getByText('Test Chat'))!.toBeInTheDocument()
  })

  it('should render conversation name when active', async () => {
    setContext({
      ...defaultContextValue,
      currentConversationId: '1',
      currentConversationItem: { id: '1', name: 'Conv 1', inputs: null, introduction: '' },
    })

    render(<HeaderInMobile />)
    expect(await screen.findByText('Conv 1'))!.toBeInTheDocument()
  })

  it('contains sidebar focus and restores the trigger after Escape', async () => {
    const user = userEvent.setup()
    render(<HeaderInMobile />)
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
    render(<HeaderInMobile />)
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
    setContext({
      ...defaultContextValue,
      inputsForms: [{ variable: 'test', label: 'Test', type: 'text', required: true }],
    })
    render(<HeaderInMobile />)
    const trigger = screen.getByRole('button', { name: 'common.operation.more' })
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: 'share.chat.viewChatSettings' }))
    const settings = await screen.findByRole('dialog', { name: 'share.chat.chatSettingsTitle' })
    await waitFor(() => expect(settings).toContainElement(document.activeElement as HTMLElement))
    expect(
      within(settings).getByRole('button', { name: 'common.operation.close' }),
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('should hide chat settings option when no input forms', async () => {
    const user = userEvent.setup()
    setContext({
      ...defaultContextValue,
      inputsForms: [],
    })

    render(<HeaderInMobile />)

    await user.click(await screen.findByRole('button', { name: 'common.operation.more' }))

    await waitFor(() => {
      expect(screen.queryByText(/share\.chat\.viewChatSettings/i)).not.toBeInTheDocument()
    })
  })

  it('should handle new conversation', async () => {
    const user = userEvent.setup()
    const handleNewConversation = vi.fn()
    setContext({
      ...defaultContextValue,
      handleNewConversation,
    })

    render(<HeaderInMobile />)

    await user.click(await screen.findByRole('button', { name: 'common.operation.more' }))

    await waitFor(() => {
      expect(screen.getByText(/share\.chat\.resetChat/i))!.toBeInTheDocument()
    })
    await user.click(screen.getByText(/share\.chat\.resetChat/i))

    await waitFor(() => {
      expect(handleNewConversation).toHaveBeenCalled()
    })
  })

  it('should handle pin conversation', async () => {
    const user = userEvent.setup()
    const handlePin = vi.fn()
    setContext({
      ...defaultContextValue,
      currentConversationId: '1',
      currentConversationItem: { id: '1', name: 'Conv 1', inputs: null, introduction: '' },
      handlePinConversation: handlePin,
      pinnedConversationList: [],
    })

    render(<HeaderInMobile />)

    await user.click(await screen.findByText('Conv 1'))

    await waitFor(() => {
      expect(screen.getByText(/explore\.sidebar\.action\.pin/i))!.toBeInTheDocument()
    })
    await user.click(screen.getByText(/explore\.sidebar\.action\.pin/i))
    expect(handlePin).toHaveBeenCalledWith('1')
  })

  it('should handle unpin conversation', async () => {
    const user = userEvent.setup()
    const handleUnpin = vi.fn()
    setContext({
      ...defaultContextValue,
      currentConversationId: '1',
      currentConversationItem: { id: '1', name: 'Conv 1', inputs: null, introduction: '' },
      handleUnpinConversation: handleUnpin,
      pinnedConversationList: [{ id: '1', name: 'Conv 1', inputs: null, introduction: '' }],
    })

    render(<HeaderInMobile />)

    await user.click(await screen.findByText('Conv 1'))

    await waitFor(() => {
      expect(screen.getByText(/explore\.sidebar\.action\.unpin/i))!.toBeInTheDocument()
    })
    await user.click(screen.getByText(/explore\.sidebar\.action\.unpin/i))
    expect(handleUnpin).toHaveBeenCalledWith('1')
  })

  it('should handle rename conversation', async () => {
    const user = userEvent.setup()
    const handleRename = vi.fn()
    setContext({
      ...defaultContextValue,
      currentConversationId: '1',
      currentConversationItem: { id: '1', name: 'Conv 1', inputs: null, introduction: '' },
      handleRenameConversation: handleRename,
      pinnedConversationList: [],
    })

    render(<HeaderInMobile />)
    await user.click(await screen.findByText('Conv 1'))

    await waitFor(() => {
      expect(screen.getByText(/explore\.sidebar\.action\.rename/i))!.toBeInTheDocument()
    })
    await user.click(screen.getByText(/explore\.sidebar\.action\.rename/i))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    const input = screen.getByDisplayValue('Conv 1')
    await user.clear(input)
    await user.type(input, 'New Name')

    const saveButton = screen.getByRole('button', { name: /common\.operation\.save/i })
    await user.click(saveButton)
    expect(handleRename).toHaveBeenCalledWith('1', 'New Name', expect.any(Object))
  })

  it('should cancel rename conversation', async () => {
    const user = userEvent.setup()
    const handleRename = vi.fn()
    setContext({
      ...defaultContextValue,
      currentConversationId: '1',
      currentConversationItem: { id: '1', name: 'Conv 1', inputs: null, introduction: '' },
      handleRenameConversation: handleRename,
      pinnedConversationList: [],
    })

    render(<HeaderInMobile />)
    await user.click(await screen.findByText('Conv 1'))

    await waitFor(() => {
      expect(screen.getByText(/explore\.sidebar\.action\.rename/i))!.toBeInTheDocument()
    })
    await user.click(screen.getByText(/explore\.sidebar\.action\.rename/i))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    const cancelButton = screen.getByRole('button', { name: /common\.operation\.cancel/i })
    await user.click(cancelButton)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(handleRename).not.toHaveBeenCalled()
  })

  it('should show loading state while renaming', async () => {
    const user = userEvent.setup()
    setContext({
      ...defaultContextValue,
      currentConversationId: '1',
      currentConversationItem: { id: '1', name: 'Conv 1', inputs: null, introduction: '' },
      handleRenameConversation: vi.fn(),
      conversationRenaming: true, // Loading state
      pinnedConversationList: [],
    })

    render(<HeaderInMobile />)
    await user.click(await screen.findByText('Conv 1'))

    await waitFor(() => {
      expect(screen.getByText(/explore\.sidebar\.action\.rename/i))!.toBeInTheDocument()
    })
    await user.click(screen.getByText(/explore\.sidebar\.action\.rename/i))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    const save = screen.getByRole('button', { name: /common\.operation\.save/i })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    await user.click(save)
    expect(context.handleRenameConversation).not.toHaveBeenCalled()
  })

  it('should handle delete conversation', async () => {
    const user = userEvent.setup()
    const handleDelete = vi.fn()
    setContext({
      ...defaultContextValue,
      currentConversationId: '1',
      currentConversationItem: { id: '1', name: 'Conv 1', inputs: null, introduction: '' },
      handleDeleteConversation: handleDelete,
      pinnedConversationList: [],
    })

    render(<HeaderInMobile />)
    await user.click(await screen.findByText('Conv 1'))

    await waitFor(() => {
      expect(screen.getByText(/explore\.sidebar\.action\.delete/i))!.toBeInTheDocument()
    })
    await user.click(screen.getByText(/explore\.sidebar\.action\.delete/i))

    await waitFor(() => {
      expect(screen.getAllByText(/share\.chat\.deleteConversation\.title/i)[0])!.toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /common\.operation\.confirm/i }))
    expect(handleDelete).toHaveBeenCalledWith('1', expect.any(Object))
  })

  it('should cancel delete conversation', async () => {
    const user = userEvent.setup()
    const handleDelete = vi.fn()
    setContext({
      ...defaultContextValue,
      currentConversationId: '1',
      currentConversationItem: { id: '1', name: 'Conv 1', inputs: null, introduction: '' },
      handleDeleteConversation: handleDelete,
      pinnedConversationList: [],
    })

    render(<HeaderInMobile />)
    await user.click(await screen.findByText('Conv 1'))

    await waitFor(() => {
      expect(screen.getByText(/explore\.sidebar\.action\.delete/i))!.toBeInTheDocument()
    })
    await user.click(screen.getByText(/explore\.sidebar\.action\.delete/i))

    await waitFor(() => {
      expect(screen.getAllByText(/share\.chat\.deleteConversation\.title/i)[0])!.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

    await waitFor(() => {
      expect(screen.queryByText(/share\.chat\.deleteConversation\.title/i)).not.toBeInTheDocument()
    })
    expect(handleDelete).not.toHaveBeenCalled()
  })

  it('should use empty string fallback for rename modal name', async () => {
    const user = userEvent.setup()
    const handleRename = vi.fn()
    setContext({
      ...defaultContextValue,
      currentConversationId: '1',
      currentConversationItem: { id: '1', name: '', inputs: null, introduction: '' },
      handleRenameConversation: handleRename,
      pinnedConversationList: [],
    })

    render(<HeaderInMobile />)
    const operationTrigger = screen
      .getAllByRole('button')
      .find(
        (button) => button.getAttribute('aria-haspopup') === 'menu' && button.textContent === '',
      )!
    await user.click(operationTrigger)
    await user.click(
      await screen.findByText(/explore\.sidebar\.action\.rename|sidebar\.action\.rename/i),
    )

    const input = await screen.findByRole('textbox')
    expect(input)!.toHaveValue('')

    await user.type(input, 'Renamed from empty')
    await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))
    expect(handleRename).toHaveBeenCalledWith('1', 'Renamed from empty', expect.any(Object))
  })
})

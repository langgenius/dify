import type { ChatWithHistoryContextValue } from '../context'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatWithHistoryContext } from '../context'
import Sidebar from './index'

// Mock List to allow us to trigger operations
vi.mock('./list', () => ({
  default: ({ list, onOperate, title }: { list: Array<{ id: string, name: string }>, onOperate: (type: string, item: { id: string, name: string }) => void, title?: string }) => (
    <div>
      {title && <div>{title}</div>}
      {list.map(item => (
        <div key={item.id}>
          <div>{item.name}</div>
          <button onClick={() => onOperate('pin', item)}>Pin</button>
          <button onClick={() => onOperate('unpin', item)}>Unpin</button>
          <button onClick={() => onOperate('delete', item)}>Delete</button>
          <button onClick={() => onOperate('rename', item)}>Rename</button>
        </div>
      ))}
    </div>
  ),
}))

// Mock context hook
vi.mock('../context', () => ({
  useChatWithHistoryContext: vi.fn(),
}))

// Mock global public store
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(selector => selector({
    systemFeatures: {
      branding: {
        enabled: true,
      },
    },
  })),
}))

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/test',
}))

// Mock Modal to avoid Headless UI issues in tests
vi.mock('@/app/components/base/modal', () => ({
  default: ({ children, isShow, title }: { children: React.ReactNode, isShow: boolean, title: React.ReactNode }) => {
    if (!isShow)
      return null
    return (
      <div data-testid="modal">
        {!!title && <div>{title}</div>}
        {children}
      </div>
    )
  },
}))

describe('Sidebar Index', () => {
  const mockContextValue = {
    isInstalledApp: false,
    appData: {
      site: {
        title: 'Test App',
        icon_type: 'image',
      },
      custom_config: {},
    },
    handleNewConversation: vi.fn(),
    pinnedConversationList: [],
    conversationList: [
      { id: '1', name: 'Conv 1', inputs: {}, introduction: '' },
    ],
    currentConversationId: '0',
    handleChangeConversation: vi.fn(),
    handlePinConversation: vi.fn(),
    handleUnpinConversation: vi.fn(),
    conversationRenaming: false,
    handleRenameConversation: vi.fn(),
    handleDeleteConversation: vi.fn(),
    sidebarCollapseState: false,
    handleSidebarCollapse: vi.fn(),
    isMobile: false,
    isResponding: false,
  } as unknown as ChatWithHistoryContextValue

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useChatWithHistoryContext).mockReturnValue(mockContextValue)
  })

  it('should render app title', () => {
    render(<Sidebar />)
    expect(screen.getByText('Test App')).toBeInTheDocument()
  })

  it('should call handleNewConversation when button clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByText('share.chat.newChat'))
    expect(mockContextValue.handleNewConversation).toHaveBeenCalled()
  })

  it('should call handleSidebarCollapse when collapse button clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    // Find the collapse button - it's the first ActionButton
    const collapseButton = screen.getAllByRole('button')[0]
    await user.click(collapseButton)
    expect(mockContextValue.handleSidebarCollapse).toHaveBeenCalledWith(true)
  })

  it('should render conversation lists', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue({
      ...mockContextValue,
      pinnedConversationList: [{ id: 'p1', name: 'Pinned 1', inputs: {}, introduction: '' }],
    } as unknown as ChatWithHistoryContextValue)

    render(<Sidebar />)
    expect(screen.getByText('share.chat.pinnedTitle')).toBeInTheDocument()
    expect(screen.getByText('Pinned 1')).toBeInTheDocument()
    expect(screen.getByText('share.chat.unpinnedTitle')).toBeInTheDocument()
    expect(screen.getByText('Conv 1')).toBeInTheDocument()
  })

  it('should render expand button when sidebar is collapsed', () => {
    vi.mocked(useChatWithHistoryContext).mockReturnValue({
      ...mockContextValue,
      sidebarCollapseState: true,
    } as unknown as ChatWithHistoryContextValue)

    render(<Sidebar />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('should call handleSidebarCollapse with false when expand button clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(useChatWithHistoryContext).mockReturnValue({
      ...mockContextValue,
      sidebarCollapseState: true,
    } as unknown as ChatWithHistoryContextValue)

    render(<Sidebar />)

    const expandButton = screen.getAllByRole('button')[0]
    await user.click(expandButton)
    expect(mockContextValue.handleSidebarCollapse).toHaveBeenCalledWith(false)
  })

  it('should call handlePinConversation when pin operation is triggered', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    const pinButton = screen.getByText('Pin')
    await user.click(pinButton)

    expect(mockContextValue.handlePinConversation).toHaveBeenCalledWith('1')
  })

  it('should call handleUnpinConversation when unpin operation is triggered', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    const unpinButton = screen.getByText('Unpin')
    await user.click(unpinButton)

    expect(mockContextValue.handleUnpinConversation).toHaveBeenCalledWith('1')
  })

  it('should show delete confirmation modal when delete operation is triggered', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    const deleteButton = screen.getByText('Delete')
    await user.click(deleteButton)

    expect(screen.getByText('share.chat.deleteConversation.title')).toBeInTheDocument()

    const confirmButton = screen.getByText('common.operation.confirm')
    await user.click(confirmButton)

    expect(mockContextValue.handleDeleteConversation).toHaveBeenCalledWith('1', expect.any(Object))
  })

  it('should close delete confirmation modal when cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    const deleteButton = screen.getByText('Delete')
    await user.click(deleteButton)

    expect(screen.getByText('share.chat.deleteConversation.title')).toBeInTheDocument()

    const cancelButton = screen.getByText('common.operation.cancel')
    await user.click(cancelButton)

    expect(screen.queryByText('share.chat.deleteConversation.title')).not.toBeInTheDocument()
  })

  it('should show rename modal when rename operation is triggered', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    const renameButton = screen.getByText('Rename')
    await user.click(renameButton)

    expect(screen.getByText('common.chat.renameConversation')).toBeInTheDocument()

    const input = screen.getByDisplayValue('Conv 1') as HTMLInputElement
    await user.click(input)
    await user.clear(input)
    await user.type(input, 'Renamed Conv')

    const saveButton = screen.getByText('common.operation.save')
    await user.click(saveButton)

    expect(mockContextValue.handleRenameConversation).toHaveBeenCalled()
  })

  it('should close rename modal when cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    const renameButton = screen.getByText('Rename')
    await user.click(renameButton)

    expect(screen.getByText('common.chat.renameConversation')).toBeInTheDocument()

    const cancelButton = screen.getByText('common.operation.cancel')
    await user.click(cancelButton)

    expect(screen.queryByText('common.chat.renameConversation')).not.toBeInTheDocument()
  })
})

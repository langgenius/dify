import type { ConversationItem } from '@/models/share'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Item from '../item'

// Mock Operation to verify its usage
vi.mock('@/app/components/base/chat/chat-with-history/sidebar/operation', () => ({
  default: ({ togglePin, onRenameConversation, onDelete, isItemHovering, isActive, isPinned }: { togglePin: () => void, onRenameConversation: () => void, onDelete: () => void, isItemHovering: boolean, isActive: boolean, isPinned: boolean }) => (
    <div data-testid="mock-operation">
      <button onClick={togglePin} data-testid="pin-button">Pin</button>
      <button onClick={onRenameConversation} data-testid="rename-button">Rename</button>
      <button onClick={onDelete} data-testid="delete-button">Delete</button>
      <span data-hovering={isItemHovering} data-testid="hover-indicator">Hovering</span>
      <span data-active={isActive} data-testid="active-indicator">Active</span>
      <span data-pinned={isPinned} data-testid="pinned-indicator">Pinned</span>
    </div>
  ),
}))

describe('Item', () => {
  const mockItem = {
    id: '1',
    name: 'Test Conversation',
    inputs: {},
    introduction: '',
  }

  const defaultProps = {
    item: mockItem,
    onOperate: vi.fn(),
    onChangeConversation: vi.fn(),
    currentConversationId: '0',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render conversation name', () => {
      render(<Item {...defaultProps} />)
      expect(screen.getByText('Test Conversation')).toBeInTheDocument()
    })

    it('should render with title attribute for truncated text', () => {
      render(<Item {...defaultProps} />)
      const nameDiv = screen.getByText('Test Conversation')
      expect(nameDiv).toHaveAttribute('title', 'Test Conversation')
    })

    it('should render with different names', () => {
      const item = { ...mockItem, name: 'Different Conversation' }
      render(<Item {...defaultProps} item={item} />)
      expect(screen.getByText('Different Conversation')).toBeInTheDocument()
    })

    it('should render with very long name', () => {
      const longName = 'A'.repeat(500)
      const item = { ...mockItem, name: longName }
      render(<Item {...defaultProps} item={item} />)
      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should render with special characters in name', () => {
      const item = { ...mockItem, name: 'Chat @#$% 中文' }
      render(<Item {...defaultProps} item={item} />)
      expect(screen.getByText('Chat @#$% 中文')).toBeInTheDocument()
    })

    it('should render with empty name', () => {
      const item = { ...mockItem, name: '' }
      render(<Item {...defaultProps} item={item} />)
      expect(screen.getByTestId('mock-operation')).toBeInTheDocument()
    })

    it('should render with whitespace-only name', () => {
      const item = { ...mockItem, name: '   ' }
      render(<Item {...defaultProps} item={item} />)
      const nameElement = screen.getByText((_, element) => element?.getAttribute('title') === '   ')
      expect(nameElement).toBeInTheDocument()
    })
  })

  describe('Active State', () => {
    it('should show active state when selected', () => {
      const { container } = render(<Item {...defaultProps} currentConversationId="1" />)
      const itemDiv = container.firstChild as HTMLElement
      expect(itemDiv).toHaveClass('bg-state-accent-active')
      expect(itemDiv).toHaveClass('text-text-accent')

      const activeIndicator = screen.getByTestId('active-indicator')
      expect(activeIndicator).toHaveAttribute('data-active', 'true')
    })

    it('should not show active state when not selected', () => {
      const { container } = render(<Item {...defaultProps} currentConversationId="0" />)
      const itemDiv = container.firstChild as HTMLElement
      expect(itemDiv).not.toHaveClass('bg-state-accent-active')

      const activeIndicator = screen.getByTestId('active-indicator')
      expect(activeIndicator).toHaveAttribute('data-active', 'false')
    })

    it('should toggle active state when currentConversationId changes', () => {
      const { rerender, container } = render(<Item {...defaultProps} currentConversationId="0" />)
      expect(container.firstChild).not.toHaveClass('bg-state-accent-active')

      rerender(<Item {...defaultProps} currentConversationId="1" />)
      expect(container.firstChild).toHaveClass('bg-state-accent-active')

      rerender(<Item {...defaultProps} currentConversationId="0" />)
      expect(container.firstChild).not.toHaveClass('bg-state-accent-active')
    })
  })

  describe('Pin State', () => {
    it('should render with isPin true', () => {
      render(<Item {...defaultProps} isPin={true} />)
      const pinnedIndicator = screen.getByTestId('pinned-indicator')
      expect(pinnedIndicator).toHaveAttribute('data-pinned', 'true')
    })

    it('should render with isPin false', () => {
      render(<Item {...defaultProps} isPin={false} />)
      const pinnedIndicator = screen.getByTestId('pinned-indicator')
      expect(pinnedIndicator).toHaveAttribute('data-pinned', 'false')
    })

    it('should render with isPin undefined', () => {
      render(<Item {...defaultProps} />)
      const pinnedIndicator = screen.getByTestId('pinned-indicator')
      expect(pinnedIndicator).toHaveAttribute('data-pinned', 'false')
    })

    it('should call onOperate with unpin when isPinned is true', async () => {
      const user = userEvent.setup()
      const onOperate = vi.fn()
      render(<Item {...defaultProps} onOperate={onOperate} isPin={true} />)

      await user.click(screen.getByTestId('pin-button'))
      expect(onOperate).toHaveBeenCalledWith('unpin', mockItem)
    })

    it('should call onOperate with pin when isPinned is false', async () => {
      const user = userEvent.setup()
      const onOperate = vi.fn()
      render(<Item {...defaultProps} onOperate={onOperate} isPin={false} />)

      await user.click(screen.getByTestId('pin-button'))
      expect(onOperate).toHaveBeenCalledWith('pin', mockItem)
    })

    it('should call onOperate with pin when isPin is undefined', async () => {
      const user = userEvent.setup()
      const onOperate = vi.fn()
      render(<Item {...defaultProps} onOperate={onOperate} />)

      await user.click(screen.getByTestId('pin-button'))
      expect(onOperate).toHaveBeenCalledWith('pin', mockItem)
    })
  })

  describe('Item ID Handling', () => {
    it('should show Operation for non-empty id', () => {
      render(<Item {...defaultProps} item={{ ...mockItem, id: '123' }} />)
      expect(screen.getByTestId('mock-operation')).toBeInTheDocument()
    })

    it('should not show Operation for empty id', () => {
      render(<Item {...defaultProps} item={{ ...mockItem, id: '' }} />)
      expect(screen.queryByTestId('mock-operation')).not.toBeInTheDocument()
    })

    it('should show Operation for id with special characters', () => {
      render(<Item {...defaultProps} item={{ ...mockItem, id: 'abc-123_xyz' }} />)
      expect(screen.getByTestId('mock-operation')).toBeInTheDocument()
    })

    it('should show Operation for numeric id', () => {
      render(<Item {...defaultProps} item={{ ...mockItem, id: '999' }} />)
      expect(screen.getByTestId('mock-operation')).toBeInTheDocument()
    })

    it('should show Operation for uuid-like id', () => {
      const uuid = '123e4567-e89b-12d3-a456-426614174000'
      render(<Item {...defaultProps} item={{ ...mockItem, id: uuid }} />)
      expect(screen.getByTestId('mock-operation')).toBeInTheDocument()
    })
  })

  describe('Click Interactions', () => {
    it('should call onChangeConversation when clicked', async () => {
      const user = userEvent.setup()
      const onChangeConversation = vi.fn()
      render(<Item {...defaultProps} onChangeConversation={onChangeConversation} />)

      await user.click(screen.getByText('Test Conversation'))
      expect(onChangeConversation).toHaveBeenCalledWith('1')
    })

    it('should call onChangeConversation with correct id', async () => {
      const user = userEvent.setup()
      const onChangeConversation = vi.fn()
      const item = { ...mockItem, id: 'custom-id' }
      render(<Item {...defaultProps} item={item} onChangeConversation={onChangeConversation} />)

      await user.click(screen.getByText('Test Conversation'))
      expect(onChangeConversation).toHaveBeenCalledWith('custom-id')
    })

    it('should not propagate click to parent when Operation button is clicked', async () => {
      const user = userEvent.setup()
      const onChangeConversation = vi.fn()
      render(<Item {...defaultProps} onChangeConversation={onChangeConversation} />)

      const deleteButton = screen.getByTestId('delete-button')
      await user.click(deleteButton)

      // onChangeConversation should not be called when Operation button is clicked
      expect(onChangeConversation).not.toHaveBeenCalled()
    })

    it('should call onOperate with delete when delete button clicked', async () => {
      const user = userEvent.setup()
      const onOperate = vi.fn()
      render(<Item {...defaultProps} onOperate={onOperate} />)

      await user.click(screen.getByTestId('delete-button'))
      expect(onOperate).toHaveBeenCalledWith('delete', mockItem)
    })

    it('should call onOperate with rename when rename button clicked', async () => {
      const user = userEvent.setup()
      const onOperate = vi.fn()
      render(<Item {...defaultProps} onOperate={onOperate} />)

      await user.click(screen.getByTestId('rename-button'))
      expect(onOperate).toHaveBeenCalledWith('rename', mockItem)
    })

    it('should handle multiple rapid clicks on different operations', async () => {
      const user = userEvent.setup()
      const onOperate = vi.fn()
      render(<Item {...defaultProps} onOperate={onOperate} />)

      await user.click(screen.getByTestId('rename-button'))
      await user.click(screen.getByTestId('pin-button'))
      await user.click(screen.getByTestId('delete-button'))

      expect(onOperate).toHaveBeenCalledTimes(3)
    })

    it('should call onChangeConversation only once on single click', async () => {
      const user = userEvent.setup()
      const onChangeConversation = vi.fn()
      render(<Item {...defaultProps} onChangeConversation={onChangeConversation} />)

      await user.click(screen.getByText('Test Conversation'))
      expect(onChangeConversation).toHaveBeenCalledTimes(1)
    })

    it('should call onChangeConversation multiple times on multiple clicks', async () => {
      const user = userEvent.setup()
      const onChangeConversation = vi.fn()
      render(<Item {...defaultProps} onChangeConversation={onChangeConversation} />)

      await user.click(screen.getByText('Test Conversation'))
      await user.click(screen.getByText('Test Conversation'))
      await user.click(screen.getByText('Test Conversation'))

      expect(onChangeConversation).toHaveBeenCalledTimes(3)
    })
  })

  describe('Operation Buttons', () => {
    it('should show Operation when item.id is not empty', () => {
      render(<Item {...defaultProps} />)
      expect(screen.getByTestId('mock-operation')).toBeInTheDocument()
    })

    it('should pass correct props to Operation', async () => {
      render(<Item {...defaultProps} isPin={true} currentConversationId="1" />)

      const operation = screen.getByTestId('mock-operation')
      expect(operation).toBeInTheDocument()

      const activeIndicator = screen.getByTestId('active-indicator')
      expect(activeIndicator).toHaveAttribute('data-active', 'true')

      const pinnedIndicator = screen.getByTestId('pinned-indicator')
      expect(pinnedIndicator).toHaveAttribute('data-pinned', 'true')
    })

    it('should handle all three operation types sequentially', async () => {
      const user = userEvent.setup()
      const onOperate = vi.fn()
      render(<Item {...defaultProps} onOperate={onOperate} />)

      await user.click(screen.getByTestId('rename-button'))
      expect(onOperate).toHaveBeenNthCalledWith(1, 'rename', mockItem)

      await user.click(screen.getByTestId('pin-button'))
      expect(onOperate).toHaveBeenNthCalledWith(2, 'pin', mockItem)

      await user.click(screen.getByTestId('delete-button'))
      expect(onOperate).toHaveBeenNthCalledWith(3, 'delete', mockItem)
    })

    it('should handle pin toggle between pin and unpin', async () => {
      const user = userEvent.setup()
      const onOperate = vi.fn()

      const { rerender } = render(
        <Item {...defaultProps} onOperate={onOperate} isPin={false} />,
      )

      await user.click(screen.getByTestId('pin-button'))
      expect(onOperate).toHaveBeenCalledWith('pin', mockItem)

      rerender(<Item {...defaultProps} onOperate={onOperate} isPin={true} />)

      await user.click(screen.getByTestId('pin-button'))
      expect(onOperate).toHaveBeenCalledWith('unpin', mockItem)
    })
  })

  describe('Styling', () => {
    it('should have base classes on container', () => {
      const { container } = render(<Item {...defaultProps} />)
      const itemDiv = container.firstChild as HTMLElement

      expect(itemDiv).toHaveClass('group')
      expect(itemDiv).toHaveClass('flex')
      expect(itemDiv).toHaveClass('cursor-pointer')
      expect(itemDiv).toHaveClass('rounded-lg')
    })

    it('should apply active state classes when selected', () => {
      const { container } = render(<Item {...defaultProps} currentConversationId="1" />)
      const itemDiv = container.firstChild as HTMLElement

      expect(itemDiv).toHaveClass('bg-state-accent-active')
      expect(itemDiv).toHaveClass('text-text-accent')
    })

    it('should apply hover classes', () => {
      const { container } = render(<Item {...defaultProps} />)
      const itemDiv = container.firstChild as HTMLElement

      expect(itemDiv).toHaveClass('hover:bg-state-base-hover')
    })

    it('should maintain hover classes when active', () => {
      const { container } = render(<Item {...defaultProps} currentConversationId="1" />)
      const itemDiv = container.firstChild as HTMLElement

      expect(itemDiv).toHaveClass('hover:bg-state-accent-active')
    })

    it('should apply truncate class to text container', () => {
      const { container } = render(<Item {...defaultProps} />)
      const textDiv = container.querySelector('.grow.truncate')

      expect(textDiv).toHaveClass('truncate')
      expect(textDiv).toHaveClass('grow')
    })
  })

  describe('Props Updates', () => {
    it('should update when item prop changes', () => {
      const { rerender } = render(<Item {...defaultProps} item={mockItem} />)

      expect(screen.getByText('Test Conversation')).toBeInTheDocument()

      const newItem = { ...mockItem, name: 'Updated Conversation' }
      rerender(<Item {...defaultProps} item={newItem} />)

      expect(screen.getByText('Updated Conversation')).toBeInTheDocument()
      expect(screen.queryByText('Test Conversation')).not.toBeInTheDocument()
    })

    it('should update when currentConversationId changes', () => {
      const { container, rerender } = render(
        <Item {...defaultProps} currentConversationId="0" />,
      )

      expect(container.firstChild).not.toHaveClass('bg-state-accent-active')

      rerender(<Item {...defaultProps} currentConversationId="1" />)

      expect(container.firstChild).toHaveClass('bg-state-accent-active')
    })

    it('should update when isPin changes', () => {
      const { rerender } = render(<Item {...defaultProps} isPin={false} />)

      let pinnedIndicator = screen.getByTestId('pinned-indicator')
      expect(pinnedIndicator).toHaveAttribute('data-pinned', 'false')

      rerender(<Item {...defaultProps} isPin={true} />)

      pinnedIndicator = screen.getByTestId('pinned-indicator')
      expect(pinnedIndicator).toHaveAttribute('data-pinned', 'true')
    })

    it('should update when callbacks change', async () => {
      const user = userEvent.setup()
      const oldOnOperate = vi.fn()
      const newOnOperate = vi.fn()

      const { rerender } = render(<Item {...defaultProps} onOperate={oldOnOperate} />)

      rerender(<Item {...defaultProps} onOperate={newOnOperate} />)

      await user.click(screen.getByTestId('delete-button'))

      expect(newOnOperate).toHaveBeenCalledWith('delete', mockItem)
      expect(oldOnOperate).not.toHaveBeenCalled()
    })

    it('should update when multiple props change together', () => {
      const { rerender } = render(
        <Item
          {...defaultProps}
          item={mockItem}
          currentConversationId="0"
          isPin={false}
        />,
      )

      const newItem = { ...mockItem, name: 'New Name', id: '2' }
      rerender(
        <Item
          {...defaultProps}
          item={newItem}
          currentConversationId="2"
          isPin={true}
        />,
      )

      expect(screen.getByText('New Name')).toBeInTheDocument()

      const activeIndicator = screen.getByTestId('active-indicator')
      expect(activeIndicator).toHaveAttribute('data-active', 'true')

      const pinnedIndicator = screen.getByTestId('pinned-indicator')
      expect(pinnedIndicator).toHaveAttribute('data-pinned', 'true')
    })
  })

  describe('Item with Different Data', () => {
    it('should handle item with all properties', () => {
      const item = {
        id: 'full-item',
        name: 'Full Item Name',
        inputs: { key: 'value' },
        introduction: 'Some introduction',
      }
      render(<Item {...defaultProps} item={item} />)

      expect(screen.getByText('Full Item Name')).toBeInTheDocument()
    })

    it('should handle item with minimal properties', () => {
      const item = {
        id: '1',
        name: 'Minimal',
      } as unknown as ConversationItem
      render(<Item {...defaultProps} item={item} />)

      expect(screen.getByText('Minimal')).toBeInTheDocument()
    })

    it('should handle multiple items rendered separately', () => {
      const item1 = { ...mockItem, id: '1', name: 'First' }
      const item2 = { ...mockItem, id: '2', name: 'Second' }

      const { rerender } = render(<Item {...defaultProps} item={item1} />)
      expect(screen.getByText('First')).toBeInTheDocument()

      rerender(<Item {...defaultProps} item={item2} />)
      expect(screen.getByText('Second')).toBeInTheDocument()
      expect(screen.queryByText('First')).not.toBeInTheDocument()
    })
  })

  describe('Hover State', () => {
    it('should pass hover state to Operation when hovering', async () => {
      const { container } = render(<Item {...defaultProps} />)
      const row = container.firstChild as HTMLElement
      const hoverIndicator = screen.getByTestId('hover-indicator')

      expect(hoverIndicator.getAttribute('data-hovering')).toBe('false')

      fireEvent.mouseEnter(row)
      expect(hoverIndicator.getAttribute('data-hovering')).toBe('true')

      fireEvent.mouseLeave(row)
      expect(hoverIndicator.getAttribute('data-hovering')).toBe('false')
    })
  })

  describe('Edge Cases', () => {
    it('should handle item with unicode name', () => {
      const item = { ...mockItem, name: '🎉 Celebration Chat 中文版' }
      render(<Item {...defaultProps} item={item} />)
      expect(screen.getByText('🎉 Celebration Chat 中文版')).toBeInTheDocument()
    })

    it('should handle item with numeric id as string', () => {
      const item = { ...mockItem, id: '12345' }
      render(<Item {...defaultProps} item={item} />)
      expect(screen.getByTestId('mock-operation')).toBeInTheDocument()
    })

    it('should handle rapid isPin prop changes', () => {
      const { rerender } = render(<Item {...defaultProps} isPin={true} />)

      for (let i = 0; i < 5; i++) {
        rerender(<Item {...defaultProps} isPin={i % 2 === 0} />)
      }

      const pinnedIndicator = screen.getByTestId('pinned-indicator')
      expect(pinnedIndicator).toHaveAttribute('data-pinned', 'true')
    })

    it('should handle item name with HTML-like content', () => {
      const item = { ...mockItem, name: '<script>alert("xss")</script>' }
      render(<Item {...defaultProps} item={item} />)
      // Should render as text, not execute
      expect(screen.getByText('<script>alert("xss")</script>')).toBeInTheDocument()
    })

    it('should handle very long item id', () => {
      const longId = 'a'.repeat(1000)
      const item = { ...mockItem, id: longId }
      render(<Item {...defaultProps} item={item} />)
      expect(screen.getByTestId('mock-operation')).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should not re-render when same props are passed', () => {
      const { rerender } = render(<Item {...defaultProps} />)
      const element = screen.getByText('Test Conversation')

      rerender(<Item {...defaultProps} />)
      expect(screen.getByText('Test Conversation')).toBe(element)
    })

    it('should re-render when item changes', () => {
      const { rerender } = render(<Item {...defaultProps} item={mockItem} />)

      const newItem = { ...mockItem, name: 'Changed' }
      rerender(<Item {...defaultProps} item={newItem} />)

      expect(screen.getByText('Changed')).toBeInTheDocument()
    })
  })
})

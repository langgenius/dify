import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Item from './item'

// Mock Operation to verify its usage
vi.mock('@/app/components/base/chat/chat-with-history/sidebar/operation', () => ({
  default: ({ togglePin, onRenameConversation, onDelete, isItemHovering, isActive }: { togglePin: () => void, onRenameConversation: () => void, onDelete: () => void, isItemHovering: boolean, isActive: boolean }) => (
    <div data-testid="mock-operation">
      <button onClick={togglePin}>Pin</button>
      <button onClick={onRenameConversation}>Rename</button>
      <button onClick={onDelete}>Delete</button>
      <span data-hovering={isItemHovering}>Hovering</span>
      <span data-active={isActive}>Active</span>
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

  it('should render conversation name', () => {
    render(<Item {...defaultProps} />)
    expect(screen.getByText('Test Conversation')).toBeInTheDocument()
  })

  it('should call onChangeConversation when clicked', async () => {
    const user = userEvent.setup()
    render(<Item {...defaultProps} />)

    await user.click(screen.getByText('Test Conversation'))
    expect(defaultProps.onChangeConversation).toHaveBeenCalledWith('1')
  })

  it('should show active state when selected', () => {
    const { container } = render(<Item {...defaultProps} currentConversationId="1" />)
    const itemDiv = container.firstChild as HTMLElement
    expect(itemDiv).toHaveClass('bg-state-accent-active')

    const activeIndicator = screen.getByText('Active')
    expect(activeIndicator).toHaveAttribute('data-active', 'true')
  })

  it('should pass correct props to Operation', async () => {
    const user = userEvent.setup()
    render(<Item {...defaultProps} isPin={true} />)

    const operation = screen.getByTestId('mock-operation')
    expect(operation).toBeInTheDocument()

    await user.click(screen.getByText('Pin'))
    expect(defaultProps.onOperate).toHaveBeenCalledWith('unpin', mockItem)

    await user.click(screen.getByText('Rename'))
    expect(defaultProps.onOperate).toHaveBeenCalledWith('rename', mockItem)

    await user.click(screen.getByText('Delete'))
    expect(defaultProps.onOperate).toHaveBeenCalledWith('delete', mockItem)
  })

  it('should not show Operation for empty id items', () => {
    render(<Item {...defaultProps} item={{ ...mockItem, id: '' }} />)
    expect(screen.queryByTestId('mock-operation')).not.toBeInTheDocument()
  })
})

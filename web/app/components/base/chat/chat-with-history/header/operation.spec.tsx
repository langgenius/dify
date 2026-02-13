import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Operation from './operation'

describe('Operation Component', () => {
  const defaultProps = {
    title: 'Chat Title',
    isPinned: false,
    isShowRenameConversation: true,
    isShowDelete: true,
    togglePin: vi.fn(),
    onRenameConversation: vi.fn(),
    onDelete: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the title and toggles dropdown menu', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} />)

    // Verify title
    expect(screen.getByText('Chat Title')).toBeInTheDocument()

    // Menu should be hidden initially
    expect(screen.queryByText('explore.sidebar.action.pin')).not.toBeInTheDocument()

    // Click to open
    await user.click(screen.getByText('Chat Title'))
    expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()

    // Click to close
    await user.click(screen.getByText('Chat Title'))
    expect(screen.queryByText('explore.sidebar.action.pin')).not.toBeInTheDocument()
  })

  it('shows unpin label when isPinned is true', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isPinned={true} />)
    await user.click(screen.getByText('Chat Title'))
    expect(screen.getByText('explore.sidebar.action.unpin')).toBeInTheDocument()
  })

  it('handles rename and delete visibility correctly', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <Operation
        {...defaultProps}
        isShowRenameConversation={false}
        isShowDelete={false}
      />,
    )

    await user.click(screen.getByText('Chat Title'))
    expect(screen.queryByText('explore.sidebar.action.rename')).not.toBeInTheDocument()
    expect(screen.queryByText('share.sidebar.action.delete')).not.toBeInTheDocument()

    rerender(<Operation {...defaultProps} isShowRenameConversation={true} isShowDelete={true} />)
    expect(screen.getByText('explore.sidebar.action.rename')).toBeInTheDocument()
    expect(screen.getByText('explore.sidebar.action.delete')).toBeInTheDocument()
  })

  it('invokes callbacks when menu items are clicked', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} />)
    await user.click(screen.getByText('Chat Title'))

    // Toggle Pin
    await user.click(screen.getByText('explore.sidebar.action.pin'))
    expect(defaultProps.togglePin).toHaveBeenCalledTimes(1)

    // Rename
    await user.click(screen.getByText('explore.sidebar.action.rename'))
    expect(defaultProps.onRenameConversation).toHaveBeenCalledTimes(1)

    // Delete
    await user.click(screen.getByText('explore.sidebar.action.delete'))
    expect(defaultProps.onDelete).toHaveBeenCalledTimes(1)
  })

  it('applies hover background when open', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} />)
    // Find trigger container by text and traverse to interactive container using a more robust selector
    const trigger = screen.getByText('Chat Title').closest('.cursor-pointer')

    // closed state
    expect(trigger).not.toHaveClass('bg-state-base-hover')

    // open state
    await user.click(screen.getByText('Chat Title'))
    expect(trigger).toHaveClass('bg-state-base-hover')
  })
})

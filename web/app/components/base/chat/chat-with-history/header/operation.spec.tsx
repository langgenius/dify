import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Operation from './operation'

// Mock FloatingPortal to render children in the normal DOM flow
vi.mock('@floating-ui/react', async () => {
  const actual = await vi.importActual('@floating-ui/react')
  return {
    ...actual,
    FloatingPortal: ({ children }: { children: React.ReactNode }) => <div data-floating-ui-portal>{children}</div>,
  }
})

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

  it('renders the title and toggles dropdown menu', () => {
    render(<Operation {...defaultProps} />)

    // Verify title
    expect(screen.getByText('Chat Title')).toBeInTheDocument()

    // Menu should be hidden initially
    expect(screen.queryByText('explore.sidebar.action.pin')).not.toBeInTheDocument()

    // Click to open
    fireEvent.click(screen.getByText('Chat Title'))
    expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()

    // Click to close
    fireEvent.click(screen.getByText('Chat Title'))
    expect(screen.queryByText('explore.sidebar.action.pin')).not.toBeInTheDocument()
  })

  it('shows unpin label when isPinned is true', () => {
    render(<Operation {...defaultProps} isPinned={true} />)
    fireEvent.click(screen.getByText('Chat Title'))
    expect(screen.getByText('explore.sidebar.action.unpin')).toBeInTheDocument()
  })

  it('handles rename and delete visibility correctly', () => {
    const { rerender } = render(
      <Operation
        {...defaultProps}
        isShowRenameConversation={false}
        isShowDelete={false}
      />,
    )

    fireEvent.click(screen.getByText('Chat Title'))
    expect(screen.queryByText('explore.sidebar.action.rename')).not.toBeInTheDocument()
    expect(screen.queryByText('share.sidebar.action.delete')).not.toBeInTheDocument()

    rerender(<Operation {...defaultProps} isShowRenameConversation={true} isShowDelete={true} />)
    expect(screen.getByText('explore.sidebar.action.rename')).toBeInTheDocument()
    expect(screen.getByText('explore.sidebar.action.delete')).toBeInTheDocument()
  })

  it('invokes callbacks when menu items are clicked', () => {
    render(<Operation {...defaultProps} />)
    fireEvent.click(screen.getByText('Chat Title'))

    // Toggle Pin
    fireEvent.click(screen.getByText('explore.sidebar.action.pin'))
    expect(defaultProps.togglePin).toHaveBeenCalledTimes(1)

    // Rename
    fireEvent.click(screen.getByText('explore.sidebar.action.rename'))
    expect(defaultProps.onRenameConversation).toHaveBeenCalledTimes(1)

    // Delete
    fireEvent.click(screen.getByText('explore.sidebar.action.delete'))
    expect(defaultProps.onDelete).toHaveBeenCalledTimes(1)
  })

  it('applies hover background when open', () => {
    render(<Operation {...defaultProps} />)
    const trigger = screen.getByText('Chat Title').parentElement!

    expect(trigger).not.toHaveClass('bg-state-base-hover')

    fireEvent.click(trigger)
    expect(trigger).toHaveClass('bg-state-base-hover')
  })
})

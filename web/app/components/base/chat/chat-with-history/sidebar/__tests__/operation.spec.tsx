import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import Operation from '../operation'

describe('Operation', () => {
  const getTrigger = () => screen.getByRole('button', { name: 'common.operation.more' })
  const defaultProps = {
    isActive: false,
    isItemHovering: false,
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

  it('should render more icon button', () => {
    render(<Operation {...defaultProps} />)
    expect(getTrigger()).toBeInTheDocument()
  })

  it('should toggle dropdown when clicked', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isItemHovering={true} />)

    const trigger = getTrigger()
    await user.click(trigger)

    expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()
  })

  it('should call togglePin when pin/unpin is clicked', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} />)

    await user.click(getTrigger())
    await user.click(screen.getByText('explore.sidebar.action.pin'))

    expect(defaultProps.togglePin).toHaveBeenCalled()
  })

  it('should show unpin label when isPinned is true', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isPinned={true} />)

    await user.click(getTrigger())
    expect(screen.getByText('explore.sidebar.action.unpin')).toBeInTheDocument()
  })

  it('should call onRenameConversation when rename is clicked', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} />)

    await user.click(getTrigger())
    await user.click(screen.getByText('explore.sidebar.action.rename'))

    await waitFor(() => {
      expect(defaultProps.onRenameConversation).toHaveBeenCalled()
    })
  })

  it('should call onDelete when delete is clicked', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} />)

    await user.click(getTrigger())
    await user.click(screen.getByText('explore.sidebar.action.delete'))

    await waitFor(() => {
      expect(defaultProps.onDelete).toHaveBeenCalled()
    })
  })

  it('should respect visibility props', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isShowRenameConversation={false} />)

    await user.click(getTrigger())
    expect(screen.queryByText('explore.sidebar.action.rename')).not.toBeInTheDocument()
  })

  it('should hide rename action when isShowRenameConversation is false', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isShowRenameConversation={false} isShowDelete={false} />)

    await user.click(getTrigger())
    expect(screen.queryByText('explore.sidebar.action.rename')).not.toBeInTheDocument()
    expect(screen.queryByText('explore.sidebar.action.delete')).not.toBeInTheDocument()
  })

  it('should handle hover state on dropdown menu', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isItemHovering={true} />)

    await user.click(getTrigger())

    expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()
  })

  it('should let the menu primitive own open state when item hovering stops', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Operation {...defaultProps} isItemHovering={true} />)

    await user.click(getTrigger())
    expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()

    rerender(<Operation {...defaultProps} isItemHovering={false} />)

    expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()
    expect(getTrigger()).toHaveAttribute('data-popup-open')
  })

  it('should keep the trigger mounted while visually hidden', () => {
    render(<Operation {...defaultProps} isItemHovering={false} />)

    const trigger = getTrigger()
    expect(trigger).toHaveClass('pointer-events-none')
    expect(trigger).toHaveClass('opacity-0')
  })

  it('should safely ignore rename clicks when callback is missing', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} onRenameConversation={undefined} />)

    await user.click(getTrigger())
    await user.click(screen.getByText('explore.sidebar.action.rename'))

    await waitFor(() => {
      expect(screen.queryByText('explore.sidebar.action.rename')).not.toBeInTheDocument()
    })
  })

  it('should not bubble trigger clicks to the parent container', async () => {
    const user = userEvent.setup()
    const parentClick = vi.fn()

    render(<Operation {...defaultProps} />)
    document.body.addEventListener('click', parentClick)

    await user.click(getTrigger())
    document.body.removeEventListener('click', parentClick)

    expect(parentClick).not.toHaveBeenCalled()
  })

  it('should not bubble popup clicks to the parent container', async () => {
    const user = userEvent.setup()
    const parentClick = vi.fn()

    render(<Operation {...defaultProps} isItemHovering={true} />)
    document.body.addEventListener('click', parentClick)

    await user.click(getTrigger())
    await user.click(screen.getByRole('menu'))
    document.body.removeEventListener('click', parentClick)

    expect(parentClick).not.toHaveBeenCalled()
  })
})

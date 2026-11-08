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

  it.each([false, true])('invokes pin toggling for pinned=%s', async (isPinned) => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isPinned={isPinned} />)

    await user.click(getTrigger())
    await user.click(
      screen.getByRole('menuitem', {
        name: isPinned ? 'explore.sidebar.action.unpin' : 'explore.sidebar.action.pin',
      }),
    )

    expect(defaultProps.togglePin).toHaveBeenCalled()
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

  it('should hide rename action when isShowRenameConversation is false', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isShowRenameConversation={false} isShowDelete={false} />)

    await user.click(getTrigger())
    expect(screen.queryByText('explore.sidebar.action.rename')).not.toBeInTheDocument()
    expect(screen.queryByText('explore.sidebar.action.delete')).not.toBeInTheDocument()
  })

  it('should let the menu primitive own open state when item hovering stops', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Operation {...defaultProps} isItemHovering={true} />)

    await user.click(getTrigger())
    expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()

    rerender(<Operation {...defaultProps} isItemHovering={false} />)

    expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')
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

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import Operation from '../operation'

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

  it('handles rename and delete visibility correctly', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <Operation {...defaultProps} isShowRenameConversation={false} isShowDelete={false} />,
    )

    await user.click(screen.getByRole('button', { name: 'Chat Title' }))
    expect(screen.queryByText('explore.sidebar.action.rename')).not.toBeInTheDocument()
    expect(screen.queryByText('explore.sidebar.action.delete')).not.toBeInTheDocument()

    rerender(<Operation {...defaultProps} isShowRenameConversation={true} isShowDelete={true} />)
    expect(screen.getByText('explore.sidebar.action.rename')).toBeInTheDocument()
    expect(screen.getByText('explore.sidebar.action.delete')).toBeInTheDocument()
  })

  it('invokes callbacks when menu items are clicked', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Operation {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: 'Chat Title' }))

    // Toggle Pin
    await user.click(screen.getByText('explore.sidebar.action.pin'))
    expect(defaultProps.togglePin).toHaveBeenCalledTimes(1)

    rerender(<Operation {...defaultProps} isPinned />)
    await user.click(screen.getByRole('button', { name: 'Chat Title' }))
    await user.click(screen.getByRole('menuitem', { name: 'explore.sidebar.action.unpin' }))
    expect(defaultProps.togglePin).toHaveBeenCalledTimes(2)

    // Rename
    await user.click(screen.getByRole('button', { name: 'Chat Title' }))
    await user.click(screen.getByText('explore.sidebar.action.rename'))
    await waitFor(() => {
      expect(defaultProps.onRenameConversation).toHaveBeenCalledTimes(1)
    })

    // Delete
    await user.click(screen.getByRole('button', { name: 'Chat Title' }))
    await user.click(screen.getByText('explore.sidebar.action.delete'))
    await waitFor(() => {
      expect(defaultProps.onDelete).toHaveBeenCalledTimes(1)
    })
  })
})

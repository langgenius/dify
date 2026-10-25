import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import MobileOperationDropdown from '../mobile-operation-dropdown'

describe('MobileOperationDropdown Component', () => {
  const defaultProps = {
    handleResetChat: vi.fn(),
    handleViewChatSettings: vi.fn(),
  }

  it('handles hideViewChatSettings prop correctly', async () => {
    const user = userEvent.setup()
    render(<MobileOperationDropdown {...defaultProps} hideViewChatSettings={true} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

    expect(screen.getByText('share.chat.resetChat')).toBeInTheDocument()
    expect(screen.queryByText('share.chat.viewChatSettings')).not.toBeInTheDocument()
  })

  it('invokes callbacks when menu items are clicked', async () => {
    const user = userEvent.setup()
    render(<MobileOperationDropdown {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

    await user.click(screen.getByText('share.chat.resetChat'))
    await waitFor(() => {
      expect(defaultProps.handleResetChat).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('share.chat.viewChatSettings'))
    await waitFor(() => {
      expect(defaultProps.handleViewChatSettings).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })
})

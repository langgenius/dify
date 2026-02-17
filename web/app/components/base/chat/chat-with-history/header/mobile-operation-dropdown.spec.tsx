import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MobileOperationDropdown from './mobile-operation-dropdown'

describe('MobileOperationDropdown Component', () => {
  const defaultProps = {
    handleResetChat: vi.fn(),
    handleViewChatSettings: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the trigger button and toggles dropdown menu', async () => {
    const user = userEvent.setup()
    render(<MobileOperationDropdown {...defaultProps} />)

    // Trigger button should be present (ActionButton renders a button)
    const trigger = screen.getByRole('button')
    expect(trigger).toBeInTheDocument()

    // Menu should be hidden initially
    expect(screen.queryByText('share.chat.resetChat')).not.toBeInTheDocument()

    // Click to open
    await user.click(trigger)
    expect(screen.getByText('share.chat.resetChat')).toBeInTheDocument()
    expect(screen.getByText('share.chat.viewChatSettings')).toBeInTheDocument()

    // Click to close
    await user.click(trigger)
    expect(screen.queryByText('share.chat.resetChat')).not.toBeInTheDocument()
  })

  it('handles hideViewChatSettings prop correctly', async () => {
    const user = userEvent.setup()
    render(<MobileOperationDropdown {...defaultProps} hideViewChatSettings={true} />)

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('share.chat.resetChat')).toBeInTheDocument()
    expect(screen.queryByText('share.chat.viewChatSettings')).not.toBeInTheDocument()
  })

  it('invokes callbacks when menu items are clicked', async () => {
    const user = userEvent.setup()
    render(<MobileOperationDropdown {...defaultProps} />)

    await user.click(screen.getByRole('button'))

    // Reset Chat
    await user.click(screen.getByText('share.chat.resetChat'))
    expect(defaultProps.handleResetChat).toHaveBeenCalledTimes(1)

    // View Chat Settings
    await user.click(screen.getByText('share.chat.viewChatSettings'))
    expect(defaultProps.handleViewChatSettings).toHaveBeenCalledTimes(1)
  })

  it('applies hover state to ActionButton when open', async () => {
    const user = userEvent.setup()
    render(<MobileOperationDropdown {...defaultProps} />)
    const trigger = screen.getByRole('button')

    // closed state
    expect(trigger).not.toHaveClass('action-btn-hover')

    // open state
    await user.click(trigger)
    expect(trigger).toHaveClass('action-btn-hover')
  })
})

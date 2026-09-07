import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import MobileOperationDropdown from '../mobile-operation-dropdown'

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

    const trigger = screen.getByRole('button', { name: 'common.operation.more' })
    expect(trigger).toBeInTheDocument()

    expect(screen.queryByText('share.chat.resetChat')).not.toBeInTheDocument()

    await user.click(trigger)
    expect(screen.getByText('share.chat.resetChat')).toBeInTheDocument()
    expect(screen.getByText('share.chat.viewChatSettings')).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.queryByText('share.chat.resetChat')).not.toBeInTheDocument()
  })

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
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('share.chat.viewChatSettings'))
    await waitFor(() => {
      expect(defaultProps.handleViewChatSettings).toHaveBeenCalledTimes(1)
    })
  })

  it('exposes popup-open state on the trigger', async () => {
    const user = userEvent.setup()
    render(<MobileOperationDropdown {...defaultProps} />)
    const trigger = screen.getByRole('button', { name: 'common.operation.more' })

    expect(trigger).not.toHaveAttribute('data-popup-open')

    await user.click(trigger)
    expect(trigger).toHaveAttribute('data-popup-open')
  })

  it('closes the menu after clicking an action', async () => {
    const user = userEvent.setup()
    render(<MobileOperationDropdown {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('share.chat.resetChat'))

    await waitFor(() => {
      expect(screen.queryByText('share.chat.resetChat')).not.toBeInTheDocument()
    })
  })
})

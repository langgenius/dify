import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MobileOperationDropdown from './mobile-operation-dropdown'

// Mock FloatingPortal to render children in the normal DOM flow
vi.mock('@floating-ui/react', async () => {
  const actual = await vi.importActual('@floating-ui/react')
  return {
    ...actual,
    FloatingPortal: ({ children }: { children: React.ReactNode }) => <div data-floating-ui-portal>{children}</div>,
  }
})

describe('MobileOperationDropdown Component', () => {
  const defaultProps = {
    handleResetChat: vi.fn(),
    handleViewChatSettings: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the trigger button and toggles dropdown menu', () => {
    render(<MobileOperationDropdown {...defaultProps} />)

    // Trigger button should be present (ActionButton renders a button)
    const trigger = screen.getByRole('button')
    expect(trigger).toBeInTheDocument()

    // Menu should be hidden initially
    expect(screen.queryByText('share.chat.resetChat')).not.toBeInTheDocument()

    // Click to open
    fireEvent.click(trigger)
    expect(screen.getByText('share.chat.resetChat')).toBeInTheDocument()
    expect(screen.getByText('share.chat.viewChatSettings')).toBeInTheDocument()

    // Click to close
    fireEvent.click(trigger)
    expect(screen.queryByText('share.chat.resetChat')).not.toBeInTheDocument()
  })

  it('handles hideViewChatSettings prop correctly', () => {
    render(<MobileOperationDropdown {...defaultProps} hideViewChatSettings={true} />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('share.chat.resetChat')).toBeInTheDocument()
    expect(screen.queryByText('share.chat.viewChatSettings')).not.toBeInTheDocument()
  })

  it('invokes callbacks when menu items are clicked', () => {
    render(<MobileOperationDropdown {...defaultProps} />)

    fireEvent.click(screen.getByRole('button'))

    // Reset Chat
    fireEvent.click(screen.getByText('share.chat.resetChat'))
    expect(defaultProps.handleResetChat).toHaveBeenCalledTimes(1)

    // View Chat Settings
    fireEvent.click(screen.getByText('share.chat.viewChatSettings'))
    expect(defaultProps.handleViewChatSettings).toHaveBeenCalledTimes(1)
  })

  it('applies hover state to ActionButton when open', () => {
    render(<MobileOperationDropdown {...defaultProps} />)
    const trigger = screen.getByRole('button')

    // closed state
    expect(trigger).not.toHaveClass('action-btn-hover')

    // open state
    fireEvent.click(trigger)
    expect(trigger).toHaveClass('action-btn-hover')
  })
})

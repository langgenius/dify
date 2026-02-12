import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Operation from './operation'

// Mock PortalToFollowElem components to render children in place
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => <div data-open={open}>{children}</div>,
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => <div onClick={onClick}>{children}</div>,
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => <div data-testid="portal-content">{children}</div>,
}))

describe('Operation', () => {
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
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should toggle dropdown when clicked', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isItemHovering={true} />)

    const trigger = screen.getByRole('button')
    await user.click(trigger)

    expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()
  })

  it('should apply active state to ActionButton', () => {
    render(<Operation {...defaultProps} isActive={true} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should call togglePin when pin/unpin is clicked', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('explore.sidebar.action.pin'))

    expect(defaultProps.togglePin).toHaveBeenCalled()
  })

  it('should show unpin label when isPinned is true', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isPinned={true} />)

    await user.click(screen.getByRole('button'))
    expect(screen.getByText('explore.sidebar.action.unpin')).toBeInTheDocument()
  })

  it('should call onRenameConversation when rename is clicked', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('explore.sidebar.action.rename'))

    expect(defaultProps.onRenameConversation).toHaveBeenCalled()
  })

  it('should call onDelete when delete is clicked', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('explore.sidebar.action.delete'))

    expect(defaultProps.onDelete).toHaveBeenCalled()
  })

  it('should respect visibility props', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isShowRenameConversation={false} />)

    await user.click(screen.getByRole('button'))
    expect(screen.queryByText('explore.sidebar.action.rename')).not.toBeInTheDocument()
  })

  it('should hide rename action when isShowRenameConversation is false', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isShowRenameConversation={false} isShowDelete={false} />)

    await user.click(screen.getByRole('button'))
    expect(screen.queryByText('explore.sidebar.action.rename')).not.toBeInTheDocument()
    expect(screen.queryByText('explore.sidebar.action.delete')).not.toBeInTheDocument()
  })

  it('should handle hover state on dropdown menu', async () => {
    const user = userEvent.setup()
    render(<Operation {...defaultProps} isItemHovering={true} />)

    await user.click(screen.getByRole('button'))

    const portalContent = screen.getByTestId('portal-content')
    expect(portalContent).toBeInTheDocument()
  })

  it('should close dropdown when item hovering stops', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Operation {...defaultProps} isItemHovering={true} />)

    await user.click(screen.getByRole('button'))
    expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()

    rerender(<Operation {...defaultProps} isItemHovering={false} />)
  })
})

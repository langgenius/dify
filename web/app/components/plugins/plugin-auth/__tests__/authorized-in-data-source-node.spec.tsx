import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AuthorizedInDataSourceNode from '../authorized-in-data-source-node'

vi.mock('@langgenius/dify-ui/status-dot', () => ({
  StatusDot: ({ status }: { status: string }) => (
    <span data-testid="indicator" data-status={status} />
  ),
}))

describe('AuthorizedInDataSourceNode', () => {
  const mockOnJump = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders with green indicator', () => {
    render(<AuthorizedInDataSourceNode authorizationsNum={1} onJumpToDataSourcePage={mockOnJump} />)
    expect(screen.getByTestId('indicator')).toHaveAttribute('data-status', 'success')
  })

  it('renders singular text for 1 authorization', () => {
    render(<AuthorizedInDataSourceNode authorizationsNum={1} onJumpToDataSourcePage={mockOnJump} />)
    expect(screen.getByText('plugin.auth.authorization')).toBeInTheDocument()
  })

  it('renders plural text for multiple authorizations', () => {
    render(<AuthorizedInDataSourceNode authorizationsNum={3} onJumpToDataSourcePage={mockOnJump} />)
    expect(screen.getByText('plugin.auth.authorizations')).toBeInTheDocument()
  })

  it('calls onJumpToDataSourcePage when button is clicked', () => {
    render(<AuthorizedInDataSourceNode authorizationsNum={1} onJumpToDataSourcePage={mockOnJump} />)
    fireEvent.click(screen.getByRole('button'))
    expect(mockOnJump).toHaveBeenCalledTimes(1)
  })

  it('renders settings button', () => {
    render(<AuthorizedInDataSourceNode authorizationsNum={1} onJumpToDataSourcePage={mockOnJump} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})

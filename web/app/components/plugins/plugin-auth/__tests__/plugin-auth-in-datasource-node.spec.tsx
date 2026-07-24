import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PluginAuthInDataSourceNode from '../plugin-auth-in-datasource-node'

describe('PluginAuthInDataSourceNode', () => {
  const mockOnJump = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders connect button when not authorized', () => {
    render(<PluginAuthInDataSourceNode onJumpToDataSourcePage={mockOnJump} />)
    expect(screen.getByText('common.integrations.connect')).toBeInTheDocument()
  })

  it('renders connect button', () => {
    render(<PluginAuthInDataSourceNode onJumpToDataSourcePage={mockOnJump} />)
    expect(screen.getByRole('button', { name: /common\.integrations\.connect/ })).toBeInTheDocument()
  })

  it('calls onJumpToDataSourcePage when connect button is clicked', () => {
    render(<PluginAuthInDataSourceNode onJumpToDataSourcePage={mockOnJump} />)
    fireEvent.click(screen.getByRole('button', { name: /common\.integrations\.connect/ }))
    expect(mockOnJump).toHaveBeenCalledTimes(1)
  })

  it('hides connect button and shows children when authorized', () => {
    render(
      <PluginAuthInDataSourceNode isAuthorized onJumpToDataSourcePage={mockOnJump}>
        <div data-testid="child-content">Data Source Connected</div>
      </PluginAuthInDataSourceNode>,
    )
    expect(screen.queryByText('common.integrations.connect')).not.toBeInTheDocument()
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  it('shows connect button when isAuthorized is false', () => {
    render(
      <PluginAuthInDataSourceNode isAuthorized={false} onJumpToDataSourcePage={mockOnJump}>
        <div data-testid="child-content">Data Source Connected</div>
      </PluginAuthInDataSourceNode>,
    )
    expect(screen.getByText('common.integrations.connect')).toBeInTheDocument()
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
  })
})

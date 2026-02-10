import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PluginAuthInDataSourceNode from './plugin-auth-in-datasource-node'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'integrations.connect': 'Connect',
      }
      return map[key] || key
    },
  }),
}))

vi.mock('@remixicon/react', () => ({
  RiAddLine: () => <span data-testid="add-icon" />,
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, variant, className }: { children: React.ReactNode, onClick?: () => void, variant?: string, className?: string }) => (
    <button data-testid="button" data-variant={variant} className={className} onClick={onClick}>{children}</button>
  ),
}))

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
    expect(screen.getByText('Connect')).toBeInTheDocument()
    expect(screen.getByTestId('add-icon')).toBeInTheDocument()
  })

  it('renders connect button with primary variant', () => {
    render(<PluginAuthInDataSourceNode onJumpToDataSourcePage={mockOnJump} />)
    expect(screen.getByTestId('button')).toHaveAttribute('data-variant', 'primary')
  })

  it('calls onJumpToDataSourcePage when connect button is clicked', () => {
    render(<PluginAuthInDataSourceNode onJumpToDataSourcePage={mockOnJump} />)
    fireEvent.click(screen.getByTestId('button'))
    expect(mockOnJump).toHaveBeenCalledTimes(1)
  })

  it('hides connect button and shows children when authorized', () => {
    render(
      <PluginAuthInDataSourceNode isAuthorized onJumpToDataSourcePage={mockOnJump}>
        <div data-testid="child-content">Data Source Connected</div>
      </PluginAuthInDataSourceNode>,
    )
    expect(screen.queryByText('Connect')).not.toBeInTheDocument()
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  it('shows connect button when isAuthorized is false', () => {
    render(
      <PluginAuthInDataSourceNode isAuthorized={false} onJumpToDataSourcePage={mockOnJump}>
        <div data-testid="child-content">Data Source Connected</div>
      </PluginAuthInDataSourceNode>,
    )
    expect(screen.getByText('Connect')).toBeInTheDocument()
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
  })
})

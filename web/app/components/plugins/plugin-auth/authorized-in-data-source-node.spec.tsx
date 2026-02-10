import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AuthorizedInDataSourceNode from './authorized-in-data-source-node'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'auth.authorization': '1 Authorization',
        'auth.authorizations': 'Multiple Authorizations',
      }
      return map[key] || key
    },
  }),
}))

vi.mock('@remixicon/react', () => ({
  RiEqualizer2Line: () => <span data-testid="equalizer-icon" />,
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, size }: { children: React.ReactNode, onClick?: () => void, size?: string }) => (
    <button data-testid="button" data-size={size} onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <span data-testid="indicator" data-color={color} />,
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
    expect(screen.getByTestId('indicator')).toHaveAttribute('data-color', 'green')
  })

  it('renders singular text for 1 authorization', () => {
    render(<AuthorizedInDataSourceNode authorizationsNum={1} onJumpToDataSourcePage={mockOnJump} />)
    expect(screen.getByText('1 Authorization')).toBeInTheDocument()
  })

  it('renders plural text for multiple authorizations', () => {
    render(<AuthorizedInDataSourceNode authorizationsNum={3} onJumpToDataSourcePage={mockOnJump} />)
    expect(screen.getByText('Multiple Authorizations')).toBeInTheDocument()
  })

  it('calls onJumpToDataSourcePage when button is clicked', () => {
    render(<AuthorizedInDataSourceNode authorizationsNum={1} onJumpToDataSourcePage={mockOnJump} />)
    fireEvent.click(screen.getByTestId('button'))
    expect(mockOnJump).toHaveBeenCalledTimes(1)
  })

  it('renders equalizer icon', () => {
    render(<AuthorizedInDataSourceNode authorizationsNum={1} onJumpToDataSourcePage={mockOnJump} />)
    expect(screen.getByTestId('equalizer-icon')).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Header from '../header'

vi.mock('@/app/components/base/button', () => ({
  default: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}))

vi.mock('@/app/components/base/divider', () => ({
  default: () => <span data-testid="divider" />,
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="tooltip">{children}</div>,
}))

vi.mock('../credential-selector', () => ({
  default: () => <div data-testid="credential-selector" />,
}))

describe('Header', () => {
  const defaultProps = {
    docTitle: 'Documentation',
    docLink: 'https://docs.example.com',
    onClickConfiguration: vi.fn(),
    pluginName: 'TestPlugin',
    credentials: [],
    currentCredentialId: '',
    onCredentialChange: vi.fn(),
  }

  it('should render doc link with title', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByText('Documentation')).toBeInTheDocument()
  })

  it('should render credential selector', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByTestId('credential-selector')).toBeInTheDocument()
  })

  it('should link to external doc', () => {
    render(<Header {...defaultProps} />)
    const link = screen.getByText('Documentation').closest('a')
    expect(link).toHaveAttribute('href', 'https://docs.example.com')
    expect(link).toHaveAttribute('target', '_blank')
  })
})

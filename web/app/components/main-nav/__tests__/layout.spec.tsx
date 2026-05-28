import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import MainNavLayout from '../layout'

vi.mock('@/app/components/header', () => ({
  default: () => <div data-testid="desktop-header">Header</div>,
}))

vi.mock('@/app/components/header/header-wrapper', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="header-wrapper">{children}</div>,
}))

vi.mock('../index', () => ({
  default: ({ className }: { className?: string }) => <aside className={className} data-testid="main-nav">MainNav</aside>,
}))

describe('MainNavLayout', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders desktop main nav instead of the desktop header', () => {
    render(<MainNavLayout><div>content</div></MainNavLayout>)

    expect(screen.getByTestId('main-nav')).toBeInTheDocument()
    expect(screen.queryByTestId('desktop-header')).not.toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('uses the main nav without the desktop header wrapper', () => {
    render(<MainNavLayout><div>content</div></MainNavLayout>)

    expect(screen.getByTestId('main-nav')).toBeInTheDocument()
    expect(screen.queryByTestId('header-wrapper')).not.toBeInTheDocument()
    expect(screen.queryByTestId('desktop-header')).not.toBeInTheDocument()
  })
})

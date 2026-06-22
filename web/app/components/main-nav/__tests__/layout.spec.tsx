import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import MainNavLayout from '../layout'

vi.mock('@/app/components/header', () => ({
  default: () => <div data-testid="desktop-header">Header</div>,
}))

vi.mock('@/app/components/header/header-wrapper', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="header-wrapper">{children}</div>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
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

  it('renders one main landmark as the skip navigation target', () => {
    render(<MainNavLayout><div>content</div></MainNavLayout>)

    const main = screen.getByRole('main')

    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(main).toHaveAttribute('id', 'main-content')
    expect(main).toHaveAttribute('tabIndex', '-1')
    expect(main).toHaveClass('outline-hidden', 'focus:outline-hidden', 'focus-visible:outline-hidden')
    expect(main).toHaveTextContent('content')
  })

  it('renders skip navigation before the repeated main navigation', () => {
    const { container } = render(<MainNavLayout><div>content</div></MainNavLayout>)

    const skipLink = screen.getByRole('link', { name: 'navigation.skipToMain' })

    expect(skipLink).toHaveAttribute('href', '#main-content')
    expect(skipLink).toHaveClass('outline-hidden', 'focus-visible:ring-2', 'focus-visible:ring-state-accent-solid')
    expect(container.querySelector('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).toBe(skipLink)
  })

  it('moves focus to the main content when skip navigation is activated', () => {
    render(<MainNavLayout><div>content</div></MainNavLayout>)

    const skipLink = screen.getByRole('link', { name: 'navigation.skipToMain' })
    const main = screen.getByRole('main')

    fireEvent.click(skipLink)

    expect(main).toHaveFocus()
  })
})

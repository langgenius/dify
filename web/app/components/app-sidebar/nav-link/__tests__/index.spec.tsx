import type { NavLinkProps } from '..'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import NavLink from '..'

// Mock Next.js navigation
vi.mock('@/next/navigation', () => ({
  useSelectedLayoutSegment: () => 'overview',
}))

// Mock Next.js Link component
vi.mock('@/next/link', () => ({
  default: function MockLink({
    children,
    href,
    className,
    title,
  }: {
    children: React.ReactNode
    href: string
    className?: string
    title?: string
  }) {
    return (
      <a href={href} className={className} title={title} data-testid="nav-link">
        {children}
      </a>
    )
  },
}))

describe('NavLink', () => {
  const mockProps: NavLinkProps = {
    name: 'Orchestrate',
    href: '/app/123/workflow',
    iconMap: {
      selected: 'i-ri-terminal-window-fill',
      normal: 'i-ri-terminal-window-line',
    },
  }

  describe('Active State Handling', () => {
    it('links to the selected destination with its accessible name', () => {
      render(<NavLink {...mockProps} href="/app/123/overview" />)

      expect(screen.getByRole('link', { name: 'Orchestrate' })).toHaveAttribute(
        'href',
        '/app/123/overview',
      )
    })
  })

  describe('Disabled State', () => {
    it('should render as button when disabled', () => {
      render(<NavLink {...mockProps} mode="expand" disabled={true} />)

      const buttonElement = screen.getByRole('button')
      expect(buttonElement).toBeInTheDocument()
      expect(buttonElement).toBeDisabled()
      expect(buttonElement).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Button Mode', () => {
    it('should render as an interactive button when href is omitted', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()

      render(<NavLink {...mockProps} href={undefined} active={true} onClick={onClick} />)

      const buttonElement = screen.getByRole('button', { name: 'Orchestrate' })

      await user.click(buttonElement)
      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })
})

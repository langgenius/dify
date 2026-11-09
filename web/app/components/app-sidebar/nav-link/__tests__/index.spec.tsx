import type { NavLinkProps } from '..'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import NavLink from '..'

// Mock Next.js navigation
vi.mock('@/next/navigation', () => ({
  useSelectedLayoutSegment: () => 'overview',
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
    it('prevents navigation when disabled', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      render(<NavLink {...mockProps} mode="expand" disabled onClick={onClick} />)

      const buttonElement = screen.getByRole('button', { name: 'Orchestrate' })
      expect(buttonElement).toBeDisabled()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      await user.click(buttonElement)
      expect(onClick).not.toHaveBeenCalled()
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

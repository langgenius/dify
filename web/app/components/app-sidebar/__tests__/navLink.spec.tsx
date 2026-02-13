import type { NavLinkProps } from '../components/navLink'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import NavLink from '../components/navLink'

const mockSegment = vi.fn().mockReturnValue('overview')
vi.mock('next/navigation', () => ({
  useSelectedLayoutSegment: () => mockSegment(),
}))

vi.mock('next/link', () => ({
  default: function MockLink({ children, href, className, title }: { children: React.ReactNode, href: string, className?: string, title?: string }) {
    return (
      <a href={href} className={className} title={title} data-testid="nav-link">
        {children}
      </a>
    )
  },
}))

const MockIcon = ({ className }: { className?: string }) => (
  <svg className={className} data-testid="nav-icon" />
)

describe('NavLink Animation and Layout Issues', () => {
  const mockProps: NavLinkProps = {
    name: 'Orchestrate',
    href: '/app/123/workflow',
    iconMap: {
      selected: MockIcon,
      normal: MockIcon,
    },
  }

  beforeEach(() => {
    mockSegment.mockReturnValue('overview')
    Object.defineProperty(window, 'getComputedStyle', {
      value: vi.fn((element: HTMLElement) => {
        const isExpanded = element.getAttribute('data-mode') === 'expand'
        return {
          transition: 'all 0.3s ease',
          opacity: isExpanded ? '1' : '0',
          width: isExpanded ? 'auto' : '0px',
          overflow: 'hidden',
          paddingLeft: isExpanded ? '12px' : '10px',
          paddingRight: isExpanded ? '12px' : '10px',
        }
      }),
      writable: true,
    })
  })

  describe('Text Squeeze Animation Issue', () => {
    it('should show text squeeze effect when switching from collapse to expand', async () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      const textElement = screen.getByText('Orchestrate')
      expect(textElement).toHaveClass('opacity-0', 'max-w-0', 'overflow-hidden')
      expect(screen.getByTestId('nav-icon')).toBeInTheDocument()

      const linkElement = screen.getByTestId('nav-link')
      expect(linkElement).toHaveClass('pl-3', 'pr-1')

      rerender(<NavLink {...mockProps} mode="expand" />)

      expect(linkElement).toHaveClass('pl-3', 'pr-1')
      const expandedTextElement = screen.getByText('Orchestrate')
      expect(expandedTextElement).toHaveClass('max-w-none', 'opacity-100')
    })

    it('should maintain icon position consistency using wrapper div', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      const iconElement = screen.getByTestId('nav-icon')
      expect(iconElement.parentElement).toHaveClass('-ml-1')

      rerender(<NavLink {...mockProps} mode="expand" />)
      expect(screen.getByTestId('nav-icon').parentElement).not.toHaveClass('-ml-1')
      expect(iconElement).toHaveClass('h-4', 'w-4', 'shrink-0')
    })

    it('should provide smooth text transition with max-width animation', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      const collapsedText = screen.getByText('Orchestrate')
      expect(collapsedText).toHaveClass('opacity-0', 'max-w-0', 'overflow-hidden')

      rerender(<NavLink {...mockProps} mode="expand" />)
      const expandedText = screen.getByText('Orchestrate')
      expect(expandedText).toHaveClass('opacity-100', 'max-w-none')
    })
  })

  describe('Layout Consistency Improvements', () => {
    it('should maintain consistent padding across all states', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)
      const linkElement = screen.getByTestId('nav-link')
      expect(linkElement).toHaveClass('pl-3', 'pr-1')

      rerender(<NavLink {...mockProps} mode="expand" />)
      expect(linkElement).toHaveClass('pl-3', 'pr-1')
    })

    it('should use wrapper-based icon positioning', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)
      const iconElement = screen.getByTestId('nav-icon')
      expect(iconElement.parentElement).toHaveClass('-ml-1')
      expect(iconElement).toHaveClass('h-4', 'w-4', 'shrink-0')

      rerender(<NavLink {...mockProps} mode="expand" />)
      expect(screen.getByTestId('nav-icon').parentElement).not.toHaveClass('-ml-1')
      expect(iconElement).toHaveClass('h-4', 'w-4', 'shrink-0')
    })
  })

  describe('Active State Handling', () => {
    it('should handle active state correctly in both modes', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)
      let linkElement = screen.getByTestId('nav-link')
      expect(linkElement).not.toHaveClass('bg-components-menu-item-bg-active')

      rerender(<NavLink {...{ ...mockProps, href: '/app/123/overview' }} mode="expand" />)
      linkElement = screen.getByTestId('nav-link')
      expect(linkElement).toHaveClass('bg-components-menu-item-bg-active', 'text-text-accent-light-mode-only')
    })

    it('should map annotations segment to logs for matching', () => {
      mockSegment.mockReturnValue('annotations')
      render(<NavLink {...{ ...mockProps, href: '/app/123/logs' }} mode="expand" />)
      const linkElement = screen.getByTestId('nav-link')
      expect(linkElement).toHaveClass('bg-components-menu-item-bg-active')
    })
  })

  describe('Text Animation Classes', () => {
    it('should have proper text classes in collapsed mode', () => {
      render(<NavLink {...mockProps} mode="collapse" />)
      const textElement = screen.getByText('Orchestrate')
      expect(textElement).toHaveClass('overflow-hidden', 'whitespace-nowrap', 'transition-all', 'duration-200', 'ease-in-out', 'ml-0', 'max-w-0', 'opacity-0')
    })

    it('should have proper text classes in expanded mode', () => {
      render(<NavLink {...mockProps} mode="expand" />)
      const textElement = screen.getByText('Orchestrate')
      expect(textElement).toHaveClass('overflow-hidden', 'whitespace-nowrap', 'transition-all', 'duration-200', 'ease-in-out', 'ml-2', 'max-w-none', 'opacity-100')
    })
  })

  describe('Disabled State', () => {
    it('should render as button when disabled', () => {
      render(<NavLink {...mockProps} mode="expand" disabled={true} />)
      const buttonElement = screen.getByRole('button')
      expect(buttonElement).toBeDisabled()
      expect(buttonElement).toHaveClass('cursor-not-allowed', 'opacity-30')
    })

    it('should maintain consistent styling in disabled state', () => {
      render(<NavLink {...mockProps} mode="collapse" disabled={true} />)
      const buttonElement = screen.getByRole('button')
      expect(buttonElement).toHaveClass('pl-3', 'pr-1')
      expect(screen.getByTestId('nav-icon').parentElement).toHaveClass('-ml-1')
    })
  })
})

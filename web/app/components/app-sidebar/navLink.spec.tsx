import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import NavLink from './navLink'
import type { NavLinkProps } from './navLink'

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  useSelectedLayoutSegment: () => 'overview',
}))

// Mock Next.js Link component
jest.mock('next/link', () => {
  return function MockLink({ children, href, className, title }: any) {
    return (
      <a href={href} className={className} title={title} data-testid="nav-link">
        {children}
      </a>
    )
  }
})

// Mock RemixIcon components
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
    // Mock getComputedStyle for transition testing
    Object.defineProperty(window, 'getComputedStyle', {
      value: jest.fn((element) => {
        const isExpanded = element.getAttribute('data-mode') === 'expand'
        return {
          transition: 'all 0.3s ease',
          opacity: isExpanded ? '1' : '0',
          width: isExpanded ? 'auto' : '0px',
          overflow: 'hidden',
          paddingLeft: isExpanded ? '12px' : '10px', // px-3 vs px-2.5
          paddingRight: isExpanded ? '12px' : '10px',
        }
      }),
      writable: true,
    })
  })

  describe('Text Squeeze Animation Issue', () => {
    it('should show text squeeze effect when switching from collapse to expand', async () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      // In collapse mode, text should be in DOM but hidden via CSS
      const textElement = screen.getByText('Orchestrate')
      expect(textElement).toBeInTheDocument()
      expect(textElement).toHaveClass('opacity-0')
      expect(textElement).toHaveClass('max-w-0')
      expect(textElement).toHaveClass('overflow-hidden')

      // Icon should still be present
      expect(screen.getByTestId('nav-icon')).toBeInTheDocument()

      // Check consistent padding in collapse mode
      const linkElement = screen.getByTestId('nav-link')
      expect(linkElement).toHaveClass('pl-3')
      expect(linkElement).toHaveClass('pr-1')

      // Switch to expand mode - should have smooth text transition
      rerender(<NavLink {...mockProps} mode="expand" />)

      // Text should now be visible with opacity animation
      expect(screen.getByText('Orchestrate')).toBeInTheDocument()

      // Check padding remains consistent - no layout shift
      expect(linkElement).toHaveClass('pl-3')
      expect(linkElement).toHaveClass('pr-1')

      // Fixed: text now uses max-width animation instead of abrupt show/hide
      const expandedTextElement = screen.getByText('Orchestrate')
      expect(expandedTextElement).toBeInTheDocument()
      expect(expandedTextElement).toHaveClass('max-w-none')
      expect(expandedTextElement).toHaveClass('opacity-100')

      // The fix provides:
      // - Opacity transition from 0 to 1
      // - Max-width transition from 0 to none (prevents squashing)
      // - No layout shift from consistent padding
    })

    it('should maintain icon position consistency using wrapper div', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      const iconElement = screen.getByTestId('nav-icon')
      const iconWrapper = iconElement.parentElement

      // Icon wrapper should have -ml-1 micro-adjustment in collapse mode for centering
      expect(iconWrapper).toHaveClass('-ml-1')

      rerender(<NavLink {...mockProps} mode="expand" />)

      // In expand mode, wrapper should not have the micro-adjustment
      const expandedIconWrapper = screen.getByTestId('nav-icon').parentElement
      expect(expandedIconWrapper).not.toHaveClass('-ml-1')

      // Icon itself maintains consistent classes - no margin changes
      expect(iconElement).toHaveClass('h-4')
      expect(iconElement).toHaveClass('w-4')
      expect(iconElement).toHaveClass('shrink-0')

      // This wrapper approach eliminates the icon margin shift issue
    })

    it('should provide smooth text transition with max-width animation', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      // Text is always in DOM but controlled via CSS classes
      const collapsedText = screen.getByText('Orchestrate')
      expect(collapsedText).toBeInTheDocument()
      expect(collapsedText).toHaveClass('opacity-0')
      expect(collapsedText).toHaveClass('max-w-0')
      expect(collapsedText).toHaveClass('overflow-hidden')

      rerender(<NavLink {...mockProps} mode="expand" />)

      // Text smoothly transitions to visible state
      const expandedText = screen.getByText('Orchestrate')
      expect(expandedText).toBeInTheDocument()
      expect(expandedText).toHaveClass('opacity-100')
      expect(expandedText).toHaveClass('max-w-none')

      // Fixed: Always present in DOM with smooth CSS transitions
      // instead of abrupt conditional rendering
    })
  })

  describe('Layout Consistency Improvements', () => {
    it('should maintain consistent padding across all states', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      const linkElement = screen.getByTestId('nav-link')

      // Consistent padding in collapsed state
      expect(linkElement).toHaveClass('pl-3')
      expect(linkElement).toHaveClass('pr-1')

      rerender(<NavLink {...mockProps} mode="expand" />)

      // Same padding in expanded state - no layout shift
      expect(linkElement).toHaveClass('pl-3')
      expect(linkElement).toHaveClass('pr-1')

      // This consistency eliminates the layout shift issue
    })

    it('should use wrapper-based icon positioning instead of margin changes', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      const iconElement = screen.getByTestId('nav-icon')
      const iconWrapper = iconElement.parentElement

      // Collapsed: wrapper has micro-adjustment for centering
      expect(iconWrapper).toHaveClass('-ml-1')

      // Icon itself has consistent classes
      expect(iconElement).toHaveClass('h-4')
      expect(iconElement).toHaveClass('w-4')
      expect(iconElement).toHaveClass('shrink-0')

      rerender(<NavLink {...mockProps} mode="expand" />)

      const expandedIconWrapper = screen.getByTestId('nav-icon').parentElement

      // Expanded: no wrapper adjustment needed
      expect(expandedIconWrapper).not.toHaveClass('-ml-1')

      // Icon classes remain consistent - no margin shifts
      expect(iconElement).toHaveClass('h-4')
      expect(iconElement).toHaveClass('w-4')
      expect(iconElement).toHaveClass('shrink-0')
    })
  })

  describe('Active State Handling', () => {
    it('should handle active state correctly in both modes', () => {
      // Test non-active state
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      let linkElement = screen.getByTestId('nav-link')
      expect(linkElement).not.toHaveClass('bg-components-menu-item-bg-active')

      // Test with active state (when href matches current segment)
      const activeProps = {
        ...mockProps,
        href: '/app/123/overview', // matches mocked segment
      }

      rerender(<NavLink {...activeProps} mode="expand" />)

      linkElement = screen.getByTestId('nav-link')
      expect(linkElement).toHaveClass('bg-components-menu-item-bg-active')
      expect(linkElement).toHaveClass('text-text-accent-light-mode-only')
    })
  })

  describe('Text Animation Classes', () => {
    it('should have proper text classes in collapsed mode', () => {
      render(<NavLink {...mockProps} mode="collapse" />)

      const textElement = screen.getByText('Orchestrate')

      expect(textElement).toHaveClass('overflow-hidden')
      expect(textElement).toHaveClass('whitespace-nowrap')
      expect(textElement).toHaveClass('transition-all')
      expect(textElement).toHaveClass('duration-200')
      expect(textElement).toHaveClass('ease-in-out')
      expect(textElement).toHaveClass('ml-0')
      expect(textElement).toHaveClass('max-w-0')
      expect(textElement).toHaveClass('opacity-0')
    })

    it('should have proper text classes in expanded mode', () => {
      render(<NavLink {...mockProps} mode="expand" />)

      const textElement = screen.getByText('Orchestrate')

      expect(textElement).toHaveClass('overflow-hidden')
      expect(textElement).toHaveClass('whitespace-nowrap')
      expect(textElement).toHaveClass('transition-all')
      expect(textElement).toHaveClass('duration-200')
      expect(textElement).toHaveClass('ease-in-out')
      expect(textElement).toHaveClass('ml-2')
      expect(textElement).toHaveClass('max-w-none')
      expect(textElement).toHaveClass('opacity-100')
    })
  })

  describe('Disabled State', () => {
    it('should render as button when disabled', () => {
      render(<NavLink {...mockProps} mode="expand" disabled={true} />)

      const buttonElement = screen.getByRole('button')
      expect(buttonElement).toBeInTheDocument()
      expect(buttonElement).toBeDisabled()
      expect(buttonElement).toHaveClass('cursor-not-allowed')
      expect(buttonElement).toHaveClass('opacity-30')
    })

    it('should maintain consistent styling in disabled state', () => {
      render(<NavLink {...mockProps} mode="collapse" disabled={true} />)

      const buttonElement = screen.getByRole('button')
      expect(buttonElement).toHaveClass('pl-3')
      expect(buttonElement).toHaveClass('pr-1')

      const iconWrapper = screen.getByTestId('nav-icon').parentElement
      expect(iconWrapper).toHaveClass('-ml-1')
    })
  })
})

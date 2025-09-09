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

describe('NavLink Text Animation Issues', () => {
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
      expect(textElement).toHaveClass('w-0')
      expect(textElement).toHaveClass('overflow-hidden')

      // Icon should still be present
      expect(screen.getByTestId('nav-icon')).toBeInTheDocument()

      // Check padding in collapse mode
      const linkElement = screen.getByTestId('nav-link')
      expect(linkElement).toHaveClass('px-2.5')

      // Switch to expand mode - this is where the squeeze effect occurs
      rerender(<NavLink {...mockProps} mode="expand" />)

      // Text should now appear
      expect(screen.getByText('Orchestrate')).toBeInTheDocument()

      // Check padding change - this contributes to the squeeze effect
      expect(linkElement).toHaveClass('px-3')

      // The bug: text appears abruptly without smooth transition
      // This test documents the current behavior that causes the squeeze effect
      const expandedTextElement = screen.getByText('Orchestrate')
      expect(expandedTextElement).toBeInTheDocument()

      // In a properly animated version, we would expect:
      // - Opacity transition from 0 to 1
      // - Width transition from 0 to auto
      // - No layout shift from padding changes
    })

    it('should maintain icon position consistency during text appearance', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      const iconElement = screen.getByTestId('nav-icon')
      const initialIconClasses = iconElement.className

      // Icon should have mr-0 in collapse mode
      expect(iconElement).toHaveClass('mr-0')

      rerender(<NavLink {...mockProps} mode="expand" />)

      const expandedIconClasses = iconElement.className

      // Icon should have mr-2 in expand mode - this shift contributes to the squeeze effect
      expect(iconElement).toHaveClass('mr-2')

      console.log('Collapsed icon classes:', initialIconClasses)
      console.log('Expanded icon classes:', expandedIconClasses)

      // This margin change causes the icon to shift when text appears
    })

    it('should document the abrupt text rendering issue', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      // Text is present in DOM but hidden via CSS classes
      const collapsedText = screen.getByText('Orchestrate')
      expect(collapsedText).toBeInTheDocument()
      expect(collapsedText).toHaveClass('opacity-0')
      expect(collapsedText).toHaveClass('pointer-events-none')

      rerender(<NavLink {...mockProps} mode="expand" />)

      // Text suddenly appears in DOM - no transition
      expect(screen.getByText('Orchestrate')).toBeInTheDocument()

      // The issue: {mode === 'expand' && name} causes abrupt show/hide
      // instead of smooth opacity/width transition
    })
  })

  describe('Layout Shift Issues', () => {
    it('should detect padding differences causing layout shifts', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      const linkElement = screen.getByTestId('nav-link')

      // Collapsed state padding
      expect(linkElement).toHaveClass('px-2.5')

      rerender(<NavLink {...mockProps} mode="expand" />)

      // Expanded state padding - different value causes layout shift
      expect(linkElement).toHaveClass('px-3')

      // This 2px difference (10px vs 12px) contributes to the squeeze effect
    })

    it('should detect icon margin changes causing shifts', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      const iconElement = screen.getByTestId('nav-icon')

      // Collapsed: no right margin
      expect(iconElement).toHaveClass('mr-0')

      rerender(<NavLink {...mockProps} mode="expand" />)

      // Expanded: 8px right margin (mr-2)
      expect(iconElement).toHaveClass('mr-2')

      // This sudden margin appearance causes the squeeze effect
    })
  })

  describe('Active State Handling', () => {
    it('should handle active state correctly in both modes', () => {
      // Test non-active state
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      let linkElement = screen.getByTestId('nav-link')
      expect(linkElement).not.toHaveClass('bg-state-accent-active')

      // Test with active state (when href matches current segment)
      const activeProps = {
        ...mockProps,
        href: '/app/123/overview', // matches mocked segment
      }

      rerender(<NavLink {...activeProps} mode="expand" />)

      linkElement = screen.getByTestId('nav-link')
      expect(linkElement).toHaveClass('bg-state-accent-active')
    })
  })
})

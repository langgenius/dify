import type { NavLinkProps } from '..'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import NavLink from '..'

// Mock Next.js navigation
vi.mock('@/next/navigation', () => ({
  useSelectedLayoutSegment: () => 'overview',
}))

// Mock Next.js Link component
vi.mock('@/next/link', () => ({
  default: function MockLink({ children, href, className, title }: { children: React.ReactNode, href: string, className?: string, title?: string }) {
    return (
      <a href={href} className={className} title={title} data-testid="nav-link">
        {children}
      </a>
    )
  },
}))

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
      value: vi.fn((element) => {
        const isExpanded = element.getAttribute('data-mode') === 'expand'
        const style = {
          transition: 'all 0.3s ease',
          opacity: isExpanded ? '1' : '0',
          width: isExpanded ? 'auto' : '0px',
          overflow: 'hidden',
          paddingLeft: isExpanded ? '12px' : '10px', // px-3 vs px-2.5
          paddingRight: isExpanded ? '12px' : '10px',
        }
        return {
          ...style,
          getPropertyValue: (property: keyof typeof style) => style[property] ?? '',
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

      // Check Figma collapsed icon-only sizing.
      const linkElement = screen.getByTestId('nav-link')
      expect(linkElement).toHaveClass('size-8')
      expect(linkElement).toHaveClass('p-1.5')

      // Switch to expand mode - should have smooth text transition
      rerender(<NavLink {...mockProps} mode="expand" />)

      // Text should now be visible with opacity animation
      expect(screen.getByText('Orchestrate')).toBeInTheDocument()

      // Expanded state returns to the full-width navigation item.
      const expandedLinkElement = screen.getByTestId('nav-link')
      expect(expandedLinkElement).toHaveClass('pl-3')
      expect(expandedLinkElement).toHaveClass('pr-1')

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

      // Icon wrapper should center the icon in the collapsed button.
      expect(iconWrapper).toHaveClass('flex')
      expect(iconWrapper).toHaveClass('size-5')
      expect(iconWrapper).toHaveClass('items-center')
      expect(iconWrapper).toHaveClass('justify-center')

      rerender(<NavLink {...mockProps} mode="expand" />)

      // In expand mode, wrapper should keep the fixed icon slot.
      const expandedIconWrapper = screen.getByTestId('nav-icon').parentElement
      expect(expandedIconWrapper).toHaveClass('flex')
      expect(expandedIconWrapper).toHaveClass('size-5')
      expect(expandedIconWrapper).toHaveClass('items-center')
      expect(expandedIconWrapper).toHaveClass('justify-center')

      // Icon itself uses the fixed glyph size.
      const expandedIconElement = screen.getByTestId('nav-icon')
      expect(expandedIconElement).toHaveClass('size-[18px]')
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

      // Collapsed state uses a fixed icon-only button.
      expect(linkElement).toHaveClass('size-8')
      expect(linkElement).toHaveClass('p-1.5')

      rerender(<NavLink {...mockProps} mode="expand" />)

      // Expanded state uses text item padding.
      const expandedLinkElement = screen.getByTestId('nav-link')
      expect(expandedLinkElement).toHaveClass('pl-3')
      expect(expandedLinkElement).toHaveClass('pr-1')

      // This consistency eliminates the layout shift issue
    })

    it('should use wrapper-based icon positioning instead of margin changes', () => {
      const { rerender } = render(<NavLink {...mockProps} mode="collapse" />)

      const iconElement = screen.getByTestId('nav-icon')
      const iconWrapper = iconElement.parentElement

      // Collapsed: wrapper centers the icon in the 32px item.
      expect(iconWrapper).toHaveClass('flex')
      expect(iconWrapper).toHaveClass('size-5')
      expect(iconWrapper).toHaveClass('items-center')
      expect(iconWrapper).toHaveClass('justify-center')

      // Icon itself uses the larger collapsed glyph size.
      expect(iconElement).toHaveClass('size-[18px]')
      expect(iconElement).toHaveClass('shrink-0')

      rerender(<NavLink {...mockProps} mode="expand" />)

      const expandedIconWrapper = screen.getByTestId('nav-icon').parentElement

      // Expanded: wrapper still centers the 18px icon in a 20px slot.
      expect(expandedIconWrapper).toHaveClass('flex')
      expect(expandedIconWrapper).toHaveClass('size-5')
      expect(expandedIconWrapper).toHaveClass('items-center')
      expect(expandedIconWrapper).toHaveClass('justify-center')

      // Icon keeps the same fixed glyph size.
      const expandedIconElement = screen.getByTestId('nav-icon')
      expect(expandedIconElement).toHaveClass('size-[18px]')
      expect(expandedIconElement).toHaveClass('shrink-0')
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

    it('should not mark logs active on the annotations pathname', () => {
      render(
        <NavLink
          {...mockProps}
          href="/app/123/logs"
          pathname="/app/123/annotations"
        />,
      )

      const linkElement = screen.getByRole('link', { name: 'Orchestrate' })
      expect(linkElement).not.toHaveClass('bg-components-menu-item-bg-active')
    })

    it('should use pathname to mark annotations active when rendered outside the app detail route segment', () => {
      render(
        <NavLink
          {...mockProps}
          href="/app/123/annotations"
          pathname="/app/123/annotations"
        />,
      )

      const linkElement = screen.getByRole('link', { name: 'Orchestrate' })
      expect(linkElement).toHaveClass('bg-components-menu-item-bg-active')
    })
  })

  describe('Text Animation Classes', () => {
    it('should have proper text classes in collapsed mode', () => {
      render(<NavLink {...mockProps} mode="collapse" />)

      const textElement = screen.getByText('Orchestrate')

      expect(textElement).toHaveClass('overflow-hidden')
      expect(textElement).toHaveClass('whitespace-nowrap')
      expect(textElement).toHaveClass('transition-[margin-left,max-width,opacity]')
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
      expect(textElement).toHaveClass('transition-[margin-left,max-width,opacity]')
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
      expect(buttonElement).toHaveClass('size-8')
      expect(buttonElement).toHaveClass('p-1.5')

      const iconWrapper = screen.getByTestId('nav-icon').parentElement
      expect(iconWrapper).toHaveClass('size-5')
    })
  })

  describe('Button Mode', () => {
    it('should render as an interactive button when href is omitted', () => {
      const onClick = vi.fn()

      render(<NavLink {...mockProps} href={undefined} active={true} onClick={onClick} />)

      const buttonElement = screen.getByText('Orchestrate').closest('button')
      expect(buttonElement).not.toBeNull()
      expect(buttonElement).toHaveClass('bg-components-menu-item-bg-active')
      expect(buttonElement).toHaveClass('text-text-accent-light-mode-only')

      buttonElement?.click()
      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })
})

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Theme } from '@/types/app'
import IconWithTooltip from './icon-with-tooltip'

// Mock Tooltip component
vi.mock('@/app/components/base/tooltip', () => ({
  default: ({
    children,
    popupContent,
    popupClassName,
  }: {
    children: React.ReactNode
    popupContent?: string
    popupClassName?: string
  }) => (
    <div data-testid="tooltip" data-popup-content={popupContent} data-popup-classname={popupClassName}>
      {children}
    </div>
  ),
}))

// Mock icon components
const MockLightIcon = ({ className }: { className?: string }) => (
  <div data-testid="light-icon" className={className}>Light Icon</div>
)

const MockDarkIcon = ({ className }: { className?: string }) => (
  <div data-testid="dark-icon" className={className}>Dark Icon</div>
)

describe('IconWithTooltip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(
        <IconWithTooltip
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
        />,
      )

      expect(screen.getByTestId('tooltip')).toBeInTheDocument()
    })

    it('should render Tooltip wrapper', () => {
      render(
        <IconWithTooltip
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
          popupContent="Test tooltip"
        />,
      )

      expect(screen.getByTestId('tooltip')).toHaveAttribute('data-popup-content', 'Test tooltip')
    })

    it('should apply correct popupClassName to Tooltip', () => {
      render(
        <IconWithTooltip
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
        />,
      )

      const tooltip = screen.getByTestId('tooltip')
      expect(tooltip).toHaveAttribute('data-popup-classname')
      expect(tooltip.getAttribute('data-popup-classname')).toContain('border-components-panel-border')
    })
  })

  describe('Theme Handling', () => {
    it('should render light icon when theme is light', () => {
      render(
        <IconWithTooltip
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
        />,
      )

      expect(screen.getByTestId('light-icon')).toBeInTheDocument()
      expect(screen.queryByTestId('dark-icon')).not.toBeInTheDocument()
    })

    it('should render dark icon when theme is dark', () => {
      render(
        <IconWithTooltip
          theme={Theme.dark}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
        />,
      )

      expect(screen.getByTestId('dark-icon')).toBeInTheDocument()
      expect(screen.queryByTestId('light-icon')).not.toBeInTheDocument()
    })

    it('should render light icon when theme is system (not dark)', () => {
      render(
        <IconWithTooltip
          theme={'system' as Theme}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
        />,
      )

      // When theme is not 'dark', it should use light icon
      expect(screen.getByTestId('light-icon')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className to icon', () => {
      render(
        <IconWithTooltip
          className="custom-class"
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
        />,
      )

      const icon = screen.getByTestId('light-icon')
      expect(icon).toHaveClass('custom-class')
    })

    it('should apply default h-5 w-5 class to icon', () => {
      render(
        <IconWithTooltip
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
        />,
      )

      const icon = screen.getByTestId('light-icon')
      expect(icon).toHaveClass('h-5')
      expect(icon).toHaveClass('w-5')
    })

    it('should merge custom className with default classes', () => {
      render(
        <IconWithTooltip
          className="ml-2"
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
        />,
      )

      const icon = screen.getByTestId('light-icon')
      expect(icon).toHaveClass('h-5')
      expect(icon).toHaveClass('w-5')
      expect(icon).toHaveClass('ml-2')
    })

    it('should pass popupContent to Tooltip', () => {
      render(
        <IconWithTooltip
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
          popupContent="Custom tooltip content"
        />,
      )

      expect(screen.getByTestId('tooltip')).toHaveAttribute(
        'data-popup-content',
        'Custom tooltip content',
      )
    })

    it('should handle undefined popupContent', () => {
      render(
        <IconWithTooltip
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
        />,
      )

      expect(screen.getByTestId('tooltip')).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // The component is exported as React.memo(IconWithTooltip)
      expect(IconWithTooltip).toBeDefined()
      // Check if it's a memo component
      expect(typeof IconWithTooltip).toBe('object')
    })
  })

  describe('Container Structure', () => {
    it('should render icon inside flex container', () => {
      const { container } = render(
        <IconWithTooltip
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
        />,
      )

      const flexContainer = container.querySelector('.flex.shrink-0.items-center.justify-center')
      expect(flexContainer).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty className', () => {
      render(
        <IconWithTooltip
          className=""
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
        />,
      )

      expect(screen.getByTestId('light-icon')).toBeInTheDocument()
    })

    it('should handle long popupContent', () => {
      const longContent = 'A'.repeat(500)
      render(
        <IconWithTooltip
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
          popupContent={longContent}
        />,
      )

      expect(screen.getByTestId('tooltip')).toHaveAttribute('data-popup-content', longContent)
    })

    it('should handle special characters in popupContent', () => {
      const specialContent = '<script>alert("xss")</script> & "quotes"'
      render(
        <IconWithTooltip
          theme={Theme.light}
          BadgeIconLight={MockLightIcon}
          BadgeIconDark={MockDarkIcon}
          popupContent={specialContent}
        />,
      )

      expect(screen.getByTestId('tooltip')).toHaveAttribute('data-popup-content', specialContent)
    })
  })
})

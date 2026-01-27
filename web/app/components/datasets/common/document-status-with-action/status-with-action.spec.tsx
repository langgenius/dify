import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StatusWithAction from './status-with-action'

describe('StatusWithAction', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<StatusWithAction description="Test description" />)
      expect(screen.getByText('Test description')).toBeInTheDocument()
    })

    it('should render description text', () => {
      render(<StatusWithAction description="This is a test message" />)
      expect(screen.getByText('This is a test message')).toBeInTheDocument()
    })

    it('should render icon based on type', () => {
      const { container } = render(<StatusWithAction type="success" description="Success" />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should default to info type when type is not provided', () => {
      const { container } = render(<StatusWithAction description="Default type" />)
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('text-text-accent')
    })

    it('should render success type with correct color', () => {
      const { container } = render(<StatusWithAction type="success" description="Success" />)
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('text-text-success')
    })

    it('should render error type with correct color', () => {
      const { container } = render(<StatusWithAction type="error" description="Error" />)
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('text-text-destructive')
    })

    it('should render warning type with correct color', () => {
      const { container } = render(<StatusWithAction type="warning" description="Warning" />)
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('text-text-warning-secondary')
    })

    it('should render info type with correct color', () => {
      const { container } = render(<StatusWithAction type="info" description="Info" />)
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('text-text-accent')
    })

    it('should render action button when actionText and onAction are provided', () => {
      const onAction = vi.fn()
      render(
        <StatusWithAction
          description="Test"
          actionText="Click me"
          onAction={onAction}
        />,
      )
      expect(screen.getByText('Click me')).toBeInTheDocument()
    })

    it('should not render action button when onAction is not provided', () => {
      render(<StatusWithAction description="Test" actionText="Click me" />)
      expect(screen.queryByText('Click me')).not.toBeInTheDocument()
    })

    it('should render divider when action is present', () => {
      const { container } = render(
        <StatusWithAction
          description="Test"
          actionText="Click me"
          onAction={() => {}}
        />,
      )
      // Divider component renders a div with specific classes
      expect(container.querySelector('.bg-divider-regular')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onAction when action button is clicked', () => {
      const onAction = vi.fn()
      render(
        <StatusWithAction
          description="Test"
          actionText="Click me"
          onAction={onAction}
        />,
      )

      fireEvent.click(screen.getByText('Click me'))
      expect(onAction).toHaveBeenCalledTimes(1)
    })

    it('should call onAction even when disabled (style only)', () => {
      // Note: disabled prop only affects styling, not actual click behavior
      const onAction = vi.fn()
      render(
        <StatusWithAction
          description="Test"
          actionText="Click me"
          onAction={onAction}
          disabled
        />,
      )

      fireEvent.click(screen.getByText('Click me'))
      expect(onAction).toHaveBeenCalledTimes(1)
    })

    it('should apply disabled styles when disabled prop is true', () => {
      render(
        <StatusWithAction
          description="Test"
          actionText="Click me"
          onAction={() => {}}
          disabled
        />,
      )

      const actionButton = screen.getByText('Click me')
      expect(actionButton).toHaveClass('cursor-not-allowed')
      expect(actionButton).toHaveClass('text-text-disabled')
    })
  })

  describe('Status Background Gradients', () => {
    it('should apply success gradient background', () => {
      const { container } = render(<StatusWithAction type="success" description="Success" />)
      const gradientDiv = container.querySelector('.opacity-40')
      expect(gradientDiv?.className).toContain('rgba(23,178,106,0.25)')
    })

    it('should apply warning gradient background', () => {
      const { container } = render(<StatusWithAction type="warning" description="Warning" />)
      const gradientDiv = container.querySelector('.opacity-40')
      expect(gradientDiv?.className).toContain('rgba(247,144,9,0.25)')
    })

    it('should apply error gradient background', () => {
      const { container } = render(<StatusWithAction type="error" description="Error" />)
      const gradientDiv = container.querySelector('.opacity-40')
      expect(gradientDiv?.className).toContain('rgba(240,68,56,0.25)')
    })

    it('should apply info gradient background', () => {
      const { container } = render(<StatusWithAction type="info" description="Info" />)
      const gradientDiv = container.querySelector('.opacity-40')
      expect(gradientDiv?.className).toContain('rgba(11,165,236,0.25)')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty description', () => {
      const { container } = render(<StatusWithAction description="" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle long description text', () => {
      const longText = 'A'.repeat(500)
      render(<StatusWithAction description={longText} />)
      expect(screen.getByText(longText)).toBeInTheDocument()
    })

    it('should handle undefined actionText when onAction is provided', () => {
      render(<StatusWithAction description="Test" onAction={() => {}} />)
      // Should render without throwing
      expect(screen.getByText('Test')).toBeInTheDocument()
    })
  })
})

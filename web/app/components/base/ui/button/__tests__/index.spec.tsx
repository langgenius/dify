import { fireEvent, render, screen } from '@testing-library/react'
import { Button } from '../index'

describe('Button', () => {
  describe('rendering', () => {
    it('renders children text', () => {
      render(<Button>Click me</Button>)
      expect(screen.getByRole('button')).toHaveTextContent('Click me')
    })

    it('renders as a native button element by default', () => {
      render(<Button>Click me</Button>)
      expect(screen.getByRole('button').tagName).toBe('BUTTON')
    })

    it('defaults to type="button"', () => {
      render(<Button>Click me</Button>)
      expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
    })

    it('allows type override to submit', () => {
      render(<Button type="submit">Submit</Button>)
      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
    })

    it('renders custom element via render prop', () => {
      render(<Button render={<a href="/test" />}>Link</Button>)
      const link = screen.getByRole('link')
      expect(link).toHaveTextContent('Link')
      expect(link).toHaveAttribute('href', '/test')
    })

    it('applies base layout classes', () => {
      render(<Button>Click me</Button>)
      const btn = screen.getByRole('button')
      expect(btn).toHaveClass('inline-flex', 'justify-center', 'items-center', 'cursor-pointer')
    })
  })

  describe('variants', () => {
    it('applies default secondary variant', () => {
      render(<Button>Click me</Button>)
      const btn = screen.getByRole('button')
      expect(btn).toHaveClass('bg-components-button-secondary-bg', 'text-components-button-secondary-text')
    })

    it.each([
      { variant: 'primary' as const, expectedClass: 'bg-components-button-primary-bg' },
      { variant: 'secondary' as const, expectedClass: 'bg-components-button-secondary-bg' },
      { variant: 'secondary-accent' as const, expectedClass: 'text-components-button-secondary-accent-text' },
      { variant: 'ghost' as const, expectedClass: 'text-components-button-ghost-text' },
      { variant: 'ghost-accent' as const, expectedClass: 'hover:bg-state-accent-hover' },
      { variant: 'tertiary' as const, expectedClass: 'bg-components-button-tertiary-bg' },
    ])('applies $variant variant', ({ variant, expectedClass }) => {
      render(<Button variant={variant}>Click me</Button>)
      expect(screen.getByRole('button')).toHaveClass(expectedClass)
    })

    it('applies destructive tone with default variant', () => {
      render(<Button tone="destructive">Click me</Button>)
      expect(screen.getByRole('button')).toHaveClass('bg-components-button-destructive-secondary-bg')
    })

    it('applies destructive tone with primary variant', () => {
      render(<Button variant="primary" tone="destructive">Click me</Button>)
      expect(screen.getByRole('button')).toHaveClass('bg-components-button-destructive-primary-bg')
    })

    it('applies destructive tone with tertiary variant', () => {
      render(<Button variant="tertiary" tone="destructive">Click me</Button>)
      expect(screen.getByRole('button')).toHaveClass('bg-components-button-destructive-tertiary-bg')
    })

    it('applies destructive tone with ghost variant', () => {
      render(<Button variant="ghost" tone="destructive">Click me</Button>)
      expect(screen.getByRole('button')).toHaveClass('text-components-button-destructive-ghost-text')
    })
  })

  describe('sizes', () => {
    it('applies default medium size', () => {
      render(<Button>Click me</Button>)
      expect(screen.getByRole('button')).toHaveClass('h-8', 'rounded-lg')
    })

    it.each([
      { size: 'small' as const, expectedClass: 'h-6' },
      { size: 'medium' as const, expectedClass: 'h-8' },
      { size: 'large' as const, expectedClass: 'h-9' },
    ])('applies $size size', ({ size, expectedClass }) => {
      render(<Button size={size}>Click me</Button>)
      expect(screen.getByRole('button')).toHaveClass(expectedClass)
    })
  })

  describe('loading', () => {
    it('shows spinner when loading', () => {
      render(<Button loading>Click me</Button>)
      expect(screen.getByRole('button').querySelector('[aria-hidden="true"]')).toBeInTheDocument()
    })

    it('hides spinner when not loading', () => {
      render(<Button loading={false}>Click me</Button>)
      expect(screen.getByRole('button').querySelector('[aria-hidden="true"]')).not.toBeInTheDocument()
    })

    it('auto-disables when loading', () => {
      render(<Button loading>Click me</Button>)
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('sets aria-busy when loading', () => {
      render(<Button loading>Click me</Button>)
      expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
    })

    it('does not set aria-busy when not loading', () => {
      render(<Button>Click me</Button>)
      expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy')
    })
  })

  describe('disabled', () => {
    it('disables button when disabled prop is set', () => {
      render(<Button disabled>Click me</Button>)
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('keeps focusable when loading with focusableWhenDisabled', () => {
      render(<Button loading focusableWhenDisabled>Loading</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('events', () => {
    it('fires onClick when clicked', () => {
      const onClick = vi.fn()
      render(<Button onClick={onClick}>Click me</Button>)
      fireEvent.click(screen.getByRole('button'))
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('does not fire onClick when disabled', () => {
      const onClick = vi.fn()
      render(<Button onClick={onClick} disabled>Click me</Button>)
      fireEvent.click(screen.getByRole('button'))
      expect(onClick).not.toHaveBeenCalled()
    })

    it('does not fire onClick when loading', () => {
      const onClick = vi.fn()
      render(<Button onClick={onClick} loading>Click me</Button>)
      fireEvent.click(screen.getByRole('button'))
      expect(onClick).not.toHaveBeenCalled()
    })
  })

  describe('className merging', () => {
    it('merges custom className with variant classes', () => {
      render(<Button className="custom-class">Click me</Button>)
      const btn = screen.getByRole('button')
      expect(btn).toHaveClass('custom-class')
      expect(btn).toHaveClass('inline-flex')
    })
  })

  describe('ref forwarding', () => {
    it('forwards ref to the button element', () => {
      let buttonRef: HTMLButtonElement | null = null
      render(
        <Button ref={(el) => {
          buttonRef = el
        }}
        >
          Click me
        </Button>,
      )
      expect(buttonRef).toBeInstanceOf(HTMLButtonElement)
    })
  })
})

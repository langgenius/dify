import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Button from '../index'

afterEach(cleanup)

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
  })

  describe('variants', () => {
    it('applies default secondary variant', () => {
      render(<Button>Click me</Button>)
      expect(screen.getByRole('button').className).toContain('btn-secondary')
    })

    it.each([
      'primary',
      'warning',
      'secondary',
      'secondary-accent',
      'ghost',
      'ghost-accent',
      'tertiary',
    ] as const)('applies %s variant', (variant) => {
      render(<Button variant={variant}>Click me</Button>)
      expect(screen.getByRole('button').className).toContain(`btn-${variant}`)
    })

    it('applies destructive modifier', () => {
      render(<Button destructive>Click me</Button>)
      expect(screen.getByRole('button').className).toContain('btn-destructive')
    })
  })

  describe('sizes', () => {
    it('applies default medium size', () => {
      render(<Button>Click me</Button>)
      expect(screen.getByRole('button').className).toContain('btn-medium')
    })

    it.each(['small', 'medium', 'large'] as const)('applies %s size', (size) => {
      render(<Button size={size}>Click me</Button>)
      expect(screen.getByRole('button').className).toContain(`btn-${size}`)
    })
  })

  describe('loading', () => {
    it('shows spinner when loading', () => {
      render(<Button loading>Click me</Button>)
      expect(screen.getByRole('button').querySelector('.animate-spin')).toBeInTheDocument()
    })

    it('hides spinner when not loading', () => {
      render(<Button loading={false}>Click me</Button>)
      expect(screen.getByRole('button').querySelector('.animate-spin')).not.toBeInTheDocument()
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

    it('applies custom spinnerClassName', () => {
      const animClassName = 'anim-breath'
      render(<Button loading spinnerClassName={animClassName}>Click me</Button>)
      expect(screen.getByRole('button').querySelector('.animate-spin')?.className).toContain(animClassName)
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

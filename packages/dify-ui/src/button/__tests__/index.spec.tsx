import { render } from 'vitest-browser-react'
import { Button } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Button', () => {
  describe('rendering', () => {
    it('renders children text', async () => {
      const screen = await render(<Button>Click me</Button>)
      await expect.element(screen.getByRole('button')).toHaveTextContent('Click me')
    })

    it('renders as a native button element by default', async () => {
      const screen = await render(<Button>Click me</Button>)
      expect(screen.getByRole('button').element().tagName).toBe('BUTTON')
    })

    it('defaults to type="button"', async () => {
      const screen = await render(<Button>Click me</Button>)
      await expect.element(screen.getByRole('button')).toHaveAttribute('type', 'button')
    })

    it('allows type override to submit', async () => {
      const screen = await render(<Button type="submit">Submit</Button>)
      await expect.element(screen.getByRole('button')).toHaveAttribute('type', 'submit')
    })

    it('renders custom element via render prop', async () => {
      const screen = await render(<Button nativeButton={false} render={<a href="/test" />}>Link</Button>)
      const button = screen.getByRole('button', { name: 'Link' }).element()
      expect(button.tagName).toBe('A')
      expect(button).toHaveAttribute('href', '/test')
    })

    it('applies base layout classes', async () => {
      const screen = await render(<Button>Click me</Button>)
      const btn = screen.getByRole('button').element()
      expect(btn).toHaveClass('inline-flex', 'justify-center', 'items-center', 'cursor-pointer')
    })
  })

  describe('variants', () => {
    it('applies default secondary variant', async () => {
      const screen = await render(<Button>Click me</Button>)
      const btn = screen.getByRole('button').element()
      expect(btn).toHaveClass('bg-components-button-secondary-bg', 'text-components-button-secondary-text')
    })

    it.each([
      { variant: 'primary' as const, expectedClass: 'bg-components-button-primary-bg' },
      { variant: 'secondary' as const, expectedClass: 'bg-components-button-secondary-bg' },
      { variant: 'secondary-accent' as const, expectedClass: 'text-components-button-secondary-accent-text' },
      { variant: 'ghost' as const, expectedClass: 'text-components-button-ghost-text' },
      { variant: 'ghost-accent' as const, expectedClass: 'hover:bg-state-accent-hover' },
      { variant: 'tertiary' as const, expectedClass: 'bg-components-button-tertiary-bg' },
    ])('applies $variant variant', async ({ variant, expectedClass }) => {
      const screen = await render(<Button variant={variant}>Click me</Button>)
      await expect.element(screen.getByRole('button')).toHaveClass(expectedClass)
    })

    it('applies destructive tone with default variant', async () => {
      const screen = await render(<Button tone="destructive">Click me</Button>)
      await expect.element(screen.getByRole('button')).toHaveClass('bg-components-button-destructive-secondary-bg')
    })

    it('applies destructive tone with primary variant', async () => {
      const screen = await render(<Button variant="primary" tone="destructive">Click me</Button>)
      await expect.element(screen.getByRole('button')).toHaveClass('bg-components-button-destructive-primary-bg')
    })

    it('applies destructive tone with tertiary variant', async () => {
      const screen = await render(<Button variant="tertiary" tone="destructive">Click me</Button>)
      await expect.element(screen.getByRole('button')).toHaveClass('bg-components-button-destructive-tertiary-bg')
    })

    it('applies destructive tone with ghost variant', async () => {
      const screen = await render(<Button variant="ghost" tone="destructive">Click me</Button>)
      await expect.element(screen.getByRole('button')).toHaveClass('text-components-button-destructive-ghost-text')
    })
  })

  describe('sizes', () => {
    it('applies default medium size', async () => {
      const screen = await render(<Button>Click me</Button>)
      await expect.element(screen.getByRole('button')).toHaveClass('h-8', 'rounded-lg')
    })

    it.each([
      { size: 'small' as const, expectedClass: 'h-6' },
      { size: 'medium' as const, expectedClass: 'h-8' },
      { size: 'large' as const, expectedClass: 'h-9' },
    ])('applies $size size', async ({ size, expectedClass }) => {
      const screen = await render(<Button size={size}>Click me</Button>)
      await expect.element(screen.getByRole('button')).toHaveClass(expectedClass)
    })
  })

  describe('loading', () => {
    it('shows spinner when loading', async () => {
      const screen = await render(<Button loading>Click me</Button>)
      expect(screen.getByRole('button').element().querySelector('[aria-hidden="true"]')).toBeInTheDocument()
    })

    it('hides spinner when not loading', async () => {
      const screen = await render(<Button loading={false}>Click me</Button>)
      expect(screen.getByRole('button').element().querySelector('[aria-hidden="true"]')).not.toBeInTheDocument()
    })

    it('auto-disables when loading', async () => {
      const screen = await render(<Button loading>Click me</Button>)
      await expect.element(screen.getByRole('button')).toBeDisabled()
    })

    it('sets aria-busy when loading', async () => {
      const screen = await render(<Button loading>Click me</Button>)
      await expect.element(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
    })

    it('does not set aria-busy when not loading', async () => {
      const screen = await render(<Button>Click me</Button>)
      await expect.element(screen.getByRole('button')).not.toHaveAttribute('aria-busy')
    })
  })

  describe('disabled', () => {
    it('disables button when disabled prop is set', async () => {
      const screen = await render(<Button disabled>Click me</Button>)
      await expect.element(screen.getByRole('button')).toBeDisabled()
    })

    it('keeps focusable when loading with focusableWhenDisabled', async () => {
      const screen = await render(<Button loading focusableWhenDisabled>Loading</Button>)
      const button = screen.getByRole('button').element()
      expect(button).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('events', () => {
    it('fires onClick when clicked', async () => {
      const onClick = vi.fn()
      const screen = await render(<Button onClick={onClick}>Click me</Button>)
      await screen.getByRole('button').click()
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('does not fire onClick when disabled', async () => {
      const onClick = vi.fn()
      const screen = await render(<Button onClick={onClick} disabled>Click me</Button>)
      asHTMLElement(screen.getByRole('button').element()).click()
      expect(onClick).not.toHaveBeenCalled()
    })

    it('does not fire onClick when loading', async () => {
      const onClick = vi.fn()
      const screen = await render(<Button onClick={onClick} loading>Click me</Button>)
      asHTMLElement(screen.getByRole('button').element()).click()
      expect(onClick).not.toHaveBeenCalled()
    })
  })

  describe('className merging', () => {
    it('merges custom className with variant classes', async () => {
      const screen = await render(<Button className="custom-class">Click me</Button>)
      const btn = screen.getByRole('button').element()
      expect(btn).toHaveClass('custom-class')
      expect(btn).toHaveClass('inline-flex')
    })
  })

  describe('ref forwarding', () => {
    it('forwards ref to the button element', async () => {
      let buttonRef: HTMLButtonElement | null = null
      await render(
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

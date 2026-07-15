import type * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
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
      const screen = await render(
        <Button nativeButton={false} render={<a href="/test" />}>
          Link
        </Button>,
      )
      const button = screen.getByRole('button', { name: 'Link' }).element()
      expect(button.tagName).toBe('A')
      expect(button).toHaveAttribute('href', '/test')
    })
  })

  describe('loading', () => {
    it('shows spinner when loading', async () => {
      const screen = await render(<Button loading>Click me</Button>)
      expect(
        screen.getByRole('button').element().querySelector('[aria-hidden="true"]'),
      ).toBeInTheDocument()
    })

    it('hides spinner when not loading', async () => {
      const screen = await render(<Button loading={false}>Click me</Button>)
      expect(
        screen.getByRole('button').element().querySelector('[aria-hidden="true"]'),
      ).not.toBeInTheDocument()
    })

    it('keeps loading buttons focusable by default', async () => {
      const screen = await render(<Button loading>Click me</Button>)
      const button = screen.getByRole('button').element()

      expect(button).not.toHaveAttribute('disabled')
      expect((button as HTMLButtonElement).disabled).toBe(false)
      expect(button).toHaveAttribute('aria-disabled', 'true')

      asHTMLElement(button).focus()
      expect(button).toHaveFocus()
    })

    it('does not set aria-busy when loading', async () => {
      const screen = await render(<Button loading>Click me</Button>)
      await expect.element(screen.getByRole('button')).not.toHaveAttribute('aria-busy')
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

    it('does not keep normal disabled buttons focusable by default', async () => {
      const screen = await render(<Button disabled>Click me</Button>)
      const button = screen.getByRole('button').element()

      expect(button).toBeDisabled()
      expect(button).not.toHaveAttribute('aria-disabled')
    })

    it('allows loading focusability to be opted out', async () => {
      const screen = await render(
        <Button loading focusableWhenDisabled={false}>
          Loading
        </Button>,
      )
      await expect.element(screen.getByRole('button')).toBeDisabled()
    })
  })

  describe('events', () => {
    it('fires onClick when clicked', async () => {
      const onClick = vi.fn()
      const screen = await render(<Button onClick={onClick}>Click me</Button>)
      await screen.getByRole('button').click()
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('does not implicitly submit a form through a loading submit button', async () => {
      const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault())
      const screen = await render(
        <form onSubmit={onSubmit}>
          <label htmlFor="name">Name</label>
          <input id="name" />
          <Button type="submit" loading>
            Submit
          </Button>
        </form>,
      )

      asHTMLElement(screen.getByRole('textbox', { name: 'Name' }).element()).focus()
      await userEvent.keyboard('{Enter}')

      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  describe('className merging', () => {
    it('merges custom className with variant classes', async () => {
      const screen = await render(<Button className="custom-class">Click me</Button>)
      const btn = screen.getByRole('button').element()
      expect(btn).toHaveClass('custom-class')
    })
  })

  describe('ref forwarding', () => {
    it('forwards ref to the button element', async () => {
      let buttonRef: HTMLButtonElement | null = null
      await render(
        <Button
          ref={(el) => {
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

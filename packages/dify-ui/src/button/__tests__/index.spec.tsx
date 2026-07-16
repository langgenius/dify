import type * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { Button } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('Button', () => {
  describe('rendering', () => {
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

  describe('disabled states', () => {
    it('uses native disabled semantics for regular disabled buttons', async () => {
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

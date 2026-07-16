import { render } from 'vitest-browser-react'
import { Switch } from '../index'

const getThumb = (switchElement: HTMLElement | SVGElement) => switchElement.querySelector('span')

describe('Switch', () => {
  it('should expose disabled state and stay out of the tab order', async () => {
    const screen = await render(<Switch checked={false} disabled />)

    const switchElement = screen.getByRole('switch')

    await expect.element(switchElement).toBeDisabled()
    await expect.element(switchElement).toHaveAttribute('tabindex', '-1')
    await expect.element(switchElement).toHaveAttribute('data-disabled', '')
  })

  it('should apply custom className', async () => {
    const screen = await render(<Switch checked={false} className="custom-test-class" />)
    await expect.element(screen.getByRole('switch')).toHaveClass('custom-test-class')
  })

  it('should reflect checked state on the root and thumb', async () => {
    const screen = await render(<Switch checked={false} />)
    const switchElement = screen.getByRole('switch').element()
    const thumb = getThumb(switchElement)

    expect(thumb).not.toHaveAttribute('data-checked')

    await screen.rerender(<Switch checked={true} />)

    await expect.element(screen.getByRole('switch')).toHaveAttribute('data-checked', '')
    expect(getThumb(screen.getByRole('switch').element())).toHaveAttribute('data-checked', '')
  })

  describe('loading state', () => {
    it('should render as disabled when loading', async () => {
      const screen = await render(<Switch checked={false} loading />)

      const switchElement = screen.getByRole('switch')
      await expect.element(switchElement).toHaveAttribute('aria-busy', 'true')
      await expect.element(switchElement).toHaveAttribute('data-disabled', '')
    })

    it('should show spinner icon for md and lg sizes', async () => {
      const screen = await render(<Switch checked={false} loading size="md" />)
      expect(screen.container.querySelector('span[aria-hidden="true"] i')).toBeInTheDocument()

      await screen.rerender(<Switch checked={false} loading size="lg" />)
      expect(screen.container.querySelector('span[aria-hidden="true"] i')).toBeInTheDocument()
    })

    it('should not show spinner for xs and sm sizes', async () => {
      const screen = await render(<Switch checked={false} loading size="xs" />)
      expect(screen.container.querySelector('span[aria-hidden="true"] i')).not.toBeInTheDocument()

      await screen.rerender(<Switch checked={false} loading size="sm" />)
      expect(screen.container.querySelector('span[aria-hidden="true"] i')).not.toBeInTheDocument()
    })
  })
})

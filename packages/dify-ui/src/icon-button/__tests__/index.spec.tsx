import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { IconButton } from '../index'

describe('IconButton', () => {
  it('renders a named native button by default', async () => {
    const screen = await render(
      <IconButton aria-label="Close">
        <span aria-hidden="true" className="i-ri-close-line size-4" />
      </IconButton>,
    )

    await expect
      .element(screen.getByRole('button', { name: 'Close' }))
      .toHaveAttribute('type', 'button')
  })

  it('preserves Base UI render prop composition', async () => {
    const onClick = vi.fn()
    const onRenderedClick = vi.fn()
    let renderedRef: HTMLButtonElement | null = null
    let iconButtonRef: HTMLElement | null = null

    const screen = await render(
      <IconButton
        aria-label="More actions"
        onClick={onClick}
        ref={(element) => {
          iconButtonRef = element
        }}
        render={
          <button
            data-trigger="menu"
            onClick={onRenderedClick}
            ref={(element) => {
              renderedRef = element
            }}
          />
        }
      >
        <span aria-hidden="true" className="i-ri-more-line size-4" />
      </IconButton>,
    )

    const button = screen.getByRole('button', { name: 'More actions' })
    await expect.element(button).toHaveAttribute('data-trigger', 'menu')

    await userEvent.click(button)

    expect(onClick).toHaveBeenCalledOnce()
    expect(onRenderedClick).toHaveBeenCalledOnce()
    expect(iconButtonRef).toBe(button.element())
    expect(renderedRef).toBe(button.element())
  })

  it('preserves Base UI disabled behavior', async () => {
    const onClick = vi.fn()
    const screen = await render(
      <IconButton aria-label="Delete" disabled onClick={onClick}>
        <span aria-hidden="true" className="i-ri-delete-bin-line size-4" />
      </IconButton>,
    )

    const button = screen.getByRole('button', { name: 'Delete' })
    await expect.element(button).toBeDisabled()

    const element = button.element()
    if (!(element instanceof HTMLButtonElement))
      throw new TypeError('Expected IconButton to render a button element')
    element.click()
    expect(onClick).not.toHaveBeenCalled()
  })
})

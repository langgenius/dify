import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { IconButton } from '../../icon-button'
import { Toggle } from '../index'

describe('Toggle', () => {
  it('composes pressed semantics into one IconButton DOM element', async () => {
    const screen = await render(
      <Toggle
        defaultPressed
        render={
          <IconButton aria-label="Favorite">
            <span aria-hidden="true" className="i-ri-star-fill size-4" />
          </IconButton>
        }
      />,
    )

    const toggle = screen.getByRole('button', { name: 'Favorite' })
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelectorAll('button')).toHaveLength(1)

    await userEvent.click(toggle)
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('owns the focus ring so a bare toggle shows one', async () => {
    const screen = await render(<Toggle aria-label="Bold" />)

    await expect
      .element(screen.getByRole('button', { name: 'Bold' }))
      .toHaveClass('focus-visible:ring-2', 'focus-visible:ring-state-accent-solid')
  })

  it('lets a caller replace the ring with a gapped outline', async () => {
    const screen = await render(
      <Toggle
        aria-label="Monday"
        className="outline-state-accent-solid focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
      />,
    )

    const toggle = screen.getByRole('button', { name: 'Monday' })
    await expect
      .element(toggle)
      .toHaveClass('focus-visible:ring-0', 'focus-visible:outline-solid', 'focus-visible:outline-2')
    await expect.element(toggle).not.toHaveClass('focus-visible:ring-2')
    await expect.element(toggle).not.toHaveClass('focus-visible:outline-hidden')
  })
})

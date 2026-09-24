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
})

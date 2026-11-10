import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import MarkdownMusic from '../music'

it('renders no score or playback control for non-text content', async () => {
  const screen = await render(
    <MarkdownMusic>
      <span>not a tune</span>
    </MarkdownMusic>,
  )

  await expect.element(screen.getByRole('img')).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button')).not.toBeInTheDocument()
})

it('renders real notation and exposes its playable control to the keyboard', async () => {
  const screen = await render(
    <MarkdownMusic>{'X:1\nT:Browser tune\nM:4/4\nK:C\nC D E F|'}</MarkdownMusic>,
  )

  await expect
    .element(screen.getByRole('img', { name: 'Sheet Music for "Browser tune"' }))
    .toBeVisible()
  const play = screen.getByRole('button', { name: 'Click to play/pause.' })
  await expect.element(play).toBeVisible()
  await userEvent.keyboard('{Tab}')
  await expect.element(play).toHaveFocus()
})

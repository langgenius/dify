import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { CommentMarker } from '../comment-marker'

it.each([1, 2])(
  'draws the bubble around the box of %i avatar(s) so they stay centered',
  async (count) => {
    const participants = [
      { id: 'ann', name: 'Ann' },
      { id: 'bob', name: 'Bob' },
    ].slice(0, count)
    const screen = await render(
      <div style={{ position: 'absolute', left: 10.3, top: 20.6 }}>
        <CommentMarker selected data-testid="marker" participants={participants} />
      </div>,
      { wrapper: createConsoleQueryWrapper().wrapper },
    )
    const marker = screen.getByTestId('marker')
    await expect.element(marker).toBeVisible()

    const bubble = marker.element()
    const box = bubble.getBoundingClientRect()
    const avatars = bubble.firstElementChild!.getBoundingClientRect()
    // Padding and outlines are rings outside this box, which the browser snaps
    // together with the avatars, so no edge rounds differently from the others.
    expect(avatars.toJSON()).toEqual(box.toJSON())
    expect(bubble.parentElement!.getBoundingClientRect().height).toBe(27)
    expect(getComputedStyle(bubble, '::after').boxShadow).toContain('1.5px')
  },
)

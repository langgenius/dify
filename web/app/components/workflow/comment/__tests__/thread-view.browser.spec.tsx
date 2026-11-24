import { Popover, PopoverPortal, PopoverPositioner } from '@langgenius/dify-ui/popover'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { commentThreadPlacement } from '../popup-placement'
import { CommentThreadPopup } from '../thread-view'

function Fixture({
  markerLeft,
  markerHidden = false,
}: {
  markerLeft: number
  markerHidden?: boolean
}) {
  return (
    <>
      <button
        type="button"
        id="marker"
        style={{
          position: 'fixed',
          left: markerLeft,
          top: 300,
          width: 47,
          height: 27,
          display: markerHidden ? 'none' : undefined,
        }}
      >
        Marker
      </button>
      <Popover open>
        <PopoverPortal>
          <PopoverPositioner
            {...commentThreadPlacement}
            anchor={() => document.getElementById('marker')}
          >
            <CommentThreadPopup title="Comments" closeLabel="Close comment">
              <div style={{ height: 300 }}>Messages</div>
            </CommentThreadPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </>
  )
}

const rectOf = (element: Element) => element.getBoundingClientRect()

it('hangs 17px right of its marker with its top raised by a fifth of its height', async () => {
  await page.viewport(1200, 800)
  const screen = await render(<Fixture markerLeft={200} />)
  const dialog = screen.getByRole('dialog', { name: 'Comments' })
  await expect.element(dialog).toBeVisible()

  const marker = rectOf(screen.getByRole('button', { name: 'Marker' }).element())
  await expect
    .poll(() => {
      const panel = rectOf(dialog.element())
      return [
        Math.round(panel.left - marker.right),
        Math.round(marker.top - panel.top - panel.height / 5),
      ]
    })
    .toEqual([17, 0])
})

it('flips to the marker’s left when the right side has no room', async () => {
  await page.viewport(1200, 800)
  const screen = await render(<Fixture markerLeft={1000} />)
  const dialog = screen.getByRole('dialog', { name: 'Comments' })
  await expect.element(dialog).toBeVisible()

  const marker = rectOf(screen.getByRole('button', { name: 'Marker' }).element())
  await expect.poll(() => Math.round(marker.left - rectOf(dialog.element()).right)).toBe(17)
})

it('hides while its marker is not displayed', async () => {
  await page.viewport(1200, 800)
  const screen = await render(<Fixture markerLeft={200} markerHidden />)

  await expect.element(screen.getByText('Messages')).toBeInTheDocument()
  await expect.element(screen.getByText('Messages')).not.toBeVisible()
})

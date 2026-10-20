import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import ImagePreview from '../image-preview'

const imageUrl = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="teal" /></svg>')}`

it('keeps the portalled preview fullscreen and owns arrows only while open', async () => {
  // Real layout and native initial focus prove the popup/content split retains the preview boundary.
  const onNext = vi.fn()
  const onCancel = vi.fn()

  function PreviewHost() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open preview
        </button>
        {open && (
          <ImagePreview
            url={imageUrl}
            title="Local preview"
            onNext={onNext}
            onCancel={() => {
              onCancel()
              setOpen(false)
            }}
          />
        )}
      </>
    )
  }

  await page.viewport(960, 640)
  const screen = await render(<PreviewHost />)
  await screen.getByRole('button', { name: 'Open preview' }).click()
  const dialog = screen.getByRole('dialog', { name: 'Local preview' })
  await expect.element(dialog).toBeVisible()
  await expect.poll(() => dialog.element().contains(document.activeElement)).toBe(true)
  const bounds = dialog.element().getBoundingClientRect()
  expect(bounds.x).toBeCloseTo(0)
  expect(bounds.y).toBeCloseTo(0)
  expect(bounds.width).toBeCloseTo(960)
  expect(bounds.height).toBeCloseTo(640)

  const image = dialog.getByRole('img', { name: 'Local preview' })
  await expect.poll(() => image.element().getBoundingClientRect().width).toBeGreaterThan(0)
  const initialWidth = image.element().getBoundingClientRect().width
  await userEvent.keyboard('{ArrowRight>3/}')
  expect(onNext).toHaveBeenCalledOnce()
  await userEvent.keyboard('{ArrowRight}')
  expect(onNext).toHaveBeenCalledTimes(2)
  await userEvent.keyboard('{ArrowUp>3/}')
  await expect
    .poll(() => image.element().getBoundingClientRect().width)
    .toBeCloseTo(initialWidth * 1.2 ** 3)

  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  expect(onCancel).toHaveBeenCalledOnce()
  await userEvent.keyboard('{ArrowRight}{ArrowUp}')
  expect(onNext).toHaveBeenCalledTimes(2)
  expect(onCancel).toHaveBeenCalledOnce()
})

it('zooms and pans without exposing blank edges, then recenters when zoomed out', async () => {
  // Native wheel/drag events and actual image bounds catch pan math hidden by mocked rectangles.
  await page.viewport(480, 320)
  const largeImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="teal" /></svg>')}`
  const screen = await render(
    <ImagePreview url={largeImage} title="Pan preview" onCancel={vi.fn()} />,
  )
  const dialog = screen.getByRole('dialog', { name: 'Pan preview' })
  const image = dialog.getByRole('img', { name: 'Pan preview' })
  await expect.poll(() => image.element().getBoundingClientRect().width).toBeGreaterThan(0)
  const initial = image.element().getBoundingClientRect()
  await screen.getByRole('button', { name: 'common.operation.zoomIn' }).click()
  await expect
    .poll(() => image.element().getBoundingClientRect().width)
    .toBeCloseTo(initial.width * 1.2)
  await dialog.wheel({ direction: 'up', times: 2 })
  await expect
    .poll(() => image.element().getBoundingClientRect().width)
    .toBeCloseTo(initial.width * 1.2 ** 3)
  const zoomed = image.element().getBoundingClientRect()
  await userEvent.dragAndDrop(image, dialog, {
    sourcePosition: { x: zoomed.width / 2, y: zoomed.height / 2 },
    targetPosition: { x: 445, y: 280 },
    steps: 8,
  })
  await expect.poll(() => image.element().getBoundingClientRect().left).toBeCloseTo(32)
  await expect.poll(() => image.element().getBoundingClientRect().top).toBeCloseTo(32)
  const panned = image.element().getBoundingClientRect()
  expect(panned.left).toBeLessThanOrEqual(32)
  expect(panned.right).toBeGreaterThanOrEqual(448)
  await dialog.hover({ position: { x: 240, y: 160 } })
  await expect.poll(() => image.element().getBoundingClientRect().left).toBeCloseTo(panned.left)
  await dialog.wheel({ direction: 'down', times: 2 })
  await expect
    .poll(() => image.element().getBoundingClientRect().width)
    .toBeCloseTo(initial.width * 1.2)
  await screen.getByRole('button', { name: 'common.operation.zoomOut' }).click()
  await expect.poll(() => image.element().getBoundingClientRect().left).toBeCloseTo(initial.left)
  await expect.poll(() => image.element().getBoundingClientRect().width).toBeCloseTo(initial.width)
})

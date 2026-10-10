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

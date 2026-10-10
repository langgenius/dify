import type { FileEntity } from '../../file-uploader/types'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import ImageGallery from '..'
import FileImageItem from '../../file-uploader/file-uploader-in-chat-input/file-image-item'

const imageUrl = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="teal" /></svg>')}`
const file: FileEntity = {
  id: 'preview-file',
  name: 'Preview image.svg',
  size: 100,
  type: 'image/svg+xml',
  progress: 100,
  transferMethod: 'local_file',
  supportFileType: 'image',
  uploadedId: 'uploaded-preview',
  base64Url: imageUrl,
}

beforeEach(async () => {
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = false
  await page.viewport(960, 640)
})

afterEach(() => {
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = true
})

it.each(['gallery', 'chat attachment'] as const)(
  '%s retains the zoomed image during exit and restores its entry before a fresh preview',
  async (owner) => {
    const screen = await render(
      owner === 'gallery' ? (
        <ImageGallery srcs={[imageUrl]} />
      ) : (
        <FileImageItem file={file} canPreview showDownloadAction />
      ),
    )
    const entry =
      owner === 'gallery'
        ? screen.getByRole('button', { name: /common.imageGallery.previewImage/ })
        : screen.getByRole('button', { name: 'common.operation.view Preview image.svg' })
    await userEvent.tab()
    await expect.element(entry).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    const popup = dialog.element()
    const image = page.getByTestId('image-preview-image').element() as HTMLImageElement
    await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true)
    await expect
      .poll(
        () =>
          !popup.hasAttribute('data-starting-style') &&
          popup.getAnimations().every((animation) => animation.playState === 'finished'),
      )
      .toBe(true)
    const initialWidth = image.getBoundingClientRect().width
    await dialog.getByRole('button', { name: 'common.operation.zoomIn' }).click()
    await expect.poll(() => image.getBoundingClientRect().width).toBeCloseTo(initialWidth * 1.2)

    const exitImages: boolean[] = []
    popup.addEventListener('transitionrun', () => {
      if (popup.hasAttribute('data-ending-style'))
        exitImages.push(
          image.isConnected &&
            image.src === imageUrl &&
            image.getBoundingClientRect().width > initialWidth,
        )
    })
    await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.poll(() => exitImages.length).toBeGreaterThan(0)
    expect(exitImages.every(Boolean)).toBe(true)
    await expect.poll(() => popup.isConnected).toBe(false)
    await expect.element(entry).toHaveFocus()
    expect(entry.element().checkVisibility({ opacityProperty: true })).toBe(true)

    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await expect
      .poll(() => page.getByTestId('image-preview-image').element().getBoundingClientRect().width)
      .toBeCloseTo(initialWidth)
  },
)

import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  createPreviewPdf,
  guardPreviewFetch,
  hasPaintedPdfText,
} from '@/test/fixtures/preview-files'
import { TransferMethod } from '@/types/app'
import { FileItem } from '../file-uploader-in-chat-input/file-item'

beforeEach(() => onTestFinished(guardPreviewFetch()))

async function openPdf() {
  await page.viewport(1024, 768)
  await render(
    <FileItem
      file={{
        id: 'pdf-1',
        name: 'document.pdf',
        type: 'application/pdf',
        size: 2048,
        progress: 100,
        transferMethod: TransferMethod.local_file,
        supportFileType: 'document',
        originalFile: createPreviewPdf('document.pdf'),
      }}
      canPreview
    />,
  )
  await page.getByRole('button', { name: 'document.pdf' }).click()
  const dialog = page.getByRole('dialog', { name: 'document.pdf' })
  const text = dialog.getByText('Dify local preview')
  await expect.element(text).toBeVisible()
  await expect.poll(() => hasPaintedPdfText(dialog.element())).toBe(true)
  await document.fonts.ready
  // Cached PDFs can paint before the dialog's native entry-scale transition finishes.
  await expect
    .poll(() =>
      dialog
        .element()
        .getAnimations()
        .some((animation) => animation.playState === 'running'),
    )
    .toBe(false)
  return { dialog, text }
}

it('bounds the rendered PDF zoom and restores readable original sizing after reopening', async () => {
  const { dialog, text } = await openPdf()
  const initialWidth = text.element().getBoundingClientRect().width
  expect(initialWidth).toBeGreaterThan(0)
  const zoomIn = dialog.getByRole('button', { name: 'common.operation.zoomIn' })
  const zoomOut = dialog.getByRole('button', { name: 'common.operation.zoomOut' })
  const width = () => text.element().getBoundingClientRect().width
  await zoomIn.click()
  await expect.poll(width).toBeCloseTo(initialWidth * 1.2, 0)
  await zoomOut.click()
  await expect.poll(width).toBeCloseTo(initialWidth, 0)
  for (let step = 0; step < 20; step++) await zoomIn.click()
  await expect.poll(width).toBeCloseTo(initialWidth * 15, 0)
  for (let step = 0; step < 25; step++) await zoomOut.click()
  await expect.poll(width).toBeCloseTo(initialWidth * 0.5, 0)
  // These must remain hittable above the scaled document.
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  const trigger = page.getByRole('button', { name: 'document.pdf' })
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await expect.element(text).toBeVisible()
  await expect.poll(width).toBeCloseTo(initialWidth, 0)
})

it('zooms the loaded PDF with popup shortcuts while Close keeps native focus', async () => {
  const { dialog, text } = await openPdf()
  const close = dialog.getByRole('button', { name: 'common.operation.close' })
  await expect.element(close).toHaveFocus()
  const initialWidth = text.element().getBoundingClientRect().width
  await userEvent.keyboard('{ArrowUp}')
  await expect
    .poll(() => text.element().getBoundingClientRect().width / initialWidth)
    .toBeCloseTo(1.2, 2)
  await expect.element(close).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  await expect
    .poll(() => text.element().getBoundingClientRect().width / initialWidth)
    .toBeCloseTo(1, 2)
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
})

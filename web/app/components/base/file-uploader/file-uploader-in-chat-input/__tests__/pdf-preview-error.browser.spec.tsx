import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import { controlPdfLoad } from '@/test/pdf-load-control'
import { TransferMethod } from '@/types/app'
import { FileItem } from '../file-item'

const MISSING_PDF_URL = '/__attachment-pdf-preview-missing__.pdf'
const RECOVERED_PDF_URL = '/__attachment-pdf-preview-retry__.pdf'
const RECOVERED_PDF_TEXT = 'RetryOK'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: commonLocale } = await import('@/i18n/locales/en-US/common.json')
  return createReactI18nextMock({ ...commonLocale })
})

const pdfFile = (url: string) => ({
  id: 'pdf-1',
  name: 'document.pdf',
  type: 'application/pdf',
  size: 2048,
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  url,
})

describe('PdfPreview failure state (attachment, real entry)', () => {
  it('explains a failed load instead of leaving the preview blank', async () => {
    const screen = await render(<FileItem file={pdfFile(MISSING_PDF_URL)} canPreview />)

    await screen.getByRole('button', { name: 'document.pdf' }).click()

    await expect.element(screen.getByRole('alert')).toBeVisible()
    await expect.element(screen.getByText(common['operation.pdfLoadFailed'])).toBeVisible()
  })

  it('keeps the close action available alongside the error', async () => {
    const screen = await render(<FileItem file={pdfFile(MISSING_PDF_URL)} canPreview />)

    await screen.getByRole('button', { name: 'document.pdf' }).click()

    await expect.element(screen.getByRole('alert')).toBeVisible()
    const dialog = screen.getByRole('dialog', { name: 'document.pdf' })
    await dialog.getByRole('button', { name: common['operation.close'] }).click()
    await expect
      .element(screen.getByRole('dialog', { name: 'document.pdf' }))
      .not.toBeInTheDocument()
  })

  it('retries with a fresh load and renders the document once it succeeds', async () => {
    const load = controlPdfLoad(RECOVERED_PDF_URL, RECOVERED_PDF_TEXT)
    load.failThenSucceed(1)

    try {
      await page.viewport(1200, 900)
      const screen = await render(<FileItem file={pdfFile(RECOVERED_PDF_URL)} canPreview />)

      await screen.getByRole('button', { name: 'document.pdf' }).click()

      await expect.element(screen.getByRole('alert')).toBeVisible()
      expect(load.loads).toBe(1)

      await screen.getByRole('button', { name: common['operation.retry'] }).click()

      await expect.poll(() => load.loads).toBe(2)
      await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
      await expect.element(screen.getByText(RECOVERED_PDF_TEXT)).toBeVisible()
    } finally {
      load.restore()
    }
  })
})

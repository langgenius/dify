import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import { controlPdfLoad } from '@/test/pdf-load-control'
import PdfPreview from '../pdf-preview'

// Real adapter, real PdfLoader, real pinned pdfjs, real Chromium.
//
// The document URL is not served: the load genuinely rejects and the library
// takes its own error path. This is the failure injection described in #42948.
const MISSING_PDF_URL = '/__attachment-pdf-preview-missing__.pdf'

// Distinctive text drawn on the fixture page. Seeing it on screen means pdfjs
// parsed *these* bytes, which is what proves a retry really recovered.
const RECOVERED_PDF_URL = '/__attachment-pdf-preview-retry__.pdf'
const RECOVERED_PDF_TEXT = 'RetryOK'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: commonLocale } = await import('@/i18n/locales/en-US/common.json')
  return createReactI18nextMock({ ...commonLocale })
})

describe('PdfPreview failure state', () => {
  it('explains a failed load instead of leaving the dialog blank', async () => {
    const screen = await render(<PdfPreview url={MISSING_PDF_URL} onCancel={vi.fn()} />)

    await expect.element(screen.getByRole('alert')).toBeVisible()
    await expect.element(screen.getByText(common['operation.pdfLoadFailed'])).toBeVisible()
  })

  it('keeps the existing close action available alongside the error', async () => {
    const onCancel = vi.fn()
    const screen = await render(<PdfPreview url={MISSING_PDF_URL} onCancel={onCancel} />)

    await expect.element(screen.getByRole('alert')).toBeVisible()
    await screen.getByRole('button', { name: common['operation.cancel'] }).click()
    expect(onCancel).toHaveBeenCalled()
  })

  // The retry action is only useful if it re-attempts the load, and the load is
  // only re-attempted when the loader is torn down and remounted. Asserting the
  // alert is still visible after a click proves neither, because the alert was
  // already visible. This drives a real failed load, retries, and requires a
  // second, successful load whose bytes are rendered on screen.
  it('retries with a fresh load and renders the document once it succeeds', async () => {
    const load = controlPdfLoad(RECOVERED_PDF_URL, RECOVERED_PDF_TEXT)
    load.failThenSucceed(1)

    try {
      await page.viewport(1200, 900)
      const screen = await render(<PdfPreview url={RECOVERED_PDF_URL} onCancel={vi.fn()} />)

      await expect.element(screen.getByRole('alert')).toBeVisible()
      expect(load.loads).toBe(1)

      await screen.getByRole('button', { name: common['operation.retry'] }).click()

      // A second, independent load attempt has to have been made.
      await expect.poll(() => load.loads).toBe(2)
      // It has to have recovered: the error is replaced by the document.
      await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
      await expect.element(screen.getByText(RECOVERED_PDF_TEXT)).toBeVisible()
    } finally {
      load.restore()
    }
  })
})

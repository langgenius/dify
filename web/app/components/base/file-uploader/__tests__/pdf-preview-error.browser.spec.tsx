import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import PdfPreview from '../pdf-preview'

// Same real-library failure injection as the Skill surface: a URL that is not
// served, real PdfLoader, real pinned pdfjs, real Chromium.
const MISSING_PDF_URL = '/__attachment-pdf-preview-missing__.pdf'

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
})

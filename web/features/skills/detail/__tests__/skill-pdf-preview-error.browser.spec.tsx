import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import { SkillPdfPreview } from '../skill-pdf-preview'

// Real adapter, real PdfLoader, real pinned pdfjs, real Chromium. The URL below
// is not served, so the document load genuinely rejects and the library takes
// its own error path. This is the failure injection described in the issue.
const MISSING_PDF_URL = '/__skill-pdf-preview-missing__.pdf'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: common } = await import('@/i18n/locales/en-US/common.json')
  return createReactI18nextMock({ ...common })
})

describe('SkillPdfPreview failure state', () => {
  it('explains a failed load instead of rendering blank content', async () => {
    const screen = await render(<SkillPdfPreview fileName="guide.pdf" url={MISSING_PDF_URL} />)

    await expect.element(screen.getByRole('alert')).toBeVisible()
    await expect.element(screen.getByText(common['operation.pdfLoadFailed'])).toBeVisible()
  })

  it('offers a retry action that re-attempts the load', async () => {
    const screen = await render(<SkillPdfPreview fileName="guide.pdf" url={MISSING_PDF_URL} />)

    const retry = screen.getByRole('button', { name: common['operation.retry'] })
    await expect.element(retry).toBeVisible()

    // PdfLoader reloads on mount, so remounting it must start a fresh attempt
    // that fails again into the same visible error state.
    await retry.click()
    await expect.element(screen.getByRole('alert')).toBeVisible()
  })
})

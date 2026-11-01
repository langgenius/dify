import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import { controlPdfLoad } from '@/test/pdf-load-control'
import { SkillPdfPreview } from '../skill-pdf-preview'

// Real adapter, real PdfLoader, real pinned pdfjs, real Chromium. The URL below
// is not served, so the document load genuinely rejects and the library takes
// its own error path. This is the failure injection described in #42948.
const MISSING_PDF_URL = '/__skill-pdf-preview-missing__.pdf'

// Distinctive text drawn on the fixture page, so a visible retry result can only
// come from pdfjs parsing the bytes served by the retried load.
const RECOVERED_PDF_URL = '/__skill-pdf-preview-retry__.pdf'
const RECOVERED_PDF_TEXT = 'RetryOK'

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

  // The Skill surface binds the same retry contract as the attachment dialog, so
  // it is held to the same evidence: a real failed load, a second independent
  // load attempt after Retry, and the recovered document rendered on screen.
  // The wrapper supplies the dimensions the surface gets from its real layout;
  // `h-full` over a zero-height parent renders no page at all.
  it('retries with a fresh load and renders the document once it succeeds', async () => {
    const load = controlPdfLoad(RECOVERED_PDF_URL, RECOVERED_PDF_TEXT)
    load.failThenSucceed(1)

    try {
      await page.viewport(1200, 900)
      const screen = await render(
        <div style={{ width: 800, height: 600 }}>
          <SkillPdfPreview fileName="guide.pdf" url={RECOVERED_PDF_URL} />
        </div>,
      )

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

import type { Locale } from '@/i18n'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguagesSupported } from '@/i18n/language'
import { captureDownloads } from '@/test/download'
import CSVDownload from '../csv-downloader'

let locale: Locale = 'en-US'
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => locale,
}))

describe('CSVDownload', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    {
      language: 'en-US' as Locale,
      csv: 'question,answer\r\nquestion1,answer1\r\nquestion2,answer2',
    },
    {
      language: LanguagesSupported[1] as Locale,
      csv: '问题,答案\r\n问题 1,答案 1\r\n问题 2,答案 2',
    },
  ])('downloads the $language annotation template as CSV', async ({ language, csv }) => {
    const user = userEvent.setup()
    locale = language
    const downloads = captureDownloads()
    render(<CSVDownload />)

    expect(screen.getByText('share.generation.csvStructureTitle')).toBeVisible()
    await user.click(screen.getByText('appAnnotation.batchModal.template'))

    expect(downloads).toHaveLength(1)
    const { filename, blob } = downloads[0]!
    expect(filename).toBe(`template-${language}.csv`)
    expect(blob.type).toBe('text/csv;charset=utf-8;')
    expect(await blob.text()).toBe(`\uFEFF${csv}`)
  })
})

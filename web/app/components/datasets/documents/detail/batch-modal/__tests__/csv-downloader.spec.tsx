import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vite-plus/test'
import { LanguagesSupported } from '@/i18n/language'
import { ChunkingMode } from '@/models/datasets'
import { captureDownloads } from '@/test/download'
import CSVDownload from '../csv-downloader'

// Mock useLocale
let mockLocale = LanguagesSupported[0] // en-US
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => mockLocale,
}))

afterEach(() => vi.restoreAllMocks())

it.each([
  [
    LanguagesSupported[0],
    ChunkingMode.qa,
    [
      ['question', 'answer'],
      ['question1', 'answer1'],
      ['question2', 'answer2'],
    ],
  ],
  [LanguagesSupported[0], ChunkingMode.text, [['segment content'], ['content1'], ['content2']]],
  [
    LanguagesSupported[1],
    ChunkingMode.qa,
    [
      ['问题', '答案'],
      ['问题 1', '答案 1'],
      ['问题 2', '答案 2'],
    ],
  ],
  [LanguagesSupported[1], ChunkingMode.text, [['分段内容'], ['内容 1'], ['内容 2']]],
] as const)('exports the %s / %s chunk template', async (locale, docForm, expected) => {
  const user = userEvent.setup()
  const downloads = captureDownloads()
  mockLocale = locale
  render(<CSVDownload docForm={docForm} />)
  await user.click(screen.getByText('datasetDocuments.list.batchModal.template'))
  expect(downloads).toHaveLength(1)
  expect(downloads[0]!.filename).toBe('template.csv')
  expect(await downloads[0]!.blob.text()).toBe(
    `\uFEFF${expected.map((row) => row.join(',')).join('\r\n')}`,
  )
  const headers = screen.getAllByRole('columnheader')
  expect(headers.map((header) => header.textContent)).toEqual(
    docForm === ChunkingMode.qa
      ? ['datasetDocuments.list.batchModal.question', 'datasetDocuments.list.batchModal.answer']
      : ['datasetDocuments.list.batchModal.contentTitle'],
  )
})

import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'
import { LanguagesSupported } from '@/i18n/language'
import { ChunkingMode } from '@/models/datasets'
import CSVDownload from '../csv-downloader'

// Mock useLocale
let mockLocale = LanguagesSupported[0] // en-US
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => mockLocale,
}))

// Mock react-papaparse
const MockCSVDownloader = ({
  children,
  data,
  filename,
  type,
}: {
  children: ReactNode
  data: unknown
  filename: string
  type: string
}) => (
  <div
    data-testid="csv-downloader-link"
    data-filename={filename}
    data-type={type}
    data-data={JSON.stringify(data)}
  >
    {children}
  </div>
)

vi.mock('react-papaparse', () => ({
  useCSVDownloader: () => ({
    CSVDownloader: MockCSVDownloader,
    Type: { Link: 'link' },
  }),
}))

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
] as const)('exports the %s / %s chunk template', (locale, docForm, expected) => {
  mockLocale = locale
  render(<CSVDownload docForm={docForm} />)
  const link = screen.getByTestId('csv-downloader-link')
  expect(JSON.parse(link.getAttribute('data-data')!)).toEqual(expected)
  expect(link).toHaveAttribute('data-filename', 'template')
  const headers = screen.getAllByRole('columnheader')
  expect(headers.map((header) => header.textContent)).toEqual(
    docForm === ChunkingMode.qa
      ? ['datasetDocuments.list.batchModal.question', 'datasetDocuments.list.batchModal.answer']
      : ['datasetDocuments.list.batchModal.contentTitle'],
  )
})

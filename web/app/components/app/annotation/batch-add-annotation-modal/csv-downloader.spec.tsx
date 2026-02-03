import type { Mock } from 'vitest'
import type { Locale } from '@/i18n-config'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { useLocale } from '@/context/i18n'
import { LanguagesSupported } from '@/i18n-config/language'
import CSVDownload from './csv-downloader'

const mockDownloadCSV = vi.fn()

vi.mock('@/utils/csv', () => ({
  downloadCSV: (...args: unknown[]) => mockDownloadCSV(...args),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(() => 'en-US'),
}))

const renderWithLocale = (locale: Locale) => {
  ;(useLocale as Mock).mockReturnValue(locale)
  return render(<CSVDownload />)
}

describe('CSVDownload', () => {
  const englishTemplate = [
    ['question', 'answer'],
    ['question1', 'answer1'],
    ['question2', 'answer2'],
  ]
  const chineseTemplate = [
    ['问题', '答案'],
    ['问题 1', '答案 1'],
    ['问题 2', '答案 2'],
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the structure preview and download button', () => {
    renderWithLocale('en-US' as Locale)

    expect(screen.getByText('share.generation.csvStructureTitle')).toBeInTheDocument()
    expect(screen.getByText('appAnnotation.batchModal.template')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should download English template when clicked with en-US locale', () => {
    renderWithLocale('en-US' as Locale)

    fireEvent.click(screen.getByRole('button'))

    expect(mockDownloadCSV).toHaveBeenCalledWith(
      englishTemplate,
      'template-en-US',
      { bom: true },
    )
  })

  it('should download Chinese template when locale matches the secondary language', () => {
    const locale = LanguagesSupported[1] as Locale
    renderWithLocale(locale)

    fireEvent.click(screen.getByRole('button'))

    expect(mockDownloadCSV).toHaveBeenCalledWith(
      chineseTemplate,
      `template-${locale}`,
      { bom: true },
    )
  })
})

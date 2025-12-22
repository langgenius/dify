import React from 'react'
import { render, screen } from '@testing-library/react'
import CSVDownload from './csv-downloader'
import I18nContext from '@/context/i18n'
import { LanguagesSupported } from '@/i18n-config/language'
import type { Locale } from '@/i18n-config'

const downloaderProps: any[] = []

vi.mock('react-papaparse', () => ({
  useCSVDownloader: vi.fn(() => ({
    CSVDownloader: ({ children, ...props }: any) => {
      downloaderProps.push(props)
      return <div data-testid="mock-csv-downloader">{children}</div>
    },
    Type: { Link: 'link' },
  })),
}))

const renderWithLocale = (locale: Locale) => {
  return render(
    <I18nContext.Provider value={{
      locale,
      i18n: {},
      setLocaleOnClient: vi.fn().mockResolvedValue(undefined),
    }}
    >
      <CSVDownload />
    </I18nContext.Provider>,
  )
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
    downloaderProps.length = 0
  })

  it('should render the structure preview and pass English template data by default', () => {
    renderWithLocale('en-US' as Locale)

    expect(screen.getByText('share.generation.csvStructureTitle')).toBeInTheDocument()
    expect(screen.getByText('appAnnotation.batchModal.template')).toBeInTheDocument()

    expect(downloaderProps[0]).toMatchObject({
      filename: 'template-en-US',
      type: 'link',
      bom: true,
      data: englishTemplate,
    })
  })

  it('should switch to the Chinese template when locale matches the secondary language', () => {
    const locale = LanguagesSupported[1] as Locale
    renderWithLocale(locale)

    expect(downloaderProps[0]).toMatchObject({
      filename: `template-${locale}`,
      data: chineseTemplate,
    })
  })
})

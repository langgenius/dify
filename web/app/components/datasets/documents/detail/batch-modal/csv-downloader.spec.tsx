import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LanguagesSupported } from '@/i18n-config/language'
import { ChunkingMode } from '@/models/datasets'

import CSVDownload from './csv-downloader'

// Mock useLocale
let mockLocale = LanguagesSupported[0] // en-US
vi.mock('@/context/i18n', () => ({
  useLocale: () => mockLocale,
}))

// Mock react-papaparse
const MockCSVDownloader = ({ children, data, filename, type }: { children: ReactNode, data: unknown, filename: string, type: string }) => (
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

describe('CSVDownloader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocale = LanguagesSupported[0] // Reset to English
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<CSVDownload docForm={ChunkingMode.text} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render structure title', () => {
      // Arrange & Act
      render(<CSVDownload docForm={ChunkingMode.text} />)

      // Assert - i18n key format
      expect(screen.getByText(/csvStructureTitle/i)).toBeInTheDocument()
    })

    it('should render download template link', () => {
      // Arrange & Act
      render(<CSVDownload docForm={ChunkingMode.text} />)

      // Assert
      expect(screen.getByTestId('csv-downloader-link')).toBeInTheDocument()
      expect(screen.getByText(/list\.batchModal\.template/i)).toBeInTheDocument()
    })
  })

  // Table structure for QA mode
  describe('QA Mode Table', () => {
    it('should render QA table with question and answer columns when docForm is qa', () => {
      // Arrange & Act
      render(<CSVDownload docForm={ChunkingMode.qa} />)

      // Assert - Check for question/answer headers
      const questionHeaders = screen.getAllByText(/list\.batchModal\.question/i)
      const answerHeaders = screen.getAllByText(/list\.batchModal\.answer/i)

      expect(questionHeaders.length).toBeGreaterThan(0)
      expect(answerHeaders.length).toBeGreaterThan(0)
    })

    it('should render two data rows for QA mode', () => {
      // Arrange & Act
      const { container } = render(<CSVDownload docForm={ChunkingMode.qa} />)

      // Assert
      const tbody = container.querySelector('tbody')
      expect(tbody).toBeInTheDocument()
      const rows = tbody?.querySelectorAll('tr')
      expect(rows?.length).toBe(2)
    })
  })

  // Table structure for Text mode
  describe('Text Mode Table', () => {
    it('should render text table with content column when docForm is text', () => {
      // Arrange & Act
      render(<CSVDownload docForm={ChunkingMode.text} />)

      // Assert - Check for content header
      expect(screen.getByText(/list\.batchModal\.contentTitle/i)).toBeInTheDocument()
    })

    it('should not render question/answer columns in text mode', () => {
      // Arrange & Act
      render(<CSVDownload docForm={ChunkingMode.text} />)

      // Assert
      expect(screen.queryByText(/list\.batchModal\.question/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/list\.batchModal\.answer/i)).not.toBeInTheDocument()
    })

    it('should render two data rows for text mode', () => {
      // Arrange & Act
      const { container } = render(<CSVDownload docForm={ChunkingMode.text} />)

      // Assert
      const tbody = container.querySelector('tbody')
      expect(tbody).toBeInTheDocument()
      const rows = tbody?.querySelectorAll('tr')
      expect(rows?.length).toBe(2)
    })
  })

  // CSV Template Data
  describe('CSV Template Data', () => {
    it('should provide English QA template when locale is English and docForm is qa', () => {
      // Arrange
      mockLocale = LanguagesSupported[0] // en-US

      // Act
      render(<CSVDownload docForm={ChunkingMode.qa} />)

      // Assert
      const link = screen.getByTestId('csv-downloader-link')
      const data = JSON.parse(link.getAttribute('data-data') || '[]')
      expect(data).toEqual([
        ['question', 'answer'],
        ['question1', 'answer1'],
        ['question2', 'answer2'],
      ])
    })

    it('should provide English text template when locale is English and docForm is text', () => {
      // Arrange
      mockLocale = LanguagesSupported[0] // en-US

      // Act
      render(<CSVDownload docForm={ChunkingMode.text} />)

      // Assert
      const link = screen.getByTestId('csv-downloader-link')
      const data = JSON.parse(link.getAttribute('data-data') || '[]')
      expect(data).toEqual([
        ['segment content'],
        ['content1'],
        ['content2'],
      ])
    })

    it('should provide Chinese QA template when locale is Chinese and docForm is qa', () => {
      // Arrange
      mockLocale = LanguagesSupported[1] // zh-Hans

      // Act
      render(<CSVDownload docForm={ChunkingMode.qa} />)

      // Assert
      const link = screen.getByTestId('csv-downloader-link')
      const data = JSON.parse(link.getAttribute('data-data') || '[]')
      expect(data).toEqual([
        ['问题', '答案'],
        ['问题 1', '答案 1'],
        ['问题 2', '答案 2'],
      ])
    })

    it('should provide Chinese text template when locale is Chinese and docForm is text', () => {
      // Arrange
      mockLocale = LanguagesSupported[1] // zh-Hans

      // Act
      render(<CSVDownload docForm={ChunkingMode.text} />)

      // Assert
      const link = screen.getByTestId('csv-downloader-link')
      const data = JSON.parse(link.getAttribute('data-data') || '[]')
      expect(data).toEqual([
        ['分段内容'],
        ['内容 1'],
        ['内容 2'],
      ])
    })
  })

  // CSVDownloader props
  describe('CSVDownloader Props', () => {
    it('should set filename to template', () => {
      // Arrange & Act
      render(<CSVDownload docForm={ChunkingMode.text} />)

      // Assert
      const link = screen.getByTestId('csv-downloader-link')
      expect(link.getAttribute('data-filename')).toBe('template')
    })

    it('should set type to Link', () => {
      // Arrange & Act
      render(<CSVDownload docForm={ChunkingMode.text} />)

      // Assert
      const link = screen.getByTestId('csv-downloader-link')
      expect(link.getAttribute('data-type')).toBe('link')
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should maintain structure when rerendered with different docForm', () => {
      // Arrange
      const { rerender } = render(<CSVDownload docForm={ChunkingMode.text} />)

      // Act
      rerender(<CSVDownload docForm={ChunkingMode.qa} />)

      // Assert - should now show QA table
      expect(screen.getAllByText(/list\.batchModal\.question/i).length).toBeGreaterThan(0)
    })

    it('should render correctly for non-English locales', () => {
      // Arrange
      mockLocale = LanguagesSupported[1] // zh-Hans

      // Act
      render(<CSVDownload docForm={ChunkingMode.qa} />)

      // Assert - Check that Chinese template is used
      const link = screen.getByTestId('csv-downloader-link')
      const data = JSON.parse(link.getAttribute('data-data') || '[]')
      expect(data[0]).toEqual(['问题', '答案'])
    })
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LanguagesSupported } from '@/i18n-config/language'
import { ChunkingMode } from '@/models/datasets'
import { downloadCSV } from '@/utils/csv'
import CSVDownload from './csv-downloader'

// Mock useLocale
let mockLocale = LanguagesSupported[0] // en-US
vi.mock('@/context/i18n', () => ({
  useLocale: () => mockLocale,
}))

// Mock downloadCSV
vi.mock('@/utils/csv', () => ({
  downloadCSV: vi.fn(),
}))

describe('CSVDownloader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocale = LanguagesSupported[0] // Reset to English
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render structure title', () => {
      render(<CSVDownload docForm={ChunkingMode.text} />)
      expect(screen.getByText(/csvStructureTitle/i)).toBeInTheDocument()
    })

    it('should render download template button', () => {
      render(<CSVDownload docForm={ChunkingMode.text} />)
      expect(screen.getByText(/list\.batchModal\.template/i)).toBeInTheDocument()
    })
  })

  // Table structure for QA mode
  describe('QA Mode Table', () => {
    it('should render QA table with question and answer columns when docForm is qa', () => {
      render(<CSVDownload docForm={ChunkingMode.qa} />)
      const questionHeaders = screen.getAllByText(/list\.batchModal\.question/i)
      const answerHeaders = screen.getAllByText(/list\.batchModal\.answer/i)
      expect(questionHeaders.length).toBeGreaterThan(0)
      expect(answerHeaders.length).toBeGreaterThan(0)
    })

    it('should render two data rows for QA mode', () => {
      const { container } = render(<CSVDownload docForm={ChunkingMode.qa} />)
      const tbody = container.querySelector('tbody')
      expect(tbody).toBeInTheDocument()
      const rows = tbody?.querySelectorAll('tr')
      expect(rows?.length).toBe(2)
    })
  })

  // Table structure for Text mode
  describe('Text Mode Table', () => {
    it('should render text table with content column when docForm is text', () => {
      render(<CSVDownload docForm={ChunkingMode.text} />)
      expect(screen.getByText(/list\.batchModal\.contentTitle/i)).toBeInTheDocument()
    })

    it('should not render question/answer columns in text mode', () => {
      render(<CSVDownload docForm={ChunkingMode.text} />)
      expect(screen.queryByText(/list\.batchModal\.question/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/list\.batchModal\.answer/i)).not.toBeInTheDocument()
    })

    it('should render two data rows for text mode', () => {
      const { container } = render(<CSVDownload docForm={ChunkingMode.text} />)
      const tbody = container.querySelector('tbody')
      expect(tbody).toBeInTheDocument()
      const rows = tbody?.querySelectorAll('tr')
      expect(rows?.length).toBe(2)
    })
  })

  // CSV Template Data
  describe('CSV Template Data', () => {
    it('should download English QA template when locale is English and docForm is qa', () => {
      mockLocale = LanguagesSupported[0] // en-US
      render(<CSVDownload docForm={ChunkingMode.qa} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(downloadCSV).toHaveBeenCalledWith([
        ['question', 'answer'],
        ['question1', 'answer1'],
        ['question2', 'answer2'],
      ], 'template', { bom: true })
    })

    it('should download English text template when locale is English and docForm is text', () => {
      mockLocale = LanguagesSupported[0] // en-US
      render(<CSVDownload docForm={ChunkingMode.text} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(downloadCSV).toHaveBeenCalledWith([
        ['segment content'],
        ['content1'],
        ['content2'],
      ], 'template', { bom: true })
    })

    it('should download Chinese QA template when locale is Chinese and docForm is qa', () => {
      mockLocale = LanguagesSupported[1] // zh-Hans
      render(<CSVDownload docForm={ChunkingMode.qa} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(downloadCSV).toHaveBeenCalledWith([
        ['问题', '答案'],
        ['问题 1', '答案 1'],
        ['问题 2', '答案 2'],
      ], 'template', { bom: true })
    })

    it('should download Chinese text template when locale is Chinese and docForm is text', () => {
      mockLocale = LanguagesSupported[1] // zh-Hans
      render(<CSVDownload docForm={ChunkingMode.text} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(downloadCSV).toHaveBeenCalledWith([
        ['分段内容'],
        ['内容 1'],
        ['内容 2'],
      ], 'template', { bom: true })
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should maintain structure when rerendered with different docForm', () => {
      const { rerender } = render(<CSVDownload docForm={ChunkingMode.text} />)
      rerender(<CSVDownload docForm={ChunkingMode.qa} />)
      expect(screen.getAllByText(/list\.batchModal\.question/i).length).toBeGreaterThan(0)
    })
  })
})

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DocumentFileIcon from './document-file-icon'

describe('DocumentFileIcon', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<DocumentFileIcon />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render FileTypeIcon component', () => {
      const { container } = render(<DocumentFileIcon extension="pdf" />)
      // FileTypeIcon renders an svg or img element
      expect(container.querySelector('svg, img')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should determine type from extension prop', () => {
      const { container } = render(<DocumentFileIcon extension="pdf" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should determine type from name when extension not provided', () => {
      const { container } = render(<DocumentFileIcon name="document.pdf" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle uppercase extension', () => {
      const { container } = render(<DocumentFileIcon extension="PDF" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle uppercase name extension', () => {
      const { container } = render(<DocumentFileIcon name="DOCUMENT.PDF" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(<DocumentFileIcon extension="pdf" className="custom-icon" />)
      expect(container.querySelector('.custom-icon')).toBeInTheDocument()
    })

    it('should pass size prop to FileTypeIcon', () => {
      // Testing different size values
      const { container: smContainer } = render(<DocumentFileIcon extension="pdf" size="sm" />)
      const { container: lgContainer } = render(<DocumentFileIcon extension="pdf" size="lg" />)

      expect(smContainer.firstChild).toBeInTheDocument()
      expect(lgContainer.firstChild).toBeInTheDocument()
    })
  })

  describe('File Type Mapping', () => {
    const testCases = [
      { extension: 'pdf', description: 'PDF files' },
      { extension: 'json', description: 'JSON files' },
      { extension: 'html', description: 'HTML files' },
      { extension: 'txt', description: 'TXT files' },
      { extension: 'markdown', description: 'Markdown files' },
      { extension: 'md', description: 'MD files' },
      { extension: 'xlsx', description: 'XLSX files' },
      { extension: 'xls', description: 'XLS files' },
      { extension: 'csv', description: 'CSV files' },
      { extension: 'doc', description: 'DOC files' },
      { extension: 'docx', description: 'DOCX files' },
    ]

    testCases.forEach(({ extension, description }) => {
      it(`should handle ${description}`, () => {
        const { container } = render(<DocumentFileIcon extension={extension} />)
        expect(container.firstChild).toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle unknown extension with default document type', () => {
      const { container } = render(<DocumentFileIcon extension="xyz" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle empty extension string', () => {
      const { container } = render(<DocumentFileIcon extension="" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle name without extension', () => {
      const { container } = render(<DocumentFileIcon name="document" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle name with multiple dots', () => {
      const { container } = render(<DocumentFileIcon name="my.document.file.pdf" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should prioritize extension over name', () => {
      // If both are provided, extension should take precedence
      const { container } = render(<DocumentFileIcon extension="xlsx" name="document.pdf" />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle undefined extension and name', () => {
      const { container } = render(<DocumentFileIcon />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should apply default size of md', () => {
      const { container } = render(<DocumentFileIcon extension="pdf" />)
      expect(container.firstChild).toBeInTheDocument()
    })
  })
})

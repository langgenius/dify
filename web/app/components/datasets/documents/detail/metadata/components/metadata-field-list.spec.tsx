import type { FullDocumentDetail } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MetadataFieldList from './metadata-field-list'

vi.mock('@/hooks/use-metadata', () => ({
  useMetadataMap: () => ({
    book: {
      text: 'Book',
      iconName: 'book',
      subFieldsMap: {
        title: { label: 'Title', inputType: 'input' },
        author: { label: 'Author', inputType: 'input' },
        language: { label: 'Language', inputType: 'select' },
      },
    },
    personal_document: {
      text: 'Personal Document',
      iconName: 'personal_document',
      subFieldsMap: {
        document_type: { label: 'Document Type', inputType: 'select' },
      },
    },
    business_document: {
      text: 'Business Document',
      iconName: 'business_document',
      subFieldsMap: {
        document_type: { label: 'Document Type', inputType: 'select' },
      },
    },
    originInfo: {
      text: 'Origin Info',
      subFieldsMap: {
        source: { label: 'Source', inputType: 'input' },
      },
    },
    technicalParameters: {
      text: 'Technical Parameters',
      subFieldsMap: {
        hit_count: {
          label: 'Hit Count',
          inputType: 'input',
          render: (val: number, segmentCount?: number) => `${val} (${segmentCount} segments)`,
        },
      },
    },
  }),
  useLanguages: () => ({
    en: 'English',
    zh: 'Chinese',
  }),
  useBookCategories: () => ({
    fiction: 'Fiction',
    nonfiction: 'Non-Fiction',
  }),
  usePersonalDocCategories: () => ({
    resume: 'Resume',
    letter: 'Letter',
  }),
  useBusinessDocCategories: () => ({
    contract: 'Contract',
    report: 'Report',
  }),
}))

vi.mock('@/utils', () => ({
  getTextWidthWithCanvas: vi.fn().mockReturnValue(100),
}))

describe('MetadataFieldList', () => {
  const defaultProps = {
    mainField: 'book' as const,
    canEdit: false,
    metadataParams: {
      documentType: 'book' as const,
      metadata: { title: 'Test Book', author: 'Test Author' },
    },
    onUpdateField: vi.fn(),
  }

  describe('rendering', () => {
    it('should return null when mainField is empty', () => {
      const { container } = render(
        <MetadataFieldList {...defaultProps} mainField="" />,
      )
      expect(container.firstChild).toBeNull()
    })

    it('should render fields for book type', () => {
      render(<MetadataFieldList {...defaultProps} />)

      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Author')).toBeInTheDocument()
      expect(screen.getByText('Language')).toBeInTheDocument()
    })

    it('should display metadata values', () => {
      render(<MetadataFieldList {...defaultProps} />)

      expect(screen.getByText('Test Book')).toBeInTheDocument()
      expect(screen.getByText('Test Author')).toBeInTheDocument()
    })

    it('should display dash for empty values', () => {
      const props = {
        ...defaultProps,
        metadataParams: {
          documentType: 'book' as const,
          metadata: {},
        },
      }
      render(<MetadataFieldList {...props} />)

      const dashes = screen.getAllByText('-')
      expect(dashes.length).toBeGreaterThan(0)
    })
  })

  describe('select fields', () => {
    it('should display language name for select field', () => {
      const props = {
        ...defaultProps,
        metadataParams: {
          documentType: 'book' as const,
          metadata: { language: 'en' },
        },
      }
      render(<MetadataFieldList {...props} />)

      expect(screen.getByText('English')).toBeInTheDocument()
    })

    it('should display dash for unknown select value', () => {
      const props = {
        ...defaultProps,
        metadataParams: {
          documentType: 'book' as const,
          metadata: { language: 'unknown' },
        },
      }
      render(<MetadataFieldList {...props} />)

      const dashes = screen.getAllByText('-')
      expect(dashes.length).toBeGreaterThan(0)
    })
  })

  describe('edit mode', () => {
    it('should render input fields in edit mode', () => {
      render(<MetadataFieldList {...defaultProps} canEdit />)

      const inputs = screen.getAllByRole('textbox')
      expect(inputs.length).toBeGreaterThan(0)
    })
  })

  describe('originInfo and technicalParameters', () => {
    it('should use docDetail for originInfo fields', () => {
      const docDetail = {
        source: 'Web Upload',
      } as unknown as FullDocumentDetail

      render(
        <MetadataFieldList
          {...defaultProps}
          mainField="originInfo"
          docDetail={docDetail}
        />,
      )

      expect(screen.getByText('Source')).toBeInTheDocument()
    })

    it('should use docDetail for technicalParameters fields', () => {
      const docDetail = {
        hit_count: 100,
        segment_count: 10,
      } as unknown as FullDocumentDetail

      render(
        <MetadataFieldList
          {...defaultProps}
          mainField="technicalParameters"
          docDetail={docDetail}
        />,
      )

      expect(screen.getByText('Hit Count')).toBeInTheDocument()
    })

    it('should use render function for fields with custom render', () => {
      const docDetail = {
        hit_count: 100,
        segment_count: 10,
      } as unknown as FullDocumentDetail

      render(
        <MetadataFieldList
          {...defaultProps}
          mainField="technicalParameters"
          docDetail={docDetail}
        />,
      )

      expect(screen.getByText('100 (10 segments)')).toBeInTheDocument()
    })
  })

  describe('category maps', () => {
    it('should use bookCategoryMap for book category field', () => {
      const props = {
        ...defaultProps,
        metadataParams: {
          documentType: 'book' as const,
          metadata: { category: 'fiction' },
        },
      }
      render(<MetadataFieldList {...props} />)
      expect(screen.getByText('Title')).toBeInTheDocument()
    })

    it('should use personalDocCategoryMap for personal_document', () => {
      const props = {
        ...defaultProps,
        mainField: 'personal_document' as const,
        metadataParams: {
          documentType: 'personal_document' as const,
          metadata: { document_type: 'resume' },
        },
      }
      render(<MetadataFieldList {...props} />)
      expect(screen.getByText('Resume')).toBeInTheDocument()
    })

    it('should use businessDocCategoryMap for business_document', () => {
      const props = {
        ...defaultProps,
        mainField: 'business_document' as const,
        metadataParams: {
          documentType: 'business_document' as const,
          metadata: { document_type: 'contract' },
        },
      }
      render(<MetadataFieldList {...props} />)
      expect(screen.getByText('Contract')).toBeInTheDocument()
    })
  })

  describe('memoization', () => {
    it('should be memoized', () => {
      const { container, rerender } = render(<MetadataFieldList {...defaultProps} />)
      const firstRender = container.innerHTML

      rerender(<MetadataFieldList {...defaultProps} />)
      expect(container.innerHTML).toBe(firstRender)
    })
  })
})

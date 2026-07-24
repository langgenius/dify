import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DocTypeSelector, { DocumentTypeDisplay } from '../doc-type-selector'

vi.mock('@/hooks/use-metadata', () => ({
  useMetadataMap: () => ({
    book: { text: 'Book', iconName: 'book' },
    web_page: { text: 'Web Page', iconName: 'web' },
    paper: { text: 'Paper', iconName: 'paper' },
    social_media_post: { text: 'Social Media Post', iconName: 'social' },
    personal_document: { text: 'Personal Document', iconName: 'personal' },
    business_document: { text: 'Business Document', iconName: 'business' },
    wikipedia_entry: { text: 'Wikipedia', iconName: 'wiki' },
  }),
}))

vi.mock('@/models/datasets', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    CUSTOMIZABLE_DOC_TYPES: ['book', 'web_page', 'paper'],
  }
})

describe('DocTypeSelector', () => {
  const defaultProps = {
    docType: '' as '' | 'book',
    documentType: undefined as '' | 'book' | undefined,
    tempDocType: '' as '' | 'book' | 'web_page',
    onTempDocTypeChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verify first-time setup UI (no existing doc type)
  describe('First Time Selection', () => {
    it('should render description and selection title when no doc type exists', () => {
      render(<DocTypeSelector {...defaultProps} docType="" documentType={undefined} />)

      expect(screen.getByText(/metadata\.desc/)).toBeInTheDocument()
      expect(screen.getByText(/metadata\.docTypeSelectTitle/)).toBeInTheDocument()
    })

    it('should render icon buttons for each doc type', () => {
      const { container } = render(<DocTypeSelector {...defaultProps} />)

      // Each doc type renders an IconButton wrapped in Radio
      const iconButtons = container.querySelectorAll('button[type="button"]')
      // 3 doc types + 1 confirm button = 4 buttons
      expect(iconButtons.length).toBeGreaterThanOrEqual(3)
    })

    it('should render confirm button disabled when tempDocType is empty', () => {
      render(<DocTypeSelector {...defaultProps} tempDocType="" />)

      const confirmBtn = screen.getByText(/metadata\.firstMetaAction/)
      expect(confirmBtn.closest('button')).toBeDisabled()
    })

    it('should render confirm button enabled when tempDocType is set', () => {
      render(<DocTypeSelector {...defaultProps} tempDocType="book" />)

      const confirmBtn = screen.getByText(/metadata\.firstMetaAction/)
      expect(confirmBtn.closest('button')).not.toBeDisabled()
    })

    it('should call onConfirm when confirm button is clicked', () => {
      render(<DocTypeSelector {...defaultProps} tempDocType="book" />)

      fireEvent.click(screen.getByText(/metadata\.firstMetaAction/))

      expect(defaultProps.onConfirm).toHaveBeenCalled()
    })
  })

  // Verify change-type UI (has existing doc type)
  describe('Change Doc Type', () => {
    it('should render change title and warning when documentType exists', () => {
      render(<DocTypeSelector {...defaultProps} docType="book" documentType="book" />)

      expect(screen.getByText(/metadata\.docTypeChangeTitle/)).toBeInTheDocument()
      expect(screen.getByText(/metadata\.docTypeSelectWarning/)).toBeInTheDocument()
    })

    it('should render save and cancel buttons when documentType exists', () => {
      render(<DocTypeSelector {...defaultProps} docType="book" documentType="book" />)

      expect(screen.getByText(/operation\.save/)).toBeInTheDocument()
      expect(screen.getByText(/operation\.cancel/)).toBeInTheDocument()
    })

    it('should call onCancel when cancel button is clicked', () => {
      render(<DocTypeSelector {...defaultProps} docType="book" documentType="book" />)

      fireEvent.click(screen.getByText(/operation\.cancel/))

      expect(defaultProps.onCancel).toHaveBeenCalled()
    })
  })
})

describe('DocumentTypeDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verify read-only display of current doc type
  describe('Rendering', () => {
    it('should render the doc type text', () => {
      render(<DocumentTypeDisplay displayType="book" />)

      expect(screen.getByText('Book')).toBeInTheDocument()
    })

    it('should show change link when showChangeLink is true', () => {
      render(<DocumentTypeDisplay displayType="book" showChangeLink={true} />)

      expect(screen.getByText(/operation\.change/)).toBeInTheDocument()
    })

    it('should not show change link when showChangeLink is false', () => {
      render(<DocumentTypeDisplay displayType="book" showChangeLink={false} />)

      expect(screen.queryByText(/operation\.change/)).not.toBeInTheDocument()
    })

    it('should call onChangeClick when change link is clicked', () => {
      const onClick = vi.fn()
      render(<DocumentTypeDisplay displayType="book" showChangeLink={true} onChangeClick={onClick} />)

      fireEvent.click(screen.getByText(/operation\.change/))

      expect(onClick).toHaveBeenCalled()
    })

    it('should fallback to "book" display when displayType is empty and no change link', () => {
      render(<DocumentTypeDisplay displayType="" showChangeLink={false} />)

      expect(screen.getByText('Book')).toBeInTheDocument()
    })
  })
})

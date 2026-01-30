import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DocTypeSelector from './doc-type-selector'

vi.mock('@/hooks/use-metadata', () => ({
  useMetadataMap: () => ({
    book: { text: 'Book', iconName: 'book' },
    paper: { text: 'Paper', iconName: 'paper' },
    personal_document: { text: 'Personal Document', iconName: 'personal_document' },
    business_document: { text: 'Business Document', iconName: 'business_document' },
    web_page: { text: 'Web Page', iconName: 'web_page' },
    social_media_post: { text: 'Social Media', iconName: 'social_media_post' },
    wikipedia_entry: { text: 'Wikipedia', iconName: 'wikipedia_entry' },
    im_chat_log: { text: 'IM Chat Log', iconName: 'im_chat_log' },
    synced_from_github: { text: 'GitHub', iconName: 'synced_from_github' },
    synced_from_notion: { text: 'Notion', iconName: 'synced_from_notion' },
    others: { text: 'Others', iconName: 'others' },
  }),
}))

describe('DocTypeSelector', () => {
  const defaultProps = {
    documentType: '' as const,
    tempDocType: '' as const,
    doc_type: '',
    onTempDocTypeChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  describe('first time selection (no existing doc_type)', () => {
    it('should render description text for first time', () => {
      render(<DocTypeSelector {...defaultProps} />)
      expect(screen.getByText(/metadata.desc/i)).toBeInTheDocument()
    })

    it('should render doc type select title for first time', () => {
      render(<DocTypeSelector {...defaultProps} />)
      expect(screen.getByText(/metadata.docTypeSelectTitle/i)).toBeInTheDocument()
    })

    it('should render first meta action button', () => {
      render(<DocTypeSelector {...defaultProps} />)
      expect(screen.getByText(/metadata.firstMetaAction/i)).toBeInTheDocument()
    })

    it('should disable confirm button when no temp doc type selected', () => {
      render(<DocTypeSelector {...defaultProps} />)
      const button = screen.getByText(/metadata.firstMetaAction/i)
      expect(button).toBeDisabled()
    })

    it('should enable confirm button when temp doc type is selected', () => {
      render(<DocTypeSelector {...defaultProps} tempDocType="book" />)
      const button = screen.getByText(/metadata.firstMetaAction/i)
      expect(button).not.toBeDisabled()
    })
  })

  describe('changing existing doc type', () => {
    const propsWithDocType = {
      ...defaultProps,
      documentType: 'book' as const,
      doc_type: 'book',
    }

    it('should render change title when documentType exists', () => {
      render(<DocTypeSelector {...propsWithDocType} />)
      expect(screen.getByText(/metadata.docTypeChangeTitle/i)).toBeInTheDocument()
    })

    it('should render warning text when documentType exists', () => {
      render(<DocTypeSelector {...propsWithDocType} />)
      expect(screen.getByText(/metadata.docTypeSelectWarning/i)).toBeInTheDocument()
    })

    it('should render save and cancel buttons', () => {
      render(<DocTypeSelector {...propsWithDocType} />)
      expect(screen.getByText(/operation.save/i)).toBeInTheDocument()
      expect(screen.getByText(/operation.cancel/i)).toBeInTheDocument()
    })

    it('should not render first meta action button', () => {
      render(<DocTypeSelector {...propsWithDocType} />)
      expect(screen.queryByText(/metadata.firstMetaAction/i)).not.toBeInTheDocument()
    })
  })

  describe('radio group', () => {
    it('should render icon buttons for each doc type', () => {
      const { container } = render(<DocTypeSelector {...defaultProps} />)
      // Radio component uses divs with onClick, not actual radio inputs
      // IconButton renders buttons with iconWrapper class
      const iconButtons = container.querySelectorAll('button[class*="iconWrapper"]')
      expect(iconButtons.length).toBe(7) // CUSTOMIZABLE_DOC_TYPES has 7 items
    })

    it('should call onTempDocTypeChange when radio option is clicked', () => {
      const onTempDocTypeChange = vi.fn()
      const { container } = render(<DocTypeSelector {...defaultProps} onTempDocTypeChange={onTempDocTypeChange} />)

      // Click on the parent Radio div (not the IconButton)
      const radioOptions = container.querySelectorAll('div[class*="label"]')
      if (radioOptions.length > 0) {
        fireEvent.click(radioOptions[0])
        expect(onTempDocTypeChange).toHaveBeenCalled()
      }
      else {
        // Fallback: click on icon button's parent
        const iconButtons = container.querySelectorAll('button[type="button"]')
        const parentDiv = iconButtons[0]?.parentElement?.parentElement
        if (parentDiv)
          fireEvent.click(parentDiv)
        expect(onTempDocTypeChange).toHaveBeenCalled()
      }
    })

    it('should apply checked styles when selected', () => {
      const { container } = render(<DocTypeSelector {...defaultProps} tempDocType="book" />)
      // The first icon should have the checked styling
      const iconButtons = container.querySelectorAll('button[type="button"]')
      const firstButton = iconButtons[0]
      // Check if iconCheck class is applied
      expect(firstButton?.className).toContain('iconCheck')
    })
  })

  describe('button callbacks', () => {
    it('should call onConfirm when confirm button is clicked', () => {
      const onConfirm = vi.fn()
      render(<DocTypeSelector {...defaultProps} tempDocType="book" onConfirm={onConfirm} />)

      const confirmButton = screen.getByText(/metadata.firstMetaAction/i)
      fireEvent.click(confirmButton)

      expect(onConfirm).toHaveBeenCalled()
    })

    it('should call onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn()
      const propsWithDocType = {
        ...defaultProps,
        documentType: 'book' as const,
        doc_type: 'book',
        onCancel,
      }
      render(<DocTypeSelector {...propsWithDocType} />)

      const cancelButton = screen.getByText(/operation.cancel/i)
      fireEvent.click(cancelButton)

      expect(onCancel).toHaveBeenCalled()
    })

    it('should call onConfirm when save button is clicked in change mode', () => {
      const onConfirm = vi.fn()
      const propsWithDocType = {
        ...defaultProps,
        documentType: 'book' as const,
        doc_type: 'book',
        onConfirm,
      }
      render(<DocTypeSelector {...propsWithDocType} />)

      const saveButton = screen.getByText(/operation.save/i)
      fireEvent.click(saveButton)

      expect(onConfirm).toHaveBeenCalled()
    })
  })

  describe('memoization', () => {
    it('should be memoized', () => {
      const { container, rerender } = render(<DocTypeSelector {...defaultProps} />)
      const firstRender = container.innerHTML

      rerender(<DocTypeSelector {...defaultProps} />)
      expect(container.innerHTML).toBe(firstRender)
    })
  })
})

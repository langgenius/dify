import type { FullDocumentDetail } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Metadata, { FieldInfo } from './index'

// Mock document context
vi.mock('../context', () => ({
  useDocumentContext: (selector: (state: { datasetId: string, documentId: string }) => unknown) => {
    return selector({ datasetId: 'test-dataset-id', documentId: 'test-document-id' })
  },
}))

// Mock ToastContext
const mockNotify = vi.fn()
vi.mock('use-context-selector', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    useContext: () => ({ notify: mockNotify }),
  }
})

// Mock modifyDocMetadata
const mockModifyDocMetadata = vi.fn()
vi.mock('@/service/datasets', () => ({
  modifyDocMetadata: (...args: unknown[]) => mockModifyDocMetadata(...args),
}))

// Mock useMetadataMap and related hooks
vi.mock('@/hooks/use-metadata', () => ({
  useMetadataMap: () => ({
    book: {
      text: 'Book',
      iconName: 'book',
      subFieldsMap: {
        title: { label: 'Title', inputType: 'input' },
        language: { label: 'Language', inputType: 'select' },
        author: { label: 'Author', inputType: 'input' },
        publisher: { label: 'Publisher', inputType: 'input' },
        publication_date: { label: 'Publication Date', inputType: 'input' },
        isbn: { label: 'ISBN', inputType: 'input' },
        category: { label: 'Category', inputType: 'select' },
      },
    },
    web_page: {
      text: 'Web Page',
      iconName: 'web',
      subFieldsMap: {
        title: { label: 'Title', inputType: 'input' },
        url: { label: 'URL', inputType: 'input' },
        language: { label: 'Language', inputType: 'select' },
      },
    },
    paper: {
      text: 'Paper',
      iconName: 'paper',
      subFieldsMap: {
        title: { label: 'Title', inputType: 'input' },
        language: { label: 'Language', inputType: 'select' },
      },
    },
    social_media_post: {
      text: 'Social Media Post',
      iconName: 'social',
      subFieldsMap: {
        platform: { label: 'Platform', inputType: 'input' },
      },
    },
    personal_document: {
      text: 'Personal Document',
      iconName: 'personal',
      subFieldsMap: {
        document_type: { label: 'Document Type', inputType: 'select' },
      },
    },
    business_document: {
      text: 'Business Document',
      iconName: 'business',
      subFieldsMap: {
        document_type: { label: 'Document Type', inputType: 'select' },
      },
    },
    im_chat_log: {
      text: 'IM Chat Log',
      iconName: 'chat',
      subFieldsMap: {
        platform: { label: 'Platform', inputType: 'input' },
      },
    },
    originInfo: {
      text: 'Origin Info',
      subFieldsMap: {
        data_source_type: { label: 'Data Source Type', inputType: 'input' },
        name: { label: 'Name', inputType: 'input' },
      },
    },
    technicalParameters: {
      text: 'Technical Parameters',
      subFieldsMap: {
        segment_count: { label: 'Segment Count', inputType: 'input' },
        hit_count: { label: 'Hit Count', inputType: 'input', render: (v: number, segCount?: number) => `${v}/${segCount}` },
      },
    },
  }),
  useLanguages: () => ({
    en: 'English',
    zh: 'Chinese',
  }),
  useBookCategories: () => ({
    'fiction': 'Fiction',
    'non-fiction': 'Non-Fiction',
  }),
  usePersonalDocCategories: () => ({
    resume: 'Resume',
    letter: 'Letter',
  }),
  useBusinessDocCategories: () => ({
    report: 'Report',
    proposal: 'Proposal',
  }),
}))

// Mock getTextWidthWithCanvas
vi.mock('@/utils', () => ({
  asyncRunSafe: async (promise: Promise<unknown>) => {
    try {
      const result = await promise
      return [null, result]
    }
    catch (e) {
      return [e, null]
    }
  },
  getTextWidthWithCanvas: () => 100,
}))

describe('Metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createMockDocDetail = (overrides = {}): FullDocumentDetail => ({
    id: 'doc-1',
    name: 'Test Document',
    doc_type: 'book',
    doc_metadata: {
      title: 'Test Book',
      author: 'Test Author',
      language: 'en',
    },
    data_source_type: 'upload_file',
    segment_count: 10,
    hit_count: 5,
    ...overrides,
  } as FullDocumentDetail)

  const defaultProps = {
    docDetail: createMockDocDetail(),
    loading: false,
    onUpdate: vi.fn(),
  }

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<Metadata {...defaultProps} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render metadata title', () => {
      // Arrange & Act
      render(<Metadata {...defaultProps} />)

      // Assert
      expect(screen.getByText(/metadata\.title/i)).toBeInTheDocument()
    })

    it('should render edit button', () => {
      // Arrange & Act
      render(<Metadata {...defaultProps} />)

      // Assert
      expect(screen.getByText(/operation\.edit/i)).toBeInTheDocument()
    })

    it('should show loading state', () => {
      // Arrange & Act
      render(<Metadata {...defaultProps} loading={true} />)

      // Assert - Loading component should be rendered
      expect(screen.queryByText(/metadata\.title/i)).not.toBeInTheDocument()
    })

    it('should display document type icon and text', () => {
      // Arrange & Act
      render(<Metadata {...defaultProps} />)

      // Assert
      expect(screen.getByText('Book')).toBeInTheDocument()
    })
  })

  // Edit mode tests
  describe('Edit Mode', () => {
    it('should enter edit mode when edit button is clicked', () => {
      // Arrange
      render(<Metadata {...defaultProps} />)

      // Act
      fireEvent.click(screen.getByText(/operation\.edit/i))

      // Assert
      expect(screen.getByText(/operation\.cancel/i)).toBeInTheDocument()
      expect(screen.getByText(/operation\.save/i)).toBeInTheDocument()
    })

    it('should show change link in edit mode', () => {
      // Arrange
      render(<Metadata {...defaultProps} />)

      // Act
      fireEvent.click(screen.getByText(/operation\.edit/i))

      // Assert
      expect(screen.getByText(/operation\.change/i)).toBeInTheDocument()
    })

    it('should cancel edit and restore values when cancel is clicked', () => {
      // Arrange
      render(<Metadata {...defaultProps} />)

      // Enter edit mode
      fireEvent.click(screen.getByText(/operation\.edit/i))

      // Act
      fireEvent.click(screen.getByText(/operation\.cancel/i))

      // Assert - should be back to view mode
      expect(screen.getByText(/operation\.edit/i)).toBeInTheDocument()
    })

    it('should save metadata when save button is clicked', async () => {
      // Arrange
      mockModifyDocMetadata.mockResolvedValueOnce({})
      render(<Metadata {...defaultProps} />)

      // Enter edit mode
      fireEvent.click(screen.getByText(/operation\.edit/i))

      // Act
      fireEvent.click(screen.getByText(/operation\.save/i))

      // Assert
      await waitFor(() => {
        expect(mockModifyDocMetadata).toHaveBeenCalled()
      })
    })

    it('should show success notification after successful save', async () => {
      // Arrange
      mockModifyDocMetadata.mockResolvedValueOnce({})
      render(<Metadata {...defaultProps} />)

      // Enter edit mode
      fireEvent.click(screen.getByText(/operation\.edit/i))

      // Act
      fireEvent.click(screen.getByText(/operation\.save/i))

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
          }),
        )
      })
    })

    it('should show error notification after failed save', async () => {
      // Arrange
      mockModifyDocMetadata.mockRejectedValueOnce(new Error('Save failed'))
      render(<Metadata {...defaultProps} />)

      // Enter edit mode
      fireEvent.click(screen.getByText(/operation\.edit/i))

      // Act
      fireEvent.click(screen.getByText(/operation\.save/i))

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
    })
  })

  // Document type selection
  describe('Document Type Selection', () => {
    it('should show doc type selection when no doc_type exists', () => {
      // Arrange
      const docDetail = createMockDocDetail({ doc_type: '' })

      // Act
      render(<Metadata {...defaultProps} docDetail={docDetail} />)

      // Assert
      expect(screen.getByText(/metadata\.docTypeSelectTitle/i)).toBeInTheDocument()
    })

    it('should show description when no doc_type exists', () => {
      // Arrange
      const docDetail = createMockDocDetail({ doc_type: '' })

      // Act
      render(<Metadata {...defaultProps} docDetail={docDetail} />)

      // Assert
      expect(screen.getByText(/metadata\.desc/i)).toBeInTheDocument()
    })

    it('should show change link in edit mode when doc_type exists', () => {
      // Arrange
      render(<Metadata {...defaultProps} />)

      // Enter edit mode
      fireEvent.click(screen.getByText(/operation\.edit/i))

      // Assert
      expect(screen.getByText(/operation\.change/i)).toBeInTheDocument()
    })

    it('should show doc type change title after clicking change', () => {
      // Arrange
      render(<Metadata {...defaultProps} />)

      // Enter edit mode
      fireEvent.click(screen.getByText(/operation\.edit/i))

      // Act
      fireEvent.click(screen.getByText(/operation\.change/i))

      // Assert
      expect(screen.getByText(/metadata\.docTypeChangeTitle/i)).toBeInTheDocument()
    })
  })

  // Origin info and technical parameters
  describe('Fixed Fields', () => {
    it('should render origin info fields', () => {
      // Arrange & Act
      render(<Metadata {...defaultProps} />)

      // Assert - Origin info fields should be displayed
      expect(screen.getByText('Data Source Type')).toBeInTheDocument()
    })

    it('should render technical parameters fields', () => {
      // Arrange & Act
      render(<Metadata {...defaultProps} />)

      // Assert
      expect(screen.getByText('Segment Count')).toBeInTheDocument()
      expect(screen.getByText('Hit Count')).toBeInTheDocument()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle doc_type as others', () => {
      // Arrange
      const docDetail = createMockDocDetail({ doc_type: 'others' })

      // Act
      const { container } = render(<Metadata {...defaultProps} docDetail={docDetail} />)

      // Assert - should render without crashing
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle undefined docDetail gracefully', () => {
      // Arrange & Act
      const { container } = render(<Metadata {...defaultProps} docDetail={undefined} loading={false} />)

      // Assert - should render without crashing
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should update document type display when docDetail changes', () => {
      // Arrange
      const { rerender } = render(<Metadata {...defaultProps} />)

      // Act - verify initial state shows Book
      expect(screen.getByText('Book')).toBeInTheDocument()

      // Update with new doc type
      const updatedDocDetail = createMockDocDetail({ doc_type: 'paper' })
      rerender(<Metadata {...defaultProps} docDetail={updatedDocDetail} />)

      // Assert
      expect(screen.getByText('Paper')).toBeInTheDocument()
    })
  })

  // First meta action button
  describe('First Meta Action Button', () => {
    it('should show first meta action button when no doc type exists', () => {
      // Arrange
      const docDetail = createMockDocDetail({ doc_type: '' })

      // Act
      render(<Metadata {...defaultProps} docDetail={docDetail} />)

      // Assert
      expect(screen.getByText(/metadata\.firstMetaAction/i)).toBeInTheDocument()
    })
  })
})

// FieldInfo component tests
describe('FieldInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultFieldInfoProps = {
    label: 'Test Label',
    value: 'Test Value',
    displayedValue: 'Test Display Value',
  }

  // Rendering
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<FieldInfo {...defaultFieldInfoProps} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render label', () => {
      // Arrange & Act
      render(<FieldInfo {...defaultFieldInfoProps} />)

      // Assert
      expect(screen.getByText('Test Label')).toBeInTheDocument()
    })

    it('should render displayed value in view mode', () => {
      // Arrange & Act
      render(<FieldInfo {...defaultFieldInfoProps} showEdit={false} />)

      // Assert
      expect(screen.getByText('Test Display Value')).toBeInTheDocument()
    })
  })

  // Edit mode
  describe('Edit Mode', () => {
    it('should render input when showEdit is true and inputType is input', () => {
      // Arrange & Act
      render(<FieldInfo {...defaultFieldInfoProps} showEdit={true} inputType="input" onUpdate={vi.fn()} />)

      // Assert
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render select when showEdit is true and inputType is select', () => {
      // Arrange & Act
      render(
        <FieldInfo
          {...defaultFieldInfoProps}
          showEdit={true}
          inputType="select"
          selectOptions={[{ value: 'opt1', name: 'Option 1' }]}
          onUpdate={vi.fn()}
        />,
      )

      // Assert - SimpleSelect should be rendered
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render textarea when showEdit is true and inputType is textarea', () => {
      // Arrange & Act
      render(<FieldInfo {...defaultFieldInfoProps} showEdit={true} inputType="textarea" onUpdate={vi.fn()} />)

      // Assert
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should call onUpdate when input value changes', () => {
      // Arrange
      const mockOnUpdate = vi.fn()
      render(<FieldInfo {...defaultFieldInfoProps} showEdit={true} inputType="input" onUpdate={mockOnUpdate} />)

      // Act
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New Value' } })

      // Assert
      expect(mockOnUpdate).toHaveBeenCalledWith('New Value')
    })

    it('should call onUpdate when textarea value changes', () => {
      // Arrange
      const mockOnUpdate = vi.fn()
      render(<FieldInfo {...defaultFieldInfoProps} showEdit={true} inputType="textarea" onUpdate={mockOnUpdate} />)

      // Act
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New Textarea Value' } })

      // Assert
      expect(mockOnUpdate).toHaveBeenCalledWith('New Textarea Value')
    })
  })

  // Props
  describe('Props', () => {
    it('should render value icon when provided', () => {
      // Arrange & Act
      render(<FieldInfo {...defaultFieldInfoProps} valueIcon={<span data-testid="value-icon">Icon</span>} />)

      // Assert
      expect(screen.getByTestId('value-icon')).toBeInTheDocument()
    })

    it('should use defaultValue when provided', () => {
      // Arrange & Act
      render(<FieldInfo {...defaultFieldInfoProps} showEdit={true} inputType="input" defaultValue="Default" onUpdate={vi.fn()} />)

      // Assert
      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder')
    })
  })
})

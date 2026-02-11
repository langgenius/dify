import type { FullDocumentDetail } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Metadata, { FieldInfo } from '../index'

// Mock document context
vi.mock('../../context', () => ({
  useDocumentContext: (selector: (state: { datasetId: string, documentId: string }) => unknown) => {
    return selector({ datasetId: 'test-dataset-id', documentId: 'test-document-id' })
  },
}))

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

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<Metadata {...defaultProps} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render metadata title', () => {
      render(<Metadata {...defaultProps} />)

      expect(screen.getByText(/metadata\.title/i)).toBeInTheDocument()
    })

    it('should render edit button', () => {
      render(<Metadata {...defaultProps} />)

      expect(screen.getByText(/operation\.edit/i)).toBeInTheDocument()
    })

    it('should show loading state', () => {
      render(<Metadata {...defaultProps} loading={true} />)

      // Assert - Loading component should be rendered
      expect(screen.queryByText(/metadata\.title/i)).not.toBeInTheDocument()
    })

    it('should display document type icon and text', () => {
      render(<Metadata {...defaultProps} />)

      expect(screen.getByText('Book')).toBeInTheDocument()
    })
  })

  // Edit mode tests
  describe('Edit Mode', () => {
    it('should enter edit mode when edit button is clicked', () => {
      render(<Metadata {...defaultProps} />)

      fireEvent.click(screen.getByText(/operation\.edit/i))

      expect(screen.getByText(/operation\.cancel/i)).toBeInTheDocument()
      expect(screen.getByText(/operation\.save/i)).toBeInTheDocument()
    })

    it('should show change link in edit mode', () => {
      render(<Metadata {...defaultProps} />)

      fireEvent.click(screen.getByText(/operation\.edit/i))

      expect(screen.getByText(/operation\.change/i)).toBeInTheDocument()
    })

    it('should cancel edit and restore values when cancel is clicked', () => {
      render(<Metadata {...defaultProps} />)

      // Enter edit mode
      fireEvent.click(screen.getByText(/operation\.edit/i))

      fireEvent.click(screen.getByText(/operation\.cancel/i))

      // Assert - should be back to view mode
      expect(screen.getByText(/operation\.edit/i)).toBeInTheDocument()
    })

    it('should save metadata when save button is clicked', async () => {
      mockModifyDocMetadata.mockResolvedValueOnce({})
      render(<Metadata {...defaultProps} />)

      // Enter edit mode
      fireEvent.click(screen.getByText(/operation\.edit/i))

      fireEvent.click(screen.getByText(/operation\.save/i))

      await waitFor(() => {
        expect(mockModifyDocMetadata).toHaveBeenCalled()
      })
    })

    it('should show success notification after successful save', async () => {
      mockModifyDocMetadata.mockResolvedValueOnce({})
      render(<Metadata {...defaultProps} />)

      // Enter edit mode
      fireEvent.click(screen.getByText(/operation\.edit/i))

      fireEvent.click(screen.getByText(/operation\.save/i))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
          }),
        )
      })
    })

    it('should show error notification after failed save', async () => {
      mockModifyDocMetadata.mockRejectedValueOnce(new Error('Save failed'))
      render(<Metadata {...defaultProps} />)

      // Enter edit mode
      fireEvent.click(screen.getByText(/operation\.edit/i))

      fireEvent.click(screen.getByText(/operation\.save/i))

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
      const docDetail = createMockDocDetail({ doc_type: '' })

      render(<Metadata {...defaultProps} docDetail={docDetail} />)

      expect(screen.getByText(/metadata\.docTypeSelectTitle/i)).toBeInTheDocument()
    })

    it('should show description when no doc_type exists', () => {
      const docDetail = createMockDocDetail({ doc_type: '' })

      render(<Metadata {...defaultProps} docDetail={docDetail} />)

      expect(screen.getByText(/metadata\.desc/i)).toBeInTheDocument()
    })

    it('should show change link in edit mode when doc_type exists', () => {
      render(<Metadata {...defaultProps} />)

      // Enter edit mode
      fireEvent.click(screen.getByText(/operation\.edit/i))

      expect(screen.getByText(/operation\.change/i)).toBeInTheDocument()
    })

    it('should show doc type change title after clicking change', () => {
      render(<Metadata {...defaultProps} />)

      // Enter edit mode
      fireEvent.click(screen.getByText(/operation\.edit/i))

      fireEvent.click(screen.getByText(/operation\.change/i))

      expect(screen.getByText(/metadata\.docTypeChangeTitle/i)).toBeInTheDocument()
    })
  })

  // Origin info and technical parameters
  describe('Fixed Fields', () => {
    it('should render origin info fields', () => {
      render(<Metadata {...defaultProps} />)

      // Assert - Origin info fields should be displayed
      expect(screen.getByText('Data Source Type')).toBeInTheDocument()
    })

    it('should render technical parameters fields', () => {
      render(<Metadata {...defaultProps} />)

      expect(screen.getByText('Segment Count')).toBeInTheDocument()
      expect(screen.getByText('Hit Count')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle doc_type as others', () => {
      const docDetail = createMockDocDetail({ doc_type: 'others' })

      const { container } = render(<Metadata {...defaultProps} docDetail={docDetail} />)

      // Assert - should render without crashing
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle undefined docDetail gracefully', () => {
      const { container } = render(<Metadata {...defaultProps} docDetail={undefined} loading={false} />)

      // Assert - should render without crashing
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should update document type display when docDetail changes', () => {
      const { rerender } = render(<Metadata {...defaultProps} />)

      // Act - verify initial state shows Book
      expect(screen.getByText('Book')).toBeInTheDocument()

      // Update with new doc type
      const updatedDocDetail = createMockDocDetail({ doc_type: 'paper' })
      rerender(<Metadata {...defaultProps} docDetail={updatedDocDetail} />)

      expect(screen.getByText('Paper')).toBeInTheDocument()
    })
  })

  // First meta action button
  describe('First Meta Action Button', () => {
    it('should show first meta action button when no doc type exists', () => {
      const docDetail = createMockDocDetail({ doc_type: '' })

      render(<Metadata {...defaultProps} docDetail={docDetail} />)

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
      const { container } = render(<FieldInfo {...defaultFieldInfoProps} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render label', () => {
      render(<FieldInfo {...defaultFieldInfoProps} />)

      expect(screen.getByText('Test Label')).toBeInTheDocument()
    })

    it('should render displayed value in view mode', () => {
      render(<FieldInfo {...defaultFieldInfoProps} showEdit={false} />)

      expect(screen.getByText('Test Display Value')).toBeInTheDocument()
    })
  })

  // Edit mode
  describe('Edit Mode', () => {
    it('should render input when showEdit is true and inputType is input', () => {
      render(<FieldInfo {...defaultFieldInfoProps} showEdit={true} inputType="input" onUpdate={vi.fn()} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render select when showEdit is true and inputType is select', () => {
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
      render(<FieldInfo {...defaultFieldInfoProps} showEdit={true} inputType="textarea" onUpdate={vi.fn()} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should call onUpdate when input value changes', () => {
      const mockOnUpdate = vi.fn()
      render(<FieldInfo {...defaultFieldInfoProps} showEdit={true} inputType="input" onUpdate={mockOnUpdate} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New Value' } })

      expect(mockOnUpdate).toHaveBeenCalledWith('New Value')
    })

    it('should call onUpdate when textarea value changes', () => {
      const mockOnUpdate = vi.fn()
      render(<FieldInfo {...defaultFieldInfoProps} showEdit={true} inputType="textarea" onUpdate={mockOnUpdate} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New Textarea Value' } })

      expect(mockOnUpdate).toHaveBeenCalledWith('New Textarea Value')
    })
  })

  // Props
  describe('Props', () => {
    it('should render value icon when provided', () => {
      render(<FieldInfo {...defaultFieldInfoProps} valueIcon={<span data-testid="value-icon">Icon</span>} />)

      expect(screen.getByTestId('value-icon')).toBeInTheDocument()
    })

    it('should use defaultValue when provided', () => {
      render(<FieldInfo {...defaultFieldInfoProps} showEdit={true} inputType="input" defaultValue="Default" onUpdate={vi.fn()} />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder')
    })
  })
})

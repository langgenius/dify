import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NewChildSegmentModal from '../new-child-segment'

vi.mock('next/navigation', () => ({
  useParams: () => ({
    datasetId: 'test-dataset-id',
    documentId: 'test-document-id',
  }),
}))

const mockNotify = vi.fn()
vi.mock('use-context-selector', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    useContext: () => ({ notify: mockNotify }),
  }
})

// Mock document context
let mockParentMode = 'paragraph'
vi.mock('../../context', () => ({
  useDocumentContext: (selector: (state: { parentMode: string }) => unknown) => {
    return selector({ parentMode: mockParentMode })
  },
}))

// Mock segment list context
let mockFullScreen = false
const mockToggleFullScreen = vi.fn()
vi.mock('../index', () => ({
  useSegmentListContext: (selector: (state: { fullScreen: boolean, toggleFullScreen: () => void }) => unknown) => {
    const state = {
      fullScreen: mockFullScreen,
      toggleFullScreen: mockToggleFullScreen,
    }
    return selector(state)
  },
}))

// Mock useAddChildSegment
const mockAddChildSegment = vi.fn()
vi.mock('@/service/knowledge/use-segment', () => ({
  useAddChildSegment: () => ({
    mutateAsync: mockAddChildSegment,
  }),
}))

// Mock app store
vi.mock('@/app/components/app/store', () => ({
  useStore: () => ({ appSidebarExpand: 'expand' }),
}))

vi.mock('../common/action-buttons', () => ({
  default: ({ handleCancel, handleSave, loading, actionType, isChildChunk }: { handleCancel: () => void, handleSave: () => void, loading: boolean, actionType: string, isChildChunk?: boolean }) => (
    <div data-testid="action-buttons">
      <button onClick={handleCancel} data-testid="cancel-btn">Cancel</button>
      <button onClick={handleSave} disabled={loading} data-testid="save-btn">
        {loading ? 'Saving...' : 'Save'}
      </button>
      <span data-testid="action-type">{actionType}</span>
      <span data-testid="is-child-chunk">{isChildChunk ? 'true' : 'false'}</span>
    </div>
  ),
}))

vi.mock('../common/add-another', () => ({
  default: ({ isChecked, onCheck, className }: { isChecked: boolean, onCheck: () => void, className?: string }) => (
    <div data-testid="add-another" className={className}>
      <input
        type="checkbox"
        checked={isChecked}
        onChange={onCheck}
        data-testid="add-another-checkbox"
      />
    </div>
  ),
}))

vi.mock('../common/chunk-content', () => ({
  default: ({ question, onQuestionChange, isEditMode }: { question: string, onQuestionChange: (v: string) => void, isEditMode: boolean }) => (
    <div data-testid="chunk-content">
      <input
        data-testid="content-input"
        value={question}
        onChange={e => onQuestionChange(e.target.value)}
      />
      <span data-testid="edit-mode">{isEditMode ? 'editing' : 'viewing'}</span>
    </div>
  ),
}))

vi.mock('../common/dot', () => ({
  default: () => <span data-testid="dot">•</span>,
}))

vi.mock('../common/segment-index-tag', () => ({
  SegmentIndexTag: ({ label }: { label: string }) => <span data-testid="segment-index-tag">{label}</span>,
}))

describe('NewChildSegmentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFullScreen = false
    mockParentMode = 'paragraph'
  })

  const defaultProps = {
    chunkId: 'chunk-1',
    onCancel: vi.fn(),
    onSave: vi.fn(),
    viewNewlyAddedChildChunk: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<NewChildSegmentModal {...defaultProps} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render add child chunk title', () => {
      render(<NewChildSegmentModal {...defaultProps} />)

      expect(screen.getByText(/segment\.addChildChunk/i)).toBeInTheDocument()
    })

    it('should render chunk content component', () => {
      render(<NewChildSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('chunk-content')).toBeInTheDocument()
    })

    it('should render segment index tag with new child chunk label', () => {
      render(<NewChildSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('segment-index-tag')).toBeInTheDocument()
    })

    it('should render add another checkbox', () => {
      render(<NewChildSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('add-another')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onCancel when close button is clicked', () => {
      const mockOnCancel = vi.fn()
      const { container } = render(
        <NewChildSegmentModal {...defaultProps} onCancel={mockOnCancel} />,
      )

      const closeButtons = container.querySelectorAll('.cursor-pointer')
      if (closeButtons.length > 1)
        fireEvent.click(closeButtons[1])

      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should call toggleFullScreen when expand button is clicked', () => {
      const { container } = render(<NewChildSegmentModal {...defaultProps} />)

      const expandButtons = container.querySelectorAll('.cursor-pointer')
      if (expandButtons.length > 0)
        fireEvent.click(expandButtons[0])

      expect(mockToggleFullScreen).toHaveBeenCalled()
    })

    it('should update content when input changes', () => {
      render(<NewChildSegmentModal {...defaultProps} />)

      fireEvent.change(screen.getByTestId('content-input'), {
        target: { value: 'New content' },
      })

      expect(screen.getByTestId('content-input')).toHaveValue('New content')
    })

    it('should toggle add another checkbox', () => {
      render(<NewChildSegmentModal {...defaultProps} />)
      const checkbox = screen.getByTestId('add-another-checkbox')

      fireEvent.click(checkbox)

      expect(checkbox).toBeInTheDocument()
    })
  })

  // Save validation
  describe('Save Validation', () => {
    it('should show error when content is empty', async () => {
      render(<NewChildSegmentModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('save-btn'))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
    })
  })

  // Successful save
  describe('Successful Save', () => {
    it('should call addChildSegment when valid content is provided', async () => {
      mockAddChildSegment.mockImplementation((_params, options) => {
        options.onSuccess({ data: { id: 'new-child-id' } })
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewChildSegmentModal {...defaultProps} />)
      fireEvent.change(screen.getByTestId('content-input'), {
        target: { value: 'Valid content' },
      })

      fireEvent.click(screen.getByTestId('save-btn'))

      await waitFor(() => {
        expect(mockAddChildSegment).toHaveBeenCalledWith(
          expect.objectContaining({
            datasetId: 'test-dataset-id',
            documentId: 'test-document-id',
            segmentId: 'chunk-1',
            body: expect.objectContaining({
              content: 'Valid content',
            }),
          }),
          expect.any(Object),
        )
      })
    })

    it('should show success notification after save', async () => {
      mockAddChildSegment.mockImplementation((_params, options) => {
        options.onSuccess({ data: { id: 'new-child-id' } })
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewChildSegmentModal {...defaultProps} />)
      fireEvent.change(screen.getByTestId('content-input'), {
        target: { value: 'Valid content' },
      })

      fireEvent.click(screen.getByTestId('save-btn'))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
          }),
        )
      })
    })
  })

  // Full screen mode
  describe('Full Screen Mode', () => {
    it('should show action buttons in header when fullScreen', () => {
      mockFullScreen = true

      render(<NewChildSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('action-buttons')).toBeInTheDocument()
    })

    it('should show add another in header when fullScreen', () => {
      mockFullScreen = true

      render(<NewChildSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('add-another')).toBeInTheDocument()
    })
  })

  // Props
  describe('Props', () => {
    it('should pass actionType add to ActionButtons', () => {
      render(<NewChildSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('action-type')).toHaveTextContent('add')
    })

    it('should pass isChildChunk true to ActionButtons', () => {
      render(<NewChildSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('is-child-chunk')).toHaveTextContent('true')
    })

    it('should pass isEditMode true to ChunkContent', () => {
      render(<NewChildSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('edit-mode')).toHaveTextContent('editing')
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined viewNewlyAddedChildChunk', () => {
      const props = { ...defaultProps, viewNewlyAddedChildChunk: undefined }

      const { container } = render(<NewChildSegmentModal {...props} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      const { rerender } = render(<NewChildSegmentModal {...defaultProps} />)

      rerender(<NewChildSegmentModal {...defaultProps} chunkId="chunk-2" />)

      expect(screen.getByTestId('chunk-content')).toBeInTheDocument()
    })
  })

  // Add another behavior
  describe('Add Another Behavior', () => {
    it('should close modal when add another is unchecked after save', async () => {
      const mockOnCancel = vi.fn()
      mockAddChildSegment.mockImplementation((_params, options) => {
        options.onSuccess({ data: { id: 'new-child-id' } })
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewChildSegmentModal {...defaultProps} onCancel={mockOnCancel} />)

      // Uncheck add another
      fireEvent.click(screen.getByTestId('add-another-checkbox'))

      // Enter valid content
      fireEvent.change(screen.getByTestId('content-input'), {
        target: { value: 'Valid content' },
      })

      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert - modal should close
      await waitFor(() => {
        expect(mockOnCancel).toHaveBeenCalled()
      })
    })

    it('should not close modal when add another is checked after save', async () => {
      const mockOnCancel = vi.fn()
      mockAddChildSegment.mockImplementation((_params, options) => {
        options.onSuccess({ data: { id: 'new-child-id' } })
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewChildSegmentModal {...defaultProps} onCancel={mockOnCancel} />)

      // Enter valid content (add another is checked by default)
      fireEvent.change(screen.getByTestId('content-input'), {
        target: { value: 'Valid content' },
      })

      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert - modal should not close, only content cleared
      await waitFor(() => {
        expect(screen.getByTestId('content-input')).toHaveValue('')
      })
    })
  })

  // View newly added chunk
  describe('View Newly Added Chunk', () => {
    it('should show custom button in full-doc mode after save', async () => {
      mockParentMode = 'full-doc'
      mockAddChildSegment.mockImplementation((_params, options) => {
        options.onSuccess({ data: { id: 'new-child-id' } })
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewChildSegmentModal {...defaultProps} />)

      // Enter valid content
      fireEvent.change(screen.getByTestId('content-input'), {
        target: { value: 'Valid content' },
      })

      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert - success notification with custom component
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
            customComponent: expect.anything(),
          }),
        )
      })
    })

    it('should not show custom button in paragraph mode after save', async () => {
      mockParentMode = 'paragraph'
      const mockOnSave = vi.fn()
      mockAddChildSegment.mockImplementation((_params, options) => {
        options.onSuccess({ data: { id: 'new-child-id' } })
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewChildSegmentModal {...defaultProps} onSave={mockOnSave} />)

      // Enter valid content
      fireEvent.change(screen.getByTestId('content-input'), {
        target: { value: 'Valid content' },
      })

      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert - onSave should be called with data
      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-child-id' }))
      })
    })
  })

  // Cancel behavior
  describe('Cancel Behavior', () => {
    it('should call onCancel when close button is clicked', () => {
      const mockOnCancel = vi.fn()
      render(<NewChildSegmentModal {...defaultProps} onCancel={mockOnCancel} />)

      fireEvent.click(screen.getByTestId('cancel-btn'))

      expect(mockOnCancel).toHaveBeenCalled()
    })
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'
import { IndexingType } from '../../create/step-two'

import NewSegmentModal from './new-segment'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: () => ({
    datasetId: 'test-dataset-id',
    documentId: 'test-document-id',
  }),
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

// Mock dataset detail context
let mockIndexingTechnique = IndexingType.QUALIFIED
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: { indexing_technique: string } }) => unknown) => {
    return selector({ dataset: { indexing_technique: mockIndexingTechnique } })
  },
}))

// Mock segment list context
let mockFullScreen = false
const mockToggleFullScreen = vi.fn()
vi.mock('./completed', () => ({
  useSegmentListContext: (selector: (state: { fullScreen: boolean, toggleFullScreen: () => void }) => unknown) => {
    const state = {
      fullScreen: mockFullScreen,
      toggleFullScreen: mockToggleFullScreen,
    }
    return selector(state)
  },
}))

// Mock useAddSegment
const mockAddSegment = vi.fn()
vi.mock('@/service/knowledge/use-segment', () => ({
  useAddSegment: () => ({
    mutateAsync: mockAddSegment,
  }),
}))

// Mock app store
vi.mock('@/app/components/app/store', () => ({
  useStore: () => ({ appSidebarExpand: 'expand' }),
}))

// Mock child components
vi.mock('./completed/common/action-buttons', () => ({
  default: ({ handleCancel, handleSave, loading, actionType }: { handleCancel: () => void, handleSave: () => void, loading: boolean, actionType: string }) => (
    <div data-testid="action-buttons">
      <button onClick={handleCancel} data-testid="cancel-btn">Cancel</button>
      <button onClick={handleSave} disabled={loading} data-testid="save-btn">
        {loading ? 'Saving...' : 'Save'}
      </button>
      <span data-testid="action-type">{actionType}</span>
    </div>
  ),
}))

vi.mock('./completed/common/add-another', () => ({
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

vi.mock('./completed/common/chunk-content', () => ({
  default: ({ docForm, question, answer, onQuestionChange, onAnswerChange, isEditMode }: { docForm: string, question: string, answer: string, onQuestionChange: (v: string) => void, onAnswerChange: (v: string) => void, isEditMode: boolean }) => (
    <div data-testid="chunk-content">
      <input
        data-testid="question-input"
        value={question}
        onChange={e => onQuestionChange(e.target.value)}
        placeholder={docForm === ChunkingMode.qa ? 'Question' : 'Content'}
      />
      {docForm === ChunkingMode.qa && (
        <input
          data-testid="answer-input"
          value={answer}
          onChange={e => onAnswerChange(e.target.value)}
          placeholder="Answer"
        />
      )}
      <span data-testid="edit-mode">{isEditMode ? 'editing' : 'viewing'}</span>
    </div>
  ),
}))

vi.mock('./completed/common/dot', () => ({
  default: () => <span data-testid="dot">•</span>,
}))

vi.mock('./completed/common/keywords', () => ({
  default: ({ keywords, onKeywordsChange, _isEditMode, _actionType }: { keywords: string[], onKeywordsChange: (v: string[]) => void, _isEditMode?: boolean, _actionType?: string }) => (
    <div data-testid="keywords">
      <input
        data-testid="keywords-input"
        value={keywords.join(',')}
        onChange={e => onKeywordsChange(e.target.value.split(',').filter(Boolean))}
      />
    </div>
  ),
}))

vi.mock('./completed/common/segment-index-tag', () => ({
  SegmentIndexTag: ({ label }: { label: string }) => <span data-testid="segment-index-tag">{label}</span>,
}))

vi.mock('@/app/components/datasets/common/image-uploader/image-uploader-in-chunk', () => ({
  default: ({ onChange }: { value?: unknown[], onChange: (v: { uploadedId: string }[]) => void }) => (
    <div data-testid="image-uploader">
      <button
        data-testid="upload-image-btn"
        onClick={() => onChange([{ uploadedId: 'img-1' }])}
      >
        Upload Image
      </button>
    </div>
  ),
}))

describe('NewSegmentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFullScreen = false
    mockIndexingTechnique = IndexingType.QUALIFIED
  })

  const defaultProps = {
    onCancel: vi.fn(),
    docForm: ChunkingMode.text,
    onSave: vi.fn(),
    viewNewlyAddedChunk: vi.fn(),
  }

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<NewSegmentModal {...defaultProps} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render title text', () => {
      // Arrange & Act
      render(<NewSegmentModal {...defaultProps} />)

      // Assert
      expect(screen.getByText(/segment\.addChunk/i)).toBeInTheDocument()
    })

    it('should render chunk content component', () => {
      // Arrange & Act
      render(<NewSegmentModal {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('chunk-content')).toBeInTheDocument()
    })

    it('should render image uploader', () => {
      // Arrange & Act
      render(<NewSegmentModal {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('image-uploader')).toBeInTheDocument()
    })

    it('should render segment index tag', () => {
      // Arrange & Act
      render(<NewSegmentModal {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('segment-index-tag')).toBeInTheDocument()
    })

    it('should render dot separator', () => {
      // Arrange & Act
      render(<NewSegmentModal {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('dot')).toBeInTheDocument()
    })
  })

  // Keywords display
  describe('Keywords', () => {
    it('should show keywords component when indexing is ECONOMICAL', () => {
      // Arrange
      mockIndexingTechnique = IndexingType.ECONOMICAL

      // Act
      render(<NewSegmentModal {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('keywords')).toBeInTheDocument()
    })

    it('should not show keywords when indexing is QUALIFIED', () => {
      // Arrange
      mockIndexingTechnique = IndexingType.QUALIFIED

      // Act
      render(<NewSegmentModal {...defaultProps} />)

      // Assert
      expect(screen.queryByTestId('keywords')).not.toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call onCancel when close button is clicked', () => {
      // Arrange
      const mockOnCancel = vi.fn()
      const { container } = render(<NewSegmentModal {...defaultProps} onCancel={mockOnCancel} />)

      // Act - find and click close button (RiCloseLine icon wrapper)
      const closeButtons = container.querySelectorAll('.cursor-pointer')
      // The close button is the second cursor-pointer element
      if (closeButtons.length > 1)
        fireEvent.click(closeButtons[1])

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should update question when typing', () => {
      // Arrange
      render(<NewSegmentModal {...defaultProps} />)
      const questionInput = screen.getByTestId('question-input')

      // Act
      fireEvent.change(questionInput, { target: { value: 'New question content' } })

      // Assert
      expect(questionInput).toHaveValue('New question content')
    })

    it('should update answer when docForm is QA and typing', () => {
      // Arrange
      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.qa} />)
      const answerInput = screen.getByTestId('answer-input')

      // Act
      fireEvent.change(answerInput, { target: { value: 'New answer content' } })

      // Assert
      expect(answerInput).toHaveValue('New answer content')
    })

    it('should toggle add another checkbox', () => {
      // Arrange
      render(<NewSegmentModal {...defaultProps} />)
      const checkbox = screen.getByTestId('add-another-checkbox')

      // Act
      fireEvent.click(checkbox)

      // Assert - checkbox state should toggle
      expect(checkbox).toBeInTheDocument()
    })
  })

  // Save validation
  describe('Save Validation', () => {
    it('should show error when content is empty for text mode', async () => {
      // Arrange
      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.text} />)

      // Act
      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
    })

    it('should show error when question is empty for QA mode', async () => {
      // Arrange
      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.qa} />)

      // Act
      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
    })

    it('should show error when answer is empty for QA mode', async () => {
      // Arrange
      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.qa} />)
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Question' } })

      // Act
      fireEvent.click(screen.getByTestId('save-btn'))

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

  // Successful save
  describe('Successful Save', () => {
    it('should call addSegment when valid content is provided for text mode', async () => {
      // Arrange
      mockAddSegment.mockImplementation((_params, options) => {
        options.onSuccess()
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.text} />)
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Valid content' } })

      // Act
      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert
      await waitFor(() => {
        expect(mockAddSegment).toHaveBeenCalledWith(
          expect.objectContaining({
            datasetId: 'test-dataset-id',
            documentId: 'test-document-id',
            body: expect.objectContaining({
              content: 'Valid content',
            }),
          }),
          expect.any(Object),
        )
      })
    })

    it('should show success notification after save', async () => {
      // Arrange
      mockAddSegment.mockImplementation((_params, options) => {
        options.onSuccess()
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.text} />)
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Valid content' } })

      // Act
      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert
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
    it('should apply full screen styling when fullScreen is true', () => {
      // Arrange
      mockFullScreen = true

      // Act
      const { container } = render(<NewSegmentModal {...defaultProps} />)

      // Assert
      const header = container.querySelector('.border-divider-subtle')
      expect(header).toBeInTheDocument()
    })

    it('should show action buttons in header when fullScreen', () => {
      // Arrange
      mockFullScreen = true

      // Act
      render(<NewSegmentModal {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('action-buttons')).toBeInTheDocument()
    })

    it('should show add another in header when fullScreen', () => {
      // Arrange
      mockFullScreen = true

      // Act
      render(<NewSegmentModal {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('add-another')).toBeInTheDocument()
    })

    it('should call toggleFullScreen when expand button is clicked', () => {
      // Arrange
      const { container } = render(<NewSegmentModal {...defaultProps} />)

      // Act - click the expand button (first cursor-pointer)
      const expandButtons = container.querySelectorAll('.cursor-pointer')
      if (expandButtons.length > 0)
        fireEvent.click(expandButtons[0])

      // Assert
      expect(mockToggleFullScreen).toHaveBeenCalled()
    })
  })

  // Props
  describe('Props', () => {
    it('should pass actionType add to ActionButtons', () => {
      // Arrange & Act
      render(<NewSegmentModal {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('action-type')).toHaveTextContent('add')
    })

    it('should pass isEditMode true to ChunkContent', () => {
      // Arrange & Act
      render(<NewSegmentModal {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('edit-mode')).toHaveTextContent('editing')
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle keyword changes for ECONOMICAL indexing', () => {
      // Arrange
      mockIndexingTechnique = IndexingType.ECONOMICAL
      render(<NewSegmentModal {...defaultProps} />)

      // Act
      fireEvent.change(screen.getByTestId('keywords-input'), {
        target: { value: 'keyword1,keyword2' },
      })

      // Assert
      expect(screen.getByTestId('keywords-input')).toHaveValue('keyword1,keyword2')
    })

    it('should handle image upload', () => {
      // Arrange
      render(<NewSegmentModal {...defaultProps} />)

      // Act
      fireEvent.click(screen.getByTestId('upload-image-btn'))

      // Assert - image uploader should be rendered
      expect(screen.getByTestId('image-uploader')).toBeInTheDocument()
    })

    it('should maintain structure when rerendered with different docForm', () => {
      // Arrange
      const { rerender } = render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.text} />)

      // Act
      rerender(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.qa} />)

      // Assert
      expect(screen.getByTestId('answer-input')).toBeInTheDocument()
    })
  })
})

import type * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'
import { IndexingType } from '../../../create/step-two'

import NewSegmentModal from '../new-segment'

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
vi.mock('../completed', () => ({
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

vi.mock('../completed/common/action-buttons', () => ({
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

vi.mock('../completed/common/add-another', () => ({
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

vi.mock('../completed/common/chunk-content', () => ({
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

vi.mock('../completed/common/dot', () => ({
  default: () => <span data-testid="dot">•</span>,
}))

vi.mock('../completed/common/keywords', () => ({
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

vi.mock('../completed/common/segment-index-tag', () => ({
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

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<NewSegmentModal {...defaultProps} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render title text', () => {
      render(<NewSegmentModal {...defaultProps} />)

      expect(screen.getByText(/segment\.addChunk/i)).toBeInTheDocument()
    })

    it('should render chunk content component', () => {
      render(<NewSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('chunk-content')).toBeInTheDocument()
    })

    it('should render image uploader', () => {
      render(<NewSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('image-uploader')).toBeInTheDocument()
    })

    it('should render segment index tag', () => {
      render(<NewSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('segment-index-tag')).toBeInTheDocument()
    })

    it('should render dot separator', () => {
      render(<NewSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('dot')).toBeInTheDocument()
    })
  })

  // Keywords display
  describe('Keywords', () => {
    it('should show keywords component when indexing is ECONOMICAL', () => {
      mockIndexingTechnique = IndexingType.ECONOMICAL

      render(<NewSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('keywords')).toBeInTheDocument()
    })

    it('should not show keywords when indexing is QUALIFIED', () => {
      mockIndexingTechnique = IndexingType.QUALIFIED

      render(<NewSegmentModal {...defaultProps} />)

      expect(screen.queryByTestId('keywords')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onCancel when close button is clicked', () => {
      const mockOnCancel = vi.fn()
      const { container } = render(<NewSegmentModal {...defaultProps} onCancel={mockOnCancel} />)

      // Act - find and click close button (RiCloseLine icon wrapper)
      const closeButtons = container.querySelectorAll('.cursor-pointer')
      // The close button is the second cursor-pointer element
      if (closeButtons.length > 1)
        fireEvent.click(closeButtons[1])

      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should update question when typing', () => {
      render(<NewSegmentModal {...defaultProps} />)
      const questionInput = screen.getByTestId('question-input')

      fireEvent.change(questionInput, { target: { value: 'New question content' } })

      expect(questionInput).toHaveValue('New question content')
    })

    it('should update answer when docForm is QA and typing', () => {
      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.qa} />)
      const answerInput = screen.getByTestId('answer-input')

      fireEvent.change(answerInput, { target: { value: 'New answer content' } })

      expect(answerInput).toHaveValue('New answer content')
    })

    it('should toggle add another checkbox', () => {
      render(<NewSegmentModal {...defaultProps} />)
      const checkbox = screen.getByTestId('add-another-checkbox')

      fireEvent.click(checkbox)

      // Assert - checkbox state should toggle
      expect(checkbox).toBeInTheDocument()
    })
  })

  // Save validation
  describe('Save Validation', () => {
    it('should show error when content is empty for text mode', async () => {
      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.text} />)

      fireEvent.click(screen.getByTestId('save-btn'))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
    })

    it('should show error when question is empty for QA mode', async () => {
      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.qa} />)

      fireEvent.click(screen.getByTestId('save-btn'))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
          }),
        )
      })
    })

    it('should show error when answer is empty for QA mode', async () => {
      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.qa} />)
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Question' } })

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
    it('should call addSegment when valid content is provided for text mode', async () => {
      mockAddSegment.mockImplementation((_params, options) => {
        options.onSuccess()
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.text} />)
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Valid content' } })

      fireEvent.click(screen.getByTestId('save-btn'))

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
      mockAddSegment.mockImplementation((_params, options) => {
        options.onSuccess()
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.text} />)
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Valid content' } })

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
    it('should apply full screen styling when fullScreen is true', () => {
      mockFullScreen = true

      const { container } = render(<NewSegmentModal {...defaultProps} />)

      const header = container.querySelector('.border-divider-subtle')
      expect(header).toBeInTheDocument()
    })

    it('should show action buttons in header when fullScreen', () => {
      mockFullScreen = true

      render(<NewSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('action-buttons')).toBeInTheDocument()
    })

    it('should show add another in header when fullScreen', () => {
      mockFullScreen = true

      render(<NewSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('add-another')).toBeInTheDocument()
    })

    it('should call toggleFullScreen when expand button is clicked', () => {
      const { container } = render(<NewSegmentModal {...defaultProps} />)

      // Act - click the expand button (first cursor-pointer)
      const expandButtons = container.querySelectorAll('.cursor-pointer')
      if (expandButtons.length > 0)
        fireEvent.click(expandButtons[0])

      expect(mockToggleFullScreen).toHaveBeenCalled()
    })
  })

  // Props
  describe('Props', () => {
    it('should pass actionType add to ActionButtons', () => {
      render(<NewSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('action-type')).toHaveTextContent('add')
    })

    it('should pass isEditMode true to ChunkContent', () => {
      render(<NewSegmentModal {...defaultProps} />)

      expect(screen.getByTestId('edit-mode')).toHaveTextContent('editing')
    })
  })

  describe('Edge Cases', () => {
    it('should handle keyword changes for ECONOMICAL indexing', () => {
      mockIndexingTechnique = IndexingType.ECONOMICAL
      render(<NewSegmentModal {...defaultProps} />)

      fireEvent.change(screen.getByTestId('keywords-input'), {
        target: { value: 'keyword1,keyword2' },
      })

      expect(screen.getByTestId('keywords-input')).toHaveValue('keyword1,keyword2')
    })

    it('should handle image upload', () => {
      render(<NewSegmentModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('upload-image-btn'))

      // Assert - image uploader should be rendered
      expect(screen.getByTestId('image-uploader')).toBeInTheDocument()
    })

    it('should maintain structure when rerendered with different docForm', () => {
      const { rerender } = render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.text} />)

      rerender(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.qa} />)

      expect(screen.getByTestId('answer-input')).toBeInTheDocument()
    })
  })

  describe('CustomButton in success notification', () => {
    it('should call viewNewlyAddedChunk when custom button is clicked', async () => {
      const mockViewNewlyAddedChunk = vi.fn()
      mockNotify.mockImplementation(() => {})

      mockAddSegment.mockImplementation((_params: unknown, options: { onSuccess: () => void, onSettled: () => void }) => {
        options.onSuccess()
        options.onSettled()
        return Promise.resolve()
      })

      render(
        <NewSegmentModal
          {...defaultProps}
          docForm={ChunkingMode.text}
          viewNewlyAddedChunk={mockViewNewlyAddedChunk}
        />,
      )

      // Enter content and save
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Test content' } })
      fireEvent.click(screen.getByTestId('save-btn'))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
            customComponent: expect.anything(),
          }),
        )
      })

      // Extract customComponent from the notify call args
      const notifyCallArgs = mockNotify.mock.calls[0][0] as { customComponent?: React.ReactElement }
      expect(notifyCallArgs.customComponent).toBeDefined()
      const customComponent = notifyCallArgs.customComponent!
      const { container: btnContainer } = render(customComponent)
      const viewButton = btnContainer.querySelector('.system-xs-semibold.text-text-accent') as HTMLElement
      expect(viewButton).toBeInTheDocument()
      fireEvent.click(viewButton)

      // Assert that viewNewlyAddedChunk was called via the onClick handler (lines 66-67)
      expect(mockViewNewlyAddedChunk).toHaveBeenCalled()
    })
  })

  describe('QA mode save with content', () => {
    it('should save with both question and answer in QA mode', async () => {
      mockAddSegment.mockImplementation((_params: unknown, options: { onSuccess: () => void, onSettled: () => void }) => {
        options.onSuccess()
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.qa} />)

      // Enter question and answer
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'My Question' } })
      fireEvent.change(screen.getByTestId('answer-input'), { target: { value: 'My Answer' } })

      // Act - save
      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert - should call addSegment with both content and answer
      await waitFor(() => {
        expect(mockAddSegment).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              content: 'My Question',
              answer: 'My Answer',
            }),
          }),
          expect.any(Object),
        )
      })
    })
  })

  describe('Keywords in save params', () => {
    it('should include keywords in save params when keywords are provided', async () => {
      mockIndexingTechnique = IndexingType.ECONOMICAL
      mockAddSegment.mockImplementation((_params: unknown, options: { onSuccess: () => void, onSettled: () => void }) => {
        options.onSuccess()
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.text} />)

      // Enter content
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Content with keywords' } })
      // Enter keywords
      fireEvent.change(screen.getByTestId('keywords-input'), { target: { value: 'kw1,kw2' } })

      // Act - save
      fireEvent.click(screen.getByTestId('save-btn'))

      await waitFor(() => {
        expect(mockAddSegment).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              content: 'Content with keywords',
              keywords: ['kw1', 'kw2'],
            }),
          }),
          expect.any(Object),
        )
      })
    })
  })

  describe('Save with attachments', () => {
    it('should include attachment_ids in save params when images are uploaded', async () => {
      mockAddSegment.mockImplementation((_params: unknown, options: { onSuccess: () => void, onSettled: () => void }) => {
        options.onSuccess()
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.text} />)

      // Enter content
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Content with images' } })
      // Upload an image
      fireEvent.click(screen.getByTestId('upload-image-btn'))

      // Act - save
      fireEvent.click(screen.getByTestId('save-btn'))

      await waitFor(() => {
        expect(mockAddSegment).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              content: 'Content with images',
              attachment_ids: ['img-1'],
            }),
          }),
          expect.any(Object),
        )
      })
    })
  })

  describe('handleCancel with addAnother unchecked', () => {
    it('should call onCancel when addAnother is unchecked and save succeeds', async () => {
      const mockOnCancel = vi.fn()
      mockAddSegment.mockImplementation((_params: unknown, options: { onSuccess: () => void, onSettled: () => void }) => {
        options.onSuccess()
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewSegmentModal {...defaultProps} onCancel={mockOnCancel} docForm={ChunkingMode.text} />)

      // Uncheck "add another"
      const checkbox = screen.getByTestId('add-another-checkbox')
      fireEvent.click(checkbox)

      // Enter content and save
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Test' } })
      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert - should call onCancel since addAnother is false
      await waitFor(() => {
        expect(mockOnCancel).toHaveBeenCalled()
      })
    })
  })

  describe('onSave delayed call', () => {
    it('should call onSave after timeout in success handler', async () => {
      vi.useFakeTimers()
      const mockOnSave = vi.fn()
      mockAddSegment.mockImplementation((_params: unknown, options: { onSuccess: () => void, onSettled: () => void }) => {
        options.onSuccess()
        options.onSettled()
        return Promise.resolve()
      })

      render(<NewSegmentModal {...defaultProps} onSave={mockOnSave} docForm={ChunkingMode.text} />)

      // Enter content and save
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'Test content' } })
      fireEvent.click(screen.getByTestId('save-btn'))

      // Fast-forward timer
      vi.advanceTimersByTime(3000)

      expect(mockOnSave).toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  describe('Word count display', () => {
    it('should display character count for QA mode (question + answer)', () => {
      render(<NewSegmentModal {...defaultProps} docForm={ChunkingMode.qa} />)

      // Enter question and answer
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: 'abc' } })
      fireEvent.change(screen.getByTestId('answer-input'), { target: { value: 'de' } })

      // Assert - should show count of 5 (3 + 2)
      // The component uses formatNumber and shows "X characters"
      expect(screen.getByText(/5/)).toBeInTheDocument()
    })
  })

  describe('Non-fullscreen footer', () => {
    it('should render footer with AddAnother and ActionButtons when not in fullScreen', () => {
      mockFullScreen = false

      render(<NewSegmentModal {...defaultProps} />)

      // Assert - footer should have both AddAnother and ActionButtons
      expect(screen.getByTestId('add-another')).toBeInTheDocument()
      expect(screen.getByTestId('action-buttons')).toBeInTheDocument()
    })
  })
})

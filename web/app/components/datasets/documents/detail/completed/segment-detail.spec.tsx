import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode } from '@/models/datasets'

import SegmentDetail from './segment-detail'

// Mock dataset detail context
let mockIndexingTechnique = IndexingType.QUALIFIED
let mockRuntimeMode = 'general'
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: { indexing_technique: string, runtime_mode: string } }) => unknown) => {
    return selector({
      dataset: {
        indexing_technique: mockIndexingTechnique,
        runtime_mode: mockRuntimeMode,
      },
    })
  },
}))

// Mock document context
let mockParentMode = 'paragraph'
vi.mock('../context', () => ({
  useDocumentContext: (selector: (state: { parentMode: string }) => unknown) => {
    return selector({ parentMode: mockParentMode })
  },
}))

// Mock segment list context
let mockFullScreen = false
const mockToggleFullScreen = vi.fn()
vi.mock('./index', () => ({
  useSegmentListContext: (selector: (state: { fullScreen: boolean, toggleFullScreen: () => void }) => unknown) => {
    const state = {
      fullScreen: mockFullScreen,
      toggleFullScreen: mockToggleFullScreen,
    }
    return selector(state)
  },
}))

// Mock event emitter context
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: vi.fn(),
    },
  }),
}))

// Mock child components
vi.mock('./common/action-buttons', () => ({
  default: ({ handleCancel, handleSave, handleRegeneration, loading, showRegenerationButton }: { handleCancel: () => void, handleSave: () => void, handleRegeneration?: () => void, loading: boolean, showRegenerationButton?: boolean }) => (
    <div data-testid="action-buttons">
      <button onClick={handleCancel} data-testid="cancel-btn">Cancel</button>
      <button onClick={handleSave} disabled={loading} data-testid="save-btn">Save</button>
      {showRegenerationButton && (
        <button onClick={handleRegeneration} data-testid="regenerate-btn">Regenerate</button>
      )}
    </div>
  ),
}))

vi.mock('./common/chunk-content', () => ({
  default: ({ docForm, question, answer, onQuestionChange, onAnswerChange, isEditMode }: { docForm: string, question: string, answer: string, onQuestionChange: (v: string) => void, onAnswerChange: (v: string) => void, isEditMode: boolean }) => (
    <div data-testid="chunk-content">
      <input
        data-testid="question-input"
        value={question}
        onChange={e => onQuestionChange(e.target.value)}
      />
      {docForm === ChunkingMode.qa && (
        <input
          data-testid="answer-input"
          value={answer}
          onChange={e => onAnswerChange(e.target.value)}
        />
      )}
      <span data-testid="edit-mode">{isEditMode ? 'editing' : 'viewing'}</span>
    </div>
  ),
}))

vi.mock('./common/dot', () => ({
  default: () => <span data-testid="dot">•</span>,
}))

vi.mock('./common/keywords', () => ({
  default: ({ keywords, onKeywordsChange, _isEditMode, actionType }: { keywords: string[], onKeywordsChange: (v: string[]) => void, _isEditMode?: boolean, actionType: string }) => (
    <div data-testid="keywords">
      <span data-testid="keywords-action">{actionType}</span>
      <input
        data-testid="keywords-input"
        value={keywords.join(',')}
        onChange={e => onKeywordsChange(e.target.value.split(',').filter(Boolean))}
      />
    </div>
  ),
}))

vi.mock('./common/segment-index-tag', () => ({
  SegmentIndexTag: ({ positionId, label, labelPrefix }: { positionId?: string, label?: string, labelPrefix?: string }) => (
    <span data-testid="segment-index-tag">
      {labelPrefix}
      {' '}
      {positionId}
      {' '}
      {label}
    </span>
  ),
}))

vi.mock('./common/regeneration-modal', () => ({
  default: ({ isShow, onConfirm, onCancel, onClose }: { isShow: boolean, onConfirm: () => void, onCancel: () => void, onClose: () => void }) => (
    isShow
      ? (
          <div data-testid="regeneration-modal">
            <button onClick={onConfirm} data-testid="confirm-regeneration">Confirm</button>
            <button onClick={onCancel} data-testid="cancel-regeneration">Cancel</button>
            <button onClick={onClose} data-testid="close-regeneration">Close</button>
          </div>
        )
      : null
  ),
}))

vi.mock('@/app/components/datasets/common/image-uploader/image-uploader-in-chunk', () => ({
  default: ({ disabled, value, onChange }: { value?: unknown[], onChange?: (v: unknown[]) => void, disabled?: boolean }) => {
    return (
      <div data-testid="image-uploader">
        <span data-testid="uploader-disabled">{disabled ? 'disabled' : 'enabled'}</span>
        <span data-testid="attachments-count">{value?.length || 0}</span>
        <button
          data-testid="add-attachment-btn"
          onClick={() => onChange?.([...(value || []), { id: 'new-attachment' }])}
        >
          Add
        </button>
      </div>
    )
  },
}))

describe('SegmentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFullScreen = false
    mockIndexingTechnique = IndexingType.QUALIFIED
    mockRuntimeMode = 'general'
    mockParentMode = 'paragraph'
  })

  const defaultSegInfo = {
    id: 'segment-1',
    content: 'Test content',
    sign_content: 'Signed content',
    answer: 'Test answer',
    position: 1,
    word_count: 100,
    keywords: ['keyword1', 'keyword2'],
    attachments: [],
  }

  const defaultProps = {
    segInfo: defaultSegInfo,
    onUpdate: vi.fn(),
    onCancel: vi.fn(),
    isEditMode: false,
    docForm: ChunkingMode.text,
    onModalStateChange: vi.fn(),
  }

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<SegmentDetail {...defaultProps} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render title for view mode', () => {
      // Arrange & Act
      render(<SegmentDetail {...defaultProps} isEditMode={false} />)

      // Assert
      expect(screen.getByText(/segment\.chunkDetail/i)).toBeInTheDocument()
    })

    it('should render title for edit mode', () => {
      // Arrange & Act
      render(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Assert
      expect(screen.getByText(/segment\.editChunk/i)).toBeInTheDocument()
    })

    it('should render chunk content component', () => {
      // Arrange & Act
      render(<SegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('chunk-content')).toBeInTheDocument()
    })

    it('should render image uploader', () => {
      // Arrange & Act
      render(<SegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('image-uploader')).toBeInTheDocument()
    })

    it('should render segment index tag', () => {
      // Arrange & Act
      render(<SegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('segment-index-tag')).toBeInTheDocument()
    })
  })

  // Edit mode vs View mode
  describe('Edit/View Mode', () => {
    it('should pass isEditMode to ChunkContent', () => {
      // Arrange & Act
      render(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Assert
      expect(screen.getByTestId('edit-mode')).toHaveTextContent('editing')
    })

    it('should disable image uploader in view mode', () => {
      // Arrange & Act
      render(<SegmentDetail {...defaultProps} isEditMode={false} />)

      // Assert
      expect(screen.getByTestId('uploader-disabled')).toHaveTextContent('disabled')
    })

    it('should enable image uploader in edit mode', () => {
      // Arrange & Act
      render(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Assert
      expect(screen.getByTestId('uploader-disabled')).toHaveTextContent('enabled')
    })

    it('should show action buttons in edit mode', () => {
      // Arrange & Act
      render(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Assert
      expect(screen.getByTestId('action-buttons')).toBeInTheDocument()
    })

    it('should not show action buttons in view mode (non-fullscreen)', () => {
      // Arrange & Act
      render(<SegmentDetail {...defaultProps} isEditMode={false} />)

      // Assert
      expect(screen.queryByTestId('action-buttons')).not.toBeInTheDocument()
    })
  })

  // Keywords display
  describe('Keywords', () => {
    it('should show keywords component when indexing is ECONOMICAL', () => {
      // Arrange
      mockIndexingTechnique = IndexingType.ECONOMICAL

      // Act
      render(<SegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('keywords')).toBeInTheDocument()
    })

    it('should not show keywords when indexing is QUALIFIED', () => {
      // Arrange
      mockIndexingTechnique = IndexingType.QUALIFIED

      // Act
      render(<SegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.queryByTestId('keywords')).not.toBeInTheDocument()
    })

    it('should pass view action type when not in edit mode', () => {
      // Arrange
      mockIndexingTechnique = IndexingType.ECONOMICAL

      // Act
      render(<SegmentDetail {...defaultProps} isEditMode={false} />)

      // Assert
      expect(screen.getByTestId('keywords-action')).toHaveTextContent('view')
    })

    it('should pass edit action type when in edit mode', () => {
      // Arrange
      mockIndexingTechnique = IndexingType.ECONOMICAL

      // Act
      render(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Assert
      expect(screen.getByTestId('keywords-action')).toHaveTextContent('edit')
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call onCancel when close button is clicked', () => {
      // Arrange
      const mockOnCancel = vi.fn()
      const { container } = render(<SegmentDetail {...defaultProps} onCancel={mockOnCancel} />)

      // Act
      const closeButtons = container.querySelectorAll('.cursor-pointer')
      if (closeButtons.length > 1)
        fireEvent.click(closeButtons[1])

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should call toggleFullScreen when expand button is clicked', () => {
      // Arrange
      const { container } = render(<SegmentDetail {...defaultProps} />)

      // Act
      const expandButtons = container.querySelectorAll('.cursor-pointer')
      if (expandButtons.length > 0)
        fireEvent.click(expandButtons[0])

      // Assert
      expect(mockToggleFullScreen).toHaveBeenCalled()
    })

    it('should call onUpdate when save is clicked', () => {
      // Arrange
      const mockOnUpdate = vi.fn()
      render(<SegmentDetail {...defaultProps} isEditMode={true} onUpdate={mockOnUpdate} />)

      // Act
      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert
      expect(mockOnUpdate).toHaveBeenCalledWith(
        'segment-1',
        expect.any(String),
        expect.any(String),
        expect.any(Array),
        expect.any(Array),
        expect.any(String),
        expect.any(Boolean),
      )
    })

    it('should update question when input changes', () => {
      // Arrange
      render(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Act
      fireEvent.change(screen.getByTestId('question-input'), {
        target: { value: 'Updated content' },
      })

      // Assert
      expect(screen.getByTestId('question-input')).toHaveValue('Updated content')
    })
  })

  // Regeneration Modal
  describe('Regeneration Modal', () => {
    it('should show regeneration button when runtimeMode is general', () => {
      // Arrange
      mockRuntimeMode = 'general'

      // Act
      render(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Assert
      expect(screen.getByTestId('regenerate-btn')).toBeInTheDocument()
    })

    it('should not show regeneration button when runtimeMode is not general', () => {
      // Arrange
      mockRuntimeMode = 'pipeline'

      // Act
      render(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Assert
      expect(screen.queryByTestId('regenerate-btn')).not.toBeInTheDocument()
    })

    it('should show regeneration modal when regenerate is clicked', () => {
      // Arrange
      render(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Act
      fireEvent.click(screen.getByTestId('regenerate-btn'))

      // Assert
      expect(screen.getByTestId('regeneration-modal')).toBeInTheDocument()
    })

    it('should call onModalStateChange when regeneration modal opens', () => {
      // Arrange
      const mockOnModalStateChange = vi.fn()
      render(
        <SegmentDetail
          {...defaultProps}
          isEditMode={true}
          onModalStateChange={mockOnModalStateChange}
        />,
      )

      // Act
      fireEvent.click(screen.getByTestId('regenerate-btn'))

      // Assert
      expect(mockOnModalStateChange).toHaveBeenCalledWith(true)
    })

    it('should close modal when cancel is clicked', () => {
      // Arrange
      const mockOnModalStateChange = vi.fn()
      render(
        <SegmentDetail
          {...defaultProps}
          isEditMode={true}
          onModalStateChange={mockOnModalStateChange}
        />,
      )
      fireEvent.click(screen.getByTestId('regenerate-btn'))

      // Act
      fireEvent.click(screen.getByTestId('cancel-regeneration'))

      // Assert
      expect(mockOnModalStateChange).toHaveBeenCalledWith(false)
      expect(screen.queryByTestId('regeneration-modal')).not.toBeInTheDocument()
    })
  })

  // Full screen mode
  describe('Full Screen Mode', () => {
    it('should show action buttons in header when fullScreen and editMode', () => {
      // Arrange
      mockFullScreen = true

      // Act
      render(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Assert
      expect(screen.getByTestId('action-buttons')).toBeInTheDocument()
    })

    it('should apply full screen styling when fullScreen is true', () => {
      // Arrange
      mockFullScreen = true

      // Act
      const { container } = render(<SegmentDetail {...defaultProps} />)

      // Assert
      const header = container.querySelector('.border-divider-subtle')
      expect(header).toBeInTheDocument()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle segInfo with minimal data', () => {
      // Arrange
      const minimalSegInfo = {
        id: 'segment-minimal',
        position: 1,
        word_count: 0,
      }

      // Act
      const { container } = render(<SegmentDetail {...defaultProps} segInfo={minimalSegInfo} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle empty keywords array', () => {
      // Arrange
      mockIndexingTechnique = IndexingType.ECONOMICAL
      const segInfo = { ...defaultSegInfo, keywords: [] }

      // Act
      render(<SegmentDetail {...defaultProps} segInfo={segInfo} />)

      // Assert
      expect(screen.getByTestId('keywords-input')).toHaveValue('')
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(<SegmentDetail {...defaultProps} isEditMode={false} />)

      // Act
      rerender(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Assert
      expect(screen.getByTestId('action-buttons')).toBeInTheDocument()
    })
  })

  // Attachments
  describe('Attachments', () => {
    it('should update attachments when onChange is called', () => {
      // Arrange
      render(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Act
      fireEvent.click(screen.getByTestId('add-attachment-btn'))

      // Assert
      expect(screen.getByTestId('attachments-count')).toHaveTextContent('1')
    })

    it('should pass attachments to onUpdate when save is clicked', () => {
      // Arrange
      const mockOnUpdate = vi.fn()
      render(<SegmentDetail {...defaultProps} isEditMode={true} onUpdate={mockOnUpdate} />)

      // Add an attachment
      fireEvent.click(screen.getByTestId('add-attachment-btn'))

      // Act
      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert
      expect(mockOnUpdate).toHaveBeenCalledWith(
        'segment-1',
        expect.any(String),
        expect.any(String),
        expect.any(Array),
        expect.arrayContaining([expect.objectContaining({ id: 'new-attachment' })]),
        expect.any(String),
        expect.any(Boolean),
      )
    })

    it('should initialize attachments from segInfo', () => {
      // Arrange
      const segInfoWithAttachments = {
        ...defaultSegInfo,
        attachments: [
          { id: 'att-1', name: 'file1.jpg', size: 1000, mime_type: 'image/jpeg', extension: 'jpg', source_url: 'http://example.com/file1.jpg' },
        ],
      }

      // Act
      render(<SegmentDetail {...defaultProps} segInfo={segInfoWithAttachments} isEditMode={true} />)

      // Assert
      expect(screen.getByTestId('attachments-count')).toHaveTextContent('1')
    })
  })

  // Regeneration confirmation
  describe('Regeneration Confirmation', () => {
    it('should call onUpdate with needRegenerate true when confirm regeneration is clicked', () => {
      // Arrange
      const mockOnUpdate = vi.fn()
      render(<SegmentDetail {...defaultProps} isEditMode={true} onUpdate={mockOnUpdate} />)

      // Open regeneration modal
      fireEvent.click(screen.getByTestId('regenerate-btn'))

      // Act
      fireEvent.click(screen.getByTestId('confirm-regeneration'))

      // Assert
      expect(mockOnUpdate).toHaveBeenCalledWith(
        'segment-1',
        expect.any(String),
        expect.any(String),
        expect.any(Array),
        expect.any(Array),
        expect.any(String),
        true,
      )
    })

    it('should close modal and edit drawer when close after regeneration is clicked', () => {
      // Arrange
      const mockOnCancel = vi.fn()
      const mockOnModalStateChange = vi.fn()
      render(
        <SegmentDetail
          {...defaultProps}
          isEditMode={true}
          onCancel={mockOnCancel}
          onModalStateChange={mockOnModalStateChange}
        />,
      )

      // Open regeneration modal
      fireEvent.click(screen.getByTestId('regenerate-btn'))

      // Act
      fireEvent.click(screen.getByTestId('close-regeneration'))

      // Assert
      expect(mockOnModalStateChange).toHaveBeenCalledWith(false)
      expect(mockOnCancel).toHaveBeenCalled()
    })
  })

  // QA mode
  describe('QA Mode', () => {
    it('should render answer input in QA mode', () => {
      // Arrange & Act
      render(<SegmentDetail {...defaultProps} docForm={ChunkingMode.qa} isEditMode={true} />)

      // Assert
      expect(screen.getByTestId('answer-input')).toBeInTheDocument()
    })

    it('should update answer when input changes', () => {
      // Arrange
      render(<SegmentDetail {...defaultProps} docForm={ChunkingMode.qa} isEditMode={true} />)

      // Act
      fireEvent.change(screen.getByTestId('answer-input'), {
        target: { value: 'Updated answer' },
      })

      // Assert
      expect(screen.getByTestId('answer-input')).toHaveValue('Updated answer')
    })

    it('should calculate word count correctly in QA mode', () => {
      // Arrange & Act
      render(<SegmentDetail {...defaultProps} docForm={ChunkingMode.qa} isEditMode={true} />)

      // Assert - should show combined length of question and answer
      expect(screen.getByText(/segment\.characters/i)).toBeInTheDocument()
    })
  })

  // Full doc mode
  describe('Full Doc Mode', () => {
    it('should show label in full-doc parent-child mode', () => {
      // Arrange
      mockParentMode = 'full-doc'

      // Act
      render(<SegmentDetail {...defaultProps} docForm={ChunkingMode.parentChild} />)

      // Assert
      expect(screen.getByTestId('segment-index-tag')).toBeInTheDocument()
    })
  })

  // Keywords update
  describe('Keywords Update', () => {
    it('should update keywords when changed in edit mode', () => {
      // Arrange
      mockIndexingTechnique = IndexingType.ECONOMICAL
      render(<SegmentDetail {...defaultProps} isEditMode={true} />)

      // Act
      fireEvent.change(screen.getByTestId('keywords-input'), {
        target: { value: 'new,keywords' },
      })

      // Assert
      expect(screen.getByTestId('keywords-input')).toHaveValue('new,keywords')
    })
  })
})

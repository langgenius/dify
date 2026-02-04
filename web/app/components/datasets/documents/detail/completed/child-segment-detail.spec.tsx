import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'

import ChildSegmentDetail from './child-segment-detail'

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
let mockSubscriptionCallback: ((v: string) => void) | null = null
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: (callback: (v: string) => void) => {
        mockSubscriptionCallback = callback
      },
    },
  }),
}))

// Mock child components
vi.mock('./common/action-buttons', () => ({
  default: ({ handleCancel, handleSave, loading, isChildChunk }: { handleCancel: () => void, handleSave: () => void, loading: boolean, isChildChunk?: boolean }) => (
    <div data-testid="action-buttons">
      <button onClick={handleCancel} data-testid="cancel-btn">Cancel</button>
      <button onClick={handleSave} disabled={loading} data-testid="save-btn">Save</button>
      <span data-testid="is-child-chunk">{isChildChunk ? 'true' : 'false'}</span>
    </div>
  ),
}))

vi.mock('./common/chunk-content', () => ({
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

vi.mock('./common/dot', () => ({
  default: () => <span data-testid="dot">•</span>,
}))

vi.mock('./common/segment-index-tag', () => ({
  SegmentIndexTag: ({ positionId, labelPrefix }: { positionId?: string, labelPrefix?: string }) => (
    <span data-testid="segment-index-tag">
      {labelPrefix}
      {' '}
      {positionId}
    </span>
  ),
}))

describe('ChildSegmentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFullScreen = false
    mockSubscriptionCallback = null
  })

  const defaultChildChunkInfo = {
    id: 'child-chunk-1',
    content: 'Test content',
    position: 1,
    updated_at: 1609459200, // 2021-01-01
  }

  const defaultProps = {
    chunkId: 'chunk-1',
    childChunkInfo: defaultChildChunkInfo,
    onUpdate: vi.fn(),
    onCancel: vi.fn(),
    docForm: ChunkingMode.text,
  }

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<ChildSegmentDetail {...defaultProps} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render edit child chunk title', () => {
      // Arrange & Act
      render(<ChildSegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByText(/segment\.editChildChunk/i)).toBeInTheDocument()
    })

    it('should render chunk content component', () => {
      // Arrange & Act
      render(<ChildSegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('chunk-content')).toBeInTheDocument()
    })

    it('should render segment index tag', () => {
      // Arrange & Act
      render(<ChildSegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('segment-index-tag')).toBeInTheDocument()
    })

    it('should render word count', () => {
      // Arrange & Act
      render(<ChildSegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByText(/segment\.characters/i)).toBeInTheDocument()
    })

    it('should render edit time', () => {
      // Arrange & Act
      render(<ChildSegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByText(/segment\.editedAt/i)).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call onCancel when close button is clicked', () => {
      // Arrange
      const mockOnCancel = vi.fn()
      const { container } = render(
        <ChildSegmentDetail {...defaultProps} onCancel={mockOnCancel} />,
      )

      // Act
      const closeButtons = container.querySelectorAll('.cursor-pointer')
      if (closeButtons.length > 1)
        fireEvent.click(closeButtons[1])

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should call toggleFullScreen when expand button is clicked', () => {
      // Arrange
      const { container } = render(<ChildSegmentDetail {...defaultProps} />)

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
      render(<ChildSegmentDetail {...defaultProps} onUpdate={mockOnUpdate} />)

      // Act
      fireEvent.click(screen.getByTestId('save-btn'))

      // Assert
      expect(mockOnUpdate).toHaveBeenCalledWith(
        'chunk-1',
        'child-chunk-1',
        'Test content',
      )
    })

    it('should update content when input changes', () => {
      // Arrange
      render(<ChildSegmentDetail {...defaultProps} />)

      // Act
      fireEvent.change(screen.getByTestId('content-input'), {
        target: { value: 'Updated content' },
      })

      // Assert
      expect(screen.getByTestId('content-input')).toHaveValue('Updated content')
    })
  })

  // Full screen mode
  describe('Full Screen Mode', () => {
    it('should show action buttons in header when fullScreen is true', () => {
      // Arrange
      mockFullScreen = true

      // Act
      render(<ChildSegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('action-buttons')).toBeInTheDocument()
    })

    it('should not show footer action buttons when fullScreen is true', () => {
      // Arrange
      mockFullScreen = true

      // Act
      render(<ChildSegmentDetail {...defaultProps} />)

      // Assert - footer with border-t-divider-subtle should not exist
      const actionButtons = screen.getAllByTestId('action-buttons')
      // Only one action buttons set should exist in fullScreen mode
      expect(actionButtons.length).toBe(1)
    })

    it('should show footer action buttons when fullScreen is false', () => {
      // Arrange
      mockFullScreen = false

      // Act
      render(<ChildSegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('action-buttons')).toBeInTheDocument()
    })
  })

  // Props
  describe('Props', () => {
    it('should pass isChildChunk true to ActionButtons', () => {
      // Arrange & Act
      render(<ChildSegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('is-child-chunk')).toHaveTextContent('true')
    })

    it('should pass isEditMode true to ChunkContent', () => {
      // Arrange & Act
      render(<ChildSegmentDetail {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('edit-mode')).toHaveTextContent('editing')
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle undefined childChunkInfo', () => {
      // Arrange & Act
      const { container } = render(
        <ChildSegmentDetail {...defaultProps} childChunkInfo={undefined} />,
      )

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle empty content', () => {
      // Arrange
      const emptyChildChunkInfo = { ...defaultChildChunkInfo, content: '' }

      // Act
      render(<ChildSegmentDetail {...defaultProps} childChunkInfo={emptyChildChunkInfo} />)

      // Assert
      expect(screen.getByTestId('content-input')).toHaveValue('')
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(<ChildSegmentDetail {...defaultProps} />)

      // Act
      const updatedInfo = { ...defaultChildChunkInfo, content: 'New content' }
      rerender(<ChildSegmentDetail {...defaultProps} childChunkInfo={updatedInfo} />)

      // Assert
      expect(screen.getByTestId('content-input')).toBeInTheDocument()
    })
  })

  // Event subscription tests
  describe('Event Subscription', () => {
    it('should register event subscription', () => {
      // Arrange & Act
      render(<ChildSegmentDetail {...defaultProps} />)

      // Assert - subscription callback should be registered
      expect(mockSubscriptionCallback).not.toBeNull()
    })

    it('should have save button enabled by default', () => {
      // Arrange & Act
      render(<ChildSegmentDetail {...defaultProps} />)

      // Assert - save button should be enabled initially
      expect(screen.getByTestId('save-btn')).not.toBeDisabled()
    })
  })

  // Cancel behavior
  describe('Cancel Behavior', () => {
    it('should call onCancel when cancel button is clicked', () => {
      // Arrange
      const mockOnCancel = vi.fn()
      render(<ChildSegmentDetail {...defaultProps} onCancel={mockOnCancel} />)

      // Act
      fireEvent.click(screen.getByTestId('cancel-btn'))

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })
  })
})

import type { ChildChunkDetail } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChildSegmentList from './child-segment-list'

// Mock document context
let mockParentMode = 'paragraph'
vi.mock('../context', () => ({
  useDocumentContext: (selector: (state: { parentMode: string }) => unknown) => {
    return selector({ parentMode: mockParentMode })
  },
}))

// Mock segment list context
let mockCurrChildChunk: { childChunkInfo: { id: string } } | null = null
vi.mock('./index', () => ({
  useSegmentListContext: (selector: (state: { currChildChunk: { childChunkInfo: { id: string } } | null }) => unknown) => {
    return selector({ currChildChunk: mockCurrChildChunk })
  },
}))

// Mock child components
vi.mock('./common/empty', () => ({
  default: ({ onClearFilter }: { onClearFilter: () => void }) => (
    <div data-testid="empty">
      <button onClick={onClearFilter} data-testid="clear-filter-btn">Clear Filter</button>
    </div>
  ),
}))

vi.mock('./skeleton/full-doc-list-skeleton', () => ({
  default: () => <div data-testid="full-doc-skeleton">Loading...</div>,
}))

vi.mock('../../../formatted-text/flavours/edit-slice', () => ({
  EditSlice: ({
    label,
    text,
    onDelete,
    className,
    labelClassName,
    onClick,
  }: {
    label: string
    text: string
    onDelete: () => void
    className: string
    labelClassName: string
    contentClassName: string
    labelInnerClassName: string
    showDivider: boolean
    onClick: (e: React.MouseEvent) => void
    offsetOptions: unknown
  }) => (
    <div data-testid="edit-slice" className={className}>
      <span data-testid="slice-label" className={labelClassName}>{label}</span>
      <span data-testid="slice-text">{text}</span>
      <button data-testid="delete-slice-btn" onClick={onDelete}>Delete</button>
      <button data-testid="click-slice-btn" onClick={e => onClick(e)}>Click</button>
    </div>
  ),
}))

vi.mock('../../../formatted-text/formatted', () => ({
  FormattedText: ({ children, className }: { children: React.ReactNode, className: string }) => (
    <div data-testid="formatted-text" className={className}>{children}</div>
  ),
}))

describe('ChildSegmentList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParentMode = 'paragraph'
    mockCurrChildChunk = null
  })

  const createMockChildChunk = (id: string, content: string, edited = false): ChildChunkDetail => ({
    id,
    content,
    position: 1,
    word_count: 10,
    segment_id: 'seg-1',
    created_at: Date.now(),
    updated_at: edited ? Date.now() + 1000 : Date.now(),
    type: 'automatic',
  })

  const defaultProps = {
    childChunks: [createMockChildChunk('child-1', 'Child content 1')],
    parentChunkId: 'parent-1',
    handleInputChange: vi.fn(),
    handleAddNewChildChunk: vi.fn(),
    enabled: true,
    onDelete: vi.fn(),
    onClickSlice: vi.fn(),
    total: 1,
    inputValue: '',
    onClearFilter: vi.fn(),
    isLoading: false,
    focused: false,
  }

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<ChildSegmentList {...defaultProps} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render total count text', () => {
      // Arrange & Act
      render(<ChildSegmentList {...defaultProps} />)

      // Assert
      expect(screen.getByText(/segment\.childChunks/i)).toBeInTheDocument()
    })

    it('should render add button', () => {
      // Arrange & Act
      render(<ChildSegmentList {...defaultProps} />)

      // Assert
      expect(screen.getByText(/operation\.add/i)).toBeInTheDocument()
    })
  })

  // Paragraph mode tests
  describe('Paragraph Mode', () => {
    beforeEach(() => {
      mockParentMode = 'paragraph'
    })

    it('should render collapsed by default in paragraph mode', () => {
      // Arrange & Act
      render(<ChildSegmentList {...defaultProps} />)

      // Assert - collapsed icon should be present
      expect(screen.queryByTestId('formatted-text')).not.toBeInTheDocument()
    })

    it('should expand when clicking toggle in paragraph mode', () => {
      // Arrange
      render(<ChildSegmentList {...defaultProps} />)

      // Act - click on the collapse toggle
      const toggleArea = screen.getByText(/segment\.childChunks/i).closest('div')
      if (toggleArea)
        fireEvent.click(toggleArea)

      // Assert - child chunks should be visible
      expect(screen.getByTestId('formatted-text')).toBeInTheDocument()
    })

    it('should collapse when clicking toggle again', () => {
      // Arrange
      render(<ChildSegmentList {...defaultProps} />)

      // Act - click twice
      const toggleArea = screen.getByText(/segment\.childChunks/i).closest('div')
      if (toggleArea) {
        fireEvent.click(toggleArea)
        fireEvent.click(toggleArea)
      }

      // Assert - child chunks should be hidden
      expect(screen.queryByTestId('formatted-text')).not.toBeInTheDocument()
    })
  })

  // Full doc mode tests
  describe('Full Doc Mode', () => {
    beforeEach(() => {
      mockParentMode = 'full-doc'
    })

    it('should render input field in full-doc mode', () => {
      // Arrange & Act
      render(<ChildSegmentList {...defaultProps} />)

      // Assert
      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })

    it('should render child chunks without collapse in full-doc mode', () => {
      // Arrange & Act
      render(<ChildSegmentList {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('formatted-text')).toBeInTheDocument()
    })

    it('should call handleInputChange when input changes', () => {
      // Arrange
      const mockHandleInputChange = vi.fn()
      render(<ChildSegmentList {...defaultProps} handleInputChange={mockHandleInputChange} />)

      // Act
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'search term' } })

      // Assert
      expect(mockHandleInputChange).toHaveBeenCalledWith('search term')
    })

    it('should show search results text when searching', () => {
      // Arrange & Act
      render(<ChildSegmentList {...defaultProps} inputValue="search" total={5} />)

      // Assert
      expect(screen.getByText(/segment\.searchResults/i)).toBeInTheDocument()
    })

    it('should show empty component when no results and searching', () => {
      // Arrange & Act
      render(<ChildSegmentList {...defaultProps} inputValue="search" childChunks={[]} total={0} />)

      // Assert
      expect(screen.getByTestId('empty')).toBeInTheDocument()
    })

    it('should show loading skeleton when isLoading is true', () => {
      // Arrange & Act
      render(<ChildSegmentList {...defaultProps} isLoading={true} />)

      // Assert
      expect(screen.getByTestId('full-doc-skeleton')).toBeInTheDocument()
    })

    it('should handle undefined total in full-doc mode', () => {
      // Arrange & Act
      const { container } = render(<ChildSegmentList {...defaultProps} total={undefined} />)

      // Assert - component should render without crashing
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call handleAddNewChildChunk when add button is clicked', () => {
      // Arrange
      mockParentMode = 'full-doc'
      const mockHandleAddNewChildChunk = vi.fn()
      render(<ChildSegmentList {...defaultProps} handleAddNewChildChunk={mockHandleAddNewChildChunk} />)

      // Act
      fireEvent.click(screen.getByText(/operation\.add/i))

      // Assert
      expect(mockHandleAddNewChildChunk).toHaveBeenCalledWith('parent-1')
    })

    it('should call onDelete when delete button is clicked', () => {
      // Arrange
      mockParentMode = 'full-doc'
      const mockOnDelete = vi.fn()
      render(<ChildSegmentList {...defaultProps} onDelete={mockOnDelete} />)

      // Act
      fireEvent.click(screen.getByTestId('delete-slice-btn'))

      // Assert
      expect(mockOnDelete).toHaveBeenCalledWith('seg-1', 'child-1')
    })

    it('should call onClickSlice when slice is clicked', () => {
      // Arrange
      mockParentMode = 'full-doc'
      const mockOnClickSlice = vi.fn()
      render(<ChildSegmentList {...defaultProps} onClickSlice={mockOnClickSlice} />)

      // Act
      fireEvent.click(screen.getByTestId('click-slice-btn'))

      // Assert
      expect(mockOnClickSlice).toHaveBeenCalledWith(expect.objectContaining({ id: 'child-1' }))
    })

    it('should call onClearFilter when clear filter button is clicked', () => {
      // Arrange
      mockParentMode = 'full-doc'
      const mockOnClearFilter = vi.fn()
      render(<ChildSegmentList {...defaultProps} inputValue="search" childChunks={[]} onClearFilter={mockOnClearFilter} />)

      // Act
      fireEvent.click(screen.getByTestId('clear-filter-btn'))

      // Assert
      expect(mockOnClearFilter).toHaveBeenCalled()
    })
  })

  // Focused state
  describe('Focused State', () => {
    it('should apply focused style when currChildChunk matches', () => {
      // Arrange
      mockParentMode = 'full-doc'
      mockCurrChildChunk = { childChunkInfo: { id: 'child-1' } }

      // Act
      render(<ChildSegmentList {...defaultProps} />)

      // Assert - check for focused class on label
      const label = screen.getByTestId('slice-label')
      expect(label).toHaveClass('bg-state-accent-solid')
    })

    it('should not apply focused style when currChildChunk does not match', () => {
      // Arrange
      mockParentMode = 'full-doc'
      mockCurrChildChunk = { childChunkInfo: { id: 'other-child' } }

      // Act
      render(<ChildSegmentList {...defaultProps} />)

      // Assert
      const label = screen.getByTestId('slice-label')
      expect(label).not.toHaveClass('bg-state-accent-solid')
    })
  })

  // Enabled/Disabled state
  describe('Enabled State', () => {
    it('should apply opacity when enabled is false', () => {
      // Arrange & Act
      const { container } = render(<ChildSegmentList {...defaultProps} enabled={false} />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('opacity-50')
    })

    it('should not apply opacity when enabled is true', () => {
      // Arrange & Act
      const { container } = render(<ChildSegmentList {...defaultProps} enabled={true} />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).not.toHaveClass('opacity-50')
    })

    it('should not apply opacity when focused is true even if enabled is false', () => {
      // Arrange & Act
      const { container } = render(<ChildSegmentList {...defaultProps} enabled={false} focused={true} />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).not.toHaveClass('opacity-50')
    })
  })

  // Edited indicator
  describe('Edited Indicator', () => {
    it('should show edited indicator for edited chunks', () => {
      // Arrange
      mockParentMode = 'full-doc'
      const editedChunk = createMockChildChunk('child-edited', 'Edited content', true)

      // Act
      render(<ChildSegmentList {...defaultProps} childChunks={[editedChunk]} />)

      // Assert
      const label = screen.getByTestId('slice-label')
      expect(label.textContent).toContain('segment.edited')
    })
  })

  // Multiple chunks
  describe('Multiple Chunks', () => {
    it('should render multiple child chunks', () => {
      // Arrange
      mockParentMode = 'full-doc'
      const chunks = [
        createMockChildChunk('child-1', 'Content 1'),
        createMockChildChunk('child-2', 'Content 2'),
        createMockChildChunk('child-3', 'Content 3'),
      ]

      // Act
      render(<ChildSegmentList {...defaultProps} childChunks={chunks} total={3} />)

      // Assert
      expect(screen.getAllByTestId('edit-slice')).toHaveLength(3)
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle empty childChunks array', () => {
      // Arrange
      mockParentMode = 'full-doc'

      // Act
      const { container } = render(<ChildSegmentList {...defaultProps} childChunks={[]} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      mockParentMode = 'full-doc'
      const { rerender } = render(<ChildSegmentList {...defaultProps} />)

      // Act
      const newChunks = [createMockChildChunk('new-child', 'New content')]
      rerender(<ChildSegmentList {...defaultProps} childChunks={newChunks} />)

      // Assert
      expect(screen.getByText('New content')).toBeInTheDocument()
    })

    it('should disable add button when loading', () => {
      // Arrange
      mockParentMode = 'full-doc'

      // Act
      render(<ChildSegmentList {...defaultProps} isLoading={true} />)

      // Assert
      const addButton = screen.getByText(/operation\.add/i)
      expect(addButton).toBeDisabled()
    })
  })
})

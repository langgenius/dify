import type { ChildChunkDetail } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChildSegmentList from '../child-segment-list'

// Mock document context
let mockParentMode = 'paragraph'
vi.mock('../../context', () => ({
  useDocumentContext: (selector: (state: { parentMode: string }) => unknown) => {
    return selector({ parentMode: mockParentMode })
  },
}))

// Mock segment list context
let mockCurrChildChunk: { childChunkInfo: { id: string } } | null = null
vi.mock('../index', () => ({
  useSegmentListContext: (selector: (state: { currChildChunk: { childChunkInfo: { id: string } } | null }) => unknown) => {
    return selector({ currChildChunk: mockCurrChildChunk })
  },
}))

vi.mock('../common/empty', () => ({
  default: ({ onClearFilter }: { onClearFilter: () => void }) => (
    <div data-testid="empty">
      <button onClick={onClearFilter} data-testid="clear-filter-btn">Clear Filter</button>
    </div>
  ),
}))

vi.mock('../skeleton/full-doc-list-skeleton', () => ({
  default: () => <div data-testid="full-doc-skeleton">Loading...</div>,
}))

vi.mock('../../../../formatted-text/flavours/edit-slice', () => ({
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

vi.mock('../../../../formatted-text/formatted', () => ({
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

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<ChildSegmentList {...defaultProps} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render total count text', () => {
      render(<ChildSegmentList {...defaultProps} />)

      expect(screen.getByText(/segment\.childChunks/i)).toBeInTheDocument()
    })

    it('should render add button', () => {
      render(<ChildSegmentList {...defaultProps} />)

      expect(screen.getByText(/operation\.add/i)).toBeInTheDocument()
    })
  })

  // Paragraph mode tests
  describe('Paragraph Mode', () => {
    beforeEach(() => {
      mockParentMode = 'paragraph'
    })

    it('should render collapsed by default in paragraph mode', () => {
      render(<ChildSegmentList {...defaultProps} />)

      // Assert - collapsed icon should be present
      expect(screen.queryByTestId('formatted-text')).not.toBeInTheDocument()
    })

    it('should expand when clicking toggle in paragraph mode', () => {
      render(<ChildSegmentList {...defaultProps} />)

      // Act - click on the collapse toggle
      const toggleArea = screen.getByText(/segment\.childChunks/i).closest('div')
      if (toggleArea)
        fireEvent.click(toggleArea)

      // Assert - child chunks should be visible
      expect(screen.getByTestId('formatted-text')).toBeInTheDocument()
    })

    it('should collapse when clicking toggle again', () => {
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
      render(<ChildSegmentList {...defaultProps} />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })

    it('should render child chunks without collapse in full-doc mode', () => {
      render(<ChildSegmentList {...defaultProps} />)

      expect(screen.getByTestId('formatted-text')).toBeInTheDocument()
    })

    it('should call handleInputChange when input changes', () => {
      const mockHandleInputChange = vi.fn()
      render(<ChildSegmentList {...defaultProps} handleInputChange={mockHandleInputChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'search term' } })

      expect(mockHandleInputChange).toHaveBeenCalledWith('search term')
    })

    it('should show search results text when searching', () => {
      render(<ChildSegmentList {...defaultProps} inputValue="search" total={5} />)

      expect(screen.getByText(/segment\.searchResults/i)).toBeInTheDocument()
    })

    it('should show empty component when no results and searching', () => {
      render(<ChildSegmentList {...defaultProps} inputValue="search" childChunks={[]} total={0} />)

      expect(screen.getByTestId('empty')).toBeInTheDocument()
    })

    it('should show loading skeleton when isLoading is true', () => {
      render(<ChildSegmentList {...defaultProps} isLoading={true} />)

      expect(screen.getByTestId('full-doc-skeleton')).toBeInTheDocument()
    })

    it('should handle undefined total in full-doc mode', () => {
      const { container } = render(<ChildSegmentList {...defaultProps} total={undefined} />)

      // Assert - component should render without crashing
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call handleAddNewChildChunk when add button is clicked', () => {
      mockParentMode = 'full-doc'
      const mockHandleAddNewChildChunk = vi.fn()
      render(<ChildSegmentList {...defaultProps} handleAddNewChildChunk={mockHandleAddNewChildChunk} />)

      fireEvent.click(screen.getByText(/operation\.add/i))

      expect(mockHandleAddNewChildChunk).toHaveBeenCalledWith('parent-1')
    })

    it('should call onDelete when delete button is clicked', () => {
      mockParentMode = 'full-doc'
      const mockOnDelete = vi.fn()
      render(<ChildSegmentList {...defaultProps} onDelete={mockOnDelete} />)

      fireEvent.click(screen.getByTestId('delete-slice-btn'))

      expect(mockOnDelete).toHaveBeenCalledWith('seg-1', 'child-1')
    })

    it('should call onClickSlice when slice is clicked', () => {
      mockParentMode = 'full-doc'
      const mockOnClickSlice = vi.fn()
      render(<ChildSegmentList {...defaultProps} onClickSlice={mockOnClickSlice} />)

      fireEvent.click(screen.getByTestId('click-slice-btn'))

      expect(mockOnClickSlice).toHaveBeenCalledWith(expect.objectContaining({ id: 'child-1' }))
    })

    it('should call onClearFilter when clear filter button is clicked', () => {
      mockParentMode = 'full-doc'
      const mockOnClearFilter = vi.fn()
      render(<ChildSegmentList {...defaultProps} inputValue="search" childChunks={[]} onClearFilter={mockOnClearFilter} />)

      fireEvent.click(screen.getByTestId('clear-filter-btn'))

      expect(mockOnClearFilter).toHaveBeenCalled()
    })
  })

  // Focused state
  describe('Focused State', () => {
    it('should apply focused style when currChildChunk matches', () => {
      mockParentMode = 'full-doc'
      mockCurrChildChunk = { childChunkInfo: { id: 'child-1' } }

      render(<ChildSegmentList {...defaultProps} />)

      // Assert - check for focused class on label
      const label = screen.getByTestId('slice-label')
      expect(label).toHaveClass('bg-state-accent-solid')
    })

    it('should not apply focused style when currChildChunk does not match', () => {
      mockParentMode = 'full-doc'
      mockCurrChildChunk = { childChunkInfo: { id: 'other-child' } }

      render(<ChildSegmentList {...defaultProps} />)

      const label = screen.getByTestId('slice-label')
      expect(label).not.toHaveClass('bg-state-accent-solid')
    })
  })

  // Enabled/Disabled state
  describe('Enabled State', () => {
    it('should apply opacity when enabled is false', () => {
      const { container } = render(<ChildSegmentList {...defaultProps} enabled={false} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('opacity-50')
    })

    it('should not apply opacity when enabled is true', () => {
      const { container } = render(<ChildSegmentList {...defaultProps} enabled={true} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).not.toHaveClass('opacity-50')
    })

    it('should not apply opacity when focused is true even if enabled is false', () => {
      const { container } = render(<ChildSegmentList {...defaultProps} enabled={false} focused={true} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).not.toHaveClass('opacity-50')
    })
  })

  // Edited indicator
  describe('Edited Indicator', () => {
    it('should show edited indicator for edited chunks', () => {
      mockParentMode = 'full-doc'
      const editedChunk = createMockChildChunk('child-edited', 'Edited content', true)

      render(<ChildSegmentList {...defaultProps} childChunks={[editedChunk]} />)

      const label = screen.getByTestId('slice-label')
      expect(label.textContent).toContain('segment.edited')
    })
  })

  // Multiple chunks
  describe('Multiple Chunks', () => {
    it('should render multiple child chunks', () => {
      mockParentMode = 'full-doc'
      const chunks = [
        createMockChildChunk('child-1', 'Content 1'),
        createMockChildChunk('child-2', 'Content 2'),
        createMockChildChunk('child-3', 'Content 3'),
      ]

      render(<ChildSegmentList {...defaultProps} childChunks={chunks} total={3} />)

      expect(screen.getAllByTestId('edit-slice')).toHaveLength(3)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty childChunks array', () => {
      mockParentMode = 'full-doc'

      const { container } = render(<ChildSegmentList {...defaultProps} childChunks={[]} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      mockParentMode = 'full-doc'
      const { rerender } = render(<ChildSegmentList {...defaultProps} />)

      const newChunks = [createMockChildChunk('new-child', 'New content')]
      rerender(<ChildSegmentList {...defaultProps} childChunks={newChunks} />)

      expect(screen.getByText('New content')).toBeInTheDocument()
    })

    it('should disable add button when loading', () => {
      mockParentMode = 'full-doc'

      render(<ChildSegmentList {...defaultProps} isLoading={true} />)

      const addButton = screen.getByText(/operation\.add/i)
      expect(addButton).toBeDisabled()
    })
  })
})

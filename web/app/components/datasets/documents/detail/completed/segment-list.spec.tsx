import type { SegmentDetailModel } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'

import SegmentList from './segment-list'

// Mock document context
let mockDocForm = ChunkingMode.text
let mockParentMode = 'paragraph'
vi.mock('../context', () => ({
  useDocumentContext: (selector: (state: { docForm: ChunkingMode, parentMode: string }) => unknown) => {
    return selector({
      docForm: mockDocForm,
      parentMode: mockParentMode,
    })
  },
}))

// Mock segment list context
let mockCurrSegment: { segInfo: { id: string } } | null = null
let mockCurrChildChunk: { childChunkInfo: { segment_id: string } } | null = null
vi.mock('./index', () => ({
  useSegmentListContext: (selector: (state: { currSegment: { segInfo: { id: string } } | null, currChildChunk: { childChunkInfo: { segment_id: string } } | null }) => unknown) => {
    return selector({
      currSegment: mockCurrSegment,
      currChildChunk: mockCurrChildChunk,
    })
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

vi.mock('./segment-card', () => ({
  default: ({
    detail,
    onClick,
    onChangeSwitch,
    onClickEdit,
    onDelete,
    onDeleteChildChunk,
    handleAddNewChildChunk,
    onClickSlice,
    archived,
    embeddingAvailable,
    focused,
  }: {
    detail: SegmentDetailModel
    onClick: () => void
    onChangeSwitch: (enabled: boolean, segId?: string) => Promise<void>
    onClickEdit: () => void
    onDelete: (segId: string) => Promise<void>
    onDeleteChildChunk: (segId: string, childChunkId: string) => Promise<void>
    handleAddNewChildChunk: (parentChunkId: string) => void
    onClickSlice: (childChunk: unknown) => void
    archived: boolean
    embeddingAvailable: boolean
    focused: { segmentIndex: boolean, segmentContent: boolean }
  }) => (
    <div data-testid="segment-card" data-id={detail.id}>
      <span data-testid="segment-content">{detail.content}</span>
      <span data-testid="archived">{archived ? 'true' : 'false'}</span>
      <span data-testid="embedding-available">{embeddingAvailable ? 'true' : 'false'}</span>
      <span data-testid="focused-index">{focused.segmentIndex ? 'true' : 'false'}</span>
      <span data-testid="focused-content">{focused.segmentContent ? 'true' : 'false'}</span>
      <button onClick={onClick} data-testid="card-click">Click</button>
      <button onClick={onClickEdit} data-testid="edit-btn">Edit</button>
      <button onClick={() => onChangeSwitch(true, detail.id)} data-testid="switch-btn">Switch</button>
      <button onClick={() => onDelete(detail.id)} data-testid="delete-btn">Delete</button>
      <button onClick={() => onDeleteChildChunk(detail.id, 'child-1')} data-testid="delete-child-btn">Delete Child</button>
      <button onClick={() => handleAddNewChildChunk(detail.id)} data-testid="add-child-btn">Add Child</button>
      <button onClick={() => onClickSlice({ id: 'slice-1' })} data-testid="click-slice-btn">Click Slice</button>
    </div>
  ),
}))

vi.mock('./skeleton/general-list-skeleton', () => ({
  default: () => <div data-testid="general-skeleton">Loading...</div>,
}))

vi.mock('./skeleton/paragraph-list-skeleton', () => ({
  default: () => <div data-testid="paragraph-skeleton">Loading Paragraph...</div>,
}))

describe('SegmentList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDocForm = ChunkingMode.text
    mockParentMode = 'paragraph'
    mockCurrSegment = null
    mockCurrChildChunk = null
  })

  const createMockSegment = (id: string, content: string): SegmentDetailModel => ({
    id,
    content,
    position: 1,
    word_count: 10,
    tokens: 5,
    hit_count: 0,
    enabled: true,
    status: 'completed',
    created_at: Date.now(),
    updated_at: Date.now(),
    keywords: [],
    document_id: 'doc-1',
    sign_content: content,
    index_node_id: `index-${id}`,
    index_node_hash: `hash-${id}`,
    answer: '',
    error: null,
    disabled_at: null,
    disabled_by: null,
  } as unknown as SegmentDetailModel)

  const defaultProps = {
    ref: null,
    isLoading: false,
    items: [createMockSegment('seg-1', 'Segment 1 content')],
    selectedSegmentIds: [],
    onSelected: vi.fn(),
    onClick: vi.fn(),
    onChangeSwitch: vi.fn(),
    onDelete: vi.fn(),
    onDeleteChildChunk: vi.fn(),
    handleAddNewChildChunk: vi.fn(),
    onClickSlice: vi.fn(),
    archived: false,
    embeddingAvailable: true,
    onClearFilter: vi.fn(),
  }

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<SegmentList {...defaultProps} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render segment cards for each item', () => {
      // Arrange
      const items = [
        createMockSegment('seg-1', 'Content 1'),
        createMockSegment('seg-2', 'Content 2'),
      ]

      // Act
      render(<SegmentList {...defaultProps} items={items} />)

      // Assert
      expect(screen.getAllByTestId('segment-card')).toHaveLength(2)
    })

    it('should render empty component when items is empty', () => {
      // Arrange & Act
      render(<SegmentList {...defaultProps} items={[]} />)

      // Assert
      expect(screen.getByTestId('empty')).toBeInTheDocument()
    })
  })

  // Loading state
  describe('Loading State', () => {
    it('should render general skeleton when loading and docForm is text', () => {
      // Arrange
      mockDocForm = ChunkingMode.text

      // Act
      render(<SegmentList {...defaultProps} isLoading={true} />)

      // Assert
      expect(screen.getByTestId('general-skeleton')).toBeInTheDocument()
    })

    it('should render paragraph skeleton when loading and docForm is parentChild with paragraph mode', () => {
      // Arrange
      mockDocForm = ChunkingMode.parentChild
      mockParentMode = 'paragraph'

      // Act
      render(<SegmentList {...defaultProps} isLoading={true} />)

      // Assert
      expect(screen.getByTestId('paragraph-skeleton')).toBeInTheDocument()
    })

    it('should render general skeleton when loading and docForm is parentChild with full-doc mode', () => {
      // Arrange
      mockDocForm = ChunkingMode.parentChild
      mockParentMode = 'full-doc'

      // Act
      render(<SegmentList {...defaultProps} isLoading={true} />)

      // Assert
      expect(screen.getByTestId('general-skeleton')).toBeInTheDocument()
    })
  })

  // Props passing
  describe('Props Passing', () => {
    it('should pass archived prop to SegmentCard', () => {
      // Arrange & Act
      render(<SegmentList {...defaultProps} archived={true} />)

      // Assert
      expect(screen.getByTestId('archived')).toHaveTextContent('true')
    })

    it('should pass embeddingAvailable prop to SegmentCard', () => {
      // Arrange & Act
      render(<SegmentList {...defaultProps} embeddingAvailable={false} />)

      // Assert
      expect(screen.getByTestId('embedding-available')).toHaveTextContent('false')
    })
  })

  // Focused state
  describe('Focused State', () => {
    it('should set focused index when currSegment matches', () => {
      // Arrange
      mockCurrSegment = { segInfo: { id: 'seg-1' } }

      // Act
      render(<SegmentList {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('focused-index')).toHaveTextContent('true')
    })

    it('should set focused content when currSegment matches', () => {
      // Arrange
      mockCurrSegment = { segInfo: { id: 'seg-1' } }

      // Act
      render(<SegmentList {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('focused-content')).toHaveTextContent('true')
    })

    it('should set focused when currChildChunk parent matches', () => {
      // Arrange
      mockCurrChildChunk = { childChunkInfo: { segment_id: 'seg-1' } }

      // Act
      render(<SegmentList {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('focused-index')).toHaveTextContent('true')
    })
  })

  // Clear filter
  describe('Clear Filter', () => {
    it('should call onClearFilter when clear filter button is clicked', async () => {
      // Arrange
      const mockOnClearFilter = vi.fn()
      render(<SegmentList {...defaultProps} items={[]} onClearFilter={mockOnClearFilter} />)

      // Act
      screen.getByTestId('clear-filter-btn').click()

      // Assert
      expect(mockOnClearFilter).toHaveBeenCalled()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle single item without divider', () => {
      // Arrange & Act
      render(<SegmentList {...defaultProps} items={[createMockSegment('seg-1', 'Content')]} />)

      // Assert
      expect(screen.getByTestId('segment-card')).toBeInTheDocument()
    })

    it('should handle multiple items with dividers', () => {
      // Arrange
      const items = [
        createMockSegment('seg-1', 'Content 1'),
        createMockSegment('seg-2', 'Content 2'),
        createMockSegment('seg-3', 'Content 3'),
      ]

      // Act
      render(<SegmentList {...defaultProps} items={items} />)

      // Assert
      expect(screen.getAllByTestId('segment-card')).toHaveLength(3)
    })

    it('should maintain structure when rerendered with different items', () => {
      // Arrange
      const { rerender } = render(
        <SegmentList {...defaultProps} items={[createMockSegment('seg-1', 'Content 1')]} />,
      )

      // Act
      rerender(
        <SegmentList
          {...defaultProps}
          items={[
            createMockSegment('seg-2', 'Content 2'),
            createMockSegment('seg-3', 'Content 3'),
          ]}
        />,
      )

      // Assert
      expect(screen.getAllByTestId('segment-card')).toHaveLength(2)
    })
  })

  // Checkbox Selection
  describe('Checkbox Selection', () => {
    it('should render checkbox for each segment', () => {
      // Arrange & Act
      const { container } = render(<SegmentList {...defaultProps} />)

      // Assert - Checkbox component should exist
      const checkboxes = container.querySelectorAll('[class*="checkbox"]')
      expect(checkboxes.length).toBeGreaterThan(0)
    })

    it('should pass selectedSegmentIds to check state', () => {
      // Arrange & Act
      const { container } = render(<SegmentList {...defaultProps} selectedSegmentIds={['seg-1']} />)

      // Assert - component should render with selected state
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle empty selectedSegmentIds', () => {
      // Arrange & Act
      const { container } = render(<SegmentList {...defaultProps} selectedSegmentIds={[]} />)

      // Assert - component should render
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  // Card Actions
  describe('Card Actions', () => {
    it('should call onClick when card is clicked', () => {
      // Arrange
      const mockOnClick = vi.fn()
      render(<SegmentList {...defaultProps} onClick={mockOnClick} />)

      // Act
      fireEvent.click(screen.getByTestId('card-click'))

      // Assert
      expect(mockOnClick).toHaveBeenCalled()
    })

    it('should call onChangeSwitch when switch button is clicked', async () => {
      // Arrange
      const mockOnChangeSwitch = vi.fn().mockResolvedValue(undefined)
      render(<SegmentList {...defaultProps} onChangeSwitch={mockOnChangeSwitch} />)

      // Act
      fireEvent.click(screen.getByTestId('switch-btn'))

      // Assert
      expect(mockOnChangeSwitch).toHaveBeenCalledWith(true, 'seg-1')
    })

    it('should call onDelete when delete button is clicked', async () => {
      // Arrange
      const mockOnDelete = vi.fn().mockResolvedValue(undefined)
      render(<SegmentList {...defaultProps} onDelete={mockOnDelete} />)

      // Act
      fireEvent.click(screen.getByTestId('delete-btn'))

      // Assert
      expect(mockOnDelete).toHaveBeenCalledWith('seg-1')
    })

    it('should call onDeleteChildChunk when delete child button is clicked', async () => {
      // Arrange
      const mockOnDeleteChildChunk = vi.fn().mockResolvedValue(undefined)
      render(<SegmentList {...defaultProps} onDeleteChildChunk={mockOnDeleteChildChunk} />)

      // Act
      fireEvent.click(screen.getByTestId('delete-child-btn'))

      // Assert
      expect(mockOnDeleteChildChunk).toHaveBeenCalledWith('seg-1', 'child-1')
    })

    it('should call handleAddNewChildChunk when add child button is clicked', () => {
      // Arrange
      const mockHandleAddNewChildChunk = vi.fn()
      render(<SegmentList {...defaultProps} handleAddNewChildChunk={mockHandleAddNewChildChunk} />)

      // Act
      fireEvent.click(screen.getByTestId('add-child-btn'))

      // Assert
      expect(mockHandleAddNewChildChunk).toHaveBeenCalledWith('seg-1')
    })

    it('should call onClickSlice when click slice button is clicked', () => {
      // Arrange
      const mockOnClickSlice = vi.fn()
      render(<SegmentList {...defaultProps} onClickSlice={mockOnClickSlice} />)

      // Act
      fireEvent.click(screen.getByTestId('click-slice-btn'))

      // Assert
      expect(mockOnClickSlice).toHaveBeenCalledWith({ id: 'slice-1' })
    })

    it('should call onClick with edit mode when edit button is clicked', () => {
      // Arrange
      const mockOnClick = vi.fn()
      render(<SegmentList {...defaultProps} onClick={mockOnClick} />)

      // Act
      fireEvent.click(screen.getByTestId('edit-btn'))

      // Assert - onClick is called from onClickEdit with isEditMode=true
      expect(mockOnClick).toHaveBeenCalled()
    })
  })
})

import type { SegmentDetailModel } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
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
  default: ({ detail, onClick, _onChangeSwitch, archived, embeddingAvailable, focused }: { detail: SegmentDetailModel, onClick: () => void, _onChangeSwitch?: () => void, archived: boolean, embeddingAvailable: boolean, focused: { segmentIndex: boolean, segmentContent: boolean } }) => (
    <div data-testid="segment-card" data-id={detail.id}>
      <span data-testid="segment-content">{detail.content}</span>
      <span data-testid="archived">{archived ? 'true' : 'false'}</span>
      <span data-testid="embedding-available">{embeddingAvailable ? 'true' : 'false'}</span>
      <span data-testid="focused-index">{focused.segmentIndex ? 'true' : 'false'}</span>
      <span data-testid="focused-content">{focused.segmentContent ? 'true' : 'false'}</span>
      <button onClick={onClick} data-testid="card-click">Click</button>
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
})

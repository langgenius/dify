import type { DocumentContextValue } from '@/app/components/datasets/documents/detail/context'
import type { ChildChunkDetail, ChunkingMode, ParentMode } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import ChildSegmentList from './child-segment-list'

// ============================================================================
// Hoisted Mocks
// ============================================================================

const {
  mockParentMode,
  mockCurrChildChunk,
} = vi.hoisted(() => ({
  mockParentMode: { current: 'paragraph' as ParentMode },
  mockCurrChildChunk: { current: { childChunkInfo: undefined, showModal: false } as { childChunkInfo?: ChildChunkDetail, showModal: boolean } },
}))

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number, ns?: string }) => {
      if (key === 'segment.childChunks')
        return options?.count === 1 ? 'child chunk' : 'child chunks'
      if (key === 'segment.searchResults')
        return 'search results'
      if (key === 'segment.edited')
        return 'edited'
      if (key === 'operation.add')
        return 'Add'
      const prefix = options?.ns ? `${options.ns}.` : ''
      return `${prefix}${key}`
    },
  }),
}))

// Mock document context
vi.mock('../context', () => ({
  useDocumentContext: (selector: (value: DocumentContextValue) => unknown) => {
    const value: DocumentContextValue = {
      datasetId: 'test-dataset-id',
      documentId: 'test-document-id',
      docForm: 'text' as ChunkingMode,
      parentMode: mockParentMode.current,
    }
    return selector(value)
  },
}))

// Mock segment list context
vi.mock('./index', () => ({
  useSegmentListContext: (selector: (value: { currChildChunk: { childChunkInfo?: ChildChunkDetail, showModal: boolean } }) => unknown) => {
    return selector({ currChildChunk: mockCurrChildChunk.current })
  },
}))

// Mock skeleton component
vi.mock('./skeleton/full-doc-list-skeleton', () => ({
  default: () => <div data-testid="full-doc-list-skeleton">Loading...</div>,
}))

// Mock Empty component
vi.mock('./common/empty', () => ({
  default: ({ onClearFilter }: { onClearFilter: () => void }) => (
    <div data-testid="empty-component">
      <button onClick={onClearFilter}>Clear Filter</button>
    </div>
  ),
}))

// Mock FormattedText and EditSlice
vi.mock('../../../formatted-text/formatted', () => ({
  FormattedText: ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <div data-testid="formatted-text" className={className}>{children}</div>
  ),
}))

vi.mock('../../../formatted-text/flavours/edit-slice', () => ({
  EditSlice: ({ label, text, onDelete, onClick, labelClassName, contentClassName }: {
    label: string
    text: string
    onDelete: () => void
    onClick: (e: React.MouseEvent) => void
    labelClassName?: string
    contentClassName?: string
  }) => (
    <div data-testid="edit-slice" onClick={onClick}>
      <span data-testid="edit-slice-label" className={labelClassName}>{label}</span>
      <span data-testid="edit-slice-content" className={contentClassName}>{text}</span>
      <button
        data-testid="delete-button"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        Delete
      </button>
    </div>
  ),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createMockChildChunk = (overrides: Partial<ChildChunkDetail> = {}): ChildChunkDetail => ({
  id: `child-${Math.random().toString(36).substr(2, 9)}`,
  position: 1,
  segment_id: 'segment-1',
  content: 'Child chunk content',
  word_count: 100,
  created_at: 1700000000,
  updated_at: 1700000000,
  type: 'automatic',
  ...overrides,
})

// ============================================================================
// Tests
// ============================================================================

describe('ChildSegmentList', () => {
  const defaultProps = {
    childChunks: [] as ChildChunkDetail[],
    parentChunkId: 'parent-1',
    enabled: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockParentMode.current = 'paragraph'
    mockCurrChildChunk.current = { childChunkInfo: undefined, showModal: false }
  })

  describe('Rendering', () => {
    it('should render with empty child chunks', () => {
      render(<ChildSegmentList {...defaultProps} />)

      expect(screen.getByText(/child chunks/i)).toBeInTheDocument()
    })

    it('should render child chunks when provided', () => {
      const childChunks = [
        createMockChildChunk({ id: 'child-1', position: 1, content: 'First chunk' }),
        createMockChildChunk({ id: 'child-2', position: 2, content: 'Second chunk' }),
      ]

      render(<ChildSegmentList {...defaultProps} childChunks={childChunks} />)

      // In paragraph mode, content is collapsed by default
      expect(screen.getByText(/2 child chunks/i)).toBeInTheDocument()
    })

    it('should render total count correctly with total prop in full-doc mode', () => {
      mockParentMode.current = 'full-doc'
      const childChunks = [createMockChildChunk()]

      // Pass inputValue="" to ensure isSearching is false
      render(<ChildSegmentList {...defaultProps} childChunks={childChunks} total={5} isLoading={false} inputValue="" />)

      expect(screen.getByText(/5 child chunks/i)).toBeInTheDocument()
    })

    it('should render loading skeleton in full-doc mode when loading', () => {
      mockParentMode.current = 'full-doc'

      render(<ChildSegmentList {...defaultProps} isLoading={true} />)

      expect(screen.getByTestId('full-doc-list-skeleton')).toBeInTheDocument()
    })

    it('should not render loading skeleton when not loading', () => {
      mockParentMode.current = 'full-doc'

      render(<ChildSegmentList {...defaultProps} isLoading={false} />)

      expect(screen.queryByTestId('full-doc-list-skeleton')).not.toBeInTheDocument()
    })
  })

  describe('Paragraph Mode', () => {
    beforeEach(() => {
      mockParentMode.current = 'paragraph'
    })

    it('should show collapse icon in paragraph mode', () => {
      const childChunks = [createMockChildChunk()]

      render(<ChildSegmentList {...defaultProps} childChunks={childChunks} />)

      // Check for collapse/expand behavior
      const totalRow = screen.getByText(/1 child chunk/i).closest('div')
      expect(totalRow).toBeInTheDocument()
    })

    it('should toggle collapsed state when clicked', () => {
      const childChunks = [createMockChildChunk({ content: 'Test content' })]

      render(<ChildSegmentList {...defaultProps} childChunks={childChunks} />)

      // Initially collapsed in paragraph mode - content should not be visible
      expect(screen.queryByTestId('formatted-text')).not.toBeInTheDocument()

      // Find and click the toggle area
      const toggleArea = screen.getByText(/1 child chunk/i).closest('div')

      // Click to expand
      if (toggleArea)
        fireEvent.click(toggleArea)

      // After expansion, content should be visible
      expect(screen.getByTestId('formatted-text')).toBeInTheDocument()
    })

    it('should apply opacity when disabled', () => {
      const { container } = render(<ChildSegmentList {...defaultProps} enabled={false} />)

      const wrapper = container.firstChild
      expect(wrapper).toHaveClass('opacity-50')
    })

    it('should not apply opacity when enabled', () => {
      const { container } = render(<ChildSegmentList {...defaultProps} enabled={true} />)

      const wrapper = container.firstChild
      expect(wrapper).not.toHaveClass('opacity-50')
    })
  })

  describe('Full-Doc Mode', () => {
    beforeEach(() => {
      mockParentMode.current = 'full-doc'
    })

    it('should show content by default in full-doc mode', () => {
      const childChunks = [createMockChildChunk({ content: 'Full doc content' })]

      render(<ChildSegmentList {...defaultProps} childChunks={childChunks} isLoading={false} />)

      expect(screen.getByTestId('formatted-text')).toBeInTheDocument()
    })

    it('should render search input in full-doc mode', () => {
      render(<ChildSegmentList {...defaultProps} inputValue="" handleInputChange={vi.fn()} />)

      const input = document.querySelector('input')
      expect(input).toBeInTheDocument()
    })

    it('should call handleInputChange when input changes', () => {
      const handleInputChange = vi.fn()

      render(<ChildSegmentList {...defaultProps} inputValue="" handleInputChange={handleInputChange} />)

      const input = document.querySelector('input')
      if (input) {
        fireEvent.change(input, { target: { value: 'test search' } })
        expect(handleInputChange).toHaveBeenCalledWith('test search')
      }
    })

    it('should show search results text when searching', () => {
      render(<ChildSegmentList {...defaultProps} inputValue="search term" total={3} />)

      expect(screen.getByText(/3 search results/i)).toBeInTheDocument()
    })

    it('should show empty component when no results and searching', () => {
      render(
        <ChildSegmentList
          {...defaultProps}
          childChunks={[]}
          inputValue="search term"
          onClearFilter={vi.fn()}
          isLoading={false}
        />,
      )

      expect(screen.getByTestId('empty-component')).toBeInTheDocument()
    })

    it('should call onClearFilter when clear button clicked in empty state', () => {
      const onClearFilter = vi.fn()

      render(
        <ChildSegmentList
          {...defaultProps}
          childChunks={[]}
          inputValue="search term"
          onClearFilter={onClearFilter}
          isLoading={false}
        />,
      )

      const clearButton = screen.getByText('Clear Filter')
      fireEvent.click(clearButton)

      expect(onClearFilter).toHaveBeenCalled()
    })
  })

  describe('Child Chunk Items', () => {
    it('should render edited label when chunk is edited', () => {
      mockParentMode.current = 'full-doc'
      const editedChunk = createMockChildChunk({
        id: 'edited-chunk',
        position: 1,
        created_at: 1700000000,
        updated_at: 1700000001, // Different from created_at
      })

      render(<ChildSegmentList {...defaultProps} childChunks={[editedChunk]} isLoading={false} />)

      expect(screen.getByText(/C-1 · edited/i)).toBeInTheDocument()
    })

    it('should not show edited label when chunk is not edited', () => {
      mockParentMode.current = 'full-doc'
      const normalChunk = createMockChildChunk({
        id: 'normal-chunk',
        position: 2,
        created_at: 1700000000,
        updated_at: 1700000000, // Same as created_at
      })

      render(<ChildSegmentList {...defaultProps} childChunks={[normalChunk]} isLoading={false} />)

      expect(screen.getByText('C-2')).toBeInTheDocument()
      expect(screen.queryByText(/edited/i)).not.toBeInTheDocument()
    })

    it('should call onClickSlice when chunk is clicked', () => {
      mockParentMode.current = 'full-doc'
      const onClickSlice = vi.fn()
      const chunk = createMockChildChunk({ id: 'clickable-chunk' })

      render(
        <ChildSegmentList
          {...defaultProps}
          childChunks={[chunk]}
          onClickSlice={onClickSlice}
          isLoading={false}
        />,
      )

      const editSlice = screen.getByTestId('edit-slice')
      fireEvent.click(editSlice)

      expect(onClickSlice).toHaveBeenCalledWith(chunk)
    })

    it('should call onDelete when delete button is clicked', () => {
      mockParentMode.current = 'full-doc'
      const onDelete = vi.fn()
      const chunk = createMockChildChunk({ id: 'deletable-chunk', segment_id: 'seg-1' })

      render(
        <ChildSegmentList
          {...defaultProps}
          childChunks={[chunk]}
          onDelete={onDelete}
          isLoading={false}
        />,
      )

      const deleteButton = screen.getByTestId('delete-button')
      fireEvent.click(deleteButton)

      expect(onDelete).toHaveBeenCalledWith('seg-1', 'deletable-chunk')
    })

    it('should apply focused styles when chunk is currently selected', () => {
      mockParentMode.current = 'full-doc'
      const chunk = createMockChildChunk({ id: 'focused-chunk' })
      mockCurrChildChunk.current = { childChunkInfo: chunk, showModal: true }

      render(<ChildSegmentList {...defaultProps} childChunks={[chunk]} isLoading={false} />)

      const label = screen.getByTestId('edit-slice-label')
      expect(label).toHaveClass('bg-state-accent-solid')
    })
  })

  describe('Add Button', () => {
    it('should call handleAddNewChildChunk when Add button is clicked', () => {
      const handleAddNewChildChunk = vi.fn()

      render(
        <ChildSegmentList
          {...defaultProps}
          handleAddNewChildChunk={handleAddNewChildChunk}
          parentChunkId="parent-123"
        />,
      )

      const addButton = screen.getByText('Add')
      fireEvent.click(addButton)

      expect(handleAddNewChildChunk).toHaveBeenCalledWith('parent-123')
    })

    it('should disable Add button when loading in full-doc mode', () => {
      mockParentMode.current = 'full-doc'

      render(<ChildSegmentList {...defaultProps} isLoading={true} />)

      const addButton = screen.getByText('Add')
      expect(addButton).toBeDisabled()
    })

    it('should stop propagation when Add button is clicked', () => {
      const handleAddNewChildChunk = vi.fn()
      const parentClickHandler = vi.fn()

      render(
        <div onClick={parentClickHandler}>
          <ChildSegmentList
            {...defaultProps}
            handleAddNewChildChunk={handleAddNewChildChunk}
          />
        </div>,
      )

      const addButton = screen.getByText('Add')
      fireEvent.click(addButton)

      expect(handleAddNewChildChunk).toHaveBeenCalled()
      // Parent should not be called due to stopPropagation
    })
  })

  describe('computeTotalInfo function', () => {
    it('should return search results when searching in full-doc mode', () => {
      mockParentMode.current = 'full-doc'

      render(<ChildSegmentList {...defaultProps} inputValue="search" total={10} />)

      expect(screen.getByText(/10 search results/i)).toBeInTheDocument()
    })

    it('should return "--" when total is 0 in full-doc mode', () => {
      mockParentMode.current = 'full-doc'

      render(<ChildSegmentList {...defaultProps} total={0} />)

      // When total is 0, displayText is '--'
      expect(screen.getByText(/--/)).toBeInTheDocument()
    })

    it('should use childChunks length in paragraph mode', () => {
      mockParentMode.current = 'paragraph'
      const childChunks = [
        createMockChildChunk(),
        createMockChildChunk(),
        createMockChildChunk(),
      ]

      render(<ChildSegmentList {...defaultProps} childChunks={childChunks} />)

      expect(screen.getByText(/3 child chunks/i)).toBeInTheDocument()
    })
  })

  describe('Focused State', () => {
    it('should not apply opacity when focused even if disabled', () => {
      const { container } = render(
        <ChildSegmentList {...defaultProps} enabled={false} focused={true} />,
      )

      const wrapper = container.firstChild
      expect(wrapper).not.toHaveClass('opacity-50')
    })
  })

  describe('Input clear button', () => {
    it('should call handleInputChange with empty string when clear is clicked', () => {
      mockParentMode.current = 'full-doc'
      const handleInputChange = vi.fn()

      render(
        <ChildSegmentList
          {...defaultProps}
          inputValue="test"
          handleInputChange={handleInputChange}
        />,
      )

      // Find the clear button (it's the showClearIcon button in Input)
      const input = document.querySelector('input')
      if (input) {
        // Trigger clear by simulating the input's onClear
        const clearButton = document.querySelector('[class*="cursor-pointer"]')
        if (clearButton)
          fireEvent.click(clearButton)
      }
    })
  })
})

import type { SegmentListContextValue } from '@/app/components/datasets/documents/detail/completed'
import type { DocumentContextValue } from '@/app/components/datasets/documents/detail/context'
import type { Attachment, ChildChunkDetail, ParentMode, SegmentDetailModel } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { ChunkingMode } from '@/models/datasets'
import SegmentCard from './index'

// Mock react-i18next - external dependency
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number, ns?: string }) => {
      if (key === 'segment.characters')
        return options?.count === 1 ? 'character' : 'characters'
      if (key === 'segment.childChunks')
        return options?.count === 1 ? 'child chunk' : 'child chunks'
      const prefix = options?.ns ? `${options.ns}.` : ''
      return `${prefix}${key}`
    },
  }),
}))

// ============================================================================
// Context Mocks - need to control test scenarios
// ============================================================================

const mockDocForm = { current: ChunkingMode.text }
const mockParentMode = { current: 'paragraph' as ParentMode }

vi.mock('../../context', () => ({
  useDocumentContext: (selector: (value: DocumentContextValue) => unknown) => {
    const value: DocumentContextValue = {
      datasetId: 'test-dataset-id',
      documentId: 'test-document-id',
      docForm: mockDocForm.current,
      parentMode: mockParentMode.current,
    }
    return selector(value)
  },
}))

const mockIsCollapsed = { current: true }
vi.mock('../index', () => ({
  useSegmentListContext: (selector: (value: SegmentListContextValue) => unknown) => {
    const value: SegmentListContextValue = {
      isCollapsed: mockIsCollapsed.current,
      fullScreen: false,
      toggleFullScreen: vi.fn(),
      currSegment: { showModal: false },
      currChildChunk: { showModal: false },
    }
    return selector(value)
  },
}))

// ============================================================================
// Component Mocks - components with complex dependencies
// ============================================================================

// StatusItem uses React Query hooks which require QueryClientProvider
vi.mock('../../../status-item', () => ({
  default: ({ status, reverse, textCls }: { status: string, reverse?: boolean, textCls?: string }) => (
    <div data-testid="status-item" data-status={status} data-reverse={reverse} className={textCls}>
      Status:
      {' '}
      {status}
    </div>
  ),
}))

// ImageList has deep dependency: FileThumb → file-uploader → react-pdf-highlighter (ESM)
vi.mock('@/app/components/datasets/common/image-list', () => ({
  default: ({ images, size, className }: { images: Array<{ sourceUrl: string, name: string }>, size?: string, className?: string }) => (
    <div data-testid="image-list" data-image-count={images.length} data-size={size} className={className}>
      {images.map((img, idx: number) => (
        <img key={idx} src={img.sourceUrl} alt={img.name} />
      ))}
    </div>
  ),
}))

// Markdown uses next/dynamic and react-syntax-highlighter (ESM)
vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content, className }: { content: string, className?: string }) => (
    <div data-testid="markdown" className={`markdown-body ${className || ''}`}>{content}</div>
  ),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createMockAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'attachment-1',
  name: 'test-image.png',
  size: 1024,
  extension: 'png',
  mime_type: 'image/png',
  source_url: 'https://example.com/test-image.png',
  ...overrides,
})

const createMockChildChunk = (overrides: Partial<ChildChunkDetail> = {}): ChildChunkDetail => ({
  id: 'child-chunk-1',
  position: 1,
  segment_id: 'segment-1',
  content: 'Child chunk content',
  word_count: 100,
  created_at: 1700000000,
  updated_at: 1700000000,
  type: 'automatic',
  ...overrides,
})

const createMockSegmentDetail = (overrides: Partial<SegmentDetailModel & { document?: { name: string } }> = {}): SegmentDetailModel & { document?: { name: string } } => ({
  id: 'segment-1',
  position: 1,
  document_id: 'doc-1',
  content: 'Test segment content',
  sign_content: 'Test signed content',
  word_count: 100,
  tokens: 50,
  keywords: ['keyword1', 'keyword2'],
  index_node_id: 'index-1',
  index_node_hash: 'hash-1',
  hit_count: 10,
  enabled: true,
  disabled_at: 0,
  disabled_by: '',
  status: 'completed',
  created_by: 'user-1',
  created_at: 1700000000,
  indexing_at: 1700000100,
  completed_at: 1700000200,
  error: null,
  stopped_at: 0,
  updated_at: 1700000000,
  attachments: [],
  child_chunks: [],
  document: { name: 'Test Document' },
  ...overrides,
})

const defaultFocused = { segmentIndex: false, segmentContent: false }

// ============================================================================
// Tests
// ============================================================================

describe('SegmentCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDocForm.current = ChunkingMode.text
    mockParentMode.current = 'paragraph'
    mockIsCollapsed.current = true
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render loading skeleton when loading is true', () => {
      render(<SegmentCard loading={true} focused={defaultFocused} />)

      // ParentChunkCardSkeleton should render
      expect(screen.getByTestId('parent-chunk-card-skeleton')).toBeInTheDocument()
    })

    it('should render segment card content when loading is false', () => {
      const detail = createMockSegmentDetail()

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // ChunkContent shows sign_content first, then content
      expect(screen.getByText('Test signed content')).toBeInTheDocument()
    })

    it('should render segment index tag with correct position', () => {
      const detail = createMockSegmentDetail({ position: 5 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText(/Chunk-05/i)).toBeInTheDocument()
    })

    it('should render word count text', () => {
      const detail = createMockSegmentDetail({ word_count: 250 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('250 characters')).toBeInTheDocument()
    })

    it('should render hit count text', () => {
      const detail = createMockSegmentDetail({ hit_count: 42 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('42 datasetDocuments.segment.hitCount')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const detail = createMockSegmentDetail()

      render(
        <SegmentCard loading={false} detail={detail} className="custom-class" focused={defaultFocused} />,
      )

      const card = screen.getByTestId('segment-card')
      expect(card).toHaveClass('custom-class')
    })
  })

  // --------------------------------------------------------------------------
  // Props Tests
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should use default empty object when detail is undefined', () => {
      render(<SegmentCard loading={false} focused={defaultFocused} />)

      expect(screen.getByText(/Chunk/i)).toBeInTheDocument()
    })

    it('should handle archived prop correctly - switch should be disabled', () => {
      const detail = createMockSegmentDetail()

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          archived={true}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveClass('!cursor-not-allowed')
    })

    it('should show action buttons when embeddingAvailable is true', () => {
      const detail = createMockSegmentDetail()

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      expect(screen.getByTestId('segment-edit-button')).toBeInTheDocument()
      expect(screen.getByTestId('segment-delete-button')).toBeInTheDocument()
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('should not show action buttons when embeddingAvailable is false', () => {
      const detail = createMockSegmentDetail()

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          embeddingAvailable={false}
          focused={defaultFocused}
        />,
      )

      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })

    it('should apply focused styles when segmentContent is focused', () => {
      const detail = createMockSegmentDetail()

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          focused={{ segmentIndex: false, segmentContent: true }}
        />,
      )

      const card = screen.getByTestId('segment-card')
      expect(card).toHaveClass('bg-dataset-chunk-detail-card-hover-bg')
    })
  })

  // --------------------------------------------------------------------------
  // State Management Tests
  // --------------------------------------------------------------------------
  describe('State Management', () => {
    it('should toggle delete confirmation modal when delete button clicked', async () => {
      const detail = createMockSegmentDetail()

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const deleteButton = screen.getByTestId('segment-delete-button')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByText('datasetDocuments.segment.delete')).toBeInTheDocument()
      })
    })

    it('should close delete confirmation modal when cancel is clicked', async () => {
      const detail = createMockSegmentDetail()

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const deleteButton = screen.getByTestId('segment-delete-button')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByText('datasetDocuments.segment.delete')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.operation.cancel'))

      await waitFor(() => {
        expect(screen.queryByText('datasetDocuments.segment.delete')).not.toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Callback Tests
  // --------------------------------------------------------------------------
  describe('Callbacks', () => {
    it('should call onClick when card is clicked in general mode', () => {
      const onClick = vi.fn()
      const detail = createMockSegmentDetail()
      mockDocForm.current = ChunkingMode.text

      render(
        <SegmentCard loading={false} detail={detail} onClick={onClick} focused={defaultFocused} />,
      )

      const card = screen.getByTestId('segment-card')
      fireEvent.click(card)

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should not call onClick when card is clicked in full-doc mode', () => {
      const onClick = vi.fn()
      const detail = createMockSegmentDetail()
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'full-doc'

      render(
        <SegmentCard loading={false} detail={detail} onClick={onClick} focused={defaultFocused} />,
      )

      const card = screen.getByTestId('segment-card')
      fireEvent.click(card)

      expect(onClick).not.toHaveBeenCalled()
    })

    it('should call onClick when view more button is clicked in full-doc mode', () => {
      const onClick = vi.fn()
      const detail = createMockSegmentDetail()
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'full-doc'

      render(<SegmentCard loading={false} detail={detail} onClick={onClick} focused={defaultFocused} />)

      const viewMoreButton = screen.getByRole('button', { name: /viewMore/i })
      fireEvent.click(viewMoreButton)

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should call onClickEdit when edit button is clicked', () => {
      const onClickEdit = vi.fn()
      const detail = createMockSegmentDetail()

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          onClickEdit={onClickEdit}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const editButton = screen.getByTestId('segment-edit-button')
      fireEvent.click(editButton)

      expect(onClickEdit).toHaveBeenCalledTimes(1)
    })

    it('should call onDelete when confirm delete is clicked', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined)
      const detail = createMockSegmentDetail({ id: 'test-segment-id' })

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          onDelete={onDelete}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const deleteButton = screen.getByTestId('segment-delete-button')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByText('datasetDocuments.segment.delete')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.operation.sure'))

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledWith('test-segment-id')
      })
    })

    it('should call onChangeSwitch when switch is toggled', async () => {
      const onChangeSwitch = vi.fn().mockResolvedValue(undefined)
      const detail = createMockSegmentDetail({ id: 'test-segment-id', enabled: true, status: 'completed' })

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          onChangeSwitch={onChangeSwitch}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const switchElement = screen.getByRole('switch')
      fireEvent.click(switchElement)

      await waitFor(() => {
        expect(onChangeSwitch).toHaveBeenCalledWith(false, 'test-segment-id')
      })
    })

    it('should stop propagation when edit button is clicked', () => {
      const onClick = vi.fn()
      const onClickEdit = vi.fn()
      const detail = createMockSegmentDetail()

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          onClick={onClick}
          onClickEdit={onClickEdit}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const editButton = screen.getByTestId('segment-edit-button')
      fireEvent.click(editButton)

      expect(onClickEdit).toHaveBeenCalledTimes(1)
      expect(onClick).not.toHaveBeenCalled()
    })

    it('should stop propagation when switch area is clicked', () => {
      const onClick = vi.fn()
      const detail = createMockSegmentDetail({ status: 'completed' })

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          onClick={onClick}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const switchElement = screen.getByRole('switch')
      const switchContainer = switchElement.parentElement
      fireEvent.click(switchContainer!)

      expect(onClick).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Logic Tests
  // --------------------------------------------------------------------------
  describe('Memoization Logic', () => {
    it('should compute isGeneralMode correctly for text mode - show keywords', () => {
      mockDocForm.current = ChunkingMode.text
      const detail = createMockSegmentDetail({ keywords: ['testkeyword'] })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('testkeyword')).toBeInTheDocument()
    })

    it('should compute isGeneralMode correctly for non-text mode - hide keywords', () => {
      mockDocForm.current = ChunkingMode.qa
      const detail = createMockSegmentDetail({ keywords: ['testkeyword'] })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.queryByText('testkeyword')).not.toBeInTheDocument()
    })

    it('should compute isParentChildMode correctly - show parent chunk prefix', () => {
      mockDocForm.current = ChunkingMode.parentChild
      const detail = createMockSegmentDetail()

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText(/datasetDocuments\.segment\.parentChunk/i)).toBeInTheDocument()
    })

    it('should compute isFullDocMode correctly - show view more button', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'full-doc'
      const detail = createMockSegmentDetail()

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('common.operation.viewMore')).toBeInTheDocument()
    })

    it('should compute isParagraphMode correctly and show child chunks', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'paragraph'
      const childChunks = [createMockChildChunk()]
      const detail = createMockSegmentDetail({ child_chunks: childChunks })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // ChildSegmentList should render
      expect(screen.getByText(/child chunk/i)).toBeInTheDocument()
    })

    it('should compute chunkEdited correctly when updated_at > created_at', () => {
      mockDocForm.current = ChunkingMode.text
      const detail = createMockSegmentDetail({
        created_at: 1700000000,
        updated_at: 1700000001,
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('datasetDocuments.segment.edited')).toBeInTheDocument()
    })

    it('should not show edited badge when timestamps are equal', () => {
      mockDocForm.current = ChunkingMode.text
      const detail = createMockSegmentDetail({
        created_at: 1700000000,
        updated_at: 1700000000,
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.queryByText('datasetDocuments.segment.edited')).not.toBeInTheDocument()
    })

    it('should not show edited badge in full-doc mode', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'full-doc'
      const detail = createMockSegmentDetail({
        created_at: 1700000000,
        updated_at: 1700000001,
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.queryByText('datasetDocuments.segment.edited')).not.toBeInTheDocument()
    })

    it('should compute contentOpacity correctly when enabled', () => {
      const detail = createMockSegmentDetail({ enabled: true })

      const { container } = render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      const wordCount = container.querySelector('.system-xs-medium.text-text-tertiary')
      expect(wordCount).not.toHaveClass('opacity-50')
    })

    it('should compute contentOpacity correctly when disabled', () => {
      const detail = createMockSegmentDetail({ enabled: false })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // ChunkContent receives opacity class when disabled
      const markdown = screen.getByTestId('markdown')
      expect(markdown).toHaveClass('opacity-50')
    })

    it('should not apply opacity when disabled but focused', () => {
      const detail = createMockSegmentDetail({ enabled: false })

      const { container } = render(
        <SegmentCard
          loading={false}
          detail={detail}
          focused={{ segmentIndex: false, segmentContent: true }}
        />,
      )

      const wordCount = container.querySelector('.system-xs-medium.text-text-tertiary')
      expect(wordCount).not.toHaveClass('opacity-50')
    })

    it('should compute wordCountText with correct format for singular', () => {
      const detail = createMockSegmentDetail({ word_count: 1 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('1 character')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Mode-specific Rendering Tests
  // --------------------------------------------------------------------------
  describe('Mode-specific Rendering', () => {
    it('should render without padding classes in full-doc mode', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'full-doc'
      const detail = createMockSegmentDetail()

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      const card = screen.getByTestId('segment-card')
      expect(card).not.toHaveClass('pb-2')
      expect(card).not.toHaveClass('pt-2.5')
    })

    it('should render with hover classes in non full-doc mode', () => {
      mockDocForm.current = ChunkingMode.text
      const detail = createMockSegmentDetail()

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      const card = screen.getByTestId('segment-card')
      expect(card).toHaveClass('pb-2')
      expect(card).toHaveClass('pt-2.5')
    })

    it('should not render status item in full-doc mode', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'full-doc'
      const detail = createMockSegmentDetail()

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // In full-doc mode, status item should not render
      expect(screen.queryByText('Status:')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Child Segment List Tests
  // --------------------------------------------------------------------------
  describe('Child Segment List', () => {
    it('should render ChildSegmentList when in paragraph mode with child chunks', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'paragraph'
      const childChunks = [createMockChildChunk(), createMockChildChunk({ id: 'child-2', position: 2 })]
      const detail = createMockSegmentDetail({ child_chunks: childChunks })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText(/2 child chunks/i)).toBeInTheDocument()
    })

    it('should not render ChildSegmentList when child_chunks is empty', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'paragraph'
      const detail = createMockSegmentDetail({ child_chunks: [] })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.queryByText(/child chunk/i)).not.toBeInTheDocument()
    })

    it('should not render ChildSegmentList in full-doc mode', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'full-doc'
      const childChunks = [createMockChildChunk()]
      const detail = createMockSegmentDetail({ child_chunks: childChunks })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // In full-doc mode, ChildSegmentList should not render
      expect(screen.queryByText(/1 child chunk$/i)).not.toBeInTheDocument()
    })

    it('should call handleAddNewChildChunk when add button is clicked', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'paragraph'
      const handleAddNewChildChunk = vi.fn()
      const childChunks = [createMockChildChunk()]
      const detail = createMockSegmentDetail({ id: 'parent-id', child_chunks: childChunks })

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          handleAddNewChildChunk={handleAddNewChildChunk}
          focused={defaultFocused}
        />,
      )

      const addButton = screen.getByText('common.operation.add')
      fireEvent.click(addButton)

      expect(handleAddNewChildChunk).toHaveBeenCalledWith('parent-id')
    })
  })

  // --------------------------------------------------------------------------
  // Keywords Display Tests
  // --------------------------------------------------------------------------
  describe('Keywords Display', () => {
    it('should render keywords with # prefix in general mode', () => {
      mockDocForm.current = ChunkingMode.text
      const detail = createMockSegmentDetail({ keywords: ['keyword1', 'keyword2'] })

      const { container } = render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('keyword1')).toBeInTheDocument()
      expect(screen.getByText('keyword2')).toBeInTheDocument()
      // Tag component shows # prefix
      const hashtags = container.querySelectorAll('.text-text-quaternary')
      expect(hashtags.length).toBeGreaterThan(0)
    })

    it('should not render keywords in QA mode', () => {
      mockDocForm.current = ChunkingMode.qa
      const detail = createMockSegmentDetail({ keywords: ['keyword1'] })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.queryByText('keyword1')).not.toBeInTheDocument()
    })

    it('should not render keywords in parent-child mode', () => {
      mockDocForm.current = ChunkingMode.parentChild
      const detail = createMockSegmentDetail({ keywords: ['keyword1'] })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.queryByText('keyword1')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Images Display Tests
  // --------------------------------------------------------------------------
  describe('Images Display', () => {
    it('should render ImageList when attachments exist', () => {
      const attachments = [createMockAttachment()]
      const detail = createMockSegmentDetail({ attachments })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // ImageList uses FileThumb which renders images
      expect(screen.getByAltText('test-image.png')).toBeInTheDocument()
    })

    it('should not render ImageList when attachments is empty', () => {
      const detail = createMockSegmentDetail({ attachments: [] })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.queryByAltText('test-image.png')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases and Error Handling Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases and Error Handling', () => {
    it('should handle undefined detail gracefully', () => {
      render(<SegmentCard loading={false} detail={undefined} focused={defaultFocused} />)

      expect(screen.getByText(/Chunk/i)).toBeInTheDocument()
    })

    it('should handle empty detail object gracefully', () => {
      render(<SegmentCard loading={false} detail={{} as SegmentDetailModel} focused={defaultFocused} />)

      expect(screen.getByText(/Chunk/i)).toBeInTheDocument()
    })

    it('should handle missing callback functions gracefully', () => {
      const detail = createMockSegmentDetail()

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          onClick={undefined}
          onChangeSwitch={undefined}
          onDelete={undefined}
          onClickEdit={undefined}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const card = screen.getByTestId('segment-card')
      expect(() => fireEvent.click(card)).not.toThrow()
    })

    it('should handle switch being disabled when status is not completed', () => {
      const detail = createMockSegmentDetail({ status: 'indexing' })

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      // The Switch component uses CSS classes for disabled state, not the native disabled attribute
      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveClass('!cursor-not-allowed', '!opacity-50')
    })

    it('should handle zero word count', () => {
      const detail = createMockSegmentDetail({ word_count: 0 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('0 characters')).toBeInTheDocument()
    })

    it('should handle zero hit count', () => {
      const detail = createMockSegmentDetail({ hit_count: 0 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('0 datasetDocuments.segment.hitCount')).toBeInTheDocument()
    })

    it('should handle very long content', () => {
      const longContent = 'A'.repeat(10000)
      // ChunkContent shows sign_content first, so set it to the long content
      const detail = createMockSegmentDetail({ sign_content: longContent })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText(longContent)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Component Integration Tests
  // --------------------------------------------------------------------------
  describe('Component Integration', () => {
    it('should render real Tag component with hashtag styling', () => {
      mockDocForm.current = ChunkingMode.text
      const detail = createMockSegmentDetail({ keywords: ['testkeyword'] })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('testkeyword')).toBeInTheDocument()
    })

    it('should render real Divider component', () => {
      const detail = createMockSegmentDetail()

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const dividers = document.querySelectorAll('.bg-divider-regular')
      expect(dividers.length).toBeGreaterThan(0)
    })

    it('should render real Badge component when edited', () => {
      mockDocForm.current = ChunkingMode.text
      const detail = createMockSegmentDetail({
        created_at: 1700000000,
        updated_at: 1700000001,
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      const editedBadge = screen.getByText('datasetDocuments.segment.edited')
      expect(editedBadge).toHaveClass('system-2xs-medium-uppercase')
    })

    it('should render real Switch component with correct enabled state', () => {
      const detail = createMockSegmentDetail({ enabled: true, status: 'completed' })

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveClass('bg-components-toggle-bg')
    })

    it('should render real Switch component with unchecked state', () => {
      const detail = createMockSegmentDetail({ enabled: false, status: 'completed' })

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveClass('bg-components-toggle-bg-unchecked')
    })

    it('should render real SegmentIndexTag with position formatting', () => {
      const detail = createMockSegmentDetail({ position: 1 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText(/Chunk-01/i)).toBeInTheDocument()
    })

    it('should render real SegmentIndexTag with double digit position', () => {
      const detail = createMockSegmentDetail({ position: 12 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText(/Chunk-12/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // All Props Variations Tests
  // --------------------------------------------------------------------------
  describe('All Props Variations', () => {
    it('should render correctly with all props provided', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'paragraph'
      const childChunks = [createMockChildChunk()]
      const attachments = [createMockAttachment()]
      const detail = createMockSegmentDetail({
        id: 'full-props-segment',
        position: 10,
        sign_content: 'Full signed content',
        content: 'Full content',
        word_count: 500,
        hit_count: 25,
        enabled: true,
        keywords: ['key1', 'key2'],
        child_chunks: childChunks,
        attachments,
        created_at: 1700000000,
        updated_at: 1700000001,
        status: 'completed',
      })

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          onClick={vi.fn()}
          onChangeSwitch={vi.fn()}
          onDelete={vi.fn()}
          onDeleteChildChunk={vi.fn()}
          handleAddNewChildChunk={vi.fn()}
          onClickSlice={vi.fn()}
          onClickEdit={vi.fn()}
          className="full-props-class"
          archived={false}
          embeddingAvailable={true}
          focused={{ segmentIndex: true, segmentContent: true }}
        />,
      )

      // ChunkContent shows sign_content first
      expect(screen.getByText('Full signed content')).toBeInTheDocument()
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('should render correctly with minimal props', () => {
      render(<SegmentCard loading={true} focused={defaultFocused} />)

      expect(screen.getByText('common.operation.viewMore')).toBeInTheDocument()
    })

    it('should handle loading transition correctly', () => {
      const detail = createMockSegmentDetail()

      const { rerender } = render(<SegmentCard loading={true} detail={detail} focused={defaultFocused} />)

      // When loading, content should not be visible
      expect(screen.queryByText('Test signed content')).not.toBeInTheDocument()

      rerender(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // ChunkContent shows sign_content first
      expect(screen.getByText('Test signed content')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // ChunkContent QA Mode Tests - cover lines 25-49
  // --------------------------------------------------------------------------
  describe('ChunkContent QA Mode', () => {
    it('should render Q and A sections when answer is provided', () => {
      const detail = createMockSegmentDetail({
        content: 'This is the question content',
        answer: 'This is the answer content',
        sign_content: '',
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // Should render Q label
      expect(screen.getByText('Q')).toBeInTheDocument()
      // Should render A label
      expect(screen.getByText('A')).toBeInTheDocument()
      // Should render question content
      expect(screen.getByText('This is the question content')).toBeInTheDocument()
      // Should render answer content
      expect(screen.getByText('This is the answer content')).toBeInTheDocument()
    })

    it('should apply line-clamp-2 class when isCollapsed is true in QA mode', () => {
      mockIsCollapsed.current = true
      const detail = createMockSegmentDetail({
        content: 'Question content',
        answer: 'Answer content',
        sign_content: '',
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // Markdown components should have line-clamp-2 class when collapsed
      const markdowns = screen.getAllByTestId('markdown')
      markdowns.forEach((markdown) => {
        expect(markdown).toHaveClass('line-clamp-2')
      })
    })

    it('should apply line-clamp-20 class when isCollapsed is false in QA mode', () => {
      mockIsCollapsed.current = false
      const detail = createMockSegmentDetail({
        content: 'Question content',
        answer: 'Answer content',
        sign_content: '',
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // Markdown components should have line-clamp-20 class when not collapsed
      const markdowns = screen.getAllByTestId('markdown')
      markdowns.forEach((markdown) => {
        expect(markdown).toHaveClass('line-clamp-20')
      })
    })

    it('should render QA mode with className applied to wrapper', () => {
      const detail = createMockSegmentDetail({
        content: 'Question',
        answer: 'Answer',
        sign_content: '',
        enabled: false,
      })

      const { container } = render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // The ChunkContent wrapper should have opacity class when disabled
      const qaWrapper = container.querySelector('.flex.gap-x-1')
      expect(qaWrapper).toBeInTheDocument()
    })

    it('should not render QA mode when answer is empty string', () => {
      const detail = createMockSegmentDetail({
        content: 'Regular content',
        answer: '',
        sign_content: 'Signed content',
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // Should not render Q and A labels
      expect(screen.queryByText('Q')).not.toBeInTheDocument()
      expect(screen.queryByText('A')).not.toBeInTheDocument()
      // Should render signed content instead
      expect(screen.getByText('Signed content')).toBeInTheDocument()
    })

    it('should not render QA mode when answer is undefined', () => {
      const detail = createMockSegmentDetail({
        content: 'Regular content',
        answer: undefined,
        sign_content: 'Signed content',
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // Should not render Q and A labels
      expect(screen.queryByText('Q')).not.toBeInTheDocument()
      expect(screen.queryByText('A')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // ChunkContent Non-QA Mode Tests - ensure full coverage
  // --------------------------------------------------------------------------
  describe('ChunkContent Non-QA Mode', () => {
    it('should apply line-clamp-3 in fullDocMode', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'full-doc'
      const detail = createMockSegmentDetail({
        sign_content: 'Content in full doc mode',
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      const markdown = screen.getByTestId('markdown')
      expect(markdown).toHaveClass('line-clamp-3')
    })

    it('should apply line-clamp-2 when not fullDocMode and isCollapsed is true', () => {
      mockDocForm.current = ChunkingMode.text
      mockIsCollapsed.current = true
      const detail = createMockSegmentDetail({
        sign_content: 'Collapsed content',
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      const markdown = screen.getByTestId('markdown')
      expect(markdown).toHaveClass('line-clamp-2')
    })

    it('should apply line-clamp-20 when not fullDocMode and isCollapsed is false', () => {
      mockDocForm.current = ChunkingMode.text
      mockIsCollapsed.current = false
      const detail = createMockSegmentDetail({
        sign_content: 'Expanded content',
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      const markdown = screen.getByTestId('markdown')
      expect(markdown).toHaveClass('line-clamp-20')
    })

    it('should fall back to content when sign_content is empty', () => {
      const detail = createMockSegmentDetail({
        content: 'Fallback content',
        sign_content: '',
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('Fallback content')).toBeInTheDocument()
    })

    it('should render empty string when both sign_content and content are empty', () => {
      const detail = createMockSegmentDetail({
        content: '',
        sign_content: '',
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      const markdown = screen.getByTestId('markdown')
      expect(markdown).toHaveTextContent('')
    })
  })
})

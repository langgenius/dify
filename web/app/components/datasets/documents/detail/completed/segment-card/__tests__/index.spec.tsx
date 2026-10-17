import type {
  ChildChunkResponse,
  SegmentResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { SegmentListContextValue } from '@/app/components/datasets/documents/detail/completed'
import type { DocumentContextValue } from '@/app/components/datasets/documents/detail/context'
import type { Attachment, ParentMode } from '@/models/datasets'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { ChunkingMode } from '@/models/datasets'
import SegmentCard from '../index'

// Context Mocks - need to control test scenarios

const mockDocForm: { current: ChunkingMode } = { current: ChunkingMode.text }
const mockParentMode = { current: 'paragraph' as ParentMode }
const mockCanEdit = { current: true }

vi.mock('../../../context', () => ({
  useDocumentContext: (selector: (value: DocumentContextValue) => unknown) => {
    const value: DocumentContextValue = {
      datasetId: 'test-dataset-id',
      documentId: 'test-document-id',
      docForm: mockDocForm.current,
      parentMode: mockParentMode.current,
      canEdit: mockCanEdit.current,
    }
    return selector(value)
  },
}))

const mockIsCollapsed = { current: true }
vi.mock('../../index', () => ({
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

// Component Mocks - components with complex dependencies

// StatusItem uses React Query hooks which require QueryClientProvider
vi.mock('../../../../status-item', () => ({
  default: ({
    status,
    reverse,
    textCls,
  }: {
    status: string
    reverse?: boolean
    textCls?: string
  }) => (
    <div data-testid="status-item" data-status={status} data-reverse={reverse} className={textCls}>
      Status: {status}
    </div>
  ),
}))

// ImageList has deep dependency: FileThumb → file-uploader → react-pdf-highlighter (ESM)
vi.mock('@/app/components/datasets/common/image-list', () => ({
  default: ({
    images,
    size,
    className,
  }: {
    images: Array<{ sourceUrl: string; name: string }>
    size?: string
    className?: string
  }) => (
    <div
      data-testid="image-list"
      data-image-count={images.length}
      data-size={size}
      className={className}
    >
      {images.map((img, idx: number) => (
        <img key={idx} src={img.sourceUrl} alt={img.name} />
      ))}
    </div>
  ),
}))

// Markdown uses next/dynamic and shiki (ESM)
vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content, className }: { content: string; className?: string }) => (
    <div data-testid="markdown" className={`markdown-body ${className || ''}`}>
      {content}
    </div>
  ),
}))

const createMockAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'attachment-1',
  name: 'test-image.png',
  size: 1024,
  extension: 'png',
  mime_type: 'image/png',
  source_url: 'https://example.com/test-image.png',
  ...overrides,
})

const createMockChildChunk = (overrides: Partial<ChildChunkResponse> = {}): ChildChunkResponse => ({
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

const createMockSegmentDetail = (
  overrides: Partial<SegmentResponse & { document?: { name: string } }> = {},
): SegmentResponse & { document?: { name: string } } => ({
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
  answer: null,
  summary: null,
  updated_by: null,
  updated_at: 1700000000,
  attachments: [],
  child_chunks: [],
  document: { name: 'Test Document' },
  ...overrides,
})

const defaultFocused = { segmentIndex: false, segmentContent: false }

// Tests

describe('SegmentCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDocForm.current = ChunkingMode.text
    mockParentMode.current = 'paragraph'
    mockIsCollapsed.current = true
    mockCanEdit.current = true
  })

  it.each([true, false])(
    'should disable single chunk mutations without edit permission (enabled: %s)',
    async (enabled) => {
      mockCanEdit.current = false
      const user = userEvent.setup()
      const onClickEdit = vi.fn()
      const onChangeSwitch = vi.fn()
      const onDelete = vi.fn()

      render(
        <SegmentCard
          loading={false}
          detail={createMockSegmentDetail({ enabled })}
          embeddingAvailable
          focused={defaultFocused}
          onClickEdit={onClickEdit}
          onChangeSwitch={onChangeSwitch}
          onDelete={onDelete}
        />,
      )

      const editButton = screen.getByRole('button', { name: 'common.operation.edit' })
      const deleteButton = screen.getByRole('button', { name: 'common.operation.delete' })
      const statusSwitch = screen.getByRole('switch')
      expect(editButton).toBeDisabled()
      expect(deleteButton).toBeDisabled()
      expect(statusSwitch).toHaveAttribute('aria-disabled', 'true')

      await user.click(editButton)
      await user.click(deleteButton)
      await user.click(statusSwitch)

      expect(onClickEdit).not.toHaveBeenCalled()
      expect(onChangeSwitch).not.toHaveBeenCalled()
      expect(onDelete).not.toHaveBeenCalled()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    },
  )

  describe('Rendering', () => {
    it('should render segment index tag with correct position', () => {
      const detail = createMockSegmentDetail({ position: 5 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText(/Chunk-05/i)).toBeInTheDocument()
    })

    it('should render word count text', () => {
      const detail = createMockSegmentDetail({ word_count: 250 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(
        screen.getByText('250 datasetDocuments.segment.characters:{"count":250}'),
      ).toBeInTheDocument()
    })

    it('should render hit count text', () => {
      const detail = createMockSegmentDetail({ hit_count: 42 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('42 datasetDocuments.segment.hitCount')).toBeInTheDocument()
    })
  })

  // Props Tests
  describe('Props', () => {
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
      expect(switchElement).toHaveAttribute('aria-disabled', 'true')
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
  })

  describe('State Management', () => {
    it('should close delete confirmation modal when cancel is clicked', async () => {
      const detail = createMockSegmentDetail()
      const onDelete = vi.fn()

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          onDelete={onDelete}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const deleteButton = screen.getByRole('button', { name: 'common.operation.delete' })
      await userEvent.setup().click(deleteButton)

      await waitFor(() => {
        expect(screen.getByText('datasetDocuments.segment.delete')).toBeInTheDocument()
      })

      await userEvent.setup().click(screen.getByText('common.operation.cancel'))

      await waitFor(() => {
        expect(screen.queryByText('datasetDocuments.segment.delete')).not.toBeInTheDocument()
      })
      expect(onDelete).not.toHaveBeenCalled()
    })
  })

  describe('Callbacks', () => {
    it('opens a chunk from its keyboard-accessible detail button', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()

      render(
        <SegmentCard
          loading={false}
          detail={createMockSegmentDetail()}
          onClick={onClick}
          focused={defaultFocused}
        />,
      )

      const detailButton = screen.getByRole('button', {
        name: 'datasetDocuments.segment.chunk-01 datasetDocuments.segment.chunkDetail',
      })
      detailButton.focus()
      await user.keyboard('{Enter}')

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should call onClick when card is clicked in general mode', async () => {
      const onClick = vi.fn()
      const detail = createMockSegmentDetail()
      mockDocForm.current = ChunkingMode.text

      render(
        <SegmentCard loading={false} detail={detail} onClick={onClick} focused={defaultFocused} />,
      )

      const card = screen.getByTestId('segment-card')
      await userEvent.setup().click(card)

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should not call onClick when card is clicked in full-doc mode', async () => {
      const onClick = vi.fn()
      const detail = createMockSegmentDetail()
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'full-doc'

      render(
        <SegmentCard loading={false} detail={detail} onClick={onClick} focused={defaultFocused} />,
      )

      const card = screen.getByTestId('segment-card')
      await userEvent.setup().click(card)

      expect(onClick).not.toHaveBeenCalled()
    })

    it('should call onClick when view more button is clicked in full-doc mode', async () => {
      const onClick = vi.fn()
      const detail = createMockSegmentDetail()
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'full-doc'

      render(
        <SegmentCard loading={false} detail={detail} onClick={onClick} focused={defaultFocused} />,
      )

      const viewMoreButton = screen.getByRole('button', { name: /viewMore/i })
      await userEvent.setup().click(viewMoreButton)

      expect(onClick).toHaveBeenCalledTimes(1)
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

      const deleteButton = screen.getByRole('button', { name: 'common.operation.delete' })
      await userEvent.setup().click(deleteButton)

      await waitFor(() => {
        expect(screen.getByText('datasetDocuments.segment.delete')).toBeInTheDocument()
      })

      await userEvent.setup().click(screen.getByText('common.operation.sure'))

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledWith('test-segment-id')
      })
    })

    it('should call onChangeSwitch when switch is toggled', async () => {
      const onChangeSwitch = vi.fn().mockResolvedValue(undefined)
      const onClick = vi.fn()
      const detail = createMockSegmentDetail({
        id: 'test-segment-id',
        enabled: true,
        status: 'completed',
      })

      render(
        <SegmentCard
          loading={false}
          detail={detail}
          onChangeSwitch={onChangeSwitch}
          onClick={onClick}
          embeddingAvailable={true}
          focused={defaultFocused}
        />,
      )

      const switchElement = screen.getByRole('switch')
      expect(switchElement).toBeChecked()
      await userEvent.setup().click(switchElement)
      expect(onClick).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(onChangeSwitch).toHaveBeenCalledWith(false, 'test-segment-id')
      })
    })

    it('should stop propagation when edit button is clicked', async () => {
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

      const editButton = screen.getByRole('button', { name: 'common.operation.edit' })
      await userEvent.setup().click(editButton)

      expect(onClickEdit).toHaveBeenCalledTimes(1)
      expect(onClick).not.toHaveBeenCalled()
    })
  })

  // Memoization Logic Tests
  describe('Chunk labels', () => {
    it('labels parent chunks', () => {
      mockDocForm.current = ChunkingMode.parentChild
      const detail = createMockSegmentDetail()

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText(/datasetDocuments\.segment\.parentChunk/i)).toBeInTheDocument()
    })

    it('marks a chunk edited after its creation time', () => {
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
  })

  // Mode-specific Rendering Tests
  describe('Mode-specific Rendering', () => {
    it('should not render status item in full-doc mode', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'full-doc'
      const detail = createMockSegmentDetail()

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // In full-doc mode, status item should not render
      expect(screen.queryByTestId('status-item')).not.toBeInTheDocument()
    })
  })

  // Child Segment List Tests
  describe('Child Segment List', () => {
    it('should render ChildSegmentList when in paragraph mode with child chunks', () => {
      mockDocForm.current = ChunkingMode.parentChild
      mockParentMode.current = 'paragraph'
      const childChunks = [
        createMockChildChunk(),
        createMockChildChunk({ id: 'child-2', position: 2 }),
      ]
      const detail = createMockSegmentDetail({ child_chunks: childChunks })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText(/2 datasetDocuments\.segment\.childChunks/)).toBeInTheDocument()
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
      expect(screen.queryByText(/datasetDocuments\.segment\.childChunks/)).not.toBeInTheDocument()
    })

    it('should call handleAddNewChildChunk when add button is clicked', async () => {
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
      await userEvent.setup().click(addButton)

      expect(handleAddNewChildChunk).toHaveBeenCalledWith('parent-id')
    })
  })

  // Keywords Display Tests
  describe('Keywords Display', () => {
    it('should render keywords with # prefix in general mode', () => {
      mockDocForm.current = ChunkingMode.text
      const detail = createMockSegmentDetail({ keywords: ['keyword1', 'keyword2'] })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('keyword1')).toBeInTheDocument()
      expect(screen.getByText('keyword2')).toBeInTheDocument()
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

  // Images Display Tests
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

  // Edge Cases and Error Handling Tests
  describe('Edge Cases and Error Handling', () => {
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

      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveAttribute('aria-disabled', 'true')
    })

    it('should handle zero word count', () => {
      const detail = createMockSegmentDetail({ word_count: 0 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(
        screen.getByText('0 datasetDocuments.segment.characters:{"count":0}'),
      ).toBeInTheDocument()
    })

    it('should handle zero hit count', () => {
      const detail = createMockSegmentDetail({ hit_count: 0 })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('0 datasetDocuments.segment.hitCount')).toBeInTheDocument()
    })
  })

  // Component Integration Tests

  // All Props Variations Tests
  describe('All Props Variations', () => {
    it('should handle loading transition correctly', () => {
      const detail = createMockSegmentDetail()

      const { rerender } = render(
        <SegmentCard loading={true} detail={detail} focused={defaultFocused} />,
      )

      // When loading, content should not be visible
      expect(screen.queryByText('Test signed content')).not.toBeInTheDocument()

      rerender(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      // ChunkContent shows sign_content first
      expect(screen.getByText('Test signed content')).toBeInTheDocument()
    })
  })

  // ChunkContent QA Mode Tests - cover lines 25-49
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
  })

  // ChunkContent Non-QA Mode Tests - ensure full coverage
  describe('ChunkContent Non-QA Mode', () => {
    it('should fall back to content when sign_content is empty', () => {
      const detail = createMockSegmentDetail({
        content: 'Fallback content',
        sign_content: '',
      })

      render(<SegmentCard loading={false} detail={detail} focused={defaultFocused} />)

      expect(screen.getByText('Fallback content')).toBeInTheDocument()
    })
  })
})

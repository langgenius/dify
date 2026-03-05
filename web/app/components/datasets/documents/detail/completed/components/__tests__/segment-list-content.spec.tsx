import type { SegmentDetailModel } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FullDocModeContent, GeneralModeContent } from '../segment-list-content'

vi.mock('../../child-segment-list', () => ({
  default: ({ parentChunkId }: { parentChunkId: string }) => (
    <div data-testid="child-segment-list">{parentChunkId}</div>
  ),
}))

vi.mock('../../segment-card', () => ({
  default: ({ detail, onClick }: { detail: { id: string }, onClick?: () => void }) => (
    <div data-testid="segment-card" onClick={onClick}>{detail?.id}</div>
  ),
}))

vi.mock('../../segment-list', () => {
  const SegmentList = vi.fn(({ items }: { items: { id: string }[] }) => (
    <div data-testid="segment-list">
      {items?.length ?? 0}
      {' '}
      items
    </div>
  ))
  return { default: SegmentList }
})

describe('FullDocModeContent', () => {
  const defaultProps = {
    segments: [{ id: 'seg-1', position: 1, content: 'test', word_count: 10 }] as SegmentDetailModel[],
    childSegments: [],
    isLoadingSegmentList: false,
    isLoadingChildSegmentList: false,
    currSegmentId: undefined,
    onClickCard: vi.fn(),
    onDeleteChildChunk: vi.fn(),
    handleInputChange: vi.fn(),
    handleAddNewChildChunk: vi.fn(),
    onClickSlice: vi.fn(),
    archived: false,
    childChunkTotal: 0,
    inputValue: '',
    onClearFilter: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render segment card with first segment', () => {
    render(<FullDocModeContent {...defaultProps} />)
    expect(screen.getByTestId('segment-card')).toHaveTextContent('seg-1')
  })

  it('should render child segment list', () => {
    render(<FullDocModeContent {...defaultProps} />)
    expect(screen.getByTestId('child-segment-list')).toHaveTextContent('seg-1')
  })

  it('should apply overflow-y-hidden when loading', () => {
    const { container } = render(
      <FullDocModeContent {...defaultProps} isLoadingSegmentList={true} />,
    )
    expect(container.firstChild).toHaveClass('overflow-y-hidden')
  })

  it('should apply overflow-y-auto when not loading', () => {
    const { container } = render(<FullDocModeContent {...defaultProps} />)
    expect(container.firstChild).toHaveClass('overflow-y-auto')
  })

  it('should call onClickCard with first segment when segment card is clicked', () => {
    const onClickCard = vi.fn()
    render(<FullDocModeContent {...defaultProps} onClickCard={onClickCard} />)
    fireEvent.click(screen.getByTestId('segment-card'))
    expect(onClickCard).toHaveBeenCalledWith(defaultProps.segments[0])
  })
})

describe('GeneralModeContent', () => {
  const defaultProps = {
    segmentListRef: { current: null },
    embeddingAvailable: true,
    isLoadingSegmentList: false,
    segments: [{ id: 'seg-1' }, { id: 'seg-2' }] as SegmentDetailModel[],
    selectedSegmentIds: [],
    onSelected: vi.fn(),
    onChangeSwitch: vi.fn(),
    onDelete: vi.fn(),
    onClickCard: vi.fn(),
    archived: false,
    onDeleteChildChunk: vi.fn(),
    handleAddNewChildChunk: vi.fn(),
    onClickSlice: vi.fn(),
    onClearFilter: vi.fn(),
  }

  it('should render segment list with items', () => {
    render(<GeneralModeContent {...defaultProps} />)
    expect(screen.getByTestId('segment-list')).toHaveTextContent('2 items')
  })
})

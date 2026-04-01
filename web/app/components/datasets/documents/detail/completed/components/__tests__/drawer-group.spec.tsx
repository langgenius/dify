import type { ChildChunkDetail, SegmentDetailModel } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'
import DrawerGroup from '../drawer-group'

vi.mock('../../common/full-screen-drawer', () => ({
  default: ({ isOpen, children }: { isOpen: boolean, children: React.ReactNode }) => (
    isOpen ? <div data-testid="full-screen-drawer">{children}</div> : null
  ),
}))

vi.mock('../../segment-detail', () => ({
  default: () => <div data-testid="segment-detail" />,
}))

vi.mock('../../child-segment-detail', () => ({
  default: () => <div data-testid="child-segment-detail" />,
}))

vi.mock('../../new-child-segment', () => ({
  default: () => <div data-testid="new-child-segment" />,
}))

vi.mock('@/app/components/datasets/documents/detail/new-segment', () => ({
  default: () => <div data-testid="new-segment" />,
}))

describe('DrawerGroup', () => {
  const defaultProps = {
    currSegment: { segInfo: undefined, showModal: false, isEditMode: false },
    onCloseSegmentDetail: vi.fn(),
    onUpdateSegment: vi.fn(),
    isRegenerationModalOpen: false,
    setIsRegenerationModalOpen: vi.fn(),
    showNewSegmentModal: false,
    onCloseNewSegmentModal: vi.fn(),
    onSaveNewSegment: vi.fn(),
    viewNewlyAddedChunk: vi.fn(),
    currChildChunk: { childChunkInfo: undefined, showModal: false },
    currChunkId: 'chunk-1',
    onCloseChildSegmentDetail: vi.fn(),
    onUpdateChildChunk: vi.fn(),
    showNewChildSegmentModal: false,
    onCloseNewChildChunkModal: vi.fn(),
    onSaveNewChildChunk: vi.fn(),
    viewNewlyAddedChildChunk: vi.fn(),
    fullScreen: false,
    docForm: ChunkingMode.text,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render nothing when all modals are closed', () => {
    const { container } = render(<DrawerGroup {...defaultProps} />)
    expect(container.querySelector('[data-testid="full-screen-drawer"]')).toBeNull()
  })

  it('should render segment detail when segment modal is open', () => {
    render(
      <DrawerGroup
        {...defaultProps}
        currSegment={{ segInfo: { id: 'seg-1' } as SegmentDetailModel, showModal: true, isEditMode: true }}
      />,
    )
    expect(screen.getByTestId('segment-detail')).toBeInTheDocument()
  })

  it('should render new segment modal when showNewSegmentModal is true', () => {
    render(
      <DrawerGroup {...defaultProps} showNewSegmentModal={true} />,
    )
    expect(screen.getByTestId('new-segment')).toBeInTheDocument()
  })

  it('should render child segment detail when child chunk modal is open', () => {
    render(
      <DrawerGroup
        {...defaultProps}
        currChildChunk={{ childChunkInfo: { id: 'child-1' } as ChildChunkDetail, showModal: true }}
      />,
    )
    expect(screen.getByTestId('child-segment-detail')).toBeInTheDocument()
  })

  it('should render new child segment modal when showNewChildSegmentModal is true', () => {
    render(
      <DrawerGroup {...defaultProps} showNewChildSegmentModal={true} />,
    )
    expect(screen.getByTestId('new-child-segment')).toBeInTheDocument()
  })

  it('should render multiple drawers simultaneously', () => {
    render(
      <DrawerGroup
        {...defaultProps}
        currSegment={{ segInfo: { id: 'seg-1' } as SegmentDetailModel, showModal: true }}
        showNewChildSegmentModal={true}
      />,
    )
    expect(screen.getByTestId('segment-detail')).toBeInTheDocument()
    expect(screen.getByTestId('new-child-segment')).toBeInTheDocument()
  })
})

import type { ChildChunkDetail, SegmentDetailModel } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useModalState } from '../use-modal-state'

describe('useModalState', () => {
  const onNewSegmentModalChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderUseModalState = () =>
    renderHook(() => useModalState({ onNewSegmentModalChange }))

  it('should initialize with all modals closed', () => {
    const { result } = renderUseModalState()

    expect(result.current.currSegment.showModal).toBe(false)
    expect(result.current.currChildChunk.showModal).toBe(false)
    expect(result.current.showNewChildSegmentModal).toBe(false)
    expect(result.current.isRegenerationModalOpen).toBe(false)
    expect(result.current.fullScreen).toBe(false)
    expect(result.current.isCollapsed).toBe(true)
  })

  it('should open segment detail on card click', () => {
    const { result } = renderUseModalState()
    const detail = { id: 'seg-1', content: 'test' } as unknown as SegmentDetailModel

    act(() => {
      result.current.onClickCard(detail, true)
    })

    expect(result.current.currSegment.showModal).toBe(true)
    expect(result.current.currSegment.segInfo).toBe(detail)
    expect(result.current.currSegment.isEditMode).toBe(true)
  })

  it('should close segment detail and reset fullscreen', () => {
    const { result } = renderUseModalState()

    act(() => {
      result.current.onClickCard({ id: 'seg-1' } as unknown as SegmentDetailModel)
    })
    act(() => {
      result.current.setFullScreen(true)
    })
    act(() => {
      result.current.onCloseSegmentDetail()
    })

    expect(result.current.currSegment.showModal).toBe(false)
    expect(result.current.fullScreen).toBe(false)
  })

  it('should open child segment detail on slice click', () => {
    const { result } = renderUseModalState()
    const childDetail = { id: 'child-1', segment_id: 'seg-1' } as unknown as ChildChunkDetail

    act(() => {
      result.current.onClickSlice(childDetail)
    })

    expect(result.current.currChildChunk.showModal).toBe(true)
    expect(result.current.currChildChunk.childChunkInfo).toBe(childDetail)
    expect(result.current.currChunkId).toBe('seg-1')
  })

  it('should close child segment detail', () => {
    const { result } = renderUseModalState()

    act(() => {
      result.current.onClickSlice({ id: 'c1', segment_id: 's1' } as unknown as ChildChunkDetail)
    })
    act(() => {
      result.current.onCloseChildSegmentDetail()
    })

    expect(result.current.currChildChunk.showModal).toBe(false)
  })

  it('should handle new child chunk modal', () => {
    const { result } = renderUseModalState()

    act(() => {
      result.current.handleAddNewChildChunk('parent-chunk-1')
    })

    expect(result.current.showNewChildSegmentModal).toBe(true)
    expect(result.current.currChunkId).toBe('parent-chunk-1')

    act(() => {
      result.current.onCloseNewChildChunkModal()
    })

    expect(result.current.showNewChildSegmentModal).toBe(false)
  })

  it('should close new segment modal and notify parent', () => {
    const { result } = renderUseModalState()

    act(() => {
      result.current.onCloseNewSegmentModal()
    })

    expect(onNewSegmentModalChange).toHaveBeenCalledWith(false)
  })

  it('should toggle full screen', () => {
    const { result } = renderUseModalState()

    act(() => {
      result.current.toggleFullScreen()
    })
    expect(result.current.fullScreen).toBe(true)

    act(() => {
      result.current.toggleFullScreen()
    })
    expect(result.current.fullScreen).toBe(false)
  })

  it('should toggle collapsed', () => {
    const { result } = renderUseModalState()

    act(() => {
      result.current.toggleCollapsed()
    })
    expect(result.current.isCollapsed).toBe(false)

    act(() => {
      result.current.toggleCollapsed()
    })
    expect(result.current.isCollapsed).toBe(true)
  })

  it('should set regeneration modal state', () => {
    const { result } = renderUseModalState()

    act(() => {
      result.current.setIsRegenerationModalOpen(true)
    })
    expect(result.current.isRegenerationModalOpen).toBe(true)
  })
})

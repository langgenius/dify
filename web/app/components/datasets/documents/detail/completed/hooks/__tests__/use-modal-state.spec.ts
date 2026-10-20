import type {
  ChildChunkResponse,
  SegmentResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import * as modalStateHooks from '../use-modal-state'

const childChunk: ChildChunkResponse = {
  id: 'child-1',
  segment_id: 'segment-1',
  position: 1,
  content: 'Child chunk content',
  word_count: 19,
  created_at: 1700000000,
  updated_at: 1700000000,
  type: 'automatic',
}

const segment: SegmentResponse = {
  id: 'segment-1',
  document_id: 'document-1',
  position: 1,
  content: 'Chunk content',
  sign_content: '',
  word_count: 13,
  tokens: 3,
  keywords: [],
  index_node_id: 'index-1',
  index_node_hash: 'hash-1',
  hit_count: 0,
  enabled: true,
  disabled_at: 0,
  disabled_by: '',
  status: 'completed',
  created_by: 'user-1',
  created_at: 1700000000,
  indexing_at: 1700000000,
  completed_at: 1700000000,
  error: null,
  stopped_at: 0,
  answer: null,
  summary: null,
  updated_by: null,
  updated_at: 1700000000,
  attachments: [],
  child_chunks: [childChunk],
}

const renderDatasetModalState = modalStateHooks.useModalState

describe('useModalState', () => {
  const onNewSegmentModalChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderModalState = () =>
    renderHook(() => renderDatasetModalState({ onNewSegmentModalChange }))

  it('should close child detail when opening segment detail', () => {
    const { result } = renderModalState()
    const childDetail = childChunk
    const segmentDetail = segment

    act(() => {
      result.current.onClickSlice(childDetail)
    })
    act(() => {
      result.current.onClickCard(segmentDetail)
    })

    expect(result.current.currSegment.showModal).toBe(true)
    expect(result.current.currSegment.segInfo).toEqual(segmentDetail)
    expect(result.current.currChildChunk.showModal).toBe(false)
  })

  it('should close segment detail and reset fullscreen', () => {
    const { result } = renderModalState()

    act(() => {
      result.current.onClickCard(segment)
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

  it('should close segment detail when opening child detail', () => {
    const { result } = renderModalState()
    const segmentDetail = segment
    const childDetail = childChunk

    act(() => {
      result.current.onClickCard(segmentDetail)
    })
    act(() => {
      result.current.onClickSlice(childDetail)
    })

    expect(result.current.currSegment.showModal).toBe(false)
    expect(result.current.currChildChunk.showModal).toBe(true)
    expect(result.current.currChildChunk.childChunkInfo).toEqual(childDetail)
  })

  it('should handle new child chunk modal', () => {
    const { result } = renderModalState()

    act(() => {
      result.current.handleAddNewChildChunk('parent-chunk-1')
    })

    expect(result.current.showNewChildSegmentModal).toBe(true)
    expect(result.current.currChunkId).toBe('parent-chunk-1')

    act(() => {
      result.current.setFullScreen(true)
    })
    act(() => {
      result.current.onCloseNewChildChunkModal()
    })

    expect(result.current.showNewChildSegmentModal).toBe(false)
    expect(result.current.fullScreen).toBe(false)
  })

  it('should close new segment modal and notify parent', () => {
    const { result } = renderModalState()

    act(() => {
      result.current.onCloseNewSegmentModal()
    })

    expect(onNewSegmentModalChange).toHaveBeenCalledWith(false)
  })
})

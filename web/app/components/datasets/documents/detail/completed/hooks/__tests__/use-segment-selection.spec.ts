import type { SegmentDetailModel } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSegmentSelection } from '../use-segment-selection'

describe('useSegmentSelection', () => {
  const segments = [
    { id: 'seg-1', content: 'A' },
    { id: 'seg-2', content: 'B' },
    { id: 'seg-3', content: 'C' },
  ] as unknown as SegmentDetailModel[]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with empty selection', () => {
    const { result } = renderHook(() => useSegmentSelection(segments))

    expect(result.current.selectedSegmentIds).toEqual([])
    expect(result.current.isAllSelected).toBe(false)
    expect(result.current.isSomeSelected).toBe(false)
  })

  it('should select a segment', () => {
    const { result } = renderHook(() => useSegmentSelection(segments))

    act(() => {
      result.current.onSelected('seg-1')
    })

    expect(result.current.selectedSegmentIds).toEqual(['seg-1'])
    expect(result.current.isSomeSelected).toBe(true)
    expect(result.current.isAllSelected).toBe(false)
  })

  it('should deselect a selected segment', () => {
    const { result } = renderHook(() => useSegmentSelection(segments))

    act(() => {
      result.current.onSelected('seg-1')
    })
    act(() => {
      result.current.onSelected('seg-1')
    })

    expect(result.current.selectedSegmentIds).toEqual([])
  })

  it('should select all segments', () => {
    const { result } = renderHook(() => useSegmentSelection(segments))

    act(() => {
      result.current.onSelectedAll()
    })

    expect(result.current.selectedSegmentIds).toEqual(['seg-1', 'seg-2', 'seg-3'])
    expect(result.current.isAllSelected).toBe(true)
  })

  it('should deselect all when all are selected', () => {
    const { result } = renderHook(() => useSegmentSelection(segments))

    act(() => {
      result.current.onSelectedAll()
    })
    act(() => {
      result.current.onSelectedAll()
    })

    expect(result.current.selectedSegmentIds).toEqual([])
    expect(result.current.isAllSelected).toBe(false)
  })

  it('should cancel batch operation', () => {
    const { result } = renderHook(() => useSegmentSelection(segments))

    act(() => {
      result.current.onSelected('seg-1')
      result.current.onSelected('seg-2')
    })
    act(() => {
      result.current.onCancelBatchOperation()
    })

    expect(result.current.selectedSegmentIds).toEqual([])
  })

  it('should clear selection', () => {
    const { result } = renderHook(() => useSegmentSelection(segments))

    act(() => {
      result.current.onSelected('seg-1')
    })
    act(() => {
      result.current.clearSelection()
    })

    expect(result.current.selectedSegmentIds).toEqual([])
  })

  it('should handle empty segments array', () => {
    const { result } = renderHook(() => useSegmentSelection([]))

    expect(result.current.isAllSelected).toBe(false)
    expect(result.current.isSomeSelected).toBe(false)
  })

  it('should allow multiple selections', () => {
    const { result } = renderHook(() => useSegmentSelection(segments))

    act(() => {
      result.current.onSelected('seg-1')
    })
    act(() => {
      result.current.onSelected('seg-2')
    })

    expect(result.current.selectedSegmentIds).toEqual(['seg-1', 'seg-2'])
    expect(result.current.isSomeSelected).toBe(true)
    expect(result.current.isAllSelected).toBe(false)
  })

  it('should preserve selection of segments not in current list', () => {
    const { result, rerender } = renderHook(
      ({ segs }) => useSegmentSelection(segs),
      { initialProps: { segs: segments } },
    )

    act(() => {
      result.current.onSelected('seg-1')
    })

    // Rerender with different segment list (simulating page change)
    const newSegments = [
      { id: 'seg-4', content: 'D' },
      { id: 'seg-5', content: 'E' },
    ] as unknown as SegmentDetailModel[]

    rerender({ segs: newSegments })

    // Previously selected segment should still be in selectedSegmentIds
    expect(result.current.selectedSegmentIds).toContain('seg-1')
  })

  it('should select remaining unselected segments when onSelectedAll is called with partial selection', () => {
    const { result } = renderHook(() => useSegmentSelection(segments))

    act(() => {
      result.current.onSelected('seg-1')
    })
    act(() => {
      result.current.onSelectedAll()
    })

    expect(result.current.selectedSegmentIds).toEqual(expect.arrayContaining(['seg-1', 'seg-2', 'seg-3']))
    expect(result.current.isAllSelected).toBe(true)
  })
})

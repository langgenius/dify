import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeCurrentPageSelectedSegmentIds, useSegmentSelection } from '../use-segment-selection'

describe('useSegmentSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with empty selection', () => {
    const { result } = renderHook(() => useSegmentSelection())

    expect(result.current.selectedSegmentIds).toEqual([])
  })

  it('should update selected segment ids', () => {
    const { result } = renderHook(() => useSegmentSelection())

    act(() => {
      result.current.onSelectedSegmentIdsChange(['seg-1', 'seg-2'])
    })

    expect(result.current.selectedSegmentIds).toEqual(['seg-1', 'seg-2'])
  })

  it('should cancel batch operation', () => {
    const { result } = renderHook(() => useSegmentSelection())

    act(() => {
      result.current.onSelectedSegmentIdsChange(['seg-1'])
    })
    act(() => {
      result.current.onCancelBatchOperation()
    })

    expect(result.current.selectedSegmentIds).toEqual([])
  })

  it('should clear selection', () => {
    const { result } = renderHook(() => useSegmentSelection())

    act(() => {
      result.current.onSelectedSegmentIdsChange(['seg-1'])
    })
    act(() => {
      result.current.clearSelection()
    })

    expect(result.current.selectedSegmentIds).toEqual([])
  })

  it('should merge current page selection without dropping selected ids from other pages', () => {
    expect(mergeCurrentPageSelectedSegmentIds({
      selectedSegmentIds: ['page-1-a', 'page-1-b'],
      currentPageSegmentIds: ['page-2-a', 'page-2-b'],
      nextCurrentPageSelectedSegmentIds: ['page-2-a'],
    })).toEqual(['page-1-a', 'page-1-b', 'page-2-a'])
  })

  it('should replace only current page selected ids when current page selection changes', () => {
    expect(mergeCurrentPageSelectedSegmentIds({
      selectedSegmentIds: ['page-1-a', 'page-2-a', 'page-2-b'],
      currentPageSegmentIds: ['page-2-a', 'page-2-b'],
      nextCurrentPageSelectedSegmentIds: ['page-2-b'],
    })).toEqual(['page-1-a', 'page-2-b'])
  })
})

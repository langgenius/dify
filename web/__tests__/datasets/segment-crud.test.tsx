/**
 * Integration Test: Segment CRUD Flow
 *
 * Tests segment selection, search/filter, and modal state management across hooks.
 * Validates cross-hook data contracts in the completed segment module.
 */

import type { SegmentDetailModel } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useModalState } from '@/app/components/datasets/documents/detail/completed/hooks/use-modal-state'
import { useSearchFilter } from '@/app/components/datasets/documents/detail/completed/hooks/use-search-filter'
import { useSegmentSelection } from '@/app/components/datasets/documents/detail/completed/hooks/use-segment-selection'

const createSegment = (id: string, content = 'Test segment content'): SegmentDetailModel =>
  ({
    id,
    position: 1,
    document_id: 'doc-1',
    content,
    sign_content: content,
    answer: '',
    word_count: 50,
    tokens: 25,
    keywords: ['test'],
    index_node_id: 'idx-1',
    index_node_hash: 'hash-1',
    hit_count: 0,
    enabled: true,
    disabled_at: 0,
    disabled_by: '',
    status: 'completed',
    created_by: 'user-1',
    created_at: Date.now(),
    indexing_at: Date.now(),
    completed_at: Date.now(),
    error: null,
    stopped_at: 0,
    updated_at: Date.now(),
    attachments: [],
  }) as SegmentDetailModel

describe('Segment CRUD Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Search and Filter → Segment List Query', () => {
    it('should manage search input with debounce', () => {
      vi.useFakeTimers()
      const onPageChange = vi.fn()
      const { result } = renderHook(() => useSearchFilter({ onPageChange }))

      act(() => {
        result.current.handleInputChange('keyword')
      })

      expect(result.current.inputValue).toBe('keyword')
      expect(result.current.searchValue).toBe('')

      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(result.current.searchValue).toBe('keyword')
      expect(onPageChange).toHaveBeenCalledWith(1)

      vi.useRealTimers()
    })

    it('should manage status filter state', () => {
      const onPageChange = vi.fn()
      const { result } = renderHook(() => useSearchFilter({ onPageChange }))

      // status value 1 maps to !!1 = true (enabled)
      act(() => {
        result.current.onChangeStatus({ value: 1, name: 'enabled' })
      })
      // onChangeStatus converts: value === 'all' ? 'all' : !!value
      expect(result.current.selectedStatus).toBe(true)

      act(() => {
        result.current.onClearFilter()
      })
      expect(result.current.selectedStatus).toBe('all')
      expect(result.current.inputValue).toBe('')
    })

    it('should provide status list for filter dropdown', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: vi.fn() }))
      expect(result.current.statusList).toBeInstanceOf(Array)
      expect(result.current.statusList.length).toBe(3) // all, disabled, enabled
    })

    it('should compute selectDefaultValue based on selectedStatus', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: vi.fn() }))

      // Initial state: 'all'
      expect(result.current.selectDefaultValue).toBe('all')

      // Set to enabled (true)
      act(() => {
        result.current.onChangeStatus({ value: 1, name: 'enabled' })
      })
      expect(result.current.selectDefaultValue).toBe(1)

      // Set to disabled (false)
      act(() => {
        result.current.onChangeStatus({ value: 0, name: 'disabled' })
      })
      expect(result.current.selectDefaultValue).toBe(0)
    })
  })

  describe('Segment Selection → Batch Operations', () => {
    it('should manage individual segment selection', () => {
      const { result } = renderHook(() => useSegmentSelection())

      act(() => {
        result.current.onSelectedSegmentIdsChange(['seg-1'])
      })
      expect(result.current.selectedSegmentIds).toContain('seg-1')

      act(() => {
        result.current.onSelectedSegmentIdsChange(['seg-1', 'seg-2'])
      })
      expect(result.current.selectedSegmentIds).toContain('seg-1')
      expect(result.current.selectedSegmentIds).toContain('seg-2')
      expect(result.current.selectedSegmentIds).toHaveLength(2)
    })

    it('should clear selection via onCancelBatchOperation', () => {
      const { result } = renderHook(() => useSegmentSelection())

      act(() => {
        result.current.onSelectedSegmentIdsChange(['seg-1', 'seg-2'])
      })
      expect(result.current.selectedSegmentIds).toHaveLength(2)

      act(() => {
        result.current.onCancelBatchOperation()
      })
      expect(result.current.selectedSegmentIds).toHaveLength(0)
    })
  })

  describe('Modal State Management', () => {
    const onNewSegmentModalChange = vi.fn()

    it('should open segment detail modal on card click', () => {
      const { result } = renderHook(() => useModalState({ onNewSegmentModalChange }))

      const segment = createSegment('seg-detail-1', 'Detail content')
      act(() => {
        result.current.onClickCard(segment)
      })
      expect(result.current.currSegment.showModal).toBe(true)
      expect(result.current.currSegment.segInfo).toBeDefined()
      expect(result.current.currSegment.segInfo!.id).toBe('seg-detail-1')
    })

    it('should close segment detail modal', () => {
      const { result } = renderHook(() => useModalState({ onNewSegmentModalChange }))

      const segment = createSegment('seg-1')
      act(() => {
        result.current.onClickCard(segment)
      })
      expect(result.current.currSegment.showModal).toBe(true)

      act(() => {
        result.current.onCloseSegmentDetail()
      })
      expect(result.current.currSegment.showModal).toBe(false)
    })

    it('should manage full screen toggle', () => {
      const { result } = renderHook(() => useModalState({ onNewSegmentModalChange }))

      expect(result.current.fullScreen).toBe(false)
      act(() => {
        result.current.toggleFullScreen()
      })
      expect(result.current.fullScreen).toBe(true)
      act(() => {
        result.current.toggleFullScreen()
      })
      expect(result.current.fullScreen).toBe(false)
    })

    it('should manage collapsed state', () => {
      const { result } = renderHook(() => useModalState({ onNewSegmentModalChange }))

      expect(result.current.isCollapsed).toBe(true)
      act(() => {
        result.current.toggleCollapsed()
      })
      expect(result.current.isCollapsed).toBe(false)
    })

    it('should manage new child segment modal', () => {
      const { result } = renderHook(() => useModalState({ onNewSegmentModalChange }))

      expect(result.current.showNewChildSegmentModal).toBe(false)
      act(() => {
        result.current.handleAddNewChildChunk('chunk-parent-1')
      })
      expect(result.current.showNewChildSegmentModal).toBe(true)
      expect(result.current.currChunkId).toBe('chunk-parent-1')

      act(() => {
        result.current.onCloseNewChildChunkModal()
      })
      expect(result.current.showNewChildSegmentModal).toBe(false)
    })
  })

  describe('Cross-Hook Data Flow: Search → Selection → Modal', () => {
    it('should maintain independent state across all three hooks', () => {
      const segments = [createSegment('seg-1'), createSegment('seg-2')]

      const { result: filterResult } = renderHook(() => useSearchFilter({ onPageChange: vi.fn() }))
      const { result: selectionResult } = renderHook(() => useSegmentSelection())
      const { result: modalResult } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: vi.fn() }),
      )

      // Set search filter to enabled
      act(() => {
        filterResult.current.onChangeStatus({ value: 1, name: 'enabled' })
      })

      // Select a segment
      act(() => {
        selectionResult.current.onSelectedSegmentIdsChange(['seg-1'])
      })

      // Open detail modal
      act(() => {
        modalResult.current.onClickCard(segments[0]!)
      })

      // All states should be independent
      expect(filterResult.current.selectedStatus).toBe(true) // !!1
      expect(selectionResult.current.selectedSegmentIds).toContain('seg-1')
      expect(modalResult.current.currSegment.showModal).toBe(true)
    })
  })
})

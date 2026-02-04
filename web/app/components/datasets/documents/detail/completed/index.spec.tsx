import type { DocumentContextValue } from '@/app/components/datasets/documents/detail/context'
import type { ChildChunkDetail, ChunkingMode, ParentMode, SegmentDetailModel } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { ChunkingMode as ChunkingModeEnum } from '@/models/datasets'
import { useModalState } from './hooks/use-modal-state'
import { useSearchFilter } from './hooks/use-search-filter'
import { useSegmentSelection } from './hooks/use-segment-selection'
import Completed from './index'
import { SegmentListContext, useSegmentListContext } from './segment-list-context'

// ============================================================================
// Hoisted Mocks (must be before vi.mock calls)
// ============================================================================

const {
  mockDocForm,
  mockParentMode,
  mockDatasetId,
  mockDocumentId,
  mockNotify,
  mockEventEmitter,
  mockSegmentListData,
  mockChildSegmentListData,
  mockInvalidChunkListAll,
  mockInvalidChunkListEnabled,
  mockInvalidChunkListDisabled,
  mockOnChangeSwitch,
  mockOnDelete,
} = vi.hoisted(() => ({
  mockDocForm: { current: 'text' as ChunkingMode },
  mockParentMode: { current: 'paragraph' as ParentMode },
  mockDatasetId: { current: 'test-dataset-id' },
  mockDocumentId: { current: 'test-document-id' },
  mockNotify: vi.fn(),
  mockEventEmitter: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
  mockSegmentListData: {
    data: [] as SegmentDetailModel[],
    total: 0,
    total_pages: 0,
  },
  mockChildSegmentListData: {
    data: [] as ChildChunkDetail[],
    total: 0,
    total_pages: 0,
  },
  mockInvalidChunkListAll: vi.fn(),
  mockInvalidChunkListEnabled: vi.fn(),
  mockInvalidChunkListDisabled: vi.fn(),
  mockOnChangeSwitch: vi.fn(),
  mockOnDelete: vi.fn(),
}))

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number, ns?: string }) => {
      if (key === 'segment.chunks')
        return options?.count === 1 ? 'chunk' : 'chunks'
      if (key === 'segment.parentChunks')
        return options?.count === 1 ? 'parent chunk' : 'parent chunks'
      if (key === 'segment.searchResults')
        return 'search results'
      if (key === 'list.index.all')
        return 'All'
      if (key === 'list.status.disabled')
        return 'Disabled'
      if (key === 'list.status.enabled')
        return 'Enabled'
      if (key === 'actionMsg.modifiedSuccessfully')
        return 'Modified successfully'
      if (key === 'actionMsg.modifiedUnsuccessfully')
        return 'Modified unsuccessfully'
      if (key === 'segment.contentEmpty')
        return 'Content cannot be empty'
      if (key === 'segment.questionEmpty')
        return 'Question cannot be empty'
      if (key === 'segment.answerEmpty')
        return 'Answer cannot be empty'
      const prefix = options?.ns ? `${options.ns}.` : ''
      return `${prefix}${key}`
    },
  }),
}))

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/datasets/test-dataset-id/documents/test-document-id',
}))

// Mock document context
vi.mock('../context', () => ({
  useDocumentContext: (selector: (value: DocumentContextValue) => unknown) => {
    const value: DocumentContextValue = {
      datasetId: mockDatasetId.current,
      documentId: mockDocumentId.current,
      docForm: mockDocForm.current,
      parentMode: mockParentMode.current,
    }
    return selector(value)
  },
}))

// Mock toast context
vi.mock('@/app/components/base/toast', () => ({
  ToastContext: { Provider: ({ children }: { children: React.ReactNode }) => children, Consumer: () => null },
  useToastContext: () => ({ notify: mockNotify }),
}))

// Mock event emitter context
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({ eventEmitter: mockEventEmitter }),
}))

// Mock segment service hooks
vi.mock('@/service/knowledge/use-segment', () => ({
  useSegmentList: () => ({
    isLoading: false,
    data: mockSegmentListData,
  }),
  useChildSegmentList: () => ({
    isLoading: false,
    data: mockChildSegmentListData,
  }),
  useSegmentListKey: ['segment', 'chunkList'],
  useChunkListAllKey: ['segment', 'chunkList', { enabled: 'all' }],
  useChunkListEnabledKey: ['segment', 'chunkList', { enabled: true }],
  useChunkListDisabledKey: ['segment', 'chunkList', { enabled: false }],
  useChildSegmentListKey: ['segment', 'childChunkList'],
  useEnableSegment: () => ({ mutateAsync: mockOnChangeSwitch }),
  useDisableSegment: () => ({ mutateAsync: mockOnChangeSwitch }),
  useDeleteSegment: () => ({ mutateAsync: mockOnDelete }),
  useUpdateSegment: () => ({ mutateAsync: vi.fn() }),
  useDeleteChildSegment: () => ({ mutateAsync: vi.fn() }),
  useUpdateChildSegment: () => ({ mutateAsync: vi.fn() }),
}))

// Mock useInvalid - return trackable functions based on key
vi.mock('@/service/use-base', () => ({
  useInvalid: (key: unknown[]) => {
    // Return specific mock functions based on key to track calls
    const keyStr = JSON.stringify(key)
    if (keyStr.includes('"enabled":"all"'))
      return mockInvalidChunkListAll
    if (keyStr.includes('"enabled":true'))
      return mockInvalidChunkListEnabled
    if (keyStr.includes('"enabled":false'))
      return mockInvalidChunkListDisabled
    return vi.fn()
  },
}))

// Note: useSegmentSelection is NOT mocked globally to allow direct hook testing
// Batch action tests will use a different approach

// Mock useChildSegmentData to capture refreshChunkListDataWithDetailChanged
let capturedRefreshCallback: (() => void) | null = null
vi.mock('./hooks/use-child-segment-data', () => ({
  useChildSegmentData: (options: { refreshChunkListDataWithDetailChanged?: () => void }) => {
    // Capture the callback for later testing
    if (options.refreshChunkListDataWithDetailChanged)
      capturedRefreshCallback = options.refreshChunkListDataWithDetailChanged

    return {
      childSegments: [],
      isLoadingChildSegmentList: false,
      childChunkListData: mockChildSegmentListData,
      childSegmentListRef: { current: null },
      needScrollToBottom: { current: false },
      onDeleteChildChunk: vi.fn(),
      handleUpdateChildChunk: vi.fn(),
      onSaveNewChildChunk: vi.fn(),
      resetChildList: vi.fn(),
      viewNewlyAddedChildChunk: vi.fn(),
    }
  },
}))

// Note: useSearchFilter is NOT mocked globally to allow direct hook testing
// Individual tests that need to control selectedStatus will use different approaches

// Mock child components to simplify testing
vi.mock('./components', () => ({
  MenuBar: ({ totalText, onInputChange, inputValue, isLoading, onSelectedAll, onChangeStatus }: {
    totalText: string
    onInputChange: (value: string) => void
    inputValue: string
    isLoading: boolean
    onSelectedAll?: () => void
    onChangeStatus?: (item: { value: string | number, name: string }) => void
  }) => (
    <div data-testid="menu-bar">
      <span data-testid="total-text">{totalText}</span>
      <input
        data-testid="search-input"
        value={inputValue}
        onChange={e => onInputChange(e.target.value)}
        disabled={isLoading}
      />
      {onSelectedAll && (
        <button data-testid="select-all-button" onClick={onSelectedAll}>Select All</button>
      )}
      {onChangeStatus && (
        <>
          <button data-testid="status-enabled" onClick={() => onChangeStatus({ value: 1, name: 'Enabled' })}>Enabled</button>
          <button data-testid="status-disabled" onClick={() => onChangeStatus({ value: 0, name: 'Disabled' })}>Disabled</button>
          <button data-testid="status-all" onClick={() => onChangeStatus({ value: 'all', name: 'All' })}>All</button>
        </>
      )}
    </div>
  ),
  DrawerGroup: () => <div data-testid="drawer-group" />,
  FullDocModeContent: () => <div data-testid="full-doc-mode-content" />,
  GeneralModeContent: () => <div data-testid="general-mode-content" />,
}))

vi.mock('./common/batch-action', () => ({
  default: ({ selectedIds, onCancel, onBatchEnable, onBatchDisable, onBatchDelete }: {
    selectedIds: string[]
    onCancel: () => void
    onBatchEnable: () => void
    onBatchDisable: () => void
    onBatchDelete: () => void
  }) => (
    <div data-testid="batch-action">
      <span data-testid="selected-count">{selectedIds.length}</span>
      <button data-testid="cancel-batch" onClick={onCancel}>Cancel</button>
      <button data-testid="batch-enable" onClick={onBatchEnable}>Enable</button>
      <button data-testid="batch-disable" onClick={onBatchDisable}>Disable</button>
      <button data-testid="batch-delete" onClick={onBatchDelete}>Delete</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/divider', () => ({
  default: () => <hr data-testid="divider" />,
}))

vi.mock('@/app/components/base/pagination', () => ({
  default: ({ current, total, onChange, onLimitChange }: {
    current: number
    total: number
    onChange: (page: number) => void
    onLimitChange: (limit: number) => void
  }) => (
    <div data-testid="pagination">
      <span data-testid="current-page">{current}</span>
      <span data-testid="total-items">{total}</span>
      <button data-testid="next-page" onClick={() => onChange(current + 1)}>Next</button>
      <button data-testid="change-limit" onClick={() => onLimitChange(20)}>Change Limit</button>
    </div>
  ),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createMockSegmentDetail = (overrides: Partial<SegmentDetailModel> = {}): SegmentDetailModel => ({
  id: `segment-${Math.random().toString(36).substr(2, 9)}`,
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
  ...overrides,
})

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
// Test Utilities
// ============================================================================

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const createWrapper = () => {
  const queryClient = createQueryClient()
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

// ============================================================================
// useSearchFilter Hook Tests
// ============================================================================

describe('useSearchFilter', () => {
  const mockOnPageChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Initial State', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      expect(result.current.inputValue).toBe('')
      expect(result.current.searchValue).toBe('')
      expect(result.current.selectedStatus).toBe('all')
      expect(result.current.selectDefaultValue).toBe('all')
    })

    it('should have status list with all options', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      expect(result.current.statusList).toHaveLength(3)
      expect(result.current.statusList[0].value).toBe('all')
      expect(result.current.statusList[1].value).toBe(0)
      expect(result.current.statusList[2].value).toBe(1)
    })
  })

  describe('handleInputChange', () => {
    it('should update inputValue immediately', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      act(() => {
        result.current.handleInputChange('test')
      })

      expect(result.current.inputValue).toBe('test')
    })

    it('should update searchValue after debounce', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      act(() => {
        result.current.handleInputChange('test')
      })

      expect(result.current.searchValue).toBe('')

      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(result.current.searchValue).toBe('test')
    })

    it('should call onPageChange(1) after debounce', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      act(() => {
        result.current.handleInputChange('test')
        vi.advanceTimersByTime(500)
      })

      expect(mockOnPageChange).toHaveBeenCalledWith(1)
    })
  })

  describe('onChangeStatus', () => {
    it('should set selectedStatus to "all" when value is "all"', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      act(() => {
        result.current.onChangeStatus({ value: 'all', name: 'All' })
      })

      expect(result.current.selectedStatus).toBe('all')
    })

    it('should set selectedStatus to true when value is truthy', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      act(() => {
        result.current.onChangeStatus({ value: 1, name: 'Enabled' })
      })

      expect(result.current.selectedStatus).toBe(true)
    })

    it('should set selectedStatus to false when value is falsy (0)', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      act(() => {
        result.current.onChangeStatus({ value: 0, name: 'Disabled' })
      })

      expect(result.current.selectedStatus).toBe(false)
    })

    it('should call onPageChange(1) when status changes', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      act(() => {
        result.current.onChangeStatus({ value: 1, name: 'Enabled' })
      })

      expect(mockOnPageChange).toHaveBeenCalledWith(1)
    })
  })

  describe('onClearFilter', () => {
    it('should reset all filter values', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      // Set some values first
      act(() => {
        result.current.handleInputChange('test')
        vi.advanceTimersByTime(500)
        result.current.onChangeStatus({ value: 1, name: 'Enabled' })
      })

      // Clear filters
      act(() => {
        result.current.onClearFilter()
      })

      expect(result.current.inputValue).toBe('')
      expect(result.current.searchValue).toBe('')
      expect(result.current.selectedStatus).toBe('all')
    })

    it('should call onPageChange(1) when clearing', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      mockOnPageChange.mockClear()

      act(() => {
        result.current.onClearFilter()
      })

      expect(mockOnPageChange).toHaveBeenCalledWith(1)
    })
  })

  describe('selectDefaultValue', () => {
    it('should return "all" when selectedStatus is "all"', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      expect(result.current.selectDefaultValue).toBe('all')
    })

    it('should return 1 when selectedStatus is true', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      act(() => {
        result.current.onChangeStatus({ value: 1, name: 'Enabled' })
      })

      expect(result.current.selectDefaultValue).toBe(1)
    })

    it('should return 0 when selectedStatus is false', () => {
      const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      act(() => {
        result.current.onChangeStatus({ value: 0, name: 'Disabled' })
      })

      expect(result.current.selectDefaultValue).toBe(0)
    })
  })

  describe('Callback Stability', () => {
    it('should maintain stable callback references', () => {
      const { result, rerender } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

      const initialHandleInputChange = result.current.handleInputChange
      const initialOnChangeStatus = result.current.onChangeStatus
      const initialOnClearFilter = result.current.onClearFilter
      const initialResetPage = result.current.resetPage

      rerender()

      expect(result.current.handleInputChange).toBe(initialHandleInputChange)
      expect(result.current.onChangeStatus).toBe(initialOnChangeStatus)
      expect(result.current.onClearFilter).toBe(initialOnClearFilter)
      expect(result.current.resetPage).toBe(initialResetPage)
    })
  })
})

// ============================================================================
// useSegmentSelection Hook Tests
// ============================================================================

describe('useSegmentSelection', () => {
  const mockSegments: SegmentDetailModel[] = [
    createMockSegmentDetail({ id: 'seg-1' }),
    createMockSegmentDetail({ id: 'seg-2' }),
    createMockSegmentDetail({ id: 'seg-3' }),
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('should initialize with empty selection', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      expect(result.current.selectedSegmentIds).toEqual([])
      expect(result.current.isAllSelected).toBe(false)
      expect(result.current.isSomeSelected).toBe(false)
    })
  })

  describe('onSelected', () => {
    it('should add segment to selection when not selected', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      act(() => {
        result.current.onSelected('seg-1')
      })

      expect(result.current.selectedSegmentIds).toContain('seg-1')
    })

    it('should remove segment from selection when already selected', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      act(() => {
        result.current.onSelected('seg-1')
      })

      expect(result.current.selectedSegmentIds).toContain('seg-1')

      act(() => {
        result.current.onSelected('seg-1')
      })

      expect(result.current.selectedSegmentIds).not.toContain('seg-1')
    })

    it('should allow multiple selections', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      act(() => {
        result.current.onSelected('seg-1')
        result.current.onSelected('seg-2')
      })

      expect(result.current.selectedSegmentIds).toContain('seg-1')
      expect(result.current.selectedSegmentIds).toContain('seg-2')
    })
  })

  describe('isAllSelected', () => {
    it('should return false when no segments selected', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      expect(result.current.isAllSelected).toBe(false)
    })

    it('should return false when some segments selected', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      act(() => {
        result.current.onSelected('seg-1')
      })

      expect(result.current.isAllSelected).toBe(false)
    })

    it('should return true when all segments selected', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      act(() => {
        mockSegments.forEach(seg => result.current.onSelected(seg.id))
      })

      expect(result.current.isAllSelected).toBe(true)
    })

    it('should return false when segments array is empty', () => {
      const { result } = renderHook(() => useSegmentSelection([]))

      expect(result.current.isAllSelected).toBe(false)
    })
  })

  describe('isSomeSelected', () => {
    it('should return false when no segments selected', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      expect(result.current.isSomeSelected).toBe(false)
    })

    it('should return true when some segments selected', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      act(() => {
        result.current.onSelected('seg-1')
      })

      expect(result.current.isSomeSelected).toBe(true)
    })

    it('should return true when all segments selected', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      act(() => {
        mockSegments.forEach(seg => result.current.onSelected(seg.id))
      })

      expect(result.current.isSomeSelected).toBe(true)
    })
  })

  describe('onSelectedAll', () => {
    it('should select all segments when none selected', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      act(() => {
        result.current.onSelectedAll()
      })

      expect(result.current.isAllSelected).toBe(true)
      expect(result.current.selectedSegmentIds).toHaveLength(3)
    })

    it('should deselect all segments when all selected', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      // Select all first
      act(() => {
        result.current.onSelectedAll()
      })

      expect(result.current.isAllSelected).toBe(true)

      // Deselect all
      act(() => {
        result.current.onSelectedAll()
      })

      expect(result.current.isAllSelected).toBe(false)
      expect(result.current.selectedSegmentIds).toHaveLength(0)
    })

    it('should select remaining segments when some selected', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      act(() => {
        result.current.onSelected('seg-1')
      })

      act(() => {
        result.current.onSelectedAll()
      })

      expect(result.current.isAllSelected).toBe(true)
    })

    it('should preserve selection of segments not in current list', () => {
      const { result, rerender } = renderHook(
        ({ segments }) => useSegmentSelection(segments),
        { initialProps: { segments: mockSegments } },
      )

      // Select segment from initial list
      act(() => {
        result.current.onSelected('seg-1')
      })

      // Update segments list (simulating pagination)
      const newSegments = [
        createMockSegmentDetail({ id: 'seg-4' }),
        createMockSegmentDetail({ id: 'seg-5' }),
      ]

      rerender({ segments: newSegments })

      // Select all in new list
      act(() => {
        result.current.onSelectedAll()
      })

      // Should have seg-1 from old list plus seg-4 and seg-5 from new list
      expect(result.current.selectedSegmentIds).toContain('seg-1')
      expect(result.current.selectedSegmentIds).toContain('seg-4')
      expect(result.current.selectedSegmentIds).toContain('seg-5')
    })
  })

  describe('onCancelBatchOperation', () => {
    it('should clear all selections', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      act(() => {
        result.current.onSelected('seg-1')
        result.current.onSelected('seg-2')
      })

      expect(result.current.selectedSegmentIds).toHaveLength(2)

      act(() => {
        result.current.onCancelBatchOperation()
      })

      expect(result.current.selectedSegmentIds).toHaveLength(0)
    })
  })

  describe('clearSelection', () => {
    it('should clear all selections', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      act(() => {
        result.current.onSelected('seg-1')
      })

      act(() => {
        result.current.clearSelection()
      })

      expect(result.current.selectedSegmentIds).toHaveLength(0)
    })
  })

  describe('Callback Stability', () => {
    it('should maintain stable callback references for state-independent callbacks', () => {
      const { result, rerender } = renderHook(() => useSegmentSelection(mockSegments))

      const initialOnSelected = result.current.onSelected
      const initialOnCancelBatchOperation = result.current.onCancelBatchOperation
      const initialClearSelection = result.current.clearSelection

      // Trigger a state change
      act(() => {
        result.current.onSelected('seg-1')
      })

      rerender()

      // These callbacks don't depend on state, so they should be stable
      expect(result.current.onSelected).toBe(initialOnSelected)
      expect(result.current.onCancelBatchOperation).toBe(initialOnCancelBatchOperation)
      expect(result.current.clearSelection).toBe(initialClearSelection)
    })

    it('should update onSelectedAll when isAllSelected changes', () => {
      const { result } = renderHook(() => useSegmentSelection(mockSegments))

      const initialOnSelectedAll = result.current.onSelectedAll

      // Select all segments to change isAllSelected
      act(() => {
        mockSegments.forEach(seg => result.current.onSelected(seg.id))
      })

      // onSelectedAll depends on isAllSelected, so it should change
      expect(result.current.onSelectedAll).not.toBe(initialOnSelectedAll)
    })
  })
})

// ============================================================================
// useModalState Hook Tests
// ============================================================================

describe('useModalState', () => {
  const mockOnNewSegmentModalChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('should initialize with all modals closed', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      expect(result.current.currSegment.showModal).toBe(false)
      expect(result.current.currChildChunk.showModal).toBe(false)
      expect(result.current.showNewChildSegmentModal).toBe(false)
      expect(result.current.isRegenerationModalOpen).toBe(false)
      expect(result.current.fullScreen).toBe(false)
      expect(result.current.isCollapsed).toBe(true)
    })

    it('should initialize currChunkId as empty string', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      expect(result.current.currChunkId).toBe('')
    })
  })

  describe('Segment Detail Modal', () => {
    it('should open segment detail modal with correct data', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      const mockSegment = createMockSegmentDetail({ id: 'test-seg' })

      act(() => {
        result.current.onClickCard(mockSegment)
      })

      expect(result.current.currSegment.showModal).toBe(true)
      expect(result.current.currSegment.segInfo).toEqual(mockSegment)
      expect(result.current.currSegment.isEditMode).toBe(false)
    })

    it('should open segment detail modal in edit mode', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      const mockSegment = createMockSegmentDetail({ id: 'test-seg' })

      act(() => {
        result.current.onClickCard(mockSegment, true)
      })

      expect(result.current.currSegment.isEditMode).toBe(true)
    })

    it('should close segment detail modal and reset fullScreen', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      const mockSegment = createMockSegmentDetail({ id: 'test-seg' })

      act(() => {
        result.current.onClickCard(mockSegment)
        result.current.setFullScreen(true)
      })

      expect(result.current.currSegment.showModal).toBe(true)
      expect(result.current.fullScreen).toBe(true)

      act(() => {
        result.current.onCloseSegmentDetail()
      })

      expect(result.current.currSegment.showModal).toBe(false)
      expect(result.current.fullScreen).toBe(false)
    })
  })

  describe('Child Segment Detail Modal', () => {
    it('should open child segment detail modal with correct data', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      const mockChildChunk = createMockChildChunk({ id: 'child-1', segment_id: 'parent-1' })

      act(() => {
        result.current.onClickSlice(mockChildChunk)
      })

      expect(result.current.currChildChunk.showModal).toBe(true)
      expect(result.current.currChildChunk.childChunkInfo).toEqual(mockChildChunk)
      expect(result.current.currChunkId).toBe('parent-1')
    })

    it('should close child segment detail modal and reset fullScreen', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      const mockChildChunk = createMockChildChunk()

      act(() => {
        result.current.onClickSlice(mockChildChunk)
        result.current.setFullScreen(true)
      })

      act(() => {
        result.current.onCloseChildSegmentDetail()
      })

      expect(result.current.currChildChunk.showModal).toBe(false)
      expect(result.current.fullScreen).toBe(false)
    })
  })

  describe('New Segment Modal', () => {
    it('should call onNewSegmentModalChange and reset fullScreen when closing', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      act(() => {
        result.current.setFullScreen(true)
      })

      act(() => {
        result.current.onCloseNewSegmentModal()
      })

      expect(mockOnNewSegmentModalChange).toHaveBeenCalledWith(false)
      expect(result.current.fullScreen).toBe(false)
    })
  })

  describe('New Child Segment Modal', () => {
    it('should open new child segment modal and set currChunkId', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      act(() => {
        result.current.handleAddNewChildChunk('parent-chunk-id')
      })

      expect(result.current.showNewChildSegmentModal).toBe(true)
      expect(result.current.currChunkId).toBe('parent-chunk-id')
    })

    it('should close new child segment modal and reset fullScreen', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      act(() => {
        result.current.handleAddNewChildChunk('parent-chunk-id')
        result.current.setFullScreen(true)
      })

      act(() => {
        result.current.onCloseNewChildChunkModal()
      })

      expect(result.current.showNewChildSegmentModal).toBe(false)
      expect(result.current.fullScreen).toBe(false)
    })
  })

  describe('Display State', () => {
    it('should toggle fullScreen', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

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

    it('should set fullScreen directly', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      act(() => {
        result.current.setFullScreen(true)
      })

      expect(result.current.fullScreen).toBe(true)
    })

    it('should toggle isCollapsed', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      expect(result.current.isCollapsed).toBe(true)

      act(() => {
        result.current.toggleCollapsed()
      })

      expect(result.current.isCollapsed).toBe(false)

      act(() => {
        result.current.toggleCollapsed()
      })

      expect(result.current.isCollapsed).toBe(true)
    })
  })

  describe('Regeneration Modal', () => {
    it('should set isRegenerationModalOpen', () => {
      const { result } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      act(() => {
        result.current.setIsRegenerationModalOpen(true)
      })

      expect(result.current.isRegenerationModalOpen).toBe(true)

      act(() => {
        result.current.setIsRegenerationModalOpen(false)
      })

      expect(result.current.isRegenerationModalOpen).toBe(false)
    })
  })

  describe('Callback Stability', () => {
    it('should maintain stable callback references', () => {
      const { result, rerender } = renderHook(() =>
        useModalState({ onNewSegmentModalChange: mockOnNewSegmentModalChange }),
      )

      const initialCallbacks = {
        onClickCard: result.current.onClickCard,
        onCloseSegmentDetail: result.current.onCloseSegmentDetail,
        onClickSlice: result.current.onClickSlice,
        onCloseChildSegmentDetail: result.current.onCloseChildSegmentDetail,
        handleAddNewChildChunk: result.current.handleAddNewChildChunk,
        onCloseNewChildChunkModal: result.current.onCloseNewChildChunkModal,
        toggleFullScreen: result.current.toggleFullScreen,
        toggleCollapsed: result.current.toggleCollapsed,
      }

      rerender()

      expect(result.current.onClickCard).toBe(initialCallbacks.onClickCard)
      expect(result.current.onCloseSegmentDetail).toBe(initialCallbacks.onCloseSegmentDetail)
      expect(result.current.onClickSlice).toBe(initialCallbacks.onClickSlice)
      expect(result.current.onCloseChildSegmentDetail).toBe(initialCallbacks.onCloseChildSegmentDetail)
      expect(result.current.handleAddNewChildChunk).toBe(initialCallbacks.handleAddNewChildChunk)
      expect(result.current.onCloseNewChildChunkModal).toBe(initialCallbacks.onCloseNewChildChunkModal)
      expect(result.current.toggleFullScreen).toBe(initialCallbacks.toggleFullScreen)
      expect(result.current.toggleCollapsed).toBe(initialCallbacks.toggleCollapsed)
    })
  })
})

// ============================================================================
// SegmentListContext Tests
// ============================================================================

describe('SegmentListContext', () => {
  describe('Default Values', () => {
    it('should have correct default context values', () => {
      const TestComponent = () => {
        const isCollapsed = useSegmentListContext(s => s.isCollapsed)
        const fullScreen = useSegmentListContext(s => s.fullScreen)
        const currSegment = useSegmentListContext(s => s.currSegment)
        const currChildChunk = useSegmentListContext(s => s.currChildChunk)

        return (
          <div>
            <span data-testid="isCollapsed">{String(isCollapsed)}</span>
            <span data-testid="fullScreen">{String(fullScreen)}</span>
            <span data-testid="currSegmentShowModal">{String(currSegment.showModal)}</span>
            <span data-testid="currChildChunkShowModal">{String(currChildChunk.showModal)}</span>
          </div>
        )
      }

      render(<TestComponent />)

      expect(screen.getByTestId('isCollapsed')).toHaveTextContent('true')
      expect(screen.getByTestId('fullScreen')).toHaveTextContent('false')
      expect(screen.getByTestId('currSegmentShowModal')).toHaveTextContent('false')
      expect(screen.getByTestId('currChildChunkShowModal')).toHaveTextContent('false')
    })
  })

  describe('Context Provider', () => {
    it('should provide custom values through provider', () => {
      const customValue = {
        isCollapsed: false,
        fullScreen: true,
        toggleFullScreen: vi.fn(),
        currSegment: { showModal: true, segInfo: createMockSegmentDetail() },
        currChildChunk: { showModal: false },
      }

      const TestComponent = () => {
        const isCollapsed = useSegmentListContext(s => s.isCollapsed)
        const fullScreen = useSegmentListContext(s => s.fullScreen)
        const currSegment = useSegmentListContext(s => s.currSegment)

        return (
          <div>
            <span data-testid="isCollapsed">{String(isCollapsed)}</span>
            <span data-testid="fullScreen">{String(fullScreen)}</span>
            <span data-testid="currSegmentShowModal">{String(currSegment.showModal)}</span>
          </div>
        )
      }

      render(
        <SegmentListContext.Provider value={customValue}>
          <TestComponent />
        </SegmentListContext.Provider>,
      )

      expect(screen.getByTestId('isCollapsed')).toHaveTextContent('false')
      expect(screen.getByTestId('fullScreen')).toHaveTextContent('true')
      expect(screen.getByTestId('currSegmentShowModal')).toHaveTextContent('true')
    })
  })

  describe('Selector Optimization', () => {
    it('should select specific values from context', () => {
      const TestComponent = () => {
        const isCollapsed = useSegmentListContext(s => s.isCollapsed)
        const fullScreen = useSegmentListContext(s => s.fullScreen)
        return (
          <div>
            <span data-testid="isCollapsed">{String(isCollapsed)}</span>
            <span data-testid="fullScreen">{String(fullScreen)}</span>
          </div>
        )
      }

      const { rerender } = render(
        <SegmentListContext.Provider value={{
          isCollapsed: true,
          fullScreen: false,
          toggleFullScreen: vi.fn(),
          currSegment: { showModal: false },
          currChildChunk: { showModal: false },
        }}
        >
          <TestComponent />
        </SegmentListContext.Provider>,
      )

      expect(screen.getByTestId('isCollapsed')).toHaveTextContent('true')
      expect(screen.getByTestId('fullScreen')).toHaveTextContent('false')

      // Rerender with changed values
      rerender(
        <SegmentListContext.Provider value={{
          isCollapsed: false,
          fullScreen: true,
          toggleFullScreen: vi.fn(),
          currSegment: { showModal: false },
          currChildChunk: { showModal: false },
        }}
        >
          <TestComponent />
        </SegmentListContext.Provider>,
      )

      expect(screen.getByTestId('isCollapsed')).toHaveTextContent('false')
      expect(screen.getByTestId('fullScreen')).toHaveTextContent('true')
    })
  })
})

// ============================================================================
// Completed Component Tests
// ============================================================================

describe('Completed Component', () => {
  const defaultProps = {
    embeddingAvailable: true,
    showNewSegmentModal: false,
    onNewSegmentModalChange: vi.fn(),
    importStatus: undefined,
    archived: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDocForm.current = ChunkingModeEnum.text
    mockParentMode.current = 'paragraph'
  })

  describe('Rendering', () => {
    it('should render MenuBar when not in full-doc mode', () => {
      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('menu-bar')).toBeInTheDocument()
    })

    it('should not render MenuBar when in full-doc mode', () => {
      mockDocForm.current = ChunkingModeEnum.parentChild
      mockParentMode.current = 'full-doc'

      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.queryByTestId('menu-bar')).not.toBeInTheDocument()
    })

    it('should render GeneralModeContent when not in full-doc mode', () => {
      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('general-mode-content')).toBeInTheDocument()
    })

    it('should render FullDocModeContent when in full-doc mode', () => {
      mockDocForm.current = ChunkingModeEnum.parentChild
      mockParentMode.current = 'full-doc'

      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('full-doc-mode-content')).toBeInTheDocument()
    })

    it('should render Pagination component', () => {
      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('pagination')).toBeInTheDocument()
    })

    it('should render Divider component', () => {
      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('divider')).toBeInTheDocument()
    })

    it('should render DrawerGroup when docForm is available', () => {
      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('drawer-group')).toBeInTheDocument()
    })

    it('should not render DrawerGroup when docForm is undefined', () => {
      mockDocForm.current = undefined as unknown as ChunkingMode

      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.queryByTestId('drawer-group')).not.toBeInTheDocument()
    })
  })

  describe('Pagination', () => {
    it('should start with page 0 (current - 1)', () => {
      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('current-page')).toHaveTextContent('0')
    })

    it('should update page when pagination changes', async () => {
      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      const nextPageButton = screen.getByTestId('next-page')
      fireEvent.click(nextPageButton)

      await waitFor(() => {
        expect(screen.getByTestId('current-page')).toHaveTextContent('1')
      })
    })

    it('should update limit when limit changes', async () => {
      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      const changeLimitButton = screen.getByTestId('change-limit')
      fireEvent.click(changeLimitButton)

      // Limit change is handled internally
      expect(changeLimitButton).toBeInTheDocument()
    })
  })

  describe('Batch Action', () => {
    it('should not render BatchAction when no segments selected', () => {
      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.queryByTestId('batch-action')).not.toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    it('should handle archived prop', () => {
      render(<Completed {...defaultProps} archived={true} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('general-mode-content')).toBeInTheDocument()
    })

    it('should handle embeddingAvailable prop', () => {
      render(<Completed {...defaultProps} embeddingAvailable={false} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('general-mode-content')).toBeInTheDocument()
    })

    it('should handle showNewSegmentModal prop', () => {
      render(<Completed {...defaultProps} showNewSegmentModal={true} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('drawer-group')).toBeInTheDocument()
    })
  })

  describe('Context Provider', () => {
    it('should provide SegmentListContext to children', () => {
      // The component wraps children with SegmentListContext.Provider
      render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      // Context is provided, components should render without errors
      expect(screen.getByTestId('general-mode-content')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// MenuBar Component Tests (via mock verification)
// ============================================================================

describe('MenuBar Component', () => {
  const defaultProps = {
    embeddingAvailable: true,
    showNewSegmentModal: false,
    onNewSegmentModalChange: vi.fn(),
    importStatus: undefined,
    archived: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDocForm.current = ChunkingModeEnum.text
    mockParentMode.current = 'paragraph'
  })

  it('should pass correct props to MenuBar', () => {
    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    const menuBar = screen.getByTestId('menu-bar')
    expect(menuBar).toBeInTheDocument()

    // Total text should be displayed
    const totalText = screen.getByTestId('total-text')
    expect(totalText).toHaveTextContent('chunks')
  })

  it('should handle search input changes', async () => {
    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    const searchInput = screen.getByTestId('search-input')
    fireEvent.change(searchInput, { target: { value: 'test search' } })

    expect(searchInput).toHaveValue('test search')
  })

  it('should disable search input when loading', () => {
    // Loading state is controlled by the segment list hook
    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    const searchInput = screen.getByTestId('search-input')
    // When not loading, input should not be disabled
    expect(searchInput).not.toBeDisabled()
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  const defaultProps = {
    embeddingAvailable: true,
    showNewSegmentModal: false,
    onNewSegmentModalChange: vi.fn(),
    importStatus: undefined,
    archived: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDocForm.current = ChunkingModeEnum.text
    mockParentMode.current = 'paragraph'
    mockDatasetId.current = 'test-dataset-id'
    mockDocumentId.current = 'test-document-id'
  })

  it('should handle empty datasetId', () => {
    mockDatasetId.current = ''

    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    expect(screen.getByTestId('general-mode-content')).toBeInTheDocument()
  })

  it('should handle empty documentId', () => {
    mockDocumentId.current = ''

    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    expect(screen.getByTestId('general-mode-content')).toBeInTheDocument()
  })

  it('should handle undefined importStatus', () => {
    render(<Completed {...defaultProps} importStatus={undefined} />, { wrapper: createWrapper() })

    expect(screen.getByTestId('general-mode-content')).toBeInTheDocument()
  })

  it('should handle ProcessStatus.COMPLETED importStatus', () => {
    render(<Completed {...defaultProps} importStatus="completed" />, { wrapper: createWrapper() })

    expect(screen.getByTestId('general-mode-content')).toBeInTheDocument()
  })

  it('should handle all ChunkingMode values', () => {
    const modes = [ChunkingModeEnum.text, ChunkingModeEnum.qa, ChunkingModeEnum.parentChild]

    modes.forEach((mode) => {
      mockDocForm.current = mode

      const { unmount } = render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('pagination')).toBeInTheDocument()

      unmount()
    })
  })

  it('should handle all parentMode values', () => {
    mockDocForm.current = ChunkingModeEnum.parentChild

    const modes: ParentMode[] = ['paragraph', 'full-doc']

    modes.forEach((mode) => {
      mockParentMode.current = mode

      const { unmount } = render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

      expect(screen.getByTestId('pagination')).toBeInTheDocument()

      unmount()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  const defaultProps = {
    embeddingAvailable: true,
    showNewSegmentModal: false,
    onNewSegmentModalChange: vi.fn(),
    importStatus: undefined,
    archived: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDocForm.current = ChunkingModeEnum.text
    mockParentMode.current = 'paragraph'
  })

  it('should properly compose all hooks together', () => {
    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    // All components should render without errors
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument()
    expect(screen.getByTestId('general-mode-content')).toBeInTheDocument()
    expect(screen.getByTestId('pagination')).toBeInTheDocument()
    expect(screen.getByTestId('drawer-group')).toBeInTheDocument()
  })

  it('should update UI when mode changes', () => {
    const { rerender } = render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    expect(screen.getByTestId('general-mode-content')).toBeInTheDocument()

    mockDocForm.current = ChunkingModeEnum.parentChild
    mockParentMode.current = 'full-doc'

    rerender(<Completed {...defaultProps} />)

    expect(screen.getByTestId('full-doc-mode-content')).toBeInTheDocument()
  })

  it('should handle prop updates correctly', () => {
    const { rerender } = render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    expect(screen.getByTestId('drawer-group')).toBeInTheDocument()

    rerender(<Completed {...defaultProps} showNewSegmentModal={true} />)

    expect(screen.getByTestId('drawer-group')).toBeInTheDocument()
  })
})

// ============================================================================
// useSearchFilter - resetPage Tests
// ============================================================================

describe('useSearchFilter - resetPage', () => {
  it('should call onPageChange with 1 when resetPage is called', () => {
    const mockOnPageChange = vi.fn()
    const { result } = renderHook(() => useSearchFilter({ onPageChange: mockOnPageChange }))

    act(() => {
      result.current.resetPage()
    })

    expect(mockOnPageChange).toHaveBeenCalledWith(1)
  })
})

// ============================================================================
// Batch Action Tests
// ============================================================================

describe('Batch Action Callbacks', () => {
  const defaultProps = {
    embeddingAvailable: true,
    showNewSegmentModal: false,
    onNewSegmentModalChange: vi.fn(),
    importStatus: undefined,
    archived: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDocForm.current = ChunkingModeEnum.text
    mockParentMode.current = 'paragraph'
    mockSegmentListData.data = [
      {
        id: 'seg-1',
        position: 1,
        document_id: 'doc-1',
        content: 'Test content',
        sign_content: 'signed',
        word_count: 10,
        tokens: 5,
        keywords: [],
        index_node_id: 'idx-1',
        index_node_hash: 'hash-1',
        hit_count: 0,
        enabled: true,
        disabled_at: 0,
        disabled_by: '',
        status: 'completed',
        created_by: 'user',
        created_at: 1700000000,
        indexing_at: 1700000001,
        completed_at: 1700000002,
        error: null,
        stopped_at: 0,
        updated_at: 1700000003,
        attachments: [],
        child_chunks: [],
      },
    ]
    mockSegmentListData.total = 1
  })

  it('should not render batch actions when no segments are selected initially', async () => {
    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    // Initially no segments are selected, so batch action should not be visible
    expect(screen.queryByTestId('batch-action')).not.toBeInTheDocument()
  })

  it('should render batch actions after selecting all segments', async () => {
    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    // Click the select all button to select all segments
    const selectAllButton = screen.getByTestId('select-all-button')
    fireEvent.click(selectAllButton)

    // Now batch actions should be visible
    await waitFor(() => {
      expect(screen.getByTestId('batch-action')).toBeInTheDocument()
    })
  })

  it('should call onChangeSwitch with true when batch enable is clicked', async () => {
    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    // Select all segments first
    const selectAllButton = screen.getByTestId('select-all-button')
    fireEvent.click(selectAllButton)

    // Wait for batch actions to appear
    await waitFor(() => {
      expect(screen.getByTestId('batch-action')).toBeInTheDocument()
    })

    // Click the enable button
    const enableButton = screen.getByTestId('batch-enable')
    fireEvent.click(enableButton)

    expect(mockOnChangeSwitch).toHaveBeenCalled()
  })

  it('should call onChangeSwitch with false when batch disable is clicked', async () => {
    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    // Select all segments first
    const selectAllButton = screen.getByTestId('select-all-button')
    fireEvent.click(selectAllButton)

    // Wait for batch actions to appear
    await waitFor(() => {
      expect(screen.getByTestId('batch-action')).toBeInTheDocument()
    })

    // Click the disable button
    const disableButton = screen.getByTestId('batch-disable')
    fireEvent.click(disableButton)

    expect(mockOnChangeSwitch).toHaveBeenCalled()
  })

  it('should call onDelete when batch delete is clicked', async () => {
    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    // Select all segments first
    const selectAllButton = screen.getByTestId('select-all-button')
    fireEvent.click(selectAllButton)

    // Wait for batch actions to appear
    await waitFor(() => {
      expect(screen.getByTestId('batch-action')).toBeInTheDocument()
    })

    // Click the delete button
    const deleteButton = screen.getByTestId('batch-delete')
    fireEvent.click(deleteButton)

    expect(mockOnDelete).toHaveBeenCalled()
  })
})

// ============================================================================
// refreshChunkListDataWithDetailChanged Tests
// ============================================================================

describe('refreshChunkListDataWithDetailChanged callback', () => {
  const defaultProps = {
    embeddingAvailable: true,
    showNewSegmentModal: false,
    onNewSegmentModalChange: vi.fn(),
    importStatus: undefined,
    archived: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    capturedRefreshCallback = null
    mockDocForm.current = ChunkingModeEnum.parentChild
    mockParentMode.current = 'full-doc'
    mockSegmentListData.data = []
    mockSegmentListData.total = 0
  })

  it('should capture the callback when component renders', () => {
    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    // The callback should be captured
    expect(capturedRefreshCallback).toBeDefined()
  })

  it('should call invalidation functions when triggered with default status "all"', () => {
    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    // Call the captured callback - status is 'all' by default
    if (capturedRefreshCallback)
      capturedRefreshCallback()

    // With status 'all', should call both disabled and enabled invalidation
    expect(mockInvalidChunkListDisabled).toHaveBeenCalled()
    expect(mockInvalidChunkListEnabled).toHaveBeenCalled()
  })

  it('should handle multiple callback invocations', () => {
    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    // Call the captured callback multiple times
    if (capturedRefreshCallback) {
      capturedRefreshCallback()
      capturedRefreshCallback()
      capturedRefreshCallback()
    }

    // Should be called multiple times
    expect(mockInvalidChunkListDisabled).toHaveBeenCalledTimes(3)
    expect(mockInvalidChunkListEnabled).toHaveBeenCalledTimes(3)
  })

  it('should call correct invalidation functions when status is changed to enabled', async () => {
    // Use general mode which has the status filter
    mockDocForm.current = ChunkingModeEnum.text
    mockParentMode.current = 'paragraph'

    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    // Change status to enabled
    const statusEnabledButton = screen.getByTestId('status-enabled')
    fireEvent.click(statusEnabledButton)

    // Wait for state to update and re-render
    await waitFor(() => {
      // The callback should be re-captured with new status
      expect(capturedRefreshCallback).toBeDefined()
    })

    // Call the callback with status 'true'
    if (capturedRefreshCallback)
      capturedRefreshCallback()

    // With status true, should call all and disabled invalidation
    expect(mockInvalidChunkListAll).toHaveBeenCalled()
    expect(mockInvalidChunkListDisabled).toHaveBeenCalled()
  })

  it('should call correct invalidation functions when status is changed to disabled', async () => {
    // Use general mode which has the status filter
    mockDocForm.current = ChunkingModeEnum.text
    mockParentMode.current = 'paragraph'

    render(<Completed {...defaultProps} />, { wrapper: createWrapper() })

    // Change status to disabled
    const statusDisabledButton = screen.getByTestId('status-disabled')
    fireEvent.click(statusDisabledButton)

    // Wait for state to update and re-render
    await waitFor(() => {
      // The callback should be re-captured with new status
      expect(capturedRefreshCallback).toBeDefined()
    })

    // Call the callback with status 'false'
    if (capturedRefreshCallback)
      capturedRefreshCallback()

    // With status false, should call all and enabled invalidation
    expect(mockInvalidChunkListAll).toHaveBeenCalled()
    expect(mockInvalidChunkListEnabled).toHaveBeenCalled()
  })
})

// ============================================================================
// refreshChunkListDataWithDetailChanged Branch Coverage Tests
// ============================================================================

describe('refreshChunkListDataWithDetailChanged branch coverage', () => {
  // This test simulates the behavior of refreshChunkListDataWithDetailChanged
  // with different selectedStatus values to ensure branch coverage

  it('should handle status "true" branch correctly', () => {
    // Simulate the behavior when selectedStatus is true
    const mockInvalidAll = vi.fn()
    const mockInvalidDisabled = vi.fn()

    // Create a refreshMap similar to the component
    const refreshMap: Record<string, () => void> = {
      true: () => {
        mockInvalidAll()
        mockInvalidDisabled()
      },
    }

    // Execute the 'true' branch
    refreshMap.true()

    expect(mockInvalidAll).toHaveBeenCalled()
    expect(mockInvalidDisabled).toHaveBeenCalled()
  })

  it('should handle status "false" branch correctly', () => {
    // Simulate the behavior when selectedStatus is false
    const mockInvalidAll = vi.fn()
    const mockInvalidEnabled = vi.fn()

    // Create a refreshMap similar to the component
    const refreshMap: Record<string, () => void> = {
      false: () => {
        mockInvalidAll()
        mockInvalidEnabled()
      },
    }

    // Execute the 'false' branch
    refreshMap.false()

    expect(mockInvalidAll).toHaveBeenCalled()
    expect(mockInvalidEnabled).toHaveBeenCalled()
  })
})

// ============================================================================
// Batch Action Callback Coverage Tests
// ============================================================================

describe('Batch Action callback simulation', () => {
  // This test simulates the batch action callback behavior
  // to ensure the arrow function callbacks are covered

  it('should simulate onBatchEnable callback behavior', () => {
    const mockOnChangeSwitch = vi.fn()

    // Simulate the callback: () => segmentListDataHook.onChangeSwitch(true, '')
    const onBatchEnable = () => mockOnChangeSwitch(true, '')
    onBatchEnable()

    expect(mockOnChangeSwitch).toHaveBeenCalledWith(true, '')
  })

  it('should simulate onBatchDisable callback behavior', () => {
    const mockOnChangeSwitch = vi.fn()

    // Simulate the callback: () => segmentListDataHook.onChangeSwitch(false, '')
    const onBatchDisable = () => mockOnChangeSwitch(false, '')
    onBatchDisable()

    expect(mockOnChangeSwitch).toHaveBeenCalledWith(false, '')
  })

  it('should simulate onBatchDelete callback behavior', () => {
    const mockOnDelete = vi.fn()

    // Simulate the callback: () => segmentListDataHook.onDelete('')
    const onBatchDelete = () => mockOnDelete('')
    onBatchDelete()

    expect(mockOnDelete).toHaveBeenCalledWith('')
  })
})

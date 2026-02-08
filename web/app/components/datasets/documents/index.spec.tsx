import type { DocumentListResponse } from '@/models/datasets'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useProviderContext } from '@/context/provider-context'
import { DataSourceType } from '@/models/datasets'
import { useDocumentList } from '@/service/knowledge/use-document'
import useDocumentsPageState from './hooks/use-documents-page-state'
import Documents from './index'

// Type for mock selector function - use `as MockState` to bypass strict type checking in tests
type MockSelector = Parameters<typeof useDatasetDetailContextWithSelector>[0]
type MockState = Parameters<MockSelector>[0]

// Mock Next.js router
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/datasets/test-dataset-id/documents',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock context providers
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: vi.fn((selector: (state: unknown) => unknown) => {
    const mockState = {
      dataset: {
        id: 'test-dataset-id',
        name: 'Test Dataset',
        embedding_available: true,
        data_source_type: DataSourceType.FILE,
        runtime_mode: 'rag',
      },
    }
    return selector(mockState as MockState)
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(() => ({
    plan: { type: 'professional' },
  })),
}))

// Mock document service hooks
const mockInvalidDocumentList = vi.fn()
const mockInvalidDocumentDetail = vi.fn()

vi.mock('@/service/knowledge/use-document', () => ({
  useDocumentList: vi.fn(() => ({
    data: {
      data: [
        {
          id: 'doc-1',
          name: 'Document 1',
          indexing_status: 'completed',
          data_source_type: 'upload_file',
          position: 1,
          enabled: true,
        },
        {
          id: 'doc-2',
          name: 'Document 2',
          indexing_status: 'indexing',
          data_source_type: 'upload_file',
          position: 2,
          enabled: true,
        },
      ],
      total: 2,
      page: 1,
      limit: 10,
      has_more: false,
    } as DocumentListResponse,
    isLoading: false,
    refetch: vi.fn(),
  })),
  useInvalidDocumentList: vi.fn(() => mockInvalidDocumentList),
  useInvalidDocumentDetail: vi.fn(() => mockInvalidDocumentDetail),
}))

// Mock segment service hooks
vi.mock('@/service/knowledge/use-segment', () => ({
  useSegmentListKey: 'segment-list-key',
  useChildSegmentListKey: 'child-segment-list-key',
}))

// Mock base service hooks
vi.mock('@/service/use-base', () => ({
  useInvalid: vi.fn(() => vi.fn()),
}))

// Mock metadata hook
vi.mock('../metadata/hooks/use-edit-dataset-metadata', () => ({
  default: vi.fn(() => ({
    isShowEditModal: false,
    showEditModal: vi.fn(),
    hideEditModal: vi.fn(),
    datasetMetaData: [],
    handleAddMetaData: vi.fn(),
    handleRename: vi.fn(),
    handleDeleteMetaData: vi.fn(),
    builtInEnabled: false,
    setBuiltInEnabled: vi.fn(),
    builtInMetaData: [],
  })),
}))

// Mock page state hook
const mockSetSelectedIds = vi.fn()
const mockHandleInputChange = vi.fn()
const mockHandleStatusFilterChange = vi.fn()
const mockHandleStatusFilterClear = vi.fn()
const mockHandleSortChange = vi.fn()
const mockHandlePageChange = vi.fn()
const mockHandleLimitChange = vi.fn()
const mockUpdatePollingState = vi.fn()
const mockAdjustPageForTotal = vi.fn()

vi.mock('./hooks/use-documents-page-state', () => ({
  default: vi.fn(() => ({
    inputValue: '',
    searchValue: '',
    debouncedSearchValue: '',
    handleInputChange: mockHandleInputChange,
    statusFilterValue: 'all',
    sortValue: '-created_at' as const,
    normalizedStatusFilterValue: 'all',
    handleStatusFilterChange: mockHandleStatusFilterChange,
    handleStatusFilterClear: mockHandleStatusFilterClear,
    handleSortChange: mockHandleSortChange,
    currPage: 0,
    limit: 10,
    handlePageChange: mockHandlePageChange,
    handleLimitChange: mockHandleLimitChange,
    selectedIds: [] as string[],
    setSelectedIds: mockSetSelectedIds,
    timerCanRun: false,
    updatePollingState: mockUpdatePollingState,
    adjustPageForTotal: mockAdjustPageForTotal,
  })),
}))

// Mock child components - these have deep dependency chains (QueryClient, API hooks, contexts)
// Mocking them allows us to test the Documents component logic in isolation
vi.mock('./components/documents-header', () => ({
  default: ({
    datasetId,
    embeddingAvailable,
    onInputChange,
    onAddDocument,
    onStatusFilterChange,
    onStatusFilterClear,
    onSortChange,
  }: {
    datasetId: string
    dataSourceType?: string
    embeddingAvailable: boolean
    isFreePlan: boolean
    statusFilterValue: string
    sortValue: string
    inputValue: string
    onInputChange: (value: string) => void
    onAddDocument: () => void
    onStatusFilterChange: (value: string) => void
    onStatusFilterClear: () => void
    onSortChange: (value: string) => void
    isShowEditMetadataModal: boolean
    showEditMetadataModal: () => void
    hideEditMetadataModal: () => void
    datasetMetaData: unknown[]
    builtInMetaData: unknown[]
    builtInEnabled: boolean
    onAddMetaData: () => void
    onRenameMetaData: () => void
    onDeleteMetaData: () => void
    onBuiltInEnabledChange: () => void
  }) => (
    <div data-testid="documents-header">
      <span data-testid="header-dataset-id">{datasetId}</span>
      <span data-testid="header-embedding-available">{String(embeddingAvailable)}</span>
      <input
        data-testid="search-input"
        onChange={e => onInputChange(e.target.value)}
        placeholder="Search documents"
      />
      <button data-testid="add-document-btn" onClick={onAddDocument}>
        Add Document
      </button>
      <button data-testid="status-filter-btn" onClick={() => onStatusFilterChange('completed')}>
        Filter Status
      </button>
      <button data-testid="clear-filter-btn" onClick={onStatusFilterClear}>
        Clear Filter
      </button>
      <button data-testid="sort-btn" onClick={() => onSortChange('-updated_at')}>
        Sort
      </button>
    </div>
  ),
}))

vi.mock('./components/empty-element', () => ({
  default: ({ canAdd, onClick, type }: {
    canAdd: boolean
    onClick: () => void
    type: 'sync' | 'upload'
  }) => (
    <div data-testid="empty-element">
      <span data-testid="empty-can-add">{String(canAdd)}</span>
      <span data-testid="empty-type">{type}</span>
      <button data-testid="empty-add-btn" onClick={onClick}>
        Add Document
      </button>
    </div>
  ),
}))

vi.mock('./components/list', () => ({
  default: ({
    documents,
    datasetId,
    onUpdate,
    selectedIds,
    onSelectedIdChange,
    pagination,
  }: {
    embeddingAvailable: boolean
    documents: unknown[]
    datasetId: string
    onUpdate: () => void
    selectedIds: string[]
    onSelectedIdChange: (ids: string[]) => void
    statusFilterValue: string
    remoteSortValue: string
    pagination: {
      total: number
      limit: number
      current: number
      onChange: (page: number) => void
      onLimitChange: (limit: number) => void
    }
    onManageMetadata: () => void
  }) => (
    <div data-testid="documents-list">
      <span data-testid="list-dataset-id">{datasetId}</span>
      <span data-testid="list-documents-count">{documents.length}</span>
      <span data-testid="list-selected-count">{selectedIds.length}</span>
      <span data-testid="list-total">{pagination.total}</span>
      <span data-testid="list-current-page">{pagination.current}</span>
      <button data-testid="update-btn" onClick={onUpdate}>
        Update
      </button>
      <button data-testid="select-btn" onClick={() => onSelectedIdChange(['doc-1'])}>
        Select Doc
      </button>
      <button data-testid="page-change-btn" onClick={() => pagination.onChange(1)}>
        Next Page
      </button>
      <button data-testid="limit-change-btn" onClick={() => pagination.onLimitChange(20)}>
        Change Limit
      </button>
    </div>
  ),
}))

describe('Documents', () => {
  const defaultProps = {
    datasetId: 'test-dataset-id',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPush.mockClear()
    // Reset context mocks to default
    vi.mocked(useDatasetDetailContextWithSelector).mockImplementation((selector: MockSelector) => {
      const mockState = {
        dataset: {
          id: 'test-dataset-id',
          name: 'Test Dataset',
          embedding_available: true,
          data_source_type: DataSourceType.FILE,
          runtime_mode: 'rag',
        },
      }
      return selector(mockState as MockState)
    })
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('documents-header')).toBeInTheDocument()
    })

    it('should render DocumentsHeader with correct props', () => {
      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('header-dataset-id')).toHaveTextContent('test-dataset-id')
      expect(screen.getByTestId('header-embedding-available')).toHaveTextContent('true')
    })

    it('should render document list when documents exist', () => {
      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('documents-list')).toBeInTheDocument()
      expect(screen.getByTestId('list-documents-count')).toHaveTextContent('2')
    })

    it('should render loading state when isLoading is true', () => {
      vi.mocked(useDocumentList).mockReturnValueOnce({
        data: undefined,
        isLoading: true,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDocumentList>)

      render(<Documents {...defaultProps} />)
      expect(screen.queryByTestId('documents-list')).not.toBeInTheDocument()
    })

    it('should render empty element when no documents exist', () => {
      vi.mocked(useDocumentList).mockReturnValueOnce({
        data: { data: [], total: 0, page: 1, limit: 10, has_more: false },
        isLoading: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDocumentList>)

      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('empty-element')).toBeInTheDocument()
      expect(screen.getByTestId('empty-can-add')).toHaveTextContent('true')
      expect(screen.getByTestId('empty-type')).toHaveTextContent('upload')
    })

    it('should render sync type empty element for Notion data source', () => {
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation((selector: MockSelector) => {
        const mockState = {
          dataset: {
            id: 'test-dataset-id',
            name: 'Test Dataset',
            embedding_available: true,
            data_source_type: DataSourceType.NOTION,
            runtime_mode: 'rag',
          },
        }
        return selector(mockState as MockState)
      })
      vi.mocked(useDocumentList).mockReturnValueOnce({
        data: { data: [], total: 0, page: 1, limit: 10, has_more: false },
        isLoading: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDocumentList>)

      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('empty-type')).toHaveTextContent('sync')
    })
  })

  describe('Props', () => {
    it('should pass datasetId to child components', () => {
      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('header-dataset-id')).toHaveTextContent('test-dataset-id')
    })

    it('should handle different datasetId', () => {
      render(<Documents datasetId="different-dataset-id" />)
      expect(screen.getByTestId('header-dataset-id')).toHaveTextContent('different-dataset-id')
    })
  })

  describe('User Interactions', () => {
    it('should call handleInputChange when search input changes', async () => {
      render(<Documents {...defaultProps} />)

      const searchInput = screen.getByTestId('search-input')
      fireEvent.change(searchInput, { target: { value: 'test' } })

      expect(mockHandleInputChange).toHaveBeenCalledWith('test')
    })

    it('should call handleStatusFilterChange when filter button is clicked', () => {
      render(<Documents {...defaultProps} />)

      screen.getByTestId('status-filter-btn').click()

      expect(mockHandleStatusFilterChange).toHaveBeenCalledWith('completed')
    })

    it('should call handleStatusFilterClear when clear button is clicked', () => {
      render(<Documents {...defaultProps} />)

      screen.getByTestId('clear-filter-btn').click()

      expect(mockHandleStatusFilterClear).toHaveBeenCalled()
    })

    it('should call handleSortChange when sort button is clicked', () => {
      render(<Documents {...defaultProps} />)

      screen.getByTestId('sort-btn').click()

      expect(mockHandleSortChange).toHaveBeenCalledWith('-updated_at')
    })

    it('should call setSelectedIds when document is selected', () => {
      render(<Documents {...defaultProps} />)

      screen.getByTestId('select-btn').click()

      expect(mockSetSelectedIds).toHaveBeenCalledWith(['doc-1'])
    })

    it('should call handlePageChange when page changes', () => {
      render(<Documents {...defaultProps} />)

      screen.getByTestId('page-change-btn').click()

      expect(mockHandlePageChange).toHaveBeenCalledWith(1)
    })

    it('should call handleLimitChange when limit changes', () => {
      render(<Documents {...defaultProps} />)

      screen.getByTestId('limit-change-btn').click()

      expect(mockHandleLimitChange).toHaveBeenCalledWith(20)
    })
  })

  describe('Router Navigation', () => {
    it('should navigate to create page when add document is clicked', () => {
      render(<Documents {...defaultProps} />)

      screen.getByTestId('add-document-btn').click()

      expect(mockPush).toHaveBeenCalledWith('/datasets/test-dataset-id/documents/create')
    })

    it('should navigate to pipeline create page when dataset is rag_pipeline mode', () => {
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation((selector: MockSelector) => {
        const mockState = {
          dataset: {
            id: 'test-dataset-id',
            name: 'Test Dataset',
            embedding_available: true,
            data_source_type: DataSourceType.FILE,
            runtime_mode: 'rag_pipeline',
          },
        }
        return selector(mockState as MockState)
      })

      render(<Documents {...defaultProps} />)

      screen.getByTestId('add-document-btn').click()

      expect(mockPush).toHaveBeenCalledWith('/datasets/test-dataset-id/documents/create-from-pipeline')
    })

    it('should navigate from empty element add button', () => {
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation((selector: MockSelector) => {
        const mockState = {
          dataset: {
            id: 'test-dataset-id',
            name: 'Test Dataset',
            embedding_available: true,
            data_source_type: DataSourceType.FILE,
            runtime_mode: 'rag',
          },
        }
        return selector(mockState as MockState)
      })
      vi.mocked(useDocumentList).mockReturnValueOnce({
        data: { data: [], total: 0, page: 1, limit: 10, has_more: false },
        isLoading: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDocumentList>)

      render(<Documents {...defaultProps} />)

      screen.getByTestId('empty-add-btn').click()

      expect(mockPush).toHaveBeenCalledWith('/datasets/test-dataset-id/documents/create')
    })
  })

  describe('Side Effects and Cleanup', () => {
    it('should call updatePollingState when documents response changes', () => {
      render(<Documents {...defaultProps} />)

      expect(mockUpdatePollingState).toHaveBeenCalled()
    })

    it('should call adjustPageForTotal when documents response changes', () => {
      render(<Documents {...defaultProps} />)

      expect(mockAdjustPageForTotal).toHaveBeenCalled()
    })
  })

  describe('Callback Stability and Memoization', () => {
    it('should call handleUpdate with invalidation functions', async () => {
      render(<Documents {...defaultProps} />)

      screen.getByTestId('update-btn').click()

      expect(mockInvalidDocumentList).toHaveBeenCalled()
      expect(mockInvalidDocumentDetail).toHaveBeenCalled()
    })

    it('should handle update with delayed chunk invalidation', async () => {
      vi.useFakeTimers()

      render(<Documents {...defaultProps} />)
      screen.getByTestId('update-btn').click()

      expect(mockInvalidDocumentList).toHaveBeenCalled()
      expect(mockInvalidDocumentDetail).toHaveBeenCalled()

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      vi.useRealTimers()
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle undefined dataset gracefully', () => {
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation((selector: MockSelector) => {
        const mockState = { dataset: undefined }
        return selector(mockState as MockState)
      })

      render(<Documents {...defaultProps} />)

      expect(screen.getByTestId('documents-header')).toBeInTheDocument()
    })

    it('should handle empty documents array', () => {
      vi.mocked(useDocumentList).mockReturnValueOnce({
        data: { data: [], total: 0, page: 1, limit: 10, has_more: false },
        isLoading: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDocumentList>)

      render(<Documents {...defaultProps} />)

      expect(screen.getByTestId('empty-element')).toBeInTheDocument()
    })

    it('should handle undefined documentsRes', () => {
      vi.mocked(useDocumentList).mockReturnValueOnce({
        data: undefined,
        isLoading: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useDocumentList>)

      render(<Documents {...defaultProps} />)

      expect(screen.getByTestId('empty-element')).toBeInTheDocument()
    })

    it('should handle embedding not available', () => {
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation((selector: MockSelector) => {
        const mockState = {
          dataset: {
            id: 'test-dataset-id',
            name: 'Test Dataset',
            embedding_available: false,
            data_source_type: DataSourceType.FILE,
            runtime_mode: 'rag',
          },
        }
        return selector(mockState as MockState)
      })

      render(<Documents {...defaultProps} />)

      expect(screen.getByTestId('header-embedding-available')).toHaveTextContent('false')
    })

    it('should handle free plan user', () => {
      vi.mocked(useProviderContext).mockReturnValueOnce({
        plan: { type: 'sandbox' },
      } as ReturnType<typeof useProviderContext>)

      render(<Documents {...defaultProps} />)

      expect(screen.getByTestId('documents-header')).toBeInTheDocument()
    })
  })

  describe('Polling State', () => {
    it('should enable polling when documents are indexing', () => {
      vi.mocked(useDocumentsPageState).mockReturnValueOnce({
        inputValue: '',
        searchValue: '',
        debouncedSearchValue: '',
        handleInputChange: mockHandleInputChange,
        statusFilterValue: 'all',
        sortValue: '-created_at' as const,
        normalizedStatusFilterValue: 'all',
        handleStatusFilterChange: mockHandleStatusFilterChange,
        handleStatusFilterClear: mockHandleStatusFilterClear,
        handleSortChange: mockHandleSortChange,
        currPage: 0,
        limit: 10,
        handlePageChange: mockHandlePageChange,
        handleLimitChange: mockHandleLimitChange,
        selectedIds: [] as string[],
        setSelectedIds: mockSetSelectedIds,
        timerCanRun: true,
        updatePollingState: mockUpdatePollingState,
        adjustPageForTotal: mockAdjustPageForTotal,
      })

      render(<Documents {...defaultProps} />)

      expect(screen.getByTestId('documents-list')).toBeInTheDocument()
    })
  })

  describe('Pagination', () => {
    it('should display correct total in list', () => {
      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('list-total')).toHaveTextContent('2')
    })

    it('should display correct current page', () => {
      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('list-current-page')).toHaveTextContent('0')
    })

    it('should handle page changes', () => {
      vi.mocked(useDocumentsPageState).mockReturnValueOnce({
        inputValue: '',
        searchValue: '',
        debouncedSearchValue: '',
        handleInputChange: mockHandleInputChange,
        statusFilterValue: 'all',
        sortValue: '-created_at' as const,
        normalizedStatusFilterValue: 'all',
        handleStatusFilterChange: mockHandleStatusFilterChange,
        handleStatusFilterClear: mockHandleStatusFilterClear,
        handleSortChange: mockHandleSortChange,
        currPage: 2,
        limit: 10,
        handlePageChange: mockHandlePageChange,
        handleLimitChange: mockHandleLimitChange,
        selectedIds: [] as string[],
        setSelectedIds: mockSetSelectedIds,
        timerCanRun: false,
        updatePollingState: mockUpdatePollingState,
        adjustPageForTotal: mockAdjustPageForTotal,
      })

      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('list-current-page')).toHaveTextContent('2')
    })
  })

  describe('Selection State', () => {
    it('should display selected count', () => {
      vi.mocked(useDocumentsPageState).mockReturnValueOnce({
        inputValue: '',
        searchValue: '',
        debouncedSearchValue: '',
        handleInputChange: mockHandleInputChange,
        statusFilterValue: 'all',
        sortValue: '-created_at' as const,
        normalizedStatusFilterValue: 'all',
        handleStatusFilterChange: mockHandleStatusFilterChange,
        handleStatusFilterClear: mockHandleStatusFilterClear,
        handleSortChange: mockHandleSortChange,
        currPage: 0,
        limit: 10,
        handlePageChange: mockHandlePageChange,
        handleLimitChange: mockHandleLimitChange,
        selectedIds: ['doc-1', 'doc-2'],
        setSelectedIds: mockSetSelectedIds,
        timerCanRun: false,
        updatePollingState: mockUpdatePollingState,
        adjustPageForTotal: mockAdjustPageForTotal,
      })

      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('list-selected-count')).toHaveTextContent('2')
    })
  })

  describe('Filter and Sort State', () => {
    it('should pass filter value to list', () => {
      vi.mocked(useDocumentsPageState).mockReturnValueOnce({
        inputValue: 'test search',
        searchValue: 'test search',
        debouncedSearchValue: 'test search',
        handleInputChange: mockHandleInputChange,
        statusFilterValue: 'completed',
        sortValue: '-created_at' as const,
        normalizedStatusFilterValue: 'completed',
        handleStatusFilterChange: mockHandleStatusFilterChange,
        handleStatusFilterClear: mockHandleStatusFilterClear,
        handleSortChange: mockHandleSortChange,
        currPage: 0,
        limit: 10,
        handlePageChange: mockHandlePageChange,
        handleLimitChange: mockHandleLimitChange,
        selectedIds: [] as string[],
        setSelectedIds: mockSetSelectedIds,
        timerCanRun: false,
        updatePollingState: mockUpdatePollingState,
        adjustPageForTotal: mockAdjustPageForTotal,
      })

      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('documents-list')).toBeInTheDocument()
    })
  })
})

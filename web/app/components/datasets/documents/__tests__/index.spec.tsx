import type { DocumentWithSegmentsListResponse as DocumentListResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { DataSourceType } from '@/models/datasets'
import { consoleQuery } from '@/service/console'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { render as renderWithConsoleState } from '@/test/console/render'
import { useDocumentsPageState } from '../hooks/use-documents-page-state'
import Documents from '../index'

const expectDocumentsInvalidated = () => {
  expect(QueryClient.prototype.invalidateQueries).toHaveBeenCalledWith({
    queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
      input: { params: { dataset_id: 'test-dataset-id' } },
    }),
  })
  expect(QueryClient.prototype.invalidateQueries).toHaveBeenCalledWith({
    queryKey: consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key(),
  })
}

let documentData: DocumentListResponse | undefined

const render = (ui: Parameters<typeof renderWithConsoleState>[0]) => {
  const queryClient = createAccountProfileQueryClient({ id: 'test-user' })
  queryClient.setQueryDefaults(consoleQuery.datasets.byDatasetId.documents.get.key(), {
    initialData: documentData,
  })
  const rendered = renderWithConsoleState(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
  return { ...rendered, queryClient }
}

// Type for mock selector function - use `as MockState` to bypass strict type checking in tests
type MockSelector = Parameters<typeof useDatasetDetailContextWithSelector>[0]
type MockState = Parameters<MockSelector>[0]

// Mock Next.js router
const mockPush = vi.fn()
vi.mock('@/next/navigation', () => ({
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
        created_by: 'test-user',
        permission_keys: ['dataset.acl.use', 'dataset.acl.edit'],
      },
    }
    return selector(mockState as MockState)
  }),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => ({
    userProfile: { id: 'test-user' },
    workspacePermissionKeys: ['dataset.create_and_management'],
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    userProfile: { id: 'test-user' },
    workspacePermissionKeys: ['dataset.create_and_management'],
  }))
})
vi.mock('@/features/system-features/state', async () => {
  const { createSystemFeaturesStateModuleMock } = await import('@/test/console/state-fixture')

  return createSystemFeaturesStateModuleMock(() => ({
    userProfile: { id: 'test-user' },
    workspacePermissionKeys: ['dataset.create_and_management'],
  }))
})

const getDocuments = vi.hoisted(() => vi.fn())
const defaultDocumentData = {
  data: [
    {
      id: 'doc-1',
      name: 'Document 1',
      indexing_status: 'completed',
      data_source_type: 'upload_file',
      position: 1,
      enabled: true,
      data_source_detail_dict: {},
    },
    {
      id: 'doc-2',
      name: 'Document 2',
      indexing_status: 'indexing',
      data_source_type: 'upload_file',
      position: 2,
      enabled: true,
      data_source_detail_dict: {},
    },
  ],
  total: 2,
  page: 1,
  limit: 10,
  has_more: false,
} satisfies DocumentListResponse
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.get': getDocuments,
    }),
  }
})

vi.mock('../../metadata/hooks/use-edit-dataset-metadata', () => ({
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

vi.mock('../hooks/use-documents-page-state', () => ({
  useDocumentsPageState: vi.fn(() => ({
    inputValue: '',
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
  })),
}))

// Mock child components - these have deep dependency chains (QueryClient, API hooks, contexts)
// Mocking them allows us to test the Documents component logic in isolation
vi.mock('../components/documents-header', () => ({
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
        onChange={(e) => onInputChange(e.target.value)}
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

vi.mock('../components/empty-element', () => ({
  default: ({
    canAdd,
    onClick,
    type,
  }: {
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

vi.mock('../components/list', () => ({
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
    vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    vi.clearAllMocks()
    documentData = defaultDocumentData
    getDocuments.mockReset().mockImplementation(() => new Promise(() => {}))
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
          created_by: 'test-user',
          permission_keys: ['dataset.acl.use', 'dataset.acl.edit'],
        },
      }
      return selector(mockState as MockState)
    })
  })

  describe('Rendering', () => {
    it('shows loading until the initial document request resolves', async () => {
      documentData = undefined

      getDocuments.mockResolvedValue(defaultDocumentData)
      render(<Documents {...defaultProps} />)
      expect(screen.queryByTestId('documents-list')).not.toBeInTheDocument()
      expect(await screen.findByTestId('documents-list')).toBeInTheDocument()
    })

    it('keeps cached documents visible during a background refresh', async () => {
      documentData = {
        data: [
          {
            id: 'doc-1',
            name: 'Document 1',
            indexing_status: 'completed',
            data_source_type: 'upload_file',
            position: 1,
            enabled: true,
            data_source_detail_dict: {},
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        has_more: false,
      } satisfies DocumentListResponse

      const { queryClient } = render(<Documents {...defaultProps} />)
      act(() => {
        void queryClient.invalidateQueries({
          queryKey: consoleQuery.datasets.byDatasetId.documents.get.key(),
        })
      })
      await waitFor(() => expect(getDocuments).toHaveBeenCalledOnce())
      expect(screen.getByTestId('documents-list')).toBeInTheDocument()
      expect(screen.getByTestId('list-documents-count')).toHaveTextContent('1')
    })

    it('should render empty element when no documents exist', () => {
      documentData = { data: [], total: 0, page: 1, limit: 10, has_more: false }

      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('empty-element')).toBeInTheDocument()
      expect(screen.getByTestId('empty-can-add')).toHaveTextContent('true')
      expect(screen.getByTestId('empty-type')).toHaveTextContent('upload')
    })

    it('should render sync type empty element for Notion data source', () => {
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation(
        (selector: MockSelector) => {
          const mockState = {
            dataset: {
              id: 'test-dataset-id',
              name: 'Test Dataset',
              embedding_available: true,
              data_source_type: DataSourceType.NOTION,
              runtime_mode: 'rag',
              created_by: 'test-user',
              permission_keys: ['dataset.acl.use', 'dataset.acl.edit'],
            },
          }
          return selector(mockState as MockState)
        },
      )
      documentData = { data: [], total: 0, page: 1, limit: 10, has_more: false }

      render(<Documents {...defaultProps} />)
      expect(screen.getByTestId('empty-type')).toHaveTextContent('sync')
    })
  })

  describe('Router Navigation', () => {
    it('should navigate to create page when add document is clicked', async () => {
      render(<Documents {...defaultProps} />)

      await userEvent
        .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
        .click(screen.getByTestId('add-document-btn'))

      expect(mockPush).toHaveBeenCalledWith('/datasets/test-dataset-id/documents/create')
    })

    it('should navigate to pipeline create page when dataset is rag_pipeline mode', async () => {
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation(
        (selector: MockSelector) => {
          const mockState = {
            dataset: {
              id: 'test-dataset-id',
              name: 'Test Dataset',
              embedding_available: true,
              data_source_type: DataSourceType.FILE,
              runtime_mode: 'rag_pipeline',
              created_by: 'test-user',
              permission_keys: ['dataset.acl.use', 'dataset.acl.edit'],
            },
          }
          return selector(mockState as MockState)
        },
      )

      render(<Documents {...defaultProps} />)

      await userEvent
        .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
        .click(screen.getByTestId('add-document-btn'))

      expect(mockPush).toHaveBeenCalledWith(
        '/datasets/test-dataset-id/documents/create-from-pipeline',
      )
    })

    it('should navigate from empty element add button', async () => {
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation(
        (selector: MockSelector) => {
          const mockState = {
            dataset: {
              id: 'test-dataset-id',
              name: 'Test Dataset',
              embedding_available: true,
              data_source_type: DataSourceType.FILE,
              runtime_mode: 'rag',
              created_by: 'test-user',
              permission_keys: ['dataset.acl.use', 'dataset.acl.edit'],
            },
          }
          return selector(mockState as MockState)
        },
      )
      documentData = { data: [], total: 0, page: 1, limit: 10, has_more: false }

      render(<Documents {...defaultProps} />)

      await userEvent
        .setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
        .click(screen.getByTestId('empty-add-btn'))

      expect(mockPush).toHaveBeenCalledWith('/datasets/test-dataset-id/documents/create')
    })
  })

  describe('polling', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('polls processing documents and stops after every document reaches a terminal state', async () => {
      vi.useFakeTimers()
      const completed = {
        ...defaultDocumentData,
        data: defaultDocumentData.data.map((document) => ({
          ...document,
          indexing_status: 'completed',
        })),
      }
      getDocuments.mockResolvedValue(completed)
      render(<Documents {...defaultProps} />)
      expect(getDocuments).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500)
      })
      expect(getDocuments).toHaveBeenCalledOnce()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000)
      })
      expect(getDocuments).toHaveBeenCalledOnce()
    })

    it('keeps polling a transient status filter even when its current result is empty', async () => {
      vi.useFakeTimers()
      const original = vi.mocked(useDocumentsPageState).getMockImplementation()!
      vi.mocked(useDocumentsPageState).mockImplementation(() => ({
        ...original(),
        normalizedStatusFilterValue: 'indexing',
        statusFilterValue: 'indexing',
      }))
      documentData = { data: [], total: 0, page: 1, limit: 10, has_more: false }
      getDocuments.mockResolvedValue(documentData)
      try {
        render(<Documents {...defaultProps} />)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000)
        })
        expect(getDocuments).toHaveBeenCalledTimes(2)
        expect(getDocuments).toHaveBeenLastCalledWith({
          params: { dataset_id: 'test-dataset-id' },
          query: expect.objectContaining({ status: 'indexing' }),
        })
      } finally {
        vi.mocked(useDocumentsPageState).mockImplementation(original)
      }
    })
  })

  describe('Mutation invalidation', () => {
    it('should handle update with delayed chunk invalidation', async () => {
      vi.useFakeTimers()

      render(<Documents {...defaultProps} />)
      act(() => fireEvent.click(screen.getByTestId('update-btn')))

      expectDocumentsInvalidated()

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      const documents = consoleQuery.datasets.byDatasetId.documents.byDocumentId
      const input = { params: { dataset_id: 'test-dataset-id' } }
      expect(QueryClient.prototype.invalidateQueries).toHaveBeenCalledWith({
        queryKey: documents.segments.get.key({ input }),
      })
      expect(QueryClient.prototype.invalidateQueries).toHaveBeenCalledWith({
        queryKey: documents.segments.bySegmentId.childChunks.get.key({ input }),
      })

      vi.useRealTimers()
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle embedding not available', () => {
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation(
        (selector: MockSelector) => {
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
        },
      )

      render(<Documents {...defaultProps} />)

      expect(screen.getByTestId('header-embedding-available')).toHaveTextContent('false')
    })
  })
})

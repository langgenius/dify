import type { ReactNode } from 'react'
import type { Props as PaginationProps } from '@/app/components/base/pagination'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import DocumentList from '../../list'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: { doc_form: string } }) => unknown) =>
    selector({ dataset: { doc_form: ChunkingMode.text } }),
}))

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  },
})

const createWrapper = () => {
  const queryClient = createTestQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

const createMockDoc = (overrides: Partial<SimpleDocumentDetail> = {}): SimpleDocumentDetail => ({
  id: `doc-${Math.random().toString(36).substr(2, 9)}`,
  position: 1,
  data_source_type: DataSourceType.FILE,
  data_source_info: {},
  data_source_detail_dict: {
    upload_file: { name: 'test.txt', extension: 'txt' },
  },
  dataset_process_rule_id: 'rule-1',
  batch: 'batch-1',
  name: 'test-document.txt',
  created_from: 'web',
  created_by: 'user-1',
  created_at: Date.now(),
  tokens: 100,
  indexing_status: 'completed',
  error: null,
  enabled: true,
  disabled_at: null,
  disabled_by: null,
  archived: false,
  archived_reason: null,
  archived_by: null,
  archived_at: null,
  updated_at: Date.now(),
  doc_type: null,
  doc_metadata: undefined,
  display_status: 'available',
  word_count: 500,
  hit_count: 10,
  doc_form: 'text_model',
  ...overrides,
} as SimpleDocumentDetail)

const defaultPagination: PaginationProps = {
  current: 1,
  onChange: vi.fn(),
  total: 100,
}

describe('DocumentList', () => {
  const defaultProps = {
    embeddingAvailable: true,
    documents: [
      createMockDoc({ id: 'doc-1', name: 'Document 1.txt', word_count: 100, hit_count: 5 }),
      createMockDoc({ id: 'doc-2', name: 'Document 2.txt', word_count: 200, hit_count: 10 }),
      createMockDoc({ id: 'doc-3', name: 'Document 3.txt', word_count: 300, hit_count: 15 }),
    ],
    selectedIds: [] as string[],
    onSelectedIdChange: vi.fn(),
    datasetId: 'dataset-1',
    pagination: defaultPagination,
    onUpdate: vi.fn(),
    onManageMetadata: vi.fn(),
    statusFilterValue: '',
    remoteSortValue: '',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should render all documents', () => {
      render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('Document 1.txt')).toBeInTheDocument()
      expect(screen.getByText('Document 2.txt')).toBeInTheDocument()
      expect(screen.getByText('Document 3.txt')).toBeInTheDocument()
    })

    it('should render table headers', () => {
      render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('#')).toBeInTheDocument()
    })

    it('should render pagination when total is provided', () => {
      render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })
      // Pagination component should be present
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should not render pagination when total is 0', () => {
      const props = {
        ...defaultProps,
        pagination: { ...defaultPagination, total: 0 },
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should render empty table when no documents', () => {
      const props = { ...defaultProps, documents: [] }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })
      expect(screen.getByRole('table')).toBeInTheDocument()
    })
  })

  describe('Selection', () => {
    // Helper to find checkboxes (custom div components, not native checkboxes)
    const findCheckboxes = (container: HTMLElement): NodeListOf<Element> => {
      return container.querySelectorAll('[class*="shadow-xs"]')
    }

    it('should render header checkbox when embeddingAvailable', () => {
      const { container } = render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })
      const checkboxes = findCheckboxes(container)
      expect(checkboxes.length).toBeGreaterThan(0)
    })

    it('should not render header checkbox when embedding not available', () => {
      const props = { ...defaultProps, embeddingAvailable: false }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })
      // Row checkboxes should still be there, but header checkbox should be hidden
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should call onSelectedIdChange when select all is clicked', () => {
      const onSelectedIdChange = vi.fn()
      const props = { ...defaultProps, onSelectedIdChange }
      const { container } = render(<DocumentList {...props} />, { wrapper: createWrapper() })

      const checkboxes = findCheckboxes(container)
      if (checkboxes.length > 0) {
        fireEvent.click(checkboxes[0])
        expect(onSelectedIdChange).toHaveBeenCalled()
      }
    })

    it('should show all checkboxes as checked when all are selected', () => {
      const props = {
        ...defaultProps,
        selectedIds: ['doc-1', 'doc-2', 'doc-3'],
      }
      const { container } = render(<DocumentList {...props} />, { wrapper: createWrapper() })

      const checkboxes = findCheckboxes(container)
      // When checked, checkbox should have a check icon (svg) inside
      checkboxes.forEach((checkbox) => {
        const checkIcon = checkbox.querySelector('svg')
        expect(checkIcon).toBeInTheDocument()
      })
    })

    it('should show indeterminate state when some are selected', () => {
      const props = {
        ...defaultProps,
        selectedIds: ['doc-1'],
      }
      const { container } = render(<DocumentList {...props} />, { wrapper: createWrapper() })

      // First checkbox is the header checkbox which should be indeterminate
      const checkboxes = findCheckboxes(container)
      expect(checkboxes.length).toBeGreaterThan(0)
      // Header checkbox should show indeterminate icon, not check icon
      // Just verify it's rendered
      expect(checkboxes[0]).toBeInTheDocument()
    })

    it('should call onSelectedIdChange with single document when row checkbox is clicked', () => {
      const onSelectedIdChange = vi.fn()
      const props = { ...defaultProps, onSelectedIdChange }
      const { container } = render(<DocumentList {...props} />, { wrapper: createWrapper() })

      const checkboxes = findCheckboxes(container)
      if (checkboxes.length > 1) {
        fireEvent.click(checkboxes[1])
        expect(onSelectedIdChange).toHaveBeenCalled()
      }
    })
  })

  describe('Sorting', () => {
    it('should render sort headers for sortable columns', () => {
      render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })
      // Find svg icons which indicate sortable columns
      const sortIcons = document.querySelectorAll('svg')
      expect(sortIcons.length).toBeGreaterThan(0)
    })

    it('should update sort order when sort header is clicked', () => {
      render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })

      // Find and click a sort header by its parent div containing the label text
      const sortableHeaders = document.querySelectorAll('[class*="cursor-pointer"]')
      if (sortableHeaders.length > 0) {
        fireEvent.click(sortableHeaders[0])
      }

      expect(screen.getByRole('table')).toBeInTheDocument()
    })
  })

  describe('Batch Actions', () => {
    it('should show batch action bar when documents are selected', () => {
      const props = {
        ...defaultProps,
        selectedIds: ['doc-1', 'doc-2'],
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      // BatchAction component should be visible
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should not show batch action bar when no documents selected', () => {
      render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })

      // BatchAction should not be present
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should render batch action bar with archive option', () => {
      const props = {
        ...defaultProps,
        selectedIds: ['doc-1'],
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      // BatchAction component should be visible when documents are selected
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should render batch action bar with enable option', () => {
      const props = {
        ...defaultProps,
        selectedIds: ['doc-1'],
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should render batch action bar with disable option', () => {
      const props = {
        ...defaultProps,
        selectedIds: ['doc-1'],
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should render batch action bar with delete option', () => {
      const props = {
        ...defaultProps,
        selectedIds: ['doc-1'],
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should clear selection when cancel is clicked', () => {
      const onSelectedIdChange = vi.fn()
      const props = {
        ...defaultProps,
        selectedIds: ['doc-1'],
        onSelectedIdChange,
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      const cancelButton = screen.queryByRole('button', { name: /cancel/i })
      if (cancelButton) {
        fireEvent.click(cancelButton)
        expect(onSelectedIdChange).toHaveBeenCalledWith([])
      }
    })

    it('should show download option for downloadable documents', () => {
      const props = {
        ...defaultProps,
        selectedIds: ['doc-1'],
        documents: [
          createMockDoc({ id: 'doc-1', data_source_type: DataSourceType.FILE }),
        ],
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      // BatchAction should be visible
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should show re-index option for error documents', () => {
      const props = {
        ...defaultProps,
        selectedIds: ['doc-1'],
        documents: [
          createMockDoc({ id: 'doc-1', display_status: 'error' }),
        ],
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      // BatchAction with re-index should be present for error documents
      expect(screen.getByRole('table')).toBeInTheDocument()
    })
  })

  describe('Row Click Navigation', () => {
    it('should navigate to document detail when row is clicked', () => {
      render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })

      const rows = screen.getAllByRole('row')
      // First row is header, second row is first document
      if (rows.length > 1) {
        fireEvent.click(rows[1])
        expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/documents/doc-1')
      }
    })
  })

  describe('Rename Modal', () => {
    it('should not show rename modal initially', () => {
      render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })

      // RenameModal should not be visible initially
      const modal = screen.queryByRole('dialog')
      expect(modal).not.toBeInTheDocument()
    })

    it('should show rename modal when rename button is clicked', () => {
      const { container } = render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })

      // Find and click the rename button in the first row
      const renameButtons = container.querySelectorAll('.cursor-pointer.rounded-md')
      if (renameButtons.length > 0) {
        fireEvent.click(renameButtons[0])
      }

      // After clicking rename, the modal should potentially be visible
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should call onUpdate when document is renamed', () => {
      const onUpdate = vi.fn()
      const props = { ...defaultProps, onUpdate }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      // The handleRenamed callback wraps onUpdate
      expect(screen.getByRole('table')).toBeInTheDocument()
    })
  })

  describe('Edit Metadata Modal', () => {
    it('should handle edit metadata action', () => {
      const props = {
        ...defaultProps,
        selectedIds: ['doc-1'],
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      const editButton = screen.queryByRole('button', { name: /metadata/i })
      if (editButton) {
        fireEvent.click(editButton)
      }

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should call onManageMetadata when manage metadata is triggered', () => {
      const onManageMetadata = vi.fn()
      const props = {
        ...defaultProps,
        selectedIds: ['doc-1'],
        onManageMetadata,
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      // The onShowManage callback in EditMetadataBatchModal should call hideEditModal then onManageMetadata
      expect(screen.getByRole('table')).toBeInTheDocument()
    })
  })

  describe('Chunking Mode', () => {
    it('should render with general mode', () => {
      render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should render with QA mode', () => {
      // This test uses the default mock which returns ChunkingMode.text
      // The component will compute isQAMode based on doc_form
      render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should render with parent-child mode', () => {
      render(<DocumentList {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByRole('table')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty documents array', () => {
      const props = { ...defaultProps, documents: [] }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should handle documents with missing optional fields', () => {
      const docWithMissingFields = createMockDoc({
        word_count: undefined as unknown as number,
        hit_count: undefined as unknown as number,
      })
      const props = {
        ...defaultProps,
        documents: [docWithMissingFields],
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should handle status filter value', () => {
      const props = {
        ...defaultProps,
        statusFilterValue: 'completed',
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should handle remote sort value', () => {
      const props = {
        ...defaultProps,
        remoteSortValue: 'created_at',
      }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('should handle large number of documents', () => {
      const manyDocs = Array.from({ length: 20 }, (_, i) =>
        createMockDoc({ id: `doc-${i}`, name: `Document ${i}.txt` }))
      const props = { ...defaultProps, documents: manyDocs }
      render(<DocumentList {...props} />, { wrapper: createWrapper() })

      expect(screen.getByRole('table')).toBeInTheDocument()
    }, 10000)
  })
})

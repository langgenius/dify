import type { SimpleDocumentDetail } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDocumentSort } from '../document-list/hooks'
import DocumentList from '../list'

// Mock hooks used by DocumentList
const mockHandleSort = vi.fn()
const mockOnSelectAll = vi.fn()
const mockOnSelectOne = vi.fn()
const mockClearSelection = vi.fn()
const mockHandleAction = vi.fn(() => vi.fn())
const mockHandleBatchReIndex = vi.fn()
const mockHandleBatchDownload = vi.fn()
const mockShowEditModal = vi.fn()
const mockHideEditModal = vi.fn()
const mockHandleSave = vi.fn()

vi.mock('../document-list/hooks', () => ({
  useDocumentSort: vi.fn(() => ({
    sortField: null,
    sortOrder: null,
    handleSort: mockHandleSort,
    sortedDocuments: [],
  })),
  useDocumentSelection: vi.fn(() => ({
    isAllSelected: false,
    isSomeSelected: false,
    onSelectAll: mockOnSelectAll,
    onSelectOne: mockOnSelectOne,
    hasErrorDocumentsSelected: false,
    downloadableSelectedIds: [],
    clearSelection: mockClearSelection,
  })),
  useDocumentActions: vi.fn(() => ({
    handleAction: mockHandleAction,
    handleBatchReIndex: mockHandleBatchReIndex,
    handleBatchDownload: mockHandleBatchDownload,
  })),
}))

vi.mock('@/app/components/datasets/metadata/hooks/use-batch-edit-document-metadata', () => ({
  default: vi.fn(() => ({
    isShowEditModal: false,
    showEditModal: mockShowEditModal,
    hideEditModal: mockHideEditModal,
    originalList: [],
    handleSave: mockHandleSave,
  })),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: () => ({
    doc_form: 'text_model',
  }),
}))

// Mock child components that are complex
vi.mock('../document-list/components', () => ({
  DocumentTableRow: ({ doc, index }: { doc: SimpleDocumentDetail, index: number }) => (
    <tr data-testid={`doc-row-${doc.id}`}>
      <td>{index + 1}</td>
      <td>{doc.name}</td>
    </tr>
  ),
  renderTdValue: (val: string) => val || '-',
  SortHeader: ({ field, label, onSort }: { field: string, label: string, onSort: (f: string) => void }) => (
    <button data-testid={`sort-${field}`} onClick={() => onSort(field)}>{label}</button>
  ),
}))

vi.mock('../../detail/completed/common/batch-action', () => ({
  default: ({ selectedIds, onCancel }: { selectedIds: string[], onCancel: () => void }) => (
    <div data-testid="batch-action">
      <span data-testid="selected-count">{selectedIds.length}</span>
      <button data-testid="cancel-selection" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

vi.mock('../../rename-modal', () => ({
  default: ({ name, onClose }: { name: string, onClose: () => void }) => (
    <div data-testid="rename-modal">
      <span>{name}</span>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/datasets/metadata/edit-metadata-batch/modal', () => ({
  default: ({ onHide }: { onHide: () => void }) => (
    <div data-testid="edit-metadata-modal">
      <button onClick={onHide}>Hide</button>
    </div>
  ),
}))

function createDoc(overrides: Partial<SimpleDocumentDetail> = {}): SimpleDocumentDetail {
  return {
    id: `doc-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Doc',
    position: 1,
    data_source_type: 'upload_file',
    word_count: 100,
    hit_count: 5,
    indexing_status: 'completed',
    enabled: true,
    disabled_at: null,
    disabled_by: null,
    archived: false,
    display_status: 'available',
    created_from: 'web',
    created_at: 1234567890,
    ...overrides,
  } as SimpleDocumentDetail
}

const defaultProps = {
  embeddingAvailable: true,
  documents: [] as SimpleDocumentDetail[],
  selectedIds: [] as string[],
  onSelectedIdChange: vi.fn(),
  datasetId: 'ds-1',
  pagination: { total: 0, current: 1, limit: 10, onChange: vi.fn() },
  onUpdate: vi.fn(),
  onManageMetadata: vi.fn(),
  statusFilterValue: 'all',
  remoteSortValue: '',
}

describe('DocumentList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verify the table renders with column headers
  describe('Rendering', () => {
    it('should render the document table with headers', () => {
      render(<DocumentList {...defaultProps} />)

      expect(screen.getByText('#')).toBeInTheDocument()
      expect(screen.getByTestId('sort-name')).toBeInTheDocument()
      expect(screen.getByTestId('sort-word_count')).toBeInTheDocument()
      expect(screen.getByTestId('sort-hit_count')).toBeInTheDocument()
      expect(screen.getByTestId('sort-created_at')).toBeInTheDocument()
    })

    it('should render select-all area when embeddingAvailable is true', () => {
      const { container } = render(<DocumentList {...defaultProps} embeddingAvailable={true} />)

      // Checkbox component renders inside the first td
      const firstTd = container.querySelector('thead td')
      expect(firstTd?.textContent).toContain('#')
    })

    it('should still render # column when embeddingAvailable is false', () => {
      const { container } = render(<DocumentList {...defaultProps} embeddingAvailable={false} />)

      const firstTd = container.querySelector('thead td')
      expect(firstTd?.textContent).toContain('#')
    })

    it('should render document rows from sortedDocuments', () => {
      const docs = [createDoc({ id: 'a', name: 'Doc A' }), createDoc({ id: 'b', name: 'Doc B' })]
      vi.mocked(useDocumentSort).mockReturnValue({
        sortField: null,
        sortOrder: 'desc',
        handleSort: mockHandleSort,
        sortedDocuments: docs,
      } as unknown as ReturnType<typeof useDocumentSort>)

      render(<DocumentList {...defaultProps} documents={docs} />)

      expect(screen.getByTestId('doc-row-a')).toBeInTheDocument()
      expect(screen.getByTestId('doc-row-b')).toBeInTheDocument()
    })
  })

  // Verify sort headers trigger sort handler
  describe('Sorting', () => {
    it('should call handleSort when sort header is clicked', () => {
      render(<DocumentList {...defaultProps} />)

      fireEvent.click(screen.getByTestId('sort-name'))

      expect(mockHandleSort).toHaveBeenCalledWith('name')
    })
  })

  // Verify batch action bar appears when items selected
  describe('Batch Actions', () => {
    it('should show batch action bar when selectedIds is non-empty', () => {
      render(<DocumentList {...defaultProps} selectedIds={['doc-1']} />)

      expect(screen.getByTestId('batch-action')).toBeInTheDocument()
      expect(screen.getByTestId('selected-count')).toHaveTextContent('1')
    })

    it('should not show batch action bar when no items selected', () => {
      render(<DocumentList {...defaultProps} selectedIds={[]} />)

      expect(screen.queryByTestId('batch-action')).not.toBeInTheDocument()
    })

    it('should call clearSelection when cancel is clicked in batch bar', () => {
      render(<DocumentList {...defaultProps} selectedIds={['doc-1']} />)

      fireEvent.click(screen.getByTestId('cancel-selection'))

      expect(mockClearSelection).toHaveBeenCalled()
    })
  })

  // Verify pagination renders when total > 0
  describe('Pagination', () => {
    it('should not render pagination when total is 0', () => {
      const { container } = render(<DocumentList {...defaultProps} />)

      expect(container.querySelector('[class*="pagination"]')).not.toBeInTheDocument()
    })
  })

  // Verify empty state
  describe('Edge Cases', () => {
    it('should render table with no document rows when sortedDocuments is empty', () => {
      // Reset sort mock to return empty sorted list
      vi.mocked(useDocumentSort).mockReturnValue({
        sortField: null,
        sortOrder: 'desc',
        handleSort: mockHandleSort,
        sortedDocuments: [],
      } as unknown as ReturnType<typeof useDocumentSort>)

      render(<DocumentList {...defaultProps} documents={[]} />)

      expect(screen.queryByTestId(/^doc-row-/)).not.toBeInTheDocument()
    })
  })
})

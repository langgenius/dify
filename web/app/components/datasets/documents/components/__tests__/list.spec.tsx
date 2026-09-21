import type { SimpleDocumentDetail } from '@/models/datasets'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithAccountProfile as render } from '@/test/console/account-profile'
import DocumentList from '../list'

// Mock hooks used by DocumentList
const mockClearSelection = vi.fn()
const mockHandleAction = vi.fn(() => vi.fn())
const mockHandleBatchReIndex = vi.fn()
const mockHandleBatchDownload = vi.fn()
const mockShowEditModal = vi.fn()
const mockHideEditModal = vi.fn()
const mockHandleSave = vi.fn()

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('../document-list/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../document-list/hooks')>()),
  useDocumentSelection: vi.fn(() => ({
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
vi.mock('../document-list/components', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../document-list/components')>()),
  DocumentTableRow: ({ doc, index }: { doc: SimpleDocumentDetail; index: number }) => (
    <tr data-testid={`doc-row-${doc.id}`}>
      <td>{index + 1}</td>
      <td>{doc.name}</td>
    </tr>
  ),
}))

vi.mock('../../detail/completed/common/batch-action', () => ({
  default: ({ selectedIds, onCancel }: { selectedIds: string[]; onCancel: () => void }) => (
    <div data-testid="batch-action">
      <span data-testid="selected-count">{selectedIds.length}</span>
      <button data-testid="cancel-selection" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}))

vi.mock('../../rename-modal', () => ({
  default: ({ name, onClose }: { name: string; onClose: () => void }) => (
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
  remoteSortValue: '-created_at',
  onSortChange: vi.fn(),
}

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

describe('DocumentList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verify the table renders with column headers
  describe('Rendering', () => {
    it('should render the document table with headers', () => {
      render(<DocumentList {...defaultProps} />)

      expect(screen.getAllByRole('columnheader')).toHaveLength(8)
      expect(
        screen.getByRole('columnheader', { name: 'datasetDocuments.list.table.header.fileName' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'datasetDocuments.list.table.header.hitCount' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'datasetDocuments.list.table.header.uploadTime' }),
      ).toBeInTheDocument()
    })

    it('should render select-all area when embeddingAvailable is true', () => {
      render(<DocumentList {...defaultProps} embeddingAvailable={true} />)

      expect(
        screen.getByRole('checkbox', { name: 'common.operation.selectAll' }),
      ).toBeInTheDocument()
    })

    it('should still render # column when embeddingAvailable is false', () => {
      render(<DocumentList {...defaultProps} embeddingAvailable={false} />)

      expect(screen.getByRole('columnheader', { name: '#' })).toBeInTheDocument()
    })

    it('should render document rows from sortedDocuments', () => {
      const docs = [createDoc({ id: 'a', name: 'Doc A' }), createDoc({ id: 'b', name: 'Doc B' })]
      render(<DocumentList {...defaultProps} documents={docs} />)

      expect(screen.getByTestId('doc-row-a')).toBeInTheDocument()
      expect(screen.getByTestId('doc-row-b')).toBeInTheDocument()
    })

    it('should call onSelectedIdChange when select-all is clicked', () => {
      const docs = [createDoc({ id: 'a', name: 'Doc A' }), createDoc({ id: 'b', name: 'Doc B' })]
      const onSelectedIdChange = vi.fn()

      render(
        <DocumentList {...defaultProps} documents={docs} onSelectedIdChange={onSelectedIdChange} />,
      )

      fireEvent.click(screen.getByRole('checkbox', { name: 'common.operation.selectAll' }))

      expect(onSelectedIdChange).toHaveBeenCalledWith(['a', 'b'])
    })
  })

  it('exposes sorting only on the current column and supports keyboard activation', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DocumentList {...defaultProps} embeddingAvailable={false} />)
    const uploadedHeader = screen.getByRole('columnheader', {
      name: 'datasetDocuments.list.table.header.uploadTime',
    })
    const hitsHeader = screen.getByRole('columnheader', {
      name: 'datasetDocuments.list.table.header.hitCount',
    })
    expect(uploadedHeader).toHaveAttribute('aria-sort', 'descending')
    expect(hitsHeader).not.toHaveAttribute('aria-sort')

    await user.tab()
    expect(
      screen.getByRole('button', { name: 'datasetDocuments.list.table.header.hitCount' }),
    ).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(defaultProps.onSortChange).toHaveBeenLastCalledWith('-hit_count')

    rerender(
      <DocumentList {...defaultProps} embeddingAvailable={false} remoteSortValue="-hit_count" />,
    )
    expect(hitsHeader).toHaveAttribute('aria-sort', 'descending')
    expect(uploadedHeader).not.toHaveAttribute('aria-sort')

    await user.keyboard(' ')
    expect(defaultProps.onSortChange).toHaveBeenLastCalledWith('hit_count')

    rerender(
      <DocumentList {...defaultProps} embeddingAvailable={false} remoteSortValue="hit_count" />,
    )
    expect(hitsHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(uploadedHeader).not.toHaveAttribute('aria-sort')

    await user.click(
      screen.getByRole('button', { name: 'datasetDocuments.list.table.header.uploadTime' }),
    )
    expect(defaultProps.onSortChange).toHaveBeenLastCalledWith('-created_at')

    rerender(
      <DocumentList {...defaultProps} embeddingAvailable={false} remoteSortValue="-created_at" />,
    )
    expect(uploadedHeader).toHaveAttribute('aria-sort', 'descending')
    expect(hitsHeader).not.toHaveAttribute('aria-sort')

    await user.keyboard('{Enter}')
    expect(defaultProps.onSortChange).toHaveBeenLastCalledWith('created_at')

    rerender(
      <DocumentList {...defaultProps} embeddingAvailable={false} remoteSortValue="created_at" />,
    )
    expect(uploadedHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(hitsHeader).not.toHaveAttribute('aria-sort')
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
      render(<DocumentList {...defaultProps} documents={[]} />)

      expect(screen.queryByTestId(/^doc-row-/)).not.toBeInTheDocument()
    })
  })
})

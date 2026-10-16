import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { renderWithAccountProfile as render } from '@/test/console/account-profile'
import { DatasetACLPermission } from '@/utils/permission'

// --- All hoisted mock fns and state (accessible inside vi.mock factories) ---
const mocks = vi.hoisted(() => {
  const state = {
    dataset: { embedding_available: true, permission_keys: ['dataset.acl.edit'] } as Record<
      string,
      unknown
    > | null,
    documentDetail: null as Record<string, unknown> | null,
    documentError: null as Error | null,
    documentMetadata: null as Record<string, unknown> | null,
    media: 'desktop' as string,
    searchParams: '' as string,
  }
  return {
    state,
    push: vi.fn(),
    detailRefetch: vi.fn(),
    checkProgress: vi.fn(),
    batchImport: vi.fn(),
    useDocumentTitle: vi.fn(),
    toastNotify: vi.fn(),
  }
})

// --- External mocks ---
vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(mocks.state.searchParams),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => mocks.state.media,
  MediaType: { mobile: 'mobile', tablet: 'tablet', pc: 'desktop' },
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: mocks.useDocumentTitle,
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ dataset: mocks.state.dataset }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'datasets.byDatasetId.documents.byDocumentId.get': (options: {
      input: { query: { metadata: string } }
    }) =>
      options.input.query.metadata === 'only'
        ? { data: mocks.state.documentMetadata }
        : {
            data: mocks.state.documentDetail,
            error: mocks.state.documentError,
            refetch: mocks.detailRefetch,
          },
    'datasets.batchImportStatus.byJobId.get': () => ({ mutateAsync: mocks.checkProgress }),
    'datasets.byDatasetId.documents.byDocumentId.segments.batchImport.post': () => ({
      mutateAsync: mocks.batchImport,
    }),
  })
})

vi.mock('@/app/notifications', () => ({
  default: { notify: mocks.toastNotify },
}))

// --- Child component mocks ---
vi.mock('../completed', () => ({
  default: ({
    embeddingAvailable,
    showNewSegmentModal,
    archived,
  }: {
    embeddingAvailable?: boolean
    showNewSegmentModal?: () => void
    archived?: boolean
  }) => (
    <div
      data-testid="completed"
      data-embedding-available={embeddingAvailable}
      data-show-new-segment={showNewSegmentModal}
      data-archived={archived}
    >
      Completed
    </div>
  ),
}))

vi.mock('../embedding', () => ({
  default: ({ detailUpdate }: { detailUpdate?: () => void }) => (
    <div data-testid="embedding">
      <button data-testid="embedding-refresh" onClick={detailUpdate}>
        Refresh
      </button>
    </div>
  ),
}))

vi.mock('../batch-modal', () => ({
  default: ({
    isShow,
    onCancel,
    onConfirm,
  }: {
    isShow?: boolean
    onCancel?: () => void
    onConfirm?: (val: Record<string, unknown>) => void
  }) =>
    isShow ? (
      <div data-testid="batch-modal">
        <button data-testid="batch-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button data-testid="batch-confirm" onClick={() => onConfirm?.({ file: { id: 'file-1' } })}>
          Confirm
        </button>
      </div>
    ) : null,
}))

vi.mock('../document-title', () => ({
  DocumentTitle: ({
    document,
  }: {
    document?: {
      name?: string
      data_source_detail_dict?: { upload_file?: { extension?: string } }
      data_source_info?: { upload_file?: { extension?: string } }
    } | null
  }) => {
    const extension =
      document?.data_source_detail_dict?.upload_file?.extension ??
      document?.data_source_info?.upload_file?.extension

    return (
      <div data-testid="document-title" data-extension={extension}>
        {document?.name}
      </div>
    )
  },
}))

vi.mock('../segment-add', () => ({
  SegmentAdd: ({
    showNewSegmentModal,
    showBatchModal,
    embedding,
  }: {
    showNewSegmentModal?: () => void
    showBatchModal?: () => void
    embedding?: boolean
  }) => (
    <div data-testid="segment-add" data-embedding={embedding}>
      <button data-testid="new-segment-btn" onClick={showNewSegmentModal}>
        New Segment
      </button>
      <button data-testid="batch-btn" onClick={showBatchModal}>
        Batch Import
      </button>
    </div>
  ),
}))

vi.mock('../../components/operations', () => ({
  default: ({ onUpdate, scene }: { onUpdate?: (action?: string) => void; scene?: string }) => (
    <div data-testid="operations" data-scene={scene}>
      <button data-testid="op-rename" onClick={() => onUpdate?.('rename')}>
        Rename
      </button>
      <button data-testid="op-delete" onClick={() => onUpdate?.('delete')}>
        Delete
      </button>
      <button data-testid="op-noop" onClick={() => onUpdate?.()}>
        NoOp
      </button>
    </div>
  ),
}))

vi.mock('../../status-item', () => ({
  default: ({ status, scene }: { status?: string; scene?: string }) => (
    <div data-testid="status-item" data-scene={scene}>
      {status}
    </div>
  ),
}))

vi.mock('@/app/components/datasets/metadata/metadata-document', () => ({
  default: ({
    datasetId,
    documentId,
    canEdit,
  }: {
    datasetId?: string
    documentId?: string
    canEdit?: boolean
  }) => (
    <div
      data-testid="metadata"
      data-dataset-id={datasetId}
      data-document-id={documentId}
      data-can-edit={String(canEdit)}
    >
      Metadata
    </div>
  ),
}))

vi.mock('@/app/components/base/float-right-container', () => ({
  default: ({
    children,
    isOpen,
    onClose,
  }: {
    children?: React.ReactNode
    isOpen?: boolean
    onClose?: () => void
  }) =>
    isOpen ? (
      <div data-testid="float-right-container">
        <button data-testid="close-metadata" onClick={onClose}>
          Close
        </button>
        {children}
      </div>
    ) : null,
}))

const expectDocumentListInvalidated = () =>
  expect(QueryClient.prototype.invalidateQueries).toHaveBeenCalledWith({
    queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
      input: { params: { dataset_id: 'ds-1' } },
    }),
  })

const segmentListKey = consoleQuery.datasets.byDatasetId.documents.byDocumentId.segments.get.key({
  input: { params: { dataset_id: 'ds-1', document_id: 'doc-1' } },
})
const childChunkListKey =
  consoleQuery.datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.get.key(
    {
      input: { params: { dataset_id: 'ds-1', document_id: 'doc-1' } },
    },
  )

// --- Lazy import (after all vi.mock calls) ---
const { default: DocumentDetail } = await import('../index')

// --- Factory ---
const createDocumentDetail = (overrides?: Record<string, unknown>) => ({
  name: 'test-doc.txt',
  display_status: 'available',
  enabled: true,
  archived: false,
  doc_form: 'text_model',
  data_source_type: 'upload_file',
  data_source_info: { upload_file: { extension: '.txt' } },
  error: '',
  document_process_rule: null,
  dataset_process_rule: null,
  ...overrides,
})

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

describe('DocumentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    vi.useFakeTimers()
    mocks.state.dataset = {
      embedding_available: true,
      name: 'Dataset 1',
      permission_keys: [DatasetACLPermission.Edit],
    }
    mocks.state.documentDetail = createDocumentDetail()
    mocks.state.documentError = null
    mocks.state.documentMetadata = null
    mocks.state.media = 'desktop'
    mocks.state.searchParams = ''
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Loading State', () => {
    it('should show loading when no data and no error', () => {
      mocks.state.documentDetail = null
      mocks.state.documentError = null
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.queryByTestId('completed')).not.toBeInTheDocument()
      expect(screen.queryByTestId('embedding')).not.toBeInTheDocument()
    })

    it('should not show loading when error exists', () => {
      mocks.state.documentDetail = null
      mocks.state.documentError = new Error('Not found')
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('completed')).toBeInTheDocument()
    })
  })

  describe('Content Rendering', () => {
    it('uses the document and knowledge names in the document title', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)

      expect(mocks.useDocumentTitle).toHaveBeenLastCalledWith('test-doc.txt · Dataset 1')
    })

    it('should render Completed when status is available', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('completed')).toBeInTheDocument()
      expect(screen.queryByTestId('embedding')).not.toBeInTheDocument()
    })

    it.each(['queuing', 'indexing', 'paused'])(
      'should render Embedding when status is %s',
      (status) => {
        mocks.state.documentDetail = createDocumentDetail({ display_status: status })
        render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
        expect(screen.getByTestId('embedding')).toBeInTheDocument()
        expect(screen.queryByTestId('completed')).not.toBeInTheDocument()
      },
    )

    it('should render DocumentTitle with name and extension', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const title = screen.getByTestId('document-title')
      expect(title).toHaveTextContent('test-doc.txt')
      expect(title).toHaveAttribute('data-extension', '.txt')
    })

    it('should render StatusItem with correct status and scene', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const statusItem = screen.getByTestId('status-item')
      expect(statusItem).toHaveTextContent('available')
      expect(statusItem).toHaveAttribute('data-scene', 'detail')
    })

    it('should render Operations with scene=detail', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('operations')).toHaveAttribute('data-scene', 'detail')
    })
  })

  describe('SegmentAdd Visibility', () => {
    it('should show SegmentAdd when all conditions met', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('segment-add')).toBeInTheDocument()
    })

    it('should hide SegmentAdd when embedding is not available', () => {
      mocks.state.dataset = { embedding_available: false }
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.queryByTestId('segment-add')).not.toBeInTheDocument()
    })

    it('should hide SegmentAdd when document is archived', () => {
      mocks.state.documentDetail = createDocumentDetail({ archived: true })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.queryByTestId('segment-add')).not.toBeInTheDocument()
    })

    it('should hide SegmentAdd in full-doc parent-child mode', () => {
      mocks.state.documentDetail = createDocumentDetail({
        doc_form: 'hierarchical_model',
        document_process_rule: { rules: { parent_mode: 'full-doc' } },
      })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.queryByTestId('segment-add')).not.toBeInTheDocument()
    })

    it('should hide SegmentAdd when dataset only has readonly ACL permission', () => {
      mocks.state.dataset = {
        embedding_available: true,
        permission_keys: [DatasetACLPermission.Readonly],
      }
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.queryByTestId('segment-add')).not.toBeInTheDocument()
    })
  })

  describe('Metadata Panel', () => {
    it('should show metadata panel by default on desktop', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('float-right-container')).toBeInTheDocument()
      expect(screen.getByTestId('metadata')).toBeInTheDocument()
    })

    it('should toggle metadata panel when button clicked', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('metadata')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /metadata\.title/ }))
      expect(screen.queryByTestId('metadata')).not.toBeInTheDocument()
    })

    it('should expose aria semantics for metadata toggle button', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const toggle = screen.getByRole('button', { name: /metadata\.title/ })
      expect(toggle).toHaveAttribute('aria-label')
      expect(toggle).toHaveAttribute('aria-expanded', 'true')

      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('should pass correct props to Metadata', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const metadata = screen.getByTestId('metadata')
      expect(metadata).toHaveAttribute('data-dataset-id', 'ds-1')
      expect(metadata).toHaveAttribute('data-document-id', 'doc-1')
      expect(metadata).toHaveAttribute('data-can-edit', 'true')
    })

    it('should pass readonly ACL state to Metadata', () => {
      mocks.state.dataset = {
        embedding_available: true,
        permission_keys: [DatasetACLPermission.Readonly],
      }
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)

      expect(screen.getByTestId('metadata')).toHaveAttribute('data-can-edit', 'false')
    })
  })

  describe('Navigation', () => {
    it('should navigate back when back button clicked', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.back' }))
      expect(mocks.push).toHaveBeenCalledWith('/datasets/ds-1/documents')
    })

    it('should expose aria label for back button', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByRole('button', { name: 'common.operation.back' })).toHaveAttribute(
        'aria-label',
      )
    })

    it('should preserve query params when navigating back', () => {
      mocks.state.searchParams = 'page=2&status=active'
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.back' }))
      expect(mocks.push).toHaveBeenCalledWith('/datasets/ds-1/documents?page=2&status=active')
    })
  })

  describe('handleOperate', () => {
    it('should invalidate document list on any operation', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByTestId('op-rename'))
      expectDocumentListInvalidated()
    })

    it('should navigate back on delete operation', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByTestId('op-delete'))
      expectDocumentListInvalidated()
      expect(mocks.push).toHaveBeenCalled()
    })

    it('should refresh detail on non-delete operation', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByTestId('op-rename'))
      expect(mocks.detailRefetch).toHaveBeenCalled()
    })

    it('should invalidate chunk lists after 5s on named non-delete operation', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByTestId('op-rename'))

      expect(QueryClient.prototype.invalidateQueries).not.toHaveBeenCalledWith({
        queryKey: segmentListKey,
      })
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(QueryClient.prototype.invalidateQueries).toHaveBeenCalledWith({
        queryKey: segmentListKey,
      })
      expect(QueryClient.prototype.invalidateQueries).toHaveBeenCalledWith({
        queryKey: childChunkListKey,
      })
    })

    it('should not invalidate chunk lists on operation with no name', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByTestId('op-noop'))

      expect(mocks.detailRefetch).toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(QueryClient.prototype.invalidateQueries).not.toHaveBeenCalledWith({
        queryKey: segmentListKey,
      })
    })
  })

  describe('Batch Import', () => {
    it('should open batch modal when batch button clicked', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.queryByTestId('batch-modal')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('batch-btn'))
      expect(screen.getByTestId('batch-modal')).toBeInTheDocument()
    })

    it('should close batch modal when cancel clicked', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByTestId('batch-btn'))
      expect(screen.getByTestId('batch-modal')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('batch-cancel'))
      expect(screen.queryByTestId('batch-modal')).not.toBeInTheDocument()
    })

    it('should call segmentBatchImport on confirm', async () => {
      mocks.batchImport.mockResolvedValue({ job_id: 'job-1', job_status: 'waiting' })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByTestId('batch-btn'))

      await act(async () => {
        fireEvent.click(screen.getByTestId('batch-confirm'))
      })

      expect(mocks.batchImport).toHaveBeenCalledWith(
        {
          params: { dataset_id: 'ds-1', document_id: 'doc-1' },
          body: { upload_file_id: 'file-1' },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      )
    })

    type JobCallbacks = { onSuccess: (job: { job_id: string; job_status: string }) => void }

    it('should poll the import job until it finishes', async () => {
      mocks.batchImport.mockImplementation((_input: unknown, callbacks: JobCallbacks) =>
        callbacks.onSuccess({ job_id: 'job-1', job_status: 'waiting' }),
      )
      mocks.checkProgress
        .mockImplementationOnce((_input: unknown, callbacks: JobCallbacks) =>
          callbacks.onSuccess({ job_id: 'job-1', job_status: 'processing' }),
        )
        .mockImplementationOnce((_input: unknown, callbacks: JobCallbacks) =>
          callbacks.onSuccess({ job_id: 'job-1', job_status: 'completed' }),
        )
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByTestId('batch-btn'))

      await act(async () => {
        fireEvent.click(screen.getByTestId('batch-confirm'))
      })
      await act(async () => {
        vi.advanceTimersByTime(2500)
      })
      await act(async () => {
        vi.advanceTimersByTime(2500)
      })

      expect(mocks.checkProgress).toHaveBeenCalledTimes(2)
      expect(mocks.checkProgress).toHaveBeenCalledWith(
        { params: { job_id: 'job-1' } },
        expect.any(Object),
      )
    })

    it('should stop polling when the job reports an unknown status', async () => {
      mocks.batchImport.mockImplementation((_input: unknown, callbacks: JobCallbacks) =>
        callbacks.onSuccess({ job_id: 'job-1', job_status: 'waiting' }),
      )
      mocks.checkProgress.mockImplementation((_input: unknown, callbacks: JobCallbacks) =>
        callbacks.onSuccess({ job_id: 'job-1', job_status: 'queued' }),
      )
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByTestId('batch-btn'))

      await act(async () => {
        fireEvent.click(screen.getByTestId('batch-confirm'))
      })
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      expect(mocks.checkProgress).toHaveBeenCalledTimes(1)
    })
  })

  describe('isFullDocMode', () => {
    it('should detect full-doc mode from document_process_rule', () => {
      mocks.state.documentDetail = createDocumentDetail({
        doc_form: 'hierarchical_model',
        document_process_rule: { rules: { parent_mode: 'full-doc' } },
      })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.queryByTestId('segment-add')).not.toBeInTheDocument()
    })

    it('should detect full-doc mode from dataset_process_rule as fallback', () => {
      mocks.state.documentDetail = createDocumentDetail({
        doc_form: 'hierarchical_model',
        document_process_rule: null,
        dataset_process_rule: { rules: { parent_mode: 'full-doc' } },
      })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.queryByTestId('segment-add')).not.toBeInTheDocument()
    })

    it('should not be full-doc when parentMode is paragraph', () => {
      mocks.state.documentDetail = createDocumentDetail({
        doc_form: 'hierarchical_model',
        document_process_rule: { rules: { parent_mode: 'paragraph' } },
      })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('segment-add')).toBeInTheDocument()
    })
  })

  describe('Legacy DataSourceInfo', () => {
    it('should extract extension from legacy data_source_info', () => {
      mocks.state.documentDetail = createDocumentDetail({
        data_source_info: { upload_file: { extension: '.pdf' } },
      })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('document-title')).toHaveAttribute('data-extension', '.pdf')
    })

    it('should handle non-legacy data_source_info gracefully', () => {
      mocks.state.documentDetail = createDocumentDetail({
        data_source_info: { url: 'https://example.com' },
      })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('document-title')).toBeInTheDocument()
    })
  })
})

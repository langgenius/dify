import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- All hoisted mock fns and state (accessible inside vi.mock factories) ---
const mocks = vi.hoisted(() => {
  const state = {
    dataset: { embedding_available: true } as Record<string, unknown> | null,
    documentDetail: null as Record<string, unknown> | null,
    documentError: null as Error | null,
    documentMetadata: null as Record<string, unknown> | null,
    media: 'desktop' as string,
  }
  return {
    state,
    push: vi.fn(),
    detailRefetch: vi.fn(),
    checkProgress: vi.fn(),
    batchImport: vi.fn(),
    invalidDocumentList: vi.fn(),
    invalidSegmentList: vi.fn(),
    invalidChildSegmentList: vi.fn(),
    toastNotify: vi.fn(),
  }
})

// --- External mocks ---
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => mocks.state.media,
  MediaType: { mobile: 'mobile', tablet: 'tablet', pc: 'desktop' },
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ dataset: mocks.state.dataset }),
}))

vi.mock('@/service/knowledge/use-document', () => ({
  useDocumentDetail: () => ({
    data: mocks.state.documentDetail,
    error: mocks.state.documentError,
    refetch: mocks.detailRefetch,
  }),
  useDocumentMetadata: () => ({
    data: mocks.state.documentMetadata,
  }),
  useInvalidDocumentList: () => mocks.invalidDocumentList,
}))

vi.mock('@/service/knowledge/use-segment', () => ({
  useCheckSegmentBatchImportProgress: () => ({
    mutateAsync: mocks.checkProgress,
  }),
  useSegmentBatchImport: () => ({
    mutateAsync: mocks.batchImport,
  }),
  useSegmentListKey: ['segment-list'],
  useChildSegmentListKey: ['child-segment-list'],
}))

vi.mock('@/service/use-base', () => ({
  useInvalid: (key: unknown) => {
    const keyStr = JSON.stringify(key)
    if (keyStr === JSON.stringify(['segment-list']))
      return mocks.invalidSegmentList
    if (keyStr === JSON.stringify(['child-segment-list']))
      return mocks.invalidChildSegmentList
    return vi.fn()
  },
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: mocks.toastNotify },
}))

// --- Child component mocks ---
vi.mock('../completed', () => ({
  default: ({ embeddingAvailable, showNewSegmentModal, archived }: { embeddingAvailable?: boolean, showNewSegmentModal?: () => void, archived?: boolean }) => (
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
      <button data-testid="embedding-refresh" onClick={detailUpdate}>Refresh</button>
    </div>
  ),
}))

vi.mock('../batch-modal', () => ({
  default: ({ isShow, onCancel, onConfirm }: { isShow?: boolean, onCancel?: () => void, onConfirm?: (val: Record<string, unknown>) => void }) => (
    isShow
      ? (
          <div data-testid="batch-modal">
            <button data-testid="batch-cancel" onClick={onCancel}>Cancel</button>
            <button data-testid="batch-confirm" onClick={() => onConfirm?.({ file: { id: 'file-1' } })}>Confirm</button>
          </div>
        )
      : null
  ),
}))

vi.mock('../document-title', () => ({
  DocumentTitle: ({ name, extension }: { name?: string, extension?: string }) => (
    <div data-testid="document-title" data-extension={extension}>{name}</div>
  ),
}))

vi.mock('../segment-add', () => ({
  default: ({ showNewSegmentModal, showBatchModal, embedding }: { showNewSegmentModal?: () => void, showBatchModal?: () => void, embedding?: boolean }) => (
    <div data-testid="segment-add" data-embedding={embedding}>
      <button data-testid="new-segment-btn" onClick={showNewSegmentModal}>New Segment</button>
      <button data-testid="batch-btn" onClick={showBatchModal}>Batch Import</button>
    </div>
  ),
  ProcessStatus: {
    WAITING: 'waiting',
    PROCESSING: 'processing',
    ERROR: 'error',
    COMPLETED: 'completed',
  },
}))

vi.mock('../../components/operations', () => ({
  default: ({ onUpdate, scene }: { onUpdate?: (action?: string) => void, scene?: string }) => (
    <div data-testid="operations" data-scene={scene}>
      <button data-testid="op-rename" onClick={() => onUpdate?.('rename')}>Rename</button>
      <button data-testid="op-delete" onClick={() => onUpdate?.('delete')}>Delete</button>
      <button data-testid="op-noop" onClick={() => onUpdate?.()}>NoOp</button>
    </div>
  ),
}))

vi.mock('../../status-item', () => ({
  default: ({ status, scene }: { status?: string, scene?: string }) => (
    <div data-testid="status-item" data-scene={scene}>{status}</div>
  ),
}))

vi.mock('@/app/components/datasets/metadata/metadata-document', () => ({
  default: ({ datasetId, documentId }: { datasetId?: string, documentId?: string }) => (
    <div data-testid="metadata" data-dataset-id={datasetId} data-document-id={documentId}>Metadata</div>
  ),
}))

vi.mock('@/app/components/base/float-right-container', () => ({
  default: ({ children, isOpen, onClose }: { children?: React.ReactNode, isOpen?: boolean, onClose?: () => void }) =>
    isOpen
      ? (
          <div data-testid="float-right-container">
            <button data-testid="close-metadata" onClick={onClose}>Close</button>
            {children}
          </div>
        )
      : null,
}))

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

describe('DocumentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.state.dataset = { embedding_available: true }
    mocks.state.documentDetail = createDocumentDetail()
    mocks.state.documentError = null
    mocks.state.documentMetadata = null
    mocks.state.media = 'desktop'
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
    it('should render Completed when status is available', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('completed')).toBeInTheDocument()
      expect(screen.queryByTestId('embedding')).not.toBeInTheDocument()
    })

    it.each(['queuing', 'indexing', 'paused'])('should render Embedding when status is %s', (status) => {
      mocks.state.documentDetail = createDocumentDetail({ display_status: status })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('embedding')).toBeInTheDocument()
      expect(screen.queryByTestId('completed')).not.toBeInTheDocument()
    })

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
  })

  describe('Metadata Panel', () => {
    it('should show metadata panel by default on desktop', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('float-right-container')).toBeInTheDocument()
      expect(screen.getByTestId('metadata')).toBeInTheDocument()
    })

    it('should toggle metadata panel when button clicked', () => {
      const { container } = render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByTestId('metadata')).toBeInTheDocument()

      const svgs = container.querySelectorAll('svg')
      const toggleBtn = svgs[svgs.length - 1].closest('button')!
      fireEvent.click(toggleBtn)
      expect(screen.queryByTestId('metadata')).not.toBeInTheDocument()
    })

    it('should pass correct props to Metadata', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const metadata = screen.getByTestId('metadata')
      expect(metadata).toHaveAttribute('data-dataset-id', 'ds-1')
      expect(metadata).toHaveAttribute('data-document-id', 'doc-1')
    })
  })

  describe('Navigation', () => {
    it('should navigate back when back button clicked', () => {
      const { container } = render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const backBtn = container.querySelector('svg')!.parentElement!
      fireEvent.click(backBtn)
      expect(mocks.push).toHaveBeenCalledWith('/datasets/ds-1/documents')
    })

    it('should preserve query params when navigating back', () => {
      const origLocation = window.location
      window.history.pushState({}, '', '?page=2&status=active')
      const { container } = render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const backBtn = container.querySelector('svg')!.parentElement!
      fireEvent.click(backBtn)
      expect(mocks.push).toHaveBeenCalledWith('/datasets/ds-1/documents?page=2&status=active')
      window.history.pushState({}, '', origLocation.href)
    })
  })

  describe('handleOperate', () => {
    it('should invalidate document list on any operation', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByTestId('op-rename'))
      expect(mocks.invalidDocumentList).toHaveBeenCalled()
    })

    it('should navigate back on delete operation', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByTestId('op-delete'))
      expect(mocks.invalidDocumentList).toHaveBeenCalled()
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

      expect(mocks.invalidSegmentList).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(mocks.invalidSegmentList).toHaveBeenCalled()
      expect(mocks.invalidChildSegmentList).toHaveBeenCalled()
    })

    it('should not invalidate chunk lists on operation with no name', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      fireEvent.click(screen.getByTestId('op-noop'))

      expect(mocks.detailRefetch).toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(mocks.invalidSegmentList).not.toHaveBeenCalled()
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
          url: '/datasets/ds-1/documents/doc-1/segments/batch_import',
          body: { upload_file_id: 'file-1' },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      )
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

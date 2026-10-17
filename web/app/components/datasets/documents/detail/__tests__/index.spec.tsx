import type { ReactElement } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import DatasetDetailContext from '@/context/dataset-detail'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
const expectDocumentListInvalidated = () =>
  expect(QueryClient.prototype.invalidateQueries).toHaveBeenCalledWith({
    queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
      input: { params: { dataset_id: 'ds-1' } },
    }),
  })
const segmentListKey = consoleQuery.datasets.byDatasetId.documents.byDocumentId.segments.get.key({
  input: { params: { dataset_id: 'ds-1', document_id: 'doc-1' } },
})

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

const render = (ui: ReactElement) =>
  renderWithConsoleQuery(
    <DatasetDetailContext.Provider
      value={{
        dataset: mocks.state.dataset
          ? createDatasetFixture({ id: 'ds-1', ...mocks.state.dataset })
          : undefined,
      }}
    >
      {ui}
    </DatasetDetailContext.Provider>,
  )

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
  })
})

vi.mock('@/app/notifications', () => ({
  default: { notify: mocks.toastNotify },
  toast: { success: mocks.toastNotify, error: mocks.toastNotify },
}))

// --- Child component mocks ---
vi.mock('../completed', () => ({
  default: ({
    embeddingAvailable,
    archived,
  }: {
    embeddingAvailable?: boolean
    archived?: boolean
  }) => (
    <div
      data-testid="completed"
      data-embedding-available={embeddingAvailable}
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

// The document picker owns switching documents and has its own integration suite.
vi.mock('../document-title', () => ({ DocumentTitle: () => null }))
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
  id: 'doc-1',
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
    mocks.checkProgress.mockResolvedValue({ job_id: 'job-1', job_status: 'completed' })
    vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    vi.useFakeTimers({ shouldAdvanceTime: true })
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
  })

  describe('SegmentAdd Visibility', () => {
    it('should show SegmentAdd when all conditions met', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(
        screen.getByRole('button', { name: 'datasetDocuments.list.action.addButton' }),
      ).toBeInTheDocument()
    })

    it('should hide SegmentAdd when embedding is not available', () => {
      mocks.state.dataset = { embedding_available: false }
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(
        screen.queryByRole('button', { name: 'datasetDocuments.list.action.addButton' }),
      ).not.toBeInTheDocument()
    })

    it('should hide SegmentAdd when document is archived', () => {
      mocks.state.documentDetail = createDocumentDetail({ archived: true })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(
        screen.queryByRole('button', { name: 'datasetDocuments.list.action.addButton' }),
      ).not.toBeInTheDocument()
    })

    it('should hide SegmentAdd in full-doc parent-child mode', () => {
      mocks.state.documentDetail = createDocumentDetail({
        doc_form: 'hierarchical_model',
        document_process_rule: { rules: { parent_mode: 'full-doc' } },
      })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(
        screen.queryByRole('button', { name: 'datasetDocuments.list.action.addButton' }),
      ).not.toBeInTheDocument()
    })

    it('should hide SegmentAdd when dataset only has readonly ACL permission', () => {
      mocks.state.dataset = {
        embedding_available: true,
        permission_keys: [DatasetACLPermission.Readonly],
      }
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(
        screen.queryByRole('button', { name: 'datasetDocuments.list.action.addButton' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Metadata Panel', () => {
    it('should toggle metadata panel when button clicked', async () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(
        screen.getByText('dataset.metadata.documentMetadata.documentInformation'),
      ).toBeInTheDocument()

      const toggle = screen.getByRole('button', { name: /metadata\.title/ })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(
        screen.queryByText('dataset.metadata.documentMetadata.documentInformation'),
      ).not.toBeInTheDocument()
    })

    it.each([true, false])(
      'allows metadata editing only with edit permission (%s)',
      async (canEdit) => {
        mocks.state.dataset = {
          embedding_available: true,
          permission_keys: [canEdit ? DatasetACLPermission.Edit : DatasetACLPermission.Readonly],
        }
        render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
        const label = 'dataset.metadata.documentMetadata.startLabeling'
        if (canEdit) {
          await userEvent
            .setup({ advanceTimers: vi.advanceTimersByTime })
            .click(screen.getByRole('button', { name: label }))
          expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeVisible()
        } else {
          expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
          expect(
            screen.queryByRole('button', { name: 'common.operation.save' }),
          ).not.toBeInTheDocument()
        }
      },
    )
  })

  describe('Navigation', () => {
    it('should navigate back when back button clicked', async () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      await userEvent
        .setup({ advanceTimers: vi.advanceTimersByTime })
        .click(screen.getByRole('button', { name: 'common.operation.back' }))
      expect(mocks.push).toHaveBeenCalledWith('/datasets/ds-1/documents')
    })

    it('should preserve query params when navigating back', async () => {
      mocks.state.searchParams = 'page=2&status=active'
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      await userEvent
        .setup({ advanceTimers: vi.advanceTimersByTime })
        .click(screen.getByRole('button', { name: 'common.operation.back' }))
      expect(mocks.push).toHaveBeenCalledWith('/datasets/ds-1/documents?page=2&status=active')
    })
  })

  describe('handleOperate', () => {
    it('should navigate back on delete operation', async () => {
      mocks.state.dataset = {
        embedding_available: true,
        permission_keys: [DatasetACLPermission.Edit, DatasetACLPermission.DeleteFile],
      }
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(
        screen.getByRole('menuitem', { name: 'datasetDocuments.list.action.delete' }),
      )
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'common.operation.sure',
        }),
      )
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/datasets/ds-1/documents'))
      expectDocumentListInvalidated()
      expect(mocks.push).toHaveBeenCalledWith('/datasets/ds-1/documents')
    })

    it('invalidates chunk lists after disabling the document', async () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      await userEvent
        .setup({ advanceTimers: vi.advanceTimersByTime })
        .click(screen.getByRole('switch'))
      await act(async () => vi.advanceTimersByTimeAsync(600))

      expectDocumentListInvalidated()
      expect(mocks.detailRefetch).toHaveBeenCalledTimes(1)
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

    it('should not invalidate chunk lists on operation with no name', async () => {
      mocks.state.documentDetail = createDocumentDetail({ display_status: 'indexing' })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      await userEvent
        .setup({ advanceTimers: vi.advanceTimersByTime })
        .click(screen.getByTestId('embedding-refresh'))

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
    it('should close batch modal when cancel clicked', async () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await user.click(
        screen.getByRole('button', { name: 'datasetDocuments.list.action.batchAdd' }),
      )
      await user.click(
        screen.getByRole('menuitem', { name: 'datasetDocuments.list.action.batchAdd' }),
      )
      expect(screen.getByTestId('batch-modal')).toBeInTheDocument()
      await userEvent
        .setup({ advanceTimers: vi.advanceTimersByTime })
        .click(screen.getByTestId('batch-cancel'))
      expect(screen.queryByTestId('batch-modal')).not.toBeInTheDocument()
      expect(mocks.batchImport).not.toHaveBeenCalled()
    })

    it('should poll the import job until it finishes', async () => {
      mocks.batchImport.mockResolvedValue({ job_id: 'job-1', job_status: 'waiting' })
      mocks.checkProgress
        .mockResolvedValueOnce({ job_id: 'job-1', job_status: 'processing' })
        .mockResolvedValueOnce({ job_id: 'job-1', job_status: 'completed' })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await user.click(
        screen.getByRole('button', { name: 'datasetDocuments.list.action.batchAdd' }),
      )
      await user.click(
        screen.getByRole('menuitem', { name: 'datasetDocuments.list.action.batchAdd' }),
      )

      await act(async () => {
        await userEvent
          .setup({ advanceTimers: vi.advanceTimersByTime })
          .click(screen.getByTestId('batch-confirm'))
      })
      await act(async () => {
        vi.advanceTimersByTime(2500)
      })
      await act(async () => {
        vi.advanceTimersByTime(2500)
      })

      expect(mocks.batchImport).toHaveBeenCalledWith({
        params: { dataset_id: 'ds-1', document_id: 'doc-1' },
        body: { upload_file_id: 'file-1' },
      })
      expect(mocks.checkProgress).toHaveBeenCalledTimes(2)
      expect(mocks.checkProgress).toHaveBeenCalledWith({ params: { job_id: 'job-1' } })
    })

    it('should stop polling when the job reports an unknown status', async () => {
      mocks.batchImport.mockResolvedValue({ job_id: 'job-1', job_status: 'waiting' })
      mocks.checkProgress.mockResolvedValue({ job_id: 'job-1', job_status: 'queued' })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await user.click(
        screen.getByRole('button', { name: 'datasetDocuments.list.action.batchAdd' }),
      )
      await user.click(
        screen.getByRole('menuitem', { name: 'datasetDocuments.list.action.batchAdd' }),
      )

      await act(async () => {
        await userEvent
          .setup({ advanceTimers: vi.advanceTimersByTime })
          .click(screen.getByTestId('batch-confirm'))
      })
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      expect(mocks.checkProgress).toHaveBeenCalledTimes(1)
    })
  })

  describe('isFullDocMode', () => {
    it('should detect full-doc mode from dataset_process_rule as fallback', () => {
      mocks.state.documentDetail = createDocumentDetail({
        doc_form: 'hierarchical_model',
        document_process_rule: null,
        dataset_process_rule: { rules: { parent_mode: 'full-doc' } },
      })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(
        screen.queryByRole('button', { name: 'datasetDocuments.list.action.addButton' }),
      ).not.toBeInTheDocument()
    })

    it('should not be full-doc when parentMode is paragraph', () => {
      mocks.state.documentDetail = createDocumentDetail({
        doc_form: 'hierarchical_model',
        document_process_rule: { rules: { parent_mode: 'paragraph' } },
      })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(
        screen.getByRole('button', { name: 'datasetDocuments.list.action.addButton' }),
      ).toBeInTheDocument()
    })
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.metadata.get': async () => ({
        doc_metadata: [],
        built_in_field_enabled: false,
      }),
      'datasets.byDatasetId.documents.delete': async () => ({ result: 'success' }),
      'datasets.byDatasetId.documents.status.byAction.batch.patch': async () => ({
        result: 'success',
      }),
      'datasets.batchImportStatus.byJobId.get': (input) => mocks.checkProgress(input),
      'datasets.byDatasetId.documents.byDocumentId.segments.batchImport.post': (input) =>
        mocks.batchImport(input),
    }),
  }
})

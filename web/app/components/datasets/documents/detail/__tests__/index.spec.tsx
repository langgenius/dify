import type {
  DatasetDetailWithPartialMembersResponse,
  DocumentDetailResponse,
  DocumentStatusResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import {
  zDocumentDetailResponse,
  zDocumentWithSegmentsResponse,
} from '@dify/contracts/api/console/datasets/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import DatasetDetailContext from '@/context/dataset-detail'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { DatasetACLPermission } from '@/utils/permission'
import DocumentDetail from '../index'
const expectDocumentListInvalidated = (queryClient: QueryClient) =>
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
    queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
      input: { params: { dataset_id: 'ds-1' } },
    }),
  })
const segmentListKey = consoleQuery.datasets.byDatasetId.documents.byDocumentId.segments.get.key({
  input: { params: { dataset_id: 'ds-1', document_id: 'doc-1' } },
})

const mocks = vi.hoisted(() => {
  const state = {
    dataset: {} as Partial<DatasetDetailWithPartialMembersResponse> | null,
    documentDetail: null as ReturnType<typeof zDocumentDetailResponse.parse> | null,
    documentMetadata: null as ReturnType<typeof zDocumentDetailResponse.parse> | null,
    searchParams: '' as string,
  }
  return {
    state,
    push: vi.fn(),
    detailRefetch: vi.fn(),
    checkProgress:
      vi.fn<
        typeof import('@/service/console').consoleClient.datasets.batchImportStatus.byJobId.get
      >(),
    batchImport:
      vi.fn<
        typeof import('@/service/console').consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.batchImport.post
      >(),
    upload: vi.fn(),
    indexing:
      vi.fn<
        typeof import('@/service/console').consoleClient.datasets.byDatasetId.documents.byDocumentId.indexingStatus.get
      >(),
    resume:
      vi.fn<
        typeof import('@/service/console').consoleClient.datasets.byDatasetId.documents.byDocumentId.processing.resume.patch
      >(),
  }
})

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ datasetId: 'ds-1', documentId: 'doc-1' }),
  usePathname: () => '/datasets/ds-1/documents/doc-1',
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(mocks.state.searchParams),
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  upload: mocks.upload,
}))

const render = (ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  vi.spyOn(queryClient, 'invalidateQueries')
  const document = consoleQuery.datasets.byDatasetId.documents.byDocumentId.get
  const params = { dataset_id: 'ds-1', document_id: 'doc-1' }
  if (mocks.state.documentDetail) {
    queryClient.setQueryData(
      document.queryKey({ input: { params, query: { metadata: 'without' } } }),
      mocks.state.documentDetail,
    )
  }
  queryClient.setQueryData(
    document.queryKey({ input: { params, query: { metadata: 'only' } } }),
    mocks.state.documentMetadata ?? { id: 'doc-1' },
  )
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  const view = renderWithConsoleQuery(
    // oxlint-disable-next-line eslint-react/no-context-provider -- This use-context-selector context requires its Provider.
    <DatasetDetailContext.Provider
      value={{
        dataset: mocks.state.dataset
          ? createDatasetFixture({ id: 'ds-1', ...mocks.state.dataset })
          : undefined,
      }}
    >
      <EventEmitterContextProvider>
        {ui}
        <AppToaster timeout={0} />
      </EventEmitterContextProvider>
    </DatasetDetailContext.Provider>,
    { queryClient, workspacePermissionKeys: [] },
  )
  return { ...view, queryClient }
}

const childChunkListKey =
  consoleQuery.datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.get.key(
    {
      input: { params: { dataset_id: 'ds-1', document_id: 'doc-1' } },
    },
  )

const createDocumentDetail = (overrides?: Partial<DocumentDetailResponse>) =>
  zDocumentDetailResponse.parse({
    id: 'doc-1',
    name: 'test-doc.txt',
    display_status: 'available',
    enabled: true,
    archived: false,
    doc_form: 'text_model',
    data_source_type: 'upload_file',
    data_source_info: { upload_file: { extension: 'txt' } },
    data_source_detail_dict: {
      upload_file: {
        id: 'file-1',
        name: 'test-doc.txt',
        size: 100,
        extension: 'txt',
        mime_type: 'text/plain',
        created_by: 'user-1',
        created_at: 1700000000,
      },
    },
    error: '',
    document_process_rule: null,
    dataset_process_rule: null,
    ...overrides,
  })

const indexingStatus = (
  overrides: Partial<DocumentStatusResponse> = {},
): DocumentStatusResponse => ({
  id: 'doc-1',
  indexing_status: 'indexing',
  completed_segments: 1,
  total_segments: 2,
  processing_started_at: 1700000000,
  parsing_completed_at: 0,
  cleaning_completed_at: 0,
  splitting_completed_at: 0,
  completed_at: null,
  paused_at: null,
  error: null,
  stopped_at: null,
  ...overrides,
})

describe('DocumentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upload.mockResolvedValue({ id: 'file-1', name: 'chunks.csv' })
    mocks.detailRefetch.mockImplementation(
      async () => mocks.state.documentDetail ?? new Promise(() => {}),
    )
    mocks.checkProgress.mockResolvedValue({ job_id: 'job-1', job_status: 'completed' })
    mocks.state.dataset = {
      embedding_available: true,
      name: 'Dataset 1',
      permission_keys: [DatasetACLPermission.Edit],
    }
    mocks.state.documentDetail = createDocumentDetail()
    mocks.state.documentMetadata = null
    mocks.state.searchParams = ''
    mocks.indexing.mockReset().mockResolvedValue(indexingStatus())
    mocks.resume.mockReset().mockResolvedValue({ result: 'success' })
  })

  afterEach(() => {
    act(() => toast.dismiss())
    vi.useRealTimers()
  })

  describe('Loading State', () => {
    it('should show loading when no data and no error', () => {
      mocks.state.documentDetail = null
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
    })
  })

  describe('Content Rendering', () => {
    it('uses the document and knowledge names in the document title', () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)

      expect(document.title).toContain('test-doc.txt · Dataset 1')
    })

    it('shows the real chunk list for an available document', async () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(
        await screen.findByRole('combobox', { name: 'datasetDocuments.segment.statusFilterLabel' }),
      ).toBeVisible()
      expect(
        screen.queryByRole('button', { name: 'datasetDocuments.embedding.pause' }),
      ).not.toBeInTheDocument()
    })

    it.each(['queuing', 'indexing', 'paused'] as const)(
      'should render Embedding when status is %s',
      async (status) => {
        mocks.indexing.mockResolvedValue(
          indexingStatus({ indexing_status: status === 'queuing' ? 'waiting' : status }),
        )
        mocks.state.documentDetail = createDocumentDetail({ display_status: status })
        render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
        expect(
          await screen.findByText('datasetDocuments.embedding.segments 1/2 · 50%'),
        ).toBeVisible()
        expect(
          screen.queryByRole('combobox', { name: 'datasetDocuments.segment.statusFilterLabel' }),
        ).not.toBeInTheDocument()
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
        document_process_rule: { mode: 'custom', rules: { parent_mode: 'full-doc' } },
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
      const user = userEvent.setup()
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(
        screen.getByText('dataset.metadata.documentMetadata.documentInformation'),
      ).toBeInTheDocument()

      const toggle = screen.getByRole('button', { name: /metadata\.title/ })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(
        screen.queryByText('dataset.metadata.documentMetadata.documentInformation'),
      ).not.toBeInTheDocument()
    })

    it.each([true, false])(
      'allows metadata editing only with edit permission (%s)',
      async (canEdit) => {
        const user = userEvent.setup()
        mocks.state.dataset = {
          embedding_available: true,
          permission_keys: [canEdit ? DatasetACLPermission.Edit : DatasetACLPermission.Readonly],
        }
        render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
        const label = 'dataset.metadata.documentMetadata.startLabeling'
        if (canEdit) {
          await user.click(screen.getByRole('button', { name: label }))
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
      const user = userEvent.setup()
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      await user.click(screen.getByRole('button', { name: 'common.operation.back' }))
      expect(mocks.push).toHaveBeenCalledWith('/datasets/ds-1/documents')
    })

    it('should preserve query params when navigating back', async () => {
      const user = userEvent.setup()
      mocks.state.searchParams = 'page=2&status=active'
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      await user.click(screen.getByRole('button', { name: 'common.operation.back' }))
      expect(mocks.push).toHaveBeenCalledWith('/datasets/ds-1/documents?page=2&status=active')
    })
  })

  describe('handleOperate', () => {
    it('should navigate back on delete operation', async () => {
      mocks.state.dataset = {
        embedding_available: true,
        permission_keys: [DatasetACLPermission.Edit, DatasetACLPermission.DeleteFile],
      }
      const { queryClient } = render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const user = userEvent.setup()
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
      expectDocumentListInvalidated(queryClient)
      expect(mocks.push).toHaveBeenCalledWith('/datasets/ds-1/documents')
    })

    it('invalidates chunk lists after disabling the document', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { queryClient } = render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      vi.mocked(queryClient.invalidateQueries).mockClear()
      await user.click(screen.getByRole('switch'))
      await act(async () => vi.advanceTimersByTimeAsync(600))

      expectDocumentListInvalidated(queryClient)
      expect(mocks.detailRefetch).toHaveBeenCalledTimes(1)
      expect(queryClient.invalidateQueries).not.toHaveBeenCalledWith({
        queryKey: segmentListKey,
      })
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: segmentListKey,
      })
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: childChunkListKey,
      })
    })

    it('refreshes the document after resuming indexing without invalidating chunk lists', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mocks.state.documentDetail = createDocumentDetail({ display_status: 'paused' })
      mocks.indexing
        .mockResolvedValueOnce(indexingStatus({ indexing_status: 'paused' }))
        .mockResolvedValue(indexingStatus())
      const { queryClient } = render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      await user.click(
        await screen.findByRole('button', { name: 'datasetDocuments.embedding.resume' }),
      )
      expect(mocks.resume).toHaveBeenCalledWith({
        params: { dataset_id: 'ds-1', document_id: 'doc-1' },
      })

      expect(mocks.detailRefetch).toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(queryClient.invalidateQueries).not.toHaveBeenCalledWith({
        queryKey: segmentListKey,
      })
    })
  })

  describe('Batch Import', () => {
    it('should close batch modal when cancel clicked', async () => {
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      const user = userEvent.setup()
      await user.click(
        screen.getByRole('button', { name: 'datasetDocuments.list.action.batchAdd' }),
      )
      await user.click(
        screen.getByRole('menuitem', { name: 'datasetDocuments.list.action.batchAdd' }),
      )
      expect(
        screen.getByRole('dialog', { name: 'datasetDocuments.list.batchModal.title' }),
      ).toBeInTheDocument()
      await user.click(
        within(screen.getByRole('dialog'))
          .getAllByRole('button', { name: 'datasetDocuments.list.batchModal.cancel' })
          .at(-1)!,
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(mocks.batchImport).not.toHaveBeenCalled()
    })

    it('should poll the import job until it finishes', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
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

      // The native file-picker input is intentionally hidden.
      await user.upload(
        document.getElementById('fileUploader') as HTMLInputElement,
        new File(['content\nFirst chunk'], 'chunks.csv', { type: 'text/csv' }),
      )
      const run = screen.getByRole('button', { name: 'datasetDocuments.list.batchModal.run' })
      await waitFor(() => expect(run).toBeEnabled())
      await user.click(run)
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
      vi.useFakeTimers({ shouldAdvanceTime: true })
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

      // The native file-picker input is intentionally hidden.
      await user.upload(
        document.getElementById('fileUploader') as HTMLInputElement,
        new File(['content\nFirst chunk'], 'chunks.csv', { type: 'text/csv' }),
      )
      const run = screen.getByRole('button', { name: 'datasetDocuments.list.batchModal.run' })
      await waitFor(() => expect(run).toBeEnabled())
      await user.click(run)
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
        dataset_process_rule: { mode: 'custom', rules: { parent_mode: 'full-doc' } },
      })
      render(<DocumentDetail datasetId="ds-1" documentId="doc-1" />)
      expect(
        screen.queryByRole('button', { name: 'datasetDocuments.list.action.addButton' }),
      ).not.toBeInTheDocument()
    })

    it('should not be full-doc when parentMode is paragraph', () => {
      mocks.state.documentDetail = createDocumentDetail({
        doc_form: 'hierarchical_model',
        document_process_rule: { mode: 'custom', rules: { parent_mode: 'paragraph' } },
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
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'datasets.byDatasetId.documents.byDocumentId.indexingStatus.get': (input) =>
        mocks.indexing(input),
      'datasets.byDatasetId.documents.byDocumentId.processing.resume.patch': (input) =>
        mocks.resume(input),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.byDocumentId.get': (input: {
        query?: { metadata?: string }
      }) =>
        input.query?.metadata === 'only'
          ? Promise.resolve(mocks.state.documentMetadata ?? { id: 'doc-1' })
          : mocks.detailRefetch(input),
      'datasets.byDatasetId.documents.get': async () => ({
        data: mocks.state.documentDetail
          ? [zDocumentWithSegmentsResponse.parse(mocks.state.documentDetail)]
          : [],
        total: mocks.state.documentDetail ? 1 : 0,
        page: 1,
        limit: 20,
        has_more: false,
      }),
      'datasets.byDatasetId.documents.byDocumentId.segments.get': async () => ({
        data: [],
        total: 0,
        total_pages: 0,
        page: 1,
        limit: 10,
      }),
      'datasets.processRule.get': async () => ({
        mode: 'automatic',
        rules: {},
        limits: { indexing_max_segmentation_tokens_length: 4000 },
      }),
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

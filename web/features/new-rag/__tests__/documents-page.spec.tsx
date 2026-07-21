import type {
  DocumentProcessingTask,
  LogicalDocument,
  Source,
} from '@dify/contracts/knowledge-fs/types.gen'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { DocumentsPage } from '../documents-page'

type InfiniteOptions = {
  getNextPageParam: (lastPage: { nextCursor?: string }) => string | undefined
  input: (pageParam: string | null) => unknown
  initialPageParam: string | null
  queryKind: 'documents' | 'sources' | 'tasks'
  refetchInterval?: (query: { state: { data?: unknown } }) => false | number
}

const documentsQuery = vi.hoisted(() => ({
  data: undefined as
    | { pages: Array<{ items: LogicalDocument[]; nextCursor?: string }> }
    | undefined,
  error: null as unknown,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  isPending: false,
  refetch: vi.fn(),
}))

const tasksQuery = vi.hoisted(() => ({
  data: undefined as
    | { pages: Array<{ items: DocumentProcessingTask[]; nextCursor?: string }> }
    | undefined,
  error: null as unknown,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  isPending: false,
  refetch: vi.fn(),
}))

const sourcesQuery = vi.hoisted(() => ({
  data: undefined as { pages: Array<{ items: Source[]; nextCursor?: string }> } | undefined,
  error: null as unknown,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  isPending: false,
  refetch: vi.fn(),
}))

const cancelMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const retryMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const reindexMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const uploadMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const bulkUploadMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const queryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn() }))
const streamProcessingTaskEvents = vi.hoisted(() => vi.fn())
const getTaskSnapshot = vi.hoisted(() => vi.fn())
const permissionStateMock = vi.hoisted(() => ({
  datasetAtom: Symbol('datasetDefaultPermissionKeysAtom'),
  datasetKeys: ['dataset.acl.edit'],
  error: null as unknown,
  errorAtom: Symbol('workspacePermissionKeysErrorAtom'),
  loading: false,
  loadingAtom: Symbol('workspacePermissionKeysLoadingAtom'),
  retry: vi.fn(),
  retryAtom: Symbol('retryWorkspacePermissionKeysAtom'),
}))
const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('@/context/permission-state', () => ({
  datasetDefaultPermissionKeysAtom: permissionStateMock.datasetAtom,
  retryWorkspacePermissionKeysAtom: permissionStateMock.retryAtom,
  workspacePermissionKeysErrorAtom: permissionStateMock.errorAtom,
  workspacePermissionKeysLoadingAtom: permissionStateMock.loadingAtom,
}))

vi.mock('jotai', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai')>()
  return {
    ...original,
    useAtomValue: (atom: unknown) => {
      if (atom === permissionStateMock.datasetAtom) return permissionStateMock.datasetKeys
      if (atom === permissionStateMock.errorAtom) return permissionStateMock.error
      if (atom === permissionStateMock.loadingAtom) return permissionStateMock.loading
      return original.useAtomValue(atom as Parameters<typeof original.useAtomValue>[0])
    },
    useSetAtom: (atom: unknown) =>
      atom === permissionStateMock.retryAtom
        ? permissionStateMock.retry
        : original.useSetAtom(atom as Parameters<typeof original.useSetAtom>[0]),
  }
})

vi.mock('@langgenius/dify-ui/toast', () => ({ toast: toastMock }))

const documentsInfiniteOptions = vi.hoisted(() =>
  vi.fn((options: Omit<InfiniteOptions, 'queryKind'>) => ({ ...options, queryKind: 'documents' })),
)
const tasksInfiniteOptions = vi.hoisted(() =>
  vi.fn((options: Omit<InfiniteOptions, 'queryKind'>) => ({ ...options, queryKind: 'tasks' })),
)
const sourcesInfiniteOptions = vi.hoisted(() =>
  vi.fn((options: Omit<InfiniteOptions, 'queryKind'>) => ({ ...options, queryKind: 'sources' })),
)

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: (options: InfiniteOptions) => {
      if (options.queryKind === 'documents') return documentsQuery
      if (options.queryKind === 'sources') return sourcesQuery
      return tasksQuery
    },
    useMutation: (options: {
      mutationKind: 'bulk-upload' | 'cancel' | 'reindex' | 'retry' | 'upload'
    }) => {
      if (options.mutationKind === 'cancel') return cancelMutation
      if (options.mutationKind === 'retry') return retryMutation
      if (options.mutationKind === 'reindex') return reindexMutation
      if (options.mutationKind === 'bulk-upload') return bulkUploadMutation
      return uploadMutation
    },
    useQueryClient: () => queryClient,
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId: getTaskSnapshot,
    },
  },
  consoleQuery: {
    knowledgeFs: {
      deleteKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId: {
        mutationOptions: () => ({ mutationKind: 'cancel' }),
      },
      getKnowledgeSpacesByIdLogicalDocuments: {
        infiniteOptions: documentsInfiniteOptions,
        key: () => ['knowledge-fs', 'documents'],
      },
      getKnowledgeSpacesByIdProcessingTasks: {
        infiniteOptions: tasksInfiniteOptions,
        key: () => ['knowledge-fs', 'tasks'],
      },
      getKnowledgeSpacesByIdSources: {
        infiniteOptions: sourcesInfiniteOptions,
      },
      postKnowledgeSpacesByIdDocuments: {
        mutationOptions: () => ({ mutationKind: 'upload' }),
      },
      postKnowledgeSpacesByIdDocumentsBulk: {
        mutationOptions: () => ({ mutationKind: 'bulk-upload' }),
      },
      postKnowledgeSpacesByIdDocumentsBulkReindex: {
        mutationOptions: () => ({ mutationKind: 'reindex' }),
      },
      postKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdRetry: {
        mutationOptions: () => ({ mutationKind: 'retry' }),
      },
    },
  },
}))

vi.mock('../services/processing-task-events', () => ({ streamProcessingTaskEvents }))

const document = (overrides: Partial<LogicalDocument> = {}): LogicalDocument => ({
  active: {
    activatedAt: '2026-07-20T10:01:00Z',
    contentHash: 'hash',
    createdAt: '2026-07-20T10:00:00Z',
    documentAssetId: 'asset-1',
    documentAssetVersion: 1,
    documentId: 'document-1',
    knowledgeSpaceId: 'space-1',
    mimeType: 'application/pdf',
    revision: 2,
    sizeBytes: 1024,
    state: 'active',
  },
  activeRevision: 2,
  createdAt: '2026-07-20T10:00:00Z',
  id: 'document-1',
  knowledgeSpaceId: 'space-1',
  rowVersion: 1,
  sourceId: 'source-1',
  status: 'ready',
  title: 'sso-enterprise.pdf',
  updatedAt: '2026-07-20T10:01:00Z',
  userMetadata: { sourceName: 'Notion support SOP' },
  ...overrides,
})

const task = (overrides: Partial<DocumentProcessingTask> = {}): DocumentProcessingTask => ({
  createdAt: '2026-07-20T10:00:00Z',
  documentId: 'document-1',
  documentRevision: 2,
  id: 'task-1',
  knowledgeSpaceId: 'space-1',
  progressPercent: 45,
  stage: 'parsed',
  state: 'running',
  updatedAt: '2026-07-20T10:01:00Z',
  ...overrides,
})

function streamFailedTaskThenWait(taskId: string) {
  let streamCount = 0
  streamProcessingTaskEvents.mockImplementation(async function* () {
    streamCount += 1
    if (streamCount === 1) {
      yield {
        data: {
          progressPercent: 80,
          stage: 'parsed' as const,
          state: 'failed' as const,
          updatedAt: '2026-07-20T10:03:00Z',
        },
        event: 'progress' as const,
        id: `${taskId}:2026-07-20T10:03:00Z`,
      }
      yield {
        data: { errorCode: 'PARSER_FAILED', state: 'failed' as const },
        event: 'terminal' as const,
        id: `${taskId}:terminal`,
      }
      return
    }
    await new Promise<void>(() => {})
  })
}

const source = (overrides: Partial<Source> = {}): Source => ({
  createdAt: '2026-07-20T10:00:00Z',
  id: 'source-1',
  knowledgeSpaceId: 'space-1',
  metadata: {},
  name: 'Notion support SOP',
  status: 'active',
  type: 'connector',
  updatedAt: '2026-07-20T10:00:00Z',
  uri: 'notion://support',
  ...overrides,
})

describe('DocumentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    documentsQuery.data = { pages: [{ items: [] }] }
    documentsQuery.error = null
    documentsQuery.hasNextPage = false
    documentsQuery.isFetchNextPageError = false
    documentsQuery.isFetchingNextPage = false
    documentsQuery.isPending = false
    tasksQuery.data = { pages: [{ items: [] }] }
    tasksQuery.error = null
    tasksQuery.hasNextPage = false
    tasksQuery.isFetchNextPageError = false
    tasksQuery.isFetchingNextPage = false
    tasksQuery.isPending = false
    sourcesQuery.data = { pages: [{ items: [source()] }] }
    sourcesQuery.error = null
    sourcesQuery.hasNextPage = false
    sourcesQuery.isFetchNextPageError = false
    sourcesQuery.isFetchingNextPage = false
    sourcesQuery.isPending = false
    permissionStateMock.datasetKeys = ['dataset.acl.edit']
    permissionStateMock.error = null
    permissionStateMock.loading = false
    getTaskSnapshot.mockResolvedValue(task({ state: 'succeeded' }))
    cancelMutation.mutateAsync.mockResolvedValue(task({ state: 'canceled' }))
    retryMutation.mutateAsync.mockResolvedValue(task({ state: 'queued' }))
    reindexMutation.mutateAsync.mockResolvedValue({
      bulkJobId: 'reindex-1',
      items: [
        {
          asset: {
            createdAt: '2026-07-20T10:00:00Z',
            filename: 'one.pdf',
            id: 'asset-1',
            knowledgeSpaceId: 'space-1',
            mimeType: 'application/pdf',
            objectKey: 'documents/one.pdf',
            parserStatus: 'pending',
            sha256: 'sha',
            sizeBytes: 1024,
            version: 1,
          },
          compilationJob: { id: 'job-1', stage: 'queued' },
          status: 'queued',
          statusUrl: '/tasks/job-1',
        },
      ],
      total: 1,
    })
    uploadMutation.mutateAsync.mockResolvedValue({
      asset: {
        createdAt: '2026-07-20T10:00:00Z',
        filename: 'one.md',
        id: 'asset-1',
        knowledgeSpaceId: 'space-1',
        mimeType: 'text/markdown',
        objectKey: 'documents/one.md',
        parserStatus: 'pending',
        sha256: 'sha',
        sizeBytes: 3,
        version: 1,
      },
      compilationJob: { id: 'job-1', stage: 'queued' },
      documentRevision: 1,
      logicalDocument: { id: 'document-1', revision: 1 },
      logicalDocumentId: 'document-1',
      statusUrl: '/tasks/job-1',
    })
    bulkUploadMutation.mutateAsync.mockResolvedValue({
      accepted: 2,
      bulkJobId: 'upload-1',
      excluded: 0,
      items: [],
      total: 2,
    })
    streamProcessingTaskEvents.mockImplementation(async function* () {})
  })

  it('loads real logical documents and processing tasks through generated contracts', () => {
    documentsQuery.isPending = true
    tasksQuery.isPending = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const documentOptions = documentsInfiniteOptions.mock.lastCall?.[0]
    const taskOptions = tasksInfiniteOptions.mock.lastCall?.[0]
    const sourceOptions = sourcesInfiniteOptions.mock.lastCall?.[0]
    expect(documentOptions?.input(null)).toEqual({
      params: { id: 'space-1' },
      query: { limit: 50 },
    })
    expect(documentOptions?.input('next')).toEqual({
      params: { id: 'space-1' },
      query: { cursor: 'next', limit: 50 },
    })
    expect(documentOptions?.getNextPageParam({ nextCursor: 'next' })).toBe('next')
    expect(taskOptions?.input(null)).toEqual({
      params: { id: 'space-1' },
      query: { limit: 100 },
    })
    expect(taskOptions?.getNextPageParam({ nextCursor: 'next' })).toBe('next')
    expect(sourceOptions?.input(null)).toEqual({
      params: { id: 'space-1' },
      query: { limit: 100 },
    })
    expect(sourceOptions?.getNextPageParam({ nextCursor: 'next' })).toBe('next')
    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
  })

  it('renders revisions, sources, stable cursor-ordered rows, and every designed status', () => {
    documentsQuery.data = {
      pages: [
        {
          items: [document({ id: 'ready', title: 'Ready.pdf', userMetadata: {} })],
        },
        {
          items: [
            document({
              active: null,
              activeRevision: undefined,
              id: 'queued',
              status: 'pending',
              title: 'Queued.docx',
              updatedAt: '2026-07-20T10:05:00Z',
            }),
            document({ id: 'failed', status: 'failed', title: 'Failed.html' }),
            document({
              id: 'disabled',
              sourceId: 'disabled-source',
              title: 'Disabled.xlsx',
              userMetadata: { sourceName: 'Archive' },
            }),
            document({ id: 'processing', status: 'pending', title: 'Processing.md' }),
          ],
        },
      ],
    }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({ documentId: 'processing', id: 'processing-task' }),
            task({ documentId: 'queued', id: 'queued-task', state: 'queued' }),
          ],
        },
      ],
    }
    sourcesQuery.data = {
      pages: [
        {
          items: [source(), source({ id: 'disabled-source', name: 'Archive', status: 'disabled' })],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByText('Ready.pdf')).toBeInTheDocument()
    expect(screen.getAllByText('Notion support SOP').length).toBeGreaterThan(0)
    expect(screen.getAllByText('v2').length).toBeGreaterThan(0)
    for (const status of ['ready', 'queued', 'processing', 'failed', 'disabled'])
      expect(
        screen.getAllByText(`dataset.newKnowledge.documentStatus.${status}`).length,
      ).toBeGreaterThan(0)
    expect(screen.getByText('dataset.newKnowledge.lastReadyRevisionHint')).toBeInTheDocument()
  })

  it('treats a document with an unresolved source as unavailable for writes', () => {
    documentsQuery.data = {
      pages: [{ items: [document({ sourceId: 'missing-source', title: 'Orphaned.pdf' })] }],
    }
    sourcesQuery.data = { pages: [{ items: [] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getAllByText('dataset.newKnowledge.documentStatus.disabled')).toHaveLength(2)
    expect(screen.getByRole('checkbox', { name: 'Orphaned.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('renders the designed empty state with an available upload action', () => {
    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.documentsEmptyTitle')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.documentsEmptyDescription')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeEnabled()
  })

  it('keeps every write action unavailable for read-only users', async () => {
    const user = userEvent.setup()
    permissionStateMock.datasetKeys = ['dataset.acl.readonly']
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task()] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.permissionRestricted')).toBeVisible()
    expect(screen.queryByLabelText('dataset.newKnowledge.uploadDocuments')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).toHaveAttribute(
      'aria-describedby',
      'documents-readonly-reason',
    )
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).not.toBeInTheDocument()
  })

  it('keeps permission lookup failures distinct from read-only access and retries them', async () => {
    const user = userEvent.setup()
    permissionStateMock.error = new Error('permission service unavailable')
    documentsQuery.data = { pages: [{ items: [document()] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent('dataset.newKnowledge.permissionLoadFailed')
    expect(screen.queryByText('dataset.newKnowledge.permissionRestricted')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(permissionStateMock.retry).toHaveBeenCalledOnce()
  })

  it('uploads one or multiple files through the pinned document contracts', async () => {
    const user = userEvent.setup()
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const input = screen.getByLabelText('dataset.newKnowledge.uploadDocuments')
    expect(input).toHaveAttribute('hidden')
    expect(input).toHaveAttribute('tabindex', '-1')

    await user.upload(input, new File(['one'], 'one.md', { type: 'text/markdown' }))
    expect(uploadMutation.mutateAsync).toHaveBeenCalledWith({
      body: { file: expect.any(File) },
      params: { id: 'space-1' },
    })

    await user.upload(input, [
      new File(['two'], 'two.md', { type: 'text/markdown' }),
      new File(['three'], 'three.txt', { type: 'text/plain' }),
    ])
    expect(bulkUploadMutation.mutateAsync).toHaveBeenCalledWith({
      body: { files: [expect.any(File), expect.any(File)] },
      params: { id: 'space-1' },
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalled()
  })

  it('reports partial and fully excluded bulk uploads from the contract result', async () => {
    const user = userEvent.setup()
    bulkUploadMutation.mutateAsync
      .mockResolvedValueOnce({
        accepted: 1,
        bulkJobId: 'upload-partial',
        excluded: 1,
        items: [
          {
            filename: 'too-large.pdf',
            index: 1,
            mimeType: 'application/pdf',
            reason: 'file_too_large',
            sizeBytes: 10_000,
            status: 'excluded',
          },
        ],
        total: 2,
      })
      .mockResolvedValueOnce({
        accepted: 0,
        bulkJobId: 'upload-rejected',
        excluded: 2,
        items: [
          {
            filename: 'one.md',
            index: 0,
            mimeType: 'text/markdown',
            reason: 'quota_exceeded',
            sizeBytes: 3,
            status: 'excluded',
          },
          {
            filename: 'two.md',
            index: 1,
            mimeType: 'text/markdown',
            reason: 'quota_exceeded',
            sizeBytes: 3,
            status: 'excluded',
          },
        ],
        total: 2,
      })
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const input = screen.getByLabelText('dataset.newKnowledge.uploadDocuments')

    await user.upload(input, [
      new File(['one'], 'one.md', { type: 'text/markdown' }),
      new File(['large'], 'too-large.pdf', { type: 'application/pdf' }),
    ])
    expect(toastMock.warning).toHaveBeenCalledWith(
      'dataset.newKnowledge.documentUploadPartial:{"accepted":1,"details":"too-large.pdf (dataset.newKnowledge.documentUploadExclusion.fileSize)","excluded":1}',
    )

    queryClient.invalidateQueries.mockClear()
    await user.upload(input, [
      new File(['one'], 'one.md', { type: 'text/markdown' }),
      new File(['two'], 'two.md', { type: 'text/markdown' }),
    ])
    expect(toastMock.error).toHaveBeenCalledWith(
      'dataset.newKnowledge.documentUploadRejected:{"details":"one.md (dataset.newKnowledge.documentUploadExclusion.quota); two.md (dataset.newKnowledge.documentUploadExclusion.quota)"}',
    )
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
  })

  it('distinguishes a permission failure and exposes retry for other load errors', async () => {
    const user = userEvent.setup()
    documentsQuery.data = undefined
    documentsQuery.error = { status: 403 }

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentsPermissionDescription',
    )
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()

    documentsQuery.error = new Error('temporary')
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(documentsQuery.refetch).toHaveBeenCalledOnce()
  })

  it('filters and searches documents while continuing through cursor pages', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ title: 'Product handbook.pdf' })], nextCursor: 'next' }],
    }
    documentsQuery.hasNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchDocuments' }),
      'later page',
    )

    expect(documentsQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(screen.queryByText('dataset.newKnowledge.noMatchingDocuments')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
  })

  it('blocks selection until filtered cursor pages are complete', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ title: 'Product handbook.pdf' })], nextCursor: 'next' }],
    }
    documentsQuery.hasNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchDocuments' }),
      'product',
    )

    expect(screen.getByRole('checkbox', { name: 'Product handbook.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(
      screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAllDocuments' }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('surfaces dependent source pagination failures and retries the failed page', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    sourcesQuery.isFetchNextPageError = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.sourcesErrorDescription',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
    const documentRow = screen.getByRole('row', { name: /sso-enterprise\.pdf/ })
    expect(
      within(documentRow).queryByText('dataset.newKnowledge.documentStatus.ready'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('keeps cached documents visible when a background task refresh fails', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task()] }] }
    tasksQuery.error = new Error('poll failed')

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('sso-enterprise.pdf')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.tasksErrorDescription',
    )
    expect(
      within(screen.getByRole('row', { name: /sso-enterprise\.pdf/ })).getByText(
        'dataset.newKnowledge.documentStatus.processing',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(tasksQuery.refetch).toHaveBeenCalledOnce()
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).not.toBeInTheDocument()
  })

  it('renders document identity while dependency cursor pages continue loading', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [], nextCursor: 'task-next' }] }
    tasksQuery.hasNextPage = true
    sourcesQuery.data = { pages: [{ items: [], nextCursor: 'source-next' }] }
    sourcesQuery.hasNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('sso-enterprise.pdf')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(tasksQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('keeps selection disabled after a filtered document page fails', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ title: 'Product handbook.pdf' })], nextCursor: 'next' }],
    }
    documentsQuery.hasNextPage = true
    documentsQuery.isFetchNextPageError = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchDocuments' }),
      'product',
    )

    expect(screen.getByRole('checkbox', { name: 'Product handbook.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(
      screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAllDocuments' }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('re-indexes selected documents and keeps unsupported actions unavailable', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'one', title: 'One.pdf' }), document({ id: 'two' })] }],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'One.pdf' }))

    const actions = screen.getByRole('toolbar', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })
    expect(
      within(actions).getByText('dataset.newKnowledge.documentsSelected:{"count":1}'),
    ).toBeInTheDocument()
    const reindex = within(actions).getByRole('button', {
      name: 'dataset.newKnowledge.reindexDocuments',
    })
    expect(reindex).toBeEnabled()
    await user.dblClick(reindex)
    expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
    expect(reindexMutation.mutateAsync).toHaveBeenCalledWith({
      body: { documentIds: ['one'] },
      params: { id: 'space-1' },
    })
    for (const name of ['downloadDocuments', 'deleteDocuments'])
      expect(
        within(actions).getByRole('button', { name: `dataset.newKnowledge.${name}` }),
      ).toBeDisabled()
  })

  it('keeps missing documents selected after a partial bulk re-index result', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({ id: 'one', title: 'One.pdf' }),
            document({ id: 'missing', title: 'Missing.pdf' }),
          ],
        },
      ],
    }
    reindexMutation.mutateAsync.mockResolvedValue({
      bulkJobId: 'reindex-partial',
      items: [
        {
          asset: {
            createdAt: '2026-07-20T10:00:00Z',
            filename: 'one.pdf',
            id: 'asset-1',
            knowledgeSpaceId: 'space-1',
            mimeType: 'application/pdf',
            objectKey: 'documents/one.pdf',
            parserStatus: 'pending',
            sha256: 'sha',
            sizeBytes: 1024,
            version: 1,
          },
          compilationJob: { id: 'job-1', stage: 'queued' },
          status: 'queued',
          statusUrl: '/tasks/job-1',
        },
        { documentId: 'missing', status: 'not_found' },
      ],
      total: 2,
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'One.pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Missing.pdf' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocuments' }))

    expect(screen.getByRole('checkbox', { name: 'One.pdf' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Missing.pdf' })).toBeChecked()
    expect(toastMock.warning).toHaveBeenCalledWith(
      'dataset.newKnowledge.documentsReindexPartial:{"missing":1,"queued":1}',
    )
  })

  it('clears stale selection and refreshes after every re-index target is missing', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({ id: 'missing' })] }] }
    reindexMutation.mutateAsync.mockResolvedValue({
      bulkJobId: 'reindex-missing',
      items: [{ documentId: 'missing', status: 'not_found' }],
      total: 1,
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocuments' }))

    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).not.toBeChecked()
    expect(
      screen.queryByRole('toolbar', { name: 'dataset.newKnowledge.bulkDocumentActions' }),
    ).not.toBeInTheDocument()
    expect(queryClient.invalidateQueries).toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith(
      'dataset.newKnowledge.documentsReindexPartial:{"missing":1,"queued":0}',
    )
  })

  it('counts only attention tasks and opens the designed task panel', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({ id: 'running' }),
            task({ id: 'failed', state: 'failed', errorMessage: 'Parser failed' }),
            task({ id: 'done', state: 'succeeded' }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const trigger = screen.getByRole('button', {
      name: 'dataset.newKnowledge.tasksWithAttention:{"count":2}',
    })
    expect(trigger).toHaveTextContent('2')
    expect(trigger).toHaveAttribute('data-has-error', 'true')
    await user.click(trigger)
    const panel = screen.getByRole('dialog', { name: 'dataset.newKnowledge.backgroundTasks' })
    expect(
      within(panel).getByText('dataset.newKnowledge.backgroundTasksDescription'),
    ).toBeInTheDocument()
    expect(within(panel).getByText('Parser failed')).toBeInTheDocument()
    expect(
      within(panel).getByText((_, element) =>
        Boolean(
          element?.tagName === 'P' &&
          element.textContent?.includes('dataset.newKnowledge.processingTaskState.running') &&
          element.textContent.includes('·'),
        ),
      ),
    ).toBeInTheDocument()
  })

  it('shows task loading instead of an empty result while the task query is pending', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.tasks' }))

    tasksQuery.isPending = true
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    const panel = screen.getByRole('dialog', { name: 'dataset.newKnowledge.backgroundTasks' })
    expect(within(panel).getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
    expect(
      within(panel).queryByText('dataset.newKnowledge.noBackgroundTasks'),
    ).not.toBeInTheDocument()
  })

  it('prevents duplicate interrupt requests and refreshes both resources', async () => {
    const user = userEvent.setup()
    let resolveCancel: ((value: DocumentProcessingTask) => void) | undefined
    cancelMutation.mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve
        }),
    )
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'running' })] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    const interrupt = screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' })
    await user.dblClick(interrupt)

    expect(cancelMutation.mutateAsync).toHaveBeenCalledOnce()
    expect(cancelMutation.mutateAsync).toHaveBeenCalledWith({
      params: { documentId: 'document-1', id: 'space-1', taskId: 'running' },
    })
    await act(async () => resolveCancel?.(task({ id: 'running', state: 'canceled' })))
    expect(queryClient.invalidateQueries).toHaveBeenCalled()
  })

  it('locks cancel and retry together while either task mutation is pending', async () => {
    const user = userEvent.setup()
    let resolveCancel: ((value: DocumentProcessingTask) => void) | undefined
    cancelMutation.mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve
        }),
    )
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'shared-task' })] }] }
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }))

    tasksQuery.data = {
      pages: [{ items: [task({ id: 'shared-task', state: 'failed' })] }],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    const retry = screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' })
    expect(retry).toHaveAttribute('aria-disabled', 'true')
    await user.click(retry)
    expect(retryMutation.mutateAsync).not.toHaveBeenCalled()

    await act(async () => resolveCancel?.(task({ id: 'shared-task', state: 'canceled' })))
  })

  it('retries a failed task once and reports mutation errors in the panel', async () => {
    const user = userEvent.setup()
    retryMutation.mutateAsync.mockRejectedValueOnce(new Error('retry failed'))
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'failed', state: 'failed' })] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))

    expect(retryMutation.mutateAsync).toHaveBeenCalledOnce()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.taskActionFailed',
    )
  })

  it('does not offer retry for a canceled task', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'canceled', state: 'canceled' })] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasks',
      }),
    )

    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.retryTask' }),
    ).not.toBeInTheDocument()
  })

  it('clears an old failure across retry and shows the next terminal error', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({ id: 'retried-failure', state: 'failed', errorMessage: 'Old parser error' }),
          ],
        },
      ],
    }
    retryMutation.mutateAsync.mockResolvedValue(
      task({
        id: 'retried-failure',
        progressPercent: 0,
        state: 'queued',
        updatedAt: '2026-07-20T10:02:00Z',
      }),
    )
    streamProcessingTaskEvents.mockImplementation(async function* () {
      yield {
        data: {
          progressPercent: 20,
          stage: 'parsed' as const,
          state: 'failed' as const,
          updatedAt: '2026-07-20T10:03:00Z',
        },
        event: 'progress' as const,
        id: 'retried-failure:2026-07-20T10:03:00Z',
      }
      yield {
        data: { errorCode: 'NEW_PARSER_ERROR', state: 'failed' as const },
        event: 'terminal' as const,
        id: 'retried-failure:terminal',
      }
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))

    await waitFor(() => expect(screen.queryByText('Old parser error')).not.toBeInTheDocument())
    expect(await screen.findByText('NEW_PARSER_ERROR')).toBeInTheDocument()
  })

  it('accepts an exact active retry snapshot with the terminal timestamp', async () => {
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'same-time-retry' })] }] }
    getTaskSnapshot.mockResolvedValue(
      task({
        id: 'same-time-retry',
        progressPercent: 0,
        state: 'dispatch_pending',
        updatedAt: '2026-07-20T10:03:00Z',
      }),
    )
    let streamCount = 0
    streamProcessingTaskEvents.mockImplementation(async function* () {
      streamCount += 1
      if (streamCount === 1) {
        yield {
          data: {
            progressPercent: 80,
            stage: 'parsed' as const,
            state: 'failed' as const,
            updatedAt: '2026-07-20T10:03:00Z',
          },
          event: 'progress' as const,
          id: 'same-time-retry:2026-07-20T10:03:00Z',
        }
        yield {
          data: { errorCode: 'PARSER_FAILED', state: 'failed' as const },
          event: 'terminal' as const,
          id: 'same-time-retry:terminal',
        }
        return
      }
      await new Promise<void>(() => {})
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
        }),
      ).toHaveTextContent('1'),
    )
    await waitFor(() => expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(2))
    expect(getTaskSnapshot).toHaveBeenCalledWith(
      {
        params: { documentId: 'document-1', id: 'space-1', taskId: 'same-time-retry' },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('replaces an in-flight terminal reconciliation and aborts it on unmount', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'coalesced-reconciliation' })] }] }
    getTaskSnapshot.mockImplementation(
      (_input: unknown, options: { signal: AbortSignal }) =>
        new Promise<DocumentProcessingTask>((_resolve, reject) => {
          signals.push(options.signal)
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )
    streamFailedTaskThenWait('coalesced-reconciliation')

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => {})
      expect(getTaskSnapshot).toHaveBeenCalledOnce()

      tasksQuery.data = {
        pages: [
          {
            items: [
              task({
                id: 'coalesced-reconciliation',
                state: 'dispatch_pending',
                updatedAt: '2026-07-20T10:03:00Z',
              }),
            ],
          },
        ],
      }
      rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
      await act(async () => {})

      expect(getTaskSnapshot).toHaveBeenCalledTimes(2)
      expect(signals[0]?.aborted).toBe(true)
      expect(signals[1]?.aborted).toBe(false)
      rendered.unmount()
      expect(signals[1]?.aborted).toBe(true)
      await act(async () => vi.advanceTimersByTime(60000))
      expect(getTaskSnapshot).toHaveBeenCalledTimes(2)
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('accepts a later active list snapshot after exact reconciliation saw the terminal state', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'later-same-time-retry' })] }] }
    getTaskSnapshot
      .mockResolvedValueOnce(
        task({
          errorCode: 'PARSER_FAILED',
          id: 'later-same-time-retry',
          state: 'failed',
          updatedAt: '2026-07-20T10:03:00Z',
        }),
      )
      .mockResolvedValueOnce(
        task({
          id: 'later-same-time-retry',
          progressPercent: 0,
          state: 'dispatch_pending',
          updatedAt: '2026-07-20T10:03:00Z',
        }),
      )
    streamFailedTaskThenWait('later-same-time-retry')

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(await screen.findByText('PARSER_FAILED')).toBeInTheDocument()
    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledOnce())

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'later-same-time-retry',
              progressPercent: 0,
              state: 'dispatch_pending',
              updatedAt: '2026-07-20T10:03:00Z',
            }),
          ],
        },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('PARSER_FAILED')).not.toBeInTheDocument()
    await waitFor(() => expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(2))
  })

  it('uses a later active list snapshot when exact reconciliation fails', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'failed-reconciliation-retry' })] }] }
    getTaskSnapshot.mockRejectedValueOnce(new Error('snapshot unavailable')).mockResolvedValueOnce(
      task({
        id: 'failed-reconciliation-retry',
        progressPercent: 0,
        state: 'dispatch_pending',
        updatedAt: '2026-07-20T10:03:00Z',
      }),
    )
    streamFailedTaskThenWait('failed-reconciliation-retry')

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(await screen.findByText('PARSER_FAILED')).toBeInTheDocument()
    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledOnce())

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'failed-reconciliation-retry',
              progressPercent: 0,
              state: 'dispatch_pending',
              updatedAt: '2026-07-20T10:03:00Z',
            }),
          ],
        },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('PARSER_FAILED')).not.toBeInTheDocument()
    await waitFor(() => expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(2))
  })

  it('does not treat a stale active row from a completed cursor page as a retry', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [task({ id: 'stale-cursor-active', updatedAt: '2026-07-20T10:03:00Z' })],
        },
      ],
    }
    getTaskSnapshot.mockResolvedValue(
      task({
        errorCode: 'PARSER_FAILED',
        id: 'stale-cursor-active',
        state: 'failed',
        updatedAt: '2026-07-20T10:03:00Z',
      }),
    )
    streamFailedTaskThenWait('stale-cursor-active')

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(await screen.findByText('PARSER_FAILED')).toBeInTheDocument()
    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledOnce())

    tasksQuery.data = {
      pages: [
        {
          items: [task({ id: 'stale-cursor-active', updatedAt: '2026-07-20T10:03:00Z' })],
        },
        { items: [task({ id: 'another-page', state: 'succeeded' })] },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledTimes(2))
    expect(screen.getByText('PARSER_FAILED')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }),
    ).toBeInTheDocument()
    expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()
  })

  it('ignores a terminal reconciliation that resolves after a local retry', async () => {
    const user = userEvent.setup()
    let resolveSnapshot: ((snapshot: DocumentProcessingTask) => void) | undefined
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'local-retry-race' })] }] }
    getTaskSnapshot.mockReturnValue(
      new Promise<DocumentProcessingTask>((resolve) => {
        resolveSnapshot = resolve
      }),
    )
    retryMutation.mutateAsync.mockResolvedValue(
      task({
        id: 'local-retry-race',
        progressPercent: 0,
        state: 'dispatch_pending',
        updatedAt: '2026-07-20T10:03:00Z',
      }),
    )
    streamFailedTaskThenWait('local-retry-race')

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(await screen.findByText('PARSER_FAILED')).toBeInTheDocument()
    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledOnce())
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))
    expect(
      await screen.findByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()

    await act(async () => {
      resolveSnapshot?.(
        task({
          errorCode: 'PARSER_FAILED',
          id: 'local-retry-race',
          state: 'failed',
          updatedAt: '2026-07-20T10:03:00Z',
        }),
      )
    })

    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('PARSER_FAILED')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.retryTask' }),
    ).not.toBeInTheDocument()
  })

  it('consumes the terminal error after final progress without duplicate side effects', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'failed-stream' })] }] }
    streamProcessingTaskEvents.mockImplementation(async function* () {
      yield {
        data: {
          progressPercent: 80,
          stage: 'parsed' as const,
          state: 'failed' as const,
          updatedAt: '2026-07-20T10:03:00Z',
        },
        event: 'progress' as const,
        id: 'failed-stream:2026-07-20T10:03:00Z',
      }
      yield {
        data: { errorCode: 'PARSER_FAILED', state: 'failed' as const },
        event: 'terminal' as const,
        id: 'failed-stream:terminal',
      }
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )

    expect(await screen.findByText('PARSER_FAILED')).toBeInTheDocument()
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledOnce()
  })

  it('applies task events and clears the attention badge after completion', async () => {
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'running' })] }] }
    let streamCount = 0
    streamProcessingTaskEvents.mockImplementation(async function* () {
      streamCount += 1
      if (streamCount === 1) {
        yield {
          data: {
            progressPercent: 100,
            stage: 'published' as const,
            state: 'succeeded' as const,
            updatedAt: '2026-07-20T10:06:00Z',
          },
          event: 'progress' as const,
          id: 'running:2026-07-20T10:06:00Z',
        }
        yield {
          data: { state: 'succeeded' as const },
          event: 'terminal' as const,
          id: 'running:terminal',
        }
        return
      }
      await new Promise<void>(() => {})
    })

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.tasks' }),
      ).not.toHaveTextContent('1'),
    )
    expect(streamProcessingTaskEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'document-1',
        knowledgeSpaceId: 'space-1',
        taskId: 'running',
      }),
    )
    expect(queryClient.invalidateQueries).toHaveBeenCalled()

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'running',
              progressPercent: 90,
              state: 'running',
              updatedAt: '2026-07-20T10:05:00Z',
            }),
          ],
        },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.tasks' }),
    ).not.toHaveTextContent('1')

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'running',
              progressPercent: 100,
              state: 'succeeded',
              updatedAt: '2026-07-20T10:06:00Z',
            }),
          ],
        },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.tasks' }),
      ).not.toHaveTextContent('1'),
    )

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'running',
              progressPercent: 0,
              state: 'queued',
              updatedAt: '2026-07-20T10:07:00Z',
            }),
          ],
        },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
        }),
      ).toHaveTextContent('1'),
    )
  })

  it('accepts an external retry newer than the terminal event version', async () => {
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'externally-retried' })] }] }
    let streamCount = 0
    streamProcessingTaskEvents.mockImplementation(async function* () {
      streamCount += 1
      if (streamCount === 1) {
        yield {
          data: {
            progressPercent: 100,
            stage: 'published' as const,
            state: 'succeeded' as const,
            updatedAt: '2026-07-20T10:04:00Z',
          },
          event: 'progress' as const,
          id: 'externally-retried:2026-07-20T10:04:00Z',
        }
        yield {
          data: { state: 'succeeded' as const },
          event: 'terminal' as const,
          id: 'externally-retried:terminal',
        }
        return
      }
      await new Promise<void>(() => {})
    })

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.tasks' }),
      ).not.toHaveTextContent('1'),
    )

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'externally-retried',
              progressPercent: 0,
              state: 'queued',
              updatedAt: '2026-07-20T10:05:00Z',
            }),
          ],
        },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
        }),
      ).toHaveTextContent('1'),
    )
    await waitFor(() => expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    })
  })

  it('ignores a stale terminal event after polling observes an external retry', async () => {
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'retry-race' })] }] }
    let releaseTerminal: (() => void) | undefined
    let streamCount = 0
    streamProcessingTaskEvents.mockImplementation(async function* () {
      streamCount += 1
      if (streamCount === 1) {
        await new Promise<void>((resolve) => {
          releaseTerminal = resolve
        })
        yield {
          data: {
            progressPercent: 100,
            stage: 'published' as const,
            state: 'succeeded' as const,
            updatedAt: '2026-07-20T10:03:00Z',
          },
          event: 'progress' as const,
          id: 'retry-race:progress',
        }
        yield {
          data: { state: 'succeeded' as const },
          event: 'terminal' as const,
          id: 'retry-race:terminal',
        }
        return
      }
      await new Promise<void>(() => {})
    })

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() => expect(releaseTerminal).toBeTypeOf('function'))

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'retry-race',
              progressPercent: 0,
              state: 'queued',
              updatedAt: '2026-07-20T10:05:00Z',
            }),
          ],
        },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await act(async () => releaseTerminal?.())
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
        }),
      ).toHaveTextContent('1'),
    )
    await waitFor(() => expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    })
  })

  it('keeps one event stream and its resume cursor when polling updates task versions', async () => {
    let releaseStream: (() => void) | undefined
    streamProcessingTaskEvents.mockImplementation(async function* () {
      await new Promise<void>((resolve) => {
        releaseStream = resolve
      })
    })
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'streaming' })] }] }
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() => expect(streamProcessingTaskEvents).toHaveBeenCalledOnce())

    tasksQuery.data = {
      pages: [
        {
          items: [task({ id: 'streaming', updatedAt: '2026-07-20T10:02:00Z' })],
        },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()

    await act(async () => releaseStream?.())
  })

  it('keeps task event progress monotonic and yields to a newer server snapshot', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'running' })] }] }
    streamProcessingTaskEvents.mockImplementation(async function* () {
      yield {
        data: {
          progressPercent: 80,
          stage: 'nodes_generated' as const,
          state: 'running' as const,
          updatedAt: '2026-07-20T10:03:00Z',
        },
        event: 'progress' as const,
        id: 'running:newer',
      }
      yield {
        data: {
          progressPercent: 20,
          stage: 'parsed' as const,
          state: 'running' as const,
          updatedAt: '2026-07-20T10:02:00Z',
        },
        event: 'progress' as const,
        id: 'running:stale',
      }
    })

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await waitFor(() =>
      expect(
        screen.getByText(/dataset\.newKnowledge\.processingTaskState\.running.*"progress":80/),
      ).toBeInTheDocument(),
    )
    await act(async () => {})
    expect(
      screen.queryByText(/dataset\.newKnowledge\.processingTaskState\.running.*"progress":20/),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'running',
              progressPercent: 100,
              state: 'succeeded',
              updatedAt: '2026-07-20T10:04:00Z',
            }),
          ],
        },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.tasks' })).toBeInTheDocument()
  })

  it('limits rendered task history while retaining an active retry for an old document', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    const history = Array.from({ length: 150 }, (_, index) =>
      task({
        id: `history-${index}`,
        state: 'succeeded',
        updatedAt: new Date(Date.UTC(2026, 6, 20, 10, index)).toISOString(),
      }),
    )
    history[0] = task({
      createdAt: '2026-07-01T10:00:00Z',
      id: 'old-active-retry',
      state: 'running',
      updatedAt: '2026-07-01T10:00:00Z',
    })
    history[1] = task({
      createdAt: '2026-07-01T10:01:00Z',
      id: 'old-failed-retry',
      state: 'failed',
      updatedAt: '2026-08-01T10:00:00Z',
    })
    tasksQuery.data = { pages: [{ items: history }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":2}',
      }),
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(100)
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }),
    ).toBeInTheDocument()
  })

  it('keeps a failed task actionable when one hundred active tasks fill the drawer', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            ...Array.from({ length: 100 }, (_, index) =>
              task({
                id: `active-${index}`,
                updatedAt: new Date(Date.UTC(2026, 6, 20, 10, index)).toISOString(),
              }),
            ),
            task({
              id: 'failed-outside-active-limit',
              state: 'failed',
              updatedAt: '2026-07-01T10:00:00Z',
            }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":101}',
      }),
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(100)
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }),
    ).toBeInTheDocument()
  })

  it('rotates a bounded task event stream pool without polling every cursor page', async () => {
    vi.useFakeTimers()
    streamProcessingTaskEvents.mockImplementation(async function* () {
      await new Promise<void>(() => {})
    })
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: Array.from({ length: 20 }, (_, index) =>
            task({
              id: `active-${index}`,
              updatedAt: new Date(Date.UTC(2026, 6, 20, 10, index)).toISOString(),
            }),
          ),
        },
      ],
    }

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => {})
      expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(6)
      await act(async () => vi.advanceTimersByTime(5000))
      expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(12)
      const taskOptions = tasksInfiniteOptions.mock.lastCall?.[0]
      expect(taskOptions?.refetchInterval).toBeUndefined()
      expect(
        screen.getByRole('button', {
          name: 'dataset.newKnowledge.tasksWithAttention:{"count":20}',
        }),
      ).toBeInTheDocument()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('keeps rotation membership stable when progress updates task timestamps', async () => {
    vi.useFakeTimers()
    const callsByTask = new Map<string, number>()
    streamProcessingTaskEvents.mockImplementation(async function* ({ taskId }: { taskId: string }) {
      callsByTask.set(taskId, (callsByTask.get(taskId) ?? 0) + 1)
      yield {
        data: {
          progressPercent: 50,
          stage: 'parsed' as const,
          state: 'running' as const,
          updatedAt: '2026-07-20T12:00:00Z',
        },
        event: 'progress' as const,
        id: `${taskId}:progress`,
      }
      await new Promise<void>(() => {})
    })
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: Array.from({ length: 12 }, (_, index) =>
            task({
              createdAt: new Date(Date.UTC(2026, 6, 20, 9, index)).toISOString(),
              id: `stable-${index}`,
              updatedAt: new Date(Date.UTC(2026, 6, 20, 10, index)).toISOString(),
            }),
          ),
        },
      ],
    }

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => {})
      await act(async () => vi.advanceTimersByTime(5000))
      await act(async () => {})

      expect(callsByTask).toHaveLength(12)
      expect([...callsByTask.values()]).toEqual(Array.from({ length: 12 }, () => 1))
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('relies on bounded reconnect backoff instead of invalidating queries on stream closure', async () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'closed-stream' })] }] }
    streamProcessingTaskEvents.mockImplementation(async function* () {})

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(streamProcessingTaskEvents).toHaveBeenCalledOnce())
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
  })

  it('polls failed tasks through a bounded exact-snapshot pool for external retries', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'external-retry', state: 'failed' })] }],
    }
    getTaskSnapshot.mockResolvedValue(
      task({
        id: 'external-retry',
        progressPercent: 0,
        state: 'dispatch_pending',
        updatedAt: '2026-07-20T10:03:00Z',
      }),
    )

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()
      await act(async () => {})
      expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('keeps one failed-task poll in flight and ignores it after a local retry', async () => {
    vi.useFakeTimers()
    let resolvePoll: ((snapshot: DocumentProcessingTask) => void) | undefined
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'slow-failed-poll', state: 'failed' })] }],
    }
    getTaskSnapshot.mockReturnValue(
      new Promise<DocumentProcessingTask>((resolve) => {
        resolvePoll = resolve
      }),
    )
    retryMutation.mutateAsync.mockResolvedValue(
      task({
        id: 'slow-failed-poll',
        progressPercent: 0,
        state: 'dispatch_pending',
        updatedAt: '2026-07-20T10:03:00Z',
      }),
    )

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
        }),
      )
      await act(async () => vi.advanceTimersByTime(20000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))
      await act(async () => {})
      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
      ).toBeInTheDocument()

      await act(async () => {
        resolvePoll?.(
          task({
            errorCode: 'OLD_FAILURE',
            id: 'slow-failed-poll',
            state: 'failed',
            updatedAt: '2026-07-20T10:01:00Z',
          }),
        )
      })

      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
      ).toBeInTheDocument()
      expect(screen.queryByText('OLD_FAILURE')).not.toBeInTheDocument()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('ignores a delayed permanent poll rejection after a local retry', async () => {
    vi.useFakeTimers()
    let rejectPoll: ((error: unknown) => void) | undefined
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'rejected-failed-poll', state: 'failed' })] }],
    }
    getTaskSnapshot
      .mockReturnValueOnce(
        new Promise<DocumentProcessingTask>((_resolve, reject) => {
          rejectPoll = reject
        }),
      )
      .mockResolvedValueOnce(
        task({
          id: 'rejected-failed-poll',
          progressPercent: 0,
          state: 'dispatch_pending',
          updatedAt: '2026-07-20T10:05:00Z',
        }),
      )
    retryMutation.mutateAsync.mockResolvedValue(
      task({
        id: 'rejected-failed-poll',
        progressPercent: 0,
        state: 'dispatch_pending',
        updatedAt: '2026-07-20T10:03:00Z',
      }),
    )

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
        }),
      )
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))
      await act(async () => {})
      await act(async () => rejectPoll?.(new Response(null, { status: 403 })))

      tasksQuery.data = {
        pages: [
          {
            items: [
              task({
                id: 'rejected-failed-poll',
                state: 'failed',
                updatedAt: '2026-07-20T10:04:00Z',
              }),
            ],
          },
        ],
      }
      rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
      await act(async () => vi.advanceTimersByTime(5000))

      expect(getTaskSnapshot).toHaveBeenCalledTimes(2)
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('stops polling a failed task after a permanent snapshot error', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'forbidden-failed-poll', state: 'failed' })] }],
    }
    getTaskSnapshot.mockRejectedValue(new Response(null, { status: 403 }))

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()
      await act(async () => vi.advanceTimersByTime(60000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('renders large document results in bounded batches', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: Array.from({ length: 150 }, (_, index) =>
            document({ id: `document-${index}`, title: `Document ${index}` }),
          ),
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getAllByRole('row')).toHaveLength(101)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))
    expect(screen.getAllByRole('row')).toHaveLength(151)
  })

  it('eagerly exhausts task and source cursor pages for accurate labels', () => {
    tasksQuery.data = { pages: [{ items: [], nextCursor: 'next' }] }
    tasksQuery.hasNextPage = true
    sourcesQuery.data = { pages: [{ items: [], nextCursor: 'source-next' }] }
    sourcesQuery.hasNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(tasksQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('bounds automatic cursor exhaustion and leaves all further loading explicit', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: Array.from({ length: 20 }, (_, index) => ({
        items: index === 0 ? [document()] : [],
        nextCursor: 'next',
      })),
    }
    documentsQuery.hasNextPage = true
    tasksQuery.data = {
      pages: Array.from({ length: 20 }, () => ({ items: [], nextCursor: 'next' })),
    }
    tasksQuery.hasNextPage = true
    sourcesQuery.data = {
      pages: Array.from({ length: 20 }, (_, index) => ({
        items: index === 0 ? [source()] : [],
        nextCursor: 'next',
      })),
    }
    sourcesQuery.hasNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchDocuments' }),
      'sso',
    )

    expect(documentsQuery.fetchNextPage).not.toHaveBeenCalled()
    const loadMore = screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' })
    expect(loadMore).toBeInTheDocument()
    await user.click(loadMore)
    expect(documentsQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(tasksQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })
})

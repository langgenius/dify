import type {
  DocumentProcessingTask,
  LogicalDocument,
  Source,
} from '@dify/contracts/knowledge-fs/types.gen'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs as render } from '@/test/nuqs-testing'
import { DocumentsPage } from '../documents-page'
import { TaskEventObserver } from '../task-event-observer'

type InfiniteOptions = {
  enabled?: boolean
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
  isFetching: false,
  isFetchingNextPage: false,
  isPending: false,
  isRefetching: false,
  refetch: vi.fn(),
}))

const tasksQuery = vi.hoisted(() => ({
  data: undefined as
    | { pages: Array<{ items: DocumentProcessingTask[]; nextCursor?: string }> }
    | undefined,
  dataUpdatedAt: 0,
  dataUpdateCount: 0,
  error: null as unknown,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchNextPageError: false,
  isFetching: false,
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
  isFetching: false,
  isFetchingNextPage: false,
  isPending: false,
  refetch: vi.fn(),
}))

const cancelMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const retryMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const reindexMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const uploadMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const bulkUploadMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const queryClient = vi.hoisted(() => ({
  cancelQueries: vi.fn(),
  getQueryState: vi.fn(() => ({ dataUpdateCount: tasksQuery.dataUpdateCount })),
  invalidateQueries: vi.fn(),
}))
const streamProcessingTaskEvents = vi.hoisted(() => vi.fn())
const getTaskSnapshot = vi.hoisted(() => vi.fn())
const permissionStateMock = vi.hoisted(() => ({
  datasetAtom: Symbol('datasetDefaultPermissionKeysAtom'),
  datasetKeys: ['dataset.acl.edit'],
  error: null as unknown,
  errorAtom: Symbol('workspacePermissionKeysErrorAtom'),
  fetching: false,
  fetchingAtom: Symbol('workspacePermissionKeysFetchingAtom'),
  loading: false,
  loadingAtom: Symbol('workspacePermissionKeysLoadingAtom'),
  retry: vi.fn(),
  retryAtom: Symbol('retryWorkspacePermissionKeysAtom'),
  refreshAfterDenial: vi.fn(),
  refreshAfterDenialAtom: Symbol('refreshWorkspacePermissionKeysAfterMutationDenialAtom'),
}))
const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('@/context/permission-state', () => ({
  datasetDefaultPermissionKeysAtom: permissionStateMock.datasetAtom,
  refreshWorkspacePermissionKeysAfterMutationDenialAtom: permissionStateMock.refreshAfterDenialAtom,
  retryWorkspacePermissionKeysAtom: permissionStateMock.retryAtom,
  workspacePermissionKeysErrorAtom: permissionStateMock.errorAtom,
  workspacePermissionKeysFetchingAtom: permissionStateMock.fetchingAtom,
  workspacePermissionKeysLoadingAtom: permissionStateMock.loadingAtom,
}))

vi.mock('jotai', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai')>()
  return {
    ...original,
    useAtomValue: (atom: unknown) => {
      if (atom === permissionStateMock.datasetAtom) return permissionStateMock.datasetKeys
      if (atom === permissionStateMock.errorAtom) return permissionStateMock.error
      if (atom === permissionStateMock.fetchingAtom) return permissionStateMock.fetching
      if (atom === permissionStateMock.loadingAtom) return permissionStateMock.loading
      return original.useAtomValue(atom as Parameters<typeof original.useAtomValue>[0])
    },
    useSetAtom: (atom: unknown) =>
      atom === permissionStateMock.retryAtom
        ? permissionStateMock.retry
        : atom === permissionStateMock.refreshAfterDenialAtom
          ? permissionStateMock.refreshAfterDenial
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
        key: () => ['knowledge-fs', 'sources'],
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
    queryClient.cancelQueries.mockResolvedValue(undefined)
    queryClient.invalidateQueries.mockResolvedValue(undefined)
    documentsQuery.data = { pages: [{ items: [] }] }
    documentsQuery.error = null
    documentsQuery.hasNextPage = false
    documentsQuery.isFetchNextPageError = false
    documentsQuery.isFetching = false
    documentsQuery.isFetchingNextPage = false
    documentsQuery.isPending = false
    documentsQuery.isRefetching = false
    tasksQuery.data = { pages: [{ items: [] }] }
    tasksQuery.dataUpdatedAt = 0
    tasksQuery.dataUpdateCount = 0
    tasksQuery.error = null
    tasksQuery.hasNextPage = false
    tasksQuery.isFetchNextPageError = false
    tasksQuery.isFetching = false
    tasksQuery.isFetchingNextPage = false
    tasksQuery.isPending = false
    sourcesQuery.data = { pages: [{ items: [source()] }] }
    sourcesQuery.error = null
    sourcesQuery.hasNextPage = false
    sourcesQuery.isFetchNextPageError = false
    sourcesQuery.isFetching = false
    sourcesQuery.isFetchingNextPage = false
    sourcesQuery.isPending = false
    permissionStateMock.datasetKeys = ['dataset.acl.edit']
    permissionStateMock.error = null
    permissionStateMock.fetching = false
    permissionStateMock.loading = false
    permissionStateMock.retry.mockResolvedValue({
      data: {
        dataset: { default_permission_keys: ['dataset.acl.edit'] },
      },
      error: null,
    })
    permissionStateMock.refreshAfterDenial.mockResolvedValue({
      data: {
        dataset: { default_permission_keys: ['dataset.acl.edit'] },
      },
      error: null,
    })
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

  it('restores document search and status filters from the URL', () => {
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({ id: 'ready-document', title: 'Ready handbook.pdf' }),
            document({ id: 'failed-document', title: 'Failed report.pdf' }),
          ],
        },
      ],
    }
    tasksQuery.data = {
      pages: [
        {
          items: [task({ documentId: 'failed-document', id: 'failed-task', state: 'failed' })],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />, {
      searchParams: '?query=report&status=failed',
    })

    expect(screen.getByRole('searchbox')).toHaveValue('report')
    expect(screen.getByRole('combobox')).toHaveValue('failed')
    expect(screen.getByText('Failed report.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Ready handbook.pdf')).not.toBeInTheDocument()
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

  it('keeps processing tasks reachable while the document list is empty', async () => {
    const user = userEvent.setup()
    tasksQuery.data = { pages: [{ items: [task({ id: 'orphaned-running-task' })] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()
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
    expect(
      within(screen.getByRole('dialog')).getByText('dataset.newKnowledge.permissionRestricted'),
    ).toBeInTheDocument()
  })

  it('keeps permission lookup failures distinct from read-only access and retries them', async () => {
    const user = userEvent.setup()
    permissionStateMock.error = new Error('permission service unavailable')
    documentsQuery.data = { pages: [{ items: [document()] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent('dataset.newKnowledge.permissionLoadFailed')
    expect(screen.queryByText('dataset.newKnowledge.permissionRestricted')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeDisabled()
    await user.click(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.permissionLoadFailed',
      }),
    )
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
    const documentInvalidation = queryClient.invalidateQueries.mock.calls.find(
      ([options]) => options.queryKey[1] === 'documents',
    )?.[0]
    expect(
      documentInvalidation?.predicate({
        queryKey: [
          ['console', 'knowledgeFs', 'getKnowledgeSpacesByIdLogicalDocuments'],
          { input: { params: { id: 'space-1' } }, type: 'infinite' },
        ],
      }),
    ).toBe(true)
    expect(
      documentInvalidation?.predicate({
        queryKey: [
          ['console', 'knowledgeFs', 'getKnowledgeSpacesByIdLogicalDocuments'],
          { input: { params: { id: 'space-2' } }, type: 'infinite' },
        ],
      }),
    ).toBe(false)
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
    await user.click(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.documentsErrorDescription',
      }),
    )
    expect(documentsQuery.refetch).toHaveBeenCalledOnce()
  })

  it('reports a failed background document refresh while preserving cached rows', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    documentsQuery.error = new Error('background refresh failed')

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('sso-enterprise.pdf')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentsErrorDescription',
    )
    await user.click(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.documentsErrorDescription',
      }),
    )
    expect(documentsQuery.refetch).toHaveBeenCalledOnce()
  })

  it('blocks cached document content when a background refresh loses permission', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    documentsQuery.error = { status: 403 }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentsPermissionDescription',
    )
    expect(screen.queryByText('sso-enterprise.pdf')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('dataset.newKnowledge.uploadDocuments')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.tasks' }),
    ).not.toBeInTheDocument()
  })

  it('keeps cached refresh retries busy while their queries are fetching', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    documentsQuery.error = new Error('document refresh failed')
    documentsQuery.isRefetching = true
    tasksQuery.error = new Error('task refresh failed')
    tasksQuery.isFetching = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.documentsErrorDescription',
      }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.tasksErrorDescription',
      }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps permission retries busy while permission keys are refetching', () => {
    permissionStateMock.error = new Error('permission refresh failed')
    permissionStateMock.fetching = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.permissionLoadFailed',
      }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('does not disable a failed dependency retry for an unrelated background refresh', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.error = new Error('task refresh failed')
    sourcesQuery.isFetching = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.tasksErrorDescription',
      }),
    ).not.toHaveAttribute('aria-disabled')
  })

  it('keeps a blocking dependency retry stable while its first page refetches', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = undefined
    tasksQuery.error = new Error('task first page failed')
    sourcesQuery.error = new Error('source background refresh failed')
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const retry = screen.getByRole('button', {
      name: 'common.operation.retry · dataset.newKnowledge.tasksErrorDescription',
    })

    await user.click(retry)
    expect(tasksQuery.refetch).toHaveBeenCalledOnce()
    tasksQuery.error = null
    tasksQuery.isFetching = true
    tasksQuery.isPending = true
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(retry).toBeInTheDocument()
    expect(retry).toHaveFocus()
    expect(retry).toHaveAttribute('aria-disabled', 'true')

    tasksQuery.data = { pages: [{ items: [] }] }
    tasksQuery.isFetching = false
    tasksQuery.isPending = false
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(screen.getByText('sso-enterprise.pdf')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'common.operation.retry · dataset.newKnowledge.sourcesErrorDescription',
        }),
      ).toHaveFocus(),
    )

    sourcesQuery.error = null
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'dataset.newKnowledge.documents' })).toHaveFocus(),
    )
  })

  it('closes a task drawer permanently and restores focus when document permission is revoked', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task()] }] }
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    documentsQuery.error = { status: 403 }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const permissionAlert = screen.getByRole('alert')
    expect(permissionAlert).toHaveFocus()
    expect(tasksInfiniteOptions.mock.lastCall?.[0].enabled).toBe(false)
    expect(sourcesInfiniteOptions.mock.lastCall?.[0].enabled).toBe(false)
    expect(queryClient.cancelQueries).toHaveBeenCalledWith({
      predicate: expect.any(Function),
      queryKey: ['knowledge-fs', 'tasks'],
    })
    expect(queryClient.cancelQueries).toHaveBeenCalledWith({
      predicate: expect.any(Function),
      queryKey: ['knowledge-fs', 'sources'],
    })
    const taskCancellation = queryClient.cancelQueries.mock.calls.find(
      ([options]) => options.queryKey[1] === 'tasks',
    )?.[0]
    expect(
      taskCancellation?.predicate({
        queryKey: [
          ['console', 'knowledgeFs', 'getKnowledgeSpacesByIdProcessingTasks'],
          { input: { params: { id: 'space-1' } }, type: 'infinite' },
        ],
      }),
    ).toBe(true)
    expect(
      taskCancellation?.predicate({
        queryKey: [
          ['console', 'knowledgeFs', 'getKnowledgeSpacesByIdProcessingTasks'],
          { input: { params: { id: 'space-2' } }, type: 'infinite' },
        ],
      }),
    ).toBe(false)

    documentsQuery.error = null
    tasksQuery.refetch.mockClear()
    sourcesQuery.refetch.mockClear()
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(tasksQuery.refetch).toHaveBeenCalledWith({ cancelRefetch: false })
    expect(sourcesQuery.refetch).toHaveBeenCalledWith({ cancelRefetch: false })
  })

  it('does not repeat the child query that already recovered from permission denial', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [] }] }
    tasksQuery.error = { status: 403 }
    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)

    tasksQuery.error = null
    tasksQuery.refetch.mockClear()
    sourcesQuery.refetch.mockClear()
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(tasksQuery.refetch).not.toHaveBeenCalled()
    expect(sourcesQuery.refetch).toHaveBeenCalledWith({ cancelRefetch: false })
  })

  it('moves focus from document controls to the permission alert after dynamic revocation', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const searchbox = screen.getByRole('searchbox', {
      name: 'dataset.newKnowledge.searchDocuments',
    })
    await user.click(searchbox)
    expect(searchbox).toHaveFocus()

    documentsQuery.error = { status: 403 }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())

    documentsQuery.error = null
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'dataset.newKnowledge.documents' })).toHaveFocus(),
    )
  })

  it('moves focus from bulk actions to the permission alert after dynamic revocation', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' }))
    const reindex = within(
      screen.getByRole('group', { name: 'dataset.newKnowledge.bulkDocumentActions' }),
    ).getByRole('button', { name: 'dataset.newKnowledge.reindexDocuments' })
    act(() => reindex.focus())

    documentsQuery.error = { status: 403 }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
  })

  it('stops background pagination and failed-task polling while document permission is denied', async () => {
    vi.useFakeTimers()
    documentsQuery.data = {
      pages: [{ items: [document({ sourceId: 'unresolved-source' })], nextCursor: 'next' }],
    }
    documentsQuery.error = { status: 403 }
    documentsQuery.hasNextPage = true
    tasksQuery.data = {
      pages: [{ items: [task({ state: 'failed' })], nextCursor: 'task-next' }],
    }
    tasksQuery.hasNextPage = true
    sourcesQuery.data = { pages: [{ items: [], nextCursor: 'source-next' }] }
    sourcesQuery.hasNextPage = true

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />, {
      searchParams: '?query=sso',
    })
    try {
      await act(async () => vi.advanceTimersByTime(10_000))

      expect(documentsQuery.fetchNextPage).not.toHaveBeenCalled()
      expect(tasksQuery.fetchNextPage).not.toHaveBeenCalled()
      expect(sourcesQuery.fetchNextPage).not.toHaveBeenCalled()
      expect(getTaskSnapshot).not.toHaveBeenCalled()
      expect(streamProcessingTaskEvents).not.toHaveBeenCalled()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
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
    expect(screen.getByText('dataset.newKnowledge.partialDocumentResults')).toBeInTheDocument()
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
    await user.click(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.sourcesErrorDescription',
      }),
    )
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
    const documentRow = screen.getByRole('row', { name: /sso-enterprise\.pdf/ })
    expect(
      within(documentRow).getByText('dataset.newKnowledge.documentStatus.ready'),
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeEnabled()
  })

  it('retries a failed task cursor page from the task drawer', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.isFetchNextPageError = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.tasks' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.tasksErrorDescription',
      }),
    )

    expect(tasksQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(tasksQuery.refetch).not.toHaveBeenCalled()
  })

  it('returns focus to the drawer close button after a query retry succeeds', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.error = new Error('task refresh failed')
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.tasks' }))
    const panel = screen.getByRole('dialog')
    await user.click(
      within(panel).getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.tasksErrorDescription',
      }),
    )

    tasksQuery.error = null
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'common.operation.close' })).toHaveFocus(),
    )
  })

  it('moves focus between drawer query retries as each error recovers', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document()], nextCursor: 'document-next' }],
    }
    documentsQuery.hasNextPage = true
    documentsQuery.isFetchNextPageError = true
    tasksQuery.data = {
      pages: [{ items: [task({ documentId: 'missing-document' })] }],
    }
    tasksQuery.error = new Error('task refresh failed')
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    const panel = screen.getByRole('dialog')
    await user.click(
      within(panel).getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.tasksErrorDescription',
      }),
    )

    tasksQuery.error = null
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    const documentRetry = within(panel).getByRole('button', {
      name: 'common.operation.retry · dataset.newKnowledge.documentsErrorDescription',
    })
    await waitFor(() => expect(documentRetry).toHaveFocus())
    await user.click(documentRetry)

    documentsQuery.isFetchNextPageError = false
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'common.operation.close' })).toHaveFocus(),
    )
  })

  it('continues remote task pagination from an empty cached drawer after the automatic cap', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: Array.from({ length: 20 }, () => ({
        items: [],
        nextCursor: 'next',
      })),
    }
    tasksQuery.hasNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const taskTrigger = screen.getByRole('button', {
      name: 'dataset.newKnowledge.tasksWithAttention:{"count":0} · dataset.newKnowledge.taskHistoryIncomplete',
    })
    expect(taskTrigger).toHaveTextContent('0+')
    await user.click(taskTrigger)
    expect(
      within(screen.getByRole('dialog')).queryByText('dataset.newKnowledge.noBackgroundTasks'),
    ).not.toBeInTheDocument()
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'dataset.newKnowledge.loadMore',
      }),
    )

    expect(tasksQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('loads document titles for tasks whose documents are on a later cursor page', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: Array.from({ length: 20 }, (_, index) => ({
        items: index === 0 ? [document()] : [],
        nextCursor: 'next',
      })),
    }
    documentsQuery.hasNextPage = true
    tasksQuery.data = {
      pages: [
        {
          items: [task({ documentId: 'later-document', id: 'later-task', state: 'succeeded' })],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.tasks' }))

    const panel = screen.getByRole('dialog')
    expect(within(panel).queryByText('later-document')).not.toBeInTheDocument()
    expect(
      within(panel).getByText(
        'dataset.newKnowledge.processDocument:{"name":"dataset.newKnowledge.documentColumn"}',
      ),
    ).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))
    expect(documentsQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('defers task title pagination until the task drawer is opened', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document()], nextCursor: 'next' }],
    }
    documentsQuery.hasNextPage = true
    tasksQuery.data = {
      pages: [
        {
          items: [task({ documentId: 'later-document', id: 'later-task', state: 'succeeded' })],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(documentsQuery.fetchNextPage).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.tasks' }))
    await waitFor(() => expect(documentsQuery.fetchNextPage).toHaveBeenCalledOnce())
  })

  it('reports and retries task title pagination failures inside the drawer', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document()], nextCursor: 'next' }],
    }
    documentsQuery.hasNextPage = true
    documentsQuery.isFetchNextPageError = true
    tasksQuery.data = {
      pages: [
        {
          items: [task({ documentId: 'later-document', id: 'later-task', state: 'succeeded' })],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.tasks' }))

    const panel = screen.getByRole('dialog')
    expect(within(panel).getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentsErrorDescription',
    )
    await user.click(
      within(panel).getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.documentsErrorDescription',
      }),
    )
    expect(documentsQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('keeps an unresolved source pending when a background source refresh fails', () => {
    documentsQuery.data = {
      pages: [{ items: [document({ sourceId: 'unresolved-source' })] }],
    }
    sourcesQuery.error = new Error('source refresh failed')

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const documentRow = screen.getByRole('row', { name: /sso-enterprise\.pdf/ })
    expect(
      within(documentRow).queryByText('dataset.newKnowledge.documentStatus.disabled'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('keeps loaded task actions available when background task pagination fails', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task()] }] }
    tasksQuery.error = new Error('poll failed')
    tasksQuery.isFetchingNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('sso-enterprise.pdf')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.tasksErrorDescription',
    )
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.tasksErrorDescription',
      }),
    )
    expect(tasksQuery.refetch).toHaveBeenCalledOnce()
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()
  })

  it('reports and retries cached task refresh failures from the document empty state', async () => {
    const user = userEvent.setup()
    tasksQuery.error = new Error('task refresh failed')

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.tasksErrorDescription',
    )
    await user.click(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.tasksErrorDescription',
      }),
    )
    expect(tasksQuery.refetch).toHaveBeenCalledOnce()
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

  it('keeps document status and selection pending until the first task page arrives', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = undefined
    tasksQuery.isPending = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const documentRow = screen.getByRole('row', { name: /sso-enterprise\.pdf/ })
    expect(
      within(documentRow).queryByText('dataset.newKnowledge.documentStatus.ready'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('region', { name: 'dataset.newKnowledge.documents' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('keeps document state pending while the next task cursor page is loading', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [], nextCursor: 'next' }] }
    tasksQuery.hasNextPage = true
    tasksQuery.isFetchingNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const documentRow = screen.getByRole('row', { name: /sso-enterprise\.pdf/ })
    expect(
      within(documentRow).queryByText('dataset.newKnowledge.documentStatus.ready'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
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
    await user.click(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.documentsErrorDescription',
      }),
    )
    expect(documentsQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('keeps a failed document page retry busy while the next page is fetching', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document()], nextCursor: 'next' }],
    }
    documentsQuery.hasNextPage = true
    documentsQuery.isFetchNextPageError = true
    documentsQuery.isFetchingNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchDocuments' }),
      'sso',
    )

    expect(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.documentsErrorDescription',
      }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('does not disable a document page retry for unrelated dependency pagination', () => {
    documentsQuery.data = { pages: [{ items: [document()], nextCursor: 'next' }] }
    documentsQuery.hasNextPage = true
    documentsQuery.isFetchNextPageError = true
    tasksQuery.data = {
      pages: Array.from({ length: 20 }, () => ({ items: [], nextCursor: 'task-next' })),
    }
    tasksQuery.hasNextPage = true
    tasksQuery.isFetchingNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.documentsErrorDescription',
      }),
    ).not.toHaveAttribute('aria-disabled')
  })

  it('moves pagination focus from load more to retry and then to final results', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()], nextCursor: 'next' }] }
    documentsQuery.hasNextPage = true
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))

    documentsQuery.isFetchNextPageError = true
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    const retry = screen.getByRole('button', {
      name: 'common.operation.retry · dataset.newKnowledge.documentsErrorDescription',
    })
    await waitFor(() => expect(retry).toHaveFocus())
    await user.click(retry)

    documentsQuery.data = {
      pages: [
        { items: [document()] },
        { items: [document({ id: 'last-document', title: 'Last.pdf' })] },
      ],
    }
    documentsQuery.hasNextPage = false
    documentsQuery.isFetchNextPageError = false
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(screen.getByRole('table').parentElement).toHaveFocus())
  })

  it('re-indexes selected documents and keeps unsupported actions unavailable', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'one', title: 'One.pdf' }), document({ id: 'two' })] }],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'One.pdf' }))

    const actions = screen.getByRole('group', {
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
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'dataset.newKnowledge.documents' })).toHaveFocus(),
    )
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
      screen.queryByRole('group', { name: 'dataset.newKnowledge.bulkDocumentActions' }),
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

  it('gives duplicate task actions distinct accessible names', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({ id: 'document-a', title: 'Alpha.pdf' }),
            document({ id: 'document-b', title: 'Beta.pdf' }),
          ],
        },
      ],
    }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({ documentId: 'document-a', id: 'task-a' }),
            task({ documentId: 'document-b', id: 'task-b' }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":2}',
      }),
    )

    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.interruptTask · Alpha.pdf · task-a',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.interruptTask · Beta.pdf · task-b',
      }),
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
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
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

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
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

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'failed',
              state: 'running',
            }),
          ],
        },
      ],
    }
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(screen.queryByText('dataset.newKnowledge.taskActionFailed')).not.toBeInTheDocument()
  })

  it('does not restore an action failure after its drawer cycle closes', async () => {
    const user = userEvent.setup()
    let rejectCancel: ((reason?: unknown) => void) | undefined
    cancelMutation.mutateAsync.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectCancel = reject
        }),
    )
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task()] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await act(async () => rejectCancel?.(new Error('cancel failed after close')))

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(screen.queryByText('dataset.newKnowledge.taskActionFailed')).not.toBeInTheDocument()
  })

  it('does not move focus when an action from an older drawer cycle succeeds', async () => {
    const user = userEvent.setup()
    let resolveCancel: ((value: DocumentProcessingTask) => void) | undefined
    cancelMutation.mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve
        }),
    )
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'old-action' })] }] }

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    tasksQuery.data = {
      pages: [{ items: [task({ id: 'old-action' }), task({ id: 'new-action' })] }],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":2}',
      }),
    )
    const nextAction = screen.getByRole('button', {
      name: 'dataset.newKnowledge.interruptTask · sso-enterprise.pdf · new-action',
    })
    act(() => nextAction.focus())
    expect(nextAction).toHaveFocus()

    await act(async () => resolveCancel?.(task({ id: 'old-action', state: 'canceled' })))
    expect(nextAction).toHaveFocus()
  })

  it('does not move focus when the user leaves a pending task action', async () => {
    const user = userEvent.setup()
    let resolveCancel: ((value: DocumentProcessingTask) => void) | undefined
    cancelMutation.mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve
        }),
    )
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'pending-action' }), task({ id: 'focus-target' })] }],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":2}',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.interruptTask · sso-enterprise.pdf · pending-action',
      }),
    )
    const nextAction = screen.getByRole('button', {
      name: 'dataset.newKnowledge.interruptTask · sso-enterprise.pdf · focus-target',
    })
    act(() => nextAction.focus())

    await act(async () => resolveCancel?.(task({ id: 'pending-action', state: 'canceled' })))
    expect(nextAction).toHaveFocus()
  })

  it('ignores a delayed action success after the task lifecycle advances', async () => {
    const user = userEvent.setup()
    let resolveRetry: ((value: DocumentProcessingTask) => void) | undefined
    retryMutation.mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve
        }),
    )
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'advanced-success', state: 'failed' })] }] }

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))

    tasksQuery.data = {
      pages: [{ items: [task({ id: 'advanced-success', state: 'running' })] }],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await act(async () => resolveRetry?.(task({ id: 'advanced-success', state: 'queued' })))

    expect(
      screen.getByText(/dataset\.newKnowledge\.processingTaskState\.running/),
    ).toBeInTheDocument()
  })

  it('ignores a delayed task action after document permission is revoked', async () => {
    const user = userEvent.setup()
    let resolveCancel: ((value: DocumentProcessingTask) => void) | undefined
    cancelMutation.mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve
        }),
    )
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'revoked-action' })] }] }
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }))

    queryClient.invalidateQueries.mockClear()
    documentsQuery.error = { status: 403 }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await act(async () => resolveCancel?.(task({ id: 'revoked-action', state: 'canceled' })))
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()

    documentsQuery.error = null
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    ).toBeInTheDocument()
  })

  it('keeps a successful task action across a transient permission query failure', async () => {
    const user = userEvent.setup()
    let resolveCancel: ((value: DocumentProcessingTask) => void) | undefined
    cancelMutation.mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve
        }),
    )
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'permission-query-action' })] }] }
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }))

    permissionStateMock.error = new Error('permission query unavailable')
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    queryClient.invalidateQueries.mockClear()
    await act(async () =>
      resolveCancel?.(task({ id: 'permission-query-action', state: 'canceled' })),
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalled()
    expect(
      screen.getByText(/dataset\.newKnowledge\.processingTaskState\.canceled/),
    ).toBeInTheDocument()
  })

  it('drops a delayed action failure after the task lifecycle advances', async () => {
    const user = userEvent.setup()
    let rejectRetry: ((reason?: unknown) => void) | undefined
    retryMutation.mutateAsync.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRetry = reject
        }),
    )
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'advanced', state: 'failed' })] }] }

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))

    tasksQuery.data = { pages: [{ items: [task({ id: 'advanced', state: 'running' })] }] }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await act(async () => rejectRetry?.(new Error('late retry failure')))
    tasksQuery.data = { pages: [{ items: [task({ id: 'advanced', state: 'failed' })] }] }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByText('dataset.newKnowledge.taskActionFailed')).not.toBeInTheDocument()
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

  it('ignores a delayed retry response older than the current failed list snapshot', async () => {
    const user = userEvent.setup()
    let resolveRetry: ((snapshot: DocumentProcessingTask) => void) | undefined
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              errorCode: 'OLD_FAILURE',
              id: 'delayed-local-retry',
              state: 'failed',
              updatedAt: '2026-07-20T10:01:00Z',
            }),
          ],
        },
      ],
    }
    retryMutation.mutateAsync.mockReturnValue(
      new Promise<DocumentProcessingTask>((resolve) => {
        resolveRetry = resolve
      }),
    )

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              errorCode: 'NEWER_FAILURE',
              id: 'delayed-local-retry',
              state: 'failed',
              updatedAt: '2026-07-20T10:03:00Z',
            }),
          ],
        },
      ],
    }
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await act(async () =>
      resolveRetry?.(
        task({
          id: 'delayed-local-retry',
          state: 'dispatch_pending',
          updatedAt: '2026-07-20T10:02:00Z',
        }),
      ),
    )

    expect(await screen.findByText('NEWER_FAILURE')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).not.toBeInTheDocument()
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

  it('restarts an aborted equal-timestamp reconciliation after permission returns', async () => {
    const signals: AbortSignal[] = []
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'permission-reconciliation' })] }] }
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
    streamFailedTaskThenWait('permission-reconciliation')

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledOnce())
    tasksQuery.data = {
      pages: [
        {
          items: [task({ id: 'permission-reconciliation', updatedAt: '2026-07-20T10:03:00Z' })],
        },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledTimes(2))

    documentsQuery.error = { status: 403 }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() => expect(signals[1]?.aborted).toBe(true))
    documentsQuery.error = null
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledTimes(3))
    expect(signals[2]?.aborted).toBe(false)
  })

  it('restores complete terminal error details from an equal list snapshot', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'listed-terminal-error' })] }] }
    getTaskSnapshot.mockRejectedValue(new Response(null, { status: 403 }))
    streamFailedTaskThenWait('listed-terminal-error')

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(await screen.findByText('PARSER_FAILED')).toBeInTheDocument()

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              errorCode: 'PARSER_FAILED',
              errorMessage: 'Parser failed at line 400 with complete server context',
              id: 'listed-terminal-error',
              state: 'failed',
              updatedAt: '2026-07-20T10:03:00Z',
            }),
          ],
        },
      ],
    }
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    const error = await screen.findByText('Parser failed at line 400 with complete server context')
    expect(error).toHaveClass('whitespace-pre-wrap', 'break-words')
    expect(error).not.toHaveClass('truncate')
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

  it('retries a terminal reconciliation after its request deadline', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'timed-reconciliation' })] }] }
    getTaskSnapshot
      .mockImplementationOnce(
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
      .mockResolvedValueOnce(
        task({
          errorCode: 'TERMINAL_CONFIRMED',
          id: 'timed-reconciliation',
          state: 'failed',
          updatedAt: '2026-07-20T10:03:00Z',
        }),
      )
    streamFailedTaskThenWait('timed-reconciliation')

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => {})
      expect(getTaskSnapshot).toHaveBeenCalledOnce()

      await act(async () => vi.advanceTimersByTime(3000))
      expect(signals[0]?.aborted).toBe(true)
      await act(async () => vi.advanceTimersByTime(1000))

      expect(getTaskSnapshot).toHaveBeenCalledTimes(2)
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('replaces an older reconciliation backoff with the latest generation retry', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'latest-reconciliation' })] }] }
    getTaskSnapshot
      .mockRejectedValueOnce(new Error('first snapshot unavailable'))
      .mockRejectedValueOnce(new Error('second snapshot unavailable'))
      .mockResolvedValueOnce(
        task({
          id: 'latest-reconciliation',
          state: 'dispatch_pending',
          updatedAt: '2026-07-20T10:03:00Z',
        }),
      )
    streamFailedTaskThenWait('latest-reconciliation')

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => {})
      expect(getTaskSnapshot).toHaveBeenCalledOnce()

      tasksQuery.data = {
        pages: [
          {
            items: [task({ id: 'latest-reconciliation', updatedAt: '2026-07-20T10:03:00Z' })],
          },
        ],
      }
      tasksQuery.dataUpdateCount += 1
      rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
      await act(async () => {})
      expect(getTaskSnapshot).toHaveBeenCalledTimes(2)

      await act(async () => vi.advanceTimersByTime(1000))
      expect(getTaskSnapshot).toHaveBeenCalledTimes(3)
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
    let reconciliationSignal: AbortSignal | undefined
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'local-retry-race' })] }] }
    getTaskSnapshot.mockImplementation(
      (_input: unknown, options: { signal: AbortSignal }) =>
        new Promise<DocumentProcessingTask>((resolve) => {
          reconciliationSignal = options.signal
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
    expect(reconciliationSignal?.aborted).toBe(true)
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

  it('lets an equal-timestamp terminal list row replace an active stream override', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'equal-terminal', state: 'queued' })] }] }
    streamProcessingTaskEvents.mockImplementation(async function* () {
      yield {
        data: {
          progressPercent: 60,
          stage: 'parsed' as const,
          state: 'running' as const,
          updatedAt: '2026-07-20T10:01:00Z',
        },
        event: 'progress' as const,
        id: 'equal-terminal:running',
      }
      await new Promise<void>(() => {})
    })

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() => expect(streamProcessingTaskEvents).toHaveBeenCalledOnce())
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'equal-terminal', state: 'failed' })] }],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )

    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' })).toBeEnabled()
  })

  it('moves focus to the drawer close button when an external update removes a task action', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'external-terminal' })] }] }
    streamProcessingTaskEvents.mockImplementation(async function* () {
      await new Promise<void>(() => {})
    })
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    const action = screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' })
    act(() => action.focus())

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'external-terminal',
              state: 'succeeded',
              updatedAt: '2026-07-20T10:02:00Z',
            }),
          ],
        },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toHaveFocus(),
    )
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

  it('keeps an active task actionable when one hundred failed tasks fill the drawer', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            ...Array.from({ length: 100 }, (_, index) =>
              task({
                id: `failed-${index}`,
                state: 'failed',
                updatedAt: new Date(Date.UTC(2026, 6, 20, 10, index)).toISOString(),
              }),
            ),
            task({
              id: 'active-outside-failed-limit',
              state: 'running',
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
      screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'dataset.newKnowledge.loadMore',
      }),
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(101)
  })

  it('moves focus to the drawer close button when the final task batch is revealed', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: Array.from({ length: 101 }, (_, index) =>
            task({
              id: `history-${index}`,
              state: 'succeeded',
              updatedAt: new Date(Date.UTC(2026, 6, 20, 10, index)).toISOString(),
            }),
          ),
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.tasks' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'dataset.newKnowledge.loadMore',
      }),
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toHaveFocus(),
    )
  })

  it('preserves focus when the user leaves a pending final-page control', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    const firstPage = [
      task({ id: 'active-focus-target' }),
      ...Array.from({ length: 99 }, (_, index) =>
        task({
          id: `history-${index}`,
          state: 'succeeded',
          updatedAt: new Date(Date.UTC(2026, 6, 20, 10, index)).toISOString(),
        }),
      ),
    ]
    tasksQuery.data = { pages: [{ items: firstPage, nextCursor: 'final-page' }] }
    tasksQuery.hasNextPage = true

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1} · dataset.newKnowledge.taskHistoryIncomplete',
      }),
    )
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'dataset.newKnowledge.loadMore',
      }),
    )
    const action = screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' })
    act(() => action.focus())

    tasksQuery.data = {
      pages: [{ items: firstPage }, { items: [task({ id: 'last-task', state: 'succeeded' })] }],
    }
    tasksQuery.hasNextPage = false
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(action).toHaveFocus()
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

  it('resumes a task event stream from its cursor after rotation', async () => {
    vi.useFakeTimers()
    const resumeCalls: Array<{ lastEventId?: string; taskId: string }> = []
    streamProcessingTaskEvents.mockImplementation(async function* ({
      lastEventId,
      taskId,
    }: {
      lastEventId?: string
      taskId: string
    }) {
      resumeCalls.push({ lastEventId, taskId })
      if (taskId === 'active-0' && !lastEventId) {
        yield {
          data: {
            progressPercent: 50,
            stage: 'parsed' as const,
            state: 'running' as const,
            updatedAt: '2026-07-20T10:30:00Z',
          },
          event: 'progress' as const,
          id: 'active-0:cursor',
        }
      }
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
      for (let index = 0; index < 3; index += 1) {
        await act(async () => vi.advanceTimersByTime(5000))
        await act(async () => {})
      }

      expect(resumeCalls.filter(({ taskId }) => taskId === 'active-0')).toEqual([
        { lastEventId: undefined, taskId: 'active-0' },
        { lastEventId: 'active-0:cursor', taskId: 'active-0' },
      ])
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('drops an event cursor after the task list reports a terminal state', async () => {
    const streamCalls: Array<{ lastEventId?: string; taskId: string }> = []
    streamProcessingTaskEvents.mockImplementation(async function* ({
      lastEventId,
      taskId,
    }: {
      lastEventId?: string
      taskId: string
    }) {
      streamCalls.push({ lastEventId, taskId })
      if (streamCalls.length === 1) {
        yield {
          data: {
            progressPercent: 60,
            stage: 'parsed' as const,
            state: 'running' as const,
            updatedAt: '2026-07-20T10:02:00Z',
          },
          event: 'progress' as const,
          id: 'restarted:old-cursor',
        }
      }
      await new Promise<void>(() => {})
    })
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'restarted' })] }] }
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() => expect(streamCalls).toHaveLength(1))

    tasksQuery.data = {
      pages: [
        {
          items: [task({ id: 'restarted', state: 'failed', updatedAt: '2026-07-20T10:03:00Z' })],
        },
      ],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'restarted', updatedAt: '2026-07-20T10:04:00Z' })] }],
    }
    rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(streamCalls).toHaveLength(2))
    expect(streamCalls).toEqual([
      { lastEventId: undefined, taskId: 'restarted' },
      { lastEventId: undefined, taskId: 'restarted' },
    ])
  })

  it('keeps a retry cursor while the base task list still has the old terminal row', async () => {
    vi.useFakeTimers()
    const retryStreamCalls: Array<string | undefined> = []
    streamProcessingTaskEvents.mockImplementation(async function* ({
      lastEventId,
      taskId,
    }: {
      lastEventId?: string
      taskId: string
    }) {
      if (taskId === 'active-5') {
        retryStreamCalls.push(lastEventId)
        if (!lastEventId) {
          yield {
            data: {
              progressPercent: 55,
              stage: 'parsed' as const,
              state: 'running' as const,
              updatedAt: '2026-07-20T10:02:00Z',
            },
            event: 'progress' as const,
            id: 'active-5:retry-cursor',
          }
        }
      }
      await new Promise<void>(() => {})
    })
    retryMutation.mutateAsync.mockResolvedValue(
      task({ id: 'active-5', state: 'queued', updatedAt: '2026-07-20T10:01:00Z' }),
    )
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            ...Array.from({ length: 5 }, (_, index) => task({ id: `active-${index}` })),
            task({ id: 'active-5', state: 'failed' }),
            task({ id: 'active-6' }),
          ],
        },
      ],
    }

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'dataset.newKnowledge.tasksWithAttention:{"count":7}',
        }),
      )
      fireEvent.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))
      await act(async () => {})
      expect(retryStreamCalls).toEqual([undefined])

      await act(async () => vi.advanceTimersByTime(5000))
      await act(async () => vi.advanceTimersByTime(5000))
      await act(async () => {})

      expect(retryStreamCalls).toEqual([undefined, 'active-5:retry-cursor'])
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('keeps the latest event cursor when the observer effect restarts', async () => {
    const streamCursors: Array<string | undefined> = []
    streamProcessingTaskEvents.mockImplementation(async function* ({
      lastEventId,
    }: {
      lastEventId?: string
    }) {
      streamCursors.push(lastEventId)
      if (streamCursors.length === 1) {
        yield {
          data: {
            progressPercent: 50,
            stage: 'parsed' as const,
            state: 'running' as const,
            updatedAt: '2026-07-20T10:02:00Z',
          },
          event: 'progress' as const,
          id: 'task-1:cursor',
        }
      }
      await new Promise<void>(() => {})
    })
    const onLastEventIdChange = vi.fn()
    const firstOnEvent = vi.fn(() => true)
    const rendered = render(
      <TaskEventObserver
        documentId="document-1"
        knowledgeSpaceId="space-1"
        onEvent={firstOnEvent}
        onLastEventIdChange={onLastEventIdChange}
        taskId="task-1"
        taskVersion="2026-07-20T10:01:00Z"
      />,
    )

    await act(async () => {})
    expect(onLastEventIdChange).toHaveBeenCalledWith('task-1', 'task-1:cursor')

    rendered.rerender(
      <TaskEventObserver
        documentId="document-1"
        knowledgeSpaceId="space-1"
        lastEventId="task-1:cursor"
        onEvent={vi.fn(() => true)}
        onLastEventIdChange={onLastEventIdChange}
        taskId="task-1"
        taskVersion="2026-07-20T10:01:00Z"
      />,
    )
    await act(async () => {})

    expect(streamCursors).toEqual([undefined, 'task-1:cursor'])
  })

  it('rejects stale active progress and backs off repeated stale reconnects', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'stale-active-progress',
              state: 'queued',
              updatedAt: '2026-07-20T10:05:00Z',
            }),
          ],
        },
      ],
    }
    let streamCount = 0
    streamProcessingTaskEvents.mockImplementation(async function* () {
      streamCount += 1
      yield {
        data: {
          progressPercent: streamCount < 3 ? 40 : 60,
          stage: 'parsed' as const,
          state: 'running' as const,
          updatedAt: streamCount < 3 ? '2026-07-20T10:04:00Z' : '2026-07-20T10:06:00Z',
        },
        event: 'progress' as const,
        id: `stale-active-progress:${streamCount}`,
      }
      await new Promise<void>(() => {})
    })

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => {})
      expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()
      expect(
        within(screen.getByRole('row', { name: /sso-enterprise\.pdf/ })).getByText(
          'dataset.newKnowledge.documentStatus.queued',
        ),
      ).toBeInTheDocument()

      await act(async () => vi.advanceTimersByTime(1000))
      expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(2)
      await act(async () => vi.advanceTimersByTime(1000))
      expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(2)
      await act(async () => vi.advanceTimersByTime(1000))
      expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(3)
      expect(
        within(screen.getByRole('row', { name: /sso-enterprise\.pdf/ })).getByText(
          'dataset.newKnowledge.documentStatus.processing',
        ),
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

  it('preserves the latest progress version when a rotated stream returns terminal-only', async () => {
    vi.useFakeTimers()
    const streamCounts = new Map<string, number>()
    streamProcessingTaskEvents.mockImplementation(async function* ({ taskId }: { taskId: string }) {
      const streamCount = (streamCounts.get(taskId) ?? 0) + 1
      streamCounts.set(taskId, streamCount)
      if (taskId === 'rotated-terminal' && streamCount === 1) {
        yield {
          data: {
            progressPercent: 70,
            stage: 'nodes_generated' as const,
            state: 'running' as const,
            updatedAt: '2026-07-20T10:05:00Z',
          },
          event: 'progress' as const,
          id: 'rotated-terminal:progress',
        }
      } else if (taskId === 'rotated-terminal') {
        yield {
          data: { errorCode: 'ROTATED_FAILURE', state: 'failed' as const },
          event: 'terminal' as const,
          id: 'rotated-terminal:terminal',
        }
        return
      }
      await new Promise<void>(() => {})
    })
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({ id: 'rotated-terminal', updatedAt: '2026-07-20T10:01:00Z' }),
            ...Array.from({ length: 12 }, (_, index) =>
              task({ id: `rotation-peer-${index}`, updatedAt: '2026-07-20T10:01:00Z' }),
            ),
          ],
        },
      ],
    }
    getTaskSnapshot.mockResolvedValue(
      task({
        errorCode: 'ROTATED_FAILURE',
        id: 'rotated-terminal',
        state: 'failed',
        updatedAt: '2026-07-20T10:05:00Z',
      }),
    )

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => {})
      await act(async () => vi.advanceTimersByTime(5000))
      await act(async () => vi.advanceTimersByTime(5000))
      await act(async () => {})

      expect(streamCounts.get('rotated-terminal')).toBe(2)
      expect(toastMock.error).toHaveBeenCalledWith('dataset.newKnowledge.taskFailedNotification')
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
      await act(async () => vi.advanceTimersByTime(5000))
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

  it('advances failed-task polling when a snapshot request never settles', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: Array.from({ length: 7 }, (_, index) =>
            task({ id: `failed-${index}`, state: 'failed' }),
          ),
        },
      ],
    }
    getTaskSnapshot.mockImplementation((input: { params: { taskId: string } }) => {
      if (input.params.taskId !== 'failed-0') return new Promise<DocumentProcessingTask>(() => {})
      return Promise.resolve(
        task({
          id: 'failed-0',
          state: 'dispatch_pending',
          updatedAt: '2026-07-20T10:02:00Z',
        }),
      )
    })

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledTimes(6)
      await act(async () => vi.advanceTimersByTime(3000))
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledTimes(12)
      expect(getTaskSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ taskId: 'failed-0' }) }),
        expect.anything(),
      )
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('forgets permanent poll failures after a task leaves the cursor result', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'removed-failed-task', state: 'failed' })] }],
    }
    getTaskSnapshot.mockRejectedValue(new Response(null, { status: 403 }))

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()

      tasksQuery.data = { pages: [{ items: [] }] }
      rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
      await act(async () => {})
      tasksQuery.data = {
        pages: [{ items: [task({ id: 'removed-failed-task', state: 'failed' })] }],
      }
      rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
      await act(async () => vi.advanceTimersByTime(5000))

      expect(getTaskSnapshot).toHaveBeenCalledTimes(2)
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('ignores an older active snapshot while polling a newer failed task', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              errorCode: 'LATEST_FAILURE',
              id: 'stale-active-poll',
              state: 'failed',
              updatedAt: '2026-07-20T10:03:00.123789Z',
            }),
          ],
        },
      ],
    }
    getTaskSnapshot.mockResolvedValue(
      task({
        id: 'stale-active-poll',
        state: 'dispatch_pending',
        updatedAt: '2026-07-20T10:03:00.123456Z',
      }),
    )

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()
      expect(streamProcessingTaskEvents).not.toHaveBeenCalled()
      fireEvent.click(
        screen.getByRole('button', {
          name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
        }),
      )
      expect(screen.getByText('LATEST_FAILURE')).toBeInTheDocument()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('accepts a terminal-only stream after an exact snapshot observes an external retry', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              errorCode: 'OLD_FAILURE',
              id: 'terminal-only-external-retry',
              state: 'failed',
              updatedAt: '2026-07-20T10:01:00Z',
            }),
          ],
        },
      ],
    }
    getTaskSnapshot
      .mockResolvedValueOnce(
        task({
          id: 'terminal-only-external-retry',
          state: 'dispatch_pending',
          updatedAt: '2026-07-20T10:03:00Z',
        }),
      )
      .mockResolvedValueOnce(
        task({
          errorCode: 'NEW_FAILURE',
          id: 'terminal-only-external-retry',
          state: 'failed',
          updatedAt: '2026-07-20T10:03:00Z',
        }),
      )
    streamProcessingTaskEvents.mockImplementation(async function* () {
      yield {
        data: { errorCode: 'NEW_FAILURE', state: 'failed' as const },
        event: 'terminal' as const,
        id: 'terminal-only-external-retry:terminal',
      }
    })

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => vi.advanceTimersByTime(5000))
      await act(async () => {})
      expect(getTaskSnapshot).toHaveBeenCalledTimes(2)
      fireEvent.click(
        screen.getByRole('button', {
          name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
        }),
      )
      expect(screen.getByText('NEW_FAILURE')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
      ).not.toBeInTheDocument()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('unblocks failed-task polling after an active list snapshot without a terminal pin', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'list-retry-after-block', state: 'failed' })] }],
    }
    getTaskSnapshot
      .mockRejectedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(
        task({
          id: 'list-retry-after-block',
          state: 'dispatch_pending',
          updatedAt: '2026-07-20T10:05:00Z',
        }),
      )

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()

      tasksQuery.data = {
        pages: [
          {
            items: [
              task({
                id: 'list-retry-after-block',
                state: 'dispatch_pending',
                updatedAt: '2026-07-20T10:03:00Z',
              }),
            ],
          },
        ],
      }
      rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
      await act(async () => {})
      tasksQuery.data = {
        pages: [
          {
            items: [
              task({
                id: 'list-retry-after-block',
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

  it('retries exact polling when a permanently blocked failed task advances version', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'new-failed-generation',
              state: 'failed',
              updatedAt: '2026-07-20T10:01:00Z',
            }),
          ],
        },
      ],
    }
    getTaskSnapshot
      .mockRejectedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(
        task({
          id: 'new-failed-generation',
          state: 'dispatch_pending',
          updatedAt: '2026-07-20T10:03:00Z',
        }),
      )

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()

      tasksQuery.data = {
        pages: [
          {
            items: [
              task({
                id: 'new-failed-generation',
                state: 'failed',
                updatedAt: '2026-07-20T10:02:00Z',
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

  it('aborts an in-flight failed-task poll on unmount', async () => {
    vi.useFakeTimers()
    let pollSignal: AbortSignal | undefined
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'aborted-failed-poll', state: 'failed' })] }],
    }
    getTaskSnapshot.mockImplementation(
      (_input: unknown, options: { signal: AbortSignal }) =>
        new Promise<DocumentProcessingTask>((_resolve, reject) => {
          pollSignal = options.signal
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => vi.advanceTimersByTime(5000))
      expect(pollSignal?.aborted).toBe(false)
      rendered.unmount()
      expect(pollSignal?.aborted).toBe(true)
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
    expect(screen.getByRole('table').parentElement).toHaveFocus()
  })

  it('eagerly exhausts task and source cursor pages for accurate labels', () => {
    documentsQuery.data = {
      pages: [{ items: [document({ sourceId: 'source-on-later-page' })] }],
    }
    tasksQuery.data = { pages: [{ items: [], nextCursor: 'next' }] }
    tasksQuery.hasNextPage = true
    sourcesQuery.data = { pages: [{ items: [], nextCursor: 'source-next' }] }
    sourcesQuery.hasNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(tasksQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('keeps filtered results partial while task-dependent statuses have more pages', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: Array.from({ length: 20 }, () => ({ items: [], nextCursor: 'next' })),
    }
    tasksQuery.hasNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.selectOptions(screen.getByRole('combobox'), 'failed')

    expect(screen.queryByText('dataset.newKnowledge.noMatchingDocuments')).not.toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.partialDocumentResults')).toBeInTheDocument()
  })

  it('keeps source-name searches partial while unresolved sources have more pages', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: [document({ sourceId: 'later-source', userMetadata: {} })],
        },
      ],
    }
    sourcesQuery.data = {
      pages: Array.from({ length: 20 }, () => ({ items: [], nextCursor: 'next' })),
    }
    sourcesQuery.hasNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.type(
      screen.getByRole('searchbox', { name: 'dataset.newKnowledge.searchDocuments' }),
      'source title from next page',
    )

    expect(screen.queryByText('dataset.newKnowledge.noMatchingDocuments')).not.toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.partialDocumentResults')).toBeInTheDocument()
  })

  it('bounds automatic cursor exhaustion and leaves all further loading explicit', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: Array.from({ length: 20 }, (_, index) => ({
        items: index === 0 ? [document({ sourceId: 'source-on-later-page' })] : [],
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
    expect(screen.getByText('dataset.newKnowledge.partialDocumentResults')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).toHaveAttribute(
      'aria-describedby',
      'partial-document-results',
    )
    const loadMore = screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' })
    expect(loadMore).toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'missing')
    expect(screen.queryByText('dataset.newKnowledge.noMatchingDocuments')).not.toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.partialDocumentResults')).toBeInTheDocument()
    await user.click(loadMore)
    expect(documentsQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(tasksQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('keeps explicit result pagination busy while a dependency page is loading', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: Array.from({ length: 20 }, () => ({ items: [], nextCursor: 'next' })),
    }
    tasksQuery.hasNextPage = true
    tasksQuery.isFetchingNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('keeps known documents actionable while older task and source pages remain', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
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

    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).not.toHaveAttribute(
      'aria-disabled',
    )
    expect(
      within(screen.getByRole('row', { name: /sso-enterprise\.pdf/ })).getByText(
        'dataset.newKnowledge.documentStatus.ready',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }),
    ).toBeInTheDocument()
  })

  it('locks cached documents when the task query returns a permission denial', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task()] }] }
    tasksQuery.error = { status: 403 }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentsPermissionTitle',
    )
    expect(screen.queryByText('sso-enterprise.pdf')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('dataset.newKnowledge.uploadDocuments')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}' }),
    ).not.toBeInTheDocument()
  })

  it('retires a failed task action before background invalidation settles', async () => {
    const user = userEvent.setup()
    retryMutation.mutateAsync.mockRejectedValueOnce(new Error('retry failed'))
    queryClient.invalidateQueries.mockImplementation(() => new Promise<void>(() => {}))
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'failed', state: 'failed' })] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))

    expect(await screen.findByText('dataset.newKnowledge.taskActionFailed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' })).toHaveAttribute(
      'aria-busy',
      'false',
    )
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('trusts same-version stream progress after a local retry', async () => {
    const user = userEvent.setup()
    const retryVersion = '2026-07-20T10:01:00Z'
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [task({ id: 'same-version-retry', state: 'failed', updatedAt: retryVersion })],
        },
      ],
    }
    retryMutation.mutateAsync.mockResolvedValue(
      task({ id: 'same-version-retry', state: 'queued', updatedAt: retryVersion }),
    )
    streamProcessingTaskEvents.mockImplementation(async function* () {
      yield {
        data: {
          progressPercent: 20,
          stage: 'parsed' as const,
          state: 'running' as const,
          updatedAt: retryVersion,
        },
        event: 'progress' as const,
        id: 'same-version-retry:running',
      }
      await new Promise<void>(() => {})
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))

    await waitFor(() => expect(streamProcessingTaskEvents).toHaveBeenCalled())
    expect(
      await screen.findByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'dataset.newKnowledge.retryTask' })).toBeNull()
  })

  it('retries a permission-blocked failed-task poll after permission returns', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [task({ id: 'permission-blocked-poll', state: 'failed' })],
        },
      ],
    }
    getTaskSnapshot
      .mockRejectedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(
        task({
          id: 'permission-blocked-poll',
          state: 'dispatch_pending',
          updatedAt: '2026-07-20T10:02:00Z',
        }),
      )

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()

      documentsQuery.error = { status: 403 }
      rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
      documentsQuery.error = null
      rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
      await act(async () => vi.advanceTimersByTime(5000))

      expect(getTaskSnapshot).toHaveBeenCalledTimes(2)
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('restores document focus when a focused bulk toolbar is cleared', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.clearDocumentSelection' }),
    )

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'dataset.newKnowledge.documents' })).toHaveFocus(),
    )
    rendered.unmount()
  })

  it('announces upload and re-index operations as busy', async () => {
    const user = userEvent.setup()
    uploadMutation.mutateAsync.mockImplementation(() => new Promise(() => {}))
    const emptyPage = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadDocuments'),
      new File(['one'], 'one.md', { type: 'text/markdown' }),
    )
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }),
    ).toHaveAttribute('aria-busy', 'true')
    emptyPage.unmount()

    reindexMutation.mutateAsync.mockImplementation(() => new Promise(() => {}))
    documentsQuery.data = { pages: [{ items: [document()] }] }
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocuments' }))
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocuments' }),
    ).toHaveAttribute('aria-busy', 'true')
  })

  it('locks uploads after a write mutation reveals revoked permission', async () => {
    const user = userEvent.setup()
    uploadMutation.mutateAsync.mockRejectedValueOnce(new Response(null, { status: 403 }))
    permissionStateMock.refreshAfterDenial.mockResolvedValueOnce({
      data: { dataset: { default_permission_keys: ['dataset.acl.readonly'] } },
      error: null,
    })
    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadDocuments'),
      new File(['one'], 'one.md', { type: 'text/markdown' }),
    )

    await waitFor(() => expect(permissionStateMock.refreshAfterDenial).toHaveBeenCalledOnce())
    expect(screen.getByText('dataset.newKnowledge.permissionRestricted')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeDisabled()

    permissionStateMock.datasetKeys = ['dataset.acl.readonly']
    permissionStateMock.fetching = true
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    permissionStateMock.fetching = false
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeDisabled()

    permissionStateMock.error = new Error('permission service unavailable')
    permissionStateMock.datasetKeys = ['dataset.acl.edit']
    permissionStateMock.retry.mockResolvedValueOnce({
      data: { dataset: { default_permission_keys: ['dataset.acl.edit'] } },
      error: null,
    })
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'common.operation.retry · dataset.newKnowledge.permissionLoadFailed',
      }),
    )
    permissionStateMock.error = null
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }),
      ).toBeEnabled(),
    )
  })

  it('locks re-indexing after a write mutation reveals revoked permission', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    reindexMutation.mutateAsync.mockRejectedValueOnce(new Response(null, { status: 403 }))
    permissionStateMock.refreshAfterDenial.mockResolvedValueOnce({
      data: { dataset: { default_permission_keys: ['dataset.acl.readonly'] } },
      error: null,
    })
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocuments' }))

    await waitFor(() => expect(permissionStateMock.refreshAfterDenial).toHaveBeenCalledOnce())
    expect(
      screen.queryByRole('group', { name: 'dataset.newKnowledge.bulkDocumentActions' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('heading', { name: 'dataset.newKnowledge.documents' })).toHaveFocus()
  })

  it('locks task actions after a write mutation reveals revoked permission', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task()] }] }
    cancelMutation.mutateAsync.mockRejectedValueOnce(new Response(null, { status: 403 }))
    permissionStateMock.refreshAfterDenial.mockResolvedValueOnce({
      data: { dataset: { default_permission_keys: ['dataset.acl.readonly'] } },
      error: null,
    })
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }))

    await waitFor(() => expect(permissionStateMock.refreshAfterDenial).toHaveBeenCalledOnce())
    expect(
      within(screen.getByRole('dialog')).getByText('dataset.newKnowledge.permissionRestricted'),
    ).toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.taskActionFailed')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
  })

  it('does not let an older permission refresh release the latest write lock', async () => {
    const user = userEvent.setup()
    let rejectUpload: ((reason: unknown) => void) | undefined
    let rejectCancel: ((reason: unknown) => void) | undefined
    let resolveFirstRefresh: ((value: unknown) => void) | undefined
    let resolveSecondRefresh: ((value: unknown) => void) | undefined
    uploadMutation.mutateAsync.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectUpload = reject
        }),
    )
    cancelMutation.mutateAsync.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectCancel = reject
        }),
    )
    permissionStateMock.refreshAfterDenial
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstRefresh = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondRefresh = resolve
          }),
      )
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task()] }] }
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }))
    fireEvent.change(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), {
      target: { files: [new File(['one'], 'one.md', { type: 'text/markdown' })] },
    })
    expect(cancelMutation.mutateAsync).toHaveBeenCalledOnce()
    expect(uploadMutation.mutateAsync).toHaveBeenCalledOnce()

    await act(async () => rejectUpload?.(new Response(null, { status: 403 })))
    await waitFor(() => expect(permissionStateMock.refreshAfterDenial).toHaveBeenCalledOnce())
    await act(async () => rejectCancel?.(new Response(null, { status: 403 })))
    await waitFor(() => expect(permissionStateMock.refreshAfterDenial).toHaveBeenCalledTimes(2))

    await act(async () =>
      resolveFirstRefresh?.({
        data: { dataset: { default_permission_keys: ['dataset.acl.edit'] } },
        error: null,
      }),
    )
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).not.toBeInTheDocument()

    await act(async () =>
      resolveSecondRefresh?.({
        data: { dataset: { default_permission_keys: ['dataset.acl.readonly'] } },
        error: null,
      }),
    )
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).not.toBeInTheDocument()
  })

  it('observes a structurally shared same-version retry when response timestamps collide', async () => {
    const user = userEvent.setup()
    const taskVersion = '2026-07-20T10:03:00Z'
    const sharedTaskData = {
      pages: [{ items: [task({ id: 'shared-active-retry', updatedAt: taskVersion })] }],
    }
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = sharedTaskData
    tasksQuery.dataUpdatedAt = 100
    tasksQuery.dataUpdateCount = 1
    getTaskSnapshot
      .mockRejectedValueOnce(new Error('snapshot unavailable'))
      .mockResolvedValueOnce(
        task({ id: 'shared-active-retry', state: 'running', updatedAt: taskVersion }),
      )
    streamFailedTaskThenWait('shared-active-retry')
    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(await screen.findByText('PARSER_FAILED')).toBeInTheDocument()
    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledOnce())

    tasksQuery.data = sharedTaskData
    tasksQuery.dataUpdatedAt = 100
    tasksQuery.dataUpdateCount = 2
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()
  })

  it('reconciles a same-version terminal list after trusted local retry progress', async () => {
    const user = userEvent.setup()
    const taskVersion = '2026-07-20T10:01:00Z'
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [task({ id: 'trusted-terminal', state: 'failed', updatedAt: taskVersion })],
        },
      ],
    }
    retryMutation.mutateAsync.mockResolvedValue(
      task({ id: 'trusted-terminal', state: 'queued', updatedAt: taskVersion }),
    )
    getTaskSnapshot.mockResolvedValue(
      task({
        errorCode: 'TERMINAL_CONFIRMED',
        id: 'trusted-terminal',
        state: 'failed',
        updatedAt: taskVersion,
      }),
    )
    streamProcessingTaskEvents.mockImplementation(async function* () {
      yield {
        data: {
          progressPercent: 30,
          stage: 'parsed' as const,
          state: 'running' as const,
          updatedAt: taskVersion,
        },
        event: 'progress' as const,
        id: 'trusted-terminal:running',
      }
      await new Promise<void>(() => {})
    })
    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))
    expect(
      await screen.findByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()

    tasksQuery.data = {
      pages: [
        {
          items: [task({ id: 'trusted-terminal', state: 'failed', updatedAt: taskVersion })],
        },
      ],
    }
    tasksQuery.dataUpdatedAt = 100
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalled())
    expect(await screen.findByText('TERMINAL_CONFIRMED')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }),
    ).toBeInTheDocument()
  })
})

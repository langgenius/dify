import type {
  DocumentProcessingTask,
  LogicalDocument,
  Source,
} from '@dify/contracts/knowledge-fs/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
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
    cancelMutation.mutateAsync.mockResolvedValue(task({ state: 'canceled' }))
    retryMutation.mutateAsync.mockResolvedValue(task({ state: 'queued' }))
    reindexMutation.mutateAsync.mockResolvedValue({ bulkJobId: 'reindex-1', items: [], total: 1 })
    uploadMutation.mutateAsync.mockResolvedValue({ id: 'asset-1' })
    bulkUploadMutation.mutateAsync.mockResolvedValue({ bulkJobId: 'upload-1' })
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

  it('renders revisions, sources, stable newest-first rows, and every designed status', () => {
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({ id: 'ready', title: 'Ready.pdf', userMetadata: {} }),
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
    expect(within(rows[0]!).getByText('Queued.docx')).toBeInTheDocument()
    expect(screen.getAllByText('Notion support SOP').length).toBeGreaterThan(0)
    expect(screen.getAllByText('v2').length).toBeGreaterThan(0)
    for (const status of ['ready', 'queued', 'processing', 'failed', 'disabled'])
      expect(
        screen.getAllByText(`dataset.newKnowledge.documentStatus.${status}`).length,
      ).toBeGreaterThan(0)
    expect(screen.getByText('dataset.newKnowledge.lastReadyRevisionHint')).toBeInTheDocument()
  })

  it('renders the designed empty state with an available upload action', () => {
    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.documentsEmptyTitle')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.documentsEmptyDescription')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeEnabled()
  })

  it('uploads one or multiple files through the pinned document contracts', async () => {
    const user = userEvent.setup()
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const input = screen.getByLabelText('dataset.newKnowledge.uploadDocuments')

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

  it('applies task events and clears the attention badge after completion', async () => {
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'running' })] }] }
    streamProcessingTaskEvents.mockImplementation(async function* () {
      yield {
        data: { state: 'succeeded' as const },
        event: 'terminal' as const,
        id: 'running:terminal',
      }
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

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

  it('eagerly exhausts task and source cursor pages for accurate labels', () => {
    tasksQuery.data = { pages: [{ items: [], nextCursor: 'next' }] }
    tasksQuery.hasNextPage = true
    sourcesQuery.data = { pages: [{ items: [], nextCursor: 'source-next' }] }
    sourcesQuery.hasNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(tasksQuery.fetchNextPage).toHaveBeenCalledOnce()
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })
})

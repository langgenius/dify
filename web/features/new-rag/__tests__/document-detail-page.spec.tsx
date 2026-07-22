import type {
  BulkDocumentReindexResult,
  DocumentProcessingTask,
  DocumentRevisionChunk,
  LogicalDocument,
  LogicalDocumentRevision,
} from '@dify/contracts/knowledge-fs/types.gen'
import { skipToken } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { DocumentDetailPage } from '../document-detail-page'

type InfiniteOptions = {
  enabled?: boolean
  getNextPageParam: (lastPage: { nextCursor?: string }) => string | undefined
  input: ((pageParam: string | null) => unknown) | typeof skipToken
  initialPageParam: string | null
  queryKind: 'chunks' | 'revisions' | 'tasks'
}

function infiniteInput(options?: Pick<InfiniteOptions, 'input'>) {
  if (!options || typeof options.input !== 'function') throw new Error('Expected query input')
  return options.input
}

const documentQuery = vi.hoisted(() => ({
  data: undefined as LogicalDocument | undefined,
  error: null as unknown,
  isPending: false,
  refetch: vi.fn(),
}))

const taskSnapshotQuery = vi.hoisted(() => ({
  data: undefined as DocumentProcessingTask | undefined,
  error: null as unknown,
  refetch: vi.fn(),
}))

const submissionTasksQuery = vi.hoisted(() => ({
  data: undefined as { items: DocumentProcessingTask[] } | undefined,
  error: null as unknown,
  refetch: vi.fn(),
}))

const revisionsQuery = vi.hoisted(() => ({
  data: undefined as
    | { pages: Array<{ items: LogicalDocumentRevision[]; nextCursor?: string }> }
    | undefined,
  error: null as unknown,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  isPending: false,
  refetch: vi.fn(),
}))

const chunksQuery = vi.hoisted(() => ({
  data: undefined as
    | { pages: Array<{ items: DocumentRevisionChunk[]; nextCursor?: string }> }
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

const permissionState = vi.hoisted(() => ({
  datasetAtom: Symbol('datasetDefaultPermissionKeysAtom'),
  keys: ['dataset.acl.edit'],
  refreshAtom: Symbol('refreshWorkspacePermissionKeysAfterMutationDenialAtom'),
  refresh: vi.fn(),
}))
const reindexMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const queryClient = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  removeQueries: vi.fn(),
  setQueryData: vi.fn(),
}))
const toastState = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
const virtualizerState = vi.hoisted(() => ({ scrollToIndex: vi.fn() }))
const documentOptions = vi.hoisted(() =>
  vi.fn((options: object) => ({
    ...options,
    queryKey: ['knowledge-fs', 'document', 'space-1', 'document-1'],
    queryKind: 'document',
  })),
)
const taskSnapshotOptions = vi.hoisted(() =>
  vi.fn((options: object) => ({ ...options, queryKind: 'task-snapshot' })),
)
const submissionTasksOptions = vi.hoisted(() =>
  vi.fn((options: object) => ({
    ...options,
    queryKey: ['knowledge-fs', 'submission-tasks', 'space-1'],
    queryKind: 'submission-tasks',
  })),
)
const revisionsOptions = vi.hoisted(() =>
  vi.fn((options: Omit<InfiniteOptions, 'queryKind'>) => ({
    ...options,
    queryKey: ['knowledge-fs', 'revisions', 'space-1', 'document-1'],
    queryKind: 'revisions',
  })),
)
const chunksOptions = vi.hoisted(() =>
  vi.fn((options: Omit<InfiniteOptions, 'queryKind'>) => ({
    ...options,
    queryKey: ['knowledge-fs', 'chunks', 'space-1', 'document-1'],
    queryKind: 'chunks',
  })),
)
const tasksOptions = vi.hoisted(() =>
  vi.fn((options: Omit<InfiniteOptions, 'queryKind'>) => ({
    ...options,
    queryKey: ['knowledge-fs', 'tasks', 'space-1'],
    queryKind: 'tasks',
  })),
)

vi.mock('jotai', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai')>()
  return {
    ...original,
    useAtomValue: (atom: unknown) =>
      atom === permissionState.datasetAtom ? permissionState.keys : undefined,
    useSetAtom: (atom: unknown) =>
      atom === permissionState.refreshAtom ? permissionState.refresh : vi.fn(),
  }
})

vi.mock('@/context/permission-state', () => ({
  datasetDefaultPermissionKeysAtom: permissionState.datasetAtom,
  refreshWorkspacePermissionKeysAfterMutationDenialAtom: permissionState.refreshAtom,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({ toast: toastState }))

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: ({ endIndex, startIndex }: { endIndex: number; startIndex: number }) =>
    Array.from({ length: endIndex - startIndex + 1 }, (_, index) => startIndex + index),
  useVirtualizer: ({
    count,
    getItemKey,
    rangeExtractor,
  }: {
    count: number
    getItemKey: (index: number) => string
    rangeExtractor: (range: { endIndex: number; startIndex: number }) => number[]
  }) => ({
    getTotalSize: () => count * 56,
    getVirtualItems: () =>
      rangeExtractor({ endIndex: Math.min(count, 12) - 1, startIndex: 0 }).map((index) => ({
        index,
        key: getItemKey(index),
        size: 56,
        start: index * 56,
      })),
    scrollToIndex: virtualizerState.scrollToIndex,
  }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: (options: InfiniteOptions) => {
      if (options.queryKind === 'revisions') return revisionsQuery
      if (options.queryKind === 'chunks') return chunksQuery
      return tasksQuery
    },
    useMutation: () => reindexMutation,
    useQuery: (options: { queryKind?: string }) => {
      if (options.queryKind === 'task-snapshot') return taskSnapshotQuery
      if (options.queryKind === 'submission-tasks') return submissionTasksQuery
      return documentQuery
    },
    useQueryClient: () => queryClient,
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      getKnowledgeSpacesByIdDocumentsByDocumentIdRevisions: {
        infiniteOptions: revisionsOptions,
        key: () => ['knowledge-fs', 'revisions'],
      },
      getKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunks: {
        infiniteOptions: chunksOptions,
        key: () => ['knowledge-fs', 'chunks'],
      },
      getKnowledgeSpacesByIdLogicalDocumentsByDocumentId: {
        queryOptions: documentOptions,
        key: () => ['knowledge-fs', 'document'],
      },
      getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId: {
        queryOptions: taskSnapshotOptions,
      },
      getKnowledgeSpacesByIdProcessingTasks: {
        infiniteOptions: tasksOptions,
        key: () => ['knowledge-fs', 'tasks'],
        queryOptions: submissionTasksOptions,
      },
      postKnowledgeSpacesByIdDocumentsBulkReindex: {
        mutationOptions: () => ({}),
      },
    },
  },
}))

const activeRevision = (overrides: Partial<Exclude<LogicalDocumentRevision, null>> = {}) => ({
  contentHash: 'hash-3',
  createdAt: '2026-07-21T10:00:00Z',
  documentAssetId: 'asset-1',
  documentAssetVersion: 1,
  documentId: 'document-1',
  knowledgeSpaceId: 'space-1',
  mimeType: 'text/markdown',
  revision: 3,
  sizeBytes: 1200,
  state: 'active' as const,
  ...overrides,
})

const logicalDocument = (overrides: Partial<LogicalDocument> = {}): LogicalDocument => ({
  active: activeRevision(),
  activeRevision: 3,
  createdAt: '2026-07-21T09:00:00Z',
  id: 'document-1',
  knowledgeSpaceId: 'space-1',
  rowVersion: 2,
  sourceId: 'source-1',
  status: 'ready',
  title: 'sso-enterprise.pdf',
  updatedAt: '2026-07-21T10:00:00Z',
  userMetadata: { sourceName: 'Notion support SOP' },
  ...overrides,
})

const chunk = (overrides: Partial<DocumentRevisionChunk>): DocumentRevisionChunk => ({
  createdAt: '2026-07-21T10:00:00Z',
  documentId: 'document-1',
  documentRevision: 3,
  enabled: true,
  id: 'parent',
  knowledgeSpaceId: 'space-1',
  ordinal: 1,
  text: 'Parent content',
  tokenCount: 10,
  userMetadata: {},
  ...overrides,
})

const task = (overrides: Partial<DocumentProcessingTask>): DocumentProcessingTask => ({
  createdAt: '2026-07-21T10:00:00Z',
  documentId: 'document-1',
  documentRevision: 4,
  id: 'task-1',
  knowledgeSpaceId: 'space-1',
  progressPercent: 45,
  stage: 'nodes_generated',
  state: 'running',
  updatedAt: '2026-07-21T10:01:00Z',
  ...overrides,
})

const queuedReindexResult = (): BulkDocumentReindexResult => ({
  bulkJobId: 'bulk-job-1',
  items: [
    {
      asset: {
        createdAt: '2026-07-21T10:00:00Z',
        filename: 'sso-enterprise.pdf',
        id: 'asset-1',
        knowledgeSpaceId: 'space-1',
        mimeType: 'application/pdf',
        objectKey: 'documents/asset-1',
        parserStatus: 'pending',
        sha256: 'hash-4',
        sizeBytes: 1200,
        version: 2,
      },
      compilationJob: { id: 'compilation-job-1', stage: 'queued' },
      status: 'queued',
      statusUrl: '/knowledge-fs/status/compilation-job-1',
    },
  ],
  total: 1,
})

const missingReindexResult = (): BulkDocumentReindexResult => ({
  bulkJobId: 'bulk-job-1',
  items: [{ documentId: 'document-1', status: 'not_found' }],
  total: 1,
})

describe('DocumentDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permissionState.keys = ['dataset.acl.edit']
    documentQuery.data = logicalDocument()
    documentQuery.error = null
    documentQuery.isPending = false
    revisionsQuery.data = { pages: [{ items: [activeRevision()] }] }
    revisionsQuery.error = null
    revisionsQuery.hasNextPage = false
    revisionsQuery.isFetchNextPageError = false
    revisionsQuery.isFetchingNextPage = false
    revisionsQuery.isPending = false
    chunksQuery.data = { pages: [{ items: [] }] }
    chunksQuery.error = null
    chunksQuery.hasNextPage = false
    chunksQuery.isFetchNextPageError = false
    chunksQuery.isFetchingNextPage = false
    chunksQuery.isPending = false
    tasksQuery.data = { pages: [{ items: [] }] }
    tasksQuery.error = null
    tasksQuery.hasNextPage = false
    tasksQuery.isFetchNextPageError = false
    tasksQuery.isFetchingNextPage = false
    tasksQuery.isPending = false
    taskSnapshotQuery.data = undefined
    taskSnapshotQuery.error = null
    submissionTasksQuery.data = undefined
    submissionTasksQuery.error = null
    permissionState.refresh.mockResolvedValue({
      data: { dataset: { default_permission_keys: ['dataset.acl.edit'] } },
      error: null,
    })
    reindexMutation.mutateAsync.mockResolvedValue(queuedReindexResult())
    queryClient.invalidateQueries.mockResolvedValue(undefined)
  })

  it('loads the document, revisions, chunks, and task status through generated contracts', () => {
    documentQuery.isPending = true

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(documentOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { params: { documentId: 'document-1', id: 'space-1' } },
        retry: expect.any(Function),
      }),
    )
    expect(infiniteInput(revisionsOptions.mock.lastCall?.[0])(null)).toEqual({
      params: { documentId: 'document-1', id: 'space-1' },
      query: { limit: 50 },
    })
    expect(infiniteInput(chunksOptions.mock.lastCall?.[0])('next')).toEqual({
      params: { documentId: 'document-1', id: 'space-1', revision: 3 },
      query: { cursor: 'next', limit: 100 },
    })
    expect(infiniteInput(tasksOptions.mock.lastCall?.[0])(null)).toEqual({
      params: { id: 'space-1' },
      query: { limit: 100 },
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('uses source provenance instead of exposing an internal source id', () => {
    documentQuery.data = logicalDocument({
      userMetadata: {},
    })

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.queryByText('source-1')).not.toBeInTheDocument()
    expect(screen.getAllByText('dataset.newKnowledge.sourceType.connector')).not.toHaveLength(0)
  })

  it('expands the parent-child tree and shows selected chunk content and metadata', async () => {
    const user = userEvent.setup()
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({ id: 'parent', text: 'Setup requirements' }),
            chunk({
              id: 'child',
              ordinal: 2,
              parentChunkId: 'parent',
              text: 'Workspace contract details',
              tokenCount: 4,
              userMetadata: { section: '2.1', sourcePage: 8 },
            }),
          ],
        },
      ],
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const tree = screen.getByRole('tree', { name: 'dataset.newKnowledge.documentContents' })
    const parent = within(tree).getByRole('treeitem', { name: /Setup requirements/ })
    expect(parent).toHaveAttribute('aria-expanded', 'true')
    const previousContentScroller = screen.getByTestId('chunk-content-scroll')
    await user.click(within(tree).getByRole('treeitem', { name: /Workspace contract details/ }))

    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.chunkHeading:{"position":2}' }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('article')).getByText('Workspace contract details'),
    ).toBeInTheDocument()
    expect(screen.getByText('section')).toBeInTheDocument()
    expect(screen.getByText('2.1')).toBeInTheDocument()
    expect(screen.getByText('sourcePage')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    const startLabeling = screen.getByRole('button', {
      name: 'dataset.metadata.documentMetadata.startLabeling',
    })
    expect(startLabeling).toBeDisabled()
    expect(startLabeling).toHaveAccessibleDescription('dataset.newKnowledge.filtersUnavailable')
    expect(screen.getByTestId('chunk-content-scroll')).toBe(previousContentScroller)
    expect(within(screen.getByRole('article')).getByText('Setup requirements')).toBeInTheDocument()
  })

  it('supports tree keyboard navigation, collapse, and selection', async () => {
    const user = userEvent.setup()
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({ id: 'parent', text: 'Parent node' }),
            chunk({ id: 'child', ordinal: 2, parentChunkId: 'parent', text: 'Child node' }),
            chunk({ id: 'second', ordinal: 3, text: 'Second root' }),
          ],
        },
      ],
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const tree = screen.getByRole('tree')
    const parent = screen.getByRole('treeitem', { name: /Parent node/ })
    tree.focus()
    fireEvent.keyDown(tree, { key: 'ArrowRight' })
    expect(tree).toHaveAttribute('aria-activedescendant', 'document-chunk-treeitem-child')
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(tree).toHaveAttribute('aria-activedescendant', 'document-chunk-treeitem-second')
    fireEvent.keyDown(tree, { key: 'Home' })
    fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    expect(parent).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{Enter}')
    expect(parent).toHaveAttribute('aria-selected', 'true')
    expect(tree).toHaveFocus()
  })

  it('supports mouse expansion and reports active re-index progress', async () => {
    const user = userEvent.setup()
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({ id: 'parent', text: 'Parent node' }),
            chunk({ id: 'child', ordinal: 2, parentChunkId: 'parent', text: 'Child node' }),
          ],
        },
      ],
    }
    tasksQuery.data = { pages: [{ items: [task({ progressPercent: 45 })] }] }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const parent = screen.getByRole('treeitem', { name: /Parent node/ })
    expect(parent).toHaveAttribute('aria-expanded', 'true')
    await user.click(parent)
    expect(parent).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: /Child node/ })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(
      'dataset.newKnowledge.documentReindexProgress:{"progress":"45"}',
    )
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }),
    ).toHaveAttribute('data-disabled')
  })

  it('renders missing revision and empty chunk states without issuing a usable chunk request', () => {
    documentQuery.data = logicalDocument({
      active: null,
      activeRevision: undefined,
      status: 'pending',
    })
    revisionsQuery.data = { pages: [{ items: [] }] }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.documentRevisionMissingTitle' }),
    ).toBeInTheDocument()
    expect(chunksOptions.mock.lastCall?.[0].enabled).toBe(false)
    expect(chunksOptions.mock.lastCall?.[0].input).toBe(skipToken)
  })

  it('keeps cached chunks visible when a background refresh fails', async () => {
    const user = userEvent.setup()
    chunksQuery.data = { pages: [{ items: [chunk({ id: 'cached', text: 'Cached content' })] }] }
    chunksQuery.error = new Error('refresh failed')

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('treeitem', { name: 'Cached content' })).toBeInTheDocument()
    expect(within(screen.getByRole('article')).getByText('Cached content')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentChunksLoadError',
    )
    expect(screen.getByText('dataset.newKnowledge.documentContentIncomplete')).toBeVisible()
    const indexInformation = screen
      .getByRole('heading', { name: 'dataset.newKnowledge.indexInformation' })
      .closest('section')
    expect(indexInformation).not.toBeNull()
    expect(within(indexInformation!).getAllByText('—')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(chunksQuery.refetch).toHaveBeenCalledOnce()
  })

  it('loads older revisions and always includes the active revision in the selector', async () => {
    const user = userEvent.setup()
    revisionsQuery.data = { pages: [{ items: [activeRevision({ revision: 2 })] }] }
    revisionsQuery.hasNextPage = true

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('combobox', { name: 'dataset.newKnowledge.documentRevision' }),
    )
    expect(await screen.findByRole('option', { name: /v3/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMoreRevisions' }))
    expect(revisionsQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('announces revision cursor errors and restores focus when the final page loads', async () => {
    const user = userEvent.setup()
    revisionsQuery.hasNextPage = true
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    const loadMore = screen.getByRole('button', {
      name: 'dataset.newKnowledge.loadMoreRevisions',
    })

    await user.click(loadMore)
    revisionsQuery.isFetchingNextPage = true
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    revisionsQuery.isFetchingNextPage = false
    revisionsQuery.isFetchNextPageError = true
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentRevisionsLoadError',
    )
    expect(screen.getByRole('button', { name: 'common.operation.retry' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    revisionsQuery.isFetchingNextPage = true
    revisionsQuery.isFetchNextPageError = false
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    revisionsQuery.isFetchingNextPage = false
    revisionsQuery.hasNextPage = false
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'dataset.newKnowledge.documentRevision' }),
      ).toHaveFocus(),
    )
  })

  it('finds a document task on later cursor pages and ignores stale revision tasks', async () => {
    tasksQuery.data = {
      pages: [{ items: [task({ documentId: 'another-document', id: 'another-task' })] }],
    }
    tasksQuery.hasNextPage = true
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    await waitFor(() => expect(tasksQuery.fetchNextPage).toHaveBeenCalledOnce())

    tasksQuery.hasNextPage = false
    tasksQuery.data = {
      pages: [{ items: [task({ documentRevision: 2, state: 'failed' })] }],
    }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    expect(screen.queryByText('dataset.newKnowledge.documentReindexFailed')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }),
    ).toBeEnabled()
  })

  it('polls only the discovered active task through the single-task contract', () => {
    tasksQuery.data = { pages: [{ items: [task({ state: 'running' })] }] }
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(taskSnapshotOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        input: {
          params: { documentId: 'document-1', id: 'space-1', taskId: 'task-1' },
        },
        refetchInterval: expect.any(Function),
      }),
    )
    expect(tasksQuery.refetch).not.toHaveBeenCalled()
  })

  it('refreshes the document and content when an active task becomes terminal', async () => {
    tasksQuery.data = { pages: [{ items: [task({ state: 'running' })] }] }
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    taskSnapshotQuery.data = task({ state: 'succeeded' })
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4))
  })

  it('virtualizes long trees and bounds their accessible labels', () => {
    chunksQuery.data = {
      pages: [
        {
          items: Array.from({ length: 100 }, (_, index) =>
            chunk({ id: `chunk-${index}`, ordinal: index + 1, text: `${'x'.repeat(150)}\nbody` }),
          ),
        },
      ],
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getAllByRole('treeitem')).toHaveLength(12)
    expect(screen.getAllByRole('treeitem')[0]).toHaveAccessibleName(`${'x'.repeat(119)}…`)
  })

  it('shows empty chunks, cursor errors, and a real load-more action', async () => {
    const user = userEvent.setup()
    chunksQuery.data = { pages: [{ items: [], nextCursor: 'next' }] }
    chunksQuery.error = new Error('cursor failed')
    chunksQuery.hasNextPage = true
    chunksQuery.isFetchNextPageError = true

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentChunksLoadMoreError',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(chunksQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('automatically converges remaining chunk pages and marks partial document statistics', async () => {
    chunksQuery.data = {
      pages: [{ items: [chunk({ id: 'first', text: 'First chunk' })], nextCursor: 'next' }],
    }
    chunksQuery.hasNextPage = true

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(chunksQuery.fetchNextPage).toHaveBeenCalledOnce())
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('dataset.newKnowledge.documentContentIncomplete')).toBeVisible()
    expect(
      within(screen.getByRole('article')).getByText('First chunk').closest('section'),
    ).toHaveClass('[content-visibility:auto]')
  })

  it('moves focus to newly loaded tree content when the last load-more control disappears', async () => {
    const user = userEvent.setup()
    chunksQuery.data = {
      pages: [{ items: [chunk({ id: 'first', text: 'First chunk' })], nextCursor: 'next' }],
    }
    chunksQuery.hasNextPage = true
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))
    chunksQuery.isFetchingNextPage = true
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    chunksQuery.data = {
      pages: [
        { items: [chunk({ id: 'first', text: 'First chunk' })] },
        { items: [chunk({ id: 'second', ordinal: 2, text: 'Second chunk' })] },
      ],
    }
    chunksQuery.hasNextPage = false
    chunksQuery.isFetchingNextPage = false
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const tree = screen.getByRole('tree')
    await waitFor(() => expect(tree).toHaveFocus())
    expect(tree).toHaveAttribute('aria-activedescendant', 'document-chunk-treeitem-second')
    expect(screen.queryByRole('button', { name: 'dataset.newKnowledge.loadMore' })).toBeNull()
  })

  it('distinguishes missing, restricted, and retryable document failures', async () => {
    const user = userEvent.setup()
    documentQuery.data = undefined
    documentQuery.error = { status: 404 }
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.documentNotFoundTitle' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).toBeNull()

    documentQuery.error = new Error('temporary failure')
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(documentQuery.refetch).toHaveBeenCalledOnce()
  })

  it('shows re-index progress and preserves the last ready revision after failure', () => {
    tasksQuery.data = {
      pages: [
        {
          items: [task({ state: 'failed', errorCode: 'PARSER_FAILED', progressPercent: 80 })],
        },
      ],
    }
    chunksQuery.data = { pages: [{ items: [chunk({ id: 'ready-chunk' })] }] }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentReindexFailed',
    )
    expect(screen.getByText('dataset.newKnowledge.lastReadyRevisionHint')).toBeInTheDocument()
    expect(within(screen.getByRole('article')).getByText('Parent content')).toBeInTheDocument()
  })

  it('renders a valid empty file size as zero bytes', () => {
    documentQuery.data = logicalDocument({
      active: activeRevision({ sizeBytes: 0 }),
    })
    revisionsQuery.data = { pages: [{ items: [activeRevision({ sizeBytes: 0 })] }] }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getByText('0 B')).toBeInTheDocument()
  })

  it('starts re-indexing once and disables writes for readonly users', async () => {
    const user = userEvent.setup()
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }))

    expect(reindexMutation.mutateAsync).toHaveBeenCalledWith({
      body: { documentIds: ['document-1'] },
      params: { id: 'space-1' },
    })
    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalled())

    permissionState.keys = ['dataset.acl.readonly']
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }),
    ).toHaveAttribute('data-disabled')
  })

  it('guards re-index against rapid repeats and handles a concurrently removed document', async () => {
    const user = userEvent.setup()
    let resolveReindex: ((value: BulkDocumentReindexResult) => void) | undefined
    reindexMutation.mutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReindex = resolve
        }),
    )
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const button = screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' })

    await user.dblClick(button)
    expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
    resolveReindex?.(missingReindexResult())
    await waitFor(() =>
      expect(toastState.error).toHaveBeenCalledWith('dataset.newKnowledge.documentNotFoundTitle'),
    )
    expect(toastState.success).not.toHaveBeenCalled()
    expect(queryClient.invalidateQueries).toHaveBeenCalledOnce()
    expect(queryClient.removeQueries).toHaveBeenCalledOnce()
    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: ['knowledge-fs', 'document', 'space-1', 'document-1'],
    })
    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.documentNotFoundTitle' }),
    ).toBeInTheDocument()
  })

  it('does not render cached document data after a refetch returns 403 or 404', () => {
    documentQuery.error = { status: 404 }
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.documentNotFoundTitle' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('sso-enterprise.pdf')).toBeNull()

    documentQuery.error = { status: 403 }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    expect(screen.queryByText('sso-enterprise.pdf')).toBeNull()

    const retry = (
      documentOptions.mock.calls.find(([options]) => 'retry' in options)?.[0] as {
        retry: (failureCount: number, error: unknown) => boolean
      }
    ).retry
    expect(retry(0, { status: 403 })).toBe(false)
    expect(retry(0, { status: 404 })).toBe(false)
    expect(retry(0, new Error('temporary'))).toBe(true)
  })

  it('invalidates document content when an accepted re-index first appears as terminal', async () => {
    const user = userEvent.setup()
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }))
    await waitFor(() => expect(toastState.success).toHaveBeenCalled())
    queryClient.invalidateQueries.mockClear()
    tasksQuery.data = { pages: [{ items: [task({ documentRevision: 4, state: 'succeeded' })] }] }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4))
  })

  it('offers an explicit continuation when task discovery reaches its page limit', async () => {
    const user = userEvent.setup()
    tasksQuery.data = {
      pages: Array.from({ length: 3 }, (_, index) => ({
        items: [task({ documentId: `other-${index}`, id: `other-task-${index}` })],
        nextCursor: `cursor-${index}`,
      })),
    }
    tasksQuery.hasNextPage = true

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('dataset.newKnowledge.documentTaskLookupIncomplete')
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }),
    ).toHaveAttribute('data-disabled')
    await user.click(
      within(alert).getByRole('button', {
        name: 'dataset.newKnowledge.continueCheckingTaskStatus',
      }),
    )
    await waitFor(() => expect(tasksQuery.fetchNextPage).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  })

  it('keeps re-index visibly busy through invalidation and stale task-list reconciliation', async () => {
    const user = userEvent.setup()
    let finishInvalidation: (() => void) | undefined
    const invalidation = new Promise<void>((resolve) => {
      finishInvalidation = resolve
    })
    queryClient.invalidateQueries.mockReturnValue(invalidation)

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const button = screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' })
    await user.click(button)

    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
    finishInvalidation?.()
    await waitFor(() => expect(toastState.success).toHaveBeenCalled())
    expect(button).toHaveAttribute('aria-busy', 'true')
    await user.click(button)
    expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
  })

  it('does not mistake an earlier failed revision for the newly submitted re-index', async () => {
    const user = userEvent.setup()
    tasksQuery.data = {
      pages: [{ items: [task({ documentRevision: 4, id: 'old-failed', state: 'failed' })] }],
    }
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const button = screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' })

    await user.click(button)
    await waitFor(() => expect(toastState.success).toHaveBeenCalled())
    expect(button).toHaveAttribute('data-disabled')
    await user.click(button)
    expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()

    const discoveryOptions = submissionTasksOptions.mock.lastCall?.[0] as unknown as {
      refetchInterval: (query: {
        state: { data?: { items: DocumentProcessingTask[] }; error?: unknown }
      }) => number | false
      retry: (failureCount: number, error: unknown) => boolean
    }
    expect(discoveryOptions.refetchInterval({ state: { data: { items: [] } } })).toBe(2000)
    expect(
      discoveryOptions.refetchInterval({
        state: { data: { items: [task({ documentRevision: 5 })] } },
      }),
    ).toBe(false)
    expect(
      discoveryOptions.refetchInterval({
        state: { data: { items: [] }, error: { status: 403 } },
      }),
    ).toBe(false)
    expect(discoveryOptions.retry(0, { status: 403 })).toBe(false)
    expect(discoveryOptions.retry(0, { status: 404 })).toBe(false)
  })

  it('keeps submission protection while a delayed status recheck is unresolved', async () => {
    vi.useFakeTimers()
    tasksQuery.data = {
      pages: [{ items: [task({ documentRevision: 4, id: 'old-failed', state: 'failed' })] }],
    }
    let finishTaskRefresh: (() => void) | undefined
    tasksQuery.refetch.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishTaskRefresh = resolve
      }),
    )
    try {
      const rendered = render(
        <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
      )
      const reindexButton = screen.getByRole('button', {
        name: 'dataset.newKnowledge.reindexDocument',
      })
      await act(async () => {
        fireEvent.click(reindexButton)
        await Promise.resolve()
        await Promise.resolve()
      })
      submissionTasksQuery.error = new Error('submission discovery failed')
      rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
      await act(() => vi.advanceTimersByTimeAsync(30000))

      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('dataset.newKnowledge.documentReindexConfirmationDelayed')
      const timedOutDiscoveryOptions = submissionTasksOptions.mock.lastCall?.[0] as unknown as {
        refetchInterval: (query: {
          state: { data?: { items: DocumentProcessingTask[] }; error?: unknown }
        }) => number | false
      }
      expect(timedOutDiscoveryOptions.refetchInterval({ state: { data: { items: [] } } })).toBe(
        false,
      )
      fireEvent.click(
        within(alert).getByRole('button', {
          name: 'dataset.newKnowledge.checkReindexStatus',
        }),
      )
      expect(reindexButton).toHaveAttribute('data-disabled')
      expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
      expect(submissionTasksQuery.refetch).toHaveBeenCalledOnce()

      await act(async () => {
        finishTaskRefresh?.()
        await Promise.resolve()
      })
      expect(reindexButton).toHaveAttribute('data-disabled')
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()

      await act(async () => {
        fireEvent.click(
          within(alert).getByRole('button', {
            name: 'dataset.newKnowledge.retryReindexDocument',
          }),
        )
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(reindexMutation.mutateAsync).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
      const discoveryOptions = submissionTasksOptions.mock.lastCall?.[0] as unknown as {
        refetchInterval: (query: {
          state: { data?: { items: DocumentProcessingTask[] } }
        }) => number | false
      }
      expect(
        discoveryOptions.refetchInterval({
          state: { data: { items: [task({ documentRevision: 4, state: 'failed' })] } },
        }),
      ).toBe(2000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses a late first task as the baseline while an explicit resubmit is pending', async () => {
    vi.useFakeTimers()
    tasksQuery.data = {
      pages: [{ items: [task({ documentRevision: 4, id: 'old-failed', state: 'failed' })] }],
    }
    let finishSecondReindex: ((value: BulkDocumentReindexResult) => void) | undefined
    try {
      const rendered = render(
        <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
      )
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }),
        )
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(() => vi.advanceTimersByTimeAsync(30000))
      reindexMutation.mutateAsync.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSecondReindex = resolve
          }),
      )

      fireEvent.click(
        screen.getByRole('button', { name: 'dataset.newKnowledge.retryReindexDocument' }),
      )
      tasksQuery.data = {
        pages: [{ items: [task({ documentRevision: 5, id: 'late-first', state: 'running' })] }],
      }
      rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
      await act(async () => {
        finishSecondReindex?.(queuedReindexResult())
        await Promise.resolve()
        await Promise.resolve()
      })

      const discoveryOptions = submissionTasksOptions.mock.lastCall?.[0] as unknown as {
        refetchInterval: (query: {
          state: { data?: { items: DocumentProcessingTask[] }; error?: unknown }
        }) => number | false
      }
      expect(
        discoveryOptions.refetchInterval({
          state: { data: { items: [task({ documentRevision: 5, id: 'late-first' })] } },
        }),
      ).toBe(2000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops first-page submission discovery when task history observes the new task', async () => {
    const user = userEvent.setup()
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }))
    await waitFor(() => expect(toastState.success).toHaveBeenCalled())

    tasksQuery.data = {
      pages: [{ items: [task({ documentRevision: 4, state: 'running' })] }],
    }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(submissionTasksOptions.mock.lastCall?.[0]).toMatchObject({ enabled: false })
  })

  it('stops snapshot polling and distrusts stale active task data after 403 or 404', async () => {
    tasksQuery.data = { pages: [{ items: [task({ state: 'running' })] }] }
    taskSnapshotQuery.error = { status: 404 }
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    expect(screen.queryByRole('status')).toBeNull()
    const snapshotOptions = taskSnapshotOptions.mock.lastCall?.[0] as {
      refetchInterval: (query: {
        state: { data?: DocumentProcessingTask; error?: unknown }
      }) => number | false
    }
    expect(snapshotOptions.refetchInterval({ state: { error: { status: 404 } } })).toBe(false)
    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalled())

    queryClient.invalidateQueries.mockClear()
    taskSnapshotQuery.error = { status: 403 }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.tasksErrorDescription',
    )
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }),
    ).toHaveAttribute('data-disabled')
  })

  it('clears both task caches when a submission-discovered task snapshot returns 404', async () => {
    submissionTasksQuery.data = { items: [task({ state: 'running' })] }
    taskSnapshotQuery.error = { status: 404 }

    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2))
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['knowledge-fs', 'tasks', 'space-1'],
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['knowledge-fs', 'submission-tasks', 'space-1'],
    })
    expect(queryClient.setQueryData).toHaveBeenCalledTimes(2)

    submissionTasksQuery.data = { items: [task({ id: 'missing-task-2', state: 'running' })] }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4))
    expect(queryClient.setQueryData).toHaveBeenCalledTimes(4)

    submissionTasksQuery.data = { items: [task({ state: 'running' })] }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    await waitFor(() => expect(queryClient.setQueryData).toHaveBeenCalledTimes(4))
  })

  it('refreshes stale detail and task-list caches for a newer terminal task on revisit', async () => {
    tasksQuery.data = {
      pages: [{ items: [task({ documentRevision: 4, state: 'succeeded' })] }],
    }
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4))
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['knowledge-fs', 'tasks', 'space-1'],
    })
  })

  it('locks local writes during a 403 refresh and restores editor access afterward', async () => {
    const user = userEvent.setup()
    let finishPermissionRefresh:
      | ((value: { data: { dataset: { default_permission_keys: string[] } }; error: null }) => void)
      | undefined
    permissionState.refresh.mockReturnValueOnce(
      new Promise<{
        data: { dataset: { default_permission_keys: string[] } }
        error: null
      }>((resolve) => {
        finishPermissionRefresh = resolve
      }),
    )
    reindexMutation.mutateAsync.mockRejectedValueOnce({ status: 403 })

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const button = screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' })
    await user.click(button)

    await waitFor(() => expect(permissionState.refresh).toHaveBeenCalledOnce())
    expect(button).toHaveAttribute('data-disabled')
    finishPermissionRefresh?.({
      data: { dataset: { default_permission_keys: ['dataset.acl.edit'] } },
      error: null,
    })
    await waitFor(() => expect(button).not.toHaveAttribute('data-disabled'))
  })

  it('keeps the local write lock when permission refresh resolves with an error', async () => {
    const user = userEvent.setup()
    permissionState.refresh.mockResolvedValueOnce({
      data: { dataset: { default_permission_keys: ['dataset.acl.edit'] } },
      error: new Error('permission refresh failed'),
    })
    reindexMutation.mutateAsync.mockRejectedValueOnce({ status: 403 })

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const button = screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' })
    await user.click(button)

    await waitFor(() => expect(permissionState.refresh).toHaveBeenCalledOnce())
    expect(button).toHaveAttribute('data-disabled')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('dataset.newKnowledge.documentPermissionRestricted')
    const retryButton = within(alert).getByRole('button', { name: 'common.operation.retry' })
    await waitFor(() => expect(retryButton).toHaveFocus())

    permissionState.refresh.mockResolvedValueOnce({
      data: { dataset: { default_permission_keys: ['dataset.acl.edit'] } },
      error: new Error('permission refresh still failing'),
    })
    await user.click(retryButton)
    await waitFor(() => expect(permissionState.refresh).toHaveBeenCalledTimes(2))
    expect(retryButton).toHaveFocus()
    expect(alert).toBeInTheDocument()

    permissionState.refresh.mockResolvedValueOnce({
      data: { dataset: { default_permission_keys: ['dataset.acl.edit'] } },
      error: null,
    })
    await user.click(retryButton)
    await waitFor(() => expect(permissionState.refresh).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(button).not.toHaveAttribute('data-disabled'))
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  })

  it('disables re-index while the document is deleting', () => {
    documentQuery.data = logicalDocument({ status: 'deleting' })
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }),
    ).toHaveAttribute('data-disabled')
  })

  it('keeps virtual tree focus stable across Home and End and exposes sibling positions', () => {
    chunksQuery.data = {
      pages: [
        {
          items: Array.from({ length: 100 }, (_, index) =>
            chunk({ id: `chunk-${index}`, ordinal: index + 1, text: `Chunk ${index + 1}` }),
          ),
        },
      ],
    }
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const tree = screen.getByRole('tree')

    tree.focus()
    fireEvent.keyDown(tree, { key: 'End' })
    expect(tree).toHaveFocus()
    expect(tree).toHaveAttribute('aria-activedescendant', 'document-chunk-treeitem-chunk-99')
    expect(screen.getByRole('treeitem', { name: 'Chunk 100' })).toHaveAttribute(
      'aria-posinset',
      '100',
    )
    expect(screen.getByRole('treeitem', { name: 'Chunk 100' })).toHaveAttribute(
      'aria-setsize',
      '100',
    )
    expect(screen.getByRole('treeitem', { name: 'Chunk 100' })).toHaveClass(
      'ring-state-accent-solid',
    )
    fireEvent.keyDown(tree, { key: 'Home' })
    expect(tree).toHaveAttribute('aria-activedescendant', 'document-chunk-treeitem-chunk-0')
  })

  it('keeps focus on a failed chunk load-more retry', async () => {
    const user = userEvent.setup()
    chunksQuery.data = {
      pages: [{ items: [chunk({ id: 'first', text: 'First chunk' })], nextCursor: 'next' }],
    }
    chunksQuery.hasNextPage = true
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    const loadMore = screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' })
    expect(screen.getByRole('treeitem', { name: 'First chunk' })).toHaveAttribute(
      'aria-setsize',
      '-1',
    )

    await user.click(loadMore)
    chunksQuery.isFetchingNextPage = true
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    chunksQuery.isFetchingNextPage = false
    chunksQuery.isFetchNextPageError = true
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('button', { name: 'common.operation.retry' })).toHaveFocus()
  })
})

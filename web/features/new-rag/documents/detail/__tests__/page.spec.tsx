import type {
  KnowledgeFsDocumentMultimodalManifestResponse,
  KnowledgeFsDocumentOutlineResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ReactElement } from 'react'
import type { DocumentMetadataField } from '../../metadata/editor-model'
import type {
  BackgroundTask,
  DocumentProcessingTask,
  DocumentRevisionChunk,
  LogicalDocument,
  LogicalDocumentRevision,
} from '../../models'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { createStore, Provider } from 'jotai'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { DocumentDetailPage } from '../page'

const knowledgeSpacePermissionState = vi.hoisted(() => ({
  keys: ['knowledge_space_document_write'],
  name: 'Support knowledge',
  refetch: vi.fn(),
}))
vi.mock('../../../space/context', () => ({
  useKnowledgeSpace: () => ({
    refetch: knowledgeSpacePermissionState.refetch,
    space: {
      control_space_id: 'space-1',
      permission_keys: knowledgeSpacePermissionState.keys,
      technical_summary: { name: knowledgeSpacePermissionState.name },
    },
  }),
}))

const multimodalAssetGet = vi.hoisted(() => vi.fn())

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: multimodalAssetGet,
}))

vi.mock('../../../components/knowledge-model-readiness-banner', () => ({
  KnowledgeModelReadinessBanner: () => null,
}))

type BulkDocumentReindexResult = {
  bulkJobId: string
  items: Array<{
    asset?: unknown
    compilation_job?: { id: string; stage: 'queued' }
    documentId?: string
    status: 'not_found' | 'queued'
    statusUrl?: string
  }>
  total: number
}

type InfiniteOptions = {
  enabled?: boolean
  getNextPageParam: (lastPage: { next_cursor?: string | null }) => string | null | undefined
  input: (pageParam: string | null) => unknown
  initialPageParam: string | null
  queryKind: 'chunks' | 'documents' | 'revisions' | 'tasks'
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

const knowledgeSpaceQuery = vi.hoisted(() => ({
  data: {
    control_space_id: 'space-1',
    technical_summary: { name: 'Support knowledge' },
  } as { control_space_id: string; technical_summary: { name: string } } | undefined,
  error: null as unknown,
  isPending: false,
}))

const useDocumentTitleMock = vi.hoisted(() => vi.fn())

const submittedJobQuery = vi.hoisted(() => ({
  data: undefined as
    | {
        id: string
        run_state?: string | null
        stage?: string | null
        updated_at?: number
      }
    | undefined,
  error: null as unknown,
  isPending: false,
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

const outlineQuery = vi.hoisted(() => ({
  data: undefined as KnowledgeFsDocumentOutlineResponse | undefined,
  error: null as unknown,
  isPending: false,
  refetch: vi.fn(),
}))

const multimodalQuery = vi.hoisted(() => ({
  data: undefined as KnowledgeFsDocumentMultimodalManifestResponse | undefined,
  error: null as unknown,
  isPending: false,
  refetch: vi.fn(),
}))

const tasksQuery = vi.hoisted(() => ({
  data: undefined as { pages: Array<{ items: BackgroundTask[]; nextCursor?: string }> } | undefined,
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
const cancelMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const patchDocumentMetadata = vi.hoisted(() => vi.fn())
const listLogicalDocuments = vi.hoisted(() => vi.fn())
const createMetadataField = vi.hoisted(() => vi.fn())
const metadataFieldsQuery = vi.hoisted(() => ({
  data: [] as DocumentMetadataField[] | undefined,
  error: null as unknown,
  isFetching: false,
  isPending: false,
  refetch: vi.fn(),
}))
const routerMock = vi.hoisted(() => ({ push: vi.fn() }))
const settingsState = vi.hoisted(() => ({
  configurationState: 'active' as 'active' | 'setup-required',
  refetch: vi.fn(),
}))
const queryClient = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  removeQueries: vi.fn(),
}))
const toastState = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }))
const virtualizerState = vi.hoisted(() => ({ scrollToIndex: vi.fn() }))
const revisionApiResponse = vi.hoisted(
  () => (revision: Exclude<LogicalDocumentRevision, null>) => ({
    activated_at: revision.activatedAt ?? null,
    content_hash: revision.contentHash,
    created_at: revision.createdAt,
    document_asset_id: revision.documentAssetId,
    document_asset_version: revision.documentAssetVersion,
    document_id: revision.documentId,
    knowledge_space_id: revision.knowledgeSpaceId,
    mime_type: revision.mimeType,
    revision: revision.revision,
    size_bytes: revision.sizeBytes,
    state: revision.state,
  }),
)
const logicalDocumentApiResponse = vi.hoisted(() => (item: LogicalDocument) => ({
  active: item.active ? revisionApiResponse(item.active) : null,
  active_revision: item.activeRevision ?? null,
  created_at: item.createdAt,
  disabled_at: item.enabled ? null : item.updatedAt,
  disabled_by_subject_id: item.enabled ? null : 'account-1',
  enabled: item.enabled,
  id: item.id,
  knowledge_space_id: item.knowledgeSpaceId,
  provider_item_id: item.providerItemId ?? null,
  row_version: item.rowVersion,
  source_id: item.sourceId ?? null,
  status: item.status,
  title: item.title,
  updated_at: item.updatedAt,
  user_metadata: item.userMetadata,
}))
const chunkApiResponse = vi.hoisted(() => (item: DocumentRevisionChunk) => ({
  created_at: item.createdAt,
  document_id: item.documentId,
  document_revision: item.documentRevision,
  end_offset: item.endOffset ?? null,
  enabled: item.enabled,
  id: item.id,
  kind: item.kind,
  knowledge_space_id: item.knowledgeSpaceId,
  ordinal: item.ordinal,
  parent_chunk_id: item.parentChunkId ?? null,
  parse_element_ids: item.parseElementIds,
  section_path: item.sectionPath,
  start_offset: item.startOffset ?? null,
  text: item.text,
  token_count: item.tokenCount,
  user_metadata: item.userMetadata,
}))
const taskApiResponse = vi.hoisted(() => (item: BackgroundTask) => ({
  can_cancel: item.canCancel ?? true,
  can_retry: item.canRetry ?? item.state === 'failed',
  completed_at: item.completedAt ?? null,
  created_at: item.createdAt,
  document_id: item.documentId ?? null,
  document_revision: item.documentRevision ?? null,
  error_code: item.errorCode ?? null,
  error_message: item.errorMessage ?? null,
  id: item.id,
  knowledge_space_id: item.knowledgeSpaceId,
  operation: item.operation ?? 'document_processing',
  progress_completed:
    item.progressCompleted ?? (item.state === 'succeeded' ? (item.progressTotal ?? 1) : 0),
  progress_failed: item.progressFailed ?? 0,
  progress_percent: item.progressPercent,
  progress_total: item.progressTotal ?? 1,
  source_id: item.sourceId ?? null,
  state:
    item.state === 'succeeded'
      ? 'completed'
      : item.state === 'dispatch_pending'
        ? 'queued'
        : item.state === 'superseded'
          ? 'canceled'
          : item.state,
  task_kind: item.taskKind ?? 'document',
  updated_at: item.updatedAt,
}))
const documentOptions = vi.hoisted(() =>
  vi.fn((options: object) => ({
    ...options,
    queryKey: ['knowledge-fs', 'document', 'space-1', 'document-1'],
    queryKind: 'document',
  })),
)
const knowledgeSpaceOptions = vi.hoisted(() =>
  vi.fn((options: object) => ({ ...options, queryKind: 'knowledge-space' })),
)
const submittedJobOptions = vi.hoisted(() =>
  vi.fn((options: object) => ({
    ...options,
    queryKey: ['knowledge-fs', 'job'],
    queryKind: 'submitted-job',
  })),
)
const settingsOptions = vi.hoisted(() =>
  vi.fn(({ input }: { input: unknown }) => ({
    queryKey: ['knowledge-fs', 'settings', input],
    queryKind: 'settings',
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
const outlineOptions = vi.hoisted(() =>
  vi.fn((options: object) => ({
    ...options,
    queryKey: ['knowledge-fs', 'outline', 'space-1', 'asset-1'],
    queryKind: 'outline',
  })),
)
const multimodalOptions = vi.hoisted(() =>
  vi.fn((options: object) => ({
    ...options,
    queryKey: ['knowledge-fs', 'multimodal', 'space-1', 'asset-1'],
    queryKind: 'multimodal',
  })),
)
const metadataFieldsOptions = vi.hoisted(() =>
  vi.fn((options: object) => ({
    ...options,
    queryKey: ['knowledge-fs', 'metadata-fields'],
  })),
)
const documentTasksOptions = vi.hoisted(() =>
  vi.fn((options: Omit<InfiniteOptions, 'queryKind'>) => ({
    ...options,
    queryKey: ['knowledge-fs', 'tasks', 'space-1', 'document-1'],
    queryKind: 'tasks',
  })),
)
const documentsOptions = vi.hoisted(() =>
  vi.fn((options: Omit<InfiniteOptions, 'queryKind'>) => ({
    ...options,
    queryKey: ['knowledge-fs', 'documents', 'space-1'],
    queryKind: 'documents',
  })),
)

const queryAtomTestState = vi.hoisted(() => ({
  versionAtom: undefined as import('jotai').PrimitiveAtom<number> | undefined,
}))

vi.mock('jotai-tanstack-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai-tanstack-query')>()
  const { atom } = await vi.importActual<typeof import('jotai')>('jotai')
  const versionAtom = atom(0)
  const testQueryClientAtom = atom(queryClient)
  queryAtomTestState.versionAtom = versionAtom

  return {
    ...original,
    queryClientAtom: testQueryClientAtom,
    atomWithInfiniteQuery: (
      getOptions: (get: <Value>(target: import('jotai').Atom<Value>) => Value) => {
        queryKind?: string
      },
    ) =>
      atom((get) => {
        get(versionAtom)
        const options = getOptions(get)
        if (options.queryKind === 'revisions')
          return {
            ...revisionsQuery,
            data: revisionsQuery.data
              ? {
                  pages: revisionsQuery.data.pages.map((page) => ({
                    data: page.items.flatMap((revision) =>
                      revision ? [revisionApiResponse(revision)] : [],
                    ),
                    next_cursor: page.nextCursor ?? null,
                  })),
                }
              : undefined,
          }
        if (options.queryKind === 'chunks')
          return {
            ...chunksQuery,
            data: chunksQuery.data
              ? {
                  pages: chunksQuery.data.pages.map((page) => ({
                    data: page.items.map(chunkApiResponse),
                    next_cursor: page.nextCursor ?? null,
                  })),
                }
              : undefined,
          }
        if (options.queryKind === 'tasks')
          return {
            ...tasksQuery,
            data: tasksQuery.data
              ? {
                  pages: tasksQuery.data.pages.map((page) => ({
                    data: page.items.map(taskApiResponse),
                    next_cursor: page.nextCursor ?? null,
                  })),
                }
              : undefined,
          }
        throw new Error(`Unexpected infinite query atom: ${options.queryKind ?? 'unknown'}`)
      }),
    atomWithMutation: (
      getOptions: (get: <Value>(target: import('jotai').Atom<Value>) => Value) => {
        mutationKind?: string
      },
    ) =>
      atom((get) => {
        const options = getOptions(get)
        return options.mutationKind === 'cancel' ? cancelMutation : reindexMutation
      }),
    atomWithQuery: (
      getOptions: (get: <Value>(target: import('jotai').Atom<Value>) => Value) => {
        queryKind?: string
      },
    ) =>
      atom((get) => {
        get(versionAtom)
        const options = getOptions(get)
        if (options.queryKind === 'document') return { ...documentQuery }
        if (options.queryKind === 'outline') return { ...outlineQuery }
        if (options.queryKind === 'multimodal') return { ...multimodalQuery }
        if (options.queryKind === 'submitted-job') return { ...submittedJobQuery }
        throw new Error(`Unexpected query atom: ${options.queryKind ?? 'unknown'}`)
      }),
  }
})

function render(ui: ReactElement, options?: Parameters<typeof renderWithNuqs>[1]) {
  const store = createStore()
  const refreshQueryAtoms = () => {
    store.set(queryAtomTestState.versionAtom!, (version) => version + 1)
  }
  const withStore = (content: ReactElement) => <Provider store={store}>{content}</Provider>

  refreshQueryAtoms()
  const rendered = renderWithNuqs(withStore(ui), options)

  return {
    ...rendered,
    rerender(nextUi: ReactElement) {
      act(refreshQueryAtoms)
      rendered.rerender(withStore(nextUi))
    },
  }
}

vi.mock('@/context/permission-state', () => ({
  datasetDefaultPermissionKeysAtom: permissionState.datasetAtom,
  refreshWorkspacePermissionKeysAfterMutationDenialAtom: permissionState.refreshAtom,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({ toast: toastState }))
vi.mock('copy-to-clipboard', () => ({ default: vi.fn(() => true) }))
vi.mock('@/next/navigation', () => ({
  usePathname: () => '/datasets/new/space-1/documents/document-1',
  useRouter: () => routerMock,
}))

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
      if (options.queryKind === 'documents')
        return {
          ...tasksQuery,
          data: documentQuery.data
            ? {
                pages: [
                  {
                    data: [logicalDocumentApiResponse(documentQuery.data)],
                    next_cursor: null,
                  },
                ],
              }
            : undefined,
        }
      if (options.queryKind === 'revisions')
        return {
          ...revisionsQuery,
          data: revisionsQuery.data
            ? {
                pages: revisionsQuery.data.pages.map((page) => ({
                  data: page.items.flatMap((revision) =>
                    revision ? [revisionApiResponse(revision)] : [],
                  ),
                  next_cursor: page.nextCursor ?? null,
                })),
              }
            : undefined,
        }
      if (
        options.queryKind === 'chunks' ||
        ('queryKey' in options &&
          Array.isArray(options.queryKey) &&
          options.queryKey.includes('chunks'))
      )
        return {
          ...chunksQuery,
          data: chunksQuery.data
            ? {
                pages: chunksQuery.data.pages.map((page) => ({
                  data: page.items.map(chunkApiResponse),
                  next_cursor: page.nextCursor ?? null,
                })),
              }
            : undefined,
        }
      return {
        ...tasksQuery,
        data: tasksQuery.data
          ? {
              pages: tasksQuery.data.pages.map((page) => ({
                data: page.items.map(taskApiResponse),
                next_cursor: page.nextCursor ?? null,
              })),
            }
          : undefined,
      }
    },
    useMutation: (options: { mutationKind?: string }) =>
      options.mutationKind === 'cancel' ? cancelMutation : reindexMutation,
    useQuery: (options: { queryKey?: readonly unknown[]; queryKind?: string }) => {
      if (options.queryKey?.includes('metadata-fields')) return metadataFieldsQuery
      if (options.queryKind === 'multimodal') return multimodalQuery
      if (options.queryKind === 'outline') return outlineQuery
      if (options.queryKind === 'settings')
        return {
          data: {
            active_profile_available: settingsState.configurationState === 'active',
            active_profile_revisions:
              settingsState.configurationState === 'active' ? { embedding: 1, retrieval: 1 } : {},
            capabilities: {
              deep: settingsState.configurationState === 'active',
              index: settingsState.configurationState === 'active',
              ingest: settingsState.configurationState === 'active',
              query: settingsState.configurationState === 'active',
              research: settingsState.configurationState === 'active',
              source_sync: settingsState.configurationState === 'active',
            },
            configuration_state: settingsState.configurationState,
            embedding: null,
            issues: [],
            retrieval: null,
            revision: 1,
          },
          refetch: settingsState.refetch,
        }
      if (options.queryKind === 'knowledge-space') return knowledgeSpaceQuery
      if (options.queryKind === 'submitted-job') return submittedJobQuery
      return documentQuery
    },
    useQueryClient: () => queryClient,
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          documents: {
            byDocumentId: {
              patch: patchDocumentMetadata,
            },
          },
          logicalDocuments: {
            get: listLogicalDocuments,
          },
          metadata: {
            post: createMetadataField,
          },
        },
      },
    },
  },
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          get: {
            queryOptions: knowledgeSpaceOptions,
          },
          backgroundTasks: {
            byTaskKind: {
              byTaskId: {
                cancel: {
                  post: {
                    mutationOptions: () => ({ mutationKind: 'cancel' }),
                  },
                },
              },
            },
            get: {
              infiniteOptions: documentTasksOptions,
              key: () => ['knowledge-fs', 'tasks'],
            },
          },
          documents: {
            byDocumentId: {
              multimodal: {
                get: {
                  queryOptions: multimodalOptions,
                },
              },
              outline: {
                get: {
                  queryOptions: outlineOptions,
                },
              },
              revisions: {
                byRevision: {
                  chunks: {
                    get: {
                      infiniteOptions: chunksOptions,
                      key: () => ['knowledge-fs', 'chunks'],
                    },
                  },
                },
                get: {
                  infiniteOptions: revisionsOptions,
                  key: () => ['knowledge-fs', 'revisions'],
                },
              },
            },
            reindex: {
              post: {
                mutationOptions: () => ({}),
              },
            },
          },
          logicalDocuments: {
            byDocumentId: {
              get: {
                queryOptions: documentOptions,
                key: () => ['knowledge-fs', 'document'],
              },
            },
            get: {
              infiniteOptions: documentsOptions,
              key: () => ['knowledge-fs', 'documents'],
            },
          },
          metadata: {
            get: {
              key: () => ['knowledge-fs', 'metadata-fields'],
              queryOptions: metadataFieldsOptions,
            },
          },
          jobs: {
            byJobId: {
              get: {
                queryOptions: submittedJobOptions,
              },
            },
          },
          settings: {
            get: {
              queryOptions: settingsOptions,
            },
          },
        },
      },
    },
  },
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: useDocumentTitleMock,
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
  enabled: true,
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

const metadataField = (overrides: Partial<DocumentMetadataField> = {}): DocumentMetadataField => ({
  count: 1,
  createdAt: '2026-08-10T10:00:00Z',
  id: 'metadata-field-1',
  name: 'category',
  rowVersion: 0,
  type: 'string',
  updatedAt: '2026-08-10T10:00:00Z',
  ...overrides,
})

const chunk = (overrides: Partial<DocumentRevisionChunk>): DocumentRevisionChunk => {
  const text = overrides.text ?? 'Parent content'
  return {
    createdAt: '2026-07-21T10:00:00Z',
    documentId: 'document-1',
    documentRevision: 3,
    enabled: true,
    id: 'parent',
    kind: 'chunk',
    knowledgeSpaceId: 'space-1',
    ordinal: 1,
    parseElementIds: [],
    sectionPath: [text.split(/\r?\n/, 1)[0] ?? text],
    text,
    tokenCount: 10,
    userMetadata: {},
    ...overrides,
  }
}

const task = (overrides: Partial<DocumentProcessingTask>): DocumentProcessingTask => ({
  createdAt: '2026-07-21T10:00:00Z',
  documentId: 'document-1',
  documentRevision: 4,
  id: 'task-1',
  knowledgeSpaceId: 'space-1',
  operation: 'document_processing',
  progressPercent: 45,
  stage: 'nodes_generated',
  state: 'running',
  taskKind: 'document',
  updatedAt: '2026-07-21T10:01:00Z',
  ...overrides,
})

const backgroundTask = (overrides: Partial<BackgroundTask> = {}): BackgroundTask => ({
  createdAt: '2026-07-21T10:00:00Z',
  id: 'background-task-1',
  knowledgeSpaceId: 'space-1',
  operation: 'document_reindex',
  progressPercent: 100,
  stage: 'published',
  state: 'succeeded',
  taskKind: 'document_bulk',
  updatedAt: '2026-07-21T10:02:00Z',
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
      compilation_job: { id: 'compilation-job-1', stage: 'queued' },
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
    knowledgeSpacePermissionState.keys = ['knowledge_space_document_write']
    knowledgeSpacePermissionState.refetch.mockResolvedValue({
      permission_keys: ['knowledge_space_document_write'],
    })
    globalThis.sessionStorage.clear()
    permissionState.keys = ['dataset.acl.edit']
    documentQuery.data = logicalDocument()
    documentQuery.error = null
    documentQuery.isPending = false
    knowledgeSpaceQuery.data = {
      control_space_id: 'space-1',
      technical_summary: { name: 'Support knowledge' },
    }
    knowledgeSpaceQuery.error = null
    knowledgeSpaceQuery.isPending = false
    submittedJobQuery.data = undefined
    submittedJobQuery.error = null
    submittedJobQuery.isPending = false
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
    outlineQuery.data = undefined
    outlineQuery.error = null
    outlineQuery.isPending = false
    multimodalQuery.data = undefined
    multimodalQuery.error = null
    multimodalQuery.isPending = false
    multimodalAssetGet.mockImplementation(
      async () => new Response(new Blob(['image-bytes'], { type: 'image/png' })),
    )
    tasksQuery.data = { pages: [{ items: [] }] }
    tasksQuery.error = null
    tasksQuery.hasNextPage = false
    tasksQuery.isFetchNextPageError = false
    tasksQuery.isFetchingNextPage = false
    tasksQuery.isPending = false
    metadataFieldsQuery.data = []
    metadataFieldsQuery.error = null
    metadataFieldsQuery.isFetching = false
    metadataFieldsQuery.isPending = false
    metadataFieldsQuery.refetch.mockResolvedValue({ data: [], error: null })
    permissionState.refresh.mockResolvedValue({
      data: { dataset: { default_permission_keys: ['dataset.acl.edit'] } },
      error: null,
    })
    settingsState.configurationState = 'active'
    settingsState.refetch.mockImplementation(async () => ({
      data: {
        active_profile_available: settingsState.configurationState === 'active',
        active_profile_revisions:
          settingsState.configurationState === 'active' ? { embedding: 1, retrieval: 1 } : {},
        capabilities: {
          deep: settingsState.configurationState === 'active',
          index: settingsState.configurationState === 'active',
          ingest: settingsState.configurationState === 'active',
          query: settingsState.configurationState === 'active',
          research: settingsState.configurationState === 'active',
          source_sync: settingsState.configurationState === 'active',
        },
        configuration_state: settingsState.configurationState,
        embedding: null,
        issues: [],
        retrieval: null,
        revision: 1,
      },
      isError: false,
    }))
    reindexMutation.mutateAsync.mockResolvedValue(queuedReindexResult())
    cancelMutation.mutateAsync.mockResolvedValue(taskApiResponse(task({ state: 'canceled' })))
    patchDocumentMetadata.mockImplementation(async () =>
      logicalDocumentApiResponse(logicalDocument({ rowVersion: 3 })),
    )
    createMetadataField.mockResolvedValue({
      count: 0,
      created_at: '2026-08-10T10:00:00Z',
      id: 'metadata-field-1',
      name: 'category',
      row_version: 0,
      type: 'string',
      updated_at: '2026-08-10T10:00:00Z',
    })
    listLogicalDocuments.mockResolvedValue({
      data: [logicalDocumentApiResponse(logicalDocument())],
      next_cursor: null,
    })
    queryClient.invalidateQueries.mockResolvedValue(undefined)
  })

  afterEach(() => {
    globalThis.sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it('uses the document and knowledge names in the document title', () => {
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(useDocumentTitleMock).toHaveBeenLastCalledWith('sso-enterprise.pdf · Support knowledge')
  })

  it('loads the document, revisions, chunks, and task status through generated contracts', async () => {
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(documentOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          params: { control_space_id: 'space-1', document_id: 'document-1' },
        },
        retry: expect.any(Function),
      }),
    )
    expect(infiniteInput(revisionsOptions.mock.lastCall?.[0])(null)).toEqual({
      params: { control_space_id: 'space-1', document_id: 'document-1' },
      query: {},
    })
    expect(infiniteInput(chunksOptions.mock.lastCall?.[0])('next')).toEqual({
      params: {
        control_space_id: 'space-1',
        document_id: 'document-1',
        revision: 3,
      },
      query: { cursor: 'next' },
    })
    expect(outlineOptions).toHaveBeenCalledWith({
      context: { silent: true },
      input: {
        params: { control_space_id: 'space-1', document_id: 'asset-1' },
      },
      retry: false,
    })
    expect(multimodalOptions).toHaveBeenCalledWith({
      context: { silent: true },
      input: {
        params: { control_space_id: 'space-1', document_id: 'asset-1' },
      },
      retry: false,
    })
    expect(metadataFieldsOptions).toHaveBeenCalledWith({
      context: { silent: true },
      input: {
        params: { control_space_id: 'space-1' },
        query: { limit: 100 },
      },
      retry: false,
    })
    expect(infiniteInput(documentTasksOptions.mock.lastCall?.[0])(null)).toEqual({
      params: { control_space_id: 'space-1' },
      query: { limit: 100 },
    })
    expect(
      screen.queryByRole('button', { name: /dataset\.newKnowledge\.documentActions/ }),
    ).not.toBeInTheDocument()
  })

  it('disables re-indexing for an unavailable document', () => {
    documentQuery.data = logicalDocument({ enabled: false })

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }),
    ).toBeDisabled()
    expect(reindexMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('does not construct a chunks request while the document is loading', () => {
    documentQuery.data = undefined
    documentQuery.isPending = true

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(chunksOptions).not.toHaveBeenCalled()
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

  it('renders markdown links in document chunks instead of exposing source syntax', async () => {
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({
              text: 'Example Domain\n[Learn more](https://www.iana.org/domains/example)',
            }),
          ],
        },
      ],
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(await screen.findByRole('link', { name: 'Learn more' })).toHaveAttribute(
      'href',
      'https://www.iana.org/domains/example',
    )
    expect(screen.queryByText(/\[Learn more\]\(/)).not.toBeInTheDocument()
  })

  it('uses structured chapter paths and keeps the first source line in the chunk body', () => {
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({
              sectionPath: ['Invoices', 'Tax breakdown'],
              text: 'This first line is source content, not a title.\nThe tax total is 6.55.',
            }),
          ],
        },
      ],
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const tree = screen.getByRole('tree')
    expect(within(tree).getByRole('treeitem', { name: 'Invoices' })).toBeInTheDocument()
    expect(within(tree).getByRole('treeitem', { name: 'Tax breakdown' })).toBeInTheDocument()
    expect(within(tree).queryByRole('treeitem', { name: /This first line/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Tax breakdown' })).toBeInTheDocument()
    expect(screen.getByRole('article')).toHaveTextContent(
      'This first line is source content, not a title.',
    )
    expect(screen.getByRole('article').querySelector('br')).toBeNull()
  })

  it('renders collapsible outline summaries and semantic heading levels', async () => {
    const user = userEvent.setup()
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({
              id: 'html-title',
              ordinal: 0,
              sectionPath: [],
              text: 'Guide — Operating safely',
            }),
            chunk({
              id: 'guide',
              ordinal: 1,
              sectionPath: ['Guide Operating safely'],
              text: 'Guide Operating safely\n\nGuide body',
            }),
            chunk({
              id: 'setup',
              ordinal: 2,
              sectionPath: ['Guide Operating safely', 'Setup'],
              text: 'Setup\n\nSetup body',
            }),
          ],
        },
      ],
    }
    outlineQuery.data = {
      artifact_hash: 'artifact-hash',
      created_at: '2026-08-07T10:00:00Z',
      document_asset_id: 'asset-1',
      id: 'outline-1',
      knowledge_space_id: 'space-1',
      metadata: {},
      nodes: [
        {
          children: [],
          id: 'legacy-title-root',
          level: 1,
          metadata: {},
          section_path: ['Guide — Operating safely'],
          summary: 'Legacy title summary.',
          title: 'Guide — Operating safely',
          toc_source: 'parser-heading',
        },
        {
          children: [
            {
              children: [],
              id: 'setup-node',
              level: 2,
              metadata: {},
              section_path: ['Guide Operating safely', 'Setup'],
              summary: 'Generated setup summary.',
              title: 'Setup',
              toc_source: 'parser-heading',
            },
          ],
          id: 'guide-node',
          level: 1,
          metadata: {},
          section_path: ['Guide Operating safely'],
          summary: 'Generated guide summary.',
          title: 'Guide Operating safely',
          toc_source: 'parser-heading',
        },
      ],
      outline_version: 'document-outline-v1',
      parse_artifact_id: 'parse-artifact-1',
      version: 1,
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const tree = screen.getByRole('tree')
    expect(within(tree).getAllByRole('treeitem', { name: 'Guide Operating safely' })).toHaveLength(
      1,
    )
    expect(within(tree).getByRole('treeitem', { name: 'Setup' })).toBeInTheDocument()
    expect(within(tree).queryByRole('treeitem', { name: '#0' })).not.toBeInTheDocument()
    expect(screen.getByText('Generated guide summary.')).toBeInTheDocument()
    expect(screen.getByText('Generated setup summary.')).toBeInTheDocument()
    const summaryButtons = screen.getAllByRole('button', {
      name: 'dataset.newKnowledge.documentSummary',
    })
    expect(summaryButtons[0]).toHaveAttribute('aria-expanded', 'true')
    await user.click(summaryButtons[0]!)
    expect(summaryButtons[0]).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Generated guide summary.')).not.toBeInTheDocument()
    expect(screen.getByText('Generated setup summary.')).toBeInTheDocument()
    expect(screen.getByText('Guide body')).toBeInTheDocument()
    expect(screen.getByText('Setup body')).toBeInTheDocument()
    const article = screen.getByRole('article')
    expect(
      within(article).getByRole('heading', { level: 2, name: 'Guide Operating safely' }),
    ).toBeInTheDocument()
    expect(within(article).getByRole('heading', { level: 3, name: 'Setup' })).toBeInTheDocument()
  })

  it('renders structural headings once before the chunks in their sections', () => {
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({
              id: 'chapter-heading',
              ordinal: 0,
              sectionPath: ['Detailed features'],
              text: 'Detailed features',
            }),
            chunk({
              id: 'section-heading',
              ordinal: 1,
              sectionPath: ['Detailed features', 'Document upload'],
              text: 'Document upload',
            }),
            chunk({
              id: 'section-body',
              ordinal: 2,
              sectionPath: ['Detailed features', 'Document upload'],
              text: 'Document upload\n\nFiles are parsed in the background.',
            }),
          ],
        },
      ],
    }
    outlineQuery.data = {
      artifact_hash: 'artifact-hash',
      created_at: '2026-08-07T10:00:00Z',
      document_asset_id: 'asset-1',
      id: 'outline-1',
      knowledge_space_id: 'space-1',
      metadata: {},
      nodes: [
        {
          children: [
            {
              children: [],
              id: 'document-upload',
              level: 2,
              metadata: {},
              section_path: ['Detailed features', 'Document upload'],
              title: 'Document upload',
              toc_source: 'parser-heading',
            },
          ],
          id: 'detailed-features',
          level: 1,
          metadata: {},
          section_path: ['Detailed features'],
          title: 'Detailed features',
          toc_source: 'parser-heading',
        },
      ],
      outline_version: 'document-outline-v1',
      parse_artifact_id: 'parse-artifact-1',
      version: 1,
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const article = screen.getByRole('article')
    expect(
      within(article).getAllByRole('heading', { level: 2, name: 'Detailed features' }),
    ).toHaveLength(1)
    expect(
      within(article).getAllByRole('heading', { level: 3, name: 'Document upload' }),
    ).toHaveLength(1)
    expect(within(article).getByText('Files are parsed in the background.')).toBeInTheDocument()
    expect(within(article).getByText('C-1')).toBeInTheDocument()
    const chunkCountRow = screen.getByText('dataset.newKnowledge.chunkCount').closest('div')
    expect(chunkCountRow).not.toBeNull()
    expect(within(chunkCountRow!).getByText('1')).toBeInTheDocument()
  })

  it('loads protected document images next to the chunk selected by canonical offsets', async () => {
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:asset')
      .mockReturnValueOnce('blob:thumbnail')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({
              endOffset: 80,
              id: 'image-section',
              ordinal: 1,
              sectionPath: ['Images'],
              startOffset: 20,
              text: 'Images\n\nThe image caption follows.',
            }),
          ],
        },
      ],
    }
    multimodalQuery.data = {
      artifact_hash: 'artifact-hash',
      created_at: '2026-08-07T10:00:00Z',
      document_asset_id: 'asset-1',
      id: 'manifest-1',
      items: [
        {
          asset_url: '/console/api/knowledge-fs/image-1',
          caption: 'Screenshot of the source configuration',
          id: 'image-1',
          modality: 'image',
          parse_element_id: 'parse-image-1',
          section_path: ['Images'],
          start_offset: 20,
          thumbnail_url: '/console/api/knowledge-fs/image-1?variant=thumbnail',
        },
      ],
      manifest_version: 'document-multimodal-manifest-v1',
      version: 1,
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const image = await screen.findByRole('img', {
      name: 'Screenshot of the source configuration',
    })
    expect(image).toHaveAttribute('src', 'blob:asset')
    expect(multimodalAssetGet).toHaveBeenNthCalledWith(
      1,
      '/knowledge-fs/image-1',
      { signal: expect.any(AbortSignal) },
      { needAllResponseContent: true, silent: true },
    )
    fireEvent.error(image)
    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: 'Screenshot of the source configuration' }),
      ).toHaveAttribute('src', 'blob:thumbnail'),
    )
    expect(multimodalAssetGet).toHaveBeenNthCalledWith(
      2,
      '/knowledge-fs/image-1?variant=thumbnail',
      { signal: expect.any(AbortSignal) },
      { needAllResponseContent: true, silent: true },
    )
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:asset')
    expect(createObjectUrl).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Screenshot of the source configuration')).toBeInTheDocument()
    expect(screen.getByText('The image caption follows.')).toBeInTheDocument()
  })

  it('renders spreadsheet images beside their records without duplicate image index chunks', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:spreadsheet-image')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({
              endOffset: 80,
              id: 'spreadsheet-record',
              kind: 'table',
              ordinal: 0,
              sectionPath: [],
              startOffset: 0,
              text: 'Issue: Copy button is unavailable',
              parseElementIds: ['parse-table-1'],
            }),
            chunk({
              endOffset: 100,
              id: 'image-index-node',
              kind: 'image',
              ordinal: 1,
              sectionPath: [],
              startOffset: 81,
              text: 'image1.jpeg',
              parseElementIds: ['parse-image-1'],
            }),
          ],
        },
      ],
    }
    multimodalQuery.data = {
      artifact_hash: 'artifact-hash',
      created_at: '2026-08-07T10:00:00Z',
      document_asset_id: 'asset-1',
      id: 'manifest-1',
      items: [
        {
          asset_url: '/console/api/knowledge-fs/spreadsheet-image-1',
          caption: 'Screenshot for the copy button issue',
          id: 'spreadsheet-image-1',
          modality: 'image',
          parse_element_id: 'parse-image-1',
          section_path: [],
          start_offset: 0,
        },
      ],
      manifest_version: 'document-multimodal-manifest-v1',
      version: 1,
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getAllByText('Issue: Copy button is unavailable')).not.toHaveLength(0)
    expect(
      await screen.findByRole('img', { name: 'Screenshot for the copy button issue' }),
    ).toHaveAttribute('src', 'blob:spreadsheet-image')
    expect(screen.queryByText('image1.jpeg')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'dataset.newKnowledge.documentImages' }),
    ).not.toBeInTheDocument()
    const chunkCountRow = screen.getByText('dataset.newKnowledge.chunkCount').closest('div')
    expect(chunkCountRow).not.toBeNull()
    await waitFor(() => expect(within(chunkCountRow!).getByText('2')).toBeInTheDocument())
  })

  it('shows images without location metadata after the document chunks', () => {
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({
              id: 'chapter',
              ordinal: 1,
              sectionPath: ['Chapter'],
              text: 'Chapter\n\nChapter body',
            }),
          ],
        },
      ],
    }
    multimodalQuery.data = {
      artifact_hash: 'artifact-hash',
      created_at: '2026-08-07T10:00:00Z',
      document_asset_id: 'asset-1',
      id: 'manifest-1',
      items: [
        {
          asset_url: '/image-without-location',
          caption: 'Screenshot without location metadata',
          id: 'image-without-location',
          modality: 'image',
          parse_element_id: 'parse-image-without-location',
          section_path: [],
        },
      ],
      manifest_version: 'document-multimodal-manifest-v1',
      version: 1,
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const article = screen.getByRole('article')
    const chunkHeading = within(article).getByRole('heading', { level: 2, name: 'Chapter' })
    const image = screen.getByRole('img', { name: 'Screenshot without location metadata' })
    expect(chunkHeading.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('labels flat document chunks by their visible order', () => {
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({ id: 'first', ordinal: 0, sectionPath: [], text: 'First chunk' }),
            chunk({ id: 'second', ordinal: 1, sectionPath: [], text: 'Second chunk' }),
          ],
        },
      ],
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const article = screen.getByRole('article')
    expect(within(article).getByText('C-1')).toBeInTheDocument()
    expect(within(article).getByText('C-2')).toBeInTheDocument()
  })

  it('restarts child chunk labels for each parent chunk', () => {
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({ id: 'parent-a', ordinal: 0, sectionPath: [], text: 'Parent A' }),
            chunk({
              id: 'child-a-1',
              ordinal: 1,
              parentChunkId: 'parent-a',
              sectionPath: [],
              text: 'Child A1',
            }),
            chunk({
              id: 'child-a-2',
              ordinal: 2,
              parentChunkId: 'parent-a',
              sectionPath: [],
              text: 'Child A2',
            }),
            chunk({ id: 'parent-b', ordinal: 3, sectionPath: [], text: 'Parent B' }),
            chunk({
              id: 'child-b-1',
              ordinal: 4,
              parentChunkId: 'parent-b',
              sectionPath: [],
              text: 'Child B1',
            }),
          ],
        },
      ],
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const article = screen.getByRole('article')
    expect(within(article).getAllByText('C-1')).toHaveLength(2)
    expect(within(article).getByText('C-2')).toBeInTheDocument()
    expect(within(article).queryByText('C-3')).not.toBeInTheDocument()
  })

  it('expands the parent-child tree without mixing selected chunk metadata into document facts', async () => {
    const user = userEvent.setup()
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({
              id: 'parent',
              sectionPath: ['Setup requirements'],
              text: 'Parent source content',
            }),
            chunk({
              id: 'child',
              ordinal: 2,
              parentChunkId: 'parent',
              sectionPath: ['Setup requirements', 'Workspace contract details'],
              text: 'Workspace source content',
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

    const selectedChunkHeading = screen.getByRole('heading', {
      name: 'Workspace contract details',
    })
    expect(selectedChunkHeading).toBeInTheDocument()
    const selectedChunkSection = selectedChunkHeading.closest('section')
    expect(selectedChunkSection).not.toBeNull()
    await user.click(
      within(selectedChunkSection!).getByRole('button', { name: 'common.operation.copy' }),
    )
    expect(copy).toHaveBeenCalledWith('Workspace source content')
    expect(toastState.success).toHaveBeenCalledWith('common.actionMsg.copySuccessfully')
    expect(screen.getByRole('heading', { name: 'dataset.metadata.metadata' })).toBeInTheDocument()
    expect(screen.getByText('common.operation.added')).toBeInTheDocument()
    expect(
      screen.getByText(
        'dataset.newKnowledge.parentChildChunkCount:{"childCount":"1","parentCount":"1"}',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.characterCount')).not.toBeInTheDocument()
    expect(screen.queryByText('section')).not.toBeInTheDocument()
    expect(screen.queryByText('sourcePage')).not.toBeInTheDocument()
    const startLabeling = screen.getByRole('button', {
      name: 'dataset.metadata.documentMetadata.startLabeling',
    })
    expect(startLabeling).toBeEnabled()
    await user.click(startLabeling)
    expect(
      await screen.findByRole('button', { name: 'dataset.metadata.addMetadata' }),
    ).toBeInTheDocument()
    expect(toastState.info).not.toHaveBeenCalled()
    expect(screen.getByTestId('chunk-content-scroll')).toBe(previousContentScroller)
    expect(screen.getByRole('heading', { name: 'Setup requirements' })).toBeInTheDocument()
  })

  it('updates document metadata through the KnowledgeFS metadata endpoint', async () => {
    const user = userEvent.setup()
    documentQuery.data = logicalDocument({
      knowledgeSpaceId: 'remote-space-1',
      userMetadata: { category: 'support', sourceName: 'Notion support SOP' },
    })

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getByText('category')).toBeInTheDocument()
    expect(screen.queryByText('sourceName')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const valueInput = await screen.findByRole('textbox', { name: 'category' })
    await user.clear(valueInput)
    await user.type(valueInput, 'security')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(patchDocumentMetadata).toHaveBeenCalledWith({
      body: { expectedRowVersion: 2, patch: { category: 'security' } },
      params: { control_space_id: 'space-1', document_id: 'document-1' },
    })
    await waitFor(() => expect(toastState.success).toHaveBeenCalledWith('common.api.actionSuccess'))
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['knowledge-fs', 'document'],
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['knowledge-fs', 'documents'],
    })
  })

  it('preserves a document metadata draft when the active revision changes', async () => {
    const user = userEvent.setup()
    documentQuery.data = logicalDocument({
      userMetadata: { category: 'support', sourceName: 'Notion support SOP' },
    })
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const valueInput = await screen.findByRole('textbox', { name: 'category' })
    await user.clear(valueInput)
    await user.type(valueInput, 'draft value')

    const nextRevision = activeRevision({
      documentAssetId: 'asset-2',
      documentAssetVersion: 2,
      revision: 4,
    })
    documentQuery.data = logicalDocument({
      active: nextRevision,
      activeRevision: 4,
      userMetadata: { category: 'support', sourceName: 'Notion support SOP' },
    })
    revisionsQuery.data = { pages: [{ items: [nextRevision] }] }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('textbox', { name: 'category' })).toHaveValue('draft value')
    expect(infiniteInput(chunksOptions.mock.lastCall?.[0])(null)).toEqual({
      params: {
        control_space_id: 'space-1',
        document_id: 'document-1',
        revision: 4,
      },
      query: {},
    })
  })

  it('lets users choose the type of a new document metadata field', async () => {
    const user = userEvent.setup()
    metadataFieldsQuery.data = [metadataField({ name: 'priority', type: 'number' })]

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.metadata.documentMetadata.startLabeling',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(await screen.findByRole('option', { name: /priority/ }))
    const valueInput = screen.getByRole('spinbutton', { name: 'priority' })
    await user.clear(valueInput)
    await user.type(valueInput, '42')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(patchDocumentMetadata).toHaveBeenCalledWith({
      body: { expectedRowVersion: 2, patch: { priority: 42 } },
      params: { control_space_id: 'space-1', document_id: 'document-1' },
    })
  })

  it('keeps selected number and time metadata empty until the user enters a value', async () => {
    const user = userEvent.setup()
    metadataFieldsQuery.data = [
      metadataField({ name: 'priority', type: 'number' }),
      metadataField({ id: 'metadata-field-2', name: 'reviewed_at', type: 'time' }),
    ]

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.metadata.documentMetadata.startLabeling',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(await screen.findByRole('option', { name: /priority/ }))
    expect(screen.getByLabelText('priority')).toHaveValue(null)

    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(await screen.findByRole('option', { name: /reviewed_at/ }))
    expect(screen.getByLabelText('reviewed_at')).toHaveValue('')
  })

  it('preserves a time field editor when this document has an empty value', async () => {
    const user = userEvent.setup()
    documentQuery.data = logicalDocument({ userMetadata: { reviewed_at: '' } })
    metadataFieldsQuery.data = [metadataField({ name: 'reviewed_at', type: 'time' })]

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))

    expect(screen.getByLabelText('reviewed_at')).toHaveAttribute('type', 'datetime-local')
  })

  it('enters metadata editing immediately while field types are still resolving', async () => {
    const user = userEvent.setup()
    documentQuery.data = logicalDocument({ userMetadata: { category: '' } })
    metadataFieldsQuery.data = undefined
    metadataFieldsQuery.isPending = true

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))

    expect(await screen.findByLabelText('category')).toBeInTheDocument()
    expect(metadataFieldsQuery.refetch).not.toHaveBeenCalled()
  })

  it('keeps metadata editing usable and exposes retry when the field catalog fails', async () => {
    const user = userEvent.setup()
    documentQuery.data = logicalDocument({ userMetadata: { category: 'support' } })
    metadataFieldsQuery.data = undefined
    metadataFieldsQuery.error = new Error('metadata catalog unavailable')

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const category = screen.getByLabelText('category')
    expect(category).toBeEnabled()
    await user.clear(category)
    await user.type(category, 'product')

    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    expect(
      screen.getByText('dataset.newKnowledge.documentLoadErrorDescription'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(metadataFieldsQuery.refetch).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(patchDocumentMetadata).toHaveBeenCalledWith({
      body: { expectedRowVersion: 2, patch: { category: 'product' } },
      params: { control_space_id: 'space-1', document_id: 'document-1' },
    })
  })

  it('converts UTC metadata timestamps to local datetime input values', async () => {
    const user = userEvent.setup()
    const getTimezoneOffset = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-480)
    documentQuery.data = logicalDocument({
      userMetadata: { reviewed_at: '2026-08-04T10:00:00.000Z' },
    })
    metadataFieldsQuery.data = [metadataField({ name: 'reviewed_at', type: 'time' })]

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))

    expect(screen.getByLabelText('reviewed_at')).toHaveValue('2026-08-04T18:00')
    getTimezoneOffset.mockRestore()
  })

  it('creates a reusable field and initializes only the current document', async () => {
    const user = userEvent.setup()

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.metadata.documentMetadata.startLabeling',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
    )
    await user.click(screen.getByRole('button', { name: 'number' }))
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }),
      'priority',
    )
    await user.keyboard('{Enter}')

    expect(createMetadataField).toHaveBeenCalledWith({
      body: { name: 'priority', type: 'number' },
      params: { control_space_id: 'space-1' },
    })
    expect(patchDocumentMetadata).toHaveBeenCalledWith({
      body: { expectedRowVersion: 2, patch: { priority: 0 } },
      params: { control_space_id: 'space-1', document_id: 'document-1' },
    })
    expect(patchDocumentMetadata).toHaveBeenCalledOnce()
    expect(listLogicalDocuments).not.toHaveBeenCalled()
  })

  it('keeps a newly created field in the current document draft', async () => {
    const user = userEvent.setup()
    const currentDocument = logicalDocument()
    documentQuery.data = currentDocument
    metadataFieldsQuery.data = []
    patchDocumentMetadata.mockImplementation(
      async ({ body }: { body: { patch: Record<string, unknown> } }) => {
        const updated = logicalDocument({
          ...currentDocument,
          rowVersion: currentDocument.rowVersion + 1,
          userMetadata: { ...currentDocument.userMetadata, ...body.patch },
        })
        documentQuery.data = updated
        return logicalDocumentApiResponse(updated)
      },
    )

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.metadata.documentMetadata.startLabeling',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
    )
    await user.click(screen.getByRole('button', { name: 'number' }))
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }),
      'priority',
    )
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByLabelText('priority')).toHaveValue(0))

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(patchDocumentMetadata).toHaveBeenCalledOnce()
    expect(patchDocumentMetadata).not.toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ patch: { priority: null } }) }),
    )
  })

  it('keeps metadata creation unavailable while the field catalog is loading', async () => {
    const user = userEvent.setup()
    metadataFieldsQuery.isPending = true

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.metadata.documentMetadata.startLabeling',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))

    expect(
      screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
    ).toBeDisabled()
  })

  it('keeps the metadata create form open when creation fails', async () => {
    const user = userEvent.setup()
    patchDocumentMetadata.mockRejectedValueOnce(new Error('metadata update failed'))

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.metadata.documentMetadata.startLabeling',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
    )
    const nameInput = screen.getByRole('textbox', {
      name: 'dataset.metadata.createMetadata.name',
    })
    const createDialog = nameInput.closest<HTMLElement>('[role="dialog"]')!
    await user.type(nameInput, 'category')
    await user.click(within(createDialog).getByRole('button', { name: 'common.operation.save' }))

    expect(nameInput).toHaveValue('category')
    expect(nameInput).toBeInTheDocument()
    await waitFor(() =>
      expect(toastState.error).toHaveBeenCalledWith('dataset.newKnowledge.settings.saveFailed'),
    )
  })

  it('validates a new metadata name before submitting it', async () => {
    const user = userEvent.setup()
    metadataFieldsQuery.data = [metadataField({ name: 'existing_field' })]

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.metadata.documentMetadata.startLabeling',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
    )
    const dialog = screen.getByRole('dialog')
    const nameInput = within(dialog).getByRole('textbox', {
      name: 'dataset.metadata.createMetadata.name',
    })
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    expect(save).toBeDisabled()

    await user.type(nameInput, 'Priority')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'dataset.metadata.checkName.invalid',
    )
    expect(save).toBeDisabled()

    await user.clear(nameInput)
    await user.type(nameInput, 'existing_field')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'dataset.metadata.checkName.duplicate',
    )
    expect(save).toBeDisabled()

    await user.clear(nameInput)
    await user.type(nameInput, 'a'.repeat(256))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'dataset.metadata.checkName.tooLong',
    )
    expect(save).toBeDisabled()

    await user.clear(nameInput)
    await user.type(nameInput, 'sourceName')
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'dataset.metadata.checkName.invalid',
    )
    expect(save).toBeDisabled()

    await user.clear(nameInput)
    await user.type(nameInput, 'priority_1')
    expect(nameInput).not.toHaveAttribute('aria-invalid')
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(save).toBeEnabled()
  })

  it('opens the New RAG metadata manager from the document picker', async () => {
    const user = userEvent.setup()

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.metadata.documentMetadata.startLabeling',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.manageAction' }),
    )

    expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/documents?metadata=1')
  })

  it('supports tree keyboard navigation, collapse, and selection', async () => {
    const user = userEvent.setup()
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({ id: 'parent', sectionPath: ['Parent node'], text: 'Parent content' }),
            chunk({
              id: 'child',
              ordinal: 2,
              parentChunkId: 'parent',
              sectionPath: ['Parent node', 'Child node'],
              text: 'Child content',
            }),
            chunk({ id: 'second', ordinal: 3, sectionPath: ['Second root'] }),
            chunk({
              id: 'second-child',
              ordinal: 4,
              parentChunkId: 'second',
              sectionPath: ['Second root', 'Hidden child'],
            }),
          ],
        },
      ],
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const tree = screen.getByRole('tree')
    const parent = screen.getByRole('treeitem', { name: /Parent node/ })
    const child = screen.getByRole('treeitem', { name: /Child node/ })
    const second = screen.getByRole('treeitem', { name: /Second root/ })
    expect(second).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: /Hidden child/ })).not.toBeInTheDocument()
    tree.focus()
    fireEvent.keyDown(tree, { key: 'ArrowRight' })
    expect(tree).toHaveAttribute('aria-activedescendant', child.id)
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(tree).toHaveAttribute('aria-activedescendant', second.id)
    fireEvent.keyDown(tree, { key: 'Home' })
    fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    expect(parent).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{Enter}')
    expect(parent).toHaveAttribute('aria-selected', 'true')
    expect(tree).toHaveFocus()
  })

  it('supports mouse expansion and reports the active re-index state', async () => {
    const user = userEvent.setup()
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({ id: 'parent', sectionPath: ['Parent node'], text: 'Parent content' }),
            chunk({
              id: 'child',
              ordinal: 2,
              parentChunkId: 'parent',
              sectionPath: ['Parent node', 'Child node'],
              text: 'Child content',
            }),
          ],
        },
      ],
    }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({ progressPercent: 45 }),
            task({
              documentId: 'another-document',
              documentRevision: 1,
              id: 'another-task',
              state: 'succeeded',
            }),
            backgroundTask({ id: 'bulk-reindex-task' }),
          ],
        },
      ],
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const parent = screen.getByRole('treeitem', { name: /Parent node/ })
    expect(parent).toHaveAttribute('aria-expanded', 'true')
    await user.click(parent)
    expect(parent).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: /Child node/ })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(
      'dataset.newKnowledge.documentReindexStatus',
    )
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.cancelDocumentReindex' }),
    ).not.toHaveAttribute('data-disabled')
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.viewTask' }))
    const taskDrawer = screen.getByRole('dialog', {
      name: 'dataset.newKnowledge.backgroundTasks',
    })
    expect(within(taskDrawer).getAllByText(/dataset\.newKnowledge\.addDocument/)).toHaveLength(2)
    expect(
      within(taskDrawer).getByText('dataset.newKnowledge.reindexDocuments · 1'),
    ).toBeInTheDocument()
  })

  it('loads task document titles only while the task drawer is open', async () => {
    const user = userEvent.setup()
    tasksQuery.data = { pages: [{ items: [task({ state: 'running' })] }] }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(documentsOptions.mock.lastCall?.[0]).toEqual(expect.objectContaining({ enabled: false }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.viewTask' }))
    expect(documentsOptions.mock.lastCall?.[0]).toEqual(expect.objectContaining({ enabled: true }))
  })

  it('cancels the active re-index task from the document header', async () => {
    const user = userEvent.setup()
    tasksQuery.data = { pages: [{ items: [task({ state: 'running' })] }] }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.cancelDocumentReindex' }),
    )

    expect(cancelMutation.mutateAsync).toHaveBeenCalledWith({
      params: {
        control_space_id: 'space-1',
        task_id: 'task-1',
        task_kind: 'document',
      },
    })
    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4))
  })

  it('cancels a newly accepted re-index before task discovery catches up', async () => {
    const user = userEvent.setup()

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }))
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.cancelDocumentReindex',
      }),
    )

    expect(cancelMutation.mutateAsync).toHaveBeenCalledWith({
      params: {
        control_space_id: 'space-1',
        task_id: 'compilation-job-1',
        task_kind: 'document',
      },
    })
  })

  it('restores an accepted re-index after the document page remounts', async () => {
    const user = userEvent.setup()
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }))
    expect(
      await screen.findByRole('button', {
        name: 'dataset.newKnowledge.cancelDocumentReindex',
      }),
    ).toBeInTheDocument()

    rendered.unmount()
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.cancelDocumentReindex' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'dataset.newKnowledge.documentReindexStatus',
    )
  })

  it('reconciles a restored re-index through its exact compilation job', async () => {
    globalThis.sessionStorage.setItem(
      'dify-new-rag-reindex:space-1:document-1',
      JSON.stringify({
        baselineRevision: 3,
        taskId: 'compilation-job-1',
      }),
    )
    submittedJobQuery.data = {
      id: 'compilation-job-1',
      run_state: 'running',
      stage: 'parsed',
      updated_at: 1,
    }

    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    expect(submittedJobOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: {
          params: {
            control_space_id: 'space-1',
            job_id: 'compilation-job-1',
          },
        },
      }),
    )
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.cancelDocumentReindex' }),
    ).toBeInTheDocument()

    submittedJobQuery.data = {
      id: 'compilation-job-1',
      run_state: 'succeeded',
      stage: 'published',
      updated_at: 2,
    }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }),
      ).toBeInTheDocument(),
    )
    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4))
    expect(globalThis.sessionStorage.getItem('dify-new-rag-reindex:space-1:document-1')).toBeNull()
  })

  it('clears a restored re-index when its authoritative job endpoint returns missing', async () => {
    globalThis.sessionStorage.setItem(
      'dify-new-rag-reindex:space-1:document-1',
      JSON.stringify({
        baselineRevision: 3,
        taskId: 'missing-compilation-job',
      }),
    )
    submittedJobQuery.error = { status: 404 }
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'completed-task', state: 'succeeded' })] }],
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText('dataset.newKnowledge.documentReindexStatus')).not.toBeInTheDocument()
    expect(globalThis.sessionStorage.getItem('dify-new-rag-reindex:space-1:document-1')).toBeNull()
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
    expect(chunksOptions).not.toHaveBeenCalled()
  })

  it('keeps cached chunks visible when a background refresh fails', async () => {
    const user = userEvent.setup()
    chunksQuery.data = { pages: [{ items: [chunk({ id: 'cached', text: 'Cached content' })] }] }
    chunksQuery.error = new Error('refresh failed')

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('treeitem', { name: 'Cached content' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cached content' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentChunksLoadError',
    )
    expect(screen.queryByText('dataset.newKnowledge.documentContentIncomplete')).toBeNull()
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'false')
    const indexInformation = screen
      .getByRole('heading', { name: 'dataset.newKnowledge.indexInformation' })
      .closest('section')
    expect(indexInformation).not.toBeNull()
    expect(within(indexInformation!).getAllByText('—')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(chunksQuery.refetch).toHaveBeenCalledOnce()
  })

  it('uses a revision from the URL without exposing revision controls', () => {
    revisionsQuery.data = {
      pages: [{ items: [activeRevision({ revision: 2, state: 'superseded' })] }],
    }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />, {
      searchParams: '?revision=2',
    })

    expect(
      screen.queryByRole('combobox', { name: 'dataset.newKnowledge.documentRevision' }),
    ).not.toBeInTheDocument()
    expect(infiniteInput(chunksOptions.mock.lastCall?.[0])(null)).toEqual({
      params: {
        control_space_id: 'space-1',
        document_id: 'document-1',
        revision: 2,
      },
      query: {},
    })
  })

  it('keeps document actions available when a URL revision is missing', () => {
    revisionsQuery.data = { pages: [{ items: [] }] }

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />, {
      searchParams: '?revision=2',
    })

    expect(screen.getByRole('heading', { level: 1, name: 'sso-enterprise.pdf' })).toBeVisible()
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'dataset.newKnowledge.documentNotFoundTitle',
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }),
    ).toBeEnabled()
  })

  it('resolves an exact URL revision from later revision pages before rendering content', async () => {
    revisionsQuery.data = {
      pages: [{ items: [activeRevision({ revision: 3 })], nextCursor: 'older' }],
    }
    revisionsQuery.hasNextPage = true

    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
      { searchParams: '?revision=2' },
    )

    expect(screen.getByText('common.loading')).toBeInTheDocument()
    await waitFor(() => expect(revisionsQuery.fetchNextPage).toHaveBeenCalledOnce())
    expect(chunksOptions).not.toHaveBeenCalled()

    revisionsQuery.data = {
      pages: [
        { items: [activeRevision({ revision: 3 })], nextCursor: 'older' },
        { items: [activeRevision({ revision: 2, state: 'superseded' })] },
      ],
    }
    revisionsQuery.hasNextPage = false
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(infiniteInput(chunksOptions.mock.lastCall?.[0])(null)).toEqual({
        params: {
          control_space_id: 'space-1',
          document_id: 'document-1',
          revision: 2,
        },
        query: {},
      }),
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

  it('polls active work through the unified background-task contract', () => {
    tasksQuery.data = { pages: [{ items: [task({ state: 'running' })] }] }
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const taskOptions = documentTasksOptions.mock.lastCall?.[0] as unknown as {
      refetchInterval: (query: {
        state: {
          data?: {
            pages: Array<{
              data: Array<ReturnType<typeof taskApiResponse>>
              next_cursor: string | null
            }>
          }
        }
      }) => number | false
    }
    expect(
      taskOptions.refetchInterval({
        state: {
          data: {
            pages: [{ data: [taskApiResponse(task({ state: 'running' }))], next_cursor: null }],
          },
        },
      }),
    ).toBe(5000)
    expect(tasksQuery.refetch).not.toHaveBeenCalled()
  })

  it('refreshes the document and content when an active task becomes terminal', async () => {
    tasksQuery.data = { pages: [{ items: [task({ state: 'running' })] }] }
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    tasksQuery.data = { pages: [{ items: [task({ state: 'succeeded' })] }] }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4))
  })

  it('virtualizes long trees and bounds their accessible labels', () => {
    chunksQuery.data = {
      pages: [
        {
          items: Array.from({ length: 100 }, (_, index) =>
            chunk({
              id: `chunk-${index}`,
              ordinal: index + 1,
              sectionPath: [`${'x'.repeat(150)} ${index}`],
              text: `${'x'.repeat(150)}\nbody`,
            }),
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

  it('automatically loads every remaining chunk page without showing a loading notice', async () => {
    const intersectionCallbacks: IntersectionObserverCallback[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class MockIntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallbacks.push(callback)
        }

        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    chunksQuery.data = {
      pages: [{ items: [chunk({ id: 'first', text: 'First chunk' })], nextCursor: 'next' }],
    }
    chunksQuery.hasNextPage = true

    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    expect(chunksQuery.fetchNextPage).not.toHaveBeenCalled()
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'false')
    expect(screen.queryByText('dataset.newKnowledge.documentContentIncomplete')).toBeNull()
    expect(screen.getByRole('heading', { name: 'First chunk' }).closest('section')).toHaveClass(
      '[content-visibility:auto]',
    )
    expect(screen.queryByRole('button', { name: 'dataset.newKnowledge.loadMore' })).toBeNull()

    await waitFor(() => expect(intersectionCallbacks.length).toBeGreaterThan(0))
    const firstObserverCount = intersectionCallbacks.length
    act(() => {
      intersectionCallbacks.at(-1)?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    expect(chunksQuery.fetchNextPage).toHaveBeenCalledOnce()

    chunksQuery.isFetchingNextPage = true
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('dataset.newKnowledge.documentContentIncomplete')).toBeNull()

    chunksQuery.data = {
      pages: [
        { items: [chunk({ id: 'first', text: 'First chunk' })] },
        { items: [chunk({ id: 'second', ordinal: 2, text: 'Second chunk' })] },
      ],
    }
    chunksQuery.isFetchingNextPage = false
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(intersectionCallbacks.length).toBeGreaterThan(firstObserverCount))
    act(() => {
      intersectionCallbacks.at(-1)?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    expect(chunksQuery.fetchNextPage).toHaveBeenCalledTimes(2)

    chunksQuery.hasNextPage = false
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'false')
    expect(screen.queryByText('dataset.newKnowledge.documentContentIncomplete')).toBeNull()
  })

  it('loads and selects a chunk targeted by the document deep link', async () => {
    let targetMeasureCount = 0
    const getBoundingClientRect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        const contentScroll = document.querySelector<HTMLElement>(
          '[data-testid="chunk-content-scroll"]',
        )
        let top = 0
        if (this.id === 'document-chunk-target') {
          targetMeasureCount += 1
          const targetOffset = targetMeasureCount === 1 ? 400 : 600
          top = 100 + targetOffset - (contentScroll?.scrollTop ?? 0)
        } else if (this.getAttribute('data-testid') === 'chunk-content-scroll') top = 100
        return {
          bottom: top + 40,
          height: 40,
          left: 0,
          right: 100,
          top,
          width: 100,
          x: 0,
          y: top,
          toJSON: () => ({}),
        }
      })
    chunksQuery.data = {
      pages: [{ items: [chunk({ id: 'first', text: 'First chunk' })], nextCursor: 'next' }],
    }
    chunksQuery.hasNextPage = true

    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
      { searchParams: '?revision=3&chunk=target' },
    )
    const contentScroll = screen.getByTestId('chunk-content-scroll')
    Object.defineProperty(contentScroll, 'clientHeight', { configurable: true, value: 1000 })

    await waitFor(() => expect(chunksQuery.fetchNextPage).toHaveBeenCalledOnce())
    expect(screen.getByRole('treeitem', { name: 'First chunk' })).toHaveAttribute(
      'aria-selected',
      'false',
    )

    chunksQuery.data = {
      pages: [
        { items: [chunk({ id: 'first', text: 'First chunk' })] },
        { items: [chunk({ id: 'target', ordinal: 2, text: 'Target chunk' })] },
      ],
    }
    chunksQuery.hasNextPage = false
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('treeitem', { name: 'Target chunk' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await waitFor(() => expect(contentScroll.scrollTop).toBe(592))
    getBoundingClientRect.mockRestore()
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
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.viewTask' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.retryReindexDocument' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Parent content' })).toBeInTheDocument()
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
      params: { control_space_id: 'space-1' },
    })
    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalled())

    permissionState.keys = ['dataset.acl.readonly']
    knowledgeSpacePermissionState.keys = []
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const readonlyReindexButton = screen.getByRole('button', {
      name: 'dataset.newKnowledge.cancelDocumentReindex',
    })
    expect(readonlyReindexButton).toHaveAttribute('data-disabled')
    expect(readonlyReindexButton).toHaveAccessibleDescription(
      'dataset.newKnowledge.documentPermissionRestricted',
    )
    expect(screen.getByText('dataset.newKnowledge.documentPermissionRestricted')).toBeVisible()
  })

  it('prompts for model setup before re-indexing a document', async () => {
    const user = userEvent.setup()
    settingsState.configurationState = 'setup-required'
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }))

    expect(reindexMutation.mutateAsync).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', {
      name: 'dataset.newKnowledge.overview.attention.modelReadiness.title',
    })
    await user.click(
      within(dialog).getByRole('button', {
        name: 'common.modelProvider.selector.configure',
      }),
    )
    expect(routerMock.push).toHaveBeenCalledWith(
      '/datasets/new/space-1/settings?returnTo=%2Fdatasets%2Fnew%2Fspace-1%2Fdocuments%2Fdocument-1&capability=index',
    )
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
    const button = screen.getByRole('button', {
      name: 'dataset.newKnowledge.reindexDocument',
    })

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
    expect(screen.getByRole('status')).toHaveTextContent(
      'dataset.newKnowledge.documentReindexStatus',
    )
    finishInvalidation?.()
    await waitFor(() => expect(toastState.success).toHaveBeenCalled())
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveTextContent('dataset.newKnowledge.cancelDocumentReindex')
    expect(button).not.toHaveAttribute('data-disabled')
    expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
    expect(cancelMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('does not mistake an earlier failed revision for the newly submitted re-index', async () => {
    const user = userEvent.setup()
    tasksQuery.data = {
      pages: [{ items: [task({ documentRevision: 4, id: 'old-failed', state: 'failed' })] }],
    }
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const button = screen.getByRole('button', {
      name: 'dataset.newKnowledge.retryReindexDocument',
    })

    await user.click(button)
    await waitFor(() => expect(toastState.success).toHaveBeenCalled())
    expect(button).toHaveTextContent('dataset.newKnowledge.cancelDocumentReindex')
    expect(button).not.toHaveAttribute('data-disabled')
    expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
    expect(cancelMutation.mutateAsync).not.toHaveBeenCalled()

    const discoveryOptions = documentTasksOptions.mock.lastCall?.[0] as unknown as {
      refetchInterval: (query: {
        state: {
          data?: {
            pages: Array<{
              data: Array<ReturnType<typeof taskApiResponse>>
              next_cursor: string | null
            }>
          }
        }
      }) => number | false
    }
    expect(
      discoveryOptions.refetchInterval({
        state: {
          data: {
            pages: [
              {
                data: [
                  taskApiResponse(task({ documentRevision: 4, id: 'old-failed', state: 'failed' })),
                ],
                next_cursor: null,
              },
            ],
          },
        },
      }),
    ).toBe(2000)
    expect(
      discoveryOptions.refetchInterval({
        state: {
          data: {
            pages: [
              {
                data: [taskApiResponse(task({ documentRevision: 5 }))],
                next_cursor: null,
              },
            ],
          },
        },
      }),
    ).toBe(5000)
  })

  it('keeps the accepted re-index state while task discovery is delayed', async () => {
    vi.useFakeTimers()
    tasksQuery.data = {
      pages: [{ items: [task({ documentRevision: 4, id: 'old-failed', state: 'failed' })] }],
    }
    try {
      render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
      const reindexButton = screen.getByRole('button', {
        name: 'dataset.newKnowledge.retryReindexDocument',
      })
      await act(async () => {
        fireEvent.click(reindexButton)
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(() => vi.advanceTimersByTimeAsync(30000))

      expect(screen.getByRole('status')).toHaveTextContent(
        'dataset.newKnowledge.documentReindexStatus',
      )
      expect(reindexButton).toHaveTextContent('dataset.newKnowledge.cancelDocumentReindex')
      expect(reindexButton).not.toHaveAttribute('data-disabled')
      expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
      expect(
        screen.queryByText('dataset.newKnowledge.documentReindexConfirmationDelayed'),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'dataset.newKnowledge.retryReindexDocument' }),
      ).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses active-task polling after the unified task list observes the new task', async () => {
    const user = userEvent.setup()
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }))
    await waitFor(() => expect(toastState.success).toHaveBeenCalled())

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              documentRevision: 3,
              id: 'compilation-job-1',
              state: 'running',
            }),
          ],
        },
      ],
    }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const taskOptions = documentTasksOptions.mock.lastCall?.[0] as unknown as {
      refetchInterval: (query: {
        state: {
          data?: {
            pages: Array<{
              data: Array<ReturnType<typeof taskApiResponse>>
              next_cursor: string | null
            }>
          }
        }
      }) => number | false
    }
    expect(
      taskOptions.refetchInterval({
        state: {
          data: {
            pages: [
              {
                data: [taskApiResponse(task({ documentRevision: 4, state: 'running' }))],
                next_cursor: null,
              },
            ],
          },
        },
      }),
    ).toBe(5000)
  })

  it('recognizes the accepted re-index task when it recompiles the active revision', async () => {
    vi.useFakeTimers()
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

      tasksQuery.data = {
        pages: [
          {
            items: [
              task({
                documentRevision: 3,
                id: 'compilation-job-1',
                state: 'running',
              }),
            ],
          },
        ],
      }
      rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.cancelDocumentReindex' }),
      ).not.toHaveAttribute('data-disabled')
      await act(() => vi.advanceTimersByTimeAsync(30000))
      expect(
        screen.queryByRole('button', { name: 'dataset.newKnowledge.retryReindexDocument' }),
      ).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces unified task-list authorization failures and blocks re-indexing', () => {
    tasksQuery.data = undefined
    tasksQuery.error = { status: 403 }
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.tasksErrorDescription',
    )
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' }),
    ).toHaveAttribute('data-disabled')
    const taskOptions = documentTasksOptions.mock.lastCall?.[0] as unknown as {
      refetchInterval: (query: {
        state: {
          data?: {
            pages: Array<{
              data: Array<ReturnType<typeof taskApiResponse>>
              next_cursor: string | null
            }>
          }
          error?: unknown
        }
      }) => number | false
    }
    expect(taskOptions.refetchInterval({ state: { error: { status: 403 } } })).toBe(false)

    tasksQuery.error = { status: 404 }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.tasksErrorDescription',
    )
  })

  it('recovers task state directly from the unified task list', () => {
    tasksQuery.data = undefined
    tasksQuery.error = { status: 404 }
    const rendered = render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    tasksQuery.error = null
    tasksQuery.data = { pages: [{ items: [task({ state: 'running' })] }] }
    rendered.rerender(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'dataset.newKnowledge.documentReindexStatus',
    )
  })

  it('refreshes stale detail and task-list caches for a newer terminal task on revisit', async () => {
    tasksQuery.data = {
      pages: [{ items: [task({ documentRevision: 4, state: 'succeeded' })] }],
    }
    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4))
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['knowledge-fs', 'tasks', 'space-1', 'document-1'],
    })
  })

  it('locks local writes during a 403 refresh and restores editor access afterward', async () => {
    const user = userEvent.setup()
    let finishPermissionRefresh: ((value: { permission_keys: string[] }) => void) | undefined
    knowledgeSpacePermissionState.refetch.mockReturnValueOnce(
      new Promise<{ permission_keys: string[] }>((resolve) => {
        finishPermissionRefresh = resolve
      }),
    )
    reindexMutation.mutateAsync.mockRejectedValueOnce({ status: 403 })

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const button = screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' })
    await user.click(button)

    await waitFor(() => expect(knowledgeSpacePermissionState.refetch).toHaveBeenCalledOnce())
    expect(button).toHaveAttribute('data-disabled')
    finishPermissionRefresh?.({
      permission_keys: ['knowledge_space_document_write'],
    })
    await waitFor(() => expect(button).not.toHaveAttribute('data-disabled'))
  })

  it('keeps the local write lock when permission refresh resolves with an error', async () => {
    const user = userEvent.setup()
    knowledgeSpacePermissionState.refetch.mockRejectedValueOnce(
      new Error('permission refresh failed'),
    )
    reindexMutation.mutateAsync.mockRejectedValueOnce({ status: 403 })

    render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const button = screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocument' })
    await user.click(button)

    await waitFor(() => expect(knowledgeSpacePermissionState.refetch).toHaveBeenCalledOnce())
    expect(button).toHaveAttribute('data-disabled')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('dataset.newKnowledge.documentPermissionRestricted')
    const retryButton = within(alert).getByRole('button', { name: 'common.operation.retry' })
    await waitFor(() => expect(retryButton).toHaveFocus())

    knowledgeSpacePermissionState.refetch.mockRejectedValueOnce(
      new Error('permission refresh still failing'),
    )
    await user.click(retryButton)
    await waitFor(() => expect(knowledgeSpacePermissionState.refetch).toHaveBeenCalledTimes(2))
    expect(retryButton).toHaveFocus()
    expect(alert).toBeInTheDocument()

    knowledgeSpacePermissionState.refetch.mockResolvedValueOnce({
      permission_keys: ['knowledge_space_document_write'],
    })
    await user.click(retryButton)
    await waitFor(() => expect(knowledgeSpacePermissionState.refetch).toHaveBeenCalledTimes(3))
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
    const first = screen.getByRole('treeitem', { name: 'Chunk 1' })

    tree.focus()
    fireEvent.keyDown(tree, { key: 'End' })
    const last = screen.getByRole('treeitem', { name: 'Chunk 100' })
    expect(tree).toHaveFocus()
    expect(tree).toHaveAttribute('aria-activedescendant', last.id)
    expect(last).toHaveAttribute('aria-posinset', '100')
    expect(last).toHaveAttribute('aria-setsize', '100')
    expect(last).toHaveClass('ring-state-accent-solid')
    fireEvent.keyDown(tree, { key: 'Home' })
    expect(tree).toHaveAttribute('aria-activedescendant', first.id)
  })
})

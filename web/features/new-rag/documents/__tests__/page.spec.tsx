import type { Source } from '../../sources/source-models'
import type { DocumentMetadataField } from '../metadata/editor-model'
import type { BackgroundTask, DocumentProcessingTask, LogicalDocument } from '../models'
import { hashKey } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs as render } from '@/test/nuqs-testing'
import { DocumentsPage } from '../page'

vi.mock('../../components/knowledge-model-readiness-banner', () => ({
  KnowledgeModelReadinessBanner: () => null,
}))

vi.mock('@/app/components/base/file-uploader/dynamic-pdf-preview', () => ({
  default: ({ onCancel, url }: { onCancel: () => void; url: string }) => (
    <button type="button" aria-label="PDF preview" data-url={url} onClick={onCancel}>
      PDF preview
    </button>
  ),
}))

type InfiniteOptions = {
  enabled?: boolean
  getNextPageParam: (lastPage: { next_cursor?: string | null }) => string | null | undefined
  input: (pageParam: string | null) => unknown
  initialPageParam: string | null
  queryKind: 'documents' | 'sources' | 'tasks'
  queryKey?: readonly unknown[]
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
  data: undefined as { pages: Array<{ items: BackgroundTask[]; nextCursor?: string }> } | undefined,
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
const removeDocumentMutation = vi.hoisted(() => vi.fn())
const bulkRemoveDocumentsMutation = vi.hoisted(() => vi.fn())
const renameDocumentMutation = vi.hoisted(() => vi.fn())
const updateLogicalDocumentMutation = vi.hoisted(() => vi.fn())
const bulkUpdateLogicalDocumentsMutation = vi.hoisted(() => vi.fn())
const downloadDocumentMutation = vi.hoisted(() => vi.fn())
const downloadDocumentsMutation = vi.hoisted(() => vi.fn())
const downloadBlobMock = vi.hoisted(() => vi.fn())
const listLogicalDocuments = vi.hoisted(() => vi.fn())
const createMetadataField = vi.hoisted(() => vi.fn())
const renameMetadataField = vi.hoisted(() => vi.fn())
const deleteMetadataField = vi.hoisted(() => vi.fn())
const metadataFieldsQuery = vi.hoisted(() => ({
  data: undefined as DocumentMetadataField[] | undefined,
  error: null as unknown,
  isFetching: false,
  isPending: false,
  refetch: vi.fn(),
}))
const updateSourceMutation = vi.hoisted(() => vi.fn())
const uploadMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const stageUploadMutation = vi.hoisted(() => vi.fn())
const discardStagedUploadMutation = vi.hoisted(() => vi.fn())
const bulkUploadMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const queryCacheListeners = vi.hoisted(
  () =>
    new Set<
      (event: { action: { type: string }; query: { queryHash: string }; type: string }) => void
    >(),
)
const queryClient = vi.hoisted(() => ({
  cancelQueries: vi.fn(),
  getQueryCache: vi.fn(() => ({
    subscribe: (
      listener: (event: {
        action: { type: string }
        query: { queryHash: string }
        type: string
      }) => void,
    ) => {
      queryCacheListeners.add(listener)
      return () => queryCacheListeners.delete(listener)
    },
  })),
  getQueryState: vi.fn(() => ({ dataUpdateCount: tasksQuery.dataUpdateCount })),
  invalidateQueries: vi.fn(),
}))
const streamProcessingTaskEvents = vi.hoisted(() => vi.fn())
const getTaskSnapshot = vi.hoisted(() => vi.fn())
const taskSnapshotRequestState = vi.hoisted(() => ({ index: 0 }))
const rawQueryDataCache = vi.hoisted(() => ({
  documents: new WeakMap<object, object>(),
  sources: new WeakMap<object, object>(),
  tasks: new WeakMap<object, object>(),
}))
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
  spaceKeys: ['knowledge_space_document_write'],
}))
vi.mock('../../space/context', () => ({
  useKnowledgeSpace: () => ({
    refetch: async () => {
      const result = await permissionStateMock.refreshAfterDenial()
      const legacyKeys = result?.data?.dataset?.default_permission_keys
      return {
        permission_keys: legacyKeys
          ? legacyKeys.includes('dataset.acl.edit')
            ? ['knowledge_space_document_write']
            : []
          : permissionStateMock.spaceKeys,
      }
    },
    space: { permission_keys: permissionStateMock.spaceKeys },
  }),
}))
const systemFeaturesStateMock = vi.hoisted(() => ({
  atom: Symbol('knowledgeFsUploadEnabledAtom'),
  uploadEnabled: true,
}))
const fileUploadConfigMock = vi.hoisted(() => ({
  knowledgeFileSizeLimit: 15,
}))
const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: {
      file_size_limit: 15,
      knowledge_file_size_limit: fileUploadConfigMock.knowledgeFileSizeLimit,
    },
  }),
}))
const routerMock = vi.hoisted(() => ({ push: vi.fn() }))
const settingsState = vi.hoisted(() => ({
  configurationState: 'active' as 'active' | 'setup-required',
  refetch: vi.fn(),
}))
const revisionApiResponse = vi.hoisted(
  () => (revision: NonNullable<LogicalDocument['active']>) => ({
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
const documentApiResponse = vi.hoisted(() => (item: LogicalDocument) => ({
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
const taskApiResponse = vi.hoisted(() => (item: BackgroundTask) => ({
  can_cancel: item.canCancel ?? true,
  can_retry: item.canRetry ?? item.state === 'failed',
  completed_at: item.completedAt ?? null,
  created_at: item.createdAt,
  document_id: item.documentId ?? null,
  document_title: item.documentTitle ?? null,
  document_revision: item.documentRevision ?? null,
  error_code: item.errorCode ?? null,
  error_message: item.errorMessage ?? null,
  failure: item.failure ?? null,
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
const sourceApiResponse = vi.hoisted(() => (item: Source) => ({
  connection_id: item.connectionId ?? null,
  created_at: item.createdAt,
  credential_configured: item.credentialConfigured ?? null,
  id: item.id,
  knowledge_space_id: item.knowledgeSpaceId,
  metadata: item.metadata,
  name: item.name,
  permission_scope: item.permissionScope ?? [],
  status: item.status,
  type: item.type,
  updated_at: item.updatedAt,
  uri: item.uri,
  version: item.version ?? 1,
}))

vi.mock('@/context/permission-state', () => ({
  datasetDefaultPermissionKeysAtom: permissionStateMock.datasetAtom,
  refreshWorkspacePermissionKeysAfterMutationDenialAtom: permissionStateMock.refreshAfterDenialAtom,
  retryWorkspacePermissionKeysAtom: permissionStateMock.retryAtom,
  workspacePermissionKeysErrorAtom: permissionStateMock.errorAtom,
  workspacePermissionKeysFetchingAtom: permissionStateMock.fetchingAtom,
  workspacePermissionKeysLoadingAtom: permissionStateMock.loadingAtom,
}))

vi.mock('@/features/system-features/state', () => ({
  knowledgeFsUploadEnabledAtom: systemFeaturesStateMock.atom,
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
      if (atom === systemFeaturesStateMock.atom) return systemFeaturesStateMock.uploadEnabled
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
vi.mock('@/next/navigation', () => ({
  usePathname: () => '/datasets/new/space-1/documents',
  useRouter: () => routerMock,
}))
vi.mock('@/utils/download', () => ({ downloadBlob: downloadBlobMock }))

const documentsInfiniteOptions = vi.hoisted(() =>
  vi.fn((options: Omit<InfiniteOptions, 'queryKind'>) => ({ ...options, queryKind: 'documents' })),
)
const tasksInfiniteOptions = vi.hoisted(() =>
  vi.fn((options: Omit<InfiniteOptions, 'queryKind'>) => ({
    ...options,
    queryKey: ['knowledge-fs', 'tasks'],
    queryKind: 'tasks',
  })),
)
const sourcesInfiniteOptions = vi.hoisted(() =>
  vi.fn((options: Omit<InfiniteOptions, 'queryKind'>) => ({ ...options, queryKind: 'sources' })),
)

function rawDocumentQueryData(data: NonNullable<typeof documentsQuery.data>): {
  pages: Array<{ data: Array<ReturnType<typeof documentApiResponse>>; next_cursor: string | null }>
} {
  const cached = rawQueryDataCache.documents.get(data)
  if (cached) return cached as ReturnType<typeof rawDocumentQueryData>
  const mapped = {
    pages: data.pages.map((page) => ({
      data: page.items.map(documentApiResponse),
      next_cursor: page.nextCursor ?? null,
    })),
  }
  rawQueryDataCache.documents.set(data, mapped)
  return mapped
}

function rawSourceQueryData(data: NonNullable<typeof sourcesQuery.data>): {
  pages: Array<{ data: Array<ReturnType<typeof sourceApiResponse>>; next_cursor: string | null }>
} {
  const cached = rawQueryDataCache.sources.get(data)
  if (cached) return cached as ReturnType<typeof rawSourceQueryData>
  const mapped = {
    pages: data.pages.map((page) => ({
      data: page.items.map(sourceApiResponse),
      next_cursor: page.nextCursor ?? null,
    })),
  }
  rawQueryDataCache.sources.set(data, mapped)
  return mapped
}

function rawTaskQueryData(data: NonNullable<typeof tasksQuery.data>): {
  pages: Array<{ data: Array<ReturnType<typeof taskApiResponse>>; next_cursor: string | null }>
} {
  const cached = rawQueryDataCache.tasks.get(data)
  if (cached) return cached as ReturnType<typeof rawTaskQueryData>
  const mapped = {
    pages: data.pages.map((page) => ({
      data: page.items.map(taskApiResponse),
      next_cursor: page.nextCursor ?? null,
    })),
  }
  rawQueryDataCache.tasks.set(data, mapped)
  return mapped
}

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: (options: InfiniteOptions) => {
      if (options.queryKind === 'documents')
        return {
          ...documentsQuery,
          data: documentsQuery.data ? rawDocumentQueryData(documentsQuery.data) : undefined,
        }
      if (options.queryKind === 'sources')
        return {
          ...sourcesQuery,
          data: sourcesQuery.data ? rawSourceQueryData(sourcesQuery.data) : undefined,
        }
      return {
        ...tasksQuery,
        data: tasksQuery.data ? rawTaskQueryData(tasksQuery.data) : undefined,
      }
    },
    useMutation: (options: {
      mutationFn?: (input: BackgroundTask) => Promise<BackgroundTask>
      mutationKind?: 'bulk-upload' | 'cancel' | 'reindex' | 'retry' | 'upload'
    }) => {
      if (options.mutationFn)
        return {
          mutateAsync: options.mutationFn,
        }
      if (options.mutationKind === 'cancel') return cancelMutation
      if (options.mutationKind === 'retry') return retryMutation
      if (options.mutationKind === 'reindex')
        return {
          mutateAsync: async (input: unknown) => {
            const result = await reindexMutation.mutateAsync(input)
            return {
              ...result,
              items: result.items.map(
                (item: {
                  documentId?: string
                  document_id?: string
                  status: 'disabled' | 'not_found' | 'queued'
                }) => ({
                  ...item,
                  document_id: item.document_id ?? item.documentId ?? null,
                }),
              ),
            }
          },
        }
      if (options.mutationKind === 'bulk-upload') return bulkUploadMutation
      return uploadMutation
    },
    useQuery: (options: { queryKey?: readonly unknown[] }) => {
      if (options.queryKey?.includes('metadata-fields')) return metadataFieldsQuery
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
    },
    useQueryClient: () => queryClient,
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          backgroundTasks: {
            byTaskKind: {
              byTaskId: {
                cancel: {
                  post: async (input: unknown) =>
                    taskApiResponse(await cancelMutation.mutateAsync(input)),
                },
                retry: {
                  post: async (input: unknown) =>
                    taskApiResponse(await retryMutation.mutateAsync(input)),
                },
              },
            },
            get: async (input: unknown, options?: unknown) => {
              const allTasks = tasksQuery.data?.pages.flatMap((page) => page.items) ?? []
              const requestedTask = allTasks[taskSnapshotRequestState.index % allTasks.length]
              taskSnapshotRequestState.index += 1
              const snapshot = await getTaskSnapshot(
                requestedTask
                  ? {
                      params: {
                        documentId: requestedTask.documentId,
                        id: requestedTask.knowledgeSpaceId,
                        taskId: requestedTask.id,
                      },
                    }
                  : input,
                options,
              )
              const snapshots = Array.isArray(snapshot) ? snapshot : snapshot ? [snapshot] : []
              return {
                data: snapshots.map(taskApiResponse),
                next_cursor: null,
              }
            },
          },
          documents: {
            byDocumentId: {
              patch: renameDocumentMutation,
            },
          },
          logicalDocuments: {
            get: listLogicalDocuments,
            patch: bulkUpdateLogicalDocumentsMutation,
            bulk: {
              delete: bulkRemoveDocumentsMutation,
            },
            downloadZip: {
              post: downloadDocumentsMutation,
            },
            byDocumentId: {
              delete: removeDocumentMutation,
              patch: updateLogicalDocumentMutation,
              download: {
                get: downloadDocumentMutation,
              },
            },
          },
          metadata: {
            post: createMetadataField,
            byFieldId: {
              delete: deleteMetadataField,
              patch: renameMetadataField,
            },
          },
          sources: {
            bySourceId: {
              patch: updateSourceMutation,
            },
          },
        },
      },
    },
  },
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          backgroundTasks: {
            get: {
              infiniteOptions: tasksInfiniteOptions,
              key: () => ['knowledge-fs', 'tasks'],
            },
          },
          documents: {
            reindex: {
              post: {
                mutationOptions: () => ({ mutationKind: 'reindex' }),
              },
            },
          },
          logicalDocuments: {
            get: {
              infiniteOptions: documentsInfiniteOptions,
              key: () => ['knowledge-fs', 'documents'],
            },
          },
          metadata: {
            get: {
              key: () => ['knowledge-fs', 'metadata-fields'],
              queryOptions: ({ input }: { input: unknown }) => ({
                queryKey: ['knowledge-fs', 'metadata-fields', input],
              }),
            },
          },
          settings: {
            get: {
              queryOptions: ({ input }: { input: unknown }) => ({
                queryFn: async () => ({
                  configuration_state: 'active',
                  embedding: null,
                  retrieval: null,
                  revision: 1,
                }),
                queryKey: ['knowledge-fs', 'settings', input],
              }),
            },
          },
          sources: {
            get: {
              infiniteOptions: sourcesInfiniteOptions,
              key: () => ['knowledge-fs', 'sources'],
            },
          },
        },
      },
    },
  },
}))

vi.mock('../tasks/events', () => ({ streamProcessingTaskEvents }))
vi.mock('../../upload/knowledge-fs-upload', () => ({
  discardKnowledgeFsStagedUpload: discardStagedUploadMutation,
  stageKnowledgeFsDocument: async (file: File, signal?: AbortSignal) => {
    const result = await stageUploadMutation({ body: { file } }, { signal })
    return result.id
  },
  uploadKnowledgeFsDocuments: async (
    knowledgeSpaceId: string,
    uploads: Array<{ file: File; id: string; uploadId: string }>,
    _progress: Map<string, { phase: 'completed' | 'pending' }>,
    onProgress?: (file: File, phase: 'completed' | 'pending') => void,
  ) => {
    for (const { file, uploadId } of uploads) {
      onProgress?.(file, 'pending')
      await uploadMutation.mutateAsync({
        body: { upload_id: uploadId },
        params: { control_space_id: knowledgeSpaceId },
      })
      onProgress?.(file, 'completed')
    }
  },
}))

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
  enabled: true,
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

const task = (overrides: Partial<DocumentProcessingTask> = {}): DocumentProcessingTask => ({
  createdAt: '2026-07-20T10:00:00Z',
  documentId: 'document-1',
  documentRevision: 2,
  id: 'task-1',
  knowledgeSpaceId: 'space-1',
  operation: 'document_processing',
  progressPercent: 45,
  stage: 'parsed',
  state: 'running',
  taskKind: 'document',
  updatedAt: '2026-07-20T10:01:00Z',
  ...overrides,
})

const backgroundTask = (overrides: Partial<BackgroundTask> = {}): BackgroundTask => ({
  createdAt: '2026-07-20T10:00:00Z',
  id: 'background-task-1',
  knowledgeSpaceId: 'space-1',
  operation: 'document_reindex',
  progressPercent: 100,
  stage: 'published',
  state: 'succeeded',
  taskKind: 'document_bulk',
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

function notifyTaskQuerySuccess() {
  for (const listener of queryCacheListeners)
    listener({
      action: { type: 'success' },
      query: { queryHash: hashKey(['knowledge-fs', 'tasks']) },
      type: 'updated',
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

function openTasksDrawer() {
  fireEvent.click(
    screen.getByRole('button', {
      name: /dataset\.newKnowledge\.tasksWithAttention/,
    }),
  )
}

async function waitForDocumentFilesStaged() {
  await waitFor(() =>
    expect(screen.queryByText('dataset.newKnowledge.uploadingFiles')).not.toBeInTheDocument(),
  )
}

describe('DocumentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileUploadConfigMock.knowledgeFileSizeLimit = 15
    systemFeaturesStateMock.uploadEnabled = true
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
    queryCacheListeners.clear()
    taskSnapshotRequestState.index = 0
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
    documentsQuery.refetch.mockResolvedValue({ error: null })
    metadataFieldsQuery.data = []
    metadataFieldsQuery.error = null
    metadataFieldsQuery.isFetching = false
    metadataFieldsQuery.isPending = false
    metadataFieldsQuery.refetch.mockResolvedValue({ data: [], error: null })
    tasksQuery.data = { pages: [{ items: [] }] }
    tasksQuery.dataUpdatedAt = 0
    tasksQuery.dataUpdateCount = 0
    tasksQuery.error = null
    tasksQuery.hasNextPage = false
    tasksQuery.isFetchNextPageError = false
    tasksQuery.isFetching = false
    tasksQuery.isFetchingNextPage = false
    tasksQuery.isPending = false
    tasksQuery.refetch.mockResolvedValue({ error: null })
    sourcesQuery.data = { pages: [{ items: [source()] }] }
    sourcesQuery.error = null
    sourcesQuery.hasNextPage = false
    sourcesQuery.isFetchNextPageError = false
    sourcesQuery.isFetching = false
    sourcesQuery.isFetchingNextPage = false
    sourcesQuery.isPending = false
    sourcesQuery.refetch.mockResolvedValue({ error: null })
    permissionStateMock.datasetKeys = ['dataset.acl.edit', 'dataset.acl.document_download']
    permissionStateMock.spaceKeys = ['knowledge_space_document_write']
    permissionStateMock.error = null
    permissionStateMock.fetching = false
    permissionStateMock.loading = false
    permissionStateMock.retry.mockResolvedValue({
      data: {
        dataset: {
          default_permission_keys: ['dataset.acl.edit', 'dataset.acl.document_download'],
        },
      },
      error: null,
    })
    permissionStateMock.refreshAfterDenial.mockResolvedValue({
      data: {
        dataset: {
          default_permission_keys: ['dataset.acl.edit', 'dataset.acl.document_download'],
        },
      },
      error: null,
    })
    downloadDocumentMutation.mockResolvedValue(new Blob(['document']))
    downloadDocumentsMutation.mockResolvedValue(
      new Blob(['documents'], { type: 'application/zip' }),
    )
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
    removeDocumentMutation.mockResolvedValue({
      job: { id: 'delete-1', state: 'accepted' },
      status_url: '/delete-1',
    })
    bulkRemoveDocumentsMutation.mockResolvedValue({ items: [], total: 2 })
    listLogicalDocuments.mockImplementation(async () => ({
      data: (documentsQuery.data?.pages.flatMap((page) => page.items) ?? []).map(
        documentApiResponse,
      ),
      next_cursor: null,
    }))
    createMetadataField.mockResolvedValue({
      count: 0,
      created_at: '2026-08-10T10:00:00Z',
      id: 'metadata-field-1',
      name: 'category',
      row_version: 0,
      type: 'string',
      updated_at: '2026-08-10T10:00:00Z',
    })
    renameMetadataField.mockResolvedValue({
      count: 1,
      created_at: '2026-08-10T10:00:00Z',
      id: 'metadata-field-1',
      name: 'topic',
      row_version: 1,
      type: 'string',
      updated_at: '2026-08-10T10:01:00Z',
    })
    deleteMetadataField.mockResolvedValue({ deleted: true })
    renameDocumentMutation.mockImplementation(
      async ({ body }: { body: { patch: Record<string, unknown> } }) => {
        const userMetadata = { ...document().userMetadata }
        for (const [name, value] of Object.entries(body.patch)) {
          if (value === null) delete userMetadata[name]
          else userMetadata[name] = value
        }
        return documentApiResponse(document({ rowVersion: 2, userMetadata }))
      },
    )
    updateLogicalDocumentMutation.mockImplementation(
      async ({ body }: { body: { enabled: boolean } }) =>
        documentApiResponse(document({ enabled: body.enabled, rowVersion: 2 })),
    )
    bulkUpdateLogicalDocumentsMutation.mockImplementation(
      async ({
        body,
      }: {
        body: { documents: Array<{ documentId: string }>; enabled: boolean }
      }) => ({
        items: body.documents.map(({ documentId }) =>
          documentApiResponse(document({ enabled: body.enabled, id: documentId, rowVersion: 2 })),
        ),
        total: body.documents.length,
      }),
    )
    updateSourceMutation.mockImplementation(
      async ({ body }: { body: { status: Source['status'] } }) =>
        sourceApiResponse(source({ status: body.status, version: 2 })),
    )
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
    stageUploadMutation.mockImplementation(({ body }: { body: { file: File } }) =>
      Promise.resolve({ id: `staged-${body.file.name}` }),
    )
    discardStagedUploadMutation.mockResolvedValue(undefined)
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
      params: { control_space_id: 'space-1' },
      query: {},
    })
    expect(documentOptions?.input('next')).toEqual({
      params: { control_space_id: 'space-1' },
      query: { cursor: 'next' },
    })
    expect(documentOptions?.getNextPageParam({ next_cursor: 'next' })).toBe('next')
    expect(taskOptions?.input(null)).toEqual({
      params: { control_space_id: 'space-1' },
      query: { limit: 100 },
    })
    expect(taskOptions?.getNextPageParam({ next_cursor: 'next' })).toBe('next')
    expect(sourceOptions?.input(null)).toEqual({
      params: { control_space_id: 'space-1' },
      query: {},
    })
    expect(sourceOptions?.getNextPageParam({ next_cursor: 'next' })).toBe('next')
    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
  })

  it('restores document search and status filters from the URL', async () => {
    const user = userEvent.setup()
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

    const metadata = screen.getByRole('button', { name: 'dataset.newKnowledge.metadata' })
    expect(metadata).toBeEnabled()
    await user.click(metadata)
    expect(
      await screen.findByRole('heading', { name: 'dataset.metadata.metadata' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'dataset.metadata.datasetMetadata.addMetaData',
      }),
    ).toBeEnabled()
    expect(screen.queryByText('sourceName')).not.toBeInTheDocument()
    expect(screen.queryByText('document_name')).not.toBeInTheDocument()
    expect(screen.queryByText('uploader')).not.toBeInTheDocument()
    expect(screen.queryByText('upload_date')).not.toBeInTheDocument()
    expect(screen.queryByText('last_update_date')).not.toBeInTheDocument()
    expect(screen.queryByText('source')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'dataset.metadata.metadata' }),
      ).not.toBeInTheDocument()
    })
    const rowActions = screen.getByRole('button', {
      name: /dataset\.newKnowledge\.documentActions/,
    })
    expect(rowActions).toBeEnabled()
    await user.click(rowActions)
    const rowMenuItems = await screen.findAllByRole('menuitem')
    expect(rowMenuItems).toHaveLength(4)
    expect(rowMenuItems.map((item) => item.textContent)).toEqual([
      'common.operation.rename',
      'dataset.newKnowledge.retryTask',
      'dataset.newKnowledge.downloadDocuments',
      'common.operation.delete',
    ])
    expect(rowMenuItems[2]).not.toHaveAttribute('aria-disabled', 'true')

    expect(screen.getByRole('searchbox')).toHaveValue('report')
    expect(screen.getByRole('combobox')).toHaveTextContent(
      'dataset.newKnowledge.documentStatus.failed',
    )
    expect(screen.getByText('Failed report.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Ready handbook.pdf')).not.toBeInTheDocument()
  })

  it('reveals the latest document task failure reason from the failed status', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'failed-document', title: 'Failed report.pdf' })] }],
    }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              documentId: 'failed-document',
              failure: {
                action: 'configure_model',
                category: 'configuration',
                code: 'MODEL_SELECTION_NOT_FOUND',
                message: 'Select another model.',
                retryPolicy: 'after_configuration',
              },
              id: 'failed-task',
              state: 'failed',
            }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const failedStatus = screen.getByRole('button', {
      name: 'dataset.newKnowledge.documentStatus.failed: dataset.newKnowledge.taskFailure.modelConfiguration',
    })
    expect(screen.queryByText('dataset.newKnowledge.taskFailure.modelConfiguration')).toBeNull()

    await user.hover(failedStatus)

    expect(
      await screen.findByText('dataset.newKnowledge.taskFailure.modelConfiguration'),
    ).toBeInTheDocument()
  })

  it('shows actionable task failures without technical identifiers', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'failed-document', title: 'Failed report.pdf' })] }],
    }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              documentId: 'failed-document',
              failure: {
                action: 'contact_admin',
                category: 'internal',
                code: 'DOCUMENT_COMPILATION_FAILED',
                message: 'Safe server fallback',
                retryPolicy: 'manual',
                traceId: 'cef52296-3aa7-41ec-9953-2bbe030fdf6c',
              },
              id: 'failed-task',
              state: 'failed',
            }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const failedStatus = screen.getByRole('button', {
      name: 'dataset.newKnowledge.documentStatus.failed: dataset.newKnowledge.taskFailure.documentProcessing',
    })
    await user.hover(failedStatus)
    expect(
      await screen.findByText('dataset.newKnowledge.taskFailure.documentProcessing'),
    ).toBeInTheDocument()
    expect(screen.queryByText('cef52296-3aa7-41ec-9953-2bbe030fdf6c')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )

    const panel = screen.getByRole('dialog', { name: 'dataset.newKnowledge.backgroundTasks' })
    expect(
      within(panel).getByText('dataset.newKnowledge.taskFailure.documentProcessing'),
    ).toBeInTheDocument()
    expect(within(panel).queryByText('DOCUMENT_COMPILATION_FAILED')).not.toBeInTheDocument()
    expect(
      within(panel).queryByRole('button', {
        name: 'dataset.newKnowledge.taskFailure.technicalDetails',
      }),
    ).not.toBeInTheDocument()
    expect(
      within(panel).queryByText('cef52296-3aa7-41ec-9953-2bbe030fdf6c'),
    ).not.toBeInTheDocument()
  })

  it('downloads the active revision from the document action menu', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'report', title: 'Report.pdf' })] }],
    }
    const file = new File(['report'], 'source-report.md', { type: 'text/markdown' })
    downloadDocumentMutation.mockResolvedValue(file)

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /dataset\.newKnowledge\.documentActions/ }))
    await user.click(
      screen.getByRole('menuitem', { name: 'dataset.newKnowledge.downloadDocuments' }),
    )

    expect(downloadDocumentMutation).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', document_id: 'report' },
    })
    expect(downloadBlobMock).toHaveBeenCalledWith({ data: file, fileName: 'source-report.md' })
  })

  it('downloads a failed document without an active revision from the document action menu', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({
              active: null,
              activeRevision: undefined,
              id: 'failed-report',
              status: 'failed',
              title: 'Failed report.pdf',
            }),
          ],
        },
      ],
    }
    tasksQuery.data = {
      pages: [
        {
          items: [task({ documentId: 'failed-report', documentRevision: 1, state: 'failed' })],
        },
      ],
    }
    const file = new File(['failed report'], 'failed-report.pdf', { type: 'application/pdf' })
    downloadDocumentMutation.mockResolvedValue(file)

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /dataset\.newKnowledge\.documentActions/ }))
    const download = await screen.findByRole('menuitem', {
      name: 'dataset.newKnowledge.downloadDocuments',
    })
    expect(download).toBeEnabled()
    await user.click(download)

    expect(downloadDocumentMutation).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', document_id: 'failed-report' },
    })
    expect(downloadBlobMock).toHaveBeenCalledWith({ data: file, fileName: 'failed-report.pdf' })
  })

  it('keeps downloads disabled when a pending document is displayed as failed by a canceled task', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({
              active: null,
              activeRevision: undefined,
              id: 'canceled-report',
              status: 'pending',
              title: 'Canceled report.pdf',
            }),
          ],
        },
      ],
    }
    tasksQuery.data = {
      pages: [
        {
          items: [task({ documentId: 'canceled-report', documentRevision: 1, state: 'canceled' })],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'Canceled report.pdf' }))
    const bulkActions = screen.getByRole('group', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })
    expect(
      within(bulkActions).getByRole('button', {
        name: 'dataset.newKnowledge.downloadDocuments',
      }),
    ).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /dataset\.newKnowledge\.documentActions/ }))
    expect(
      await screen.findByRole('menuitem', {
        name: 'dataset.newKnowledge.downloadDocuments',
      }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(downloadDocumentMutation).not.toHaveBeenCalled()
    expect(downloadDocumentsMutation).not.toHaveBeenCalled()
  })

  it('keeps row and selected-document downloads disabled until task status loads', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'report', title: 'Report.pdf' })] }],
    }

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'Report.pdf' }))

    tasksQuery.data = undefined
    tasksQuery.isPending = true
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    const bulkActions = screen.getByRole('group', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })
    expect(
      within(bulkActions).getByRole('button', {
        name: 'dataset.newKnowledge.downloadDocuments',
      }),
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /dataset\.newKnowledge\.documentActions/ }))
    expect(
      await screen.findByRole('menuitem', {
        name: 'dataset.newKnowledge.downloadDocuments',
      }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('creates a metadata field without scanning or rewriting documents', async () => {
    const user = userEvent.setup()

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.metadata' }))
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.metadata.datasetMetadata.addMetaData',
      }),
    )
    await user.type(
      screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }),
      'category',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(createMetadataField).toHaveBeenCalledOnce()
    expect(createMetadataField).toHaveBeenCalledWith({
      body: { name: 'category', type: 'string' },
      params: { control_space_id: 'space-1' },
    })
    expect(listLogicalDocuments).not.toHaveBeenCalled()
    expect(renameDocumentMutation).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('keeps metadata creation open when the field request fails', async () => {
    const user = userEvent.setup()
    createMetadataField.mockRejectedValueOnce(new Error('conflict'))

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.metadata' }))
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.metadata.datasetMetadata.addMetaData',
      }),
    )
    const nameInput = screen.getByRole('textbox', {
      name: 'dataset.metadata.createMetadata.name',
    })
    await user.type(nameInput, 'category')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled())
    expect(nameInput).toBeInTheDocument()
    expect(createMetadataField).toHaveBeenCalledOnce()
    expect(renameDocumentMutation).not.toHaveBeenCalled()
  })

  it('disables metadata creation until the field catalog query completes', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'one', title: 'One.pdf' })] }],
    }
    metadataFieldsQuery.isPending = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.metadata' }))

    expect(
      await screen.findByRole('button', {
        name: 'dataset.metadata.datasetMetadata.addMetaData',
      }),
    ).toBeDisabled()
  })

  it('lets users retry when the metadata field query fails', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'one', title: 'One.pdf' })] }],
    }
    metadataFieldsQuery.error = new Error('metadata query failed')

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.metadata' }))
    expect(
      await screen.findByText('dataset.newKnowledge.documentLoadErrorDescription'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(metadataFieldsQuery.refetch).toHaveBeenCalledOnce()
  })

  it('validates a metadata name in the metadata drawer before submitting it', async () => {
    const user = userEvent.setup()
    metadataFieldsQuery.data = [metadataField({ name: 'existing_field' })]
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({
              id: 'one',
              title: 'One.pdf',
              userMetadata: { existing_field: 'support' },
            }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.metadata' }))
    await user.click(
      await screen.findByRole('button', {
        name: 'dataset.metadata.datasetMetadata.addMetaData',
      }),
    )
    const nameInput = screen.getByRole('textbox', {
      name: 'dataset.metadata.createMetadata.name',
    })
    const createDialog = nameInput.closest<HTMLElement>('[role="dialog"]')!
    const save = within(createDialog).getByRole('button', { name: 'common.operation.save' })
    expect(save).toBeDisabled()

    await user.type(nameInput, '11')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(within(createDialog).getByRole('alert')).toHaveTextContent(
      'dataset.metadata.checkName.invalid',
    )
    expect(save).toBeDisabled()

    await user.clear(nameInput)
    await user.type(nameInput, 'existing_field')
    expect(within(createDialog).getByRole('alert')).toHaveTextContent(
      'dataset.metadata.checkName.duplicate',
    )

    await user.clear(nameInput)
    await user.type(nameInput, 'a'.repeat(256))
    expect(within(createDialog).getByRole('alert')).toHaveTextContent(
      'dataset.metadata.checkName.tooLong',
    )

    await user.clear(nameInput)
    await user.type(nameInput, 'displayName')
    expect(within(createDialog).getByRole('alert')).toHaveTextContent(
      'dataset.metadata.checkName.invalid',
    )

    await user.clear(nameInput)
    await user.type(nameInput, 'priority_1')
    expect(nameInput).not.toHaveAttribute('aria-invalid')
    expect(within(createDialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(save).toBeEnabled()
  })

  it('renames metadata through the field catalog endpoint', async () => {
    const user = userEvent.setup()
    metadataFieldsQuery.data = [metadataField()]
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({
              id: 'one',
              title: 'One.pdf',
              userMetadata: { category: 'support', sourceName: 'Notion support SOP' },
            }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.metadata' }))
    await user.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
    const nameInput = screen.getByRole('textbox', {
      name: 'dataset.metadata.datasetMetadata.name',
    })
    await user.clear(nameInput)
    await user.type(nameInput, 'topic')
    await user.keyboard('{Enter}')

    expect(renameMetadataField).toHaveBeenCalledWith({
      body: { expectedRowVersion: 0, name: 'topic' },
      params: { control_space_id: 'space-1', field_id: 'metadata-field-1' },
    })
    expect(renameDocumentMutation).not.toHaveBeenCalled()
  })

  it('keeps the metadata rename dialog open when the catalog request fails', async () => {
    const user = userEvent.setup()
    metadataFieldsQuery.data = [metadataField()]
    renameMetadataField.mockRejectedValueOnce(new Error('conflict'))

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.metadata' }))
    await user.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
    const nameInput = screen.getByRole('textbox', {
      name: 'dataset.metadata.datasetMetadata.name',
    })
    await user.clear(nameInput)
    await user.type(nameInput, 'topic')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled())
    expect(nameInput).toBeInTheDocument()
    expect(renameMetadataField).toHaveBeenCalledOnce()
    expect(renameDocumentMutation).not.toHaveBeenCalled()
  })

  it('deletes metadata through the field catalog endpoint', async () => {
    const user = userEvent.setup()
    metadataFieldsQuery.data = [metadataField({ count: 1 })]
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({
              id: 'one',
              title: 'One.pdf',
              userMetadata: { category: 'support', sourceName: 'Notion support SOP' },
            }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.metadata' }))
    await user.click(await screen.findByRole('button', { name: 'common.operation.remove' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(deleteMetadataField).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', field_id: 'metadata-field-1' },
      query: { expectedRowVersion: 0 },
    })
    expect(renameDocumentMutation).not.toHaveBeenCalled()
  })

  it('starts re-indexing from a document row action', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'one', title: 'One.pdf' })] }],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: /dataset\.newKnowledge\.documentActions/,
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'dataset.newKnowledge.reindexDocument',
      }),
    )

    expect(reindexMutation.mutateAsync).toHaveBeenCalledWith({
      body: { documentIds: ['one'] },
      params: { control_space_id: 'space-1' },
    })
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        'dataset.newKnowledge.documentsReindexStarted',
      ),
    )
  })

  it.each([
    ['queued', 'queued'],
    ['processing', 'running'],
  ] as const)(
    'locks re-index, download, and availability actions while a document is %s',
    async (_status, taskState) => {
      const user = userEvent.setup()
      documentsQuery.data = {
        pages: [{ items: [document({ id: 'one', title: 'One.pdf' })] }],
      }
      tasksQuery.data = {
        pages: [{ items: [task({ documentId: 'one', state: taskState })] }],
      }

      render(<DocumentsPage knowledgeSpaceId="space-1" />)
      await user.click(
        screen.getByRole('button', {
          name: /dataset\.newKnowledge\.documentActions/,
        }),
      )

      expect(
        await screen.findByRole('menuitem', {
          name: 'dataset.newKnowledge.reindexDocument',
        }),
      ).toHaveAttribute('aria-disabled', 'true')
      expect(
        screen.getByRole('menuitem', { name: 'dataset.newKnowledge.downloadDocuments' }),
      ).toHaveAttribute('aria-disabled', 'true')
      expect(
        screen.getByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }),
      ).toHaveAttribute('aria-disabled', 'true')
      expect(reindexMutation.mutateAsync).not.toHaveBeenCalled()
      expect(downloadDocumentMutation).not.toHaveBeenCalled()
      expect(updateLogicalDocumentMutation).not.toHaveBeenCalled()
    },
  )

  it('reports a row re-index that loses availability before the request runs', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'one', title: 'One.pdf' })] }],
    }
    reindexMutation.mutateAsync.mockResolvedValue({
      bulkJobId: 'reindex-disabled',
      items: [{ documentId: 'one', status: 'disabled' }],
      total: 1,
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: /dataset\.newKnowledge\.documentActions/,
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', {
        name: 'dataset.newKnowledge.reindexDocument',
      }),
    )

    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith('dataset.newKnowledge.documentsReindexFailed')
  })

  it('retries a failed document from its row action', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'one', status: 'failed', title: 'One.pdf' })] }],
    }
    tasksQuery.data = {
      pages: [
        {
          items: [task({ documentId: 'one', id: 'failed-task', state: 'failed' })],
        },
      ],
    }
    retryMutation.mutateAsync.mockResolvedValueOnce(
      task({ documentId: 'one', id: 'failed-task', state: 'queued' }),
    )

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: /dataset\.newKnowledge\.documentActions/,
      }),
    )
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.reindexDocument' }),
    ).not.toBeInTheDocument()
    const retry = await screen.findByRole('menuitem', {
      name: 'dataset.newKnowledge.retryTask',
    })
    expect(
      screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }),
    ).not.toBeInTheDocument()
    expect(retry).toBeEnabled()
    expect(retry).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(retry)

    await waitFor(() =>
      expect(retryMutation.mutateAsync).toHaveBeenCalledWith({
        params: {
          control_space_id: 'space-1',
          task_id: 'failed-task',
          task_kind: 'document',
        },
      }),
    )
    expect(
      await screen.findByText('dataset.newKnowledge.documentStatus.queued'),
    ).toBeInTheDocument()
  })

  it('renames a document through its user-facing display metadata', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /dataset\.newKnowledge\.documentActions/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'common.operation.rename' }))
    const input = screen.getByRole('textbox', { name: 'dataset.newKnowledge.documentColumn' })
    await user.clear(input)
    await user.type(input, 'Renamed handbook.pdf')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(renameDocumentMutation).toHaveBeenCalledWith({
      body: {
        expectedRowVersion: 1,
        patch: { displayName: 'Renamed handbook.pdf' },
      },
      params: { control_space_id: 'space-1', document_id: 'document-1' },
    })
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'common.operation.rename' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('disables the document from the row action', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /dataset\.newKnowledge\.documentActions/ }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }),
    )

    expect(updateLogicalDocumentMutation).toHaveBeenCalledWith({
      body: { enabled: false, expectedRowVersion: 1 },
      params: { control_space_id: 'space-1', document_id: 'document-1' },
    })
  })

  it('re-enables a disabled document from the same row action', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({ enabled: false })] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(screen.getByText('dataset.newKnowledge.documentStatus.disabled')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dataset\.newKnowledge\.documentActions/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'dataset.enable' }))

    expect(updateLogicalDocumentMutation).toHaveBeenCalledWith({
      body: { enabled: true, expectedRowVersion: 1 },
      params: { control_space_id: 'space-1', document_id: 'document-1' },
    })
  })

  it('confirms permanent document removal from the row action', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /dataset\.newKnowledge\.documentActions/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))
    expect(removeDocumentMutation).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))

    expect(removeDocumentMutation).toHaveBeenCalledWith({
      body: { expectedRevision: 1 },
      headers: { 'Idempotency-Key': expect.any(String) },
      params: { control_space_id: 'space-1', document_id: 'document-1' },
    })
  })

  it('opens the upload form and consumes the one-shot URL request', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = render(<DocumentsPage knowledgeSpaceId="space-1" />, {
      searchParams: '?upload=1',
    })

    expect(
      await screen.findByRole('heading', { name: 'dataset.newKnowledge.addDocument' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => {
      const urlUpdate = onUrlUpdate.mock.calls.at(-1)?.[0]
      expect(urlUpdate?.searchParams.get('upload')).toBeNull()
      expect(urlUpdate?.options.history).toBe('replace')
    })
    expect(
      screen.queryByRole('heading', { name: 'dataset.newKnowledge.addDocument' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the upload form opened from the document page in the URL', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))

    await waitFor(() => {
      const urlUpdate = onUrlUpdate.mock.calls.at(-1)?.[0]
      expect(urlUpdate?.searchParams.get('upload')).toBe('1')
      expect(urlUpdate?.options.history).toBe('replace')
    })
    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.addDocument' }),
    ).toBeInTheDocument()
  })

  it('consumes an upload URL request without opening the form for a read-only user', async () => {
    permissionStateMock.datasetKeys = ['dataset.acl.readonly']
    permissionStateMock.spaceKeys = []
    const { onUrlUpdate } = render(<DocumentsPage knowledgeSpaceId="space-1" />, {
      searchParams: '?upload=1',
    })

    expect(
      screen.queryByRole('heading', { name: 'dataset.newKnowledge.addDocument' }),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      const urlUpdate = onUrlUpdate.mock.calls.at(-1)?.[0]
      expect(urlUpdate?.searchParams.get('upload')).toBeNull()
      expect(urlUpdate?.options.history).toBe('replace')
    })
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
              enabled: false,
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
    expect(screen.getByRole('link', { name: 'Ready.pdf' })).toHaveAttribute(
      'href',
      '/datasets/new/space-1/documents/ready',
    )
    expect(screen.getAllByText('Notion support SOP').length).toBeGreaterThan(0)
    expect(screen.getAllByText('v2').length).toBeGreaterThan(0)
    for (const status of ['ready', 'queued', 'processing', 'failed', 'disabled'])
      expect(
        screen.getAllByText(`dataset.newKnowledge.documentStatus.${status}`).length,
      ).toBeGreaterThan(0)
    expect(screen.getByText('dataset.newKnowledge.lastReadyRevisionHint')).toBeInTheDocument()
  })

  it('does not derive document availability from disabled or unresolved sources', () => {
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({ id: 'archived', sourceId: 'disabled-source', title: 'Archived.pdf' }),
            document({ id: 'orphaned', sourceId: 'missing-source', title: 'Orphaned.pdf' }),
          ],
        },
      ],
    }
    sourcesQuery.data = {
      pages: [{ items: [source({ id: 'disabled-source', name: 'Archive', status: 'disabled' })] }],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getAllByText('dataset.newKnowledge.documentStatus.ready')).toHaveLength(2)
    expect(screen.getByRole('checkbox', { name: 'Archived.pdf' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Orphaned.pdf' })).toBeEnabled()
  })

  it('renders the designed empty state with an available upload action', () => {
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({ id: 'failed-1', state: 'failed' }),
            task({ id: 'failed-2', state: 'failed' }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const emptyState = screen.getByText('dataset.newKnowledge.documentsEmptyTitle').parentElement
    expect(emptyState).not.toBeNull()
    expect(screen.getByText('dataset.newKnowledge.documentsEmptyDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.documentsDropHint')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeEnabled()
    expect(
      screen.queryByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":2}',
      }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.metadata' })).toBeEnabled()
    const dataTransfer = { dropEffect: 'none' }
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
    expect(fireEvent(emptyState!, dragOver)).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
  })

  it('keeps the standard document toolbar free of an empty task shortcut', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.metadata' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.tasks' }),
    ).not.toBeInTheDocument()
  })

  it('shows the drop target while dragging and previews dropped files in the upload form', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    const droppedFile = new File(['# handbook'], 'handbook.md', { type: 'text/markdown' })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const documentSurface = screen
      .getByRole('heading', { name: 'dataset.newKnowledge.documents' })
      .closest('section')
    expect(documentSurface).not.toBeNull()
    fireEvent.dragEnter(documentSurface!, {
      dataTransfer: { files: [droppedFile], types: ['Files'] },
    })

    expect(screen.getByText('dataset.newKnowledge.dropFilesHere')).toBeInTheDocument()

    fireEvent.dragLeave(documentSurface!, {
      dataTransfer: { files: [droppedFile], types: ['Files'] },
    })

    expect(screen.queryByText('dataset.newKnowledge.dropFilesHere')).not.toBeInTheDocument()

    fireEvent.dragEnter(documentSurface!, {
      dataTransfer: { files: [droppedFile], types: ['Files'] },
    })
    fireEvent.drop(documentSurface!, {
      dataTransfer: {
        dropEffect: 'copy',
        files: [droppedFile],
        types: ['Files'],
      },
    })

    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.addDocument' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.dropFilesHere')).not.toBeInTheDocument()
    expect(screen.getByText('handbook.md')).toBeInTheDocument()
  })

  it('keeps the designed drop target active over the open upload form', async () => {
    const droppedFile = new File(['# handbook'], 'handbook.md', { type: 'text/markdown' })

    render(<DocumentsPage knowledgeSpaceId="space-1" />, { searchParams: '?upload=1' })

    const documentSurface = screen
      .getByRole('heading', { name: 'dataset.newKnowledge.addDocument' })
      .closest('section')
    expect(documentSurface).not.toBeNull()

    fireEvent.dragEnter(documentSurface!, {
      dataTransfer: { files: [droppedFile], types: ['Files'] },
    })

    expect(screen.getByText('dataset.newKnowledge.dropFilesHere')).toBeInTheDocument()

    fireEvent.drop(documentSurface!, {
      dataTransfer: {
        dropEffect: 'copy',
        files: [droppedFile],
        types: ['Files'],
      },
    })

    expect(screen.queryByText('dataset.newKnowledge.dropFilesHere')).not.toBeInTheDocument()
    expect(await screen.findByText('handbook.md')).toBeInTheDocument()
  })

  it('keeps direct-upload actions unavailable until the deployment is verified', () => {
    systemFeaturesStateMock.uploadEnabled = false

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByLabelText('dataset.newKnowledge.uploadDocuments')).not.toBeInTheDocument()
    const addDocument = screen.getByRole('button', {
      name: 'dataset.newKnowledge.addDocument',
    })
    expect(addDocument).toBeDisabled()
    expect(addDocument).toHaveAccessibleDescription('dataset.cornerLabel.unavailable')
  })

  it('removes the empty-state drop affordance when uploads are unavailable', () => {
    permissionStateMock.datasetKeys = ['dataset.acl.readonly']
    permissionStateMock.spaceKeys = []

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const emptyState = screen.getByText('dataset.newKnowledge.documentsEmptyTitle').parentElement
    expect(emptyState).not.toBeNull()
    expect(screen.queryByText('dataset.newKnowledge.documentsDropHint')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }),
    ).toHaveAttribute('aria-describedby', 'documents-readonly-reason')
    const dataTransfer = {
      dropEffect: 'copy',
      files: [new File(['one'], 'one.md', { type: 'text/markdown' })],
    }
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
    expect(fireEvent(emptyState!, dragOver)).toBe(false)
    expect(dataTransfer.dropEffect).toBe('none')
    expect(
      fireEvent.drop(emptyState!, {
        dataTransfer,
      }),
    ).toBe(false)
    expect(uploadMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('does not expose processing tasks while the document list is empty', () => {
    tasksQuery.data = { pages: [{ items: [task({ id: 'orphaned-running-task' })] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(
      screen.queryByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    ).not.toBeInTheDocument()
  })

  it('keeps every write action unavailable for read-only users', async () => {
    const user = userEvent.setup()
    permissionStateMock.datasetKeys = ['dataset.acl.readonly']
    permissionStateMock.spaceKeys = []
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task()] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('dataset.newKnowledge.documentPermissionRestricted')).toBeVisible()
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
    await user.click(screen.getByRole('button', { name: /dataset\.newKnowledge\.documentActions/ }))
    for (const item of await screen.findAllByRole('menuitem'))
      expect(item).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Escape}')
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('dialog')).getByText(
        'dataset.newKnowledge.documentPermissionRestricted',
      ),
    ).toBeInTheDocument()
  })

  it('does not confuse legacy download-permission failures with KnowledgeFS write access', () => {
    permissionStateMock.error = new Error('permission service unavailable')
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task()] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const addDocument = screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })
    expect(addDocument).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not block task actions while legacy download permission is loading', async () => {
    const user = userEvent.setup()
    permissionStateMock.loading = true
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task()] }] }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeEnabled()
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )

    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()
  })

  it('stages one or multiple files before uploading them through the Dify API contract', async () => {
    const user = userEvent.setup()
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    const input = screen.getByLabelText('dataset.newKnowledge.uploadDocuments')
    expect(input).toHaveAttribute('hidden')
    expect(input).toHaveAttribute('tabindex', '-1')
    expect(input).toHaveAttribute(
      'accept',
      '.csv,.doc,.docx,.eml,.epub,.htm,.html,.json,.jsonl,.markdown,.md,.mdx,.msg,.odt,.pdf,.ppt,.pptx,.properties,.rtf,.text,.txt,.vtt,.xls,.xlsx,.xml',
    )

    await user.upload(input, new File(['one'], 'one.md', { type: 'text/markdown' }))
    await waitFor(() =>
      expect(stageUploadMutation).toHaveBeenCalledWith(
        {
          body: { file: expect.objectContaining({ name: 'one.md' }) },
        },
        { signal: expect.any(AbortSignal) },
      ),
    )
    await waitForDocumentFilesStaged()
    expect(uploadMutation.mutateAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    expect(uploadMutation.mutateAsync).toHaveBeenCalledWith({
      body: { upload_id: 'staged-one.md' },
      params: { control_space_id: 'space-1' },
    })

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    const multipleInput = screen.getByLabelText('dataset.newKnowledge.uploadDocuments')
    await user.upload(multipleInput, [
      new File(['two'], 'two.md', { type: 'text/markdown' }),
      new File(['three'], 'three.txt', { type: 'text/plain' }),
    ])
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    expect(uploadMutation.mutateAsync).toHaveBeenCalledTimes(3)
    expect(queryClient.invalidateQueries).toHaveBeenCalled()
    const documentInvalidation = queryClient.invalidateQueries.mock.calls.find(
      ([options]) => options.queryKey[1] === 'documents',
    )?.[0]
    expect(
      documentInvalidation?.predicate({
        queryKey: [
          ['console', 'knowledgeFs', 'getKnowledgeSpacesByIdLogicalDocuments'],
          { input: { params: { control_space_id: 'space-1' } }, type: 'infinite' },
        ],
      }),
    ).toBe(true)
    expect(
      documentInvalidation?.predicate({
        queryKey: [
          ['console', 'knowledgeFs', 'getKnowledgeSpacesByIdLogicalDocuments'],
          { input: { params: { control_space_id: 'space-2' } }, type: 'infinite' },
        ],
      }),
    ).toBe(false)
  })

  it('shows progress on only the staged file currently being uploaded', async () => {
    const user = userEvent.setup()
    let resolveFirstUpload!: (value: unknown) => void
    let resolveSecondUpload!: (value: unknown) => void
    uploadMutation.mutateAsync
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstUpload = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondUpload = resolve
          }),
      )

    render(<DocumentsPage knowledgeSpaceId="space-1" />, { searchParams: '?upload=1' })
    await user.upload(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), [
      new File(['one'], 'one.pdf', { type: 'application/pdf' }),
      new File(['two'], 'two.pdf', { type: 'application/pdf' }),
    ])
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))

    const uploadRegion = screen.getByRole('region', {
      name: 'dataset.newKnowledge.uploadDocuments',
    })
    const [firstRow, secondRow] = within(uploadRegion).getAllByRole('listitem')
    if (!firstRow || !secondRow) throw new Error('Expected two staged upload rows')
    await waitFor(() => expect(firstRow).toHaveAttribute('aria-busy', 'true'))
    expect(within(firstRow).getByText('dataset.newKnowledge.uploadingFiles')).toBeVisible()
    expect(secondRow).not.toHaveAttribute('aria-busy')

    await act(async () => resolveFirstUpload({}))
    await waitFor(() => expect(secondRow).toHaveAttribute('aria-busy', 'true'))
    expect(firstRow).not.toHaveAttribute('aria-busy')
    expect(within(secondRow).getByText('dataset.newKnowledge.uploadingFiles')).toBeVisible()

    await act(async () => resolveSecondUpload({}))
  })

  it('previews a browser-supported staged document from its local file', async () => {
    const user = userEvent.setup()
    const file = new File(['local content'], 'handbook.pdf', { type: 'application/pdf' })
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:handbook')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null)

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    await user.upload(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), file)
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.preview' }))

    const preview = await screen.findByRole('button', { name: 'PDF preview' })
    expect(preview).toHaveAttribute('data-url', 'blob:handbook')
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect((createObjectUrl.mock.calls[0]?.[0] as Blob).type).toBe('application/pdf')
    expect(open).not.toHaveBeenCalled()
    expect(uploadMutation.mutateAsync).not.toHaveBeenCalled()

    await user.click(preview)
    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith('blob:handbook'))
  })

  it('does not offer a local preview for an Office document', () => {
    const file = new File(['local content'], 'handbook.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    fireEvent.change(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), {
      target: { files: [file] },
    })

    expect(screen.queryByRole('button', { name: 'dataset.newKnowledge.preview' })).toBeNull()
  })

  it('prompts for model setup before uploading staged documents', async () => {
    const user = userEvent.setup()
    settingsState.configurationState = 'setup-required'
    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadDocuments'),
      new File(['one'], 'one.md', { type: 'text/markdown' }),
    )
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))

    expect(uploadMutation.mutateAsync).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', {
      name: 'dataset.newKnowledge.overview.attention.modelReadiness.title',
    })
    await user.click(
      within(dialog).getByRole('button', {
        name: 'common.modelProvider.selector.configure',
      }),
    )
    expect(routerMock.push).toHaveBeenCalledWith(
      '/datasets/new/space-1/settings?returnTo=%2Fdatasets%2Fnew%2Fspace-1%2Fdocuments&capability=ingest',
    )
  })

  it('waits for an authoritative model setup check before uploading', async () => {
    const user = userEvent.setup()
    let resolveSettingsCheck!: (result: {
      data: {
        active_profile_available: true
        active_profile_revisions: { embedding: 1; retrieval: 1 }
        capabilities: {
          deep: true
          index: true
          ingest: true
          query: true
          research: true
          source_sync: true
        }
        configuration_state: 'active'
        embedding: null
        issues: []
        retrieval: null
        revision: number
      }
      isError: false
    }) => void
    settingsState.refetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSettingsCheck = resolve
      }),
    )
    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadDocuments'),
      new File(['one'], 'one.md', { type: 'text/markdown' }),
    )
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))

    expect(settingsState.refetch).toHaveBeenCalledWith({ cancelRefetch: false })
    expect(uploadMutation.mutateAsync).not.toHaveBeenCalled()

    await act(async () =>
      resolveSettingsCheck({
        data: {
          active_profile_available: true,
          active_profile_revisions: { embedding: 1, retrieval: 1 },
          capabilities: {
            deep: true,
            index: true,
            ingest: true,
            query: true,
            research: true,
            source_sync: true,
          },
          configuration_state: 'active',
          embedding: null,
          issues: [],
          retrieval: null,
          revision: 1,
        },
        isError: false,
      }),
    )
    await waitFor(() => expect(uploadMutation.mutateAsync).toHaveBeenCalledOnce())
  })

  it('fails closed when the model setup check cannot be refreshed', async () => {
    const user = userEvent.setup()
    settingsState.refetch.mockResolvedValueOnce({ data: undefined, isError: true })
    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadDocuments'),
      new File(['one'], 'one.md', { type: 'text/markdown' }),
    )
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))

    expect(uploadMutation.mutateAsync).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith('common.api.actionFailed')
  })

  it('discards a staged upload without claiming it', async () => {
    const user = userEvent.setup()
    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadDocuments'),
      new File(['draft'], 'draft.md', { type: 'text/markdown' }),
    )
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(uploadMutation.mutateAsync).not.toHaveBeenCalled()
    expect(discardStagedUploadMutation).toHaveBeenCalledWith('staged-draft.md')
    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.documents' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('dataset.newKnowledge.uploadDocuments')).not.toBeInTheDocument()
  })

  it('times out an exact 15 MiB staging request and discards a late success', async () => {
    vi.useFakeTimers()
    let resolveStaging!: (value: { id: string }) => void
    let stagingSignal: AbortSignal | undefined
    stageUploadMutation.mockImplementationOnce(
      (_input: unknown, options: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          stagingSignal = options.signal
          resolveStaging = resolve
        }),
    )
    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />, {
      searchParams: '?upload=1',
    })

    try {
      const maxSizeFile = new File(['boundary'], 'boundary.txt', { type: 'text/plain' })
      Object.defineProperty(maxSizeFile, 'size', { value: 15 * 1024 * 1024 })
      fireEvent.change(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), {
        target: { files: [maxSizeFile] },
      })

      expect(stageUploadMutation).toHaveBeenCalledOnce()
      expect(stagingSignal?.aborted).toBe(false)

      await act(async () => {
        vi.advanceTimersByTime(30_000)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(stagingSignal?.aborted).toBe(true)
      expect(toastMock.error).toHaveBeenCalledOnce()
      expect(toastMock.error).toHaveBeenCalledWith('dataset.newKnowledge.documentUploadFailed')
      expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeEnabled()
      expect(screen.getByRole('listitem')).not.toHaveAttribute('aria-busy')

      await act(async () => {
        resolveStaging({ id: 'late-boundary-upload' })
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(discardStagedUploadMutation).toHaveBeenCalledOnce()
      expect(discardStagedUploadMutation).toHaveBeenCalledWith('late-boundary-upload')
      expect(toastMock.error).toHaveBeenCalledOnce()
      expect(uploadMutation.mutateAsync).not.toHaveBeenCalled()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('cancels exact 15 MiB staging and ignores a late failure', async () => {
    const user = userEvent.setup()
    let rejectStaging!: (reason: unknown) => void
    let stagingSignal: AbortSignal | undefined
    stageUploadMutation.mockImplementationOnce(
      (_input: unknown, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          stagingSignal = options.signal
          rejectStaging = reject
        }),
    )
    render(<DocumentsPage knowledgeSpaceId="space-1" />, { searchParams: '?upload=1' })
    const maxSizeFile = new File(['draft'], 'draft.txt', { type: 'text/plain' })
    Object.defineProperty(maxSizeFile, 'size', { value: 15 * 1024 * 1024 })
    fireEvent.change(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), {
      target: { files: [maxSizeFile] },
    })

    expect(stageUploadMutation).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(stagingSignal?.aborted).toBe(true)
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.documents' }),
    ).toBeInTheDocument()

    await act(async () => {
      rejectStaging(new Error('late staging failure'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(discardStagedUploadMutation).not.toHaveBeenCalled()
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(uploadMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('reports a real staging failure when another file in the batch is canceled', async () => {
    const user = userEvent.setup()
    const canceledFile = new File(['cancel'], 'cancel.txt', { type: 'text/plain' })
    const failedFile = new File(['fail'], 'fail.txt', { type: 'text/plain' })
    let canceledSignal: AbortSignal | undefined
    let rejectFailedStaging!: (reason: unknown) => void
    stageUploadMutation.mockImplementation(
      ({ body }: { body: { file: File } }, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (body.file === canceledFile) canceledSignal = options.signal
          if (body.file === failedFile) rejectFailedStaging = reject
        }),
    )
    render(<DocumentsPage knowledgeSpaceId="space-1" />, { searchParams: '?upload=1' })
    fireEvent.change(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), {
      target: { files: [canceledFile, failedFile] },
    })

    expect(stageUploadMutation).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'common.operation.remove · cancel.txt' }))
    expect(canceledSignal?.aborted).toBe(true)

    await act(async () => {
      rejectFailedStaging(new Error('staging service unavailable'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(toastMock.error).toHaveBeenCalledOnce()
    expect(toastMock.error).toHaveBeenCalledWith('dataset.newKnowledge.documentUploadFailed')
    expect(uploadMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('excludes unsupported files locally while uploading valid files', async () => {
    const user = userEvent.setup()
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const validFile = new File(['one'], 'one.md', { type: 'text/markdown' })
    const unsupportedFile = new File(['two'], 'two.exe', {
      type: 'application/octet-stream',
    })

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    fireEvent.change(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), {
      target: { files: [validFile, unsupportedFile] },
    })
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))

    await waitFor(() =>
      expect(uploadMutation.mutateAsync).toHaveBeenCalledWith({
        body: { upload_id: 'staged-one.md' },
        params: { control_space_id: 'space-1' },
      }),
    )
  })

  it('rejects empty files locally while staging a one-byte file from a mixed selection', async () => {
    const user = userEvent.setup()
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const emptyFile = new File([], 'empty.txt', { type: 'text/plain' })
    const oneByteFile = new File(['x'], 'one-byte.txt', { type: 'text/plain' })

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    await user.upload(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), [
      emptyFile,
      oneByteFile,
    ])

    expect(
      screen.getByText(/dataset\.newKnowledge\.selectedFiles:.*"total":2.*"valid":1/),
    ).toBeVisible()
    expect(screen.getByText('dataset.newKnowledge.documentUploadExclusion.fileEmpty')).toBeVisible()
    await waitFor(() =>
      expect(stageUploadMutation).toHaveBeenCalledWith(
        {
          body: { file: expect.objectContaining({ name: 'one-byte.txt', size: 1 }) },
        },
        { signal: expect.any(AbortSignal) },
      ),
    )
    expect(stageUploadMutation).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeEnabled()
  })

  it('rejects oversized files before invoking an upload contract', async () => {
    const user = userEvent.setup()
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const oversizedFile = new File(['one'], 'oversized.pdf', { type: 'application/pdf' })
    Object.defineProperty(oversizedFile, 'size', { value: 16 * 1024 * 1024 })

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    fireEvent.change(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), {
      target: { files: [oversizedFile] },
    })

    expect(uploadMutation.mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeDisabled()
    expect(
      screen.getByText(/dataset\.newKnowledge\.documentUploadExclusion\.fileSize:.*"size":15/),
    ).toBeVisible()
  })

  it('accepts files within the workspace knowledge file size limit', async () => {
    const user = userEvent.setup()
    fileUploadConfigMock.knowledgeFileSizeLimit = 50
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const file = new File(['one'], 'handbook.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 })

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    fireEvent.change(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), {
      target: { files: [file] },
    })

    await waitFor(() =>
      expect(stageUploadMutation).toHaveBeenCalledWith(
        {
          body: { file: expect.objectContaining({ name: 'handbook.pdf' }) },
        },
        { signal: expect.any(AbortSignal) },
      ),
    )
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeEnabled()
    expect(
      screen.queryByText(/dataset\.newKnowledge\.documentUploadExclusion\.fileSize/),
    ).toBeNull()
  })

  it('rejects empty files locally with a field-level reason', async () => {
    const user = userEvent.setup()
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const emptyFile = new File([], 'empty.txt', { type: 'text/plain' })

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    fireEvent.change(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), {
      target: { files: [emptyFile] },
    })

    expect(stageUploadMutation).not.toHaveBeenCalled()
    expect(uploadMutation.mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeDisabled()
    expect(screen.getByText('dataset.newKnowledge.documentUploadExclusion.fileEmpty')).toBeVisible()
  })

  it('reports local exclusions and API upload failures', async () => {
    const user = userEvent.setup()
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const oversizedFile = new File(['large'], 'too-large.pdf', { type: 'application/pdf' })
    Object.defineProperty(oversizedFile, 'size', { value: 16 * 1024 * 1024 })

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    const input = screen.getByLabelText('dataset.newKnowledge.uploadDocuments')
    await user.upload(input, [
      new File(['one'], 'one.md', { type: 'text/markdown' }),
      oversizedFile,
    ])
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))

    queryClient.invalidateQueries.mockClear()
    uploadMutation.mutateAsync.mockRejectedValueOnce(new Error('quota exceeded'))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    await user.upload(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), [
      new File(['one'], 'one.md', { type: 'text/markdown' }),
      new File(['two'], 'two.md', { type: 'text/markdown' }),
    ])
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    expect(toastMock.error).toHaveBeenCalledWith('dataset.newKnowledge.documentUploadFailed')
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
    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' }))

    documentsQuery.error = new Error('background refresh failed')
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.getByText('sso-enterprise.pdf')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.documentsErrorDescription',
    )
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    const actions = screen.getByRole('group', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })
    expect(
      within(actions).getByRole('button', {
        name: 'dataset.newKnowledge.reindexDocuments',
      }),
    ).toHaveAttribute('aria-describedby', 'document-reindex-unavailable')
    expect(
      within(actions).getByText(
        'dataset.newKnowledge.reindexDocuments · dataset.newKnowledge.documentsErrorDescription',
      ),
    ).toBeVisible()
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

  it('does not expose a KnowledgeFS permission retry for legacy download refreshes', () => {
    permissionStateMock.error = new Error('permission refresh failed')
    permissionStateMock.fetching = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeEnabled()
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
          { input: { params: { control_space_id: 'space-1' } }, type: 'infinite' },
        ],
      }),
    ).toBe(true)
    expect(
      taskCancellation?.predicate({
        queryKey: [
          ['console', 'knowledgeFs', 'getKnowledgeSpacesByIdProcessingTasks'],
          { input: { params: { control_space_id: 'space-2' } }, type: 'infinite' },
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
        'dataset.newKnowledge.addDocument · dataset.newKnowledge.documentColumn',
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
    expect(tasksQuery.fetchNextPage).not.toHaveBeenCalled()
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

  it('keeps document state actionable while an older task page is loading', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [], nextCursor: 'next' }] }
    tasksQuery.hasNextPage = true
    tasksQuery.isFetchingNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const documentRow = screen.getByRole('row', { name: /sso-enterprise\.pdf/ })
    expect(
      within(documentRow).getByText('dataset.newKnowledge.documentStatus.ready'),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).not.toHaveAttribute(
      'aria-disabled',
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

  it('re-indexes selected documents and keeps the designed bulk action order', async () => {
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
      screen.getByRole('heading', { name: 'dataset.newKnowledge.documents' }).closest('section'),
    ).toHaveClass('pb-[calc(7rem+env(safe-area-inset-bottom,0px))]')
    expect(
      within(actions).getByText('dataset.newKnowledge.documentsSelected:{"count":1}'),
    ).toBeInTheDocument()
    const reindex = within(actions).getByRole('button', {
      name: 'dataset.newKnowledge.reindexDocuments',
    })
    expect(reindex).toBeEnabled()
    const orderedActions = within(actions).getAllByRole('button')
    expect(orderedActions[0]).toHaveAccessibleName('dataset.newKnowledge.reindexDocuments')
    expect(orderedActions[1]).toHaveAccessibleName('dataset.newKnowledge.downloadDocuments')
    expect(orderedActions[1]).toBeEnabled()
    expect(orderedActions[2]).toHaveAccessibleName('dataset.newKnowledge.disableSource')
    expect(orderedActions[2]).toBeEnabled()
    expect(orderedActions[3]).toHaveAccessibleName('common.operation.remove')
    expect(orderedActions[3]).toBeEnabled()
    expect(orderedActions[4]).toHaveAccessibleName('dataset.newKnowledge.clearDocumentSelection')
    expect(actions.firstElementChild).toHaveTextContent(
      'dataset.newKnowledge.documentsSelected:{"count":1}',
    )
    await user.dblClick(reindex)
    expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
    expect(reindexMutation.mutateAsync).toHaveBeenCalledWith({
      body: { documentIds: ['one'] },
      params: { control_space_id: 'space-1' },
    })
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'dataset.newKnowledge.documents' })).toHaveFocus(),
    )
  })

  it.each([
    ['queued', 'queued'],
    ['processing', 'running'],
  ] as const)(
    'locks bulk re-index, download, and availability actions for a %s document',
    async (_status, taskState) => {
      const user = userEvent.setup()
      documentsQuery.data = {
        pages: [{ items: [document({ id: 'one', title: 'One.pdf' })] }],
      }
      tasksQuery.data = {
        pages: [{ items: [task({ documentId: 'one', state: taskState })] }],
      }

      render(<DocumentsPage knowledgeSpaceId="space-1" />)
      await user.click(screen.getByRole('checkbox', { name: 'One.pdf' }))
      const actions = screen.getByRole('group', {
        name: 'dataset.newKnowledge.bulkDocumentActions',
      })

      expect(
        within(actions).getByRole('button', { name: 'dataset.newKnowledge.reindexDocuments' }),
      ).toBeDisabled()
      expect(
        within(actions).getByRole('button', { name: 'dataset.newKnowledge.downloadDocuments' }),
      ).toBeDisabled()
      expect(
        within(actions).getByRole('button', { name: 'dataset.newKnowledge.disableSource' }),
      ).toBeDisabled()
      expect(within(actions).getByRole('button', { name: 'common.operation.remove' })).toBeEnabled()
    },
  )

  it('does not offer a bulk availability action for failed documents', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'failed', status: 'failed', title: 'Failed.pdf' })] }],
    }
    tasksQuery.data = {
      pages: [{ items: [task({ documentId: 'failed', state: 'failed' })] }],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'Failed.pdf' }))
    const actions = screen.getByRole('group', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })

    expect(
      within(actions).queryByRole('button', { name: 'dataset.newKnowledge.disableSource' }),
    ).not.toBeInTheDocument()
    expect(within(actions).getByRole('button', { name: 'common.operation.remove' })).toBeEnabled()
  })

  it('disables selected documents through the bulk availability API', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({ id: 'one', rowVersion: 2, title: 'One.pdf' }),
            document({ id: 'two', rowVersion: 4, title: 'Two.pdf' }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'One.pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Two.pdf' }))

    const actions = screen.getByRole('group', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })
    expect(
      within(actions).getByRole('button', { name: 'dataset.newKnowledge.downloadDocuments' }),
    ).toBeEnabled()
    await user.click(
      within(actions).getByRole('button', { name: 'dataset.newKnowledge.disableSource' }),
    )

    expect(bulkUpdateLogicalDocumentsMutation).toHaveBeenCalledWith({
      body: {
        documents: [
          { documentId: 'one', expectedRowVersion: 2 },
          { documentId: 'two', expectedRowVersion: 4 },
        ],
        enabled: false,
      },
      params: { control_space_id: 'space-1' },
    })
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'dataset.newKnowledge.bulkDocumentActions' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('re-enables selected disabled documents through the bulk availability API', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({ enabled: false, id: 'one', rowVersion: 3, title: 'One.pdf' }),
            document({ enabled: false, id: 'two', rowVersion: 7, title: 'Two.pdf' }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'One.pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Two.pdf' }))
    const actions = screen.getByRole('group', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })
    await user.click(within(actions).getByRole('button', { name: 'dataset.enable' }))

    expect(bulkUpdateLogicalDocumentsMutation).toHaveBeenCalledWith({
      body: {
        documents: [
          { documentId: 'one', expectedRowVersion: 3 },
          { documentId: 'two', expectedRowVersion: 7 },
        ],
        enabled: true,
      },
      params: { control_space_id: 'space-1' },
    })
  })

  it('does not submit availability updates for more than 100 selected documents', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: Array.from({ length: 101 }, (_, index) =>
            document({ id: `document-${index}`, title: `Document ${index}.pdf` }),
          ),
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAllDocuments' }),
    )
    const actions = screen.getByRole('group', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })

    expect(
      within(actions).getByRole('button', { name: 'dataset.newKnowledge.disableSource' }),
    ).toBeDisabled()
    expect(bulkUpdateLogicalDocumentsMutation).not.toHaveBeenCalled()
  })

  it('refreshes documents after an availability row-version conflict', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    updateLogicalDocumentMutation.mockRejectedValueOnce({ status: 409 })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: /dataset\.newKnowledge\.documentActions/ }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'dataset.newKnowledge.disableSource' }),
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalled()
    expect(toastMock.warning).toHaveBeenCalledWith('dataset.newKnowledge.taskActionFailed')
  })

  it('downloads selected active revisions as a ZIP archive', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({ id: 'one', title: 'One.pdf' }),
            document({ id: 'two', title: 'Two.pdf' }),
          ],
        },
      ],
    }
    const archive = new File(['documents'], 'space-1-documents.zip', {
      type: 'application/zip',
    })
    downloadDocumentsMutation.mockResolvedValue(archive)

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'One.pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Two.pdf' }))
    const actions = screen.getByRole('group', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })
    await user.click(
      within(actions).getByRole('button', { name: 'dataset.newKnowledge.downloadDocuments' }),
    )

    expect(downloadDocumentsMutation).toHaveBeenCalledWith({
      body: { document_ids: ['one', 'two'] },
      params: { control_space_id: 'space-1' },
    })
    expect(downloadBlobMock).toHaveBeenCalledWith({
      data: archive,
      fileName: 'space-1-documents.zip',
    })
  })

  it('downloads selected failed documents without active revisions as a ZIP archive', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({
              active: null,
              activeRevision: undefined,
              id: 'failed',
              status: 'failed',
              title: 'Failed.pdf',
            }),
          ],
        },
      ],
    }
    tasksQuery.data = {
      pages: [
        {
          items: [task({ documentId: 'failed', documentRevision: 1, state: 'failed' })],
        },
      ],
    }
    const archive = new File(['documents'], 'failed-documents.zip', {
      type: 'application/zip',
    })
    downloadDocumentsMutation.mockResolvedValue(archive)

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'Failed.pdf' }))
    const actions = screen.getByRole('group', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })
    const download = within(actions).getByRole('button', {
      name: 'dataset.newKnowledge.downloadDocuments',
    })
    expect(download).toBeEnabled()
    await user.click(download)

    expect(downloadDocumentsMutation).toHaveBeenCalledWith({
      body: { document_ids: ['failed'] },
      params: { control_space_id: 'space-1' },
    })
    expect(downloadBlobMock).toHaveBeenCalledWith({
      data: archive,
      fileName: 'failed-documents.zip',
    })
  })

  it('disables bulk download when any selected document is pending', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({ id: 'ready', title: 'Ready.pdf' }),
            document({
              active: null,
              activeRevision: undefined,
              id: 'pending',
              status: 'pending',
              title: 'Pending.pdf',
            }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'Ready.pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Pending.pdf' }))

    const actions = screen.getByRole('group', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })
    expect(
      within(actions).getByRole('button', { name: 'dataset.newKnowledge.downloadDocuments' }),
    ).toBeDisabled()
    expect(downloadDocumentsMutation).not.toHaveBeenCalled()
  })

  it('disables bulk download when more than 100 documents are selected', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: Array.from({ length: 101 }, (_, index) =>
            document({ id: `document-${index}`, title: `Document ${index}.pdf` }),
          ),
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('checkbox', { name: 'dataset.newKnowledge.selectAllDocuments' }),
    )

    const actions = screen.getByRole('group', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })
    expect(
      within(actions).getByRole('button', { name: 'dataset.newKnowledge.downloadDocuments' }),
    ).toBeDisabled()
    expect(downloadDocumentsMutation).not.toHaveBeenCalled()
  })

  it('removes selected documents through one bulk deletion request', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({ id: 'one', rowVersion: 2, title: 'One.pdf' }),
            document({ id: 'two', rowVersion: 4, title: 'Two.pdf' }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'One.pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Two.pdf' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))

    expect(bulkRemoveDocumentsMutation).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(bulkRemoveDocumentsMutation).toHaveBeenCalledOnce()
    expect(bulkRemoveDocumentsMutation).toHaveBeenCalledWith({
      body: {
        documents: [
          { documentId: 'one', expectedRevision: 2 },
          { documentId: 'two', expectedRevision: 4 },
        ],
      },
      headers: { 'Idempotency-Key': expect.any(String) },
      params: { control_space_id: 'space-1' },
    })
    expect(removeDocumentMutation).not.toHaveBeenCalled()
  })

  it('prompts for model setup before re-indexing selected documents', async () => {
    const user = userEvent.setup()
    settingsState.configurationState = 'setup-required'
    documentsQuery.data = {
      pages: [{ items: [document({ id: 'one', title: 'One.pdf' })] }],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'One.pdf' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocuments' }))

    expect(reindexMutation.mutateAsync).not.toHaveBeenCalled()
    expect(
      screen.getByRole('dialog', {
        name: 'dataset.newKnowledge.overview.attention.modelReadiness.title',
      }),
    ).toBeInTheDocument()
  })

  it('explains why re-indexing becomes unavailable while results refresh', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' }))

    tasksQuery.data = undefined
    tasksQuery.isPending = true
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    const actions = screen.getByRole('group', {
      name: 'dataset.newKnowledge.bulkDocumentActions',
    })
    expect(
      within(actions).getByRole('button', { name: 'dataset.newKnowledge.reindexDocuments' }),
    ).toHaveAttribute('aria-describedby', 'document-reindex-unavailable')
    expect(
      within(actions).getByText('dataset.newKnowledge.reindexDocuments · common.loading'),
    ).toBeVisible()

    tasksQuery.data = { pages: [{ items: [] }] }
    tasksQuery.isPending = false
    sourcesQuery.data = { pages: [{ items: [] }] }
    sourcesQuery.error = new Error('source refresh failed')
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(
      within(actions).getByText(
        'dataset.newKnowledge.reindexDocuments · dataset.newKnowledge.sourcesErrorDescription',
      ),
    ).toBeVisible()
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

  it('keeps concurrently disabled documents selected after a partial bulk re-index result', async () => {
    const user = userEvent.setup()
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({ id: 'one', title: 'One.pdf' }),
            document({ id: 'disabled', title: 'Disabled.pdf' }),
          ],
        },
      ],
    }
    reindexMutation.mutateAsync.mockResolvedValue({
      bulkJobId: 'reindex-partial-disabled',
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
        { documentId: 'disabled', status: 'disabled' },
      ],
      total: 2,
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('checkbox', { name: 'One.pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Disabled.pdf' }))
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.reindexDocuments' }))

    expect(screen.getByRole('checkbox', { name: 'One.pdf' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Disabled.pdf' })).toBeChecked()
    expect(toastMock.warning).toHaveBeenCalledWith('dataset.newKnowledge.documentsReindexFailed')
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
            task({ id: 'running', progressCompleted: 1, progressTotal: 3 }),
            task({
              id: 'failed',
              state: 'failed',
              errorMessage: 'Parser failed',
              progressCompleted: 8,
              progressTotal: 12,
            }),
            task({
              canRetry: true,
              id: 'canceled',
              state: 'canceled',
              progressCompleted: 2,
              progressTotal: 5,
            }),
            task({ id: 'done', state: 'succeeded' }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    const trigger = screen.getByRole('button', {
      name: 'dataset.newKnowledge.tasksWithAttention:{"count":3}',
    })
    expect(trigger).toHaveTextContent('3')
    expect(trigger).toHaveAttribute('data-has-error', 'true')
    await user.click(trigger)
    const panel = screen.getByRole('dialog', { name: 'dataset.newKnowledge.backgroundTasks' })
    expect(
      within(panel).getByText('dataset.newKnowledge.backgroundTasksDescription'),
    ).toBeInTheDocument()
    expect(within(panel).getByText('dataset.newKnowledge.taskFailure.internal')).toBeInTheDocument()
    expect(
      within(panel).getByText((_, element) =>
        Boolean(
          element?.tagName === 'P' &&
          element.textContent?.includes('1/3') &&
          element.textContent.includes('—'),
        ),
      ),
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole('button', {
        name: /dataset\.newKnowledge\.retryTask.*canceled/,
      }),
    ).toBeInTheDocument()
  })

  it('shows document, bulk re-index, and source tasks returned by the task list', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({ id: 'document-task', state: 'succeeded' }),
            backgroundTask({ id: 'reindex-task', progressCompleted: 12, progressTotal: 12 }),
            backgroundTask({
              errorMessage: 'Source sync failed',
              id: 'source-task',
              operation: 'source_sync',
              sourceId: 'source-1',
              state: 'failed',
              taskKind: 'source',
            }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )

    const panel = screen.getByRole('dialog', { name: 'dataset.newKnowledge.backgroundTasks' })
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3)
    expect(
      within(panel).getByText('dataset.newKnowledge.reindexDocuments · 12'),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText(
        'dataset.newKnowledge.overview.operation.source_sync · Notion support SOP',
      ),
    ).toBeInTheDocument()
    expect(within(panel).getByText('dataset.newKnowledge.taskFailure.internal')).toBeInTheDocument()
  })

  it('shows a single deletion document title and its checkpoint progress', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = {
      pages: [
        {
          items: [
            backgroundTask({
              documentId: 'deleted-document',
              documentTitle: 'dify使用问题反馈.xlsx',
              id: 'delete-task',
              operation: 'document_delete',
              progressCompleted: 0,
              progressPercent: 10,
              progressTotal: 1,
              state: 'running',
            }),
          ],
        },
      ],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )

    const panel = screen.getByRole('dialog', { name: 'dataset.newKnowledge.backgroundTasks' })
    expect(
      within(panel).getByText(
        'dataset.newKnowledge.overview.operation.document_delete · dify使用问题反馈.xlsx',
      ),
    ).toBeInTheDocument()
    expect(within(panel).getByText((content) => content.startsWith('10%'))).toBeInTheDocument()
    expect(
      within(panel).queryByText('dataset.newKnowledge.overview.operation.document_delete · 1'),
    ).not.toBeInTheDocument()
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
        name: 'dataset.newKnowledge.interruptTask · dataset.newKnowledge.addDocument · Alpha.pdf · task-a',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.interruptTask · dataset.newKnowledge.addDocument · Beta.pdf · task-b',
      }),
    ).toBeInTheDocument()
  })

  it('shows task loading instead of an empty result while the task query is pending', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ state: 'running' })] }] }
    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )

    tasksQuery.data = undefined
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
      params: {
        control_space_id: 'space-1',
        task_id: 'running',
        task_kind: 'document',
      },
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
      name: 'dataset.newKnowledge.interruptTask · dataset.newKnowledge.addDocument · sso-enterprise.pdf · new-action',
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
        name: 'dataset.newKnowledge.interruptTask · dataset.newKnowledge.addDocument · sso-enterprise.pdf · pending-action',
      }),
    )
    const nextAction = screen.getByRole('button', {
      name: 'dataset.newKnowledge.interruptTask · dataset.newKnowledge.addDocument · sso-enterprise.pdf · focus-target',
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

    expect(screen.getByText(/45%/)).toBeInTheDocument()
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

  it('offers retry for an interrupted task when the operation is retryable', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document({})] }] }
    tasksQuery.data = {
      pages: [{ items: [task({ canRetry: true, id: 'canceled', state: 'canceled' })] }],
    }

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))
    expect(retryMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ task_id: 'canceled', task_kind: 'document' }),
      }),
    )
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
    expect(
      await screen.findByText('dataset.newKnowledge.taskFailure.temporary'),
    ).toBeInTheDocument()
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

    expect(await screen.findByText('dataset.newKnowledge.taskFailure.internal')).toBeInTheDocument()
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
    expect(
      await screen.findByText('dataset.newKnowledge.taskFailure.temporary'),
    ).toBeInTheDocument()

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

    const error = await screen.findByText('dataset.newKnowledge.taskFailure.temporary')
    expect(error).toHaveClass('whitespace-pre-wrap', 'wrap-break-word')
    expect(error).not.toHaveClass('truncate')
  })

  it('hides cached documents and closes tasks when terminal reconciliation loses read access', async () => {
    const user = userEvent.setup()
    let releaseStream!: () => void
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve
    })
    let resolveDocumentsRefetch!: (result: { error: null }) => void
    documentsQuery.data = { pages: [{ items: [document()] }] }
    documentsQuery.refetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDocumentsRefetch = resolve
        }),
    )
    tasksQuery.data = { pages: [{ items: [task({ id: 'forbidden-reconciliation' })] }] }
    getTaskSnapshot.mockRejectedValue(new Response(null, { status: 403 }))
    streamProcessingTaskEvents.mockImplementation(async function* () {
      await streamGate
      yield {
        data: {
          progressPercent: 80,
          stage: 'parsed' as const,
          state: 'failed' as const,
          updatedAt: '2026-07-20T10:03:00Z',
        },
        event: 'progress' as const,
        id: 'forbidden-reconciliation:progress',
      }
      yield {
        data: { errorCode: 'PARSER_FAILED', state: 'failed' as const },
        event: 'terminal' as const,
        id: 'forbidden-reconciliation:terminal',
      }
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => releaseStream())

    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'dataset.newKnowledge.documentsPermissionDescription',
      ),
    )
    expect(screen.queryByText('sso-enterprise.pdf')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(documentsQuery.refetch).toHaveBeenCalledWith({ cancelRefetch: true })

    await act(async () => resolveDocumentsRefetch({ error: null }))
    expect(await screen.findByText('sso-enterprise.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('blocks failed polling for a task version denied during terminal reconciliation', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = { pages: [{ items: [task({ id: 'denied-terminal-version' })] }] }
    getTaskSnapshot.mockRejectedValue(new Response(null, { status: 403 }))
    streamFailedTaskThenWait('denied-terminal-version')

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => {})
      expect(getTaskSnapshot).toHaveBeenCalledOnce()

      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('hides cached documents and closes tasks when the task event stream loses read access', async () => {
    const user = userEvent.setup()
    let rejectStream!: () => void
    const streamGate = new Promise<void>((_resolve, reject) => {
      rejectStream = () => reject(new Response(null, { status: 403 }))
    })
    let resolveDocumentsRefetch!: (result: { error: null }) => void
    documentsQuery.data = { pages: [{ items: [document()] }] }
    documentsQuery.refetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDocumentsRefetch = resolve
        }),
    )
    tasksQuery.data = { pages: [{ items: [task({ id: 'forbidden-stream' })] }] }
    streamProcessingTaskEvents.mockImplementation(async function* () {
      await streamGate
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => rejectStream())

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'dataset.newKnowledge.documentsPermissionDescription',
      ),
    )
    expect(screen.queryByText('sso-enterprise.pdf')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(documentsQuery.refetch).toHaveBeenCalledWith({ cancelRefetch: true })

    await act(async () => resolveDocumentsRefetch({ error: null }))
    expect(await screen.findByText('sso-enterprise.pdf')).toBeInTheDocument()
    expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()
  })

  it('does not restart a denied stream version while the task list lags behind progress', async () => {
    let resolveDocumentsRefetch!: (result: { error: null }) => void
    documentsQuery.data = { pages: [{ items: [document()] }] }
    documentsQuery.refetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDocumentsRefetch = resolve
        }),
    )
    tasksQuery.data = {
      pages: [
        {
          items: [task({ id: 'lagging-denied-stream', updatedAt: '2026-07-20T10:01:00Z' })],
        },
      ],
    }
    streamProcessingTaskEvents.mockImplementation(async function* () {
      yield {
        data: {
          progressPercent: 50,
          stage: 'parsed' as const,
          state: 'running' as const,
          updatedAt: '2026-07-20T10:02:00Z',
        },
        event: 'progress' as const,
        id: 'lagging-denied-stream:version-2',
      }
      throw new Response(null, { status: 403 })
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'dataset.newKnowledge.documentsPermissionDescription',
      ),
    )
    expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()

    await act(async () => resolveDocumentsRefetch({ error: null }))
    expect(await screen.findByText('sso-enterprise.pdf')).toBeInTheDocument()
    await act(async () => {})
    expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()
  })

  it('observes a same-version retry after the task list confirms a denied stream terminal', async () => {
    let resolveDocumentsRefetch!: (result: { error: null }) => void
    const deniedVersion = '2026-07-20T10:02:00Z'
    documentsQuery.data = { pages: [{ items: [document()] }] }
    documentsQuery.refetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDocumentsRefetch = resolve
        }),
    )
    tasksQuery.dataUpdateCount = 1
    tasksQuery.data = {
      pages: [
        {
          items: [task({ id: 'same-version-terminal-retry' })],
        },
      ],
    }
    let streamCount = 0
    streamProcessingTaskEvents.mockImplementation(async function* () {
      streamCount += 1
      if (streamCount === 1) {
        yield {
          data: {
            progressPercent: 50,
            stage: 'parsed' as const,
            state: 'running' as const,
            updatedAt: deniedVersion,
          },
          event: 'progress' as const,
          id: 'same-version-terminal-retry:version-2',
        }
        throw new Response(null, { status: 403 })
      }
      await new Promise<void>(() => {})
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() => expect(documentsQuery.refetch).toHaveBeenCalled())
    await act(async () => resolveDocumentsRefetch({ error: null }))

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'same-version-terminal-retry',
              state: 'failed',
              updatedAt: deniedVersion,
            }),
          ],
        },
      ],
    }
    tasksQuery.dataUpdateCount = 2
    act(() => notifyTaskQuerySuccess())
    await act(async () => {})
    expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'same-version-terminal-retry',
              state: 'running',
              updatedAt: deniedVersion,
            }),
          ],
        },
      ],
    }
    tasksQuery.dataUpdateCount = 3
    act(() => notifyTaskQuerySuccess())

    await waitFor(() => expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(2))
  })

  it('restarts an active override after a structurally shared terminal confirmation', async () => {
    const user = userEvent.setup()
    let resolveDocumentsRefetch!: (result: { error: null }) => void
    const taskVersion = '2026-07-20T10:02:00Z'
    const sharedTerminalData = {
      pages: [
        {
          items: [
            task({
              id: 'shared-terminal-confirmation',
              state: 'failed',
              updatedAt: taskVersion,
            }),
          ],
        },
      ],
    }
    documentsQuery.data = { pages: [{ items: [document()] }] }
    documentsQuery.refetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDocumentsRefetch = resolve
        }),
    )
    tasksQuery.data = sharedTerminalData
    tasksQuery.dataUpdateCount = 1
    retryMutation.mutateAsync.mockResolvedValue(
      task({
        id: 'shared-terminal-confirmation',
        state: 'dispatch_pending',
        updatedAt: taskVersion,
      }),
    )
    let streamCount = 0
    streamProcessingTaskEvents.mockImplementation(async function* () {
      streamCount += 1
      if (streamCount === 1) throw new Response(null, { status: 403 })
      await new Promise<void>(() => {})
    })

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }))
    await waitFor(() => expect(documentsQuery.refetch).toHaveBeenCalled())
    expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()
    await act(async () => resolveDocumentsRefetch({ error: null }))

    tasksQuery.data = sharedTerminalData
    tasksQuery.dataUpdateCount = 2
    act(() => notifyTaskQuerySuccess())

    await waitFor(() => expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(2))
  })

  it('single-flights backed-off recovery polling until a denied stream gets a newer version', async () => {
    vi.useFakeTimers()
    let resolveDocumentsRefetch!: (result: { error: null }) => void
    let resolveTaskRefetch!: (result: { error: null }) => void
    documentsQuery.data = { pages: [{ items: [document()] }] }
    documentsQuery.refetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDocumentsRefetch = resolve
        }),
    )
    tasksQuery.dataUpdateCount = 1
    tasksQuery.data = {
      pages: [
        {
          items: [task({ id: 'recovering-stream', updatedAt: '2026-07-20T10:01:00Z' })],
        },
      ],
    }
    let streamCount = 0
    streamProcessingTaskEvents.mockImplementation(async function* () {
      streamCount += 1
      if (streamCount === 1) {
        yield {
          data: {
            progressPercent: 50,
            stage: 'parsed' as const,
            state: 'running' as const,
            updatedAt: '2026-07-20T10:02:00Z',
          },
          event: 'progress' as const,
          id: 'recovering-stream:version-2',
        }
        throw new Response(null, { status: 403 })
      }
      await new Promise<void>(() => {})
    })

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => {})
      expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()
      await act(async () => resolveDocumentsRefetch({ error: null }))
      tasksQuery.refetch.mockClear()
      tasksQuery.data = {
        pages: [
          {
            items: [task({ id: 'recovering-stream', updatedAt: '2026-07-20T10:02:00Z' })],
          },
        ],
      }
      tasksQuery.dataUpdateCount = 2
      act(() => notifyTaskQuerySuccess())
      await act(async () => {})
      tasksQuery.refetch
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveTaskRefetch = resolve
            }),
        )
        .mockResolvedValue({ error: null })

      await act(async () => vi.advanceTimersByTime(5000))
      expect(tasksQuery.refetch).toHaveBeenCalledWith({ cancelRefetch: false })
      expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()
      await act(async () => vi.advanceTimersByTime(120000))
      expect(tasksQuery.refetch).toHaveBeenCalledOnce()

      await act(async () => resolveTaskRefetch({ error: null }))
      for (const delay of [10000, 20000, 30000, 30000, 30000, 30000])
        await act(async () => vi.advanceTimersByTime(delay))
      expect(tasksQuery.refetch).toHaveBeenCalledTimes(7)
      expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()

      tasksQuery.data = {
        pages: [
          {
            items: [task({ id: 'recovering-stream', updatedAt: '2026-07-20T10:03:00Z' })],
          },
        ],
      }
      tasksQuery.dataUpdateCount = 3
      act(() => notifyTaskQuerySuccess())
      await act(async () => {})

      expect(streamProcessingTaskEvents).toHaveBeenCalledTimes(2)
      tasksQuery.refetch.mockClear()
      await act(async () => vi.advanceTimersByTime(60000))
      expect(tasksQuery.refetch).not.toHaveBeenCalled()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('focuses the permission alert when an auxiliary retry becomes a document denial', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    documentsQuery.refetch
      .mockResolvedValueOnce({ error: new Error('verification unavailable') })
      .mockImplementationOnce(() => new Promise(() => {}))
    tasksQuery.data = { pages: [{ items: [task({ id: 'retry-document-denial' })] }] }
    streamProcessingTaskEvents.mockImplementation(async function* () {
      throw new Response(null, { status: 403 })
    })

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    const retry = await screen.findByRole('button', {
      name: 'common.operation.retry · dataset.newKnowledge.documentsPermissionDescription',
    })
    await user.click(retry)

    documentsQuery.error = { status: 403 }
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
    expect(screen.queryByText('sso-enterprise.pdf')).not.toBeInTheDocument()
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
    expect(
      await screen.findByText('dataset.newKnowledge.taskFailure.temporary'),
    ).toBeInTheDocument()
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
    expect(screen.queryByText('dataset.newKnowledge.taskFailure.temporary')).not.toBeInTheDocument()
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
    expect(
      await screen.findByText('dataset.newKnowledge.taskFailure.temporary'),
    ).toBeInTheDocument()
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
    expect(screen.queryByText('dataset.newKnowledge.taskFailure.temporary')).not.toBeInTheDocument()
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
    expect(
      await screen.findByText('dataset.newKnowledge.taskFailure.temporary'),
    ).toBeInTheDocument()
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
    expect(screen.getByText('dataset.newKnowledge.taskFailure.temporary')).toBeInTheDocument()
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
    expect(
      await screen.findByText('dataset.newKnowledge.taskFailure.temporary'),
    ).toBeInTheDocument()
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
    expect(screen.queryByText('dataset.newKnowledge.taskFailure.temporary')).not.toBeInTheDocument()
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

    expect(
      await screen.findByText('dataset.newKnowledge.taskFailure.temporary'),
    ).toBeInTheDocument()
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

  it('refreshes logical documents when task-list polling reports a terminal state', async () => {
    documentsQuery.data = {
      pages: [
        {
          items: [
            document({
              active: null,
              activeRevision: undefined,
              status: 'pending',
            }),
          ],
        },
      ],
    }
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'polled-terminal', state: 'queued' })] }],
    }

    const { rerender } = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(screen.getByText('dataset.newKnowledge.documentStatus.queued')).toBeInTheDocument()
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()

    tasksQuery.data = {
      pages: [
        {
          items: [
            task({
              id: 'polled-terminal',
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
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ['knowledge-fs', 'documents'],
        }),
      ),
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
    await waitFor(() => expect(screen.getByText(/80%/)).toBeInTheDocument())
    await act(async () => {})
    expect(screen.queryByText(/20%/)).not.toBeInTheDocument()
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

  it('rotates a bounded task event stream pool without a duplicate list poller', async () => {
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

  it('does not poll terminal tasks while the background-task drawer is closed', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'closed-drawer-failure', state: 'failed' })] }],
    }

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      await act(async () => vi.advanceTimersByTime(60000))
      expect(getTaskSnapshot).not.toHaveBeenCalled()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
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
      openTasksDrawer()
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

  it('does not repoll the same failed snapshot after document read recovery', async () => {
    vi.useFakeTimers()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'forbidden-failed-poll', state: 'failed' })] }],
    }
    getTaskSnapshot.mockRejectedValue(new Response(null, { status: 403 }))

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      openTasksDrawer()
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()
      tasksQuery.data = {
        pages: [{ items: [task({ id: 'forbidden-failed-poll', state: 'failed' })] }],
      }
      tasksQuery.dataUpdateCount += 1
      act(() => notifyTaskQuerySuccess())
      await act(async () => vi.advanceTimersByTime(60000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('accepts a same-version active list lifecycle after a failed poll is denied', async () => {
    vi.useFakeTimers()
    const taskVersion = '2026-07-20T10:01:00Z'
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.dataUpdateCount = 1
    tasksQuery.data = {
      pages: [
        {
          items: [
            task({ id: 'denied-failed-poll-retry', state: 'failed', updatedAt: taskVersion }),
          ],
        },
      ],
    }
    getTaskSnapshot.mockRejectedValueOnce(new Response(null, { status: 403 }))
    streamProcessingTaskEvents.mockImplementation(async function* () {
      await new Promise<void>(() => {})
    })

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      openTasksDrawer()
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()

      tasksQuery.data = {
        pages: [
          {
            items: [
              task({ id: 'denied-failed-poll-retry', state: 'running', updatedAt: taskVersion }),
            ],
          },
        ],
      }
      tasksQuery.dataUpdateCount = 2
      act(() => notifyTaskQuerySuccess())
      await act(async () => {})

      expect(streamProcessingTaskEvents).toHaveBeenCalledOnce()
    } finally {
      rendered.unmount()
      vi.useRealTimers()
    }
  })

  it('advances one batched failed-task poll when a snapshot request never settles', async () => {
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
    getTaskSnapshot
      .mockReturnValueOnce(new Promise<DocumentProcessingTask[]>(() => {}))
      .mockResolvedValueOnce(
        Array.from({ length: 6 }, (_, index) =>
          task({
            id: `failed-${index}`,
            state: index === 0 ? 'dispatch_pending' : 'failed',
            updatedAt: '2026-07-20T10:02:00Z',
          }),
        ),
      )

    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    try {
      openTasksDrawer()
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()
      await act(async () => vi.advanceTimersByTime(3000))
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledTimes(2)
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
      openTasksDrawer()
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
      openTasksDrawer()
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()
      expect(streamProcessingTaskEvents).not.toHaveBeenCalled()
      expect(screen.getByText('dataset.newKnowledge.taskFailure.internal')).toBeInTheDocument()
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
      openTasksDrawer()
      await act(async () => vi.advanceTimersByTime(5000))
      await act(async () => {})
      expect(getTaskSnapshot).toHaveBeenCalledTimes(2)
      expect(screen.getByText('dataset.newKnowledge.taskFailure.internal')).toBeInTheDocument()
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
      openTasksDrawer()
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
      openTasksDrawer()
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
      openTasksDrawer()
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

  it('loads unresolved source labels without exhausting task history', () => {
    documentsQuery.data = {
      pages: [{ items: [document({ sourceId: 'source-on-later-page' })] }],
    }
    tasksQuery.data = { pages: [{ items: [], nextCursor: 'next' }] }
    tasksQuery.hasNextPage = true
    sourcesQuery.data = { pages: [{ items: [], nextCursor: 'source-next' }] }
    sourcesQuery.hasNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(tasksQuery.fetchNextPage).not.toHaveBeenCalled()
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('treats the first task page as authoritative for document status', async () => {
    const user = userEvent.setup()
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: Array.from({ length: 20 }, () => ({ items: [], nextCursor: 'next' })),
    }
    tasksQuery.hasNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('combobox'))
    await user.click(
      screen.getByRole('option', { name: 'dataset.newKnowledge.documentStatus.failed' }),
    )

    expect(screen.getByText('dataset.newKnowledge.noMatchingDocuments')).toBeInTheDocument()
    expect(
      screen.queryByText('dataset.newKnowledge.partialDocumentResults'),
    ).not.toBeInTheDocument()
    expect(tasksQuery.fetchNextPage).not.toHaveBeenCalled()
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
    expect(tasksQuery.fetchNextPage).not.toHaveBeenCalled()
    expect(sourcesQuery.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('keeps task-history pagination out of document result pagination', () => {
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = {
      pages: Array.from({ length: 20 }, () => ({ items: [], nextCursor: 'next' })),
    }
    tasksQuery.hasNextPage = true
    tasksQuery.isFetchingNextPage = true

    render(<DocumentsPage knowledgeSpaceId="space-1" />)

    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.loadMore' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'sso-enterprise.pdf' })).not.toHaveAttribute(
      'aria-disabled',
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
      screen.queryByRole('button', { name: 'dataset.newKnowledge.loadMore' }),
    ).not.toBeInTheDocument()
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
      openTasksDrawer()
      await act(async () => vi.advanceTimersByTime(5000))
      expect(getTaskSnapshot).toHaveBeenCalledOnce()

      documentsQuery.error = { status: 403 }
      rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
      documentsQuery.error = null
      rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
      openTasksDrawer()
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
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadDocuments'),
      new File(['one'], 'one.md', { type: 'text/markdown' }),
    )
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
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
    const addDocument = screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })
    await user.click(addDocument)

    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadDocuments'),
      new File(['one'], 'one.md', { type: 'text/markdown' }),
    )
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))

    await waitFor(() => expect(permissionStateMock.refreshAfterDenial).toHaveBeenCalledOnce())
    expect(toastMock.error).not.toHaveBeenCalledWith('dataset.newKnowledge.documentUploadFailed')
    const restriction = screen.getByText('dataset.newKnowledge.documentPermissionRestricted')
    expect(restriction).toBeInTheDocument()
    expect(restriction).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: 'dataset.newKnowledge.documents' })).toHaveFocus()

    permissionStateMock.datasetKeys = ['dataset.acl.readonly']
    permissionStateMock.spaceKeys = []
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' })).toBeDisabled()

    permissionStateMock.datasetKeys = ['dataset.acl.edit']
    permissionStateMock.spaceKeys = ['knowledge_space_document_write']
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }),
      ).toBeEnabled(),
    )
  })

  it('preserves a newer focus target when an upload later loses write permission', async () => {
    const user = userEvent.setup()
    let rejectUpload!: (error: unknown) => void
    uploadMutation.mutateAsync.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectUpload = reject
        }),
    )
    permissionStateMock.refreshAfterDenial.mockResolvedValueOnce({
      data: { dataset: { default_permission_keys: ['dataset.acl.readonly'] } },
      error: null,
    })
    tasksQuery.data = { pages: [{ items: [task()] }] }
    render(<DocumentsPage knowledgeSpaceId="space-1" />, { searchParams: '?upload=1' })

    await user.upload(
      screen.getByLabelText('dataset.newKnowledge.uploadDocuments'),
      new File(['one'], 'one.md', { type: 'text/markdown' }),
    )
    await waitForDocumentFilesStaged()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    const documentsHeading = screen.getByRole('heading', {
      name: 'dataset.newKnowledge.addDocument',
    })
    documentsHeading.focus()
    expect(documentsHeading).toHaveFocus()

    await act(async () => rejectUpload(new Response(null, { status: 403 })))
    await waitFor(() => expect(permissionStateMock.refreshAfterDenial).toHaveBeenCalledOnce())

    expect(screen.getByRole('heading', { name: 'dataset.newKnowledge.documents' })).toHaveFocus()
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
    expect(toastMock.error).not.toHaveBeenCalledWith('dataset.newKnowledge.documentsReindexFailed')
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
    const rendered = render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.interruptTask' }))

    await waitFor(() => expect(permissionStateMock.refreshAfterDenial).toHaveBeenCalledOnce())
    expect(
      within(screen.getByRole('dialog')).getByText(
        'dataset.newKnowledge.documentPermissionRestricted',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.taskActionFailed')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toHaveFocus()

    permissionStateMock.error = new Error('permission refresh failed')
    rendered.rerender(<DocumentsPage knowledgeSpaceId="space-1" />)
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText('dataset.newKnowledge.documentPermissionRestricted'),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    fireEvent.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    fireEvent.change(screen.getByLabelText('dataset.newKnowledge.uploadDocuments'), {
      target: { files: [new File(['one'], 'one.md', { type: 'text/markdown' })] },
    })
    await waitForDocumentFilesStaged()
    fireEvent.click(screen.getByRole('button', { name: 'dataset.newKnowledge.addDocument' }))
    expect(cancelMutation.mutateAsync).toHaveBeenCalledOnce()
    await waitFor(() => expect(uploadMutation.mutateAsync).toHaveBeenCalledOnce())

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
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.tasksWithAttention:{"count":1}',
      }),
    )
    expect(
      await screen.findByText('dataset.newKnowledge.taskFailure.temporary'),
    ).toBeInTheDocument()
    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledOnce())

    tasksQuery.data = sharedTaskData
    tasksQuery.dataUpdatedAt = 100
    tasksQuery.dataUpdateCount = 2
    act(() => notifyTaskQuerySuccess())

    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByRole('button', { name: 'dataset.newKnowledge.interruptTask' }),
    ).toBeInTheDocument()
  })

  it('rechecks a same-version active lifecycle after a denied terminal snapshot', async () => {
    const taskVersion = '2026-07-20T10:03:00Z'
    const sharedTaskData = {
      pages: [{ items: [task({ id: 'denied-active-retry', updatedAt: taskVersion })] }],
    }
    documentsQuery.data = { pages: [{ items: [document()] }] }
    tasksQuery.data = sharedTaskData
    tasksQuery.dataUpdatedAt = 100
    tasksQuery.dataUpdateCount = 1
    getTaskSnapshot
      .mockRejectedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(
        task({ id: 'denied-active-retry', state: 'running', updatedAt: taskVersion }),
      )
    streamFailedTaskThenWait('denied-active-retry')
    render(<DocumentsPage knowledgeSpaceId="space-1" />)
    openTasksDrawer()
    await waitFor(() => expect(getTaskSnapshot).toHaveBeenCalledOnce())

    tasksQuery.data = sharedTaskData
    tasksQuery.dataUpdatedAt = 100
    tasksQuery.dataUpdateCount = 2
    act(() => notifyTaskQuerySuccess())

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
    expect(await screen.findByText('dataset.newKnowledge.taskFailure.internal')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.retryTask' }),
    ).toBeInTheDocument()
  })
})

import type {
  KnowledgeFsDocumentMultimodalManifestResponse,
  KnowledgeFsDocumentOutlineResponse,
  KnowledgeFsProductPermission,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ComponentProps, ReactElement } from 'react'
import type { DocumentMetadataField } from '../../metadata/editor-model'
import type {
  BackgroundTask,
  DocumentProcessingTask,
  DocumentRevisionChunk,
  LogicalDocument,
  LogicalDocumentRevision,
} from '../../models'
import { zGetFeaturesVectorSpaceResponse } from '@dify/contracts/api/console/features/zod.gen'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { consoleQueryKey } from '@/test/console/operation-hooks'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedFeatures,
} from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { DocumentDetailPage } from '../page'

const knowledgeSpacePermissionState = vi.hoisted(() => ({
  keys: ['knowledge_space_document_write'] as KnowledgeFsProductPermission[],
  name: 'Support knowledge',
  refetch: vi.fn(),
}))

const multimodalAssetGet = vi.hoisted(() => vi.fn())

// Protected images are fetched as blobs through the base request helper.
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

// Server-side state behind the real Query observers. A repeated first-page read is a refetch and a
// cursor read is the next page, so the refetch/fetchNextPage spies keep their meaning.
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

const taskSnapshotQuery = vi.hoisted(() => ({
  data: undefined as DocumentProcessingTask | undefined,
  error: null as unknown,
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
  keys: ['dataset.acl.edit'],
  refresh: vi.fn(),
}))
const reindexMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const retryTaskRequest = vi.hoisted(() => vi.fn())
const cancelMutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
const patchDocumentMetadata = vi.hoisted(() => vi.fn())
const listLogicalDocuments = vi.hoisted(() => vi.fn())
const createMetadataField = vi.hoisted(() => vi.fn())
const metadataFieldsQuery = vi.hoisted(() => ({
  data: [] as DocumentMetadataField[] | undefined,
  error: null as unknown,
  isPending: false,
  refetch: vi.fn(),
}))
const routerMock = vi.hoisted(() => ({ push: vi.fn() }))
const settingsState = vi.hoisted(() => ({
  configurationState: 'active' as 'active' | 'setup-required',
  refetch: vi.fn(),
}))
const systemFeaturesState = vi.hoisted(() => ({
  deploymentEdition: 'ENTERPRISE' as 'CLOUD' | 'ENTERPRISE',
}))
const server = vi.hoisted(() => ({
  inflight: 0,
  inputs: new Map<string, unknown[]>(),
  reads: new Map<string, number>(),
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
const taskApiResponse = vi.hoisted(() => (item: BackgroundTask) => ({
  semantic_enrichment: item.semanticEnrichment ?? null,
  can_cancel: item.canCancel ?? true,
  can_retry: item.canRetry ?? item.state === 'failed',
  completed_at: item.completedAt ?? null,
  created_at: item.createdAt,
  document_id: item.documentId ?? null,
  document_title: item.documentTitle ?? null,
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
  source_title: item.sourceTitle ?? null,
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
const metadataFieldApiResponse = vi.hoisted(() => (field: DocumentMetadataField) => ({
  count: field.count,
  created_at: field.createdAt,
  id: field.id,
  name: field.name,
  row_version: field.rowVersion,
  type: field.type,
  updated_at: field.updatedAt,
}))

const logicalDocumentApiResponse = vi.hoisted(() => (item: LogicalDocument) => ({
  active: item.active ? revisionApiResponse(item.active) : null,
  active_revision: item.activeRevision ?? null,
  created_at: item.createdAt,
  disabled_at: item.enabled ? null : item.updatedAt,
  disabled_by_subject_id: item.enabled ? null : 'account-1',
  enabled: item.enabled,
  id: item.id,
  knowledge_space_id: item.knowledgeSpaceId,
  latest_task: item.latestTask ? taskApiResponse(item.latestTask) : null,
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
const permissionsResponse = (datasetKeys: string[]) => ({
  agent: { default_permission_keys: [], overrides: [] },
  app: { default_permission_keys: [], overrides: [] },
  dataset: { default_permission_keys: datasetKeys, overrides: [] },
  workspace: { permission_keys: [] },
})

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

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  const forever = () => new Promise<never>(() => {})
  const track = async <T,>(read: () => Promise<T> | T) => {
    server.inflight += 1
    try {
      return await read()
    } finally {
      server.inflight -= 1
    }
  }
  const repeatRead = (resource: string) => {
    const reads = server.reads.get(resource) ?? 0
    server.reads.set(resource, reads + 1)
    return reads > 0
  }
  type Resource = { error: unknown; isPending?: boolean; refetch?: () => unknown }
  const record = (resource: string, input: unknown) =>
    server.inputs.set(resource, [...(server.inputs.get(resource) ?? []), input])
  const single =
    <T,>(resource: string, state: Resource, data: () => T) =>
    (input?: unknown) =>
      (record(resource, input), state.isPending)
        ? forever()
        : track(async () => {
            if (repeatRead(resource)) await state.refetch?.()
            if (state.error) throw state.error
            return data()
          })
  type PagedResource<Item> = Resource & {
    data: { pages: Array<{ items: Item[]; nextCursor?: string }> } | undefined
    fetchNextPage: (...args: never[]) => unknown
    hasNextPage: boolean
    isFetchNextPageError: boolean
  }
  const paged =
    <Item,>(resource: string, state: PagedResource<Item>, toApi: (item: Item) => unknown) =>
    (input: { query?: { cursor?: string } }) => {
      record(resource, input)
      if (state.isPending || (!state.data && !state.error)) return forever()
      return track(async () => {
        const cursor = input.query?.cursor
        if (cursor) await state.fetchNextPage()
        const pages = state.data?.pages ?? []
        const cursorIndex = pages.findIndex((_, i) => i > 0 && pages[i - 1]?.nextCursor === cursor)
        const index = !cursor
          ? 0
          : cursorIndex >= 0
            ? cursorIndex
            : cursor.startsWith('page-')
              ? Number(cursor.replace('page-', ''))
              : pages.length
        if (cursor) {
          if (state.isFetchNextPageError) throw new Error(`${resource} next page unavailable`)
        } else {
          if (repeatRead(resource)) await state.refetch?.()
          if (state.error) throw state.error
        }
        const page = pages[index] ?? { items: [] }
        const hasMore =
          index + 1 < pages.length || (state.hasNextPage && index === pages.length - 1)
        return {
          data: page.items.map(toApi),
          next_cursor: page.nextCursor ?? (hasMore ? `page-${index + 1}` : null),
        }
      })
    }
  const { createHttpError } = await import('@/service/http-error')
  const notFound = () => Promise.reject(createHttpError(new Response(null, { status: 404 })))
  const optional =
    <T,>(resource: string, state: Resource & { data: T | undefined }) =>
    (input?: unknown) =>
      (record(resource, input), state.isPending)
        ? forever()
        : track(async () => {
            if (repeatRead(resource)) await state.refetch?.()
            if (state.error) throw state.error
            return state.data ?? notFound()
          })
  const space = 'knowledgeFs.spaces.byControlSpaceId'
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      [`${space}.backgroundTasks.byTaskKind.byTaskId.retry.post`]: retryTaskRequest,
      [`${space}.documents.byDocumentId.patch`]: patchDocumentMetadata,
      [`${space}.metadata.get`]: () =>
        metadataFieldsQuery.isPending
          ? forever()
          : track(async () => {
              if (repeatRead('metadata-fields')) await metadataFieldsQuery.refetch()
              if (metadataFieldsQuery.error) throw metadataFieldsQuery.error
              return {
                data: (metadataFieldsQuery.data ?? []).map(metadataFieldApiResponse),
                next_cursor: null,
              }
            }),
      [`${space}.metadata.post`]: createMetadataField,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      [`${space}.backgroundTasks.byTaskKind.byTaskId.cancel.post`]: (input: never) =>
        cancelMutation.mutateAsync(input),
      [`${space}.backgroundTasks.get`]: (input: {
        query?: { cursor?: string; task_ids?: string }
      }) =>
        input.query?.task_ids
          ? (record('task-snapshot', input), taskSnapshotQuery.data) || taskSnapshotQuery.error
            ? track(async () => {
                if (repeatRead('task-snapshot')) await taskSnapshotQuery.refetch()
                if (taskSnapshotQuery.error) throw taskSnapshotQuery.error
                return { data: [taskApiResponse(taskSnapshotQuery.data!)], next_cursor: null }
              })
            : // An accepted task the test has not advanced yet is still queued on the server.
              track(() => ({
                data: [
                  taskApiResponse(
                    task({ id: input.query!.task_ids!, progressPercent: 0, state: 'queued' }),
                  ),
                ],
                next_cursor: null,
              }))
          : paged('tasks', tasksQuery, taskApiResponse)(input),
      [`${space}.documents.byDocumentId.multimodal.get`]: optional('multimodal', multimodalQuery),
      [`${space}.documents.byDocumentId.outline.get`]: optional('outline', outlineQuery),
      [`${space}.documents.byDocumentId.revisions.byRevision.chunks.get`]: paged(
        'chunks',
        chunksQuery,
        chunkApiResponse,
      ),
      [`${space}.documents.byDocumentId.revisions.get`]: paged(
        'revisions',
        revisionsQuery,
        (revision: LogicalDocumentRevision) => (revision ? revisionApiResponse(revision) : null),
      ),
      [`${space}.documents.reindex.post`]: (input: never) => reindexMutation.mutateAsync(input),
      [`${space}.get`]: single('knowledge-space', knowledgeSpaceQuery, () =>
        createKnowledgeSpaceFixture({
          technical_summary: {
            knowledge_space_id: 'knowledge-space-1',
            name: knowledgeSpacePermissionState.name,
            revision: 1,
            slug: 'support-knowledge',
          },
        }),
      ),
      // An accepted job the test has not advanced yet is still queued; a missing job is an
      // explicit 404 error.
      [`${space}.jobs.byJobId.get`]: (input: { params: { job_id: string } }) =>
        submittedJobQuery.data || submittedJobQuery.error
          ? optional('submitted-job', submittedJobQuery)(input)
          : (record('submitted-job', input),
            track(() => ({
              id: input.params.job_id,
              run_state: 'queued',
              stage: 'queued',
              updated_at: 0,
            }))),
      [`${space}.logicalDocuments.get`]: listLogicalDocuments,
      [`${space}.logicalDocuments.byDocumentId.get`]: single(
        'document',
        documentQuery,
        () => documentQuery.data && logicalDocumentApiResponse(documentQuery.data),
      ),
      [`${space}.settings.get`]: single(
        'settings',
        { error: null, refetch: () => settingsState.refetch() },
        () => {
          const active = settingsState.configurationState === 'active'
          return {
            active_profile_available: active,
            active_profile_revisions: active ? { embedding: 1, retrieval: 1 } : {},
            capabilities: {
              deep: active,
              index: active,
              ingest: active,
              query: active,
              research: active,
              source_sync: active,
            },
            configuration_state: settingsState.configurationState,
            embedding: null,
            issues: [],
            retrieval: null,
            revision: 1,
          }
        },
      ),
      'workspaces.current.rbac.myPermissions.get': async () => {
        const refreshed = await permissionState.refresh()
        return permissionsResponse(
          refreshed?.data?.dataset?.default_permission_keys ?? permissionState.keys,
        )
      },
    }),
  }
})

vi.mock('@/app/notifications', () => ({ toast: toastState }))
// Clipboard access is a browser permission boundary.
vi.mock('copy-to-clipboard', () => ({ default: vi.fn(() => true) }))
vi.mock('@/next/navigation', () => ({
  usePathname: () => '/datasets/new/space-1/documents/document-1',
  useRouter: () => routerMock,
}))

// happy-dom has no layout, so the virtualizer would render no rows; render the first window.
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

type DetailRenderOptions = {
  onUrlUpdate?: ComponentProps<typeof QueryTestingAdapter>['onUrlUpdate']
  searchParams?: string
  settle?: boolean
}

let currentQueryClient: ReturnType<typeof createConsoleQueryClient> | undefined

/** Waits until no request is in flight, including requests that depend on earlier responses. */
async function settle() {
  for (let quietChecks = 0; quietChecks < 2;) {
    await waitFor(() => expect(server.inflight).toBe(0))
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    quietChecks = server.inflight === 0 ? quietChecks + 1 : 0
  }
}

/** Lets mounted queries observe the current server state, as a background refetch would. */
async function refetchAll() {
  // Requests the test deliberately leaves pending never settle, so do not await the refetch itself.
  act(() => {
    void currentQueryClient!.invalidateQueries({ queryKey: consoleQuery.knowledgeFs.spaces.key() })
  })
  await settle()
}

const lastInput = (resource: string) => server.inputs.get(resource)?.at(-1)
const snapshotReads = () => server.inputs.get('task-snapshot')?.length ?? 0

/** Advances polling timers; tests that use it install fake timers that also advance on their own. */
async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
  await settle()
}

/** Seeds the Documents list that the detail page keeps in sync after it edits a document. */
function seedDocumentsList(queryClient: ReturnType<typeof createConsoleQueryClient>) {
  const { queryKey } =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.infiniteOptions({
      getNextPageParam: () => undefined,
      initialPageParam: null,
      input: () => ({ params: { control_space_id: 'space-1' } }),
    })
  queryClient.setQueryData(queryKey, { pageParams: [null], pages: [] })
  return queryKey
}

async function render(ui: ReactElement, options: DetailRenderOptions = {}) {
  const onUrlUpdate = options.onUrlUpdate ?? vi.fn()
  const queryClient = createConsoleQueryClient()
  // The page retries transient failures itself; keep those retries immediate.
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retryDelay: 0 },
  })
  currentQueryClient = queryClient
  queryClient.setQueryData(
    consoleQueryKey('workspaces.current.rbac.myPermissions.get'),
    permissionsResponse(permissionState.keys),
  )
  const withProviders = (content: ReactElement) => (
    <QueryTestingAdapter searchParams={options.searchParams} onUrlUpdate={onUrlUpdate}>
      <KnowledgeSpaceTestProvider
        refetch={knowledgeSpacePermissionState.refetch}
        space={createKnowledgeSpaceFixture({
          permission_keys: knowledgeSpacePermissionState.keys,
          technical_summary: {
            knowledge_space_id: 'knowledge-space-1',
            name: knowledgeSpacePermissionState.name,
            revision: 1,
            slug: 'support-knowledge',
          },
        })}
      >
        {content}
      </KnowledgeSpaceTestProvider>
    </QueryTestingAdapter>
  )
  const rendered = renderWithConsoleQuery(withProviders(ui), {
    queryClient,
    systemFeatures: { deployment_edition: systemFeaturesState.deploymentEdition },
  })
  if (options.settle !== false) await settle()
  return {
    ...rendered,
    onUrlUpdate,
    queryClient,
    async rerender(nextUi: ReactElement) {
      rendered.rerender(withProviders(nextUi))
      await refetchAll()
    },
  }
}

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
  beforeAll(async () => {
    // Load the real renderer before assertions start; next/dynamic otherwise loads it
    // during the first Markdown query, which can outlast the DOM query timeout.
    await import('@/app/components/base/markdown/streamdown-wrapper')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    server.inflight = 0
    server.inputs.clear()
    server.reads.clear()
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
    taskSnapshotQuery.data = undefined
    taskSnapshotQuery.error = null
    tasksQuery.data = { pages: [{ items: [] }] }
    tasksQuery.error = null
    tasksQuery.hasNextPage = false
    tasksQuery.isFetchNextPageError = false
    tasksQuery.isFetchingNextPage = false
    tasksQuery.isPending = false
    metadataFieldsQuery.data = []
    metadataFieldsQuery.error = null
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
    retryTaskRequest.mockResolvedValue(taskApiResponse(task({ state: 'queued' })))
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
    systemFeaturesState.deploymentEdition = 'ENTERPRISE'
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it('uses the document and knowledge names in the document title', async () => {
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(document.title).toBe('sso-enterprise.pdf · Support knowledge - Dify'),
    )
  })

  it('loads the document, revisions, chunks, and tasks for the routed document', async () => {
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const documentParams = { control_space_id: 'space-1', document_id: 'document-1' }
    expect(lastInput('document')).toEqual({ params: documentParams })
    expect(lastInput('revisions')).toEqual({ params: documentParams, query: {} })
    expect(lastInput('chunks')).toEqual({ params: { ...documentParams, revision: 3 }, query: {} })
    expect(lastInput('outline')).toEqual({
      params: { control_space_id: 'space-1', document_id: 'asset-1' },
    })
    expect(server.inputs.get('tasks')).toBeUndefined()
    expect(
      screen.queryByRole('button', { name: /knowledgeDocuments\.documentActions/ }),
    ).not.toBeInTheDocument()
  })

  it('disables re-indexing for an unavailable document', async () => {
    documentQuery.data = logicalDocument({ enabled: false })

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }),
    ).toBeDisabled()
    expect(reindexMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('does not construct a chunks request while the document is loading', async () => {
    documentQuery.data = undefined
    documentQuery.isPending = true

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(server.inputs.get('chunks')).toBeUndefined()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('uses source provenance instead of exposing an internal source id', async () => {
    documentQuery.data = logicalDocument({
      userMetadata: {},
    })

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.queryByText('source-1')).not.toBeInTheDocument()
    expect(screen.getAllByText('knowledgeSpace.sourceType.connector')).not.toHaveLength(0)
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(await screen.findByRole('link', { name: 'Learn more' })).toHaveAttribute(
      'href',
      'https://www.iana.org/domains/example',
    )
    expect(screen.queryByText(/\[Learn more\]\(/)).not.toBeInTheDocument()
  })

  it('uses structured chapter paths and keeps the first source line in the chunk body', async () => {
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const tree = screen.getByRole('tree')
    expect(within(tree).getByRole('treeitem', { name: 'Invoices' })).toBeInTheDocument()
    expect(within(tree).getByRole('treeitem', { name: 'Tax breakdown' })).toBeInTheDocument()
    expect(within(tree).queryByRole('treeitem', { name: /This first line/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Tax breakdown' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('article')).toHaveTextContent(
        'This first line is source content, not a title.',
      ),
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const tree = screen.getByRole('tree')
    expect(within(tree).getAllByRole('treeitem', { name: 'Guide Operating safely' })).toHaveLength(
      1,
    )
    expect(within(tree).getByRole('treeitem', { name: 'Setup' })).toBeInTheDocument()
    expect(within(tree).queryByRole('treeitem', { name: '#0' })).not.toBeInTheDocument()
    expect(screen.getByText('Generated guide summary.')).toBeInTheDocument()
    expect(screen.getByText('Generated setup summary.')).toBeInTheDocument()
    const summaryButtons = screen.getAllByRole('button', {
      name: 'knowledgeDocuments.documentSummary',
    })
    expect(summaryButtons[0]).toHaveAttribute('aria-expanded', 'true')
    await user.click(summaryButtons[0]!)
    expect(summaryButtons[0]).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Generated guide summary.')).not.toBeInTheDocument()
    expect(screen.getByText('Generated setup summary.')).toBeInTheDocument()
    expect(await screen.findByText('Guide body')).toBeInTheDocument()
    expect(await screen.findByText('Setup body')).toBeInTheDocument()
    const article = screen.getByRole('article')
    expect(
      within(article).getByRole('heading', { level: 2, name: 'Guide Operating safely' }),
    ).toBeInTheDocument()
    expect(within(article).getByRole('heading', { level: 3, name: 'Setup' })).toBeInTheDocument()
  })

  it('renders structural headings once before the chunks in their sections', async () => {
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const article = screen.getByRole('article')
    expect(
      within(article).getAllByRole('heading', { level: 2, name: 'Detailed features' }),
    ).toHaveLength(1)
    expect(
      within(article).getAllByRole('heading', { level: 3, name: 'Document upload' }),
    ).toHaveLength(1)
    expect(
      await within(article).findByText('Files are parsed in the background.'),
    ).toBeInTheDocument()
    expect(within(article).getByText('C-1')).toBeInTheDocument()
    const chunkCountRow = screen.getByText('knowledgeSpace.chunkCount').closest('div')
    expect(chunkCountRow).not.toBeNull()
    expect(within(chunkCountRow!).getByText('1')).toBeInTheDocument()
  })

  it('loads protected document images next to the chunk selected by canonical offsets', async () => {
    // Each protected variant resolves to its own bytes, so its object URL follows the content.
    multimodalAssetGet.mockImplementation(
      async (path: string) =>
        new Response(new Blob([path.includes('thumbnail') ? 'thumbnail' : 'asset'])),
    )
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) =>
      (blob as Blob).size === 'thumbnail'.length ? 'blob:thumbnail' : 'blob:asset',
    )
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

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
    expect(
      screen.getByRole('button', { name: 'Screenshot of the source configuration' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('The image caption follows.')).toBeInTheDocument()
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getAllByText('Issue: Copy button is unavailable')).not.toHaveLength(0)
    expect(
      await screen.findByRole('img', { name: 'Screenshot for the copy button issue' }),
    ).toHaveAttribute('src', 'blob:spreadsheet-image')
    expect(screen.queryByText('image1.jpeg')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'knowledgeDocuments.documentImages' }),
    ).not.toBeInTheDocument()
    const chunkCountRow = screen.getByText('knowledgeSpace.chunkCount').closest('div')
    expect(chunkCountRow).not.toBeNull()
    await waitFor(() => expect(within(chunkCountRow!).getByText('2')).toBeInTheDocument())
  })

  it('shows images without location metadata after the document chunks', async () => {
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const article = screen.getByRole('article')
    const chunkHeading = within(article).getByRole('heading', { level: 2, name: 'Chapter' })
    const image = screen.getByRole('img', { name: 'Screenshot without location metadata' })
    expect(chunkHeading.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('labels flat document chunks by their visible order', async () => {
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const article = screen.getByRole('article')
    expect(within(article).getByText('C-1')).toBeInTheDocument()
    expect(within(article).getByText('C-2')).toBeInTheDocument()
  })

  it('restarts child chunk labels for each parent chunk', async () => {
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const tree = screen.getByRole('tree', { name: 'knowledgeDocuments.documentContents' })
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
        'knowledgeDocuments.parentChildChunkCount:{"childCount":"1","parentCount":"1"}',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.characterCount')).not.toBeInTheDocument()
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

    const { queryClient } = await render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    const documentsListKey = seedDocumentsList(queryClient)

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
    await waitFor(() => expect(documentQuery.refetch).toHaveBeenCalled())
    expect(queryClient.getQueryState(documentsListKey)?.isInvalidated).toBe(true)
  })

  it('preserves a document metadata draft when the active revision changes', async () => {
    const user = userEvent.setup()
    documentQuery.data = logicalDocument({
      userMetadata: { category: 'support', sourceName: 'Notion support SOP' },
    })
    const rendered = await render(
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
    await rendered.rerender(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    expect(screen.getByRole('textbox', { name: 'category' })).toHaveValue('draft value')
    expect(lastInput('chunks')).toEqual({
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))

    expect(screen.getByLabelText('reviewed_at')).toHaveAttribute('type', 'datetime-local')
  })

  it('enters metadata editing immediately while field types are still resolving', async () => {
    const user = userEvent.setup()
    documentQuery.data = logicalDocument({ userMetadata: { category: '' } })
    metadataFieldsQuery.data = undefined
    metadataFieldsQuery.isPending = true

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))

    expect(await screen.findByLabelText('category')).toBeInTheDocument()
    expect(metadataFieldsQuery.refetch).not.toHaveBeenCalled()
  })

  it('keeps metadata editing usable and exposes retry when the field catalog fails', async () => {
    const user = userEvent.setup()
    documentQuery.data = logicalDocument({ userMetadata: { category: 'support' } })
    metadataFieldsQuery.data = undefined
    metadataFieldsQuery.error = new Error('metadata catalog unavailable')

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const category = screen.getByLabelText('category')
    expect(category).toBeEnabled()
    await user.clear(category)
    await user.type(category, 'product')

    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    expect(screen.getByText('knowledgeCitation.documentLoadErrorDescription')).toBeInTheDocument()
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))

    expect(screen.getByLabelText('reviewed_at')).toHaveValue('2026-08-04T18:00')
    getTimezoneOffset.mockRestore()
  })

  it('creates a reusable field and initializes only the current document', async () => {
    const user = userEvent.setup()

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.metadata.documentMetadata.startLabeling',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
    )
    await user.click(screen.getByRole('radio', { name: 'dataset.metadata.type.number' }))
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.metadata.documentMetadata.startLabeling',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
    )
    await user.click(screen.getByRole('radio', { name: 'dataset.metadata.type.number' }))
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

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
      expect(toastState.error).toHaveBeenCalledWith('knowledgeSpace.settings.saveFailed'),
    )
  })

  it('validates a new metadata name before submitting it', async () => {
    const user = userEvent.setup()
    metadataFieldsQuery.data = [metadataField({ name: 'existing_field' })]

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

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
    expect(nameInput).toHaveFocus()

    await user.click(save)
    expect(createMetadataField).not.toHaveBeenCalled()
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAccessibleDescription(/dataset.metadata.checkName.empty/)
    expect(nameInput).toHaveFocus()

    const cases = [
      ['Priority', 'invalid'],
      ['existing_field', 'duplicate'],
      ['a'.repeat(256), 'tooLong'],
      ['sourceName', 'invalid'],
    ] as const
    for (const [name, error] of cases) {
      await user.clear(nameInput)
      await user.type(nameInput, name)
      expect(nameInput).toHaveAccessibleDescription(
        new RegExp(`dataset.metadata.checkName.${error}`),
      )
      await user.keyboard('{Enter}')
      expect(createMetadataField).not.toHaveBeenCalled()
    }

    await user.clear(nameInput)
    await user.type(nameInput, 'priority_1')
    expect(nameInput).not.toHaveAttribute('aria-invalid')
    expect(nameInput).not.toHaveAccessibleDescription()
  })

  it('opens the New RAG metadata manager from the document picker', async () => {
    const user = userEvent.setup()

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
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
    documentQuery.data = logicalDocument({ latestTask: task({ state: 'running' }) })
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
            backgroundTask({ documentId: 'document-1', id: 'bulk-reindex-task' }),
          ],
        },
      ],
    }

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    const parent = screen.getByRole('treeitem', { name: /Parent node/ })
    expect(parent).toHaveAttribute('aria-expanded', 'true')
    await user.click(parent)
    expect(parent).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: /Child node/ })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('knowledgeDocuments.documentReindexStatus')
    expect(
      screen.getByRole('button', { name: 'knowledgeDocuments.cancelDocumentReindex' }),
    ).not.toHaveAttribute('data-disabled')
    await user.click(screen.getByRole('button', { name: 'knowledgeDocuments.viewTask' }))
    const taskDrawer = screen.getByRole('dialog', {
      name: 'knowledgeSpace.backgroundTasks',
    })
    expect(within(taskDrawer).getAllByText(/knowledgeSpace\.addDocument/)).toHaveLength(2)
    expect(
      within(taskDrawer).getByText('knowledgeSpace.reindexDocuments · sso-enterprise.pdf'),
    ).toBeInTheDocument()
  })

  it('loads task document titles only while the task drawer is open', async () => {
    documentQuery.data = logicalDocument({ latestTask: task({ state: 'running' }) })
    const user = userEvent.setup()
    tasksQuery.data = { pages: [{ items: [task({ state: 'running' })] }] }

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(listLogicalDocuments).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'knowledgeDocuments.viewTask' }))
    await waitFor(() => expect(listLogicalDocuments).toHaveBeenCalled())
  })

  it('cancels the active re-index task from the document header', async () => {
    const user = userEvent.setup()
    taskSnapshotQuery.data = task({ state: 'running' })
    documentQuery.data = logicalDocument({ latestTask: taskSnapshotQuery.data })

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    await user.click(
      screen.getByRole('button', { name: 'knowledgeDocuments.cancelDocumentReindex' }),
    )

    expect(cancelMutation.mutateAsync).toHaveBeenCalledWith({
      params: {
        control_space_id: 'space-1',
        task_id: 'task-1',
        task_kind: 'document',
      },
    })
    await waitFor(() => expect(documentQuery.refetch).toHaveBeenCalled())
  })

  it('cancels a newly accepted re-index before task discovery catches up', async () => {
    const user = userEvent.setup()

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }))
    await user.click(
      await screen.findByRole('button', {
        name: 'knowledgeDocuments.cancelDocumentReindex',
      }),
    )

    await waitFor(() =>
      expect(cancelMutation.mutateAsync).toHaveBeenCalledWith({
        params: {
          control_space_id: 'space-1',
          task_id: 'compilation-job-1',
          task_kind: 'document',
        },
      }),
    )
  })

  it('restores an accepted re-index after the document page remounts', async () => {
    const user = userEvent.setup()
    const rendered = await render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }))
    expect(
      await screen.findByRole('button', {
        name: 'knowledgeDocuments.cancelDocumentReindex',
      }),
    ).toBeInTheDocument()

    rendered.unmount()
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', { name: 'knowledgeDocuments.cancelDocumentReindex' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('knowledgeDocuments.documentReindexStatus')
  })

  it('reconciles a restored re-index through its exact compilation job', async () => {
    globalThis.sessionStorage.setItem(
      'dify-new-rag-reindex:space-1:document-1',
      JSON.stringify({
        taskId: 'compilation-job-1',
      }),
    )
    submittedJobQuery.data = {
      id: 'compilation-job-1',
      run_state: 'running',
      stage: 'parsed',
      updated_at: 1,
    }

    const rendered = await render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    expect(lastInput('submitted-job')).toEqual({
      params: { control_space_id: 'space-1', job_id: 'compilation-job-1' },
    })
    expect(
      screen.getByRole('button', { name: 'knowledgeDocuments.cancelDocumentReindex' }),
    ).toBeInTheDocument()

    submittedJobQuery.data = {
      id: 'compilation-job-1',
      run_state: 'succeeded',
      stage: 'published',
      updated_at: 2,
    }
    await rendered.rerender(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }),
      ).toBeInTheDocument(),
    )
    await waitFor(() => expect(documentQuery.refetch).toHaveBeenCalled())
    expect(globalThis.sessionStorage.getItem('dify-new-rag-reindex:space-1:document-1')).toBeNull()
  })

  it('clears a restored re-index when its authoritative job endpoint returns missing', async () => {
    globalThis.sessionStorage.setItem(
      'dify-new-rag-reindex:space-1:document-1',
      JSON.stringify({
        taskId: 'missing-compilation-job',
      }),
    )
    submittedJobQuery.error = createHttpError(new Response(null, { status: 404 }))
    tasksQuery.data = {
      pages: [{ items: [task({ id: 'completed-task', state: 'succeeded' })] }],
    }

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText('knowledgeDocuments.documentReindexStatus')).not.toBeInTheDocument()
    expect(globalThis.sessionStorage.getItem('dify-new-rag-reindex:space-1:document-1')).toBeNull()
  })

  it('renders missing revision and empty chunk states without issuing a usable chunk request', async () => {
    documentQuery.data = logicalDocument({
      active: null,
      activeRevision: undefined,
      status: 'pending',
    })
    revisionsQuery.data = { pages: [{ items: [] }] }

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('heading', { name: 'knowledgeDocuments.documentRevisionMissingTitle' }),
    ).toBeInTheDocument()
    expect(server.inputs.get('chunks')).toBeUndefined()
  })

  it('keeps cached chunks visible when a background refresh fails', async () => {
    const user = userEvent.setup()
    chunksQuery.data = { pages: [{ items: [chunk({ id: 'cached', text: 'Cached content' })] }] }
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    chunksQuery.error = new Error('refresh failed')
    await refetchAll()

    expect(screen.getByRole('treeitem', { name: 'Cached content' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cached content' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'knowledgeDocuments.documentChunksLoadError',
    )
    expect(screen.queryByText('knowledgeSpace.documentContentIncomplete')).toBeNull()
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'false')
    const indexInformation = screen
      .getByRole('heading', { name: 'knowledgeDocuments.indexInformation' })
      .closest('section')
    expect(indexInformation).not.toBeNull()
    expect(within(indexInformation!).getAllByText('—')).toHaveLength(3)
    chunksQuery.refetch.mockClear()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(chunksQuery.refetch).toHaveBeenCalledOnce())
  })

  it('uses a revision from the URL without exposing revision controls', async () => {
    revisionsQuery.data = {
      pages: [{ items: [activeRevision({ revision: 2, state: 'superseded' })] }],
    }

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />, {
      searchParams: '?revision=2',
    })

    expect(
      screen.queryByRole('combobox', { name: 'knowledgeDocuments.documentRevision' }),
    ).not.toBeInTheDocument()
    expect(lastInput('chunks')).toEqual({
      params: {
        control_space_id: 'space-1',
        document_id: 'document-1',
        revision: 2,
      },
      query: {},
    })
  })

  it('offers retry when loading a later URL revision page fails', async () => {
    const user = userEvent.setup()
    revisionsQuery.data = {
      pages: [{ items: [activeRevision({ revision: 3 })], nextCursor: 'older' }],
    }
    revisionsQuery.hasNextPage = true
    revisionsQuery.isFetchNextPageError = true

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />, {
      searchParams: '?revision=2',
    })

    // Looking up the URL revision loads the older page, and that request fails.
    expect(await screen.findByText('knowledgeDocuments.documentRevisionsLoadError')).toBeVisible()
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
    expect(revisionsQuery.fetchNextPage).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(revisionsQuery.fetchNextPage).toHaveBeenCalledTimes(2))
  })

  it('keeps document actions available when a URL revision is missing', async () => {
    revisionsQuery.data = { pages: [{ items: [] }] }

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />, {
      searchParams: '?revision=2',
    })

    expect(screen.getByRole('heading', { level: 1, name: 'sso-enterprise.pdf' })).toBeVisible()
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'knowledgeDocuments.documentNotFoundTitle',
      }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' })).toBeEnabled()
  })

  it('resolves an exact URL revision from later revision pages before rendering content', async () => {
    revisionsQuery.data = {
      pages: [{ items: [activeRevision({ revision: 3 })], nextCursor: 'older' }],
    }
    const olderPage = createDeferred<void>()
    revisionsQuery.fetchNextPage.mockImplementationOnce(() => olderPage.promise)

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />, {
      searchParams: '?revision=2',
      settle: false,
    })

    expect(await screen.findByText('common.loading')).toBeInTheDocument()
    await waitFor(() => expect(revisionsQuery.fetchNextPage).toHaveBeenCalledOnce())
    expect(server.inputs.get('chunks')).toBeUndefined()

    revisionsQuery.data = {
      pages: [
        { items: [activeRevision({ revision: 3 })], nextCursor: 'older' },
        { items: [activeRevision({ revision: 2, state: 'superseded' })] },
      ],
    }
    await act(async () => olderPage.resolve())

    await waitFor(() =>
      expect(lastInput('chunks')).toEqual({
        params: {
          control_space_id: 'space-1',
          document_id: 'document-1',
          revision: 2,
        },
        query: {},
      }),
    )
  })

  it('ignores task history pagination and stale revision snapshots', async () => {
    tasksQuery.data = {
      pages: [{ items: [task({ documentId: 'another-document', id: 'another-task' })] }],
    }
    tasksQuery.hasNextPage = true
    const rendered = await render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    expect(tasksQuery.fetchNextPage).not.toHaveBeenCalled()

    tasksQuery.hasNextPage = false
    tasksQuery.data = {
      pages: [{ items: [task({ documentRevision: 2, state: 'failed' })] }],
    }
    await rendered.rerender(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    expect(screen.queryByText('knowledgeDocuments.documentReindexFailed')).toBeNull()
    expect(screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' })).toBeEnabled()
  })

  it('polls active work through the unified background-task contract', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    taskSnapshotQuery.data = task({ state: 'running' })
    documentQuery.data = logicalDocument({ latestTask: taskSnapshotQuery.data })
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const reads = snapshotReads()

    await advance(5100)

    expect(lastInput('task-snapshot')).toEqual({
      params: { control_space_id: 'space-1' },
      query: { task_ids: 'task-1' },
    })
    expect(snapshotReads()).toBeGreaterThan(reads)
  })

  it('keeps polling a retried task while its exact snapshot still contains the old failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const failed = task({ state: 'failed', updatedAt: '2026-09-11T12:00:00Z' })
    const running = task({ state: 'running', updatedAt: '2026-09-11T12:01:00Z' })
    documentQuery.data = { ...documentQuery.data!, latestTask: running }
    taskSnapshotQuery.data = failed
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', { name: 'knowledgeDocuments.cancelDocumentReindex' }),
    ).toBeEnabled()
    let reads = snapshotReads()
    await advance(5100)
    expect(snapshotReads()).toBeGreaterThan(reads)

    taskSnapshotQuery.data = task({ state: 'succeeded', updatedAt: '2026-09-11T12:02:00Z' })
    await advance(5100)
    reads = snapshotReads()
    await advance(15_000)
    expect(snapshotReads()).toBe(reads)
  })

  it('shows graph repair separately from a published document and clears the notice when ready', async () => {
    const latestTask = task({
      state: 'succeeded',
      canCancel: false,
      canRetry: false,
      semanticEnrichment: { state: 'pending', nodes_completed: 0 },
    })
    documentQuery.data = logicalDocument({ latestTask })
    taskSnapshotQuery.data = latestTask
    const rendered = await render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    expect(screen.getByText('knowledgeTasks.graphRepairPending')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'knowledgeDocuments.cancelDocumentReindex' }),
    ).not.toBeInTheDocument()
    taskSnapshotQuery.data = {
      ...latestTask,
      updatedAt: '2026-07-21T10:02:00Z',
      semanticEnrichment: { state: 'ready', nodes_completed: 1 },
    }
    await rendered.rerender(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    expect(screen.queryByText('knowledgeTasks.graphRepairPending')).not.toBeInTheDocument()
  })

  it.each(['CLOUD', 'ENTERPRISE'] as const)(
    'refreshes document content and applicable usage when an active task becomes terminal in %s',
    async (edition) => {
      systemFeaturesState.deploymentEdition = edition
      taskSnapshotQuery.data = task({ state: 'running' })
      documentQuery.data = logicalDocument({ latestTask: taskSnapshotQuery.data })
      const rendered = await render(
        <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
      )
      const usageKeys = [
        consoleQuery.features.get.queryKey(),
        consoleQuery.features.vectorSpace.get.queryKey(),
      ]
      seedFeatures(rendered.queryClient)
      rendered.queryClient.setQueryData(
        consoleQuery.features.vectorSpace.get.queryKey(),
        zGetFeaturesVectorSpaceResponse.parse({ limit: 10, size: 1 }),
      )
      documentQuery.refetch.mockClear()

      taskSnapshotQuery.data = task({ state: 'succeeded' })
      await rendered.rerender(
        <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
      )

      await waitFor(() => expect(documentQuery.refetch).toHaveBeenCalled())
      for (const key of usageKeys)
        expect(rendered.queryClient.getQueryState(key)?.isInvalidated).toBe(edition === 'CLOUD')
      const refreshes = documentQuery.refetch.mock.calls.length
      await settle()
      expect(documentQuery.refetch).toHaveBeenCalledTimes(refreshes)
    },
  )

  it('virtualizes long trees and bounds their accessible labels', async () => {
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getAllByRole('treeitem')).toHaveLength(12)
    expect(screen.getAllByRole('treeitem')[0]).toHaveAccessibleName(`${'x'.repeat(119)}…`)
  })

  it('shows a retryable error when the next chunk page fails', async () => {
    const user = userEvent.setup()
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
    chunksQuery.data = { pages: [{ items: [], nextCursor: 'next' }] }
    chunksQuery.hasNextPage = true
    chunksQuery.isFetchNextPageError = true

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    await waitFor(() => expect(intersectionCallbacks.length).toBeGreaterThan(0))
    act(() => {
      intersectionCallbacks.at(-1)?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'knowledgeDocuments.documentChunksLoadMoreError',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(chunksQuery.fetchNextPage).toHaveBeenCalledTimes(2))
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

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(chunksQuery.fetchNextPage).not.toHaveBeenCalled()
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'false')
    expect(screen.queryByText('knowledgeSpace.documentContentIncomplete')).toBeNull()
    expect(screen.queryByRole('button', { name: 'knowledgeSpace.loadMore' })).toBeNull()

    const nextPage = createDeferred<void>()
    chunksQuery.fetchNextPage.mockImplementationOnce(() => nextPage.promise)
    await waitFor(() => expect(intersectionCallbacks.length).toBeGreaterThan(0))
    act(() => {
      intersectionCallbacks.at(-1)?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    await waitFor(() => expect(chunksQuery.fetchNextPage).toHaveBeenCalledOnce())
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('knowledgeSpace.documentContentIncomplete')).toBeNull()

    chunksQuery.data = {
      pages: [
        { items: [chunk({ id: 'first', text: 'First chunk' })], nextCursor: 'next' },
        { items: [chunk({ id: 'second', ordinal: 2, text: 'Second chunk' })] },
      ],
    }
    chunksQuery.hasNextPage = false
    await act(async () => nextPage.resolve())
    await settle()

    expect(await screen.findByRole('heading', { name: 'Second chunk' })).toBeInTheDocument()
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'false')
    expect(screen.queryByText('knowledgeSpace.documentContentIncomplete')).toBeNull()
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
    const targetPage = createDeferred<void>()
    chunksQuery.fetchNextPage.mockImplementationOnce(() => targetPage.promise)

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />, {
      searchParams: '?revision=3&chunk=target',
      settle: false,
    })
    const contentScroll = await screen.findByTestId('chunk-content-scroll')
    Object.defineProperty(contentScroll, 'clientHeight', { configurable: true, value: 1000 })

    await waitFor(() => expect(chunksQuery.fetchNextPage).toHaveBeenCalledOnce())
    expect(await screen.findByRole('treeitem', { name: 'First chunk' })).toHaveAttribute(
      'aria-selected',
      'false',
    )

    chunksQuery.data = {
      pages: [
        { items: [chunk({ id: 'first', text: 'First chunk' })], nextCursor: 'next' },
        { items: [chunk({ id: 'target', ordinal: 2, text: 'Target chunk' })] },
      ],
    }
    chunksQuery.hasNextPage = false
    await act(async () => targetPage.resolve())
    await settle()

    expect(await screen.findByRole('treeitem', { name: 'Target chunk' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await waitFor(() => expect(contentScroll.scrollTop).toBe(592))
    getBoundingClientRect.mockRestore()
  })

  it('shares document URL state while client navigation renders two route instances', async () => {
    chunksQuery.data = {
      pages: [
        {
          items: [
            chunk({ id: 'first', text: 'First chunk' }),
            chunk({ id: 'target', ordinal: 2, text: 'Target chunk' }),
          ],
        },
      ],
    }

    await render(
      <>
        <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />
        <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />
      </>,
      { searchParams: '?revision=3&chunk=target' },
    )

    const firstChunkRows = screen.getAllByRole('treeitem', { name: 'First chunk' })
    const targetChunkRows = screen.getAllByRole('treeitem', { name: 'Target chunk' })
    expect(firstChunkRows).toHaveLength(2)
    expect(targetChunkRows).toHaveLength(2)
    expect(firstChunkRows[0]).toHaveAttribute('aria-selected', 'false')
    expect(targetChunkRows[0]).toHaveAttribute('aria-selected', 'true')
    expect(firstChunkRows[1]).toHaveAttribute('aria-selected', 'false')
    expect(targetChunkRows[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('distinguishes missing, restricted, and retryable document failures', async () => {
    const user = userEvent.setup()
    documentQuery.data = undefined
    documentQuery.error = createHttpError(new Response(null, { status: 404 }))
    const rendered = await render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    expect(
      screen.getByRole('heading', { name: 'knowledgeDocuments.documentNotFoundTitle' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).toBeNull()
    expect(server.reads.get('document')).toBe(1)

    documentQuery.error = new Error('temporary failure')
    await rendered.rerender(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    documentQuery.refetch.mockClear()
    await user.click(await screen.findByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(documentQuery.refetch).toHaveBeenCalled())
  })

  it('shows re-index progress and preserves the last ready revision after failure', async () => {
    taskSnapshotQuery.data = task({
      state: 'failed',
      errorCode: 'PARSER_FAILED',
      progressPercent: 80,
    })
    documentQuery.data = logicalDocument({ latestTask: taskSnapshotQuery.data })
    chunksQuery.data = { pages: [{ items: [chunk({ id: 'ready-chunk' })] }] }

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent('knowledgeDocuments.documentReindexFailed')
    expect(screen.getByRole('button', { name: 'knowledgeDocuments.viewTask' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'knowledgeDocuments.retryReindexDocument' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Parent content' })).toBeInTheDocument()
  })

  it('renders a valid empty file size as zero bytes', async () => {
    documentQuery.data = logicalDocument({
      active: activeRevision({ sizeBytes: 0 }),
    })
    revisionsQuery.data = { pages: [{ items: [activeRevision({ sizeBytes: 0 })] }] }

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(screen.getByText('0 B')).toBeInTheDocument()
  })

  it('starts re-indexing once and disables writes for readonly users', async () => {
    const user = userEvent.setup()
    const rendered = await render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }))

    expect(reindexMutation.mutateAsync).toHaveBeenCalledWith({
      body: { documentIds: ['document-1'] },
      params: { control_space_id: 'space-1' },
    })
    await waitFor(() => expect(documentQuery.refetch).toHaveBeenCalled())

    permissionState.keys = ['dataset.acl.readonly']
    knowledgeSpacePermissionState.keys = []
    await rendered.rerender(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    const readonlyReindexButton = screen.getByRole('button', {
      name: 'knowledgeDocuments.cancelDocumentReindex',
    })
    expect(readonlyReindexButton).toHaveAttribute('data-disabled')
    expect(readonlyReindexButton).toHaveAccessibleDescription(
      'knowledgeSpace.documentPermissionRestricted',
    )
    expect(screen.getByText('knowledgeSpace.documentPermissionRestricted')).toBeVisible()
  })

  it.each(['response', 'item'] as const)(
    'shows the quota failure returned by a detail re-index %s',
    async (failureSource) => {
      const user = userEvent.setup()
      if (failureSource === 'response') {
        reindexMutation.mutateAsync.mockRejectedValueOnce(
          Response.json(
            {
              failure: {
                action: 'retry',
                category: 'configuration',
                code: 'VECTOR_SPACE_QUOTA_EXCEEDED',
                message: 'Upstream quota details',
                retryPolicy: 'manual',
              },
            },
            { status: 413 },
          ),
        )
      } else {
        reindexMutation.mutateAsync.mockResolvedValueOnce({
          bulkJobId: 'quota-reindex',
          items: [
            { document_id: 'document-1', status: 'failed', code: 'VECTOR_SPACE_QUOTA_EXCEEDED' },
          ],
          total: 1,
        })
      }

      await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
      await user.click(screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }))

      await waitFor(() =>
        expect(toastState.error).toHaveBeenCalledWith(
          'knowledgeErrors.taskFailure.vectorSpaceQuotaExceeded',
        ),
      )
      expect(toastState.success).not.toHaveBeenCalled()
      expect(
        screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }),
      ).toBeEnabled()
    },
  )

  it('shows a quota verification failure in the detail task drawer', async () => {
    const user = userEvent.setup()
    const failedTask = task({ state: 'failed' })
    taskSnapshotQuery.data = failedTask
    documentQuery.data = logicalDocument({ latestTask: failedTask })
    tasksQuery.data = { pages: [{ items: [failedTask] }] }
    retryTaskRequest.mockRejectedValueOnce(
      Response.json(
        {
          failure: {
            action: 'retry',
            category: 'dependency',
            code: 'VECTOR_SPACE_QUOTA_UNAVAILABLE',
            message: 'Upstream billing diagnostics',
            retryPolicy: 'manual',
          },
        },
        { status: 503 },
      ),
    )

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'knowledgeDocuments.viewTask' }))
    const drawer = screen.getByRole('dialog', { name: 'knowledgeSpace.backgroundTasks' })
    await user.click(within(drawer).getByRole('button', { name: 'knowledgeSpace.retryTask' }))

    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'knowledgeErrors.taskFailure.vectorSpaceQuotaUnavailable',
    )
    expect(within(drawer).getByRole('button', { name: 'knowledgeSpace.retryTask' })).toBeEnabled()
    expect(retryTaskRequest).toHaveBeenCalledWith(expect.anything(), { context: { silent: true } })
    expect(permissionState.refresh).not.toHaveBeenCalled()
  })

  it('prompts for model setup before re-indexing a document', async () => {
    const user = userEvent.setup()
    settingsState.configurationState = 'setup-required'
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await user.click(screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }))

    expect(reindexMutation.mutateAsync).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', {
      name: 'knowledgeSpace.overview.attention.modelReadiness.title',
    })
    await user.click(
      within(dialog).getByRole('button', {
        name: 'modelProvider.modelProvider.selector.configure',
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
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const button = screen.getByRole('button', {
      name: 'knowledgeDocuments.reindexDocument',
    })

    await user.dblClick(button)
    expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
    resolveReindex?.(missingReindexResult())
    await waitFor(() =>
      expect(toastState.error).toHaveBeenCalledWith('knowledgeDocuments.documentNotFoundTitle'),
    )
    expect(toastState.success).not.toHaveBeenCalled()
    expect(
      screen.getByRole('heading', { name: 'knowledgeDocuments.documentNotFoundTitle' }),
    ).toBeInTheDocument()
  })

  it('does not render cached document data after a refetch returns 403 or 404', async () => {
    documentQuery.error = createHttpError(new Response(null, { status: 404 }))
    const rendered = await render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    expect(
      screen.getByRole('heading', { name: 'knowledgeDocuments.documentNotFoundTitle' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('sso-enterprise.pdf')).toBeNull()

    documentQuery.error = createHttpError(new Response(null, { status: 403 }))
    await rendered.rerender(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    expect(screen.queryByText('sso-enterprise.pdf')).toBeNull()

    // Permission and existence failures are final, so the request is not retried.
    expect(documentQuery.refetch).toHaveBeenCalledOnce()
  })

  it('invalidates document content when an accepted re-index first appears as terminal', async () => {
    const user = userEvent.setup()
    const rendered = await render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    await user.click(screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }))
    await waitFor(() => expect(toastState.success).toHaveBeenCalled())
    documentQuery.refetch.mockClear()
    taskSnapshotQuery.data = task({
      id: 'compilation-job-1',
      documentRevision: 4,
      state: 'succeeded',
    })
    await rendered.rerender(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    await waitFor(() => expect(documentQuery.refetch).toHaveBeenCalled())
  })

  it('uses the latest document snapshot even when history has more pages', async () => {
    documentQuery.data = { ...documentQuery.data!, latestTask: task({ state: 'running' }) }
    tasksQuery.data = undefined
    tasksQuery.hasNextPage = true
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    expect(
      screen.getByRole('button', { name: 'knowledgeDocuments.cancelDocumentReindex' }),
    ).toBeEnabled()
    expect(tasksQuery.fetchNextPage).not.toHaveBeenCalled()
  })

  it('keeps re-index cancellation available through invalidation and stale task-list reconciliation', async () => {
    const user = userEvent.setup()
    let finishInvalidation: (() => void) | undefined
    const invalidation = new Promise<void>((resolve) => {
      finishInvalidation = resolve
    })

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    // Holds the document refresh that the accepted re-index triggers.
    documentQuery.refetch.mockReturnValueOnce(invalidation)
    const button = screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' })
    await user.click(button)

    expect(button).toHaveAccessibleName('knowledgeDocuments.cancelDocumentReindex')
    expect(button).not.toHaveAttribute('data-disabled')
    expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('knowledgeDocuments.documentReindexStatus')
    await act(async () => finishInvalidation?.())
    await waitFor(() => expect(toastState.success).toHaveBeenCalled())
    expect(button).toHaveTextContent('knowledgeDocuments.cancelDocumentReindex')
    expect(button).not.toHaveAttribute('data-disabled')
    expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
    expect(cancelMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('does not mistake an earlier failed revision for the newly submitted re-index', async () => {
    const user = userEvent.setup()
    taskSnapshotQuery.data = task({ documentRevision: 4, id: 'old-failed', state: 'failed' })
    documentQuery.data = logicalDocument({ latestTask: taskSnapshotQuery.data })
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const button = screen.getByRole('button', {
      name: 'knowledgeDocuments.retryReindexDocument',
    })

    await user.click(button)
    await waitFor(() => expect(toastState.success).toHaveBeenCalled())
    expect(button).toHaveTextContent('knowledgeDocuments.cancelDocumentReindex')
    expect(button).not.toHaveAttribute('data-disabled')
    expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
    expect(cancelMutation.mutateAsync).not.toHaveBeenCalled()

    expect(lastInput('task-snapshot')).toEqual({
      params: { control_space_id: 'space-1' },
      query: { task_ids: 'compilation-job-1' },
    })
  })

  it('keeps the accepted re-index state while task discovery is delayed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    taskSnapshotQuery.data = task({ documentRevision: 4, id: 'old-failed', state: 'failed' })
    documentQuery.data = logicalDocument({ latestTask: taskSnapshotQuery.data })
    try {
      await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
      const reindexButton = screen.getByRole('button', {
        name: 'knowledgeDocuments.retryReindexDocument',
      })
      await act(async () => {
        fireEvent.click(reindexButton)
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(() => vi.advanceTimersByTimeAsync(30000))

      expect(screen.getByRole('status')).toHaveTextContent(
        'knowledgeDocuments.documentReindexStatus',
      )
      expect(reindexButton).toHaveTextContent('knowledgeDocuments.cancelDocumentReindex')
      expect(reindexButton).not.toHaveAttribute('data-disabled')
      expect(reindexMutation.mutateAsync).toHaveBeenCalledOnce()
      expect(
        screen.queryByText('knowledgeSpace.documentReindexConfirmationDelayed'),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'knowledgeDocuments.retryReindexDocument' }),
      ).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses active-task polling after the exact snapshot observes the new task', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup()
    const rendered = await render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    await user.click(screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }))
    await waitFor(() => expect(toastState.success).toHaveBeenCalled())

    taskSnapshotQuery.data = task({
      documentRevision: 3,
      id: 'compilation-job-1',
      state: 'running',
    })
    await rendered.rerender(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    const reads = snapshotReads()
    await advance(5100)

    expect(snapshotReads()).toBeGreaterThan(reads)
  })

  it('recognizes the accepted re-index task when it recompiles the active revision', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const rendered = await render(
        <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
      )
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }))
        await Promise.resolve()
        await Promise.resolve()
      })

      taskSnapshotQuery.data = task({
        documentRevision: 3,
        id: 'compilation-job-1',
        state: 'running',
      })
      await rendered.rerender(
        <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
      )

      expect(
        screen.getByRole('button', { name: 'knowledgeDocuments.cancelDocumentReindex' }),
      ).not.toHaveAttribute('data-disabled')
      await act(() => vi.advanceTimersByTimeAsync(30000))
      expect(
        screen.queryByRole('button', { name: 'knowledgeDocuments.retryReindexDocument' }),
      ).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces exact task authorization failures and blocks re-indexing', async () => {
    documentQuery.data = logicalDocument({ latestTask: task({ state: 'succeeded' }) })
    taskSnapshotQuery.data = undefined
    taskSnapshotQuery.error = createHttpError(new Response(null, { status: 403 }))
    const rendered = await render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('knowledgeSpace.tasksErrorDescription')
    expect(
      screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }),
    ).toHaveAttribute('data-disabled')
    // A denied snapshot is terminal for polling.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const reads = snapshotReads()
    await advance(15_000)
    expect(snapshotReads()).toBe(reads)
    vi.useRealTimers()

    taskSnapshotQuery.error = createHttpError(new Response(null, { status: 404 }))
    await rendered.rerender(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('knowledgeSpace.tasksErrorDescription')
  })

  it('recovers task state from its exact snapshot without task history', async () => {
    documentQuery.data = logicalDocument({ latestTask: task({ state: 'succeeded' }) })
    taskSnapshotQuery.data = undefined
    taskSnapshotQuery.error = createHttpError(new Response(null, { status: 404 }))
    const rendered = await render(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )

    taskSnapshotQuery.error = null
    taskSnapshotQuery.data = task({ state: 'running' })
    await rendered.rerender(
      <DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('knowledgeDocuments.documentReindexStatus')
  })

  it('refreshes stale detail and task-list caches for a newer terminal task on revisit', async () => {
    taskSnapshotQuery.data = task({ documentRevision: 4, state: 'succeeded' })
    documentQuery.data = logicalDocument({ latestTask: taskSnapshotQuery.data })
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    await waitFor(() => expect(documentQuery.refetch).toHaveBeenCalled())
  })

  it('locks local writes during a 403 refresh and restores editor access afterward', async () => {
    const user = userEvent.setup()
    let finishPermissionRefresh: ((value: { permission_keys: string[] }) => void) | undefined
    knowledgeSpacePermissionState.refetch.mockReturnValueOnce(
      new Promise<{ permission_keys: string[] }>((resolve) => {
        finishPermissionRefresh = resolve
      }),
    )
    reindexMutation.mutateAsync.mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 403 })),
    )

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const button = screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' })
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
    reindexMutation.mutateAsync.mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 403 })),
    )

    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    const button = screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' })
    await user.click(button)

    await waitFor(() => expect(knowledgeSpacePermissionState.refetch).toHaveBeenCalledOnce())
    expect(button).toHaveAttribute('data-disabled')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('knowledgeSpace.documentPermissionRestricted')
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

  it('disables re-index while the document is deleting', async () => {
    documentQuery.data = logicalDocument({ status: 'deleting' })
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)

    expect(
      screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }),
    ).toHaveAttribute('data-disabled')
  })

  it('keeps virtual tree focus stable across Home and End and exposes sibling positions', async () => {
    chunksQuery.data = {
      pages: [
        {
          items: Array.from({ length: 100 }, (_, index) =>
            chunk({ id: `chunk-${index}`, ordinal: index + 1, text: `Chunk ${index + 1}` }),
          ),
        },
      ],
    }
    await render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
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

  describe('document metadata editor', () => {
    const renderWithMetadata = async (userMetadata: Record<string, unknown>) => {
      documentQuery.data = logicalDocument({ userMetadata })
      return render(<DocumentDetailPage documentId="document-1" knowledgeSpaceId="space-1" />)
    }
    const openCreateForm = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(
        screen.getByRole('button', { name: 'dataset.metadata.documentMetadata.startLabeling' }),
      )
      await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
      await user.click(
        await screen.findByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
      )
      return screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' })
    }

    it('saves untouched timestamps unchanged after opening the editor', async () => {
      const user = userEvent.setup()
      metadataFieldsQuery.data = [metadataField({ name: 'reviewed_at', type: 'time' })]
      await renderWithMetadata({ category: 'support', reviewed_at: '2026-08-04T10:00:45.123Z' })

      await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      const category = await screen.findByRole('textbox', { name: 'category' })
      await user.clear(category)
      await user.type(category, 'security')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() =>
        expect(patchDocumentMetadata).toHaveBeenCalledWith({
          body: { expectedRowVersion: 2, patch: { category: 'security' } },
          params: { control_space_id: 'space-1', document_id: 'document-1' },
        }),
      )
    })

    it('closes without a request when only an untouched timestamp is present', async () => {
      const user = userEvent.setup()
      await renderWithMetadata({ reviewed_at: '2026-08-04T10:00:45.123Z' })

      await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      await user.click(await screen.findByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => expect(screen.queryByLabelText('reviewed_at')).not.toBeInTheDocument())
      expect(patchDocumentMetadata).not.toHaveBeenCalled()
    })

    it('locks draft controls while a save is pending', async () => {
      const user = userEvent.setup()
      const pendingSave = createDeferred<ReturnType<typeof logicalDocumentApiResponse>>()
      patchDocumentMetadata.mockReturnValueOnce(pendingSave.promise)
      await renderWithMetadata({ category: 'support', owner: 'alice' })

      await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      const category = await screen.findByRole('textbox', { name: 'category' })
      await user.clear(category)
      await user.type(category, 'security')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      const owner = screen.getByRole('textbox', { name: 'owner' })
      await waitFor(() => expect(owner).toBeDisabled())
      expect(category).toBeDisabled()
      expect(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' })).toBeDisabled()
      await user.type(owner, 'bob')
      expect(owner).toHaveValue('alice')

      await act(async () =>
        pendingSave.resolve(logicalDocumentApiResponse(logicalDocument({ rowVersion: 3 }))),
      )
      await waitFor(() =>
        expect(toastState.success).toHaveBeenCalledWith('common.api.actionSuccess'),
      )
      expect(patchDocumentMetadata).toHaveBeenCalledOnce()
    })

    it('creates the field again when the previous creation request failed', async () => {
      const user = userEvent.setup()
      createMetadataField.mockRejectedValueOnce(new Error('create failed'))
      await renderWithMetadata({})

      const nameInput = await openCreateForm(user)
      await user.type(nameInput, 'priority{Enter}')
      await waitFor(() =>
        expect(toastState.error).toHaveBeenCalledWith('knowledgeSpace.settings.saveFailed'),
      )
      expect(patchDocumentMetadata).not.toHaveBeenCalled()

      await user.click(
        within(nameInput.closest('form')!).getByRole('button', { name: 'common.operation.save' }),
      )

      await waitFor(() => expect(createMetadataField).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(patchDocumentMetadata).toHaveBeenCalledOnce())
    })

    it('skips creation on retry only after the field was created', async () => {
      const user = userEvent.setup()
      patchDocumentMetadata.mockRejectedValueOnce(new Error('update failed'))
      await renderWithMetadata({})

      const nameInput = await openCreateForm(user)
      await user.type(nameInput, 'priority{Enter}')
      await waitFor(() =>
        expect(toastState.error).toHaveBeenCalledWith('knowledgeSpace.settings.saveFailed'),
      )
      metadataFieldsQuery.data = [metadataField({ name: 'priority' })]

      await user.click(
        within(nameInput.closest('form')!).getByRole('button', { name: 'common.operation.save' }),
      )

      await waitFor(() => expect(patchDocumentMetadata).toHaveBeenCalledTimes(2))
      expect(createMetadataField).toHaveBeenCalledOnce()
    })
  })
})

import type {
  KnowledgeFsProductPermission,
  KnowledgeFsSourceResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RagPipelineDatasourceProviderResponse } from '@dify/contracts/api/console/rag/types.gen'
import type { Source } from '../source-models'
import { onTestFinished, vi } from 'vite-plus/test'
import { apiError, installFakeApi } from '@/test/fake-api'
import { sourceApiResponse } from './source-api-fixture'
import { source, sourceConnectionResponse, workflow } from './source-fixtures'

type ResponsePage<Item> = {
  items?: Item[]
  data?: Item[]
  nextCursor?: string
  next_cursor?: string | null
}
function paginatedResponses<Item>() {
  return {
    data: undefined as { pages: ResponsePage<Item>[] } | undefined,
    error: null as unknown,

    pending: false,
    nextPageError: false,
    next: vi.fn(),
    refresh: vi.fn(),
  }
}
export const sourceResponses = paginatedResponses<Source>()
export const connectionResponses = paginatedResponses<typeof sourceConnectionResponse>()
export const pluginResponses = {
  data: [] as RagPipelineDatasourceProviderResponse[] | undefined,
  pending: false,
  failed: false,
}
export const clientMock = {
  deleteSource: vi.fn(),
  deletePreviewJob: vi.fn(),
  getPreviewJob: vi.fn(),
  patchSource: vi.fn(),
  previewConnectedSource: vi.fn(),
  startPreviewJob: vi.fn(),
  retrySourceWorkflow: vi.fn(),
  syncSource: vi.fn(),
}
export const server = {
  inflight: 0,
  inputs: new Map<string, unknown[]>(),
  reads: new Map<string, number>(),
}
export const permissionState = {
  knowledgeSpacePermissionKeys: [
    'knowledge_space_document_write',
  ] as KnowledgeFsProductPermission[],
  workspacePermissionKeys: ['dataset.acl.edit', 'dataset.external.connect'],
}
export const navigationMock = { awaitInitialSource: null as string | null }
export const routerMock = { push: vi.fn(), replace: vi.fn() }
export const navigation = {
  usePathname: () => '/datasets/new/space-1/sources',
  useRouter: () => routerMock,
  useSearchParams: () =>
    new URLSearchParams(
      navigationMock.awaitInitialSource
        ? { awaitInitialSource: navigationMock.awaitInitialSource }
        : {},
    ),
}
export const settingsState = { configurationState: 'active' as 'active' | 'setup-required' }
const forever = () => new Promise<never>(() => {})
async function track<T>(read: () => Promise<T> | T) {
  server.inflight += 1
  try {
    return await read()
  } finally {
    server.inflight -= 1
  }
}
function paged<Item, Output>(
  resource: string,
  responses: ReturnType<typeof paginatedResponses<Item>>,
  toApi: (item: Item) => Output,
) {
  return (input: { query?: { cursor?: string } }) => {
    server.inputs.set(resource, [...(server.inputs.get(resource) ?? []), input])
    if (responses.pending) return forever()
    return track(async () => {
      const cursor = input.query?.cursor
      const reads = server.reads.get(resource) ?? 0
      server.reads.set(resource, reads + 1)
      if (cursor) {
        await responses.next()
        if (responses.nextPageError)
          throw apiError({
            status: 503,
            code: 'SERVICE_UNAVAILABLE',
            message: `${resource} next page unavailable`,
          })
      } else {
        if (reads) await responses.refresh()
        if (responses.error) throw responses.error
      }
      const pages = responses.data?.pages ?? []
      const next = (page?: ResponsePage<Item>) => page?.nextCursor ?? page?.next_cursor ?? undefined
      const index = cursor ? pages.findIndex((_, i) => i > 0 && next(pages[i - 1]) === cursor) : 0
      const page = pages[index < 0 ? pages.length : index]
      return { data: (page?.items ?? page?.data ?? []).map(toApi), next_cursor: next(page) ?? null }
    })
  }
}
function settingsResponse() {
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
    retrieval: null,
    issues: [],
    revision: 1,
  }
}

// The fixture mapper is loosely typed; the fake API validates the response against the contract.
const sourceResponse = (item: Source) => sourceApiResponse(item) as KnowledgeFsSourceResponse

/** Serve the sources surface through the fake console API; reads stay tracked for `settle()`. */
function installSourceApi() {
  onTestFinished(
    installFakeApi({
      console: {
        knowledgeFs: {
          sourceProviderPreview: {
            post: (input) => clientMock.previewConnectedSource(input),
            jobs: {
              post: (input) => clientMock.startPreviewJob(input),
              byJobId: {
                get: (input) => clientMock.getPreviewJob(input),
                delete: (input) => clientMock.deletePreviewJob(input),
              },
            },
          },
          spaces: {
            byControlSpaceId: {
              settings: { get: settingsResponse },
              sourceConnections: { get: paged('connections', connectionResponses, (x) => x) },
              sources: {
                get: paged('sources', sourceResponses, sourceResponse),
                bySourceId: {
                  delete: (input) => clientMock.deleteSource(input),
                  patch: async (input) => sourceResponse(await clientMock.patchSource(input)),
                  sync: { post: (input) => clientMock.syncSource(input) },
                },
              },
              sourceWorkflows: {
                byRunId: { retry: { post: (input) => clientMock.retrySourceWorkflow(input) } },
              },
            },
          },
        },
        rag: {
          pipelines: {
            datasourcePlugins: {
              get: () =>
                pluginResponses.pending
                  ? forever()
                  : track(async () => {
                      if (pluginResponses.failed)
                        throw apiError({
                          status: 503,
                          code: 'SERVICE_UNAVAILABLE',
                          message: 'plugins unavailable',
                        })
                      return pluginResponses.data ?? []
                    }),
            },
          },
        },
      },
    }),
  )
}
export function resetSourceServer() {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.clearAllMocks()
  server.inflight = 0
  server.inputs.clear()
  server.reads.clear()
  for (const responses of [sourceResponses, connectionResponses]) {
    responses.refresh.mockReset()
    responses.next.mockReset()
    responses.data = undefined
    responses.error = null
    responses.pending = false
    responses.nextPageError = false
  }
  pluginResponses.data = []
  pluginResponses.pending = false
  pluginResponses.failed = false
  navigationMock.awaitInitialSource = null
  clientMock.deleteSource
    .mockReset()
    .mockImplementation(async ({ params }: { params: { source_id: string } }) => ({
      status_url: '/deletion',
      job: {
        checkpoint: 'requested',
        created_at: '2026-07-20T10:00:00Z',
        id: 'delete-1',
        knowledge_space_id: 'space-1',
        run_state: 'queued',
        target_id: params.source_id,
        target_type: 'source',
        updated_at: '2026-07-20T10:00:00Z',
      },
    }))
  clientMock.deletePreviewJob
    .mockReset()
    .mockImplementation(async ({ params }: { params: { job_id: string } }) => ({
      job_id: params.job_id,
      status: 'canceled',
    }))
  clientMock.patchSource.mockReset().mockResolvedValue(source({}))
  clientMock.retrySourceWorkflow.mockReset().mockResolvedValue(workflow())
  clientMock.syncSource.mockReset().mockResolvedValue(workflow())
  clientMock.previewConnectedSource.mockReset()
  clientMock.startPreviewJob.mockReset()
  clientMock.getPreviewJob.mockReset()
  permissionState.workspacePermissionKeys = ['dataset.acl.edit', 'dataset.external.connect']
  permissionState.knowledgeSpacePermissionKeys = ['knowledge_space_document_write']
  settingsState.configurationState = 'active'
  installSourceApi()
}
export function serveWebsitePreview(
  pages = [{ source_url: 'https://docs.example.com/guide', title: 'Guide' }],
) {
  connectionResponses.data = { pages: [{ data: [sourceConnectionResponse], next_cursor: null }] }
  clientMock.startPreviewJob.mockResolvedValue({ job_id: 'preview-job-1' })
  clientMock.getPreviewJob.mockResolvedValue({
    job_id: 'preview-job-1',
    result: { kind: 'website_crawl', pages },
    status: 'completed',
  })
}

export function serveNotionConnection() {
  connectionResponses.data = {
    pages: [
      {
        data: [
          {
            ...sourceConnectionResponse,
            configuration: {
              credentialId: 'credential-notion',
              datasource: 'notion',
              pluginId: 'langgenius/notion_datasource',
              provider: 'notion_datasource',
              providerKind: 'online-document',
            },
            id: 'connection-notion',
            name: 'Notion',
            provider_id: 'plugin-daemon-online-document',
          },
        ],
        next_cursor: null,
      },
    ],
  }
}

export function serveDriveConnection() {
  connectionResponses.data = {
    pages: [
      {
        data: [
          {
            ...sourceConnectionResponse,
            configuration: {
              credentialId: 'credential-drive',
              datasource: 'google_drive',
              pluginId: 'langgenius/google_drive',
              provider: 'google_drive',
              providerKind: 'online-drive',
            },
            id: 'connection-drive',
            name: 'Google Drive',
            provider_id: 'plugin-daemon-online-drive',
          },
        ],
        next_cursor: null,
      },
    ],
  }
}

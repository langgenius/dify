import type { KnowledgeFsProductPermission } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RagPipelineDatasourceProviderResponse } from '@dify/contracts/api/console/rag/types.gen'
import type { Source } from '../source-models'
import { vi } from 'vite-plus/test'
import { withConsoleClientResponses, withConsoleResponses } from '@/test/console/service-responses'
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
function paged<Item>(
  resource: string,
  responses: ReturnType<typeof paginatedResponses<Item>>,
  toApi: (item: Item) => unknown,
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
        if (responses.nextPageError) throw new Error(`${resource} next page unavailable`)
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
export function withSourceResponses(actual: typeof import('@/service/console')) {
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'knowledgeFs.sourceProviderPreview.jobs.byJobId.delete': clientMock.deletePreviewJob,
      'knowledgeFs.sourceProviderPreview.jobs.byJobId.get': clientMock.getPreviewJob,
      'knowledgeFs.sourceProviderPreview.jobs.post': clientMock.startPreviewJob,
      'knowledgeFs.sourceProviderPreview.post': clientMock.previewConnectedSource,
      'knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.delete': clientMock.deleteSource,
      'knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch': async (input: never) =>
        sourceApiResponse(await clientMock.patchSource(input)),
      'knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.sync.post': clientMock.syncSource,
      'knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.retry.post':
        clientMock.retrySourceWorkflow,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.datasourcePlugins.get': () =>
        pluginResponses.pending
          ? forever()
          : track(async () => {
              if (pluginResponses.failed) throw new Error('plugins unavailable')
              return pluginResponses.data ?? []
            }),
      'knowledgeFs.spaces.byControlSpaceId.settings.get': async () => {
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
      },
      'knowledgeFs.spaces.byControlSpaceId.sourceConnections.get': paged(
        'connections',
        connectionResponses,
        (x) => x,
      ),
      'knowledgeFs.spaces.byControlSpaceId.sources.get': paged(
        'sources',
        sourceResponses,
        sourceApiResponse,
      ),
    }),
  }
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
  clientMock.deleteSource.mockReset().mockResolvedValue({ status: 'accepted' })
  clientMock.deletePreviewJob.mockReset().mockResolvedValue({ status: 'canceled' })
  clientMock.patchSource.mockReset().mockResolvedValue(source({}))
  clientMock.retrySourceWorkflow.mockReset().mockResolvedValue(workflow())
  clientMock.syncSource.mockReset().mockResolvedValue(workflow())
  clientMock.previewConnectedSource.mockReset()
  clientMock.startPreviewJob.mockReset()
  clientMock.getPreviewJob.mockReset()
  permissionState.workspacePermissionKeys = ['dataset.acl.edit', 'dataset.external.connect']
  permissionState.knowledgeSpacePermissionKeys = ['knowledge_space_document_write']
  settingsState.configurationState = 'active'
}
export function serveWebsitePreview(
  pages = [{ source_url: 'https://docs.example.com/guide', title: 'Guide' }],
) {
  connectionResponses.data = { pages: [{ data: [sourceConnectionResponse], next_cursor: null }] }
  clientMock.startPreviewJob.mockResolvedValue({ job_id: 'preview-job-1' })
  clientMock.getPreviewJob.mockResolvedValue({
    result: { pages },
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

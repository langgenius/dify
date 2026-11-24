import type {
  KnowledgeFsInitialSourcePreviewJobResponse,
  KnowledgeFsProductPermission,
  KnowledgeFsSourceResponse,
  PostKnowledgeFsSpacesByControlSpaceIdSourcesBySourceIdSyncResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RagPipelineDatasourceProviderResponse } from '@dify/contracts/api/console/rag/types.gen'
import type { Source } from '../source-models'
import { onTestFinished, vi } from 'vite-plus/test'
import { apiError, installFakeApi, pendingResponse } from '@/test/fake-api'
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
export const server = {
  inflight: 0,
  reads: new Map<string, number>(),
}
export const permissionState = {
  knowledgeSpacePermissionKeys: [
    'knowledge_space_document_write',
  ] as KnowledgeFsProductPermission[],
  workspacePermissionKeys: ['dataset.acl.edit', 'dataset.external.connect'],
}
/** Route inputs for the next `renderSources` call. */
export const routeState = { awaitInitialSource: null as string | null }
export const settingsState = { configurationState: 'active' as 'active' | 'setup-required' }
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
    if (responses.pending) return pendingResponse()
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

// The fixture mappers are loosely typed; the fake API validates responses against the contract.
export const sourceResponse = (item: Source) => sourceApiResponse(item) as KnowledgeFsSourceResponse
export const workflowResponse = (state?: string) =>
  workflow(state) as PostKnowledgeFsSpacesByControlSpaceIdSourcesBySourceIdSyncResponse

const websitePreviewJob = (
  pages = [{ source_url: 'https://docs.example.com/guide', title: 'Guide' }],
): KnowledgeFsInitialSourcePreviewJobResponse => ({
  job_id: 'preview-job-1',
  result: { kind: 'website_crawl', pages },
  status: 'completed',
})

/** Serve the sources surface through the fake console API; reads stay tracked for `settle()`. */
function installSourceApi() {
  return installFakeApi({
    console: {
      knowledgeFs: {
        sourceProviderPreview: {
          post: async () => ({
            kind: 'online_document',
            documents: [],
          }),
          jobs: {
            post: async () => ({
              job_id: 'preview-job-1',
            }),
            byJobId: {
              get: async () => websitePreviewJob(),
              delete: async ({ params }) => ({
                job_id: params.job_id,
                status: 'canceled',
              }),
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
                delete: async ({ params }) => ({
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
                }),
                patch: async () => sourceResponse(source({})),
                sync: { post: async () => workflowResponse() },
              },
            },
            sourceWorkflows: {
              byRunId: { retry: { post: async () => workflowResponse() } },
            },
          },
        },
      },
      rag: {
        pipelines: {
          datasourcePlugins: {
            get: () =>
              pluginResponses.pending
                ? pendingResponse()
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
  })
}
export type SourceApi = ReturnType<typeof installSourceApi>
let sourceApi: SourceApi

/** Reset the tracked server state and install a fresh fake API, whose handler spies it returns. */
export function resetSourceServer() {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.clearAllMocks()
  server.inflight = 0
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
  routeState.awaitInitialSource = null
  permissionState.workspacePermissionKeys = ['dataset.acl.edit', 'dataset.external.connect']
  permissionState.knowledgeSpacePermissionKeys = ['knowledge_space_document_write']
  settingsState.configurationState = 'active'
  sourceApi = installSourceApi()
  onTestFinished(sourceApi)
  return sourceApi
}
export function serveWebsitePreview(pages?: Parameters<typeof websitePreviewJob>[0]) {
  connectionResponses.data = { pages: [{ data: [sourceConnectionResponse], next_cursor: null }] }
  sourceApi.console.knowledgeFs.sourceProviderPreview.jobs.byJobId.get.mockResolvedValue(
    websitePreviewJob(pages),
  )
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

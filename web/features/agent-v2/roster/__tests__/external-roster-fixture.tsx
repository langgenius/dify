import type {
  ExternalAgentAssetResponse,
  ExternalAgentListResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import type { Mock } from 'vite-plus/test'
import type { ConsoleClient } from '@/service/console'
import { ORPCError } from '@orpc/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import {
  createExternalAgentAsset,
  createExternalAgentCapabilities,
  createExternalAgentDetail,
  createExternalAgentReferences,
} from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { ExternalRoster } from '../external-roster'
import RosterPage from '../page'

type RosterRequests = Record<
  'list' | 'capabilities' | 'detail' | 'references' | 'info' | 'enabled' | 'remove' | 'difyList',
  Mock
>

export const vendorId = '44444444-4444-4444-8444-444444444444'
export const server: { assets: ExternalAgentAssetResponse[] } = { assets: [] }

export async function createRosterFixture({
  role = 'owner',
  searchParams = '',
  pageOwner = false,
}: { role?: 'owner' | 'editor' | 'normal'; searchParams?: string; pageOwner?: boolean } = {}) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, common, app } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role, id: '99999999-9999-4999-8999-999999999999' },
    accountProfile: { id: '11111111-1111-4111-8111-111111111111' },
  })
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({
    hasMemory: true,
    searchParams,
  })
  return {
    queryClient,
    onUrlUpdate,
    ui: (
      <QueryProvider>
        <UrlState>
          <I18nextProvider i18n={i18n}>
            <div className="flex h-screen flex-col">
              {pageOwner ? <RosterPage /> : <ExternalRoster />}
            </div>
          </I18nextProvider>
        </UrlState>
      </QueryProvider>
    ),
  }
}

export function resetRoster(requests: RosterRequests) {
  requests.difyList.mockReset().mockResolvedValue({
    data: [],
    page: 1,
    has_more: false,
    publication_counts: { drafts: 0, published: 0 },
  })
  server.assets = [
    createExternalAgentAsset({
      id: vendorId,
      name: 'Vendor Screening Agent',
      enabled: false,
      created_by: 'another-actor',
    }),
    createExternalAgentAsset(),
  ]
  requests.capabilities.mockReset().mockResolvedValue(createExternalAgentCapabilities())
  requests.list
    .mockReset()
    .mockImplementation(
      (input: Parameters<ConsoleClient['externalAgents']['get']>[0]): ExternalAgentListResponse => {
        const query = input?.query ?? {}
        const filtered = server.assets.filter(
          (asset) =>
            (!query.keyword || asset.name.toLowerCase().includes(query.keyword.toLowerCase())) &&
            (!query.connected_by_me || asset.created_by === '11111111-1111-4111-8111-111111111111'),
        )
        const matched = filtered.filter(
          (asset) => query.enabled === undefined || asset.enabled === query.enabled,
        )
        const page = query.page ?? 1
        const limit = query.limit ?? 20
        return {
          items: matched.slice((page - 1) * limit, page * limit),
          total: matched.length,
          enabled_count: filtered.filter((asset) => asset.enabled).length,
          disabled_count: filtered.filter((asset) => !asset.enabled).length,
          page,
          limit,
        }
      },
    )
  requests.detail
    .mockReset()
    .mockImplementation(
      ({ params }: Parameters<ConsoleClient['externalAgents']['byAgentId']['get']>[0]) => {
        const asset = server.assets.find((item) => item.id === params.agent_id)
        if (!asset) throw new ORPCError('not_found', { status: 404 })
        return createExternalAgentDetail({ asset })
      },
    )
  requests.references.mockReset().mockResolvedValue(createExternalAgentReferences())
  requests.info
    .mockReset()
    .mockImplementation(
      ({
        params,
        body,
      }: Parameters<ConsoleClient['externalAgents']['byAgentId']['info']['patch']>[0]) => {
        const current = server.assets.find((item) => item.id === params.agent_id)
        if (!current) throw new ORPCError('not_found', { status: 404 })
        const updated = {
          ...current,
          ...body.changes,
          metadata_revision: current.metadata_revision + 1,
        }
        server.assets = server.assets.map((item) => (item.id === updated.id ? updated : item))
        return updated
      },
    )
  requests.enabled
    .mockReset()
    .mockImplementation(
      ({
        params,
        body,
      }: Parameters<ConsoleClient['externalAgents']['byAgentId']['enabled']['put']>[0]) => {
        const current = server.assets.find((item) => item.id === params.agent_id)
        if (!current) throw new ORPCError('not_found', { status: 404 })
        const updated = { ...current, enabled: body.enabled }
        server.assets = server.assets.map((item) => (item.id === updated.id ? updated : item))
        return updated
      },
    )
  requests.remove
    .mockReset()
    .mockImplementation(
      ({ params }: Parameters<ConsoleClient['externalAgents']['byAgentId']['delete']>[0]) => {
        server.assets = server.assets.filter((item) => item.id !== params.agent_id)
      },
    )
}

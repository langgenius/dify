import type { AppNetworkAccessGroupResponse } from '@dify/contracts/api/console/apps/types.gen'
import type {
  NetworkAccessGroupListResponse,
  NetworkAccessGroupResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function createNetworkAccessGroupFixture(
  overrides: Partial<NetworkAccessGroupResponse> = {},
): NetworkAccessGroupResponse {
  return {
    id: 'group-1',
    tenant_id: 'workspace-1',
    name: 'Internal Network',
    description: '',
    allowed_cidrs: ['203.0.113.42/32', '198.51.100.0/24'],
    app_ids: [],
    apps: [],
    used_by_count: 0,
    enforcing_count: 0,
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    updated_by_account_id: null,
    ...overrides,
  }
}

export function seedNetworkAccessGroups(
  queryClient: QueryClient,
  overrides: Partial<NetworkAccessGroupListResponse> = {},
): NetworkAccessGroupListResponse {
  const data: NetworkAccessGroupListResponse = {
    tenant_id: 'workspace-1',
    entitled: true,
    groups: [],
    ...overrides,
  }
  queryClient.setQueryData(
    consoleQuery.workspaces.current.networkAccessGroups.get.queryOptions().queryKey,
    data as never,
  )
  return data
}

export function seedAppNetworkAccessGroup(
  queryClient: QueryClient,
  appId: string,
  overrides: Partial<AppNetworkAccessGroupResponse> = {},
): AppNetworkAccessGroupResponse {
  const data: AppNetworkAccessGroupResponse = {
    tenant_id: 'workspace-1',
    app_id: appId,
    entitled: true,
    effective_enabled: false,
    available_access_points: ['webapp', 'service_api', 'mcp'],
    binding: null,
    ...overrides,
  }
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.networkAccessGroup.get.queryOptions({
      input: { params: { app_id: appId } },
    }).queryKey,
    data,
  )
  return data
}

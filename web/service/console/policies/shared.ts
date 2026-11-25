import type { RouterUtils } from '@orpc/tanstack-query'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'

export function invalidateQueryKeys(client: QueryClient, queryKeys: QueryKey[]) {
  return Promise.all(queryKeys.map((queryKey) => client.invalidateQueries({ queryKey })))
}

export async function refreshAgentTagCatalogs(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
) {
  const filters = { queryKey: query.tags.get.queryKey({ input: { query: { type: 'agent' } } }) }
  // Invalidation alone can reuse an initial GET that started before the write.
  await client.cancelQueries(filters)
  return client.invalidateQueries(filters)
}

export function invalidateNetworkAccessGroupQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.networkAccessGroups.get.key(),
    query.workspaces.current.networkAccessGroups.byGroupId.key(),
    query.apps.byAppId.networkAccessGroup.key(),
  ])
}

export function invalidateHumanInputContactQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.humanInput.v2.contacts.key(),
    query.workspaces.current.humanInput.v2.contactOptions.key(),
    query.workspaces.current.humanInput.v2.imIdentities.key(),
    query.workspaces.current.humanInput.v2.organizationCandidates.key(),
  ])
}

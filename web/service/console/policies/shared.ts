import type { RouterUtils } from '@orpc/tanstack-query'
import type { Query, QueryClient, QueryKey } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'

// Fetches `invalidateQueries` would not restart: a first load (it joins that
// request) or an unobserved query (it is only marked stale, and the read in
// flight still lands).
const isUnrestartedFetch = (query: Query) =>
  query.state.fetchStatus === 'fetching' && (query.state.data === undefined || !query.isActive())

function invalidateEach(client: QueryClient, queryKeys: QueryKey[]) {
  return Promise.all(queryKeys.map((queryKey) => client.invalidateQueries({ queryKey })))
}

/**
 * Marks the queries stale and refetches the active ones with a request that starts
 * after the write. `invalidateQueries` alone joins a first load already in flight
 * (TanStack Query only restarts a fetch for a query that has data) and leaves an
 * unobserved query's read running, so a pre-write response would land and clear
 * the stale flag. Those fetches are cancelled first. Observed queries with data
 * are restarted by `invalidateQueries` itself, so nothing on screen reverts to
 * earlier data. Without such a fetch the invalidation starts right away, as before.
 */
export function invalidateQueryKeys(client: QueryClient, queryKeys: QueryKey[]) {
  const cache = client.getQueryCache()
  const hasUnrestartedFetch = queryKeys.some(
    (queryKey) => cache.findAll({ queryKey, predicate: isUnrestartedFetch }).length > 0,
  )
  if (!hasUnrestartedFetch) return invalidateEach(client, queryKeys)
  return Promise.all(
    queryKeys.map((queryKey) => client.cancelQueries({ queryKey, predicate: isUnrestartedFetch })),
  ).then(() => invalidateEach(client, queryKeys))
}

export async function refreshAgentTagCatalogs(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
) {
  return invalidateQueryKeys(client, [
    query.tags.get.queryKey({ input: { query: { type: 'agent' } } }),
  ])
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

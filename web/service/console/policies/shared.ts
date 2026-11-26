import type { RouterUtils } from '@orpc/tanstack-query'
import type { Query, QueryClient, QueryKey } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'

// Fetches `invalidateQueries` would not restart: a first load (it joins that
// request) or an unobserved query (it is only marked stale, and the read in
// flight still lands).
const isUnrestartedFetch = (query: Query) =>
  query.state.fetchStatus === 'fetching' && (query.state.data === undefined || !query.isActive())

type QueryPredicate = (query: Query) => boolean

function invalidateEach(client: QueryClient, queryKeys: QueryKey[], predicate?: QueryPredicate) {
  return Promise.all(queryKeys.map((queryKey) => client.invalidateQueries({ queryKey, predicate })))
}

/**
 * Marks the queries stale and refetches the active ones with a request that starts
 * after the write. `invalidateQueries` alone joins a first load already in flight
 * (TanStack Query only restarts a fetch for a query that has data) and leaves an
 * unobserved query's read running, so a pre-write response would land and clear
 * the stale flag. Those fetches are cancelled first. Observed queries with data
 * are restarted by `invalidateQueries` itself, so nothing on screen reverts to
 * earlier data. Without such a fetch the invalidation starts right away, as before.
 * `predicate` narrows the queries under the keys that are invalidated.
 */
export function invalidateQueryKeys(
  client: QueryClient,
  queryKeys: QueryKey[],
  predicate?: QueryPredicate,
) {
  const cache = client.getQueryCache()
  const restarts = (query: Query) => isUnrestartedFetch(query) && (!predicate || predicate(query))
  const hasUnrestartedFetch = queryKeys.some(
    (queryKey) => cache.findAll({ queryKey, predicate: restarts }).length > 0,
  )
  if (!hasUnrestartedFetch) return invalidateEach(client, queryKeys, predicate)
  return Promise.all(
    queryKeys.map((queryKey) => client.cancelQueries({ queryKey, predicate: restarts })),
  ).then(() => invalidateEach(client, queryKeys, predicate))
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

/**
 * Adds a created key to its cached key lists, then refreshes them in the background.
 * Create dialogs show the key's one-time secret as soon as the create resolves, so
 * they must not wait for the list refetch; writing the key keeps the list current.
 */
export function addCreatedKeyToLists<TKey extends { id: string }>(
  client: QueryClient,
  listKey: QueryKey,
  created: TKey,
) {
  client.setQueriesData<{ data: TKey[] }>({ queryKey: listKey }, (list) =>
    list && !list.data.some((key) => key.id === created.id)
      ? { ...list, data: [...list.data, created] }
      : list,
  )
  void invalidateQueryKeys(client, [listKey])
}

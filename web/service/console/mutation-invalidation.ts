import type {
  MutationCache,
  MutationKey,
  MutationMeta,
  Query,
  QueryClient,
  QueryKey,
} from '@tanstack/react-query'
import { invalidateQueryKeys } from './policies/shared'

// The part of a mutation the fallback reads, whatever its data and error types.
type AnyMutation = { options: { mutationKey?: MutationKey; meta?: MutationMeta } }

const ROOT = 'console'

/**
 * The procedure path of a console mutation, read from the key oRPC gives it:
 * `[['console', ...path], { type: 'mutation' }]`. Mutations without that key are not seen.
 */
function procedurePathOf(mutation: AnyMutation): string[] | undefined {
  const head = mutation.options.mutationKey?.[0]
  if (!Array.isArray(head) || head[0] !== ROOT) return undefined
  const path = head.slice(1)
  return path.every((segment): segment is string => typeof segment === 'string') ? path : undefined
}

/**
 * The domain a procedure path belongs to: its first segment, or one level deeper where a
 * namespace holds unrelated resources: `workspaces.current.<resource>` (members, plugins,
 * models, …) and `enterprise.<service>`.
 */
export function domainOf(path: readonly string[]): string {
  const depth =
    path[0] === 'workspaces' && path[1] === 'current' ? 3 : path[0] === 'enterprise' ? 2 : 1
  return path.slice(0, depth).join('.')
}

/** The query-key prefix that matches every query under a dotted console path. */
function consolePathKey(path: string): QueryKey {
  return [[ROOT, ...path.split('.')]]
}

type Participant = { domain: string; targets: string[] }

/**
 * Whether the fallback refreshes after this mutation, and what. Reads run through
 * `mutationOptions` (a path ending in `get`) and mutations that set `meta.invalidate: false`
 * do not take part.
 */
function participantOf(mutation: AnyMutation): Participant | undefined {
  const path = procedurePathOf(mutation)
  if (!path?.length || path.at(-1) === 'get') return undefined
  const meta = mutation.options.meta
  if (meta?.invalidate === false) return undefined
  const domain = domainOf(path)
  return { domain, targets: [domain, ...(meta?.alsoInvalidate ?? [])] }
}

type Deferred = { targets: Set<string>; succeededAt: number }

/**
 * When the read behind a query's current data started, in the order events happened. Response
 * arrival time cannot tell a read that started before a write from one that started after it.
 * A cache write does not count: a policy may patch rows of a filtered or paginated list it
 * cannot reconcile (membership, totals), so written queries are still read again.
 */
type QueryOrigin = { fetchStartedAt: number; dataFrom: number }

/**
 * Refreshes, after every successful console mutation, the queries of its domain plus the
 * domains its policy declares in `meta.alsoInvalidate`, so a write no policy covers still
 * leaves no stale data. Policies keep the refreshes a flow must wait for and the response
 * writes; this one is never awaited.
 *
 * - It starts once the mutation's own callbacks have settled, and skips queries whose data was
 *   read by a request that started after the write succeeded, so a policy's awaited refresh is
 *   not fetched twice. A read that started before the write is refreshed, whether it is still
 *   running or already returned its old data, and so is a query the policy wrote into.
 * - A query that sets `meta.invalidateAfterWrites: false` is never refreshed by it.
 * - While another mutation of the same domain is pending, it only records what to refresh;
 *   the last one to finish refreshes everything. A refetch therefore never lands on a
 *   sibling's optimistic value (TkDodo's `isMutating({ mutationKey }) === 1` guard).
 */
export function createMutationInvalidation() {
  // A sequence, not a clock: events within one millisecond keep their order.
  let sequence = 0
  const succeededAt = new WeakMap<AnyMutation, number>()
  const origins = new WeakMap<Query, QueryOrigin>()
  const deferred = new Map<string, Deferred>()

  // Data whose read started, or whose write happened, after the request succeeded reflects it.
  const needsRefresh = (time: number) => (query: Query) => {
    if (query.meta?.invalidateAfterWrites === false) return false
    const origin = origins.get(query)
    // A read started after the success is already bringing current data; restarting it would
    // also cancel an unobserved read (an imperative `query()`) without starting another.
    if (query.state.fetchStatus === 'fetching') return !origin || origin.fetchStartedAt < time
    return !origin || origin.dataFrom < time
  }

  return {
    /** For `MutationCache.onSuccess`: the request succeeded, before any callback runs. */
    onMutationSuccess(mutation: AnyMutation) {
      succeededAt.set(mutation, ++sequence)
    },

    /** Starts refreshing on the mutation cache's settle events; returns the unsubscribe. */
    attach(client: QueryClient, mutationCache: MutationCache = client.getMutationCache()) {
      const unsubscribeQueries = client.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated') return
        const { action, query } = event
        const origin = origins.get(query) ?? { fetchStartedAt: 0, dataFrom: 0 }
        if (action.type === 'fetch') origin.fetchStartedAt = ++sequence
        else if (action.type === 'success')
          // A write keeps the origin of the read it patched.
          origin.dataFrom = action.manual ? origin.dataFrom : origin.fetchStartedAt
        else return
        origins.set(query, origin)
      })
      const unsubscribeMutations = mutationCache.subscribe((event) => {
        if (event.type !== 'updated') return
        if (event.action.type !== 'success' && event.action.type !== 'error') return
        const { mutation } = event
        const participant = participantOf(mutation)
        if (!participant) return

        const { domain, targets } = participant
        const successTime = succeededAt.get(mutation)
        if (successTime !== undefined) {
          const entry = deferred.get(domain) ?? { targets: new Set(), succeededAt: 0 }
          for (const target of targets) entry.targets.add(target)
          entry.succeededAt = Math.max(entry.succeededAt, successTime)
          deferred.set(domain, entry)
        }

        const siblingPending = mutationCache
          .findAll({ status: 'pending' })
          .some((other) => other !== mutation && participantOf(other)?.domain === domain)
        if (siblingPending) return

        const entry = deferred.get(domain)
        deferred.delete(domain)
        if (entry)
          void invalidateQueryKeys(
            client,
            [...entry.targets].map(consolePathKey),
            needsRefresh(entry.succeededAt),
          )
      })
      return () => {
        unsubscribeQueries()
        unsubscribeMutations()
      }
    },
  }
}

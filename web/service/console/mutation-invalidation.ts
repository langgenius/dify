import type {
  MutationCache,
  MutationKey,
  MutationMeta,
  Query,
  QueryClient,
  QueryKey,
} from '@tanstack/react-query'

// The part of a mutation the fallback reads, whatever its data and error types.
type AnyMutation = {
  options: { mutationKey?: MutationKey; meta?: MutationMeta }
  state: { variables?: unknown }
}

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
 * The domain a procedure path belongs to: its first segment, or the first resource under
 * namespaces that hold unrelated resources: `workspaces` (`workspaces.current.<resource>`,
 * `workspaces.byWorkspaceId.<resource>`, `workspaces.<resource>`) and `enterprise.<service>`.
 */
export function domainOf(path: readonly string[]): string {
  if (path[0] === 'enterprise') return path.slice(0, 2).join('.')
  if (path[0] !== 'workspaces') return path[0] ?? ''
  const scoped = path[1] === 'current' || /^by[A-Z]/.test(path[1] ?? '')
  return path.slice(0, scoped ? 3 : 2).join('.')
}

/** The query-key prefix that matches every query under a dotted console path. */
function consolePathKey(path: string): QueryKey {
  return [[ROOT, ...path.split('.')]]
}

type Participant = { domain: string; targets: string[] }

/**
 * The domain a pending write holds back, or `undefined` for a read: a path ending in `get`,
 * a read sent as POST (`meta.readOnly`) or a per-call read-only use such as a preview run.
 * Writes that opt out of refreshing (`invalidate: false`, such as autosaves) still count: a
 * refresh while they are pending could land a read from before them.
 */
function writeDomainOf(mutation: AnyMutation): string | undefined {
  const path = procedurePathOf(mutation)
  if (!path?.length || path.at(-1) === 'get') return undefined
  const meta = mutation.options.meta
  if (meta?.readOnly) return undefined
  if (typeof meta?.invalidate === 'function' && !meta.invalidate(mutation.state.variables))
    return undefined
  return domainOf(path)
}

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
  // Per call: a write endpoint used read-only, such as a preview run.
  if (typeof meta?.invalidate === 'function' && !meta.invalidate(mutation.state.variables))
    return undefined
  const domain = domainOf(path)
  return { domain, targets: [domain, ...(meta?.alsoInvalidate ?? [])] }
}

// What a domain refreshes once its last pending mutation settles: the domains of the writes
// that succeeded, and reads handed over because they landed while it was pending.
/**
 * Refreshes, after every successful console mutation, the queries of its domain plus the
 * domains its policy declares in `meta.alsoInvalidate`, so a write no policy covers still
 * leaves no stale data. Policies keep the refreshes a flow must wait for and the response
 * writes; this one is never awaited.
 *
 * - It starts once the mutation's own callbacks have settled. Every matching query is marked
 *   stale and observed ones refetch, restarting a read already running (it may predate the
 *   write), a first load included. Unobserved reads, such as an awaited `query()` for a
 *   download URL, are only marked stale, never cancelled. A policy that writes into the cache
 *   cancels those reads first.
 * - A query that sets `meta.invalidateAfterWrites: false` is never refreshed by it.
 * - While another mutation of the same domain is pending, it only records what to refresh;
 *   the last one to finish refreshes everything. A refetch therefore never lands on a
 *   sibling's optimistic value (TkDodo's `isMutating({ mutationKey }) === 1` guard).
 *
 * Known trade-off: a query a policy already refreshed is fetched again.
 */
export function createMutationInvalidation() {
  const succeeded = new WeakSet<AnyMutation>()
  const deferred = new Map<string, Set<string>>()

  return {
    /** For `MutationCache.onSuccess`: the request succeeded, before any callback runs. */
    onMutationSuccess(mutation: AnyMutation) {
      succeeded.add(mutation)
    },

    /** Starts refreshing on the mutation cache's settle events; returns the unsubscribe. */
    attach(client: QueryClient, mutationCache: MutationCache = client.getMutationCache()) {
      return mutationCache.subscribe((event) => {
        if (event.type !== 'updated') return
        if (event.action.type !== 'success' && event.action.type !== 'error') return
        const { mutation } = event
        const domain = writeDomainOf(mutation)
        if (!domain) return

        // A callback that throws after the request succeeded still refreshes.
        const participant = participantOf(mutation)
        if (participant && succeeded.has(mutation)) {
          const entry = deferred.get(domain) ?? new Set()
          for (const target of participant.targets) entry.add(target)
          deferred.set(domain, entry)
        }

        // The last pending write of the domain, opted out or not, flushes what the others left.
        const siblingPending = mutationCache
          .findAll({ status: 'pending' })
          .some((other) => other !== mutation && writeDomainOf(other) === domain)
        if (siblingPending) return

        const entry = deferred.get(domain)
        deferred.delete(domain)
        for (const target of entry ?? []) void refresh(client, consolePathKey(target))
      })
    },
  }
}

const isRefreshed = (query: Query) => query.meta?.invalidateAfterWrites !== false

// An observed first load: `invalidateQueries` would join it, since TanStack restarts a running
// read only when the query already has data.
const isObservedFirstLoad = (query: Query) =>
  isRefreshed(query) &&
  query.isActive() &&
  query.state.fetchStatus === 'fetching' &&
  query.state.data === undefined

async function refresh(client: QueryClient, queryKey: QueryKey) {
  if (client.isFetching({ queryKey, predicate: isObservedFirstLoad }))
    await client.cancelQueries({ queryKey, predicate: isObservedFirstLoad })
  return client.invalidateQueries({ queryKey, refetchType: 'active', predicate: isRefreshed })
}

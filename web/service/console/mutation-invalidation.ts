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
export function consolePathKey(path: string): QueryKey {
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
 * Refreshes, after every successful console mutation, the queries of its domain plus the
 * domains its policy declares in `meta.alsoInvalidate`, so a write no policy covers still
 * leaves no stale data. Policies keep the refreshes a flow must wait for and the response
 * writes; this one is never awaited.
 *
 * - It starts once the mutation's own callbacks have settled, and skips queries that were
 *   refreshed or written after the request succeeded, so a policy's primary refresh is not
 *   fetched twice.
 * - While another mutation of the same domain is pending, it only records what to refresh;
 *   the last one to finish refreshes everything. A refetch therefore never lands on a
 *   sibling's optimistic value (TkDodo's `isMutating({ mutationKey }) === 1` guard).
 */
export function createMutationInvalidation() {
  const succeededAt = new WeakMap<AnyMutation, number>()
  const deferred = new Map<string, Deferred>()

  return {
    /** For `MutationCache.onSuccess`: the request succeeded, before any callback runs. */
    onMutationSuccess(mutation: AnyMutation) {
      succeededAt.set(mutation, Date.now())
    },

    /** Starts refreshing on the mutation cache's settle events; returns the unsubscribe. */
    attach(client: QueryClient, mutationCache: MutationCache = client.getMutationCache()) {
      return mutationCache.subscribe((event) => {
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
        if (entry) void refreshAfter(client, [...entry.targets], entry.succeededAt)
      })
    },
  }
}

// Data read or written after the request succeeded already reflects it.
const isOlderThan = (time: number) => (query: Query) => query.state.dataUpdatedAt < time

function refreshAfter(client: QueryClient, targets: string[], time: number) {
  return invalidateQueryKeys(client, targets.map(consolePathKey), isOlderThan(time))
}

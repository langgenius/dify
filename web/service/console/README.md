# Console service

Use `consoleClient` and `consoleQuery` from `@/service/console`
in Server and Client Components. Calls use the appropriate HTTP
transport for the Python Console API.

- [Browser transport] preserves the existing request
  layer's authentication and error handling.
- [Server transport] requires an absolute API address;
  see [server configuration].
  [Instrumentation] and the [root layout]
  register this transport. Only the transport is shared globally;
  request identity is resolved per request.
- Shared query/mutation defaults live in [policies/], one file per
  API domain, and are registered in [query-policies.ts].
- Routes/layouts own prefetching and hydration. Use the existing
  [QueryClient factory].

## Policy ownership

Shared operation defaults belong in the domain file under `policies/`. Call sites own inputs,
execution conditions, projections, and interaction feedback.

Mutation policy callbacks (`onMutate`, `onSuccess`, `onError`, `onSettled`)
always run. `mutationOptions({ onSuccess })` runs the caller's callback together
with the policy's: `onMutate` runs the policy first (so cancellation precedes an
optimistic write), and the other callbacks start both at once and wait for both.
A returned invalidation promise keeps the mutation pending until active consumers
have refreshed, while caller feedback does not wait for that refetch.

Await the primary source; detach everything else:

- **Primary source, awaited:** the list and detail the mutated entity itself is read
  from (the roles list after a role edit, the group list after a group update, the
  list a new entity appears in, a run's own history row). Either return its
  invalidation, or write the response into that cache before the callback resolves.
  Editors and flows copy these values into local state right after a save (reopening
  a dialog, "deploy latest", resending a batch), so a late refetch would let them act
  on the old row. Creates that reveal a one-time secret (tokens, API keys) write the
  created entry into the list instead, so the secret shows without waiting.
- **Secondary, not awaited:** plan and quota, counts, catalogs and option lists, other
  resources' lists or details, summaries. Awaiting them would delay success feedback
  and keep `isPending` buttons pending on unrelated refetches. The fallback refreshes
  the mutation's own domain; declare other domains with `alsoInvalidate` (see
  [Cache updates after writes]).

When the policy and the caller both define `onMutate`, each side receives its own
result in later callbacks. `meta` merges by key; other options (`retry`, `context`)
still merge shallowly: the caller's value wins.

Pass callbacks to `mutationOptions()`. Spreading `...mutationOptions()` into
`useMutation` and then setting a callback, or calling a policy callback by hand,
replaces the policy; `dify/no-mutation-policy-bypass` reports both. Callbacks
passed to `mutate(variables, { onSuccess })` run after both and are skipped when
the component has unmounted, so keep cache work out of them.

List affected generated keys in the owning operation's policy. When several
operations of one resource refresh the same set, name that set once in a helper
next to them (for example `invalidateEndpointQueries`); helpers used by more than
one domain live in `policies/shared.ts`. Whether invalidation runs after an error
depends on the write contract: a rejected request does not imply the server
rolled back. Record that decision per module.

Invalidate through `invalidateQueryKeys` (`policies/shared.ts`) rather than
`client.invalidateQueries`. TanStack Query joins an invalidation onto a first
load that is already in flight, so a page that started loading before the write
would keep the pre-write response, and an unobserved query's read keeps running.
The helper cancels those fetches before invalidating, so the refetch starts after
the write. Observed queries with data are left to `invalidateQueries`, which
restarts them without showing earlier data.

## Cache updates after writes

Every successful console mutation refreshes the active queries of its own domain in
the background (`mutation-invalidation.ts`). The domain is the first path segment, or
the first resource under `workspaces` (`workspaces.current.<resource>`,
`workspaces.byWorkspaceId.<resource>`) and `enterprise.<service>`. The refresh is never
awaited and starts after the mutation's callbacks. It marks every query under the domain
stale and refetches the observed ones, restarting a read already running; unobserved reads
(an awaited `queryClient.query()`) are only marked stale, never cancelled. While another
mutation of the same domain is pending it waits, so the last one refreshes for all; writes
that opt out of refreshing (autosaves) count, reads sent as POST (`meta.readOnly`) do not. A read
that remounts its owner on new data and is kept current by it (a streaming chat's history)
sets `meta: { invalidateAfterWrites: false }` in its `queryOptions` policy.

A policy that writes into the cache (`setQueryData`, `setQueriesData`) first awaits
`cancelQueries` for those keys, so a read that started before the write cannot land over it.
Known trade-off: a query a policy already refreshed is fetched once more.

- **Write a policy** only for the primary source a flow must wait for (an awaited
  refresh) or for writing the response into the cache.
- **Rely on the fallback** for everything else in the domain. Declare other domains a
  write changes with `meta: { alsoInvalidate: ['agent', 'workspaces.current.features'] }`
  in its policy, and set `meta: { invalidate: false }` when it changes no cached data
  or its owner reconciles the cache itself (autosaves that write the response). A function
  (`invalidate: (variables) => boolean`) decides per call, for a write endpoint also used
  read-only, such as a pipeline run with `is_preview`. Opt-outs
  and declarations without another policy live in `policies/invalidation.ts`;
  `__tests__/mutation-coverage.spec.ts` fails for a write none of these cover.
- **Call sites invalidate directly** only for a user-driven refresh or retry, a refresh
  after a failed request, or a stream or task event. A hand-written `useMutation`
  without the oRPC `mutationKey` is not seen by the fallback; use `mutationOptions()`.
- **Optimistic updates** cancel the queries first, and settle (roll back or refresh)
  only when `queryClient.isMutating({ mutationKey }) === 1`, so the first of two quick
  writes does not overwrite the second's optimistic value.

## Freshness

The QueryClient default `staleTime` is five minutes. When a procedure needs
different freshness everywhere it is read (a credential form that must load the
current secret, a one-shot export, a validity check), set `staleTime` / `gcTime` /
`refetchOnMount` in its `queryOptions` policy instead of at each call site. Keep a
call-site override only when that screen needs something the others do not.

Use generated options and types directly. A feature-owned options factory is
appropriate only when it owns a shared request policy or a composed query;
forwarding hooks and handwritten API DTOs create a second owner.
[Instrumentation]: ../../instrumentation.ts
[QueryClient factory]: ../../app/get-query-client.ts
[Server transport]: ./server.ts
[policies/]: ./policies
[query-policies.ts]: ./query-policies.ts
[root layout]: ../../app/layout.tsx
[server configuration]: ../../config/server.ts

`code-based-extension-query.ts` owns the shared projection of plugin-defined JSON
into the legacy extension form schema. Moderation and external-data-tool workflows
consume this adapter and retain their own configuration and submission behavior.

[Browser transport]: ./browser.ts
[Cache updates after writes]: #cache-updates-after-writes

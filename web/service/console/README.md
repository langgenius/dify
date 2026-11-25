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

Return or await an invalidation only when a caller needs the refreshed data
before it continues (it reads the cache after `mutateAsync`, a toggle must keep
its pending value until the refreshed state lands, or an editor rehydrates its
draft from the response, so a late refetch would discard newer edits), and say which caller in a
comment. Fire everything else with `void`: plan and quota, counts, catalogs, and
lists or details the calling flow doesn't show. Otherwise success feedback is
delayed and buttons gated on `isPending` stay pending until unrelated refetches
finish. When both
define `onMutate`, each side receives its own result in later callbacks. Other
options (`retry`, `context`, `meta`) still merge shallowly: the caller's value
wins.

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

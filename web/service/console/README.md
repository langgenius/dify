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
- Shared query/mutation defaults live in
  [query-policies.ts].
- Routes/layouts own prefetching and hydration. Use the existing
  [QueryClient factory].

## Policy ownership

Shared operation defaults belong in `query-policies.ts`. Call sites own inputs,
execution conditions, projections, and interaction feedback.

Mutation policy callbacks (`onMutate`, `onSuccess`, `onError`, `onSettled`)
always run. `mutationOptions({ onSuccess })` chains the caller's callback after
the policy's and awaits the policy first, so the caller sees the settled cache
and the returned invalidation promise keeps the mutation pending until active
consumers have refreshed. When both define `onMutate`, each side receives its
own result in later callbacks. Other options (`retry`, `context`, `meta`) still
merge shallowly: the caller's value wins.

Pass callbacks to `mutationOptions()`. Spreading `...mutationOptions()` into
`useMutation` and then setting a callback, or calling a policy callback by hand,
replaces the policy; `dify/no-mutation-policy-bypass` reports both. Callbacks
passed to `mutate(variables, { onSuccess })` run after both and are skipped when
the component has unmounted, so keep cache work out of them.

List affected generated keys inline in the owning operation's policy. Whether
invalidation runs after an error depends on the write contract: a rejected
request does not imply the server rolled back. Record that decision per module.
Do not add an invalidation helper to hide the cache dependencies.

Use generated options and types directly. A feature-owned options factory is
appropriate only when it owns a shared request policy or a composed query;
forwarding hooks and handwritten API DTOs create a second owner.
[Instrumentation]: ../../instrumentation.ts
[QueryClient factory]: ../../app/get-query-client.ts
[Server transport]: ./server.ts
[query-policies.ts]: ./query-policies.ts
[root layout]: ../../app/layout.tsx
[server configuration]: ../../config/server.ts

`code-based-extension-query.ts` owns the shared projection of plugin-defined JSON
into the legacy extension form schema. Moderation and external-data-tool workflows
consume this adapter and retain their own configuration and submission behavior.

[Browser transport]: ./browser.ts

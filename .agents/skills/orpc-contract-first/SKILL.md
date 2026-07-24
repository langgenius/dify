---
name: orpc-contract-first
description: Guide for implementing oRPC contract-first API patterns in Dify frontend. Trigger when creating or updating contracts in web/contract, wiring router composition, integrating TanStack Query with typed contracts, migrating legacy service calls to oRPC, or deciding whether to call queryOptions directly vs extracting a helper or use-* hook in web/service.
---

# oRPC Contract-First Development

## Intent

- Keep contract as single source of truth in `web/contract/*`.
- Default query usage: call-site `useQuery(consoleQuery|marketplaceQuery.xxx.queryOptions(...))` when endpoint behavior maps 1:1 to the contract.
- Keep abstractions minimal and preserve TypeScript inference.

## Minimal Structure

```text
web/contract/
├── base.ts
├── router.ts
├── marketplace.ts
└── console/
    ├── billing.ts
    └── ...other domains
web/service/client.ts
```

## Core Workflow

1. Define contract in `web/contract/console/{domain}.ts` or `web/contract/marketplace.ts`
   - Use `base.route({...}).output(type<...>())` as baseline.
   - Add `.input(type<...>())` only when request has `params/query/body`.
   - For `GET` without input, omit `.input(...)` (do not use `.input(type<unknown>())`).
2. Register contract in `web/contract/router.ts`
   - Import directly from domain files and nest by API prefix.
3. Consume from UI call sites via oRPC query utils.

```typescript
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

const invoiceQuery = useQuery(consoleQuery.billing.invoices.queryOptions({
  staleTime: 5 * 60 * 1000,
  throwOnError: true,
  select: invoice => invoice.url,
}))
```

## Query Usage Decision Rule

1. Default: call site directly uses `*.queryOptions(...)`.
2. If 3+ call sites share the same extra options (for example `retry: false`), extract a small queryOptions helper, not a `use-*` passthrough hook.
3. Create `web/service/use-{domain}.ts` only for orchestration:
   - Combine multiple queries/mutations.
   - Share domain-level derived state or invalidation helpers.

```typescript
const invoicesBaseQueryOptions = () =>
  consoleQuery.billing.invoices.queryOptions({ retry: false })

const invoiceQuery = useQuery({
  ...invoicesBaseQueryOptions(),
  throwOnError: true,
})
```

## Mutation Usage Decision Rule

1. Default: call mutation helpers from `consoleQuery` / `marketplaceQuery`, for example `useMutation(consoleQuery.billing.bindPartnerStack.mutationOptions(...))`.
2. If mutation flow is heavily custom, use oRPC clients as `mutationFn` (for example `consoleClient.xxx` / `marketplaceClient.xxx`), instead of generic handwritten non-oRPC mutation logic.

## Key API Guide (`.key` vs `.queryKey` vs `.mutationKey`)

- `.key(...)`:
  - Use for partial matching operations (recommended for invalidation/refetch/cancel patterns).
  - Example: `queryClient.invalidateQueries({ queryKey: consoleQuery.billing.key() })`
- `.queryKey(...)`:
  - Use for a specific query's full key (exact query identity / direct cache addressing).
- `.mutationKey(...)`:
  - Use for a specific mutation's full key.
  - Typical use cases: mutation defaults registration, mutation-status filtering (`useIsMutating`, `queryClient.isMutating`), or explicit devtools grouping.

## Anti-Patterns

- Do not wrap `useQuery` with `options?: Partial<UseQueryOptions>`.
- Do not split local `queryKey/queryFn` when oRPC `queryOptions` already exists and fits the use case.
- Do not create thin `use-*` passthrough hooks for a single endpoint.
- Reason: these patterns can degrade inference (`data` may become `unknown`, especially around `throwOnError`/`select`) and add unnecessary indirection.

## Contract Rules

- **Input structure**: Always use `{ params, query?, body? }` format
- **No-input GET**: Omit `.input(...)`; do not use `.input(type<unknown>())`
- **Path params**: Use `{paramName}` in path, match in `params` object
- **Router nesting**: Group by API prefix (e.g., `/billing/*` -> `billing: {}`)
- **No barrel files**: Import directly from specific files
- **Types**: Import from `@/types/`, use `type<T>()` helper
- **Mutations**: Prefer `mutationOptions`; use explicit `mutationKey` mainly for defaults/filtering/devtools

## Type Export

```typescript
export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
```

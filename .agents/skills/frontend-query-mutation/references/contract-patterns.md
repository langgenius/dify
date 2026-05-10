# Contract Patterns

## Table of Contents

- Intent
- Minimal structure
- Core workflow
- Query usage decision rule
- Mutation usage decision rule
- Thin hook decision rule
- Anti-patterns
- Contract rules
- Type export

## Intent

- Keep contract as the single source of truth in `web/contract/*`.
- Default query usage to call-site `useQuery(consoleQuery|marketplaceQuery.xxx.queryOptions(...))` when endpoint behavior maps 1:1 to the contract.
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

1. Define contract in `web/contract/console/{domain}.ts` or `web/contract/marketplace.ts`.
   - Use `base.route({...}).output(type<...>())` as the baseline.
   - Add `.input(type<...>())` only when the request has `params`, `query`, or `body`.
   - For `GET` without input, omit `.input(...)`; do not use `.input(type<unknown>())`.
2. Register contract in `web/contract/router.ts`.
   - Import directly from domain files and nest by API prefix.
3. Consume from UI call sites via oRPC query utilities.

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

1. Default to direct `*.queryOptions(...)` usage at the call site.
2. If 3 or more call sites share the same extra options, extract a small query helper, not a `use-*` passthrough hook.
3. Create or keep feature hooks only for orchestration.
   - Combine multiple queries or mutations.
   - Share domain-level derived state or invalidation helpers.
   - Prefer `web/features/{domain}/hooks/*` for feature-owned workflows.
4. Treat `web/service/use-{domain}.ts` as legacy.
   - Do not create new thin service wrappers for oRPC contracts.
   - When touching existing wrappers, inline direct `consoleQuery` or `marketplaceQuery` consumption when the wrapper is only a passthrough.

```typescript
const invoicesBaseQueryOptions = () =>
  consoleQuery.billing.invoices.queryOptions({ retry: false })

const invoiceQuery = useQuery({
  ...invoicesBaseQueryOptions(),
  throwOnError: true,
})
```

## Mutation Usage Decision Rule

1. Default to mutation helpers from `consoleQuery` or `marketplaceQuery`, for example `useMutation(consoleQuery.billing.bindPartnerStack.mutationOptions(...))`.
2. If the mutation flow is heavily custom, use oRPC clients as `mutationFn`, for example `consoleClient.xxx` or `marketplaceClient.xxx`, instead of handwritten non-oRPC mutation logic.

```typescript
const createTagMutation = useMutation(consoleQuery.tags.create.mutationOptions())
```

## Thin Hook Decision Rule

Remove thin hooks when they only rename a single oRPC query or mutation helper.
Keep hooks when they orchestrate business behavior across multiple operations, own local workflow state, or normalize a feature-specific API.
Prefer feature vertical hooks for kept orchestration. Do not move new contract-first wrappers into `web/service/use-*`.

Use:

```typescript
const deleteTagMutation = useMutation(consoleQuery.tags.delete.mutationOptions())
```

Keep:

```typescript
const applyTagBindingsMutation = useApplyTagBindingsMutation()
```

`useApplyTagBindingsMutation` is acceptable because it coordinates bind and unbind requests, computes deltas, and exposes a feature-level workflow rather than a single endpoint passthrough.

## Anti-Patterns

- Do not wrap `useQuery` with `options?: Partial<UseQueryOptions>`.
- Do not split local `queryKey` and `queryFn` when oRPC `queryOptions` already exists and fits the use case.
- Do not create thin `use-*` passthrough hooks for a single endpoint.
- Do not create business-layer helpers whose only purpose is to call `consoleQuery.xxx.mutationOptions()` or `queryOptions()`.
- Do not introduce new `web/service/use-*` files for oRPC contract passthroughs.
- These patterns can degrade inference, especially around `throwOnError` and `select`, and add unnecessary indirection.

## Contract Rules

- Input structure: always use `{ params, query?, body? }`.
- No-input `GET`: omit `.input(...)`; do not use `.input(type<unknown>())`.
- Path params: use `{paramName}` in the path and match it in the `params` object.
- Router nesting: group by API prefix, for example `/billing/*` becomes `billing: {}`.
- No barrel files: import directly from specific files.
- Types: import from `@/types/` and use the `type<T>()` helper.
- Mutations: prefer `mutationOptions`; use explicit `mutationKey` mainly for defaults, filtering, and devtools.

## Type Export

```typescript
export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
```

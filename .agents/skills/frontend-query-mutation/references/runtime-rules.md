# Runtime Rules

## Table of Contents

- Conditional queries
- oRPC default options
- Cache invalidation
- Key API guide
- `mutate` vs `mutateAsync`
- Legacy migration

## Conditional Queries

Prefer contract-shaped `queryOptions(...)`.
When required input is missing, prefer `input: skipToken` instead of placeholder params or non-null assertions.
Use `enabled` only for extra business gating after the input itself is already valid.

```typescript
import { skipToken, useQuery } from '@tanstack/react-query'

// Disable the query by skipping input construction.
function useAccessMode(appId: string | undefined) {
  return useQuery(consoleQuery.accessControl.appAccessMode.queryOptions({
    input: appId
      ? { params: { appId } }
      : skipToken,
  }))
}

// Avoid runtime-only guards that bypass type checking.
function useBadAccessMode(appId: string | undefined) {
  return useQuery(consoleQuery.accessControl.appAccessMode.queryOptions({
    input: { params: { appId: appId! } },
    enabled: !!appId,
  }))
}
```

## oRPC Default Options

Use `experimental_defaults` in `createTanstackQueryUtils` when a contract operation should always carry shared TanStack Query behavior, such as default stale time, mutation cache writes, or invalidation.

Place defaults at the query utility creation point in `web/service/client.ts`:

```typescript
export const consoleQuery = createTanstackQueryUtils(consoleClient, {
  path: ['console'],
  experimental_defaults: {
    tags: {
      create: {
        mutationOptions: {
          onSuccess: (tag, _variables, _result, context) => {
            context.client.setQueryData(
              consoleQuery.tags.list.queryKey({
                input: {
                  query: {
                    type: tag.type,
                  },
                },
              }),
              (oldTags: Tag[] | undefined) => oldTags ? [tag, ...oldTags] : oldTags,
            )
          },
        },
      },
    },
  },
})
```

Rules:

- Keep defaults inline in the `consoleQuery` or `marketplaceQuery` initialization when they need sibling oRPC key builders.
- Do not create a wrapper function solely to host `createTanstackQueryUtils`.
- Do not split defaults into a vertical feature file if that forces handwritten operation paths such as `generateOperationKey(['console', ...])`.
- Keep feature-level orchestration in the feature vertical; keep query utility lifecycle defaults with the query utility.
- Prefer call-site callbacks for UI feedback only; shared cache behavior belongs in oRPC defaults when it is tied to a contract operation.

## Cache Invalidation

Bind shared invalidation in oRPC defaults when it is tied to a contract operation.
Use feature vertical hooks only for multi-operation workflows or domain orchestration that cannot live in a single operation default.
Components may add UI feedback in call-site callbacks, but they should not decide which queries to invalidate.

Use:

- `.key()` for namespace or prefix invalidation
- `.queryKey(...)` only for exact cache reads or writes such as `getQueryData` and `setQueryData`
- `queryClient.invalidateQueries(...)` in mutation `onSuccess`

Do not use deprecated `useInvalid` from `use-base.ts`.

```typescript
// Feature orchestration owns cache invalidation only when defaults are not enough.
export const useUpdateAccessMode = () => {
  const queryClient = useQueryClient()

  return useMutation(consoleQuery.accessControl.updateAccessMode.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.accessControl.appWhitelistSubjects.key(),
      })
    },
  }))
}

// Component only adds UI behavior.
updateAccessMode({ appId, mode }, {
  onSuccess: () => toast.success('...'),
})

// Avoid putting invalidation knowledge in the component.
mutate({ appId, mode }, {
  onSuccess: () => {
    queryClient.invalidateQueries({
      queryKey: consoleQuery.accessControl.appWhitelistSubjects.key(),
    })
  },
})
```

## Key API Guide

- `.key(...)`
  - Use for partial matching operations.
  - Prefer it for invalidation, refetch, and cancel patterns.
  - Example: `queryClient.invalidateQueries({ queryKey: consoleQuery.billing.key() })`
- `.queryKey(...)`
  - Use for a specific query's full key.
  - Prefer it for exact cache addressing and direct reads or writes.
- `.mutationKey(...)`
  - Use for a specific mutation's full key.
  - Prefer it for mutation defaults registration, mutation-status filtering, and devtools grouping.

## `mutate` vs `mutateAsync`

Prefer `mutate` by default.
Use `mutateAsync` only when Promise semantics are truly required, such as parallel mutations or sequential steps with result dependencies.

Rules:

- Event handlers should usually call `mutate(...)` with `onSuccess` or `onError`.
- Every `await mutateAsync(...)` must be wrapped in `try/catch`.
- Do not use `mutateAsync` when callbacks already express the flow clearly.

```typescript
// Default case.
mutation.mutate(data, {
  onSuccess: result => router.push(result.url),
})

// Promise semantics are required.
try {
  const order = await createOrder.mutateAsync(orderData)
  await confirmPayment.mutateAsync({ orderId: order.id, token })
  router.push(`/orders/${order.id}`)
}
catch (error) {
  toast.error(error instanceof Error ? error.message : 'Unknown error')
}
```

## Legacy Migration

When touching old code, migrate it toward these rules:

| Old pattern | New pattern |
|---|---|
| `useInvalid(key)` in service wrappers | oRPC defaults, or a feature vertical hook for real orchestration |
| component-triggered invalidation after mutation | move invalidation into oRPC defaults or a feature vertical hook |
| imperative fetch plus manual invalidation | wrap it in `useMutation(...mutationOptions(...))` |
| `await mutateAsync()` without `try/catch` | switch to `mutate(...)` or add `try/catch` |

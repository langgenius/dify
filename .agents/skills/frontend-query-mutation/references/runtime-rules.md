# Runtime Rules

## Table of Contents

- Conditional queries
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

## Cache Invalidation

Bind invalidation in the service-layer mutation definition.
Components may add UI feedback in call-site callbacks, but they should not decide which queries to invalidate.

Use:

- `.key()` for namespace or prefix invalidation
- `.queryKey(...)` only for exact cache reads or writes such as `getQueryData` and `setQueryData`
- `queryClient.invalidateQueries(...)` in mutation `onSuccess`

Do not use deprecated `useInvalid` from `use-base.ts`.

```typescript
// Service layer owns cache invalidation.
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
  onSuccess: () => Toast.notify({ type: 'success', message: '...' }),
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
  Toast.notify({
    type: 'error',
    message: error instanceof Error ? error.message : 'Unknown error',
  })
}
```

## Legacy Migration

When touching old code, migrate it toward these rules:

| Old pattern | New pattern |
|---|---|
| `useInvalid(key)` in service layer | `queryClient.invalidateQueries(...)` inside mutation `onSuccess` |
| component-triggered invalidation after mutation | move invalidation into the service-layer mutation definition |
| imperative fetch plus manual invalidation | wrap it in `useMutation(...mutationOptions(...))` |
| `await mutateAsync()` without `try/catch` | switch to `mutate(...)` or add `try/catch` |

# Query & Mutation Best Practices

Complements the `orpc-contract-first` skill (contract definition, queryOptions call-site pattern, decision rules).
This document focuses on **cache invalidation** and **mutation error handling**.

## Cache Invalidation

Bind invalidation in the service-layer mutation definition. Components only add UI feedback via call-site `onSuccess` (callbacks are additive, not overriding — definition fires first, then call-site).

```typescript
// ✅ service layer — web/service/access-control.ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

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

// ✅ component — only UI feedback, no invalidation knowledge
function AccessModeForm() {
  const [mode, setMode] = useState('public')
  const { mutate: updateAccessMode } = useUpdateAccessMode()

  const handleSubmit = useCallback(() => {
    updateAccessMode({ mode }, {
      onSuccess: () => Toast.notify({ type: 'success', message: '...' }),
    })
  }, [mode, updateAccessMode])
}

// ❌ component should NOT own invalidation logic for mutations
function BadComponent() {
  const [mode, setMode] = useState('public')
  const queryClient = useQueryClient()
  const { mutate } = useMutation(consoleQuery.accessControl.updateAccessMode.mutationOptions())

  const handleSubmit = useCallback(() => {
    mutate({ mode }, {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: consoleQuery.accessControl.appWhitelistSubjects.key(),
        })
      },
    })
  }, [mode, mutate, queryClient])
}
```

### Rules

- Use `.key()` for prefix-based invalidation (all queries under a namespace).
- Use `.queryKey(...)` only for exact cache addressing (`setQueryData` / `getQueryData`).
- Do not import `useInvalid` from `use-base.ts` — it is deprecated.
- Mutation-triggered invalidation belongs in the service layer. Components should not decide which queries to invalidate after a mutation.

## mutate vs mutateAsync

Prefer `mutate` unless you need the Promise.

`mutate` internally calls `mutateAsync().catch(noop)`, so errors are silently handled and you get results
via callbacks. `mutateAsync` returns a raw Promise — if you `await` it without `try-catch`, a failed mutation
produces an unhandled rejection.

```typescript
import { useMutation } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

function Example() {
  const mutation = useMutation(consoleQuery.billing.subscribe.mutationOptions())

  // ✅ mutate — errors handled internally, results via callbacks
  mutation.mutate(data, {
    onSuccess: result => router.push(result.url),
  })

  // ❌ mutateAsync without try-catch — unhandled rejection
  const result = await mutation.mutateAsync(data)
  router.push(result.url)
}
```

Use `mutateAsync` when you need the Promise — concurrent mutations or sequential steps with result dependencies:

```typescript
function ConcurrentExample() {
  // ✅ concurrent mutations
  try {
    await Promise.all([
      mutation1.mutateAsync(data1),
      mutation2.mutateAsync(data2),
    ])
  }
  catch (error) {
    Toast.notify({ type: 'error', message: error.message })
  }
}

function SequentialExample() {
  // ✅ sequential chain where each step depends on the previous result
  try {
    const order = await createOrder.mutateAsync(orderData)
    await confirmPayment.mutateAsync({ orderId: order.id, token })
    router.push(`/orders/${order.id}`)
  }
  catch (error) {
    Toast.notify({ type: 'error', message: error.message })
  }
}
```

## Legacy Migration

When touching files that use the old patterns below, migrate them:

| Old pattern | New pattern |
|---|---|
| `useInvalid(key)` in service layer | `queryClient.invalidateQueries` inside `useMutation.onSuccess` |
| `useInvalidateXxx()` called from components after mutations | Move invalidation into the service-layer mutation definition |
| `await deleteXxx(id)` (imperative fetch) + manual invalidation | Wrap in `useMutation` with `onSuccess` invalidation |
| `await mutateAsync()` without try-catch | Switch to `mutate` + callbacks, or add try-catch |

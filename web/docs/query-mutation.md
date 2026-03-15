# Query & Mutation Best Practices

Complements the `orpc-contract-first` skill (contract definition, queryOptions call-site pattern, decision rules).
This document focuses on **cache invalidation**, **conditional queries**, and **mutation error handling**.

## Cache Invalidation

Bind invalidation in the service-layer mutation definition. Components only handle UI feedback.

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

// ✅ component — only UI feedback
function AccessModeForm({ data }) {
  const { mutate: updateAccessMode } = useUpdateAccessMode()

  const handleSubmit = useCallback(() => {
    updateAccessMode(data, {
      onSuccess: () => Toast.notify({ type: 'success', message: '...' }),
    })
  }, [data, updateAccessMode])
}

// ❌ component should NOT know about query keys
function BadComponent() {
  const queryClient = useQueryClient()
  const { mutate } = useMutation(consoleQuery.accessControl.updateAccessMode.mutationOptions())

  const handleSubmit = useCallback(() => {
    mutate(data, {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: consoleQuery.accessControl.appWhitelistSubjects.key(),
        })
      },
    })
  }, [data, mutate, queryClient])
}
```

### Rules

- Use `.key()` for prefix-based invalidation (all queries under a namespace).
- Use `.queryKey(...)` only for exact cache addressing (`setQueryData` / `getQueryData`).
- Do not import `useInvalid` from `use-base.ts` — it is deprecated.
- Do not call `queryClient.invalidateQueries` in components; keep query key knowledge in the service layer.

## Conditional Queries (skipToken)

Use oRPC's `skipToken` via `input` instead of `enabled: !!x` + non-null assertion `x!`.

```typescript
import { skipToken, useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

// ✅ oRPC: pass skipToken as input — oRPC translates to enabled: false internally
export function fileDownloadUrlOptions(appId: string | undefined, path: string | undefined) {
  return consoleQuery.sandboxFile.downloadFile.queryOptions({
    input: appId && path
      ? { params: { appId }, body: { path } }
      : skipToken,
  })
}

// ✅ component call-site: spread queryOptions + add UI-specific options
function FileViewer({ appId, path }: { appId?: string, path?: string }) {
  const { data } = useQuery({
    ...fileDownloadUrlOptions(appId, path),
    staleTime: 5 * 60 * 1000,
  })
}

// ❌ enabled + non-null assertion — runtime-only guard, bypasses type checking
function BadFileViewer({ appId }: { appId?: string }) {
  const { data } = useQuery(consoleQuery.sandboxFile.downloadFile.queryOptions({
    input: { params: { appId: appId! } },
    enabled: !!appId,
  }))
}
```

## mutate vs mutateAsync

Prefer `mutate` unless you need the Promise (e.g. `Promise.all`, sequential chaining).

```typescript
import { useMutation } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

function Example() {
  const mutation = useMutation(consoleQuery.billing.subscribe.mutationOptions())

  // ✅ mutate — errors handled internally, no try-catch needed
  mutation.mutate(data, {
    onSuccess: result => router.push(result.url),
  })

  // ❌ mutateAsync without try-catch — unhandled rejection
  const result = await mutation.mutateAsync(data)
  router.push(result.url)

  // ✅ mutateAsync — justified for concurrent mutations, wrapped in try-catch
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
```

## Legacy Migration

When touching files that use the old patterns below, migrate them:

| Old pattern | New pattern |
|---|---|
| `useInvalid(key)` in service layer | `queryClient.invalidateQueries` inside `useMutation.onSuccess` |
| `useInvalidateXxx()` called from components | Move invalidation into the mutation that causes the change |
| `await deleteXxx(id)` (imperative fetch) + manual invalidation | Wrap in `useMutation` with `onSuccess` invalidation |
| `enabled: !!x` + `x!` in queryFn | `skipToken` via oRPC input or queryFn |
| `await mutateAsync()` without try-catch | Switch to `mutate` + callbacks, or add try-catch |

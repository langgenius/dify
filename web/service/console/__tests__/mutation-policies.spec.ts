import type { MutationFunctionContext } from '@tanstack/react-query'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createDeferred } from '@/test/deferred'
import { composeMutationOptions, withMutationPolicies } from '../mutation-policies'

const clients: QueryClient[] = []
const createQueryClient = () => {
  const client = new QueryClient()
  clients.push(client)
  return client
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

const loadConsoleQuery = async () => {
  vi.resetModules()
  vi.doMock('@/utils/client', () => ({ isClient: true, isServer: false }))
  const module = await import('@/service/console')
  return module.consoleQuery
}

const mutationContext = (client: QueryClient): MutationFunctionContext => ({
  client,
  meta: undefined,
})

const profile = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  avatar_url: null,
  is_password_set: true,
  timezone: 'Pacific/Midway',
}

describe('composeMutationOptions', () => {
  it('starts the caller callback without waiting for the policy, and waits for both', async () => {
    const calls: string[] = []
    const policyDone = createDeferred<void>()
    const composed = composeMutationOptions(
      {
        onSuccess: async () => {
          calls.push('policy:start')
          await policyDone.promise
          calls.push('policy:end')
        },
      },
      {
        onSuccess: () => {
          calls.push('caller')
        },
      },
    )

    let settled = false
    const running = Promise.resolve(composed.onSuccess()).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(calls).toEqual(['policy:start', 'caller'])
    expect(settled).toBe(false)

    policyDone.resolve()
    await running
    expect(calls).toEqual(['policy:start', 'caller', 'policy:end'])
  })

  it('keeps a mutation pending until the policy finishes even when the caller callback rejects', async () => {
    const policyDone = createDeferred<void>()
    let policyFinished = false
    const client = createQueryClient()
    const observer = new MutationObserver(
      client,
      composeMutationOptions(
        {
          onSuccess: async () => {
            await policyDone.promise
            policyFinished = true
          },
        },
        {
          mutationFn: async () => 'saved',
          onSuccess: () => Promise.reject(new Error('caller failed')),
        },
      ),
    )

    const running = observer.mutate(undefined).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(observer.getCurrentResult().status).toBe('pending')

    policyDone.resolve()
    await running
    expect(policyFinished).toBe(true)
    expect(observer.getCurrentResult().error).toEqual(new Error('caller failed'))
  })

  it('runs and waits for both callbacks when either one throws synchronously', async () => {
    const policyDone = createDeferred<void>()
    const calls: string[] = []
    const callerThrows = composeMutationOptions(
      {
        onSuccess: async () => {
          await policyDone.promise
          calls.push('policy:end')
        },
      },
      {
        onSuccess: () => {
          throw new Error('caller failed')
        },
      },
    )
    const policyThrows = composeMutationOptions(
      {
        onSuccess: () => {
          throw new Error('policy failed')
        },
      },
      { onSuccess: () => calls.push('caller') },
    )

    let settled = false
    const running = Promise.resolve(callerThrows.onSuccess())
      .catch((error: Error) => error.message)
      .finally(() => {
        settled = true
      })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    policyDone.resolve()
    await expect(running).resolves.toBe('caller failed')
    expect(calls).toEqual(['policy:end'])

    await expect(Promise.resolve(policyThrows.onSuccess())).rejects.toThrow('policy failed')
    expect(calls).toEqual(['policy:end', 'caller'])
  })

  it('keeps each side on its own onMutate result when both define onMutate', async () => {
    const policyError = vi.fn()
    const callerError = vi.fn()
    const composed = composeMutationOptions(
      { onMutate: () => 'policy-snapshot', onError: policyError },
      {
        onMutate: (_variables: string) => 'caller-snapshot',
        onError: (...args: unknown[]) => callerError(...args),
      },
    )

    const result = await composed.onMutate('variables')
    await composed.onError('error', 'variables', result, 'context')

    expect(policyError).toHaveBeenCalledWith('error', 'variables', 'policy-snapshot', 'context')
    expect(callerError).toHaveBeenCalledWith('error', 'variables', 'caller-snapshot', 'context')
  })

  it('lets non-callback caller options override the policy as before', () => {
    const policyRetry = composeMutationOptions({ retry: 1 }, { retry: 3 })
    expect(policyRetry).toEqual({ retry: 3 })
  })

  it("merges meta by key so a caller's error message keeps the policy's invalidation flags", () => {
    const composed = composeMutationOptions(
      { meta: { invalidate: false, errorMessage: 'policy' } },
      { meta: { errorMessage: 'caller' } },
    )
    expect(composed).toEqual({ meta: { invalidate: false, errorMessage: 'caller' } })
  })

  it('returns the caller options untouched when there is no policy', () => {
    const options = { onSuccess: vi.fn() }
    expect(composeMutationOptions(undefined, options)).toBe(options)
  })
})

describe('withMutationPolicies', () => {
  it('composes only procedures that have a policy', () => {
    const mutationOptions = vi.fn((options: object) => options)
    const utils = withMutationPolicies(
      { a: { mutationOptions }, b: { mutationOptions } },
      { a: { mutationOptions: { onSuccess: () => 'policy' } } },
    )
    const callerOnSuccess = vi.fn()

    utils.b.mutationOptions({ onSuccess: callerOnSuccess })
    expect(mutationOptions).toHaveBeenLastCalledWith({ onSuccess: callerOnSuccess })

    utils.a.mutationOptions({ onSuccess: callerOnSuccess })
    expect(mutationOptions.mock.lastCall?.[0]).not.toEqual({ onSuccess: callerOnSuccess })
  })
})

describe('consoleQuery mutation policies', () => {
  it('keeps the policy invalidation when a call site passes its own onSuccess', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = createQueryClient()
    const profileKey = consoleQuery.account.profile.get.queryKey()
    queryClient.setQueryData(profileKey, profile)
    const calls: string[] = []
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation(async () => {
        calls.push('policy')
      })

    const observer = new MutationObserver(
      queryClient,
      consoleQuery.account.profile.patch.mutationOptions({
        mutationFn: async () => profile,
        onSuccess: () => {
          calls.push('caller')
        },
      }),
    )
    await observer.mutate({ body: { timezone: 'Pacific/Midway' } })

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.account.profile.get.key(),
    })
    expect(calls).toEqual(['policy', 'caller'])
  })

  it('keeps the policy onSettled invalidation when a call site passes its own onSettled', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const callerOnSettled = vi.fn()

    const options = consoleQuery.workflowRunArchives.byYear.byMonth.delete.mutationOptions({
      onSettled: callerOnSettled,
    })
    await options.onSettled!(
      undefined,
      new Error('failed'),
      { params: { year: 2026, month: 1 } } as Parameters<NonNullable<typeof options.onSettled>>[2],
      undefined,
      mutationContext(queryClient),
    )

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.workflowRunArchives.get.queryKey(),
    })
    expect(callerOnSettled).toHaveBeenCalledTimes(1)
  })

  it('runs the policy once when a call site passes no callbacks', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const observer = new MutationObserver(
      queryClient,
      consoleQuery.account.profile.patch.mutationOptions({ mutationFn: async () => profile }),
    )
    await observer.mutate({ body: { timezone: 'Pacific/Midway' } })

    expect(invalidateQueries).toHaveBeenCalledTimes(1)
  })
})

import { MutationObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { makeQueryClient } from '../get-query-client'

const { notifyError, request } = vi.hoisted(() => ({ notifyError: vi.fn(), request: vi.fn() }))
vi.mock('@/app/notifications/notify-error', () => ({ notifyError }))
vi.mock('@/service/base', () => ({ request }))

const failure = new Error('Save failed')
afterEach(() => vi.clearAllMocks())

describe('mutation error ownership', () => {
  it('reports once by default even when the caller catches mutateAsync rejection', async () => {
    const mutation = new MutationObserver(makeQueryClient(), {
      mutationFn: async () => {
        throw failure
      },
    })
    const caught = vi.fn()
    await mutation.mutate(undefined).catch(caught)
    expect(caught).toHaveBeenCalledWith(failure)
    expect(notifyError).toHaveBeenCalledTimes(1)
    expect(notifyError.mock.calls[0]?.[0]).toBe(failure)
  })

  it('lets hook options replace the default feedback', async () => {
    const onError = vi.fn()
    const mutation = new MutationObserver(makeQueryClient(), {
      mutationFn: async () => {
        throw failure
      },
      onError,
    })
    await expect(mutation.mutate(undefined)).rejects.toBe(failure)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('appends invocation callbacks and retains default feedback after unmount', async () => {
    const mutation = new MutationObserver(makeQueryClient(), {
      mutationFn: async () => {
        throw failure
      },
    })
    const onError = vi.fn()
    const unsubscribe = mutation.subscribe(() => {})
    await expect(mutation.mutate(undefined, { onError })).rejects.toBe(failure)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(notifyError).toHaveBeenCalledTimes(1)
    unsubscribe()
    await expect(mutation.mutate(undefined, { onError })).rejects.toBe(failure)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(notifyError).toHaveBeenCalledTimes(2)
  })

  it('preserves generated shared invalidation with a local error owner', async () => {
    request.mockRejectedValue(failure)
    const client = makeQueryClient()
    const endpoints = consoleQuery.workspaces.current.endpoints
    const key = endpoints.list.get.queryKey({ input: { query: { page: 1, page_size: 100 } } })
    client.setQueryData(key, { endpoints: [] })
    const onError = vi.fn()
    const mutation = new MutationObserver(client, endpoints.post.mutationOptions({ onError }))
    const unsubscribe = mutation.subscribe(() => {})
    const pending = mutation.mutate({
      body: { name: 'Endpoint', plugin_unique_identifier: 'plugin@1', settings: {} },
    })
    unsubscribe()
    await expect(pending).rejects.toBe(failure)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(notifyError).not.toHaveBeenCalled()
    expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  })
})

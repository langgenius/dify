import type { QueryKey } from '@tanstack/react-query'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from './index'

const { request } = vi.hoisted(() => ({
  request: vi.fn<() => Promise<Response>>(),
}))
vi.mock('../base', () => ({ request }))

const annotations = consoleQuery.apps.byAppId.annotations

function appKeys(appId: string): QueryKey[] {
  return [
    annotations.get.queryKey({
      input: { params: { app_id: appId }, query: { page: 1, limit: 10, keyword: '' } },
    }),
    annotations.get.queryKey({
      input: { params: { app_id: appId }, query: { page: 2, limit: 25, keyword: 'question' } },
    }),
    annotations.count.get.queryKey({ input: { params: { app_id: appId } } }),
    annotations.export.get.queryKey({ input: { params: { app_id: appId } } }),
  ]
}

afterEach(() => vi.restoreAllMocks())

describe('annotation batch deletion cache policy', () => {
  it.each([
    { name: 'selected annotations', query: { annotation_id: ['annotation-1'] } },
    { name: 'all annotations', query: undefined },
  ])('refreshes only the affected app and quota after deleting $name', async ({ query }) => {
    const client = new QueryClient()
    const affected = [...appKeys('app-a'), consoleQuery.features.get.queryKey()]
    const unrelated = appKeys('app-b')
    for (const key of [...affected, ...unrelated]) client.setQueryData(key, { cached: true })
    request.mockResolvedValue(new Response(null, { status: 204 }))
    const onSuccess = vi.fn()
    try {
      await new MutationObserver(client, annotations.delete.mutationOptions({ onSuccess })).mutate({
        params: { app_id: 'app-a' },
        query,
      })
      expect(onSuccess).toHaveBeenCalledOnce()
      for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
      for (const key of unrelated) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    } finally {
      client.clear()
    }
  })

  it('reconciles caches when a failed response may follow a committed deletion', async () => {
    const client = new QueryClient()
    const affected = [...appKeys('app-a'), consoleQuery.features.get.queryKey()]
    const unrelated = appKeys('app-b')
    for (const key of [...affected, ...unrelated]) client.setQueryData(key, { cached: true })
    const error = new Error('Index task publishing failed after commit')
    request.mockRejectedValue(error)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onSuccess = vi.fn()
    try {
      await expect(
        new MutationObserver(client, annotations.delete.mutationOptions({ onSuccess })).mutate({
          params: { app_id: 'app-a' },
          query: { annotation_id: ['annotation-1'] },
        }),
      ).rejects.toThrow(error.message)
      expect(onSuccess).not.toHaveBeenCalled()
      for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
      for (const key of unrelated) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    } finally {
      client.clear()
    }
  })
})

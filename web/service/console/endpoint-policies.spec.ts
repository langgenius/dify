import type { QueryKey } from '@tanstack/react-query'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from './index'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))

vi.mock('../base', () => ({ request }))

const endpoints = consoleQuery.workspaces.current.endpoints
const plugins = consoleQuery.workspaces.current.plugin

const mutations = [
  {
    name: 'create',
    method: 'POST',
    path: '/endpoints',
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(client, endpoints.post.mutationOptions({ onSuccess })).mutate({
        body: { name: 'Endpoint', plugin_unique_identifier: 'plugin@1.0', settings: {} },
      }),
  },
  {
    name: 'update',
    method: 'PATCH',
    path: '/endpoints/endpoint-1',
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(client, endpoints.byId.patch.mutationOptions({ onSuccess })).mutate({
        params: { id: 'endpoint-1' },
        body: { name: 'Renamed', settings: { enabled: false, limit: 0, token: '' } },
      }),
  },
  {
    name: 'delete',
    method: 'DELETE',
    path: '/endpoints/endpoint-1',
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(client, endpoints.byId.delete.mutationOptions({ onSuccess })).mutate({
        params: { id: 'endpoint-1' },
      }),
  },
  {
    name: 'enable',
    method: 'POST',
    path: '/endpoints/enable',
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(client, endpoints.enable.post.mutationOptions({ onSuccess })).mutate({
        body: { endpoint_id: 'endpoint-1' },
      }),
  },
  {
    name: 'disable',
    method: 'POST',
    path: '/endpoints/disable',
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(client, endpoints.disable.post.mutationOptions({ onSuccess })).mutate({
        body: { endpoint_id: 'endpoint-1' },
      }),
  },
]

function seedEndpointCaches(client: QueryClient) {
  const affectedKeys: QueryKey[] = [
    endpoints.list.get.queryKey({ input: { query: { page: 1, page_size: 100 } } }),
    endpoints.list.plugin.get.queryKey({
      input: { query: { page: 1, page_size: 100, plugin_id: 'plugin-1' } },
    }),
    endpoints.list.plugin.get.queryKey({
      input: { query: { page: 2, page_size: 20, plugin_id: 'plugin-2' } },
    }),
    plugins.list.get.key({ type: 'query' }),
    plugins.byCategory.list.get.key({
      type: 'infinite',
      input: { params: { category: 'extension' } },
    }),
  ]
  const unrelatedKeys: QueryKey[] = [
    plugins.installedIds.get.key({ type: 'query' }),
    consoleQuery.account.profile.get.key({ type: 'query' }),
  ]

  for (const queryKey of [...affectedKeys, ...unrelatedKeys])
    client.setQueryData(queryKey, { cached: true })

  return { affectedKeys, unrelatedKeys }
}

describe('endpoint mutation cache policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(mutations)(
    '$name refreshes endpoint lists and plugin counts with local feedback',
    async ({ run, method, path }) => {
      const client = new QueryClient()
      const { affectedKeys, unrelatedKeys } = seedEndpointCaches(client)
      const onSuccess = vi.fn()
      request.mockResolvedValue(Response.json({ success: true }))

      await run(client, onSuccess)

      expect(onSuccess).toHaveBeenCalledOnce()
      expect(request).toHaveBeenCalledWith(
        expect.stringContaining(`/workspaces/current${path}`),
        expect.any(Object),
        expect.objectContaining({ request: expect.objectContaining({ method }) }),
      )
      if (method === 'PATCH') {
        const sentRequest = request.mock.calls[0]?.[2].request
        expect(await sentRequest?.json()).toEqual({
          name: 'Renamed',
          settings: { enabled: false, limit: 0, token: '' },
        })
      }
      for (const key of affectedKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
      for (const key of unrelatedKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
      client.clear()
    },
  )

  it.each(mutations)(
    '$name invalidates uncertain server state and skips success feedback on failure',
    async ({ run }) => {
      const client = new QueryClient()
      const { affectedKeys } = seedEndpointCaches(client)
      const onSuccess = vi.fn()
      request.mockResolvedValue(
        Response.json({ message: 'Endpoint operation failed' }, { status: 500 }),
      )

      try {
        await expect(run(client, onSuccess)).rejects.toThrow()
        expect(onSuccess).not.toHaveBeenCalled()
        for (const key of affectedKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
      } finally {
        client.clear()
      }
    },
  )

  it('reconciles after a lost response without retrying the create', async () => {
    const client = new QueryClient()
    const { affectedKeys, unrelatedKeys } = seedEndpointCaches(client)
    const onSuccess = vi.fn()
    request.mockRejectedValue(new TypeError('Failed to fetch'))
    const mutation = new MutationObserver(client, endpoints.post.mutationOptions({ onSuccess }))

    try {
      await expect(
        mutation.mutate({
          body: { name: 'Endpoint', plugin_unique_identifier: 'plugin@1.0', settings: {} },
        }),
      ).rejects.toThrow('Failed to fetch')
      expect(request).toHaveBeenCalledOnce()
      expect(onSuccess).not.toHaveBeenCalled()
      for (const key of affectedKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
      for (const key of unrelatedKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    } finally {
      client.clear()
    }
  })
})

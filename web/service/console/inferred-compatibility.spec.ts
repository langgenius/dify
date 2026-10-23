import type { GeneralUtils, ProcedureUtils } from '@orpc/tanstack-query'
import type { QueryKey } from '@tanstack/react-query'
import { consoleRouterContract } from '@dify/contracts/console'
import { safe } from '@orpc/client'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createHttpError } from '../http-error'
import * as policies from './console.openapi.queries'
import { consoleClient as originalClient, consoleQuery as originalQuery } from './index'
import { consoleClient, consoleQuery } from './inferred'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../base', () => ({ request }))
vi.mock('../client-error', () => ({ reportClientError: vi.fn() }))
beforeEach(() => {
  request.mockReset()
})

describe('inferred console compatibility', () => {
  it('preserves every Console query key and operation policy, including enterprise methods', () => {
    type Helpers = ProcedureUtils<object, unknown, unknown, unknown> & GeneralUtils<unknown>
    function at(root: unknown, path: string[]): Helpers {
      let node = root
      for (const member of path) node = (node as Record<string, unknown>)[member]
      return node as Helpers
    }
    const coveredPolicies = new Set<string>()
    let operations = 0
    function walk(node: unknown, path: string[] = []) {
      const definition = (node as { '~orpc'?: { route: { method: string; path: string } } })[
        '~orpc'
      ]
      if (!definition) {
        for (const [key, value] of Object.entries(node as object)) walk(value, [...path, key])
        expect(at(consoleQuery, path).key()).toEqual(at(originalQuery, path).key())
        return
      }
      const previous = at(originalQuery, path)
      const current = at(consoleQuery, path)
      expect(current.queryKey(), path.join('.')).toEqual(previous.queryKey())
      const input = { query: { cursor: 'next', limit: 10 } }
      expect(current.queryKey({ input }), path.join('.')).toEqual(previous.queryKey({ input }))
      const policy = `${definition.route.method} ${definition.route.path}`
      if (Object.hasOwn(policies, policy)) coveredPolicies.add(policy)
      for (const [kind, oldOptions, newOptions] of [
        ['queryOptions', previous.queryOptions(), current.queryOptions()],
        ['mutationOptions', previous.mutationOptions(), current.mutationOptions()],
      ] as const) {
        // The request closures differ; cache policies and callback references must not.
        const omitRequest = (options: object) =>
          Object.fromEntries(
            Object.entries(options).filter(([key]) => !['queryFn', 'mutationFn'].includes(key)),
          )
        expect(omitRequest(newOptions), `${policy}: ${kind}`).toEqual(omitRequest(oldOptions))
      }
      operations++
    }
    walk(consoleRouterContract)
    expect(operations).toBeGreaterThan(1000)
    expect([...coveredPolicies].sort()).toEqual(Object.keys(policies).sort())
  })
  it('preserves validated draft-conflict errors used by workflow recovery', async () => {
    request.mockImplementation(() => {
      throw createHttpError(
        { status: 409, statusText: 'Conflict', headers: new Headers() },
        {
          code: 'draft_workflow_not_sync',
          message: 'Draft changed',
          status: 409,
          extra: 'not documented',
        },
      )
    })
    const input = {
      params: { app_id: 'app' },
      body: {
        graph: { nodes: [], edges: [] },
        features: {},
        environment_variables: [],
        conversation_variables: [],
      },
    }
    const [previous, , previousDefined] = await safe(
      originalClient.apps.byAppId.workflows.draft.post(input),
    )
    const [current, , currentDefined] = await safe(
      consoleClient.apps.byAppId.workflows.draft.post(input),
    )
    expect(previousDefined).toBe(true)
    expect(currentDefined).toBe(true)
    if (!previousDefined || !currentDefined) throw new Error('Expected validated errors')
    expect(current.code).toBe(previous.code)
    expect(current.status).toBe(409)
    expect(current.data).toEqual(previous.data)
    expect(current.data).not.toHaveProperty('extra')
  })
  it('uses existing endpoint invalidation and the same cache keys', async () => {
    request.mockResolvedValue(Response.json({ id: 'endpoint', name: 'Endpoint' }))
    const cache = new QueryClient()
    const input = { query: { page: 1, page_size: 20 } }
    const key: QueryKey = originalQuery.workspaces.current.endpoints.list.get.queryKey({ input })
    const unrelated: QueryKey = originalQuery.account.profile.get.queryKey()
    cache.setQueryData(key, { cached: true })
    cache.setQueryData(unrelated, { cached: true })
    expect(consoleQuery.workspaces.current.endpoints.list.get.queryKey({ input })).toEqual(key)
    const success = vi.fn()
    const mutation = new MutationObserver(
      cache,
      consoleQuery.workspaces.current.endpoints.post.mutationOptions({ onSuccess: success }),
    )
    await mutation.mutate({
      body: { name: 'Endpoint', plugin_unique_identifier: 'plugin@1.0', settings: {} },
    })
    expect(success).toHaveBeenCalledOnce()
    expect(cache.getQueryState(key)?.isInvalidated).toBe(true)
    expect(cache.getQueryState(unrelated)?.isInvalidated).toBe(false)
    cache.clear()
  })
  it('preserves query defaults and caller overrides', () => {
    expect(
      consoleQuery.knowledgeFs.features.get.queryOptions({ staleTime: Infinity }).queryKey,
    ).toEqual(originalQuery.knowledgeFs.features.get.queryOptions({ staleTime: Infinity }).queryKey)
    expect(
      originalQuery.auth.plugin.datasource.list.get.queryOptions({ input: {} }),
    ).toHaveProperty('retry', false)
    expect(consoleQuery.auth.plugin.datasource.list.get.queryOptions({ input: {} })).toHaveProperty(
      'retry',
      false,
    )
    expect(
      consoleQuery.auth.plugin.datasource.list.get.queryOptions({ input: {}, retry: 2 }).retry,
    ).toBe(2)
  })
})

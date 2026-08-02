// @vitest-environment node

import type { HomeTemplatesData } from '../home-queries'
import { dehydrate, hydrate, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getHomeContinueWorkQueryOptions,
  getHomeTemplatesQueryOptions,
} from '../home-queries-client'
import {
  getHomeContinueWorkServerQueryOptions,
  getHomeTemplatesServerQueryOptions,
} from '../home-queries-server'

vi.mock('server-only', () => ({}))

describe('Home server query hydration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should hydrate server-prefetched Home data into the matching client query keys', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('client query should not fetch')))
    vi.stubGlobal('fetch', fetchSpy)

    const context = { cookie: 'session=abc', csrfToken: 'csrf-token' }
    const serverTemplatesQuery = getHomeTemplatesServerQueryOptions('en-US', context)
    const serverRecentQuery = getHomeContinueWorkServerQueryOptions(context)
    const clientTemplatesQuery = getHomeTemplatesQueryOptions('en-US')
    const clientRecentQuery = getHomeContinueWorkQueryOptions()

    expect(serverTemplatesQuery.queryKey).toEqual(clientTemplatesQuery.queryKey)
    expect(serverRecentQuery.queryKey).toEqual(clientRecentQuery.queryKey)

    const templates: HomeTemplatesData = {
      categories: ['Writing'],
      allList: [],
    }
    const recentResponse = { data: [{ id: 'recent-app' }] }
    const serverQueryClient = new QueryClient()
    serverQueryClient.setQueryData(serverTemplatesQuery.queryKey, templates)
    serverQueryClient.setQueryData(serverRecentQuery.queryKey, recentResponse as never)

    const clientQueryClient = new QueryClient()
    hydrate(clientQueryClient, dehydrate(serverQueryClient))

    await expect(clientQueryClient.ensureQueryData(clientTemplatesQuery)).resolves.toBe(templates)
    await expect(clientQueryClient.ensureQueryData(clientRecentQuery)).resolves.toBe(recentResponse)
    expect(clientRecentQuery.select?.(recentResponse as never)).toEqual([{ id: 'recent-app' }])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

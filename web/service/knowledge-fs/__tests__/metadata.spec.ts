import { QueryClient } from '@tanstack/react-query'
import Cookies from 'js-cookie'
import { API_PREFIX, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import { consoleQuery } from '@/service/console'
import {
  consoleClient as inferredClient,
  consoleQuery as inferredQuery,
} from '@/service/console/inferred'
import { knowledgeFsMetadataFieldsQueryOptions } from '../metadata'

vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))

afterEach(() => {
  vi.restoreAllMocks()
  Cookies.remove(CSRF_COOKIE_NAME())
})

const field = (id: string, name: string) => ({
  count: 1,
  created_at: '2026-08-01T00:00:00Z',
  id,
  name,
  row_version: 1,
  type: 'string',
  updated_at: '2026-08-01T00:00:00Z',
})

describe('KnowledgeFS metadata through the inferred console API', () => {
  it('binds other routes and query helpers through the same document configuration', async () => {
    Cookies.set(CSRF_COOKIE_NAME(), 'shared-csrf')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ data: [], has_more: false, page: 1, limit: 20 }))
    const client = new QueryClient()
    const onResponseHeaders = vi.fn()
    try {
      await client.query(
        inferredQuery.knowledgeFs.spaces.get.queryOptions({
          input: { query: { creator_ids: ['alice', 'bob'] } },
          context: { silent: true, onResponseHeaders },
        }),
      )
      const request = new Request(fetchSpy.mock.calls[0]![0])
      expect(new URL(request.url).pathname).toBe(
        `${new URL(API_PREFIX, window.location.origin).pathname}/knowledge-fs/spaces`,
      )
      expect(new URL(request.url).searchParams.getAll('creator_ids')).toEqual(['alice', 'bob'])
      expect(request.headers.get(CSRF_HEADER_NAME)).toBe('shared-csrf')
      expect(onResponseHeaders).toHaveBeenCalledOnce()
      expect(inferredQuery.key()).toEqual(consoleQuery.key())
      expect(inferredQuery.knowledgeFs.spaces.key()).toEqual(consoleQuery.knowledgeFs.spaces.key())
    } finally {
      client.clear()
    }
  })

  it('collects cursor pages using the existing cookie and CSRF transport', async () => {
    Cookies.set(CSRF_COOKIE_NAME(), 'metadata-csrf')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({ data: [field('field-1', 'category')], next_cursor: 'page+2' }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [field('field-2', 'priority')], next_cursor: null }),
      )
    const options = knowledgeFsMetadataFieldsQueryOptions('space/1')
    const response = await options.queryFn()
    expect(options.select(response).map((item) => item.name)).toEqual(['category', 'priority'])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const requests = fetchSpy.mock.calls.map(([input]) => new Request(input))
    expect(requests[0]!.url).toBe(
      `${new URL(API_PREFIX, window.location.origin).href}/knowledge-fs/spaces/space%2F1/metadata?limit=100`,
    )
    expect(new URL(requests[1]!.url).searchParams.get('cursor')).toBe('page+2')
    for (const request of requests) {
      expect(request.credentials).toBe('include')
      expect(request.headers.get(CSRF_HEADER_NAME)).toBe('metadata-csrf')
    }
  })

  it('shares the existing query key and prefix invalidation', async () => {
    const input = { params: { control_space_id: 'space-1' }, query: { limit: 100 } }
    const previous = consoleQuery.knowledgeFs.spaces.byControlSpaceId.metadata.get
    expect(
      inferredQuery.knowledgeFs.spaces.byControlSpaceId.metadata.get.queryKey({ input }),
    ).toEqual(previous.queryKey({ input }))
    const client = new QueryClient()
    try {
      const options = knowledgeFsMetadataFieldsQueryOptions('space-1')
      client.setQueryData(options.queryKey, { data: [] })
      await client.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.metadata.key(),
      })
      expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(true)
    } finally {
      client.clear()
    }
  })

  it('keeps backend HTTP errors and silent context for the migrated caller', async () => {
    const { ORPCError } = await import('@orpc/client')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { code: 'forbidden', message: 'Space access denied', details: { space_id: 'space-1' } },
        { status: 403 },
      ),
    )
    const error = await knowledgeFsMetadataFieldsQueryOptions('space-1')
      .queryFn()
      .catch((error) => error)
    expect(error).toBeInstanceOf(ORPCError)
    expect(error).toMatchObject({ status: 403, code: 'forbidden', message: 'Space access denied' })
  })

  it('cancels pagination before another page is fetched', async () => {
    const controller = new AbortController()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      controller.abort()
      return Response.json({ data: [], next_cursor: 'page-2' })
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      knowledgeFsMetadataFieldsQueryOptions('space-1').queryFn({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('forwards response headers through the bound operation', async () => {
    const onResponseHeaders = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { data: [], next_cursor: null },
        { headers: { 'x-request-id': 'metadata-request' } },
      ),
    )
    await inferredClient.knowledgeFs.spaces.byControlSpaceId.metadata.get(
      { params: { control_space_id: 'space-1' } },
      {
        context: { silent: true, keepalive: true, onResponseHeaders },
      },
    )
    expect(onResponseHeaders.mock.calls[0]![0].get('x-request-id')).toBe('metadata-request')
  })
})

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { DifyClient } from '../client/base'
import { HttpClient } from './client'

describe('endpoint query parameters', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the end-user selector when sendRequest adds pagination', async () => {
    let received: URL | undefined
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      received = new URL(new Request(url, init).url)
      return new Response('{"data":[]}')
    }))

    await new DifyClient('test').sendRequest('GET', '/conversations?user=user%2B1', null, {
      limit: 20,
    })

    expect(received?.pathname).toBe('/v1/conversations')
    expect(received?.searchParams.get('user')).toBe('user+1')
    expect(received?.searchParams.get('limit')).toBe('20')
  })

  it('retains existing filters and appends repeated query values', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await new HttpClient({ apiKey: 'test', baseUrl: 'https://example.com/dify/v1/' }).requestRaw({
      method: 'GET',
      path: '/datasets?keyword=workflow%20notes&tag_ids=first',
      query: { tag_ids: ['second', 'third'], include_all: false, page: 2 },
    })

    const url = new URL(fetchMock.mock.calls[0]![0] as string)
    expect(url.pathname).toBe('/dify/v1/datasets')
    expect(url.searchParams.get('keyword')).toBe('workflow notes')
    expect(url.searchParams.getAll('tag_ids')).toEqual(['first', 'second', 'third'])
    expect(url.searchParams.get('include_all')).toBe('false')
    expect(url.searchParams.get('page')).toBe('2')
  })

  it.each([undefined, {}, { unused: undefined }])('preserves a query-only endpoint with %j options', async (query) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await new HttpClient({ apiKey: 'test' }).requestRaw({
      method: 'GET', path: '/datasets?keyword=a%2Bb', query,
    })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.dify.ai/v1/datasets?keyword=a%2Bb')
  })
})

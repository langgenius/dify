import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { useMarketplace } from '../hooks'

const requests = vi.hoisted(() => ({
  installed: vi.fn(),
  search: vi.fn(),
  collections: vi.fn(),
  collectionPlugins: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.installedIds.get': requests.installed,
    }),
  }
})
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceClient: {
      ...actual.marketplaceClient,
      collections: requests.collections,
      collectionPlugins: requests.collectionPlugins,
    },
  }
})
// The legacy search owner uses this transport; its query state and formatting stay real.
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal()),
  postMarketplace: requests.search,
}))
const plugin = createMarketplacePluginFixture()
const collection: MarketplaceCollection = {
  rule: '',
  created_at: '',
  updated_at: '',
  name: 'featured',
  label: { en_US: 'Featured' },
  description: { en_US: 'Featured tools' },
  searchable: false,
  search_params: {},
}
const response = (plugins = [plugin], total = plugins.length) => ({ data: { plugins, total } })
function renderMarketplace(initial = { search: '', tags: [] as string[], enabled: true }) {
  const { wrapper } = createConsoleQueryWrapper()
  return renderHook(({ search, tags, enabled }) => useMarketplace(search, tags, enabled), {
    wrapper,
    initialProps: initial,
  })
}
const scrollToEnd = (handleScroll: (event: Event) => void) => {
  const container = document.createElement('div')
  Object.defineProperties(container, {
    scrollTop: { value: 200 },
    scrollHeight: { value: 500 },
    clientHeight: { value: 300 },
  })
  container.addEventListener('scroll', handleScroll)
  act(() => container.dispatchEvent(new Event('scroll')))
  container.removeEventListener('scroll', handleScroll)
}
beforeEach(() => {
  requests.installed.mockReset().mockResolvedValue({ plugin_ids: ['installed-tool'] })
  requests.search.mockReset().mockResolvedValue(response())
  requests.collections.mockReset().mockResolvedValue({ data: { collections: [collection] } })
  requests.collectionPlugins.mockReset().mockResolvedValue(response())
})

it('defers catalog requests until activation and then supplies the collection results', async () => {
  const { result, rerender } = renderMarketplace({ search: '', tags: [], enabled: false })
  expect(requests.installed).not.toHaveBeenCalled()
  expect(requests.collections).not.toHaveBeenCalled()
  expect(requests.search).not.toHaveBeenCalled()
  rerender({ search: '', tags: [], enabled: true })
  await waitFor(() =>
    expect(result.current.marketplaceCollectionPluginsMap?.featured).toMatchObject([
      { plugin_id: plugin.plugin_id },
    ]),
  )
  expect(result.current.marketplaceCollections).toEqual([collection])
  expect(result.current.isLoading).toBe(false)
})
it.each([
  { search: 'alpha', tags: [] },
  { search: '', tags: ['search'] },
])('loads matching tools for search=$search and tags=$tags', async ({ search, tags }) => {
  const { result } = renderMarketplace({ search, tags, enabled: true })
  await waitFor(() =>
    expect(result.current.plugins).toMatchObject([{ plugin_id: plugin.plugin_id }]),
  )
  expect(requests.search).toHaveBeenCalledWith('/plugins/search/advanced', {
    body: {
      category: 'tool',
      query: search,
      tags,
      exclude: ['installed-tool'],
      type: 'plugin',
      page: 1,
      page_size: 40,
      sort_by: undefined,
      sort_order: undefined,
    },
    signal: expect.any(AbortSignal),
  })
  expect(requests.collections).not.toHaveBeenCalled()
})
it('clears search results and restores collections when filters are removed', async () => {
  const { result, rerender } = renderMarketplace({ search: 'alpha', tags: [], enabled: true })
  await waitFor(() => expect(result.current.plugins).toHaveLength(1))
  rerender({ search: '', tags: [], enabled: true })
  await waitFor(() =>
    expect(result.current.marketplaceCollectionPluginsMap?.featured).toHaveLength(1),
  )
  expect(result.current.plugins).toBeUndefined()
  expect(requests.collections).toHaveBeenCalledWith(
    {
      query: expect.objectContaining({
        category: 'tool',
        exclude: ['installed-tool'],
        type: 'plugin',
      }),
    },
    { signal: expect.any(AbortSignal) },
  )
  expect(result.current.page).toBe(1)
})
it('reports loading until the requested first page arrives', async () => {
  const pending = createDeferred<ReturnType<typeof response>>()
  requests.search.mockReturnValue(pending.promise)
  const { result } = renderMarketplace({ search: 'alpha', tags: [], enabled: true })
  await waitFor(() => expect(result.current.isLoading).toBe(true))
  expect(result.current.plugins).toBeUndefined()
  expect(result.current.page).toBe(1)
  await act(async () => pending.resolve(response()))
  await waitFor(() => expect(result.current.plugins).toHaveLength(1))
  expect(result.current.isLoading).toBe(false)
})
it('appends the next search page on scroll and stops paging after filters are cleared', async () => {
  const second = createMarketplacePluginFixture({ plugin_id: 'second-tool', name: 'second-tool' })
  const firstPage = Array.from({ length: 40 }, (_, index) =>
    createMarketplacePluginFixture({ plugin_id: `tool-${index}`, name: `tool-${index}` }),
  )
  requests.search
    .mockResolvedValueOnce(response(firstPage, 41))
    .mockResolvedValue(response([second], 41))
  const { result, rerender } = renderMarketplace({ search: 'alpha', tags: [], enabled: true })
  await waitFor(() => expect(result.current.plugins).toHaveLength(40))
  scrollToEnd(result.current.handleScroll)
  await waitFor(() =>
    expect(result.current.plugins?.map((item) => item.plugin_id)).toEqual([
      ...firstPage.map((item) => item.plugin_id),
      'second-tool',
    ]),
  )
  expect(result.current.page).toBe(2)
  expect(requests.search).toHaveBeenLastCalledWith(
    '/plugins/search/advanced',
    expect.objectContaining({ body: expect.objectContaining({ page: 2, query: 'alpha' }) }),
  )
  rerender({ search: '', tags: [], enabled: true })
  await waitFor(() => expect(result.current.marketplaceCollections).toEqual([collection]))
  scrollToEnd(result.current.handleScroll)
  expect(requests.search).toHaveBeenCalledTimes(2)
  expect(result.current.plugins).toBeUndefined()
})

import type { ReactNode } from 'react'
import type { marketplaceClient } from '@/service/marketplace'
import { QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { Provider as JotaiProvider } from 'jotai'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import pluginMessages from '@/i18n/locales/en-US/plugin.json'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { useSearchPluginText } from '../../atoms'
import ListWrapper from '../list-wrapper'

const transport = vi.hoisted(() => ({
  collections: vi.fn<typeof marketplaceClient.collections>(),
  collectionPlugins: vi.fn<typeof marketplaceClient.collectionPlugins>(),
  searchAdvanced: vi.fn<typeof marketplaceClient.searchAdvanced>(),
}))

vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceClient: {
      ...actual.marketplaceClient,
      collections: transport.collections,
      collectionPlugins: transport.collectionPlugins,
      searchAdvanced: transport.searchAdvanced,
    },
  }
})

vi.unmock('react-i18next')

const plugin = (name: string, label: string) =>
  createMarketplacePluginFixture({
    name,
    plugin_id: `dify/${name}`,
    label: { en_US: label },
    brief: { en_US: `${label} description` },
  })

const searchResponse = (plugins: ReturnType<typeof plugin>[], total = plugins.length) => ({
  data: { plugins, total },
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function SearchControl() {
  const [query, setQuery] = useSearchPluginText()
  return (
    <input
      aria-label="Marketplace query"
      value={query}
      onChange={(event) => void setQuery(event.target.value)}
    />
  )
}

const renderListWrapper = async ({
  children,
  searchParams = '?category=model',
}: { children?: ReactNode; searchParams?: string } = {}) => {
  const queryClient = createTestQueryClient()
  const { wrapper: NuqsWrapper, onUrlUpdate } = createNuqsTestWrapper({
    searchParams,
    hasMemory: true,
  })
  onTestFinished(() => queryClient.clear())
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { common, plugin: pluginMessages } },
  })
  const rendered = await render(
    <I18nextProvider i18n={i18n}>
      <JotaiProvider>
        <QueryClientProvider client={queryClient}>
          <NuqsWrapper>
            {children}
            <section
              aria-label="Marketplace results"
              id="marketplace-container"
              style={{ height: 500, overflowY: 'auto' }}
            >
              <ListWrapper linkToMarketplaceDetail />
            </section>
          </NuqsWrapper>
        </QueryClientProvider>
      </JotaiProvider>
    </I18nextProvider>,
  )
  return { ...rendered, onUrlUpdate }
}

describe('ListWrapper', () => {
  beforeEach(() => {
    onTestFinished(guardUnexpectedFetch())
    transport.collections.mockReset().mockResolvedValue({ data: { collections: [] } })
    transport.collectionPlugins.mockReset().mockResolvedValue({ data: { plugins: [] } })
    transport.searchAdvanced.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows result cards and the real localized sort control', async () => {
    transport.searchAdvanced.mockResolvedValue(searchResponse([plugin('plugin-one', 'Plugin One')]))
    const screen = await renderListWrapper()
    await expect.element(screen.getByRole('link', { name: /Plugin One/ })).toBeVisible()
    await expect.element(screen.getByRole('status')).toHaveTextContent('1 results')
    const sort = screen.getByRole('button', { name: /Sort by/ })
    await expect.element(sort).toBeVisible()
  })

  it('keeps loaded cards and the result announcement while native scrolling fetches the next page', async () => {
    const nextPage = deferred<ReturnType<typeof searchResponse>>()
    const firstPage = Array.from({ length: 40 }, (_, index) =>
      plugin(`plugin-${index}`, `Plugin ${index}`),
    )
    transport.searchAdvanced.mockImplementation(({ body }) =>
      body.page === 1 ? Promise.resolve(searchResponse(firstPage, 41)) : nextPage.promise,
    )
    const screen = await renderListWrapper()
    const firstCard = screen.getByRole('link', { name: /Plugin 0 / })
    await expect.element(firstCard).toBeVisible()
    await expect.element(screen.getByRole('status')).toHaveTextContent('41 results')
    const container = screen.getByRole('region', { name: 'Marketplace results' })
    const scroll = container.element()
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight)
    scroll.scrollTo({ top: scroll.scrollHeight })
    await expect.element(screen.getByRole('progressbar')).toBeVisible()
    await expect.element(screen.getByRole('status')).toHaveTextContent('Loading')
    await expect.element(firstCard).toBeInTheDocument()
    nextPage.resolve(searchResponse([plugin('plugin-40', 'Plugin 40')], 41))
    await expect.element(screen.getByRole('link', { name: /Plugin 40/ })).toBeInTheDocument()
    await expect.element(firstCard).toBeInTheDocument()
    await expect.element(screen.getByRole('status')).toHaveTextContent('41 results')
    await expect.element(screen.getByRole('progressbar')).not.toBeInTheDocument()
  })

  it('announces loading without result links on a cold start', async () => {
    transport.searchAdvanced.mockReturnValue(new Promise(() => {}))
    const screen = await renderListWrapper()
    await expect.element(screen.getByRole('progressbar')).toBeVisible()
    await expect.element(screen.getByRole('link')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('status')).toHaveTextContent('Loading')
  })

  it('keeps stale results through the full debounce and pending replacement request', async () => {
    const replacement = deferred<ReturnType<typeof searchResponse>>()
    transport.searchAdvanced.mockImplementation(({ body }) =>
      body.query === 'first'
        ? Promise.resolve(searchResponse([plugin('first-plugin', 'First Plugin')]))
        : replacement.promise,
    )
    const { onUrlUpdate, ...screen } = await renderListWrapper({
      children: <SearchControl />,
      searchParams: '?category=all&q=first',
    })
    const first = screen.getByRole('link', { name: /First Plugin/ })
    await expect.element(first).toBeVisible()
    // Only the debounce clock is controlled; native browser input and rendering remain real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await screen.getByRole('textbox', { name: 'Marketplace query' }).fill('second')
    await vi.advanceTimersByTimeAsync(0)
    expect(onUrlUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ searchParams: new URLSearchParams('category=all&q=second') }),
    )
    await expect.element(first).toBeVisible()
    await expect.element(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(
      transport.searchAdvanced.mock.calls.some(([request]) => request.body.query === 'second'),
    ).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    await expect
      .poll(() =>
        transport.searchAdvanced.mock.calls.some(([request]) => request.body.query === 'second'),
      )
      .toBe(true)
    await expect.element(first).toBeVisible()
    replacement.resolve(searchResponse([plugin('second-plugin', 'Second Plugin')]))
    await vi.advanceTimersByTimeAsync(0)
    vi.useRealTimers()
    await expect.element(screen.getByRole('link', { name: /Second Plugin/ })).toBeVisible()
    await expect.element(first).not.toBeInTheDocument()
    await expect.element(screen.getByRole('status')).toHaveTextContent('1 results')
  })

  it('offers a retry and renders the recovered result after a failed search', async () => {
    transport.searchAdvanced
      .mockRejectedValueOnce(new Error('Marketplace unavailable'))
      .mockResolvedValueOnce(searchResponse([plugin('recovered-plugin', 'Recovered Plugin')]))
    const screen = await renderListWrapper()
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent(pluginMessages['marketplace.loadError'])
    await expect.element(screen.getByRole('link')).not.toBeInTheDocument()
    await screen.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect.element(screen.getByRole('link', { name: /Recovered Plugin/ })).toBeVisible()
    await expect.element(screen.getByRole('status')).toHaveTextContent('1 results')
  })
})

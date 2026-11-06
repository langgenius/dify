import type { ReactNode } from 'react'
import type { marketplaceClient } from '@/service/marketplace'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider as JotaiProvider } from 'jotai'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
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

vi.mock('#i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#i18n')>()
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    ...actual,
    useTranslation: () => ({
      t: withSelectorKey((key: string, options?: Record<string, unknown>) => {
        const translations: Record<string, string> = {
          'marketplace.loadError': 'Could not load plugins',
          'marketplace.sortBy': 'Sort by',
          'marketplace.sortOption.mostPopular': 'Most Popular',
          'marketplace.sortOption.recentlyUpdated': 'Recently Updated',
          'marketplace.sortOption.newlyReleased': 'Newly Released',
          'marketplace.sortOption.firstReleased': 'First Released',
        }
        if (key === 'marketplace.pluginsResult') return `${options?.num} plugins found`
        return translations[key] || key
      }),
    }),
  }
})

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

const renderListWrapper = ({
  children,
  searchParams = '?category=model',
}: { children?: ReactNode; searchParams?: string } = {}) => {
  const queryClient = createTestQueryClient()
  const { wrapper: NuqsWrapper, onUrlUpdate } = createNuqsTestWrapper({
    searchParams,
    hasMemory: true,
  })
  const rendered = render(
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <NuqsWrapper>
          {children}
          <div id="marketplace-container">
            <ListWrapper linkToMarketplaceDetail />
          </div>
        </NuqsWrapper>
      </QueryClientProvider>
    </JotaiProvider>,
  )
  return { ...rendered, onUrlUpdate }
}

describe('ListWrapper', () => {
  beforeEach(() => {
    transport.collections.mockReset().mockResolvedValue({ data: { collections: [] } })
    transport.collectionPlugins.mockReset().mockResolvedValue({ data: { plugins: [] } })
    transport.searchAdvanced.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows real result cards and the sort dropdown when plugins are loaded', async () => {
    transport.searchAdvanced.mockResolvedValue(searchResponse([plugin('plugin-one', 'Plugin One')]))

    renderListWrapper()

    expect(await screen.findByRole('link', { name: /Plugin One/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 plugins found')
    expect(screen.getByRole('button', { name: 'Sort by Most Popular' })).toBeInTheDocument()
  })

  it('keeps the status and loaded cards visible while fetching the next page', async () => {
    const nextPage = deferred<ReturnType<typeof searchResponse>>()
    const firstPage = Array.from({ length: 40 }, (_, index) =>
      plugin(`plugin-${index}`, `Plugin ${index}`),
    )
    transport.searchAdvanced.mockImplementation(({ body }) =>
      body.page === 1 ? Promise.resolve(searchResponse(firstPage, 41)) : nextPage.promise,
    )
    renderListWrapper()
    const firstCard = await screen.findByRole('link', { name: /Plugin 0/ })
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('41 plugins found')

    const container = document.getElementById('marketplace-container')!
    Object.defineProperties(container, {
      scrollTop: { value: 800, configurable: true },
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 200, configurable: true },
    })
    fireEvent.scroll(container)

    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toBeVisible()
      expect(status.textContent).toMatch(/loading/i)
    })
    expect(firstCard).toBeInTheDocument()
    expect(screen.getByRole('status')).toBe(status)

    await act(async () => {
      nextPage.resolve(searchResponse([plugin('plugin-40', 'Plugin 40')], 41))
    })

    expect(await screen.findByRole('link', { name: /Plugin 40/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Plugin 0/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('41 plugins found')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows centered loading on a cold start', () => {
    transport.searchAdvanced.mockReturnValue(new Promise(() => {}))

    renderListWrapper()

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('status').textContent).toMatch(/loading/i)
  })

  it('keeps stale results visible while a debounced replacement query is pending', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    // RTL recognizes this bridge when draining userEvent's zero-delay async wrapper.
    vi.stubGlobal('jest', { advanceTimersByTime: vi.advanceTimersByTime })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const replacement = deferred<ReturnType<typeof searchResponse>>()
    transport.searchAdvanced.mockImplementation(({ body }) => {
      if (body.query === 'first')
        return Promise.resolve(searchResponse([plugin('first-plugin', 'First Plugin')]))
      return replacement.promise
    })

    const { onUrlUpdate } = renderListWrapper({
      children: <SearchControl />,
      searchParams: '?category=all&q=first',
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('link', { name: /First Plugin/ })).toBeInTheDocument()

    const input = screen.getByRole('textbox', { name: 'Marketplace query' })
    await user.clear(input)
    await user.type(input, 'second')
    // Flush Nuqs' zero-delay URL update before starting the production debounce clock.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(onUrlUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ searchParams: new URLSearchParams('category=all&q=second') }),
    )

    expect(screen.getByRole('link', { name: /First Plugin/ })).toBeInTheDocument()
    expect(screen.getByRole('status').textContent).toMatch(/loading/i)
    expect(
      transport.searchAdvanced.mock.calls.some(([request]) => request.body.query === 'second'),
    ).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(
      transport.searchAdvanced.mock.calls.some(([request]) => request.body.query === 'second'),
    ).toBe(true)
    expect(screen.getByRole('link', { name: /First Plugin/ })).toBeInTheDocument()

    await act(async () => {
      replacement.resolve(searchResponse([plugin('second-plugin', 'Second Plugin')]))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('link', { name: /Second Plugin/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /First Plugin/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 plugins found')
  })

  it('offers a retry and renders the recovered result after a failed search', async () => {
    const user = userEvent.setup()
    transport.searchAdvanced
      .mockRejectedValueOnce(new Error('Marketplace unavailable'))
      .mockResolvedValueOnce(searchResponse([plugin('recovered-plugin', 'Recovered Plugin')]))

    renderListWrapper()

    const status = screen.getByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('Could not load plugins'))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /operation\.retry/i }))

    expect(await screen.findByRole('link', { name: /Recovered Plugin/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 plugins found')
  })
})

import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { ReactElement } from 'react'
import type { Plugin } from '@/app/components/plugins/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import { mockIntersectionObserver } from '@/test/intersection-observer'
import ListWithCollection from '../list-with-collection'

const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
const render = (
  element: ReactElement,
  options: Parameters<typeof renderWithConsoleQuery>[1] = {},
) =>
  renderWithConsoleQuery(
    <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>{element}</NuqsTestingAdapter>,
    options,
  )
const createPlugin = (name: string) =>
  createMarketplacePluginFixture({
    plugin_id: name,
    name,
    label: { en_US: name },
  })
let intersect: ReturnType<typeof mockIntersectionObserver>

const collections: MarketplaceCollection[] = [
  {
    name: 'featured',
    label: { en_US: 'Featured' },
    description: { en_US: 'Featured plugins' },
    rule: 'featured',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    searchable: true,
    search_params: { query: 'featured' },
  },
  {
    name: 'empty',
    label: { en_US: 'Empty' },
    description: { en_US: 'No plugins' },
    rule: 'empty',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    searchable: false,
    search_params: {},
  },
]

const pluginsMap: Record<string, Plugin[]> = {
  featured: [createPlugin('Plugin One'), createPlugin('Plugin Two')],
  empty: [],
}

const buildPerformanceFixture = () => {
  const pluginCounts = [61, 8, 8, 8, 8, 8, 8]
  const fixtureCollections = pluginCounts.map((_, collectionIndex) => ({
    ...collections[0]!,
    name: `collection-${collectionIndex}`,
    label: { en_US: `Collection ${collectionIndex}` },
    description: { en_US: `Description ${collectionIndex}` },
  }))
  const fixturePluginsMap = Object.fromEntries(
    pluginCounts.map((pluginCount, collectionIndex) => [
      `collection-${collectionIndex}`,
      Array.from({ length: pluginCount }, (_, pluginIndex) =>
        createPlugin(`Collection ${collectionIndex} Plugin ${pluginIndex}`),
      ),
    ]),
  )

  return { fixtureCollections, fixturePluginsMap }
}

describe('ListWithCollection', () => {
  beforeEach(() => {
    intersect = mockIntersectionObserver()
    vi.stubGlobal('innerWidth', 1280)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('omits empty collections and filters the catalog through View more', async () => {
    render(
      <ListWithCollection
        marketplaceCollections={collections}
        marketplaceCollectionPluginsMap={pluginsMap}
      />,
    )
    expect(screen.getByText('Featured')).toBeInTheDocument()
    expect(screen.queryByText('Empty')).not.toBeInTheDocument()
    expect(
      screen.getAllByText(/^(?:Plugin (?:One|Two)|Partner Plugin|Featured Plugin)$/),
    ).toHaveLength(2)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'plugin.marketplace.viewMore' }))
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('q')).toBe('featured'),
    )
  })

  it('uses custom more handler when provided', async () => {
    const onCollectionMoreClick = vi.fn()

    render(
      <ListWithCollection
        marketplaceCollections={collections}
        marketplaceCollectionPluginsMap={pluginsMap}
        onCollectionMoreClick={onCollectionMoreClick}
      />,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'plugin.marketplace.viewMore' }))

    expect(onCollectionMoreClick).toHaveBeenCalledWith({ query: 'featured' })
    expect(onUrlUpdate).not.toHaveBeenCalled()
  })

  it('uses custom card renderer when provided', () => {
    render(
      <ListWithCollection
        marketplaceCollections={collections}
        marketplaceCollectionPluginsMap={pluginsMap}
        cardRender={(plugin) => (
          <a key={plugin.plugin_id} href={`/custom/${plugin.plugin_id}`}>
            {plugin.name}
          </a>
        )}
      />,
    )

    expect(screen.getByRole('link', { name: 'Plugin One' })).toHaveAttribute(
      'href',
      '/custom/Plugin One',
    )
    expect(screen.getByRole('link', { name: 'Plugin Two' })).toHaveAttribute(
      'href',
      '/custom/Plugin Two',
    )
  })

  it('renders become partner link only for partners collection', () => {
    const partnerCollection: MarketplaceCollection = {
      name: 'partner-template',
      label: { en_US: 'Partners' },
      description: { en_US: 'Partner plugins' },
      rule: 'partners',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
      searchable: false,
      search_params: {},
    }

    render(
      <ListWithCollection
        marketplaceCollections={[partnerCollection, collections[0]!]}
        marketplaceCollectionPluginsMap={{
          'partner-template': [createPlugin('Partner Plugin')],
          featured: [createPlugin('Featured Plugin')],
        }}
      />,
    )

    const partnerLink = screen.getByRole('link', { name: 'plugin.marketplace.becomePartner' })

    expect(partnerLink).toHaveAttribute(
      'href',
      'https://share-na2.hsforms.com/1NiS4r9lsSqGcuNBB77DeEQ40s9fk',
    )
    expect(partnerLink).toHaveAttribute('target', '_blank')
    expect(partnerLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(
      screen.getAllByText(/^(?:Plugin (?:One|Two)|Partner Plugin|Featured Plugin)$/),
    ).toHaveLength(2)
  })

  it('uses carousel navigation instead of view more when collection exceeds two rows', () => {
    const collection = {
      ...collections[0]!,
      searchable: true,
      search_params: { query: 'featured' },
    }
    const plugins = Array.from({ length: 9 }, (_, index) => createPlugin(`Plugin ${index + 1}`))

    render(
      <ListWithCollection
        marketplaceCollections={[collection]}
        marketplaceCollectionPluginsMap={{ featured: plugins }}
      />,
    )

    expect(screen.queryByText('plugin.marketplace.viewMore')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'plugin.marketplace.carousel.scrollNext' }),
    ).toBeInTheDocument()
  })

  it('keeps the first collection eager and defers the rest until they enter the preload range', () => {
    const { fixtureCollections, fixturePluginsMap } = buildPerformanceFixture()
    const marketplaceContainer = document.createElement('div')
    marketplaceContainer.id = 'marketplace-container'
    document.body.appendChild(marketplaceContainer)

    const { unmount } = render(
      <ListWithCollection
        marketplaceCollections={fixtureCollections}
        marketplaceCollectionPluginsMap={fixturePluginsMap}
        deferOffscreenCollections
      />,
      { container: marketplaceContainer },
    )

    expect(screen.getAllByText(/Collection \d$/)).toHaveLength(7)
    // The first collection has server-renderable content; later ones preload on intersection.
    expect(screen.getAllByText(/^Collection \d+ Plugin \d+$/)).toHaveLength(61)
    expect(screen.queryByText('Collection 1 Plugin 0')).not.toBeInTheDocument()
    // The collection marker identifies the observed non-interactive section.
    const deferredSection = marketplaceContainer.querySelector(
      '[data-marketplace-collection="collection-1"]',
    )!
    intersect(true, { target: deferredSection })
    expect(screen.getByText('Collection 1 Plugin 0')).toBeInTheDocument()
    expect(screen.getAllByText(/^Collection \d+ Plugin \d+$/)).toHaveLength(69)
    intersect(false, { target: deferredSection })
    expect(screen.getByText('Collection 1 Plugin 0')).toBeInTheDocument()
    expect(screen.queryByText('Collection 2 Plugin 0')).not.toBeInTheDocument()

    unmount()
    marketplaceContainer.remove()
  })

  it('mounts deferred collections after hydration when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { fixtureCollections, fixturePluginsMap } = buildPerformanceFixture()
    fixturePluginsMap['collection-0'] = fixturePluginsMap['collection-0']!.slice(0, 8)
    render(
      <ListWithCollection
        marketplaceCollections={fixtureCollections}
        marketplaceCollectionPluginsMap={fixturePluginsMap}
        deferOffscreenCollections
      />,
    )
    expect(screen.getAllByText(/^Collection \d+ Plugin \d+$/)).toHaveLength(56)
    expect(screen.getByText('Collection 6 Plugin 7')).toBeInTheDocument()
  })

  it('keeps standalone collections eager for SSR-compatible rendering', () => {
    const { fixtureCollections, fixturePluginsMap } = buildPerformanceFixture()

    render(
      <ListWithCollection
        marketplaceCollections={fixtureCollections}
        marketplaceCollectionPluginsMap={fixturePluginsMap}
      />,
    )

    expect(screen.getAllByText(/^Collection \d+ Plugin \d+$/)).toHaveLength(109)
  })
})

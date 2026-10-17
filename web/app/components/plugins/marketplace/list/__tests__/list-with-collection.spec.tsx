import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { Plugin } from '@/app/components/plugins/types'
import {
  act,
  fireEvent,
  screen,
  render as testingLibraryRender,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import ListWithCollection from '../list-with-collection'

const onUrlUpdate = vi.fn()
const render = (element: ReactElement, options?: RenderOptions) =>
  testingLibraryRender(element, {
    wrapper: createNuqsTestWrapper({ onUrlUpdate }).wrapper,
    ...options,
  })

vi.mock('@/i18n/metadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/metadata')>()),
  getPluginLanguage: (locale: string) => locale,
}))

vi.mock('../card-wrapper', () => ({
  default: ({ plugin }: { plugin: Plugin }) => <div data-testid="card-wrapper">{plugin.name}</div>,
}))

const collections: MarketplaceCollection[] = [
  {
    name: 'featured',
    label: { 'en-US': 'Featured' },
    description: { 'en-US': 'Featured plugins' },
    rule: 'featured',
    created_at: '',
    updated_at: '',
    searchable: true,
    search_params: { query: 'featured' },
  },
  {
    name: 'empty',
    label: { 'en-US': 'Empty' },
    description: { 'en-US': 'No plugins' },
    rule: 'empty',
    created_at: '',
    updated_at: '',
    searchable: false,
    search_params: {},
  },
]

const pluginsMap: Record<string, Plugin[]> = {
  featured: [
    { plugin_id: 'p1', name: 'Plugin One' },
    { plugin_id: 'p2', name: 'Plugin Two' },
  ] as Plugin[],
  empty: [],
}

type IntersectionObserverRecord = {
  callback: IntersectionObserverCallback
  disconnect: ReturnType<typeof vi.fn>
  observe: ReturnType<typeof vi.fn>
  options?: IntersectionObserverInit
}

const intersectionObservers: IntersectionObserverRecord[] = []

class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  disconnect = vi.fn()
  observe = vi.fn()
  options?: IntersectionObserverInit
  root: Element | Document | null
  rootMargin: string
  takeRecords = vi.fn(() => [])
  thresholds: readonly number[]
  unobserve = vi.fn()

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    this.root = options?.root ?? null
    this.rootMargin = options?.rootMargin ?? '0px'
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0]
    intersectionObservers.push(this)
  }
}

const installIntersectionObserver = () => {
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
}

const triggerIntersection = (
  observer: IntersectionObserverRecord,
  { intersectionRatio, isIntersecting }: { intersectionRatio: number; isIntersecting: boolean },
) => {
  act(() => {
    observer.callback(
      [{ intersectionRatio, isIntersecting } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    )
  })
}

const buildPerformanceFixture = () => {
  const pluginCounts = [61, 8, 8, 8, 8, 8, 8]
  const fixtureCollections = pluginCounts.map((_, collectionIndex) => ({
    ...collections[0]!,
    name: `collection-${collectionIndex}`,
    label: { 'en-US': `Collection ${collectionIndex}` },
    description: { 'en-US': `Description ${collectionIndex}` },
  })) as MarketplaceCollection[]
  const fixturePluginsMap = Object.fromEntries(
    pluginCounts.map((pluginCount, collectionIndex) => [
      `collection-${collectionIndex}`,
      Array.from({ length: pluginCount }, (_, pluginIndex) => ({
        plugin_id: `collection-${collectionIndex}-plugin-${pluginIndex}`,
        name: `Collection ${collectionIndex} Plugin ${pluginIndex}`,
      })) as Plugin[],
    ]),
  )

  return { fixtureCollections, fixturePluginsMap }
}

describe('ListWithCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    intersectionObservers.length = 0
    installIntersectionObserver()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280,
    })
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
    expect(screen.getAllByTestId('card-wrapper')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'plugin.marketplace.viewMore' }))
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('q')).toBe('featured'),
    )
  })

  it('uses custom more handler when provided', () => {
    const onCollectionMoreClick = vi.fn()

    render(
      <ListWithCollection
        marketplaceCollections={collections}
        marketplaceCollectionPluginsMap={pluginsMap}
        onCollectionMoreClick={onCollectionMoreClick}
      />,
    )

    fireEvent.click(screen.getByText('plugin.marketplace.viewMore'))

    expect(onCollectionMoreClick).toHaveBeenCalledWith({ query: 'featured' })
    expect(onUrlUpdate).not.toHaveBeenCalled()
  })

  it('uses custom card renderer when provided', () => {
    render(
      <ListWithCollection
        marketplaceCollections={collections}
        marketplaceCollectionPluginsMap={pluginsMap}
        cardRender={(plugin) => (
          <div key={plugin.plugin_id} data-testid="custom-card">
            {plugin.name}
          </div>
        )}
      />,
    )

    expect(screen.getAllByTestId('custom-card')).toHaveLength(2)
    expect(screen.queryByTestId('card-wrapper')).not.toBeInTheDocument()
  })

  it('renders become partner link only for partners collection', () => {
    const partnerCollection: MarketplaceCollection = {
      name: 'partner-template',
      label: { 'en-US': 'Partners' },
      description: { 'en-US': 'Partner plugins' },
      rule: 'partners',
      created_at: '',
      updated_at: '',
      searchable: false,
      search_params: {},
    }

    render(
      <ListWithCollection
        marketplaceCollections={[partnerCollection, collections[0]!]}
        marketplaceCollectionPluginsMap={{
          'partner-template': [{ plugin_id: 'partner-plugin', name: 'Partner Plugin' }] as Plugin[],
          featured: [{ plugin_id: 'featured-plugin', name: 'Featured Plugin' }] as Plugin[],
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
    expect(screen.getAllByTestId('card-wrapper')).toHaveLength(2)
  })

  it('does not render become partner link for misspelled partner collection name', () => {
    const misspelledPartnerCollection: MarketplaceCollection = {
      name: 'parters',
      label: { 'en-US': 'Parters' },
      description: { 'en-US': 'Misspelled partner plugins' },
      rule: 'parters',
      created_at: '',
      updated_at: '',
      searchable: false,
      search_params: {},
    }

    render(
      <ListWithCollection
        marketplaceCollections={[misspelledPartnerCollection]}
        marketplaceCollectionPluginsMap={{
          parters: [
            { plugin_id: 'misspelled-partner-plugin', name: 'Misspelled Partner Plugin' },
          ] as Plugin[],
        }}
      />,
    )

    expect(
      screen.queryByRole('link', { name: 'plugin.marketplace.becomePartner' }),
    ).not.toBeInTheDocument()
  })

  it('uses carousel navigation instead of view more when collection exceeds two rows', () => {
    const collection = {
      ...collections[0]!,
      searchable: true,
      search_params: { query: 'featured' },
    }
    const plugins = Array.from({ length: 9 }, (_, index) => ({
      plugin_id: `p${index + 1}`,
      name: `Plugin ${index + 1}`,
    })) as Plugin[]

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
    expect(screen.getAllByTestId('card-wrapper')).toHaveLength(61)
    expect(screen.queryByText('Collection 1 Plugin 0')).not.toBeInTheDocument()
    // Partner collections autoplay; this fixture is non-partner, so the only
    // observers here are the collection preload observers.
    const collectionObservers = intersectionObservers.filter(
      (observer) => observer.options?.rootMargin === '320px 0px',
    )
    expect(collectionObservers).toHaveLength(6)
    expect(collectionObservers[0]!.options).toEqual({
      root: marketplaceContainer,
      rootMargin: '320px 0px',
      threshold: 0.01,
    })

    triggerIntersection(collectionObservers[0]!, {
      intersectionRatio: 0.01,
      isIntersecting: true,
    })

    expect(collectionObservers[0]!.disconnect).toHaveBeenCalled()
    expect(screen.getAllByTestId('card-wrapper')).toHaveLength(69)

    triggerIntersection(collectionObservers[0]!, {
      intersectionRatio: 0,
      isIntersecting: false,
    })

    expect(screen.getAllByTestId('card-wrapper')).toHaveLength(69)

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
    expect(screen.getAllByTestId('card-wrapper')).toHaveLength(56)
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

    expect(screen.getAllByTestId('card-wrapper')).toHaveLength(109)
    expect(
      intersectionObservers.some((observer) => observer.options?.rootMargin === '320px 0px'),
    ).toBe(false)
  })
})

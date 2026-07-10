import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { Plugin } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ListWithCollection from '../list-with-collection'

const mockMoreClick = vi.fn()

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return ({
    useTranslation: () => ({
      t: withSelectorKey((key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key),
    }),
    useLocale: () => 'en-US',
  })
})

vi.mock('../../atoms', () => ({
  useMarketplaceMoreClick: () => mockMoreClick,
}))

vi.mock('@/i18n-config/language', () => ({
  getLanguage: (locale: string) => locale,
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

describe('ListWithCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280,
    })
  })

  it('renders only collections that contain plugins', () => {
    render(
      <ListWithCollection
        marketplaceCollections={collections}
        marketplaceCollectionPluginsMap={pluginsMap}
      />,
    )

    expect(screen.getByText('Featured')).toBeInTheDocument()
    expect(screen.queryByText('Empty')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('card-wrapper')).toHaveLength(2)
  })

  it('calls more handler for searchable collection', () => {
    render(
      <ListWithCollection
        marketplaceCollections={collections}
        marketplaceCollectionPluginsMap={pluginsMap}
      />,
    )

    fireEvent.click(screen.getByText('plugin.marketplace.viewMore'))

    expect(mockMoreClick).toHaveBeenCalledWith({ query: 'featured' })
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
    expect(mockMoreClick).not.toHaveBeenCalled()
  })

  it('uses custom card renderer when provided', () => {
    render(
      <ListWithCollection
        marketplaceCollections={collections}
        marketplaceCollectionPluginsMap={pluginsMap}
        cardRender={plugin => <div key={plugin.plugin_id} data-testid="custom-card">{plugin.name}</div>}
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
          'featured': [{ plugin_id: 'featured-plugin', name: 'Featured Plugin' }] as Plugin[],
        }}
      />,
    )

    const partnerLink = screen.getByRole('link', { name: 'plugin.marketplace.becomePartner' })

    expect(partnerLink).toHaveAttribute('href', 'https://share-na2.hsforms.com/1NiS4r9lsSqGcuNBB77DeEQ40s9fk')
    expect(partnerLink).toHaveAttribute('target', '_blank')
    expect(partnerLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(partnerLink.querySelector('.i-ri-external-link-line')).toHaveClass('size-3')
    expect(partnerLink.querySelector('.i-ri-arrow-right-up-line')).not.toBeInTheDocument()
    expect(screen.getByText('|')).toHaveClass('text-divider-regular')
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
          parters: [{ plugin_id: 'misspelled-partner-plugin', name: 'Misspelled Partner Plugin' }] as Plugin[],
        }}
      />,
    )

    expect(screen.queryByRole('link', { name: 'plugin.marketplace.becomePartner' })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Scroll right' })).toBeInTheDocument()
    const carousel = screen.getByRole('region')
    const carouselViewport = carousel.querySelector('.overflow-hidden')
    const carouselContent = carouselViewport?.firstElementChild
    expect(carousel).not.toHaveClass('overflow-hidden')
    expect(carouselViewport).toHaveClass('overflow-hidden', '[border-radius:inherit]')
    expect(carouselContent).toHaveStyle({ columnGap: '12px' })
  })
})

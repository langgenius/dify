import type { MarketplaceCollection } from '../../types'
import type { Plugin } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ListWithCollection from '../list-with-collection'

const mockMoreClick = vi.fn()

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
  useLocale: () => 'en-US',
}))

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
})

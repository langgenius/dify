import type {
  MarketplaceTemplate,
  MarketplaceTemplateCollection,
} from '@dify/contracts/marketplace'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import TemplateCollectionList from '../template-collection-list'

vi.mock('../template-card', () => ({
  default: ({ template }: { template: MarketplaceTemplate }) => (
    <div data-testid="template-card">{template.template_name}</div>
  ),
}))

vi.mock('@/utils/marketplace-site-track', () => ({
  trackMarketplaceSiteEvent: vi.fn(),
}))

const partnerCollection: MarketplaceTemplateCollection = {
  name: 'partners',
  label: { en_US: 'Partners' },
  description: { en_US: 'Partner templates' },
  searchable: false,
  search_params: {},
  priority: 0,
}

const featuredCollection: MarketplaceTemplateCollection = {
  name: 'featured',
  label: { en_US: 'Featured' },
  description: { en_US: 'Featured templates' },
  searchable: false,
  search_params: {},
  priority: 1,
}

const buildTemplates = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    template_name: `${prefix} ${index}`,
    overview: 'Template',
    icon: '📄',
    icon_background: '#fff',
    icon_file_key: '',
    publisher_unique_handle: 'dify',
    usage_count: 10,
    categories: ['marketing'],
  })) as MarketplaceTemplate[]

describe('TemplateCollectionList carousel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps carousel navigation for non-partner collections that exceed two rows', () => {
    render(
      <TemplateCollectionList
        becomePartnerText="Become a Partner"
        collections={[featuredCollection]}
        locale="en-US"
        partnerText="Verified"
        templatesByCollection={{ featured: buildTemplates('Featured', 9) }}
        viewMoreText="View more"
      />,
    )

    expect(
      screen.getByRole('button', { name: 'plugin.marketplace.carousel.scrollNext' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Featured' })).toBeInTheDocument()
  })

  it('keeps carousel navigation for partner collections that exceed two rows', () => {
    render(
      <TemplateCollectionList
        becomePartnerText="Become a Partner"
        collections={[partnerCollection]}
        locale="en-US"
        partnerText="Verified"
        templatesByCollection={{ partners: buildTemplates('Partner', 9) }}
        viewMoreText="View more"
      />,
    )

    expect(
      screen.getByRole('button', { name: 'plugin.marketplace.carousel.scrollNext' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Partners' })).toBeInTheDocument()
  })
})

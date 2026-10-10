import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { Plugin } from '@/app/components/plugins/types'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import ListWithCollection from '../list-with-collection'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  const translations: Record<string, string> = {
    'marketplace.becomePartner': 'Torne-se um parceiro',
    'marketplace.carousel.scrollPrevious': 'Previous',
  }

  return {
    useLocale: () => 'en-US',
    useTranslation: () => ({
      t: withSelectorKey((key: string) => translations[key] ?? key),
    }),
  }
})

vi.mock('@/i18n/metadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/metadata')>()),
  getPluginLanguage: (locale: string) => locale,
}))

vi.mock('../../atoms', () => ({
  useMarketplaceMoreClick: () => vi.fn(),
}))

vi.mock('../card-wrapper', () => ({
  default: ({ plugin }: { plugin: Plugin }) => <div>{plugin.name}</div>,
}))

vi.mock('@/utils/marketplace-site-track', () => ({
  trackMarketplaceSiteEvent: vi.fn(),
}))

const partnerCollection: MarketplaceCollection = {
  name: 'partners',
  label: { 'en-US': 'Partners' },
  description: { 'en-US': 'Plugins verified by Dify partners.' },
  rule: 'partners',
  created_at: '',
  updated_at: '',
  searchable: false,
  search_params: {},
}

const partnerPlugins = Array.from({ length: 9 }, (_, index) => ({
  plugin_id: `partner-${index}`,
  name: `Partner plugin ${index}`,
})) as Plugin[]

describe('Partner collection header layout', () => {
  it('keeps a long mobile call to action clear of carousel controls at a 320px viewport', async () => {
    await page.viewport(320, 844)
    const screen = await render(
      <div data-marketplace-standalone style={{ width: 280 }}>
        <ListWithCollection
          marketplaceCollections={[partnerCollection]}
          marketplaceCollectionPluginsMap={{ partners: partnerPlugins }}
        />
      </div>,
    )

    const titleRect = screen
      .getByText('Partners', { exact: true })
      .element()
      .getBoundingClientRect()
    const descriptionRect = screen
      .getByText('Plugins verified by Dify partners.')
      .element()
      .getBoundingClientRect()
    const partnerLinkRect = screen
      .getByRole('link', { name: 'Torne-se um parceiro' })
      .element()
      .getBoundingClientRect()
    const previousButtonRect = screen
      .getByRole('button', { name: 'Previous' })
      .element()
      .getBoundingClientRect()

    expect(previousButtonRect.left - partnerLinkRect.right).toBeGreaterThanOrEqual(8)
    expect(descriptionRect.top).toBeGreaterThanOrEqual(
      Math.max(titleRect.bottom, partnerLinkRect.bottom),
    )
  })
})

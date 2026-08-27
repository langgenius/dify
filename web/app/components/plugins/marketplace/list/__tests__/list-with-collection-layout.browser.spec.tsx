import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { Plugin } from '@/app/components/plugins/types'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import ListWithCollection from '../list-with-collection'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  const translations: Record<string, string> = {
    'marketplace.becomePartner': 'Become a Partner',
    'marketplace.carousel.scrollPrevious': 'Previous',
  }

  return {
    useLocale: () => 'en-US',
    useTranslation: () => ({
      t: withSelectorKey((key: string) => translations[key] ?? key),
    }),
  }
})

vi.mock('@/i18n-config/language', () => ({
  getLanguage: (locale: string) => locale,
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

const renderPartnerCollection = ({
  pluginCount = 9,
  standalone = true,
}: {
  pluginCount?: number
  standalone?: boolean
} = {}) =>
  render(
    <div
      data-testid="collection-shell"
      data-marketplace-standalone={standalone || undefined}
      style={{ width: 350 }}
    >
      <ListWithCollection
        marketplaceCollections={[partnerCollection]}
        marketplaceCollectionPluginsMap={{ partners: partnerPlugins.slice(0, pluginCount) }}
      />
    </div>,
  )

describe('Partner collection header layout', () => {
  it('keeps the mobile call to action beside the title and clear of carousel controls', async () => {
    await page.viewport(390, 844)
    const screen = await renderPartnerCollection()

    const title = screen.getByText('Partners', { exact: true }).element()
    const description = screen.getByText('Plugins verified by Dify partners.').element()
    const separator = screen.getByText('|').element()
    const partnerLink = screen.getByRole('link', { name: 'Become a Partner' }).element()
    const previousButton = screen.getByRole('button', { name: 'Previous' }).element()

    const titleRect = title.getBoundingClientRect()
    const descriptionRect = description.getBoundingClientRect()
    const partnerLinkRect = partnerLink.getBoundingClientRect()
    const previousButtonRect = previousButton.getBoundingClientRect()

    const titleCenter = titleRect.top + titleRect.height / 2
    const partnerLinkCenter = partnerLinkRect.top + partnerLinkRect.height / 2

    expect(Math.abs(titleCenter - partnerLinkCenter)).toBeLessThanOrEqual(2)
    expect(partnerLinkRect.left).toBeGreaterThan(titleRect.right)
    expect(previousButtonRect.left - partnerLinkRect.right).toBeGreaterThanOrEqual(8)
    expect(previousButtonRect.left - partnerLinkRect.right).toBeLessThanOrEqual(16)
    expect(descriptionRect.top).toBeGreaterThanOrEqual(
      Math.max(titleRect.bottom, partnerLinkRect.bottom),
    )
    expect(getComputedStyle(separator).display).toBe('none')
  })

  it('right-aligns the mobile action without reserving space when navigation is absent', async () => {
    await page.viewport(390, 844)
    const screen = await renderPartnerCollection({ pluginCount: 2 })

    const shellRect = screen.getByTestId('collection-shell').element().getBoundingClientRect()
    const partnerLinkRect = screen
      .getByRole('link', { name: 'Become a Partner' })
      .element()
      .getBoundingClientRect()

    expect(shellRect.right - partnerLinkRect.right).toBeCloseTo(0)
    expect(screen.getByRole('button', { name: 'Previous' }).query()).toBeNull()
  })

  it('preserves the narrow embedded metadata row', async () => {
    await page.viewport(390, 844)
    const screen = await renderPartnerCollection({ standalone: false })

    const shellRect = screen.getByTestId('collection-shell').element().getBoundingClientRect()
    const descriptionRect = screen
      .getByText('Plugins verified by Dify partners.')
      .element()
      .getBoundingClientRect()
    const partnerLinkRect = screen
      .getByRole('link', { name: 'Become a Partner' })
      .element()
      .getBoundingClientRect()

    expect(Math.abs(descriptionRect.top - partnerLinkRect.top)).toBeLessThanOrEqual(2)
    expect(partnerLinkRect.right).toBeLessThanOrEqual(shellRect.right)
    expect(getComputedStyle(screen.getByText('|').element()).display).not.toBe('none')
  })

  it('preserves the desktop title and metadata rows', async () => {
    await page.viewport(1280, 900)
    const screen = await render(
      <div className="w-[1200px]" data-marketplace-standalone>
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
    const separator = screen.getByText('|').element()
    const partnerLinkRect = screen
      .getByRole('link', { name: 'Become a Partner' })
      .element()
      .getBoundingClientRect()

    expect(descriptionRect.top).toBeGreaterThanOrEqual(titleRect.bottom)
    expect(Math.abs(descriptionRect.top - partnerLinkRect.top)).toBeLessThanOrEqual(2)
    expect(getComputedStyle(separator).display).not.toBe('none')
  })
})

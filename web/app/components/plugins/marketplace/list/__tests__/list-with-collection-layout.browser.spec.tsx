import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { Plugin } from '@/app/components/plugins/types'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import ListWithCollection from '../list-with-collection'

const mockState = vi.hoisted(() => ({
  becomePartnerText: 'Become a Partner',
}))

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  const translations: Record<string, string> = {
    'marketplace.carousel.scrollPrevious': 'Previous',
  }

  return {
    useLocale: () => 'en-US',
    useTranslation: () => ({
      t: withSelectorKey((key: string) =>
        key === 'marketplace.becomePartner'
          ? mockState.becomePartnerText
          : (translations[key] ?? key),
      ),
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
  width = 350,
}: {
  pluginCount?: number
  standalone?: boolean
  width?: number
} = {}) =>
  render(
    <div
      data-testid="collection-shell"
      data-marketplace-standalone={standalone || undefined}
      style={{ width }}
    >
      <ListWithCollection
        marketplaceCollections={[partnerCollection]}
        marketplaceCollectionPluginsMap={{ partners: partnerPlugins.slice(0, pluginCount) }}
      />
    </div>,
  )

const getTextRect = (element: Element) => {
  const range = document.createRange()
  range.selectNodeContents(element)
  return range.getBoundingClientRect()
}

describe('Partner collection header layout', () => {
  beforeEach(() => {
    mockState.becomePartnerText = 'Become a Partner'
  })

  it('keeps the mobile call to action beside the title and clear of carousel controls', async () => {
    await page.viewport(390, 844)
    const screen = await renderPartnerCollection()

    const title = screen.getByText('Partners', { exact: true }).element()
    const description = screen.getByText('Plugins verified by Dify partners.').element()
    const separator = screen.getByText('|').element()
    const partnerLink = screen.getByRole('link', { name: 'Become a Partner' }).element()
    const previousButton = screen.getByRole('button', { name: 'Previous' }).element()

    const titleRect = getTextRect(title)
    const descriptionRect = description.getBoundingClientRect()
    const partnerLinkRect = partnerLink.getBoundingClientRect()
    const previousButtonRect = previousButton.getBoundingClientRect()

    const titleCenter = titleRect.top + titleRect.height / 2
    const partnerLinkCenter = partnerLinkRect.top + partnerLinkRect.height / 2

    expect(Math.abs(titleCenter - partnerLinkCenter)).toBeLessThanOrEqual(2)
    expect(partnerLinkRect.left - titleRect.right).toBeCloseTo(12, 0)
    expect(previousButtonRect.left - partnerLinkRect.right).toBeGreaterThanOrEqual(8)
    expect(descriptionRect.top).toBeGreaterThanOrEqual(
      Math.max(titleRect.bottom, partnerLinkRect.bottom),
    )
    expect(getComputedStyle(separator).display).toBe('none')
  })

  it('keeps the mobile action 12px from the title when navigation is absent', async () => {
    await page.viewport(390, 844)
    const screen = await renderPartnerCollection({ pluginCount: 2 })

    const shellRect = screen.getByTestId('collection-shell').element().getBoundingClientRect()
    const titleRect = getTextRect(screen.getByText('Partners', { exact: true }).element())
    const partnerLinkRect = screen
      .getByRole('link', { name: 'Become a Partner' })
      .element()
      .getBoundingClientRect()

    expect(partnerLinkRect.left - titleRect.right).toBeCloseTo(12, 0)
    expect(partnerLinkRect.right).toBeLessThanOrEqual(shellRect.right)
    expect(screen.getByRole('button', { name: 'Previous' }).query()).toBeNull()
  })

  it('keeps the mobile action clear of navigation at a 320px viewport', async () => {
    await page.viewport(320, 844)
    mockState.becomePartnerText = 'Torne-se um parceiro'
    const screen = await renderPartnerCollection({ width: 280 })

    const titleRect = getTextRect(screen.getByText('Partners', { exact: true }).element())
    const partnerLinkRect = screen
      .getByRole('link', { name: 'Torne-se um parceiro' })
      .element()
      .getBoundingClientRect()
    const previousButtonRect = screen
      .getByRole('button', { name: 'Previous' })
      .element()
      .getBoundingClientRect()

    expect(partnerLinkRect.left - titleRect.right).toBeCloseTo(12, 0)
    expect(previousButtonRect.left - partnerLinkRect.right).toBeGreaterThanOrEqual(8)
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

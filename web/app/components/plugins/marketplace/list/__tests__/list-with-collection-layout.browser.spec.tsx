import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { Plugin } from '@/app/components/plugins/types'
import { DirectionProvider } from '@langgenius/dify-ui/direction-provider'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import Carousel from '../carousel'
import ListWithCollection from '../list-with-collection'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  const translations: Record<string, string> = {
    'marketplace.becomePartner': 'Torne-se um parceiro',
    'marketplace.carousel.scrollPrevious': 'Previous',
    'marketplace.carousel.scrollNext': 'Next',
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
  it.each(['ltr', 'rtl'] as const)(
    'keeps the mobile call to action clear of carousel controls in %s',
    async (direction) => {
      await page.viewport(320, 844)
      const screen = await render(
        <DirectionProvider direction={direction}>
          <div dir={direction} data-marketplace-standalone style={{ width: 280 }}>
            <ListWithCollection
              marketplaceCollections={[partnerCollection]}
              marketplaceCollectionPluginsMap={{ partners: partnerPlugins }}
            />
          </div>
        </DirectionProvider>,
      )

      await expect.element(screen.getByRole('button', { name: 'Previous' })).toBeVisible()
      await expect.element(screen.getByRole('link', { name: 'Torne-se um parceiro' })).toBeVisible()
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

      const gap =
        direction === 'ltr'
          ? previousButtonRect.left - partnerLinkRect.right
          : partnerLinkRect.left - previousButtonRect.right
      expect(gap).toBeGreaterThanOrEqual(8)
      expect(descriptionRect.top).toBeGreaterThanOrEqual(
        Math.max(titleRect.bottom, partnerLinkRect.bottom),
      )
    },
  )
})

describe('Marketplace carousel direction', () => {
  it.each(['ltr', 'rtl'] as const)(
    'keeps the next and previous pages inside the viewport in %s',
    async (direction) => {
      // Real Embla transforms can place an ARIA-visible slide outside the viewport.
      const screen = await render(
        <DirectionProvider direction={direction}>
          <div dir={direction} style={{ width: 280, paddingTop: 48 }}>
            <Carousel
              ariaLabel="Featured plugins"
              pages={Array.from({ length: 3 }, (_, index) => ({
                id: `page-${index}`,
                content: <button type="button">Plugin {index + 1}</button>,
              }))}
            />
          </div>
        </DirectionProvider>,
      )
      const carousel = screen.getByRole('region', { name: 'Featured plugins' })
      for (const [action, pageNumber] of [
        ['Next', 2],
        ['Previous', 1],
      ] as const) {
        await screen.getByRole('button', { name: action, exact: true }).click()
        const slide = screen.getByRole('group', { name: `${pageNumber} / 3` })
        await expect.element(slide).toBeVisible()
        await expect
          .poll(() => {
            const viewport = carousel.element().getBoundingClientRect()
            const selected = slide.element().getBoundingClientRect()
            return selected.left >= viewport.left - 1 && selected.right <= viewport.right + 1
          })
          .toBe(true)
      }
    },
  )
})

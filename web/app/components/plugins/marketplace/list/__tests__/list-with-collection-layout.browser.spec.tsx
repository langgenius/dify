import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { Plugin } from '@/app/components/plugins/types'
import { DirectionProvider } from '@langgenius/dify-ui/direction-provider'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import plugin from '@/i18n/locales/en-US/plugin.json'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import Carousel from '../carousel'
import ListWithCollection from '../list-with-collection'

vi.unmock('react-i18next')

async function renderWithProviders(node: React.ReactNode) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { plugin } },
  })
  const { wrapper: UrlState } = createNuqsTestWrapper({ hasMemory: true })
  return render(
    <I18nextProvider i18n={i18n}>
      <UrlState>{node}</UrlState>
    </I18nextProvider>,
  )
}

const partnerCollection: MarketplaceCollection = {
  name: 'partners',
  label: { en_US: 'Partners' },
  description: { en_US: 'Plugins verified by Dify partners.' },
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
      const screen = await renderWithProviders(
        <DirectionProvider direction={direction}>
          <div dir={direction} data-marketplace-standalone style={{ width: 280 }}>
            <ListWithCollection
              marketplaceCollections={[partnerCollection]}
              marketplaceCollectionPluginsMap={{ partners: partnerPlugins }}
              cardRender={(plugin) => <div>{plugin.name}</div>}
              onCollectionMoreClick={vi.fn()}
            />
          </div>
        </DirectionProvider>,
      )

      await expect.element(screen.getByRole('button', { name: 'Previous page' })).toBeVisible()
      await expect.element(screen.getByRole('link', { name: 'Become a Partner' })).toBeVisible()
      const titleRect = screen
        .getByText('Partners', { exact: true })
        .element()
        .getBoundingClientRect()
      const descriptionRect = screen
        .getByText('Plugins verified by Dify partners.')
        .element()
        .getBoundingClientRect()
      const partnerLinkRect = screen
        .getByRole('link', { name: 'Become a Partner' })
        .element()
        .getBoundingClientRect()
      const previousButtonRect = screen
        .getByRole('button', { name: 'Previous page' })
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
      const screen = await renderWithProviders(
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
        ['Next page', 2],
        ['Previous page', 1],
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

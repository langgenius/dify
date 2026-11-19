import type {
  MarketplaceTemplate,
  MarketplaceTemplateCollection,
} from '@dify/contracts/marketplace'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import TemplateCollectionList from '../template-collection-list'

// boundary: template import navigation has no Next App Router in this browser page.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
// boundary: remote template documents stay local; the cards and their dialog stay real.
vi.mock('@/features/marketplace/links', async (importOriginal) => {
  const { localMarketplaceFrameLinks } = await import('@/test/marketplace-frame-links')
  return localMarketplaceFrameLinks(
    await importOriginal<typeof import('@/features/marketplace/links')>(),
  )
})

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

it.each([
  [featuredCollection, 'Featured'],
  [partnerCollection, 'Partner'],
] as const)(
  'exposes the final real card through the $0.name collection carousel',
  async (collection, prefix) => {
    await page.viewport(1280, 900)
    onTestFinished(guardUnexpectedFetch())
    const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: 'CLOUD' },
    })
    const screen = await render(
      <ConsoleProvider>
        <TemplateCollectionList
          becomePartnerText="Become a Partner"
          collections={[collection]}
          locale="en-US"
          partnerText="Verified"
          templatesByCollection={{ [collection.name]: buildTemplates(prefix, 9) }}
          viewMoreText="View more"
        />
      </ConsoleProvider>,
    )
    const carousel = screen.getByRole('region', { name: collection.label.en_US! })
    const next = carousel.getByRole('button', { name: 'plugin.marketplace.carousel.scrollNext' })
    await next.click()
    const last = carousel.getByRole('button', { name: `${prefix} 8`, exact: true })
    await expect.element(last).toBeVisible()
    await expect
      .poll(() => {
        const bounds = last.element().getBoundingClientRect()
        const viewport = carousel.element().getBoundingClientRect()
        return bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1
      })
      .toBe(true)
    await userEvent.tab()
    await expect.element(last).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect
      .element(screen.getByRole('dialog', { name: new RegExp(`${prefix} 8`) }))
      .toBeVisible()
  },
)

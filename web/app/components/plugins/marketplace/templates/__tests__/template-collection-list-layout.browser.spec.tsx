import type {
  MarketplaceTemplate,
  MarketplaceTemplateCollection,
} from '@dify/contracts/marketplace'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import TemplateCollectionList from '../template-collection-list'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useLocale: () => 'en-US',
    useTranslation: () => ({
      t: withSelectorKey((key: string) =>
        key === 'marketplace.carousel.scrollPrevious' ? 'Previous' : key,
      ),
    }),
  }
})

vi.mock('../template-card', () => ({
  default: ({ template }: { template: MarketplaceTemplate }) => <div>{template.template_name}</div>,
}))

const partnerCollection: MarketplaceTemplateCollection = {
  name: 'partners',
  label: { en_US: 'Partners' },
  description: { en_US: 'Plugins verified by Dify partners.' },
  searchable: false,
  search_params: {},
  priority: 0,
}

const partnerTemplates = Array.from({ length: 9 }, (_, index) => ({
  id: `template-${index}`,
  template_name: `Partner template ${index}`,
  overview: 'Partner template',
  icon: '📄',
  icon_background: '#fff',
  icon_file_key: '',
  publisher_unique_handle: 'dify',
  usage_count: 10,
  categories: ['marketing'],
})) as MarketplaceTemplate[]

const renderPartnerCollection = ({
  templateCount = 9,
  standalone = true,
  width = 350,
}: {
  templateCount?: number
  standalone?: boolean
  width?: number
} = {}) =>
  render(
    <div
      data-testid="collection-shell"
      data-marketplace-standalone={standalone || undefined}
      style={{ width }}
    >
      <TemplateCollectionList
        becomePartnerText="Become a Partner"
        collections={[partnerCollection]}
        locale="en-US"
        partnerText="Verified"
        templatesByCollection={{ partners: partnerTemplates.slice(0, templateCount) }}
        viewMoreText="View more"
      />
    </div>,
  )

const getTextRect = (element: Element) => {
  const range = document.createRange()
  range.selectNodeContents(element)
  return range.getBoundingClientRect()
}

describe('Template partner collection header layout', () => {
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

  it('preserves the desktop title and metadata rows', async () => {
    await page.viewport(1280, 900)
    const screen = await render(
      <div className="w-[1200px]" data-marketplace-standalone>
        <TemplateCollectionList
          becomePartnerText="Become a Partner"
          collections={[partnerCollection]}
          locale="en-US"
          partnerText="Verified"
          templatesByCollection={{ partners: partnerTemplates }}
          viewMoreText="View more"
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
      .getByRole('link', { name: 'Become a Partner' })
      .element()
      .getBoundingClientRect()

    expect(descriptionRect.top).toBeGreaterThanOrEqual(titleRect.bottom)
    expect(Math.abs(descriptionRect.top - partnerLinkRect.top)).toBeLessThanOrEqual(2)
    expect(getComputedStyle(screen.getByText('|').element()).display).not.toBe('none')
  })
})

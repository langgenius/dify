import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import enCommon from '@/i18n/locales/en-US/common.json'
import enPlugin from '@/i18n/locales/en-US/plugin.json'
import zhCommon from '@/i18n/locales/zh-Hans/common.json'
import zhPlugin from '@/i18n/locales/zh-Hans/plugin.json'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import Description from '../index'

vi.unmock('react-i18next')

async function renderDescription(locale: 'en-US' | 'zh-Hans', platform = false) {
  const i18n = createInstance()
  await i18n.init({
    lng: locale,
    keySeparator: false,
    resources: {
      'en-US': { common: enCommon, plugin: enPlugin },
      'zh-Hans': { common: zhCommon, plugin: zhPlugin },
    },
  })
  const { wrapper: UrlState } = createNuqsTestWrapper()
  return render(
    <I18nextProvider i18n={i18n}>
      <UrlState>
        <Description
          isMarketplacePlatform={platform}
          marketplaceNav={
            <nav aria-label="Marketplace navigation">
              <a href="/marketplace">Marketplace</a>
            </nav>
          }
        />
      </UrlState>
    </I18nextProvider>,
  )
}

it.each([
  ['en-US', enPlugin, enCommon],
  ['zh-Hans', zhPlugin, zhCommon],
] as const)(
  'renders the localized marketplace sentence in %s reading order',
  async (locale, plugin, common) => {
    await page.viewport(1280, 800)
    const screen = await renderDescription(locale)
    await expect
      .element(screen.getByRole('heading', { level: 1 }))
      .toHaveTextContent(plugin['marketplace.empower'])
    const sentence = screen.getByRole('heading', { level: 2 })
    const categories = [
      'models',
      'tools',
      'datasources',
      'triggers',
      'agents',
      'extensions',
    ] as const
    const categoryText = categories.map((category) => plugin[`category.${category}`]).join(',')
    const discovery = `${plugin['marketplace.discover']}${categoryText}${plugin['marketplace.and']}${plugin['category.bundles']}`
    const marketplace = `${common['operation.in']}${plugin['marketplace.difyMarketplace']}`
    // Ignore decorative whitespace; the actual translation and reading order remain the contract.
    expect(sentence.element().textContent?.replace(/\s/g, '')).toBe(
      (locale === 'zh-Hans' ? marketplace + discovery : discovery + marketplace).replace(/\s/g, ''),
    )
  },
)

it('renders the platform hero and the supplied navigation with real translations', async () => {
  const screen = await renderDescription('en-US', true)
  await expect
    .element(
      screen.getByRole('heading', { level: 1, name: enPlugin['marketplace.pluginsHeroTitle'] }),
    )
    .toBeVisible()
  await expect
    .element(
      screen.getByRole('heading', { level: 2, name: enPlugin['marketplace.pluginsHeroSubtitle'] }),
    )
    .toBeVisible()
  await expect
    .element(screen.getByRole('navigation', { name: 'Marketplace navigation' }))
    .toBeVisible()
})

import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import navigation from '@/i18n/locales/en-US/navigation.json'
import plugin from '@/i18n/locales/en-US/plugin.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import HomeCatalogNavigation from '../home-catalog-navigation'
import HomeCatalogTabs from '../home-catalog-tabs'
import HomeHeader from '../home-header'
import HomeHero from '../home-hero'
import { HomeStickyStateProvider } from '../home-sticky-state-provider'

const boundaries = vi.hoisted(() => ({ marketplaceUrlPrefix: 'https://marketplace.dify.ai' }))

vi.unmock('react-i18next')

// boundary: Marketplace deployment URL configuration is injected at build time.
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      get NEXT_PUBLIC_MARKETPLACE_URL_PREFIX() {
        return boundaries.marketplaceUrlPrefix
      },
    },
  }
})

async function renderChrome(node: React.ReactNode) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { navigation, plugin } },
  })
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'COMMUNITY' },
  })
  return render(
    <ConsoleProvider>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </ConsoleProvider>,
  )
}

describe('Marketplace home chrome', () => {
  beforeEach(async () => {
    await page.viewport(1280, 800)
    boundaries.marketplaceUrlPrefix = 'https://marketplace.dify.ai'
    vi.clearAllMocks()
  })

  it('keeps localized catalog navigation and the standalone guide keyboard reachable', async () => {
    const screen = await renderChrome(
      <TooltipProvider delay={0} closeDelay={0}>
        <HomeStickyStateProvider>
          <button type="button">Before header</button>
          <HomeHeader
            activeTab="templates"
            catalogLabels={{ plugins: '插件', templates: '模板' }}
            isMarketplacePlatform
            language="zh-Hans"
          />
          <HomeHero
            isMarketplacePlatform
            title="Discover templates"
            subtitle="Start faster with ready-to-use workflows."
          />
          <HomeCatalogNavigation
            isMarketplacePlatform
            catalogCategories={<nav aria-label="Template categories">Template categories</nav>}
            catalogTabs={
              <HomeCatalogTabs
                activeTab="templates"
                isMarketplacePlatform
                labels={{ plugins: '插件', templates: '模板' }}
                language="zh-Hans"
              />
            }
          />
        </HomeStickyStateProvider>
      </TooltipProvider>,
    )

    await expect.element(screen.getByRole('heading', { name: 'Discover templates' })).toBeVisible()
    await expect
      .element(screen.getByText('Start faster with ready-to-use workflows.'))
      .toBeVisible()
    await expect
      .element(screen.getByRole('navigation', { name: 'Template categories' }))
      .toBeVisible()

    const header = screen.getByRole('banner')
    await expect
      .element(header.getByRole('link', { name: 'Dify Marketplace' }))
      .toHaveAttribute('href', '/')
    const headerTemplate = header.getByRole('link', { name: '模板', includeHidden: true })
    await expect.element(headerTemplate).toHaveAttribute('href', '/templates?language=zh-Hans')
    await expect.element(headerTemplate).toHaveAttribute('aria-current', 'page')
    await expect
      .element(
        screen.getByRole('navigation', { name: 'Marketplace' }).getByRole('link', {
          name: '模板',
        }),
      )
      .toBeVisible()
    await expect
      .element(header.getByRole('link', { name: 'Creator Center' }))
      .toHaveAttribute('href', 'https://creators.dify.ai/')

    const before = screen.getByRole('button', { name: 'Before header' })
    await before.click()
    await userEvent.tab()
    await expect.element(header.getByRole('link', { name: 'Dify Marketplace' })).toHaveFocus()
    await userEvent.tab()
    await expect.element(header.getByRole('link', { name: 'Creator Center' })).toHaveFocus()
    await userEvent.tab()
    const guide = header.getByRole('button', { name: 'Guide' })
    await expect.element(guide).toHaveFocus()
    await expect.element(screen.getByRole('tooltip')).toHaveTextContent('Guide')

    await userEvent.keyboard('{Enter}')
    const menu = screen.getByRole('menu')
    await expect.element(menu).toBeVisible()
    await expect
      .element(menu.getByRole('menuitem', { name: 'Integration development guide' }))
      .toHaveAttribute(
        'href',
        'https://docs.dify.ai/en/develop-plugin/getting-started/getting-started-dify-plugin',
      )
    await expect.element(screen.getByRole('tooltip')).not.toBeInTheDocument()
  })

  it('keeps console navigation local and uses the deployment-aware guide after reopen', async () => {
    const screen = await renderChrome(
      <TooltipProvider delay={0} closeDelay={0}>
        <HomeStickyStateProvider>
          <HomeHeader activeTab={null} isMarketplacePlatform={false} />
          <HomeCatalogNavigation
            isMarketplacePlatform={false}
            catalogCategories={<nav aria-label="Plugin categories">Plugin categories</nav>}
            catalogTabs={<HomeCatalogTabs activeTab={null} isMarketplacePlatform={false} />}
          />
        </HomeStickyStateProvider>
      </TooltipProvider>,
    )
    const header = screen.getByRole('banner')
    await expect
      .element(header.getByRole('link', { name: 'Dify Marketplace' }))
      .toHaveAttribute('href', '/marketplace')
    for (const link of header.getByRole('navigation').getByRole('link').all())
      await expect.element(link).not.toHaveAttribute('aria-current')

    const guide = header.getByRole('button', { name: 'Guide' })
    await guide.click()
    await expect
      .element(screen.getByRole('menuitem', { name: 'Integration development guide' }))
      .toHaveAttribute(
        'href',
        'https://docs.dify.ai/en/develop-plugin/getting-started/getting-started-dify-plugin',
      )
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(guide).toHaveFocus()

    await guide.click()
    await expect
      .element(screen.getByRole('menuitem', { name: 'Integration development guide' }))
      .toHaveAttribute(
        'href',
        'https://docs.dify.ai/en/develop-plugin/getting-started/getting-started-dify-plugin',
      )
  })
})

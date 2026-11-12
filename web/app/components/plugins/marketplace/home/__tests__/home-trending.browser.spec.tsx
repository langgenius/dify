import type { PluginBanner } from '@dify/contracts/marketplace'
import type { i18n as I18n } from 'i18next'
import { DirectionProvider } from '@langgenius/dify-ui/direction-provider'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { trackEvent } from '@/app/components/base/amplitude'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import plugin from '@/i18n/locales/en-US/plugin.json'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import HomeTrending from '../home-trending'

// boundary: banner analytics stop at the telemetry adapter.
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

vi.unmock('react-i18next')

// boundary: Next's app router is unavailable in the standalone Vitest browser page.
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// boundary: plugin detail hydration stops at the external Marketplace HTTP client.
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  fetchPluginInfoFromMarketPlace: vi
    .fn<typeof import('@/service/plugins').fetchPluginInfoFromMarketPlace>()
    .mockImplementation(async ({ org, name }) => ({
      data: {
        version: { version: '1.0.0' },
        plugin: {
          category: 'tool',
          latest_package_identifier: `${org}/${name}:1.0.0`,
          latest_version: '1.0.0',
        },
      },
    })),
}))

// boundary: installed-plugin reads stop at the generated console transport.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
    }),
  }
})

// boundary: remote Marketplace documents stay local while preserving their real query parameters.
vi.mock('@/features/marketplace/links', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/marketplace/links')>()
  const toBlank = (url: string) =>
    `about:blank${new URL(url, 'https://marketplace.example.test').search}`
  return {
    ...actual,
    marketplaceLinks: {
      ...actual.marketplaceLinks,
      plugin: (...args: Parameters<typeof actual.marketplaceLinks.plugin>) =>
        toBlank(actual.marketplaceLinks.plugin(...args)),
      template: (...args: Parameters<typeof actual.marketplaceLinks.template>) =>
        toBlank(actual.marketplaceLinks.template(...args)),
    },
  }
})

const banners: PluginBanner[] = [
  {
    id: 'recommend',
    style_type: 'recommend',
    title: 'Trending',
    sort: 0,
    language: 'en',
    content: {
      theme_type: 'hottest',
      heading: 'Popular plugins',
      description: 'Chosen from real usage.',
      cards: [
        {
          item_type: 'plugin',
          item_id: 'langgenius/dropbox',
          display_name: 'Dropbox',
          icon_url: '/api/v1/plugins/langgenius/dropbox/icon',
          creator: 'langgenius',
          badges: ['partner', 'verified'],
          link: '/plugins/langgenius/dropbox',
          card_position: 0,
          auto_batch_id: '11111111-1111-4111-8111-111111111111',
        },
        {
          item_type: 'plugin',
          item_id: 'langgenius/zapier',
          display_name: 'Zapier',
          link: '/plugins/langgenius/zapier',
          card_position: 1,
        },
      ],
    },
  },
  {
    id: 'blog',
    style_type: 'blog',
    title: 'Dify Updates',
    sort: 1,
    language: 'en',
    content: {
      blog_title: 'Dify v1.9 new launch',
      subtitle: 'New Agent node support',
      description: 'Build agent workflows with the new Agent node.',
      cover_image: '/api/v1/banners/images/banners/blog-cover.png',
      link: 'https://dify.ai/blog',
      link_target_type: 'blog',
    },
  },
  {
    id: 'event',
    style_type: 'event',
    title: 'Duck Duck Go',
    sort: 2,
    language: 'en',
    content: {
      images: {
        desktop: '/api/v1/banners/images/banners/duckduckgo.png',
        mobile: '/api/v1/banners/images/banners/duckduckgo-mobile.png',
      },
      link: 'https://marketplace.dify.ai/plugin/langgenius/duckduckgo',
      alt_text: 'DuckDuckGo plugin',
    },
  },
]

const mixedRecommendations: PluginBanner = {
  id: 'mixed',
  style_type: 'recommend',
  title: 'Trending',
  sort: 0,
  language: 'en',
  content: {
    theme_type: 'newest',
    cards: [
      {
        item_type: 'plugin',
        item_id: 'langgenius/dropbox',
        display_name: 'Dropbox',
        link: '',
        card_position: 0,
      },
      {
        item_type: 'template',
        item_id: 'tpl-1',
        display_name: 'Support Bot',
        creator: 'aisa-team',
        link: '',
        card_position: 1,
      },
    ],
  },
}

let i18n: I18n

const withI18n = (node: React.ReactNode) => <I18nextProvider i18n={i18n}>{node}</I18nextProvider>

async function renderTrending(
  props: {
    banners?: PluginBanner[]
    direction?: 'ltr' | 'rtl'
    edition?: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE'
    isMarketplacePlatform?: boolean
  } = {},
) {
  const {
    banners: items = banners,
    direction = 'ltr',
    edition = 'CLOUD',
    isMarketplacePlatform = true,
  } = props
  const { queryClient, wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: edition },
  })
  seedModelProviderQueries(queryClient)
  return render(
    withI18n(
      <ConsoleProvider>
        <button type="button">Before carousel</button>
        <DirectionProvider direction={direction}>
          <div dir={direction}>
            <HomeTrending
              banners={items}
              isMarketplacePlatform={isMarketplacePlatform}
              page="plugins"
            />
          </div>
        </DirectionProvider>
        <button type="button">After carousel</button>
      </ConsoleProvider>,
    ),
  )
}

function expectSlideInsideCarousel(
  screen: Awaited<ReturnType<typeof renderTrending>>,
  name: string,
) {
  return expect
    .poll(() => {
      const viewport = getCarousel(screen).element().getBoundingClientRect()
      const slide = screen.getByRole('group', { name }).element().getBoundingClientRect()
      return slide.left >= viewport.left - 1 && slide.right <= viewport.right + 1
    })
    .toBe(true)
}

function getCarousel(screen: Awaited<ReturnType<typeof renderTrending>>) {
  const carousel = screen
    .getByRole('region', { name: 'The plugins everyone is installing' })
    .all()
    .find((locator) => locator.element().hasAttribute('data-home-trending-carousel-root'))
  if (!carousel) throw new Error('Trending carousel was not rendered')
  return carousel
}

describe('Marketplace home trending carousel', () => {
  beforeEach(async () => {
    await page.viewport(1200, 800)
    i18n = createInstance()
    await i18n.init({
      lng: 'en-US',
      keySeparator: false,
      resources: { 'en-US': { app, common, navigation, plugin } },
    })
    onTestFinished(guardUnexpectedFetch())
    document.documentElement.dataset.isMarketplace = ''
    window.__marketplaceTracking__ = {
      track: vi.fn(),
      rememberReferrer: vi.fn(),
      markSearch: vi.fn(),
      flushSearch: vi.fn(),
      markFilter: vi.fn(),
      flushFilter: vi.fn(),
    }
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete window.__marketplaceTracking__
    delete document.documentElement.dataset.isMarketplace
    vi.restoreAllMocks()
  })

  it('switches among delivered layouts and keeps only the selected slide visible', async () => {
    const screen = await renderTrending()
    const trending = screen.getByRole('group', { name: 'Trending' })
    const trendingElement = trending.element()
    await expect.element(screen.getByRole('heading', { name: 'Popular plugins' })).toBeVisible()
    await expect.element(trending.getByRole('link', { name: 'Dropbox' })).toBeVisible()
    await expectSlideInsideCarousel(screen, 'Trending')

    await screen.getByRole('button', { name: 'Dify Updates' }).click()
    const blog = screen.getByRole('group', { name: 'Dify Updates' })
    await expect.element(blog).toBeVisible()
    await expect.element(blog.getByRole('heading', { name: 'Dify v1.9 new launch' })).toBeVisible()
    await expectSlideInsideCarousel(screen, 'Dify Updates')
    const viewport = getCarousel(screen).element().getBoundingClientRect()
    const previousSlide = trendingElement.getBoundingClientRect()
    expect(
      previousSlide.right <= viewport.left + 1 || previousSlide.left >= viewport.right - 1,
    ).toBe(true)

    await screen.getByRole('button', { name: 'Duck Duck Go' }).click()
    await expect
      .element(screen.getByRole('link', { name: 'DuckDuckGo plugin' }))
      .toHaveAttribute('href', 'https://marketplace.dify.ai/plugin/langgenius/duckduckgo')
    await expectSlideInsideCarousel(screen, 'Duck Duck Go')
  })

  it('uses real hover and keyboard focus to pause announcements and lets Play resume in place', async () => {
    const screen = await renderTrending()
    const carousel = getCarousel(screen)
    const track = carousel.element().querySelector('[aria-live]')!
    expect(track).toHaveAttribute('aria-live', 'off')

    await carousel.hover()
    await expect.poll(() => track.getAttribute('aria-live')).toBe('polite')
    await screen.getByRole('button', { name: 'Pause' }).hover()
    await expect.poll(() => track.getAttribute('aria-live')).toBe('polite')
    await userEvent.unhover(carousel)
    await expect.poll(() => track.getAttribute('aria-live')).toBe('off')

    const second = screen.getByRole('button', { name: 'Dify Updates' })
    await second.click()
    await userEvent.unhover(carousel)
    await userEvent.tab({ shift: true })
    await expect.poll(() => track.getAttribute('aria-live')).toBe('polite')
    await userEvent.keyboard('{Enter}')
    await expect
      .element(screen.getByRole('button', { name: 'Trending' }))
      .toHaveAttribute('aria-current', 'true')

    const pause = screen.getByRole('button', { name: 'Pause' })
    await pause.click()
    const play = screen.getByRole('button', { name: 'Play' })
    await expect.element(play).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(screen.getByRole('button', { name: 'Pause' })).toHaveFocus()
    await expect.poll(() => track.getAttribute('aria-live')).toBe('off')
  })

  it('keeps reduced-motion autoplay stopped until the user explicitly starts it', async () => {
    const nativeMatchMedia = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const result = nativeMatchMedia(query)
      if (query !== '(prefers-reduced-motion: reduce)') return result
      return new Proxy(result, {
        get(target, property) {
          if (property === 'matches') return true
          const value = Reflect.get(target, property)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    })
    const screen = await renderTrending()
    const carousel = getCarousel(screen)
    const track = carousel.element().querySelector('[aria-live]')!

    const play = screen.getByRole('button', { name: 'Play' })
    await expect.element(play).toBeVisible()
    await play.click()
    await userEvent.unhover(carousel)

    await expect.element(screen.getByRole('button', { name: 'Pause' })).toBeVisible()
    await expect.poll(() => track.getAttribute('aria-live')).toBe('off')
  })

  it('does not treat a real mouse drag on a narrow viewport as a touch swipe', async () => {
    await page.viewport(390, 844)
    const screen = await renderTrending()
    const carousel = getCarousel(screen)
    const card = screen.getByRole('link', { name: 'Dropbox' })
    const cardClick = vi.fn((event: Event) => event.preventDefault())
    card.element().addEventListener('click', cardClick)

    await userEvent.pointer([
      { target: carousel, coords: { x: 300, y: 100 }, keys: '[MouseLeft>]' },
      { target: carousel, coords: { x: 80, y: 105 } },
      '[/MouseLeft]',
    ])

    await expect
      .element(screen.getByRole('button', { name: 'Trending' }))
      .toHaveAttribute('aria-current', 'true')
    expect(cardClick).not.toHaveBeenCalled()
  })

  it('opens and closes embedded plugin and template details through their real cards', async () => {
    const screen = await renderTrending({
      banners: [mixedRecommendations],
      isMarketplacePlatform: false,
    })

    await screen.getByRole('button', { name: 'Dropbox' }).click()
    const pluginDialog = screen.getByRole('dialog', { name: /Dropbox/ })
    await expect.element(pluginDialog).toBeVisible()
    await pluginDialog.getByRole('button', { name: 'Close' }).click()
    await expect.element(pluginDialog).not.toBeInTheDocument()

    await screen.getByRole('button', { name: 'Support Bot' }).click()
    const templateDialog = screen.getByRole('dialog', { name: /Support Bot/ })
    await expect.element(templateDialog).toBeVisible()
    await templateDialog.getByRole('button', { name: 'Close' }).click()
    await expect.element(templateDialog).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Support Bot' })).toHaveFocus()
  })

  it.each([
    ['standalone', true, 'CLOUD'],
    ['community console', false, 'COMMUNITY'],
  ] as const)(
    'keeps %s recommendations on the public navigation contract',
    async (_, standalone, edition) => {
      const screen = await renderTrending({
        banners: [mixedRecommendations],
        edition,
        isMarketplacePlatform: standalone,
      })
      const plugin = screen.getByRole('link', { name: 'Dropbox' })
      const template = screen.getByRole('link', { name: 'Support Bot' })

      if (standalone) {
        await expect.element(plugin).toHaveAttribute('href', '/plugin/langgenius/dropbox')
        await expect.element(template).toHaveAttribute('href', '/template/aisa-team/tpl-1')
      } else {
        expect(new URL(plugin.element().getAttribute('href')!, window.location.origin).origin).toBe(
          'https://marketplace.dify.ai',
        )
        expect(
          new URL(template.element().getAttribute('href')!, window.location.origin).origin,
        ).toBe('https://marketplace.dify.ai')
        await expect.element(plugin).toHaveAttribute('target', '_blank')
        await expect.element(template).toHaveAttribute('target', '_blank')
      }
    },
  )

  it('clamps a selected slide after a delivered banner refresh without leaving blank space', async () => {
    const screen = await renderTrending()
    await screen.getByRole('button', { name: 'Duck Duck Go' }).click()
    await expectSlideInsideCarousel(screen, 'Duck Duck Go')

    await screen.rerender(
      withI18n(
        <DirectionProvider direction="ltr">
          <HomeTrending banners={[banners[0]!]} isMarketplacePlatform page="plugins" />
        </DirectionProvider>,
      ),
    )

    await expect.element(screen.getByRole('group', { name: 'Trending' })).toBeVisible()
    await expectSlideInsideCarousel(screen, 'Trending')
    await expect
      .element(screen.getByRole('button', { name: 'Duck Duck Go' }))
      .not.toBeInTheDocument()
  })

  it('rejects unsafe CMS links and renders no carousel for an empty delivery', async () => {
    const unsafe: PluginBanner = {
      id: 'unsafe',
      style_type: 'blog',
      title: 'Unsafe Updates',
      sort: 0,
      language: 'en',
      content: {
        blog_title: 'Unsafe launch',
        subtitle: 'Should not be clickable',
        link: 'javascript:alert(1)',
        link_target_type: 'blog',
      },
    }
    const screen = await renderTrending({ banners: [unsafe] })
    await expect.element(screen.getByRole('link')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('heading', { name: 'Unsafe launch' }))
      .not.toBeInTheDocument()

    await screen.rerender(
      withI18n(
        <DirectionProvider direction="ltr">
          <HomeTrending banners={[]} isMarketplacePlatform page="plugins" />
        </DirectionProvider>,
      ),
    )
    await expect
      .element(screen.getByRole('region', { name: 'The plugins everyone is installing' }))
      .not.toBeInTheDocument()
  })

  it('tracks a recommendation only after its public link is activated', async () => {
    const screen = await renderTrending({ banners: [banners[0]!] })
    const link = screen.getByRole('link', { name: 'Dropbox' })
    link.element().addEventListener('click', (event) => event.preventDefault())

    await link.click()

    expect(vi.mocked(trackEvent)).toHaveBeenCalledWith(
      'marketplace_banner_item_click',
      expect.objectContaining({
        banner_id: 'recommend',
        item_id: 'langgenius/dropbox',
        item_type: 'plugin',
      }),
    )
    expect(window.__marketplaceTracking__?.track).toHaveBeenCalledWith(
      'marketplace_banner_click',
      expect.objectContaining({ item_name: 'Dropbox', item_type: 'plugin' }),
    )
  })
})

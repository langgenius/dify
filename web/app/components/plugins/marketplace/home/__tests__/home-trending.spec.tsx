import type { PluginBanner } from '@dify/contracts/marketplace'
import type { Window } from 'happy-dom'
import type { ReactElement } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { trackEvent } from '@/app/components/base/amplitude'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { disableIframeNavigation } from '@/test/iframe-navigation'
import { mockIntersectionObserver } from '@/test/intersection-observer'
import HomeTrending from '../home-trending'

disableIframeNavigation()

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  MARKETPLACE_URL_PREFIX: 'https://marketplace.dify.ai',
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}))

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

const render = (ui: ReactElement, options: Parameters<typeof renderWithConsoleQuery>[1] = {}) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  return renderWithConsoleQuery(ui, {
    queryClient,
    systemFeatures: { deployment_edition: 'CLOUD' },
    ...options,
  })
}

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
        {
          item_type: 'plugin',
          item_id: 'langgenius/notion',
          display_name: 'Notion',
          link: '/plugins/langgenius/notion',
          card_position: 2,
        },
        {
          item_type: 'plugin',
          item_id: 'langgenius/slack',
          display_name: 'Slack',
          link: '/plugins/langgenius/slack',
          card_position: 3,
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

const mockTrackEvent = vi.mocked(trackEvent)
const mockTrackMarketplaceSiteEvent = vi.fn()

const originalAnimateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
const mockProgressAnimation = () => {
  const animation = {
    cancel: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    finished: Promise.resolve(),
    onfinish: null,
  }
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => animation),
  })
  return animation
}

const navigationSettings = (window as unknown as Window).happyDOM.settings.navigation
const originalNavigation = navigationSettings.disableMainFrameNavigation

beforeEach(() => {
  navigationSettings.disableMainFrameNavigation = true
  document.body.setAttribute('data-is-marketplace', '')
  window.__marketplaceTracking__ = {
    track: mockTrackMarketplaceSiteEvent,
    rememberReferrer: vi.fn(),
    markSearch: vi.fn(),
    flushSearch: vi.fn(),
    markFilter: vi.fn(),
    flushFilter: vi.fn(),
  }
})

afterEach(() => {
  delete window.__marketplaceTracking__
  document.body.removeAttribute('data-is-marketplace')
  navigationSettings.disableMainFrameNavigation = originalNavigation
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (originalAnimateDescriptor)
    Object.defineProperty(Element.prototype, 'animate', originalAnimateDescriptor)
  else Reflect.deleteProperty(Element.prototype, 'animate')
  if (originalVisibilityDescriptor)
    Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor)
  else Reflect.deleteProperty(document, 'visibilityState')
})

describe('HomeTrending', () => {
  it('renders and switches between the three API-backed banner layouts', async () => {
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    expect(screen.getByRole('heading', { name: 'Popular plugins' })).toBeInTheDocument()
    const recommendationSlide = screen.getByRole('group', { name: 'Trending' })
    expect(
      within(recommendationSlide)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label')),
    ).toEqual(['Dropbox', 'Zapier', 'Notion', 'Slack'])

    await user.click(screen.getByRole('button', { name: 'Dify Updates' }))

    expect(screen.getByRole('heading', { name: 'Dify v1.9 new launch' })).toBeInTheDocument()
    const blogSlide = screen.getByRole('group', { name: 'Dify Updates' })
    const blogLink = within(blogSlide).getByRole('link', {
      name: /^plugin\.marketplace\.home\.trendingReadMoreAbout/,
    })
    expect(blogLink).toHaveAttribute('href', 'https://dify.ai/blog')
    expect(within(blogSlide).getAllByRole('link')).toHaveLength(1)
    expect(
      within(blogLink).getByRole('heading', { name: 'Dify v1.9 new launch' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Duck Duck Go' }))

    expect(screen.getByRole('link', { name: 'DuckDuckGo plugin' })).toHaveAttribute(
      'href',
      'https://marketplace.dify.ai/plugin/langgenius/duckduckgo',
    )
  })

  it('renders the delivered blog cover instead of bundled art', () => {
    const blogBanner: PluginBanner = {
      id: 'blog-cover',
      style_type: 'blog',
      title: 'Research',
      sort: 0,
      language: 'en',
      content: {
        blog_title: 'Trust Is a Feature',
        subtitle: 'Security and governance',
        link: 'https://dify.ai/blog/trust',
        link_target_type: 'blog',
        cover_image: '/api/v1/banners/images/banners/trust-cover.png',
      },
    }

    render(<HomeTrending banners={[blogBanner]} isMarketplacePlatform page="plugins" />)

    const blogLink = screen.getByRole('link', {
      name: /^plugin\.marketplace\.home\.trendingReadMoreAbout/,
    })
    expect(blogLink.querySelector('img')?.getAttribute('src')).toContain(
      '/api/v1/banners/images/banners/trust-cover.png',
    )
  })

  it('omits blog cover art when the payload has no cover_image', () => {
    render(<HomeTrending banners={[banners[1]!]} isMarketplacePlatform page="plugins" />)

    const blogLink = screen.getByRole('link', {
      name: /^plugin\.marketplace\.home\.trendingReadMoreAbout/,
    })
    expect(blogLink.querySelector('img')).toBeNull()
  })

  it('keeps only the selected slide in the accessibility tree', async () => {
    const user = userEvent.setup()
    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)
    const firstSlide = screen.getByRole('group', { name: 'Trending' })
    expect(firstSlide).not.toHaveAttribute('inert')
    expect(screen.queryByRole('group', { name: 'Dify Updates' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Duck Duck Go' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dify Updates' }))
    expect(screen.getByRole('group', { name: 'Dify Updates' })).not.toHaveAttribute('inert')
    expect(firstSlide).toHaveAttribute('inert')
    expect(screen.queryByRole('group', { name: 'Trending' })).not.toBeInTheDocument()
  })

  it('switches to the selected slide from the pagination with the keyboard', async () => {
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    const duckDuckGoButton = screen.getByRole('button', { name: 'Duck Duck Go' })

    act(() => duckDuckGoButton.focus())
    await user.keyboard('{Enter}')

    expect(duckDuckGoButton).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Trending' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('group', { name: 'Duck Duck Go' })).toHaveAttribute(
      'aria-hidden',
      'false',
    )
  })

  it('does not reject when the autoplay animation is canceled on unmount', async () => {
    let rejectFinished: (reason: unknown) => void = () => {}
    const finished = new Promise<Animation>((_resolve, reject) => {
      rejectFinished = reject
    })
    const progressAnimation = {
      cancel: vi.fn(() => {
        rejectFinished(
          Object.assign(new Error('The animation was canceled.'), { name: 'AbortError' }),
        )
      }),
      onfinish: null,
      pause: vi.fn(),
      play: vi.fn(),
      finished,
    }
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => progressAnimation),
    })

    const { unmount } = render(
      <HomeTrending banners={banners} isMarketplacePlatform page="plugins" />,
    )

    unmount()
    await act(async () => {
      await Promise.resolve()
    })

    expect(progressAnimation.cancel).toHaveBeenCalled()
  })

  it('toggles the carousel between paused and playing states', async () => {
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    const carousel = document.querySelector('[data-home-trending-carousel-root]')!
    const liveTrack = carousel.querySelector('[aria-live]')!
    expect(liveTrack).toHaveAttribute('aria-live', 'off')

    const pauseButton = screen.getByRole('button', {
      name: 'plugin.marketplace.home.trendingPause',
    })

    act(() => pauseButton.focus())
    await user.keyboard('{Enter}')

    expect(liveTrack).toHaveAttribute('aria-live', 'polite')

    const playButton = screen.getByRole('button', {
      name: 'plugin.marketplace.home.trendingPlay',
    })

    act(() => playButton.focus())
    await user.keyboard(' ')

    expect(
      screen.getByRole('button', {
        name: 'plugin.marketplace.home.trendingPause',
      }),
    ).toBeInTheDocument()
  })

  it('starts with autoplay paused when reduced motion is enabled', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    expect(
      screen.getByRole('button', {
        name: 'plugin.marketplace.home.trendingPlay',
      }),
    ).toBeInTheDocument()

    matchMedia.mockRestore()
  })

  it('keeps embedded autoplay paused until every pause reason is cleared', async () => {
    const user = userEvent.setup()
    const pause = vi.fn()
    const play = vi.fn()
    const cancel = vi.fn()
    const progressAnimation = {
      cancel,
      finished: Promise.resolve(),
      onfinish: null,
      pause,
      play,
    }
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => progressAnimation),
    })
    const intersect = mockIntersectionObserver()
    let reducedMotion = false
    let reducedMotionListener: (() => void) | undefined
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return reducedMotion
      },
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: (_event: string, listener: () => void) => {
        reducedMotionListener = listener
      },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    const marketplaceContainer = document.createElement('div')
    marketplaceContainer.id = 'marketplace-container'
    document.body.appendChild(marketplaceContainer)

    const { unmount } = render(
      <HomeTrending banners={banners} isMarketplacePlatform={false} page="plugins" />,
      {
        container: marketplaceContainer,
      },
    )
    const outsideControl = document.createElement('button')
    document.body.appendChild(outsideControl)
    const carouselRoot = marketplaceContainer.querySelector('[data-home-trending-carousel-root]')!
    const setIntersectionRatio = (intersectionRatio: number) =>
      intersect(intersectionRatio > 0, { target: carouselRoot, intersectionRatio })

    expect(pause).toHaveBeenCalled()

    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledOnce()

    await user.hover(carouselRoot)
    setIntersectionRatio(0)
    await user.unhover(carouselRoot)
    expect(play).toHaveBeenCalledOnce()

    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledTimes(2)

    const playsBeforeFocus = play.mock.calls.length
    const focusTarget = screen.getByRole('button', { name: 'Dropbox' })
    act(() => focusTarget.focus())
    setIntersectionRatio(0)
    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledTimes(playsBeforeFocus)
    act(() => outsideControl.focus())
    expect(play.mock.calls.length).toBeGreaterThan(playsBeforeFocus)

    // Navigation controls sit inside the pause boundary, so focusing them
    // also stops the rotation.
    const playsBeforeControlFocus = play.mock.calls.length
    const paginationButton = screen.getByRole('button', { name: 'Dify Updates' })
    act(() => paginationButton.focus())
    setIntersectionRatio(0)
    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledTimes(playsBeforeControlFocus)
    act(() => outsideControl.focus())
    expect(play.mock.calls.length).toBeGreaterThan(playsBeforeControlFocus)

    const playsBeforeUserPause = play.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'plugin.marketplace.home.trendingPause' }))
    setIntersectionRatio(0)
    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledTimes(playsBeforeUserPause)
    await user.click(screen.getByRole('button', { name: 'plugin.marketplace.home.trendingPlay' }))
    expect(play.mock.calls.length).toBeGreaterThan(playsBeforeUserPause)

    const playsBeforeVisibilityPause = play.mock.calls.length
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    fireEvent(document, new Event('visibilitychange'))
    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledTimes(playsBeforeVisibilityPause)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    fireEvent(document, new Event('visibilitychange'))
    expect(play.mock.calls.length).toBeGreaterThan(playsBeforeVisibilityPause)

    const playsBeforeReducedMotion = play.mock.calls.length
    reducedMotion = true
    act(() => reducedMotionListener?.())
    setIntersectionRatio(0)
    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledTimes(playsBeforeReducedMotion)

    reducedMotion = false
    act(() => reducedMotionListener?.())
    expect(play.mock.calls.length).toBeGreaterThan(playsBeforeReducedMotion)

    unmount()
    marketplaceContainer.remove()
    outsideControl.remove()
  })

  it('resumes autoplay after a pointer click on pagination without waiting for blur', async () => {
    const { play } = mockProgressAnimation()
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    const carouselRoot = document.querySelector('[data-home-trending-carousel-root]')!
    const paginationButton = screen.getByRole('button', { name: 'Dify Updates' })

    // Pointer activation hovers and focuses the control, which normally
    // pauses rotation until mouseleave/focusout.
    await user.hover(carouselRoot)
    act(() => paginationButton.focus())

    const playsBeforeSelect = play.mock.calls.length
    await user.click(paginationButton)

    expect(paginationButton).toHaveAttribute('aria-current', 'true')
    expect(document.activeElement).toBe(paginationButton)
    expect(play.mock.calls.length).toBeGreaterThan(playsBeforeSelect)
  })

  it('keeps autoplay paused when pagination is selected from the keyboard', async () => {
    const { play } = mockProgressAnimation()
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    const paginationButton = screen.getByRole('button', { name: 'Dify Updates' })
    act(() => paginationButton.focus())

    const playsBeforeSelect = play.mock.calls.length
    await user.keyboard('{Enter}')

    expect(paginationButton).toHaveAttribute('aria-current', 'true')
    expect(document.activeElement).toBe(paginationButton)
    expect(play).toHaveBeenCalledTimes(playsBeforeSelect)
  })

  it('resumes autoplay when Play is activated without moving keyboard focus', async () => {
    const { pause, play } = mockProgressAnimation()
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    const toggleButton = screen.getByRole('button', {
      name: 'plugin.marketplace.home.trendingPause',
    })

    // Focusing the toggle adds the implicit focus pause reason, then Enter
    // adds the explicit user pause.
    act(() => toggleButton.focus())
    await user.keyboard('{Enter}')
    expect(pause).toHaveBeenCalled()

    // Play must resume the rotation even though the button is still focused
    // (and would normally keep the focus pause reason active).
    const playsBeforePlay = play.mock.calls.length
    await user.keyboard('{Enter}')

    expect(play.mock.calls.length).toBeGreaterThan(playsBeforePlay)
    expect(document.activeElement).toBe(toggleButton)
    expect(
      screen.getByRole('button', { name: 'plugin.marketplace.home.trendingPause' }),
    ).toBeInTheDocument()
  })

  it('opens embedded recommend plugin cards in the plugin dialog', async () => {
    const user = userEvent.setup()
    const bannerWithMixedLinks: PluginBanner = {
      id: 'recommend-mixed',
      style_type: 'recommend',
      title: 'Trending',
      sort: 0,
      language: 'en',
      content: {
        theme_type: 'hottest',
        cards: [
          {
            item_type: 'plugin',
            item_id: 'langgenius/dropbox',
            display_name: 'Dropbox',
            link: 'https://external.example.com/dropbox',
            card_position: 0,
          },
          {
            item_type: 'plugin',
            item_id: 'langgenius/notion',
            display_name: 'Notion',
            link: '',
            card_position: 1,
          },
          {
            item_type: 'template',
            item_id: 'tpl-1',
            display_name: 'Support Bot',
            link: '',
            card_position: 2,
          },
        ],
      },
    }

    render(
      <HomeTrending
        banners={[bannerWithMixedLinks]}
        isMarketplacePlatform={false}
        page="plugins"
      />,
    )

    expect(screen.queryByRole('link', { name: 'Dropbox' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Notion' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Support Bot' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dropbox' }))

    expect(
      screen.getByRole('dialog', { name: 'Dropbox · plugin.detailPanel.operation.detail' }),
    ).toBeInTheDocument()
    const url = new URL(
      screen.getByTitle<HTMLIFrameElement>('Dropbox · plugin.detailPanel.operation.detail').src,
    )
    expect(url.origin).toBe('https://marketplace.dify.ai')
    expect(url.pathname).toBe('/plugins/langgenius/dropbox')
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockTrackMarketplaceSiteEvent).toHaveBeenCalledWith(
      'marketplace_banner_click',
      expect.objectContaining({
        click_target: 'recommendation',
        item_id: 'langgenius/dropbox',
        item_type: 'plugin',
        item_name: 'Dropbox',
      }),
    )
  })

  it('opens embedded recommend template cards in the template dialog', async () => {
    const user = userEvent.setup()
    const bannerWithTemplates: PluginBanner = {
      id: 'recommend-templates-embedded',
      style_type: 'recommend',
      title: 'Trending',
      sort: 0,
      language: 'en',
      content: {
        theme_type: 'newest',
        cards: [
          {
            item_type: 'template',
            item_id: 'tpl-1',
            display_name: 'Support Bot',
            creator: 'aisa-team',
            link: 'https://external.example.com/support-bot',
            card_position: 0,
          },
        ],
      },
    }

    render(
      <HomeTrending
        banners={[bannerWithTemplates]}
        isMarketplacePlatform={false}
        page="templates"
      />,
    )

    expect(screen.queryByRole('link', { name: 'Support Bot' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Support Bot' }))

    expect(
      screen.getByRole('dialog', { name: 'Support Bot · plugin.detailPanel.operation.detail' }),
    ).toBeInTheDocument()
    const url = new URL(
      screen.getByTitle<HTMLIFrameElement>('Support Bot · plugin.detailPanel.operation.detail').src,
    )
    expect(url.origin).toBe('https://marketplace.dify.ai')
    expect(url.pathname).toBe('/template/aisa-team/tpl-1')
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockTrackMarketplaceSiteEvent).toHaveBeenCalledWith(
      'marketplace_banner_click',
      expect.objectContaining({
        click_target: 'recommendation',
        item_id: 'tpl-1',
        item_type: 'template',
        item_name: 'Support Bot',
      }),
    )
  })

  it('opens embedded recommend plugin cards from /plugins links when item_id is not org/name', async () => {
    const user = userEvent.setup()
    const banner: PluginBanner = {
      id: 'recommend-plugin-href',
      style_type: 'recommend',
      title: 'Trending',
      sort: 0,
      language: 'en',
      content: {
        theme_type: 'hottest',
        cards: [
          {
            item_type: 'plugin',
            item_id: 'baserow',
            display_name: 'Baserow',
            link: '/plugins/langgenius/baserow',
            card_position: 0,
          },
        ],
      },
    }

    render(<HomeTrending banners={[banner]} isMarketplacePlatform={false} page="plugins" />)

    expect(screen.queryByRole('link', { name: 'Baserow' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Baserow' }))
    expect(
      screen.getByRole('dialog', { name: 'Baserow · plugin.detailPanel.operation.detail' }),
    ).toBeInTheDocument()
    const url = new URL(
      screen.getByTitle<HTMLIFrameElement>('Baserow · plugin.detailPanel.operation.detail').src,
    )
    expect(url.origin).toBe('https://marketplace.dify.ai')
    expect(url.pathname).toBe('/plugins/langgenius/baserow')
  })

  it('links recommend template cards by ID with the served author or template fallback', () => {
    const banner: PluginBanner = {
      id: 'recommend-templates',
      style_type: 'recommend',
      title: 'Trending',
      sort: 0,
      language: 'en',
      content: {
        theme_type: 'newest',
        cards: [
          {
            item_type: 'template',
            item_id: 'tpl-authored',
            display_name: 'Go-to-Market',
            creator: 'aisa-team',
            link: '/templates/tpl-authored',
            card_position: 0,
          },
          {
            item_type: 'template',
            item_id: 'tpl-anonymous',
            display_name: 'Untitled Flow',
            link: '/templates/tpl-anonymous',
            card_position: 1,
          },
        ],
      },
    }

    render(<HomeTrending banners={[banner]} isMarketplacePlatform page="templates" />)

    const authored = screen.getByRole('link', { name: 'Go-to-Market' })
    const anonymous = screen.getByRole('link', { name: 'Untitled Flow' })

    expect(authored).toHaveAttribute('href', '/template/aisa-team/tpl-authored')
    expect(anonymous).toHaveAttribute('href', '/template/template/tpl-anonymous')
    expect(
      within(authored).getByText(/^plugin\.marketplace\.home\.trendingByCreator/),
    ).toBeInTheDocument()
    expect(
      within(anonymous).queryByText('plugin.marketplace.home.trendingByCreator'),
    ).not.toBeInTheDocument()
  })

  it('clamps the active slide when a refetch shrinks the banner list', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <HomeTrending banners={banners} isMarketplacePlatform page="plugins" />,
    )

    await user.click(screen.getByRole('button', { name: 'Duck Duck Go' }))
    expect(screen.getByRole('button', { name: 'Duck Duck Go' })).toHaveAttribute(
      'aria-current',
      'true',
    )

    rerender(<HomeTrending banners={[banners[0]!]} isMarketplacePlatform page="plugins" />)

    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Trending' })).not.toHaveAttribute('inert')
    })
    expect(screen.queryByRole('button', { name: 'Duck Duck Go' })).not.toBeInTheDocument()
  })

  describe('mobile swipe', () => {
    const stubViewport = (isMobile: boolean) =>
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query) =>
          ({
            matches: isMobile && query === '(max-width: 879px)',
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) satisfies MediaQueryList,
      )

    const swipe = (slide: HTMLElement, points: Array<[x: number, y: number]>) => {
      const touch = { pointerId: 1, pointerType: 'touch', isPrimary: true }
      const [start, ...moves] = points
      fireEvent.pointerDown(slide, { ...touch, clientX: start![0], clientY: start![1] })
      for (const [clientX, clientY] of moves)
        fireEvent.pointerMove(slide, { ...touch, clientX, clientY })
      const [clientX, clientY] = points.at(-1)!
      fireEvent.pointerUp(slide, { ...touch, clientX, clientY })
    }

    const renderCarousel = () =>
      render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('switches in both directions without activating a dragged link or clearing Pause', async () => {
      const user = userEvent.setup()
      stubViewport(true)
      renderCarousel()

      swipe(screen.getByRole('group', { name: 'Trending' }), [
        [480, 160],
        [300, 166],
      ])

      expect(fireEvent.click(screen.getByRole('link', { name: 'Dropbox', hidden: true }))).toBe(
        false,
      )
      expect(screen.getByRole('button', { name: 'Dify Updates' })).toHaveAttribute(
        'aria-current',
        'true',
      )

      await user.click(
        screen.getByRole('button', { name: 'plugin.marketplace.home.trendingPause' }),
      )
      swipe(screen.getByRole('group', { name: 'Dify Updates' }), [
        [260, 160],
        [440, 166],
      ])

      expect(screen.getByRole('button', { name: 'Trending' })).toHaveAttribute(
        'aria-current',
        'true',
      )
      expect(
        screen.getByRole('button', { name: 'plugin.marketplace.home.trendingPlay' }),
      ).toBeInTheDocument()
    })

    it('suppresses the trailing click when a horizontal drag is pulled back before release', () => {
      stubViewport(true)
      renderCarousel()

      swipe(screen.getByRole('group', { name: 'Trending' }), [
        [400, 160],
        [280, 164],
        [396, 162],
      ])

      expect(fireEvent.click(screen.getByRole('link', { name: 'Dropbox' }))).toBe(false)
      expect(screen.getByRole('button', { name: 'Trending' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })

    it.each([
      { name: 'a vertical gesture on mobile', isMobile: true, end: [270, 300] as [number, number] },
      { name: 'touch input on desktop', isMobile: false, end: [80, 160] as [number, number] },
    ])('stays on the current slide for $name', ({ isMobile, end }) => {
      stubViewport(isMobile)
      renderCarousel()

      swipe(screen.getByRole('group', { name: 'Trending' }), [[300, 120], end])

      expect(screen.getByRole('button', { name: 'Trending' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
  })

  it('renders no carousel when the API returns no banners', () => {
    render(<HomeTrending banners={[]} isMarketplacePlatform page="plugins" />)

    expect(
      screen.queryByRole('region', {
        name: 'plugin.marketplace.home.trendingTitle',
      }),
    ).not.toBeInTheDocument()
  })

  it('tracks recommend card clicks as item clicks without a frame click', async () => {
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="templates" />)

    expect(screen.getByRole('link', { name: 'Dropbox' })).toHaveAttribute(
      'href',
      '/plugin/langgenius/dropbox',
    )
    await user.click(screen.getByRole('link', { name: 'Dropbox' }))

    expect(mockTrackEvent).toHaveBeenCalledWith('marketplace_banner_item_click', {
      banner_id: 'recommend',
      sort: 0,
      page: 'templates',
      language: 'en',
      style_type: 'recommend',
      item_type: 'plugin',
      item_id: 'langgenius/dropbox',
      card_position: 0,
      theme_type: 'hottest',
      auto_batch_id: '11111111-1111-4111-8111-111111111111',
    })
    expect(mockTrackEvent).not.toHaveBeenCalledWith('marketplace_banner_click', expect.anything())
    expect(mockTrackMarketplaceSiteEvent).toHaveBeenCalledWith(
      'marketplace_banner_click',
      expect.objectContaining({
        click_target: 'recommendation',
        item_id: 'langgenius/dropbox',
        item_type: 'plugin',
        item_name: 'Dropbox',
      }),
    )
  })

  it('tracks whole-slide blog and event links as frame clicks', async () => {
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    await user.click(screen.getByRole('button', { name: 'Dify Updates' }))
    await user.click(
      screen.getByRole('link', { name: /^plugin\.marketplace\.home\.trendingReadMoreAbout/ }),
    )

    expect(mockTrackEvent).toHaveBeenCalledWith('marketplace_banner_click', {
      banner_id: 'blog',
      sort: 1,
      page: 'plugins',
      language: 'en',
      style_type: 'blog',
    })

    await user.click(screen.getByRole('button', { name: 'Duck Duck Go' }))
    await user.click(screen.getByRole('link', { name: 'DuckDuckGo plugin' }))

    expect(mockTrackEvent).toHaveBeenCalledWith('marketplace_banner_click', {
      banner_id: 'event',
      sort: 2,
      page: 'plugins',
      language: 'en',
      style_type: 'event',
    })
  })

  it('does not render banner slides whose CMS link is not http(s) or relative', () => {
    const unsafeBlog: PluginBanner = {
      id: 'blog-unsafe',
      style_type: 'blog',
      title: 'Unsafe Updates',
      sort: 0,
      language: 'en',
      content: {
        blog_title: 'Unsafe launch',
        subtitle: 'Should not be clickable',
        description: 'Reject javascript hrefs from CMS payloads.',
        link: 'javascript:alert(1)',
        link_target_type: 'blog',
      },
    }

    render(<HomeTrending banners={[unsafeBlog]} isMarketplacePlatform page="plugins" />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Unsafe launch' })).not.toBeInTheDocument()
  })

  it('dual-writes banner impressions to Amplitude and marketplace site tracking', () => {
    vi.useFakeTimers()
    const intersect = mockIntersectionObserver()

    try {
      const blogBanner = banners[1]
      if (!blogBanner) throw new Error('Expected a blog banner fixture')

      render(<HomeTrending banners={[blogBanner]} isMarketplacePlatform page="plugins" />)

      intersect()
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      const properties = {
        banner_id: 'blog',
        sort: 1,
        page: 'plugins',
        language: 'en',
        style_type: 'blog',
      }
      expect(mockTrackEvent).toHaveBeenCalledWith('marketplace_banner_impression', properties)
      expect(mockTrackMarketplaceSiteEvent).toHaveBeenCalledWith(
        'marketplace_banner_impression',
        properties,
      )
    } finally {
      vi.useRealTimers()
    }
  })
  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'links %s recommendations directly to the official site',
    (edition) => {
      const mixedBanner: PluginBanner = {
        id: 'mixed',
        style_type: 'recommend',
        title: 'Trending',
        sort: 0,
        language: 'en',
        content: {
          theme_type: 'hottest',
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
      render(
        <HomeTrending banners={[mixedBanner]} isMarketplacePlatform={false} page="plugins" />,
        { systemFeatures: { deployment_edition: edition } },
      )
      const links = [
        screen.getByRole('link', { name: 'Dropbox' }),
        screen.getByRole('link', { name: 'Support Bot' }),
      ]
      expect(new URL(links[0]!.getAttribute('href')!).pathname).toBe('/plugin/langgenius/dropbox')
      expect(new URL(links[1]!.getAttribute('href')!).pathname).toBe('/template/aisa-team/tpl-1')
      for (const link of links)
        expect(new URL(link.getAttribute('href')!).origin).toBe('https://marketplace.dify.ai')
      for (const link of links) {
        expect(link).toHaveAttribute('target', '_blank')
        expect(new URL(link.getAttribute('href')!).searchParams.get('source')).toBe(
          window.location.origin,
        )
      }
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )
})

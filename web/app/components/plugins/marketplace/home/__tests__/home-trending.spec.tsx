import type { PluginBanner } from '@dify/contracts/marketplace'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackEvent } from '@/app/components/base/amplitude'
import HomeTrending from '../home-trending'

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: (namespace: string) => ({
      t: withSelectorKey((key: string) => `${namespace}.${key}`),
    }),
  }
})

vi.mock('@/app/components/plugins/base/badges/partner', () => ({
  default: () => <span data-testid="partner-badge" />,
}))

vi.mock('@/app/components/plugins/base/badges/verified', () => ({
  default: () => <span data-testid="verified-badge" />,
}))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  MARKETPLACE_URL_PREFIX: 'https://marketplace.example.com',
}))

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

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HomeTrending', () => {
  it('renders and switches between the three API-backed banner layouts', async () => {
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    expect(document.querySelector('[data-home-trending-carousel-root]')?.className).toMatch(
      /carouselRoot/,
    )
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
      name: 'plugin.marketplace.home.trendingReadMoreAbout',
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

  it('marks inactive standalone slides so mobile CSS can collapse mixed banner heights', () => {
    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    const recommendSlide = screen.getByRole('group', { name: 'Trending' })
    const blogSlide = document.querySelector('[aria-roledescription="slide"][aria-label="Dify Updates"]')
    const eventSlide = document.querySelector('[aria-roledescription="slide"][aria-label="Duck Duck Go"]')
    const eventLink = document.querySelector('a[aria-label="DuckDuckGo plugin"]')

    expect(recommendSlide.className).toMatch(/slide/)
    expect(recommendSlide.className).not.toMatch(/slideInactive/)
    expect(blogSlide?.className).toMatch(/slideInactive/)
    expect(eventSlide?.className).toMatch(/slideInactive/)
    expect(recommendSlide.firstElementChild?.className).toMatch(/stackedSlide/)
    expect(blogSlide?.firstElementChild?.className).toMatch(/stackedSlide/)
    expect(eventLink?.className).toMatch(/imageSlide/)
    expect(eventLink?.querySelector('source')).toHaveAttribute('media', '(max-width: 879px)')
    expect(eventLink?.querySelector('source')?.getAttribute('srcset')).toContain(
      'duckduckgo-mobile.png',
    )
  })

  it('keeps the embedded event image breakpoint at 639px', () => {
    render(<HomeTrending banners={banners} isMarketplacePlatform={false} page="plugins" />)

    expect(document.querySelector('a[aria-label="DuckDuckGo plugin"] source')).toHaveAttribute(
      'media',
      '(max-width: 639px)',
    )
  })

  it('falls back to desktop on the mobile source when an event banner has no mobile asset', () => {
    const eventWithoutMobile: PluginBanner = {
      id: 'event-desktop-only',
      style_type: 'event',
      title: 'Desktop Event',
      sort: 0,
      language: 'en',
      content: {
        images: {
          desktop: '/api/v1/banners/images/banners/event-desktop.png',
          tablet: '/api/v1/banners/images/banners/event-tablet.png',
        },
        link: 'https://dify.ai/event',
        alt_text: 'Desktop event',
      },
    }

    render(<HomeTrending banners={[eventWithoutMobile]} isMarketplacePlatform page="plugins" />)

    const eventLink = screen.getByRole('link', { name: 'Desktop event' })
    const sources = eventLink.querySelectorAll('source')

    expect(sources[0]).toHaveAttribute('media', '(max-width: 879px)')
    expect(sources[0]?.getAttribute('srcset')).toContain('event-desktop.png')
    expect(sources[0]?.getAttribute('srcset')).not.toContain('event-tablet.png')
    expect(sources[1]).toHaveAttribute('media', '(min-width: 880px) and (max-width: 1023px)')
    expect(sources[1]?.getAttribute('srcset')).toContain('event-tablet.png')
    expect(eventLink.querySelector('img')?.getAttribute('src')).toContain('event-desktop.png')
  })

  it('switches to the selected slide from the pagination with the keyboard', async () => {
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    const duckDuckGoButton = screen.getByRole('button', { name: 'Duck Duck Go' })

    duckDuckGoButton.focus()
    await user.keyboard('{Enter}')

    expect(duckDuckGoButton).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Trending' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('group', { name: 'Duck Duck Go' })).toHaveAttribute(
      'aria-hidden',
      'false',
    )
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
    expect(pauseButton).toHaveClass('bg-state-base-active')

    pauseButton.focus()
    await user.keyboard('{Enter}')

    expect(liveTrack).toHaveAttribute('aria-live', 'polite')

    const playButton = screen.getByRole('button', {
      name: 'plugin.marketplace.home.trendingPlay',
    })

    playButton.focus()
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

  it('keeps embedded autoplay paused until every pause reason is cleared', () => {
    const pause = vi.fn()
    const play = vi.fn()
    const cancel = vi.fn()
    const progressAnimation = {
      cancel,
      onfinish: null,
      pause,
      play,
    } as unknown as Animation
    const originalAnimate = Element.prototype.animate
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => progressAnimation),
    })
    const intersectionObservers: {
      callback: IntersectionObserverCallback
      options?: IntersectionObserverInit
    }[] = []
    class MockIntersectionObserver {
      disconnect = vi.fn()
      observe = vi.fn()
      root: Element | Document | null
      rootMargin: string
      takeRecords = vi.fn(() => [])
      thresholds: readonly number[]
      unobserve = vi.fn()

      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.root = options?.root ?? null
        this.rootMargin = options?.rootMargin ?? '0px'
        this.thresholds = Array.isArray(options?.threshold)
          ? options.threshold
          : [options?.threshold ?? 0]
        intersectionObservers.push({ callback, options })
      }
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
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
    const carouselRoot = marketplaceContainer.querySelector('[data-home-trending-carousel-root]')!
    const viewportObserver = intersectionObservers.find(
      (observer) => observer.options?.threshold === 0.25,
    )
    const setIntersectionRatio = (intersectionRatio: number) => {
      act(() => {
        viewportObserver?.callback(
          [
            {
              intersectionRatio,
              isIntersecting: intersectionRatio > 0,
            } as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver,
        )
      })
    }

    expect(pause).toHaveBeenCalled()

    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledOnce()

    fireEvent.mouseEnter(carouselRoot)
    setIntersectionRatio(0)
    fireEvent.mouseLeave(carouselRoot)
    expect(play).toHaveBeenCalledOnce()

    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledTimes(2)

    const playsBeforeFocus = play.mock.calls.length
    const focusTarget = carouselRoot.querySelector('a')!
    fireEvent.focusIn(focusTarget)
    setIntersectionRatio(0)
    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledTimes(playsBeforeFocus)
    fireEvent.focusOut(focusTarget, { relatedTarget: null })
    expect(play.mock.calls.length).toBeGreaterThan(playsBeforeFocus)

    // Navigation controls sit inside the pause boundary, so focusing them
    // also stops the rotation.
    const playsBeforeControlFocus = play.mock.calls.length
    const paginationButton = screen.getByRole('button', { name: 'Dify Updates' })
    fireEvent.focusIn(paginationButton)
    setIntersectionRatio(0)
    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledTimes(playsBeforeControlFocus)
    fireEvent.focusOut(paginationButton, { relatedTarget: null })
    expect(play.mock.calls.length).toBeGreaterThan(playsBeforeControlFocus)

    const playsBeforeUserPause = play.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'plugin.marketplace.home.trendingPause' }))
    setIntersectionRatio(0)
    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledTimes(playsBeforeUserPause)
    fireEvent.click(screen.getByRole('button', { name: 'plugin.marketplace.home.trendingPlay' }))
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
    reducedMotionListener?.()
    setIntersectionRatio(0)
    setIntersectionRatio(0.25)
    expect(play).toHaveBeenCalledTimes(playsBeforeReducedMotion)

    reducedMotion = false
    reducedMotionListener?.()
    expect(play.mock.calls.length).toBeGreaterThan(playsBeforeReducedMotion)

    unmount()
    marketplaceContainer.remove()
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: originalAnimate,
    })
  })

  it('resumes autoplay after a pointer click on pagination without waiting for blur', async () => {
    const pause = vi.fn()
    const play = vi.fn()
    const progressAnimation = {
      cancel: vi.fn(),
      onfinish: null,
      pause,
      play,
    } as unknown as Animation
    const originalAnimate = Element.prototype.animate
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => progressAnimation),
    })
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    const carouselRoot = document.querySelector('[data-home-trending-carousel-root]')!
    const paginationButton = screen.getByRole('button', { name: 'Dify Updates' })

    // Pointer activation hovers and focuses the control, which normally
    // pauses rotation until mouseleave/focusout.
    fireEvent.mouseEnter(carouselRoot)
    paginationButton.focus()
    fireEvent.focusIn(paginationButton)

    const playsBeforeSelect = play.mock.calls.length
    await user.click(paginationButton)

    expect(paginationButton).toHaveAttribute('aria-current', 'true')
    expect(document.activeElement).toBe(paginationButton)
    expect(play.mock.calls.length).toBeGreaterThan(playsBeforeSelect)

    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: originalAnimate,
    })
  })

  it('keeps autoplay paused when pagination is selected from the keyboard', async () => {
    const pause = vi.fn()
    const play = vi.fn()
    const progressAnimation = {
      cancel: vi.fn(),
      onfinish: null,
      pause,
      play,
    } as unknown as Animation
    const originalAnimate = Element.prototype.animate
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => progressAnimation),
    })
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    const paginationButton = screen.getByRole('button', { name: 'Dify Updates' })
    paginationButton.focus()
    fireEvent.focusIn(paginationButton)

    const playsBeforeSelect = play.mock.calls.length
    await user.keyboard('{Enter}')

    expect(paginationButton).toHaveAttribute('aria-current', 'true')
    expect(document.activeElement).toBe(paginationButton)
    expect(play).toHaveBeenCalledTimes(playsBeforeSelect)

    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: originalAnimate,
    })
  })

  it('resumes autoplay when Play is activated without moving keyboard focus', async () => {
    const pause = vi.fn()
    const play = vi.fn()
    const progressAnimation = {
      cancel: vi.fn(),
      onfinish: null,
      pause,
      play,
    } as unknown as Animation
    const originalAnimate = Element.prototype.animate
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => progressAnimation),
    })
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    const toggleButton = screen.getByRole('button', {
      name: 'plugin.marketplace.home.trendingPause',
    })

    // Focusing the toggle adds the implicit focus pause reason, then Enter
    // adds the explicit user pause.
    toggleButton.focus()
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

    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: originalAnimate,
    })
  })

  it('sends embedded cards without a delivery link to the marketplace site', () => {
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
            // The console has no local /plugin route, so a card without a
            // delivery-provided link must open the marketplace detail page.
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

    expect(screen.getByRole('link', { name: 'Dropbox' })).toHaveAttribute(
      'href',
      'https://external.example.com/dropbox',
    )
    const marketplaceFallbackLink = screen.getByRole('link', { name: 'Notion' })
    expect(marketplaceFallbackLink.getAttribute('href')).toMatch(
      /^https:\/\/marketplace\.example\.com\/plugins\/langgenius\/notion/,
    )
    expect(marketplaceFallbackLink).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Support Bot' })).toHaveAttribute(
      'href',
      '/templates?tid=tpl-1',
    )
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
  })

  it('tracks whole-slide blog and event links as frame clicks', async () => {
    const user = userEvent.setup()

    render(<HomeTrending banners={banners} isMarketplacePlatform page="plugins" />)

    await user.click(screen.getByRole('button', { name: 'Dify Updates' }))
    await user.click(
      screen.getByRole('link', { name: 'plugin.marketplace.home.trendingReadMoreAbout' }),
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
})

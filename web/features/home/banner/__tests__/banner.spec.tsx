import type { BannerResponse } from '@dify/contracts/api/console/explore/types.gen'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import * as React from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { Banner } from '../banner'

const mockTrackEvent = vi.fn()
const mockScrollTo = vi.fn()
let mockSelectedIndex = 0
let mockAutoplayPlaying = true
const mockCarouselListeners = new Set<() => void>()
const mockAutoplayListeners = {
  play: new Set<() => void>(),
  stop: new Set<() => void>(),
}
const mockConsoleState = vi.hoisted(() => ({
  userProfile: {
    id: 'account-123',
    name: 'Evan',
  },
}))

const render = (ui: Parameters<typeof renderWithConsoleState>[0]) =>
  renderWithConsoleState(ui, {
    wrapper: createConsoleQueryWrapper({ accountProfile: mockConsoleState.userProfile }).wrapper,
  })

const emitAutoplay = (event: 'play' | 'stop') => {
  mockAutoplayListeners[event].forEach((listener) => listener())
}

const mockAutoplay = {
  isPlaying: () => mockAutoplayPlaying,
  play: vi.fn(() => {
    mockAutoplayPlaying = true
    emitAutoplay('play')
  }),
  stop: vi.fn(() => {
    mockAutoplayPlaying = false
    emitAutoplay('stop')
  }),
}

const mockApi = {
  plugins: () => ({ autoplay: mockAutoplay }),
  scrollTo: mockScrollTo,
  on: vi.fn((event: string, listener: () => void) => {
    if (event === 'autoplay:play') mockAutoplayListeners.play.add(listener)
    if (event === 'autoplay:stop') mockAutoplayListeners.stop.add(listener)
    return mockApi
  }),
  off: vi.fn((event: string, listener: () => void) => {
    if (event === 'autoplay:play') mockAutoplayListeners.play.delete(listener)
    if (event === 'autoplay:stop') mockAutoplayListeners.stop.delete(listener)
    return mockApi
  }),
}

const setMockSelectedIndex = (index: number) => {
  mockSelectedIndex = index
  mockCarouselListeners.forEach((listener) => listener())
}

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('react-i18next', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      i18n: { language: 'en-US' },
      t: withSelectorKey((key: string, opts?: Record<string, unknown>) => {
        if (key === 'banner.greeting') return `Welcome back, ${opts?.name}👋`
        if (key === 'banner.tagline') return 'What if… this is where your next idea begins.'
        return key
      }),
    }),
  }
})

vi.mock('@/app/components/base/carousel', () => ({
  Carousel: Object.assign(
    ({
      children,
      className,
      opts: _opts,
      plugins: _plugins,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { opts?: unknown; plugins?: unknown }) => (
      <div role="region" data-testid="carousel" className={className} {...props}>
        {children}
      </div>
    ),
    {
      Content: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
        <div data-testid="carousel-content" {...props}>
          {children}
        </div>
      ),
      Item: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
        <div role="group" data-testid="carousel-item" {...props}>
          {children}
        </div>
      ),
      Plugin: {
        Autoplay: (config: Record<string, unknown>) => ({ type: 'autoplay', ...config }),
        Fade: () => ({ type: 'fade' }),
      },
    },
  ),
  useCarousel: () => {
    const selectedIndex = React.useSyncExternalStore(
      (listener) => {
        mockCarouselListeners.add(listener)
        return () => mockCarouselListeners.delete(listener)
      },
      () => mockSelectedIndex,
    )

    return { api: mockApi, selectedIndex }
  },
}))

vi.mock('../banner-item', () => ({
  BannerItem: ({
    banner,
    sort,
    language,
    accountId,
    titleId,
  }: {
    banner: BannerResponse
    sort: number
    language: string
    accountId?: string
    titleId?: string
  }) => (
    <article
      data-testid="banner-item"
      data-banner-id={banner.id}
      data-sort={sort}
      data-language={language}
      data-account-id={accountId}
    >
      <p id={titleId}>{banner.content.title}</p>
    </article>
  ),
}))

const createMockBanner = (
  id: string,
  status: BannerResponse['status'] = 'enabled',
  title: string = 'Test Banner',
): BannerResponse => ({
  id,
  status,
  link: 'https://example.com',
  created_at: '2024-01-01T00:00:00Z',
  content: {
    category: 'Featured',
    title,
    description: 'Test description',
    'img-src': `https://example.com/image-${id}.png`,
  },
  sort: 1,
})

describe('Banner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelectedIndex = 0
    mockAutoplayPlaying = true
    mockCarouselListeners.clear()
    mockAutoplayListeners.play.clear()
    mockAutoplayListeners.stop.clear()
    mockConsoleState.userProfile = { id: 'account-123', name: 'Evan' }
  })

  afterEach(cleanup)

  it('renders nothing when there are no banners', () => {
    render(<Banner banners={[]} />)

    expect(screen.queryByText('Welcome back, Evan👋')).not.toBeInTheDocument()
    expect(
      screen.queryByText('What if… this is where your next idea begins.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('labels the carousel and renders its banners', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    expect(screen.getByRole('region', { name: 'Featured' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'pagination.pageNumber' })).toBeInTheDocument()
    expect(screen.getAllByTestId('banner-item')).toHaveLength(2)
  })

  it('keeps only the active slide exposed to assistive technology and keyboard focus', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    const [firstSlide, secondSlide] = screen.getAllByTestId('carousel-item')
    expect(firstSlide).toHaveAttribute('aria-hidden', 'false')
    expect(firstSlide).not.toHaveAttribute('inert')
    expect(secondSlide).toHaveAttribute('aria-hidden', 'true')
    expect(secondSlide).toHaveAttribute('inert')
  })

  it('names each slide with its visible title', () => {
    render(<Banner banners={[createMockBanner('1', 'enabled', 'First banner')]} />)

    const slide = screen.getByRole('group', { name: 'First banner' })
    const title = document.getElementById(slide.getAttribute('aria-labelledby')!)

    expect(slide).not.toHaveAttribute('aria-label')
    expect(title).toHaveTextContent('First banner')
    expect(slide).toContainElement(title)
  })

  it('keeps one shared control set mounted while selecting a banner', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    expect(screen.getAllByRole('button')).toHaveLength(2)
    const secondBannerButton = screen.getByRole('button', { name: '02 Second banner' })
    secondBannerButton.focus()
    fireEvent.click(secondBannerButton)
    expect(mockScrollTo).toHaveBeenCalledWith(1)

    act(() => setMockSelectedIndex(1))
    expect(secondBannerButton).toHaveFocus()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('keeps autoplay running when pointer selection does not move focus', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '02 Second banner' }))

    expect(mockAutoplay.stop).not.toHaveBeenCalled()
    expect(mockScrollTo).toHaveBeenCalledWith(1)
  })

  it('keeps current-page selection idempotent', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '01 First banner' }))

    expect(mockAutoplay.stop).not.toHaveBeenCalled()
    expect(mockScrollTo).not.toHaveBeenCalled()
  })

  it('does not control an inactive autoplay plugin during manual selection', () => {
    mockAutoplayPlaying = false
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '02 Second banner' }))

    expect(mockAutoplay.stop).not.toHaveBeenCalled()
    expect(mockAutoplay.play).not.toHaveBeenCalled()
    expect(mockScrollTo).toHaveBeenCalledWith(1)
  })

  it('updates the live region when Embla stops and restarts automatic rotation', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    act(() => mockAutoplay.stop())
    expect(mockAutoplay.stop).toHaveBeenCalledOnce()
    expect(screen.getByTestId('carousel-content')).toHaveAttribute('aria-live', 'polite')
    act(() => mockAutoplay.play())
    expect(mockAutoplay.play).toHaveBeenCalledOnce()
    expect(screen.getByTestId('carousel-content')).toHaveAttribute('aria-live', 'off')
  })

  it('pauses rotation while keyboard focus is within the pagination controls', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    const secondBannerButton = screen.getByRole('button', { name: '02 Second banner' })
    fireEvent.focus(secondBannerButton)
    expect(mockAutoplay.stop).toHaveBeenCalledOnce()

    fireEvent.blur(secondBannerButton)
    expect(mockAutoplay.play).toHaveBeenCalledOnce()
  })

  it('does not resume an autoplay plugin that was already inactive before focus', () => {
    mockAutoplayPlaying = false
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    const secondBannerButton = screen.getByRole('button', { name: '02 Second banner' })
    fireEvent.focus(secondBannerButton)
    fireEvent.blur(secondBannerButton)

    expect(mockAutoplay.stop).not.toHaveBeenCalled()
    expect(mockAutoplay.play).not.toHaveBeenCalled()
  })

  it('does not render rotation controls for one banner', () => {
    render(<Banner banners={[createMockBanner('1', 'enabled', 'Only banner')]} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('tracks each enabled banner impression once as selection changes', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'explore_banner_impression',
      expect.objectContaining({ banner_id: '1', sort: 1 }),
    )

    act(() => setMockSelectedIndex(1))
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'explore_banner_impression',
      expect.objectContaining({ banner_id: '2', sort: 2 }),
    )

    act(() => setMockSelectedIndex(0))
    expect(mockTrackEvent).toHaveBeenCalledTimes(2)
  })

  it('passes tracking context to each banner item', () => {
    render(<Banner banners={[createMockBanner('1')]} />)

    expect(screen.getByTestId('banner-item')).toHaveAttribute('data-sort', '1')
    expect(screen.getByTestId('banner-item')).toHaveAttribute('data-language', 'en-US')
    expect(screen.getByTestId('banner-item')).toHaveAttribute('data-account-id', 'account-123')
  })

  it('does not track impressions without an account id', () => {
    mockConsoleState.userProfile = { id: '', name: '' }
    render(<Banner banners={[createMockBanner('1')]} />)

    expect(mockTrackEvent).not.toHaveBeenCalled()
  })
})

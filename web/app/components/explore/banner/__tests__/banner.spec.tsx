import type { Banner as BannerType } from '@/models/app'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const mockAppContextState = vi.hoisted(() => ({
  userProfile: {
    id: 'account-123',
    name: 'Evan',
  },
}))

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

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } =
    await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

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
  }: {
    banner: BannerType
    sort: number
    language: string
    accountId?: string
  }) => (
    <article
      data-testid="banner-item"
      data-banner-id={banner.id}
      data-sort={sort}
      data-language={language}
      data-account-id={accountId}
    >
      {banner.content.title}
    </article>
  ),
}))

const createMockBanner = (
  id: string,
  status: string = 'enabled',
  title: string = 'Test Banner',
): BannerType =>
  ({
    id,
    status,
    link: 'https://example.com',
    content: {
      category: 'Featured',
      title,
      description: 'Test description',
      'img-src': `https://example.com/image-${id}.png`,
    },
  }) as BannerType

describe('Banner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelectedIndex = 0
    mockAutoplayPlaying = true
    mockCarouselListeners.clear()
    mockAutoplayListeners.play.clear()
    mockAutoplayListeners.stop.clear()
    mockAppContextState.userProfile = { id: 'account-123', name: 'Evan' }
  })

  afterEach(cleanup)

  it('renders the greeting shell without a carousel when no enabled banner exists', () => {
    render(<Banner banners={[createMockBanner('1', 'disabled')]} />)

    expect(screen.getByText('Welcome back, Evan👋')).toBeInTheDocument()
    expect(screen.getByText('What if… this is where your next idea begins.')).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('labels the carousel and renders only enabled banners', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'disabled', 'Hidden banner'),
          createMockBanner('3', 'enabled', 'Second banner'),
        ]}
      />,
    )

    expect(screen.getByRole('region', { name: 'Featured' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'pagination.pageNumber' })).toBeInTheDocument()
    expect(screen.getAllByTestId('banner-item')).toHaveLength(2)
    expect(screen.queryByText('Hidden banner')).not.toBeInTheDocument()
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

  it('stops autoplay when pointer selection does not move focus', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '02 Second banner' }))

    expect(mockAutoplay.stop).toHaveBeenCalledOnce()
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

    expect(mockAutoplay.stop).toHaveBeenCalledOnce()
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

  it('stops rotation after keyboard focus enters the pagination controls', () => {
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
    mockAppContextState.userProfile = { id: '', name: '' }
    render(<Banner banners={[createMockBanner('1')]} />)

    expect(mockTrackEvent).not.toHaveBeenCalled()
  })
})

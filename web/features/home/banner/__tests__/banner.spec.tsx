import type { BannerResponse } from '@dify/contracts/api/console/explore/types.gen'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { Banner } from '../banner'

const mockTrackEvent = vi.fn()
let mockSelectedIndex = 0
let mockAutoplayPlaying = true
const mockCarouselListeners = new Set<(api?: unknown) => void>()
const mockAutoplayListeners = {
  play: new Set<() => void>(),
  stop: new Set<() => void>(),
  reInit: new Set<() => void>(),
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
  play: () => {
    mockAutoplayPlaying = true
    emitAutoplay('play')
  },
  stop: () => {
    mockAutoplayPlaying = false
    emitAutoplay('stop')
  },
}

const mockApi = {
  plugins: () => ({ autoplay: mockAutoplay }),
  selectedScrollSnap: () => mockSelectedIndex,
  canScrollPrev: () => mockSelectedIndex > 0,
  canScrollNext: () => mockSelectedIndex < 1,
  scrollTo: (index: number) => {
    mockSelectedIndex = index
    mockCarouselListeners.forEach((listener) => listener(mockApi))
  },
  on: vi.fn((event: string, listener: () => void) => {
    if (event === 'autoplay:play') mockAutoplayListeners.play.add(listener)
    if (event === 'autoplay:stop') mockAutoplayListeners.stop.add(listener)
    if (event === 'reInit') mockAutoplayListeners.reInit.add(listener)
    if (event === 'select') mockCarouselListeners.add(listener)
    return mockApi
  }),
  off: vi.fn((event: string, listener: () => void) => {
    if (event === 'autoplay:play') mockAutoplayListeners.play.delete(listener)
    if (event === 'autoplay:stop') mockAutoplayListeners.stop.delete(listener)
    if (event === 'reInit') mockAutoplayListeners.reInit.delete(listener)
    if (event === 'select') mockCarouselListeners.delete(listener)
    return mockApi
  }),
}

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('react-i18next', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      i18n: { language: 'en-US' },
      t: withSelectorKey((key: string) => {
        return key
      }),
    }),
  }
})

// Embla is the external layout/animation boundary. The production Carousel owns
// its context, SDK subscriptions and selectedIndex updates.
vi.mock('embla-carousel-react', () => ({ default: () => [() => undefined, mockApi] }))
const carousel = () => screen.getByRole('region', { name: 'banner.carouselLabel' })
const liveRegion = () => carousel().querySelector('[aria-live]')

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
    mockSelectedIndex = 0
    mockAutoplayPlaying = true
    mockCarouselListeners.clear()
    mockAutoplayListeners.play.clear()
    mockAutoplayListeners.stop.clear()
    mockAutoplayListeners.reInit.clear()
    mockConsoleState.userProfile = { id: 'account-123', name: 'Evan' }
  })

  it('renders nothing when there are no banners', () => {
    render(<Banner banners={[]} />)

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

    expect(screen.getByRole('region', { name: 'banner.carouselLabel' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'pagination.pageNumber' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'First banner' })).toHaveAttribute(
      'href',
      'https://example.com',
    )
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

    const [firstSlide, secondSlide] = screen
      .getAllByRole('group', { hidden: true })
      .filter((group) => group.hasAttribute('aria-hidden'))
    expect(firstSlide).toHaveAttribute('aria-hidden', 'false')
    expect(firstSlide).not.toHaveAttribute('inert')
    expect(secondSlide).toHaveAttribute('aria-hidden', 'true')
    expect(secondSlide).toHaveAttribute('inert')
    act(() => mockApi.scrollTo(1))
    expect(firstSlide).toHaveAttribute('inert')
    expect(secondSlide).not.toHaveAttribute('inert')
    expect(screen.getByRole('link', { name: 'Second banner' })).toBeInTheDocument()
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

    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'banner.stopRotation' })).toBeInTheDocument()
    const secondBannerButton = screen.getByRole('button', { name: '02 Second banner' })
    secondBannerButton.focus()
    fireEvent.click(secondBannerButton)
    expect(screen.getByRole('button', { name: '02 Second banner' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('link', { name: 'Second banner' })).toBeInTheDocument()

    expect(secondBannerButton).toHaveFocus()
    expect(screen.getAllByRole('button')).toHaveLength(3)
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

    expect(screen.getByRole('button', { name: '02 Second banner' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('link', { name: 'Second banner' })).toBeInTheDocument()
    expect(liveRegion()).toHaveAttribute('aria-live', 'off')
  })

  it('does not control an inactive autoplay plugin during manual selection', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )
    act(() => mockAutoplay.stop())

    fireEvent.click(screen.getByRole('button', { name: '02 Second banner' }))

    expect(screen.getByRole('button', { name: '02 Second banner' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('link', { name: 'Second banner' })).toBeInTheDocument()
    expect(liveRegion()).toHaveAttribute('aria-live', 'polite')
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
    expect(liveRegion()).toHaveAttribute('aria-live', 'polite')
    act(() => mockAutoplay.play())
    expect(liveRegion()).toHaveAttribute('aria-live', 'off')
  })

  it('keeps the pause action while pointer hover temporarily pauses rotation', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    fireEvent.pointerOver(carousel())
    expect(liveRegion()).toHaveAttribute('aria-live', 'polite')

    expect(screen.getByRole('button', { name: 'banner.stopRotation' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'banner.startRotation' })).not.toBeInTheDocument()

    fireEvent.pointerOut(carousel())
    expect(liveRegion()).toHaveAttribute('aria-live', 'off')

    expect(screen.getByRole('button', { name: 'banner.stopRotation' })).toBeInTheDocument()
  })

  it('keeps an explicit pause until the user starts rotation again', async () => {
    const user = userEvent.setup()
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'banner.stopRotation' }))

    expect(screen.getByRole('button', { name: 'banner.startRotation' })).toBeInTheDocument()
    expect(liveRegion()).toHaveAttribute('aria-live', 'polite')

    const secondBannerButton = screen.getByRole('button', { name: '02 Second banner' })
    fireEvent.focus(secondBannerButton)
    fireEvent.blur(secondBannerButton)

    await user.click(screen.getByRole('button', { name: 'banner.startRotation' }))

    expect(screen.getByRole('button', { name: 'banner.stopRotation' })).toBeInTheDocument()
    expect(liveRegion()).toHaveAttribute('aria-live', 'polite')

    await user.unhover(carousel())

    expect(liveRegion()).toHaveAttribute('aria-live', 'off')
  })

  it('stops rotation when keyboard focus enters and does not restart on blur', () => {
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
    expect(screen.getByRole('button', { name: 'banner.startRotation' })).toBeInTheDocument()

    fireEvent.blur(secondBannerButton)
    expect(liveRegion()).toHaveAttribute('aria-live', 'polite')
  })

  it('restores enabled rotation after an Embla reinitialization', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )

    act(() => {
      mockAutoplayPlaying = false
      mockAutoplayListeners.reInit.forEach((listener) => listener())
    })

    expect(screen.getByRole('button', { name: 'banner.stopRotation' })).toBeInTheDocument()
    expect(liveRegion()).toHaveAttribute('aria-live', 'off')
  })

  it('does not resume an autoplay plugin that was already inactive before focus', () => {
    render(
      <Banner
        banners={[
          createMockBanner('1', 'enabled', 'First banner'),
          createMockBanner('2', 'enabled', 'Second banner'),
        ]}
      />,
    )
    act(() => mockAutoplay.stop())

    const secondBannerButton = screen.getByRole('button', { name: '02 Second banner' })
    fireEvent.focus(secondBannerButton)
    fireEvent.blur(secondBannerButton)
  })

  it('does not render rotation controls for one banner', () => {
    render(<Banner banners={[createMockBanner('1', 'enabled', 'Only banner')]} />)

    expect(screen.queryByRole('button', { name: /Rotation/ })).not.toBeInTheDocument()
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
      expect.objectContaining({
        banner_id: '1',
        sort: 1,
        language: 'en-US',
        account_id: 'account-123',
      }),
    )

    act(() => mockApi.scrollTo(1))
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'explore_banner_impression',
      expect.objectContaining({ banner_id: '2', sort: 2 }),
    )

    act(() => mockApi.scrollTo(0))
    expect(mockTrackEvent).toHaveBeenCalledTimes(2)
  })

  it('does not track impressions without an account id', () => {
    mockConsoleState.userProfile = { id: '', name: '' }
    render(<Banner banners={[createMockBanner('1')]} />)

    expect(mockTrackEvent).not.toHaveBeenCalled()
  })
})

import type { Banner as BannerType } from '@/models/app'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Banner from '../banner'

const mockUseGetBanners = vi.fn()
const mockTrackEvent = vi.fn()
let mockSelectedIndex = 0
const mockCarouselListeners = new Set<() => void>()
const mockAppContextState = vi.hoisted(() => ({
  userProfile: {
    id: 'account-123',
    name: 'Evan',
  },
}))

const setMockSelectedIndex = (index: number) => {
  mockSelectedIndex = index
  mockCarouselListeners.forEach(listener => listener())
}
vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('react-i18next', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return ({
    useTranslation: () => ({
      i18n: { language: 'en-US' },
      t: withSelectorKey((key: string, opts?: Record<string, unknown>) => {
        if (key === 'banner.greeting')
          return `Welcome back, ${opts?.name} 👋`
        if (key === 'banner.tagline')
          return 'What if… this is where your next idea begins.'
        return key
      }),
    }),
  })
})

vi.mock('@/app/components/base/carousel', () => ({
  Carousel: Object.assign(
    ({ children, className }: {
      children: React.ReactNode
      className?: string
    }) => (
      <div
        data-testid="carousel"
        className={className}
      >
        {children}
      </div>
    ),
    {
      Content: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="carousel-content">{children}</div>
      ),
      Item: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="carousel-item">{children}</div>
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

    return {
      api: {
        scrollTo: vi.fn(),
        slideNodes: () => [],
      },
      selectedIndex,
    }
  },
}))

vi.mock('../banner-item', () => ({
  BannerItem: ({ banner, autoplayDelay, isPaused, sort, language, accountId }: {
    banner: BannerType
    autoplayDelay: number
    sort: number
    language: string
    accountId?: string
    isPaused?: boolean
  }) => (
    <div
      data-testid="banner-item"
      data-banner-id={banner.id}
      data-autoplay-delay={autoplayDelay}
      data-is-paused={isPaused}
      data-sort={sort}
      data-language={language}
      data-account-id={accountId}
    >
      BannerItem:
      {' '}
      {banner.content.title}
    </div>
  ),
}))

const createMockBanner = (id: string, status: string = 'enabled', title: string = 'Test Banner'): BannerType => ({
  id,
  status,
  link: 'https://example.com',
  content: {
    'category': 'Featured',
    title,
    'description': 'Test description',
    'img-src': `https://example.com/image-${id}.png`,
  },
} as BannerType)

const renderBanner = () => {
  const query = mockUseGetBanners()
  return render(<Banner banners={query.data ?? []} />)
}

describe('Banner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockSelectedIndex = 0
    mockCarouselListeners.clear()
    mockAppContextState.userProfile = {
      id: 'account-123',
      name: 'Evan',
    }
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  describe('data boundary', () => {
    it('renders the greeting shell without local loading UI when parent passes no banners', () => {
      mockUseGetBanners.mockReturnValue({
        data: null,
        isLoading: true,
        isError: false,
      })

      renderBanner()

      expect(screen.getByText('Welcome back, Evan 👋')).toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'loading' })).not.toBeInTheDocument()
      expect(screen.queryByTestId('carousel')).not.toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('renders the greeting shell without slider when isError is true', () => {
      mockUseGetBanners.mockReturnValue({
        data: null,
        isLoading: false,
        isError: true,
      })

      renderBanner()

      expect(screen.getByText('Welcome back, Evan 👋')).toBeInTheDocument()
      expect(screen.queryByTestId('carousel')).not.toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('renders the greeting shell without slider when banners array is empty', () => {
      mockUseGetBanners.mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      expect(screen.getByText('Welcome back, Evan 👋')).toBeInTheDocument()
      expect(screen.queryByTestId('carousel')).not.toBeInTheDocument()
    })

    it('renders the greeting shell without slider when all banners are disabled', () => {
      mockUseGetBanners.mockReturnValue({
        data: [
          createMockBanner('1', 'disabled'),
          createMockBanner('2', 'disabled'),
        ],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      expect(screen.getByText('Welcome back, Evan 👋')).toBeInTheDocument()
      expect(screen.queryByTestId('carousel')).not.toBeInTheDocument()
    })

    it('renders the greeting shell without slider when data is undefined', () => {
      mockUseGetBanners.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      })

      renderBanner()

      expect(screen.getByText('Welcome back, Evan 👋')).toBeInTheDocument()
      expect(screen.queryByTestId('carousel')).not.toBeInTheDocument()
    })
  })

  describe('greeting section', () => {
    it('renders static greeting with user name', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      expect(screen.getByText('Welcome back, Evan 👋')).toBeInTheDocument()
    })

    it('renders tagline', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      expect(screen.getByText('What if… this is where your next idea begins.')).toBeInTheDocument()
    })

    it('greeting does not change when carousel slides', () => {
      mockUseGetBanners.mockReturnValue({
        data: [
          createMockBanner('1', 'enabled', 'Banner 1'),
          createMockBanner('2', 'enabled', 'Banner 2'),
        ],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      expect(screen.getByText('Welcome back, Evan 👋')).toBeInTheDocument()

      act(() => {
        setMockSelectedIndex(1)
      })

      expect(screen.getByText('Welcome back, Evan 👋')).toBeInTheDocument()
    })
  })

  describe('successful render', () => {
    it('renders carousel when enabled banners exist', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      expect(screen.getByTestId('carousel')).toBeInTheDocument()
    })

    it('renders only enabled banners', () => {
      mockUseGetBanners.mockReturnValue({
        data: [
          createMockBanner('1', 'enabled', 'Enabled Banner 1'),
          createMockBanner('2', 'disabled', 'Disabled Banner'),
          createMockBanner('3', 'enabled', 'Enabled Banner 2'),
        ],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      const bannerItems = screen.getAllByTestId('banner-item')
      expect(bannerItems).toHaveLength(2)
      expect(screen.getByText('BannerItem: Enabled Banner 1')).toBeInTheDocument()
      expect(screen.getByText('BannerItem: Enabled Banner 2')).toBeInTheDocument()
      expect(screen.queryByText('BannerItem: Disabled Banner')).not.toBeInTheDocument()
    })

    it('passes correct autoplayDelay to BannerItem', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      const bannerItem = screen.getByTestId('banner-item')
      expect(bannerItem).toHaveAttribute('data-autoplay-delay', '5000')
    })

    it('tracks only the current banner impression and reports the next one after slide changes', () => {
      mockUseGetBanners.mockReturnValue({
        data: [
          createMockBanner('1', 'enabled', 'Enabled Banner 1'),
          createMockBanner('2', 'disabled', 'Disabled Banner'),
          createMockBanner('3', 'enabled', 'Enabled Banner 2'),
        ],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      expect(mockTrackEvent).toHaveBeenCalledTimes(1)
      expect(mockTrackEvent).toHaveBeenNthCalledWith(1, 'explore_banner_impression', expect.objectContaining({
        banner_id: '1',
        title: 'Enabled Banner 1',
        sort: 1,
        link: 'https://example.com',
        page: 'explore',
        language: 'en-US',
        account_id: 'account-123',
        event_time: expect.any(Number),
      }))

      act(() => {
        setMockSelectedIndex(1)
      })

      expect(mockTrackEvent).toHaveBeenCalledTimes(2)
      expect(mockTrackEvent).toHaveBeenNthCalledWith(2, 'explore_banner_impression', expect.objectContaining({
        banner_id: '3',
        title: 'Enabled Banner 2',
        sort: 2,
        link: 'https://example.com',
        page: 'explore',
        language: 'en-US',
        account_id: 'account-123',
        event_time: expect.any(Number),
      }))
    })

    it('does not track impressions when account id is unavailable', () => {
      mockAppContextState.userProfile = {
        id: '',
        name: '',
      }
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled', 'Enabled Banner 1')],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      expect(mockTrackEvent).not.toHaveBeenCalled()
    })
  })

  describe('hover behavior', () => {
    it('sets isPaused to true on mouse enter', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      const wrapper = screen.getByText('Welcome back, Evan 👋').closest('.relative')!
      fireEvent.mouseEnter(wrapper)

      const bannerItem = screen.getByTestId('banner-item')
      expect(bannerItem).toHaveAttribute('data-is-paused', 'true')
    })

    it('sets isPaused to false on mouse leave', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      const wrapper = screen.getByText('Welcome back, Evan 👋').closest('.relative')!

      fireEvent.mouseEnter(wrapper)
      fireEvent.mouseLeave(wrapper)

      const bannerItem = screen.getByTestId('banner-item')
      expect(bannerItem).toHaveAttribute('data-is-paused', 'false')
    })
  })

  describe('resize behavior', () => {
    it('pauses animation during resize', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      const bannerItem = screen.getByTestId('banner-item')
      expect(bannerItem).toHaveAttribute('data-is-paused', 'true')
    })

    it('resumes animation after resize debounce delay', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      act(() => {
        vi.advanceTimersByTime(50)
      })

      const bannerItem = screen.getByTestId('banner-item')
      expect(bannerItem).toHaveAttribute('data-is-paused', 'false')
    })

    it('resets debounce timer on multiple resize events', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      act(() => {
        vi.advanceTimersByTime(30)
      })

      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      act(() => {
        vi.advanceTimersByTime(30)
      })

      let bannerItem = screen.getByTestId('banner-item')
      expect(bannerItem).toHaveAttribute('data-is-paused', 'true')

      act(() => {
        vi.advanceTimersByTime(20)
      })

      bannerItem = screen.getByTestId('banner-item')
      expect(bannerItem).toHaveAttribute('data-is-paused', 'false')
    })
  })

  describe('cleanup', () => {
    it('removes resize event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      const { unmount } = renderBanner()
      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
      removeEventListenerSpy.mockRestore()
    })

    it('clears resize timer on unmount', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      const { unmount } = renderBanner()

      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      unmount()

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })
  })

  describe('props', () => {
    it('renders the provided banners without fetching them locally', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled', 'Provided Banner')],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      expect(screen.getByText('BannerItem: Provided Banner')).toBeInTheDocument()
    })
  })

  describe('multiple banners', () => {
    it('renders all enabled banners in carousel items', () => {
      mockUseGetBanners.mockReturnValue({
        data: [
          createMockBanner('1', 'enabled', 'Banner 1'),
          createMockBanner('2', 'enabled', 'Banner 2'),
          createMockBanner('3', 'enabled', 'Banner 3'),
        ],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      const carouselItems = screen.getAllByTestId('carousel-item')
      expect(carouselItems).toHaveLength(3)
    })

    it('preserves banner order', () => {
      mockUseGetBanners.mockReturnValue({
        data: [
          createMockBanner('1', 'enabled', 'First Banner'),
          createMockBanner('2', 'enabled', 'Second Banner'),
          createMockBanner('3', 'enabled', 'Third Banner'),
        ],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      const bannerItems = screen.getAllByTestId('banner-item')
      expect(bannerItems[0]).toHaveAttribute('data-banner-id', '1')
      expect(bannerItems[0]).toHaveAttribute('data-sort', '1')
      expect(bannerItems[1]).toHaveAttribute('data-banner-id', '2')
      expect(bannerItems[1]).toHaveAttribute('data-sort', '2')
      expect(bannerItems[2]).toHaveAttribute('data-banner-id', '3')
      expect(bannerItems[2]).toHaveAttribute('data-sort', '3')
    })

    it('passes tracking context to banner item', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled', 'Banner 1')],
        isLoading: false,
        isError: false,
      })

      renderBanner()

      const bannerItem = screen.getByTestId('banner-item')
      expect(bannerItem).toHaveAttribute('data-language', 'en-US')
      expect(bannerItem).toHaveAttribute('data-account-id', 'account-123')
    })
  })

  describe('React.memo behavior', () => {
    it('renders as memoized component', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      const { rerender } = renderBanner()

      rerender(<Banner banners={mockUseGetBanners().data ?? []} />)

      expect(screen.getByTestId('carousel')).toBeInTheDocument()
    })
  })
})

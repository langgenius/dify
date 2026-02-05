import type * as React from 'react'
import type { Banner as BannerType } from '@/models/app'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Banner from './banner'

const mockUseGetBanners = vi.fn()

vi.mock('@/service/use-explore', () => ({
  useGetBanners: (...args: unknown[]) => mockUseGetBanners(...args),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/app/components/base/carousel', () => ({
  Carousel: Object.assign(
    ({ children, onMouseEnter, onMouseLeave, className }: {
      children: React.ReactNode
      onMouseEnter?: () => void
      onMouseLeave?: () => void
      className?: string
    }) => (
      <div
        data-testid="carousel"
        className={className}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
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
      },
    },
  ),
  useCarousel: () => ({
    api: {
      scrollTo: vi.fn(),
      slideNodes: () => [],
    },
    selectedIndex: 0,
  }),
}))

vi.mock('./banner-item', () => ({
  BannerItem: ({ banner, autoplayDelay, isPaused }: {
    banner: BannerType
    autoplayDelay: number
    isPaused?: boolean
  }) => (
    <div
      data-testid="banner-item"
      data-banner-id={banner.id}
      data-autoplay-delay={autoplayDelay}
      data-is-paused={isPaused}
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
    'img-src': 'https://example.com/image.png',
  },
} as BannerType)

describe('Banner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe('loading state', () => {
    it('renders loading state when isLoading is true', () => {
      mockUseGetBanners.mockReturnValue({
        data: null,
        isLoading: true,
        isError: false,
      })

      render(<Banner />)

      // Loading component renders a spinner
      const loadingWrapper = document.querySelector('[style*="min-height"]')
      expect(loadingWrapper).toBeInTheDocument()
    })

    it('shows loading indicator with correct minimum height', () => {
      mockUseGetBanners.mockReturnValue({
        data: null,
        isLoading: true,
        isError: false,
      })

      render(<Banner />)

      const loadingWrapper = document.querySelector('[style*="min-height: 168px"]')
      expect(loadingWrapper).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('returns null when isError is true', () => {
      mockUseGetBanners.mockReturnValue({
        data: null,
        isLoading: false,
        isError: true,
      })

      const { container } = render(<Banner />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('empty state', () => {
    it('returns null when banners array is empty', () => {
      mockUseGetBanners.mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
      })

      const { container } = render(<Banner />)

      expect(container.firstChild).toBeNull()
    })

    it('returns null when all banners are disabled', () => {
      mockUseGetBanners.mockReturnValue({
        data: [
          createMockBanner('1', 'disabled'),
          createMockBanner('2', 'disabled'),
        ],
        isLoading: false,
        isError: false,
      })

      const { container } = render(<Banner />)

      expect(container.firstChild).toBeNull()
    })

    it('returns null when data is undefined', () => {
      mockUseGetBanners.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      })

      const { container } = render(<Banner />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('successful render', () => {
    it('renders carousel when enabled banners exist', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      render(<Banner />)

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

      render(<Banner />)

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

      render(<Banner />)

      const bannerItem = screen.getByTestId('banner-item')
      expect(bannerItem).toHaveAttribute('data-autoplay-delay', '5000')
    })

    it('renders carousel with correct class', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      render(<Banner />)

      expect(screen.getByTestId('carousel')).toHaveClass('rounded-2xl')
    })
  })

  describe('hover behavior', () => {
    it('sets isPaused to true on mouse enter', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      render(<Banner />)

      const carousel = screen.getByTestId('carousel')
      fireEvent.mouseEnter(carousel)

      const bannerItem = screen.getByTestId('banner-item')
      expect(bannerItem).toHaveAttribute('data-is-paused', 'true')
    })

    it('sets isPaused to false on mouse leave', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      render(<Banner />)

      const carousel = screen.getByTestId('carousel')

      // Enter and then leave
      fireEvent.mouseEnter(carousel)
      fireEvent.mouseLeave(carousel)

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

      render(<Banner />)

      // Trigger resize event
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

      render(<Banner />)

      // Trigger resize event
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      // Wait for debounce delay (50ms)
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

      render(<Banner />)

      // Trigger first resize event
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      // Wait partial time
      act(() => {
        vi.advanceTimersByTime(30)
      })

      // Trigger second resize event
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      // Wait another 30ms (total 60ms from second resize but only 30ms after)
      act(() => {
        vi.advanceTimersByTime(30)
      })

      // Should still be paused (debounce resets)
      let bannerItem = screen.getByTestId('banner-item')
      expect(bannerItem).toHaveAttribute('data-is-paused', 'true')

      // Wait remaining time
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

      const { unmount } = render(<Banner />)
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

      const { unmount } = render(<Banner />)

      // Trigger resize to create timer
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      unmount()

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })
  })

  describe('hook calls', () => {
    it('calls useGetBanners with correct locale', () => {
      mockUseGetBanners.mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
      })

      render(<Banner />)

      expect(mockUseGetBanners).toHaveBeenCalledWith('en-US')
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

      render(<Banner />)

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

      render(<Banner />)

      const bannerItems = screen.getAllByTestId('banner-item')
      expect(bannerItems[0]).toHaveAttribute('data-banner-id', '1')
      expect(bannerItems[1]).toHaveAttribute('data-banner-id', '2')
      expect(bannerItems[2]).toHaveAttribute('data-banner-id', '3')
    })
  })

  describe('React.memo behavior', () => {
    it('renders as memoized component', () => {
      mockUseGetBanners.mockReturnValue({
        data: [createMockBanner('1', 'enabled')],
        isLoading: false,
        isError: false,
      })

      const { rerender } = render(<Banner />)

      // Re-render with same props
      rerender(<Banner />)

      // Component should still be present (memo doesn't break rendering)
      expect(screen.getByTestId('carousel')).toBeInTheDocument()
    })
  })
})

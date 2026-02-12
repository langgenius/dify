import type { Banner } from '@/models/app'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BannerItem } from '../banner-item'

const mockScrollTo = vi.fn()
const mockSlideNodes = vi.fn()

vi.mock('@/app/components/base/carousel', () => ({
  useCarousel: () => ({
    api: {
      scrollTo: mockScrollTo,
      slideNodes: mockSlideNodes,
    },
    selectedIndex: 0,
  }),
}))

const createMockBanner = (overrides: Partial<Banner> = {}): Banner => ({
  id: 'banner-1',
  status: 'enabled',
  link: 'https://example.com',
  content: {
    'category': 'Featured',
    'title': 'Test Banner Title',
    'description': 'Test banner description text',
    'img-src': 'https://example.com/image.png',
  },
  ...overrides,
} as Banner)

const mockResizeObserverObserve = vi.fn()
const mockResizeObserverDisconnect = vi.fn()

class MockResizeObserver {
  constructor(_callback: ResizeObserverCallback) {
  }

  observe(...args: Parameters<ResizeObserver['observe']>) {
    mockResizeObserverObserve(...args)
  }

  disconnect() {
    mockResizeObserverDisconnect()
  }

  unobserve() {
  }
}

describe('BannerItem', () => {
  let mockWindowOpen: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockWindowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    mockSlideNodes.mockReturnValue([{}, {}, {}]) // 3 slides

    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1400, // Above RESPONSIVE_BREAKPOINT (1200)
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mockWindowOpen.mockRestore()
  })

  describe('basic rendering', () => {
    it('renders banner category', () => {
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      expect(screen.getByText('Featured')).toBeInTheDocument()
    })

    it('renders banner title', () => {
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      expect(screen.getByText('Test Banner Title')).toBeInTheDocument()
    })

    it('renders banner description', () => {
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      expect(screen.getByText('Test banner description text')).toBeInTheDocument()
    })

    it('renders banner image with correct src and alt', () => {
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      const image = screen.getByRole('img')
      expect(image).toHaveAttribute('src', 'https://example.com/image.png')
      expect(image).toHaveAttribute('alt', 'Test Banner Title')
    })

    it('renders view more text', () => {
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      expect(screen.getByText('explore.banner.viewMore')).toBeInTheDocument()
    })
  })

  describe('click handling', () => {
    it('opens banner link in new tab when clicked', () => {
      const banner = createMockBanner({ link: 'https://test-link.com' })
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      const bannerElement = screen.getByText('Test Banner Title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(bannerElement!)

      expect(mockWindowOpen).toHaveBeenCalledWith(
        'https://test-link.com',
        '_blank',
        'noopener,noreferrer',
      )
    })

    it('does not open window when banner has no link', () => {
      const banner = createMockBanner({ link: '' })
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      const bannerElement = screen.getByText('Test Banner Title').closest('div[class*="cursor-pointer"]')
      fireEvent.click(bannerElement!)

      expect(mockWindowOpen).not.toHaveBeenCalled()
    })
  })

  describe('slide indicators', () => {
    it('renders correct number of indicator buttons', () => {
      mockSlideNodes.mockReturnValue([{}, {}, {}])
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(3)
    })

    it('renders indicator buttons with correct numbers', () => {
      mockSlideNodes.mockReturnValue([{}, {}, {}])
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      expect(screen.getByText('01')).toBeInTheDocument()
      expect(screen.getByText('02')).toBeInTheDocument()
      expect(screen.getByText('03')).toBeInTheDocument()
    })

    it('calls scrollTo when indicator is clicked', () => {
      mockSlideNodes.mockReturnValue([{}, {}, {}])
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      const secondIndicator = screen.getByText('02').closest('button')
      fireEvent.click(secondIndicator!)

      expect(mockScrollTo).toHaveBeenCalledWith(1)
    })

    it('renders no indicators when no slides', () => {
      mockSlideNodes.mockReturnValue([])
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('isPaused prop', () => {
    it('defaults isPaused to false', () => {
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      expect(screen.getByText('Test Banner Title')).toBeInTheDocument()
    })

    it('accepts isPaused prop', () => {
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
          isPaused={true}
        />,
      )

      expect(screen.getByText('Test Banner Title')).toBeInTheDocument()
    })
  })

  describe('responsive behavior', () => {
    it('sets up ResizeObserver on mount', () => {
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      expect(mockResizeObserverObserve).toHaveBeenCalled()
    })

    it('adds resize event listener on mount', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
      addEventListenerSpy.mockRestore()
    })

    it('removes resize event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
      const banner = createMockBanner()
      const { unmount } = render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
      removeEventListenerSpy.mockRestore()
    })

    it('sets maxWidth when window width is below breakpoint', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1000,
      })

      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      expect(screen.getByText('Test Banner Title')).toBeInTheDocument()
    })

    it('applies responsive styles when below breakpoint', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 800,
      })

      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      expect(screen.getByText('explore.banner.viewMore')).toBeInTheDocument()
    })
  })

  describe('content variations', () => {
    it('renders long category text', () => {
      const banner = createMockBanner({
        content: {
          'category': 'Very Long Category Name',
          'title': 'Title',
          'description': 'Description',
          'img-src': 'https://example.com/img.png',
        },
      } as Partial<Banner>)
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      expect(screen.getByText('Very Long Category Name')).toBeInTheDocument()
    })

    it('renders long title with truncation class', () => {
      const banner = createMockBanner({
        content: {
          'category': 'Category',
          'title': 'A Very Long Title That Should Be Truncated Eventually',
          'description': 'Description',
          'img-src': 'https://example.com/img.png',
        },
      } as Partial<Banner>)
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      const titleElement = screen.getByText('A Very Long Title That Should Be Truncated Eventually')
      expect(titleElement).toHaveClass('line-clamp-2')
    })

    it('renders long description with truncation class', () => {
      const banner = createMockBanner({
        content: {
          'category': 'Category',
          'title': 'Title',
          'description': 'A very long description that should be limited to a certain number of lines for proper display in the banner component.',
          'img-src': 'https://example.com/img.png',
        },
      } as Partial<Banner>)
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      const descriptionElement = screen.getByText(/A very long description/)
      expect(descriptionElement).toHaveClass('line-clamp-4')
    })
  })

  describe('slide calculation', () => {
    it('calculates next index correctly for first slide', () => {
      mockSlideNodes.mockReturnValue([{}, {}, {}])
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(3)
    })

    it('handles single slide case', () => {
      mockSlideNodes.mockReturnValue([{}])
      const banner = createMockBanner()
      render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(1)
    })
  })

  describe('wrapper styling', () => {
    it('has cursor-pointer class', () => {
      const banner = createMockBanner()
      const { container } = render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('cursor-pointer')
    })

    it('has rounded-2xl class', () => {
      const banner = createMockBanner()
      const { container } = render(
        <BannerItem
          banner={banner}
          autoplayDelay={5000}
        />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('rounded-2xl')
    })
  })
})

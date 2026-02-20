import type { Mock } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import useEmblaCarousel from 'embla-carousel-react'
import { Carousel, useCarousel } from './index'

vi.mock('embla-carousel-react', () => ({
  default: vi.fn(),
}))

type EmblaEventName = 'reInit' | 'select'
type EmblaListener = (api: MockEmblaApi | undefined) => void

type MockEmblaApi = {
  scrollPrev: Mock
  scrollNext: Mock
  scrollTo: Mock
  selectedScrollSnap: Mock
  canScrollPrev: Mock
  canScrollNext: Mock
  slideNodes: Mock
  on: Mock
  off: Mock
}

let mockCanScrollPrev = false
let mockCanScrollNext = false
let mockSelectedIndex = 0
let mockSlideCount = 3
let listeners: Record<EmblaEventName, EmblaListener[]>
let mockApi: MockEmblaApi
const mockCarouselRef = vi.fn()

const mockedUseEmblaCarousel = vi.mocked(useEmblaCarousel)

const createMockEmblaApi = (): MockEmblaApi => ({
  scrollPrev: vi.fn(),
  scrollNext: vi.fn(),
  scrollTo: vi.fn(),
  selectedScrollSnap: vi.fn(() => mockSelectedIndex),
  canScrollPrev: vi.fn(() => mockCanScrollPrev),
  canScrollNext: vi.fn(() => mockCanScrollNext),
  slideNodes: vi.fn(() =>
    Array.from({ length: mockSlideCount }, () => document.createElement('div')),
  ),
  on: vi.fn((event: EmblaEventName, callback: EmblaListener) => {
    listeners[event].push(callback)
  }),
  off: vi.fn((event: EmblaEventName, callback: EmblaListener) => {
    listeners[event] = listeners[event].filter(listener => listener !== callback)
  }),
})

const emitEmblaEvent = (event: EmblaEventName, api: MockEmblaApi | undefined = mockApi) => {
  listeners[event].forEach((callback) => {
    callback(api)
  })
}

const renderCarouselWithControls = (orientation: 'horizontal' | 'vertical' = 'horizontal') => {
  return render(
    <Carousel orientation={orientation}>
      <Carousel.Content data-testid="carousel-content">
        <Carousel.Item>Slide 1</Carousel.Item>
        <Carousel.Item>Slide 2</Carousel.Item>
        <Carousel.Item>Slide 3</Carousel.Item>
      </Carousel.Content>
      <Carousel.Previous>Prev</Carousel.Previous>
      <Carousel.Next>Next</Carousel.Next>
      <Carousel.Dot>Dot</Carousel.Dot>
    </Carousel>,
  )
}

const mockPlugin = () => ({
  name: 'mock',
  options: {},
  init: vi.fn(),
  destroy: vi.fn(),
})

describe('Carousel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanScrollPrev = false
    mockCanScrollNext = false
    mockSelectedIndex = 0
    mockSlideCount = 3
    listeners = { reInit: [], select: [] }
    mockApi = createMockEmblaApi()

    mockedUseEmblaCarousel.mockReturnValue(
      [mockCarouselRef, mockApi] as unknown as ReturnType<typeof useEmblaCarousel>,
    )
  })

  // Rendering and basic semantic structure.
  describe('Rendering', () => {
    it('should render region and slides when used with content and items', () => {
      renderCarouselWithControls()

      expect(screen.getByRole('region')).toHaveAttribute('aria-roledescription', 'carousel')
      expect(screen.getByTestId('carousel-content')).toHaveClass('flex')
      screen.getAllByRole('group').forEach((slide) => {
        expect(slide).toHaveAttribute('aria-roledescription', 'slide')
      })
    })
  })

  // Props should be translated into Embla options and visible layout.
  describe('Props', () => {
    it('should configure embla with horizontal axis when orientation is omitted', () => {
      const plugin = mockPlugin()
      render(
        <Carousel opts={{ loop: true }} plugins={[plugin]}>
          <Carousel.Content />
        </Carousel>,
      )

      expect(mockedUseEmblaCarousel).toHaveBeenCalledWith(
        { loop: true, axis: 'x' },
        [plugin],
      )
    })

    it('should configure embla with vertical axis and vertical content classes when orientation is vertical', () => {
      renderCarouselWithControls('vertical')

      expect(mockedUseEmblaCarousel).toHaveBeenCalledWith(
        { axis: 'y' },
        undefined,
      )
      expect(screen.getByTestId('carousel-content')).toHaveClass('flex-col')
    })
  })

  // Users can move slides through previous and next controls.
  describe('User interactions', () => {
    it('should call scroll handlers when previous and next buttons are clicked', () => {
      mockCanScrollPrev = true
      mockCanScrollNext = true

      renderCarouselWithControls()

      fireEvent.click(screen.getByRole('button', { name: 'Prev' }))
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))

      expect(mockApi.scrollPrev).toHaveBeenCalledTimes(1)
      expect(mockApi.scrollNext).toHaveBeenCalledTimes(1)
    })

    it('should call scrollTo with clicked index when a dot is clicked', () => {
      renderCarouselWithControls()
      const dots = screen.getAllByRole('button', { name: 'Dot' })

      fireEvent.click(dots[2])

      expect(mockApi.scrollTo).toHaveBeenCalledWith(2)
    })
  })

  // Embla events should keep control states and selected index in sync.
  describe('State synchronization', () => {
    it('should update disabled states and active dot when select event is emitted', () => {
      renderCarouselWithControls()

      mockCanScrollPrev = true
      mockCanScrollNext = true
      mockSelectedIndex = 2

      act(() => {
        emitEmblaEvent('select')
      })

      const dots = screen.getAllByRole('button', { name: 'Dot' })
      expect(screen.getByRole('button', { name: 'Prev' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
      expect(dots[2]).toHaveAttribute('data-state', 'active')
    })

    it('should subscribe to embla events and unsubscribe from select on unmount', () => {
      const { unmount } = renderCarouselWithControls()

      const selectCallback = mockApi.on.mock.calls.find(
        call => call[0] === 'select',
      )?.[1] as EmblaListener

      expect(mockApi.on).toHaveBeenCalledWith('reInit', expect.any(Function))
      expect(mockApi.on).toHaveBeenCalledWith('select', expect.any(Function))

      unmount()

      expect(mockApi.off).toHaveBeenCalledWith('select', selectCallback)
    })
  })

  // Edge-case behavior for missing providers or missing embla api values.
  describe('Edge cases', () => {
    it('should throw when useCarousel is used outside Carousel provider', () => {
      const InvalidConsumer = () => {
        useCarousel()
        return null
      }

      expect(() => render(<InvalidConsumer />)).toThrowError(
        'useCarousel must be used within a <Carousel />',
      )
    })

    it('should render with disabled controls and no dots when embla api is undefined', () => {
      mockedUseEmblaCarousel.mockReturnValue(
        [mockCarouselRef, undefined] as unknown as ReturnType<typeof useEmblaCarousel>,
      )

      renderCarouselWithControls()

      expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Dot' })).not.toBeInTheDocument()
    })

    it('should ignore select callback when embla emits an undefined api', () => {
      renderCarouselWithControls()

      expect(() => {
        act(() => {
          emitEmblaEvent('select', undefined)
        })
      }).not.toThrow()
    })
  })
})

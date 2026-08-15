import type { CarouselPage } from '../carousel'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Carousel from '../carousel'

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>()
  const carouselState = {
    scrollSnaps: [0, 1, 2, 3, 4],
    selectedIndex: 0,
  }
  const api = {
    off: vi.fn((event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener)
    }),
    on: vi.fn((event: string, listener: () => void) => {
      const eventListeners = listeners.get(event) ?? new Set()
      eventListeners.add(listener)
      listeners.set(event, eventListeners)
    }),
    scrollNext: vi.fn(),
    scrollPrev: vi.fn(),
    scrollSnapList: vi.fn(() => carouselState.scrollSnaps),
    scrollTo: vi.fn(),
    selectedScrollSnap: vi.fn(() => carouselState.selectedIndex),
  }
  const autoplayInstances: { play: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = []
  const autoplayOptions: Record<string, unknown>[] = []

  return {
    api,
    autoplayInstances,
    autoplayOptions,
    carouselState,
    emit: (event: string) => listeners.get(event)?.forEach((listener) => listener()),
    listeners,
  }
})

vi.mock('embla-carousel-react', () => ({
  default: () => [vi.fn(), mocks.api],
}))

vi.mock('embla-carousel-autoplay', () => ({
  default: (options: Record<string, unknown>) => {
    const instance = { play: vi.fn(), stop: vi.fn() }
    mocks.autoplayOptions.push(options)
    mocks.autoplayInstances.push(instance)
    return instance
  },
}))

const pages: CarouselPage[] = Array.from({ length: 5 }, (_, index) => ({
  id: `page-${index + 1}`,
  content: <div>Page content {index + 1}</div>,
}))

type IntersectionObserverRecord = {
  callback: IntersectionObserverCallback
  disconnect: ReturnType<typeof vi.fn>
  observe: ReturnType<typeof vi.fn>
  options?: IntersectionObserverInit
}

const intersectionObservers: IntersectionObserverRecord[] = []

class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  disconnect = vi.fn()
  observe = vi.fn()
  options?: IntersectionObserverInit
  root: Element | Document | null
  rootMargin: string
  takeRecords = vi.fn(() => [])
  thresholds: readonly number[]
  unobserve = vi.fn()

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    this.root = options?.root ?? null
    this.rootMargin = options?.rootMargin ?? '0px'
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0]
    intersectionObservers.push(this)
  }
}

const installIntersectionObserver = () => {
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
}

const triggerIntersection = (record: IntersectionObserverRecord, intersectionRatio: number) => {
  act(() => {
    record.callback(
      [
        {
          intersectionRatio,
          isIntersecting: intersectionRatio > 0,
        } as IntersectionObserverEntry,
      ],
      record as unknown as IntersectionObserver,
    )
  })
}

describe('Marketplace Carousel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listeners.clear()
    mocks.autoplayInstances.length = 0
    mocks.autoplayOptions.length = 0
    mocks.carouselState.scrollSnaps = [0, 1, 2, 3, 4]
    mocks.carouselState.selectedIndex = 0
    intersectionObservers.length = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps every slide shell while mounting only the current and adjacent pages', () => {
    const { rerender } = render(<Carousel pages={pages} deferMountPages />)

    expect(document.querySelectorAll('[data-carousel-page]')).toHaveLength(5)
    expect(document.querySelectorAll('[data-carousel-page-mounted="true"]')).toHaveLength(3)
    expect(screen.getByText('Page content 1')).toBeInTheDocument()
    expect(screen.getByText('Page content 2')).toBeInTheDocument()
    expect(screen.getByText('Page content 5')).toBeInTheDocument()
    expect(screen.queryByText('Page content 3')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 4' }))

    expect(screen.getByText('Page content 3')).toBeInTheDocument()
    expect(screen.getByText('Page content 4')).toBeInTheDocument()
    expect(mocks.api.scrollTo).toHaveBeenCalledWith(3)

    mocks.carouselState.selectedIndex = 3
    act(() => mocks.emit('select'))
    mocks.carouselState.selectedIndex = 0
    act(() => mocks.emit('select'))

    expect(screen.getByText('Page content 4')).toBeInTheDocument()

    rerender(<Carousel pages={pages.slice(0, 3)} deferMountPages />)

    expect(document.querySelectorAll('[data-carousel-page]')).toHaveLength(3)
    expect(screen.getByText('Page content 3')).toBeInTheDocument()
  })

  it('keeps eager consumers fully mounted and preserves loop navigation', () => {
    render(<Carousel pages={pages} />)

    expect(document.querySelectorAll('[data-carousel-page-mounted="true"]')).toHaveLength(5)

    fireEvent.click(screen.getByRole('button', { name: 'Scroll left' }))
    fireEvent.click(screen.getByRole('button', { name: 'Scroll right' }))

    expect(mocks.api.scrollPrev).toHaveBeenCalledOnce()
    expect(mocks.api.scrollNext).toHaveBeenCalledOnce()
  })

  it('plays managed autoplay only while the carousel is visible and motion is allowed', () => {
    installIntersectionObserver()
    const marketplaceContainer = document.createElement('div')
    marketplaceContainer.id = 'marketplace-container'
    document.body.appendChild(marketplaceContainer)
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

    const { unmount } = render(
      <Carousel pages={pages} autoPlay deferMountPages pauseWhenOffscreen />,
      { container: marketplaceContainer },
    )
    const autoplay = mocks.autoplayInstances[0]!
    const carousel = screen.getByRole('region')

    expect(mocks.autoplayOptions[0]).toMatchObject({
      playOnInit: false,
      stopOnInteraction: false,
      stopOnMouseEnter: false,
    })
    expect(intersectionObservers[0]!.options).toEqual({
      root: marketplaceContainer,
      threshold: 0.25,
    })
    expect(autoplay.stop).toHaveBeenCalled()

    triggerIntersection(intersectionObservers[0]!, 0.24)
    triggerIntersection(intersectionObservers[0]!, 0.25)
    expect(autoplay.play).toHaveBeenCalledOnce()

    fireEvent.mouseEnter(carousel)
    expect(autoplay.stop).toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    fireEvent(document, new Event('visibilitychange'))
    fireEvent.mouseLeave(carousel)
    expect(autoplay.play).toHaveBeenCalledOnce()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    fireEvent(document, new Event('visibilitychange'))
    expect(autoplay.play).toHaveBeenCalledTimes(2)

    reducedMotion = true
    act(() => reducedMotionListener?.())
    expect(autoplay.stop).toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    fireEvent(document, new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    fireEvent(document, new Event('visibilitychange'))
    expect(autoplay.play).toHaveBeenCalledTimes(2)

    reducedMotion = false
    act(() => reducedMotionListener?.())
    expect(autoplay.play).toHaveBeenCalledTimes(3)

    triggerIntersection(intersectionObservers[0]!, 0)
    expect(autoplay.stop).toHaveBeenCalled()

    unmount()
    marketplaceContainer.remove()
  })

  it('preserves standalone autoplay initialization', () => {
    render(<Carousel pages={pages} autoPlay />)

    expect(mocks.autoplayOptions[0]).toMatchObject({
      playOnInit: true,
      stopOnMouseEnter: true,
    })
    expect(intersectionObservers).toHaveLength(0)
  })

  it('honors reduced motion for the eagerly playing first-collection carousel', () => {
    let reducedMotion = true
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

    // The production first collection renders without pauseWhenOffscreen, so
    // the reduced-motion guard must work outside the viewport-managed path.
    render(<Carousel pages={pages} autoPlay />)
    const autoplay = mocks.autoplayInstances[0]!

    expect(autoplay.stop).toHaveBeenCalled()
    expect(autoplay.play).not.toHaveBeenCalled()

    reducedMotion = false
    act(() => reducedMotionListener?.())

    expect(autoplay.play).toHaveBeenCalled()
  })

  it('keeps off-screen pages out of the tab order and accessibility tree', () => {
    render(<Carousel pages={pages} ariaLabel="Featured tools" />)

    expect(screen.getByRole('region', { name: 'Featured tools' })).toBeInTheDocument()

    const slides = document.querySelectorAll('[data-carousel-page]')
    expect(slides[0]).toHaveAttribute('aria-roledescription', 'slide')
    expect(slides[0]).toHaveAttribute('aria-label', '1 / 5')
    expect(slides[0]).not.toHaveAttribute('aria-hidden', 'true')
    expect(slides[0]).not.toHaveAttribute('inert')
    expect(slides[1]).toHaveAttribute('aria-hidden', 'true')
    expect(slides[1]).toHaveAttribute('inert')

    mocks.carouselState.selectedIndex = 3
    act(() => mocks.emit('select'))

    expect(slides[0]).toHaveAttribute('aria-hidden', 'true')
    expect(slides[0]).toHaveAttribute('inert')
    expect(slides[3]).not.toHaveAttribute('aria-hidden', 'true')
    expect(slides[3]).not.toHaveAttribute('inert')
  })

  it('stops rotation when focus enters and resumes only from the play control', () => {
    render(<Carousel pages={pages} autoPlay />)
    const autoplay = mocks.autoplayInstances[0]!
    const carousel = screen.getByRole('region')

    const playsBeforeFocus = autoplay.play.mock.calls.length
    fireEvent.focusIn(carousel)

    expect(autoplay.stop).toHaveBeenCalled()
    expect(autoplay.play).toHaveBeenCalledTimes(playsBeforeFocus)

    // Moving focus around does not resume rotation on its own.
    fireEvent.focusIn(carousel)
    expect(autoplay.play).toHaveBeenCalledTimes(playsBeforeFocus)

    fireEvent.click(screen.getByRole('button', { name: 'plugin.marketplace.home.trendingPlay' }))
    expect(autoplay.play.mock.calls.length).toBeGreaterThan(playsBeforeFocus)

    const stopsBeforePause = autoplay.stop.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'plugin.marketplace.home.trendingPause' }))
    expect(autoplay.stop.mock.calls.length).toBeGreaterThan(stopsBeforePause)
  })

  it('does not start managed autoplay when the carousel has only one page', () => {
    installIntersectionObserver()
    mocks.carouselState.scrollSnaps = [0]

    render(<Carousel pages={pages.slice(0, 1)} autoPlay deferMountPages pauseWhenOffscreen />)
    const autoplay = mocks.autoplayInstances[0]!

    triggerIntersection(intersectionObservers[0]!, 1)

    expect(autoplay.play).not.toHaveBeenCalled()
  })
})

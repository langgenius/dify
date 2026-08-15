'use client'

/* oxlint-disable eslint-react/set-state-in-effect */
import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import Autoplay from 'embla-carousel-autoplay'
import useEmblaCarousel from 'embla-carousel-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '#i18n'
import { CAROUSEL_PAGE_CLASS } from './collection-constants'

export type CarouselPage = {
  id: string
  content: ReactNode
}

type CarouselProps = {
  pages: CarouselPage[]
  ariaLabel?: string
  className?: string
  showNavigation?: boolean
  showPagination?: boolean
  autoPlay?: boolean
  autoPlayInterval?: number
  deferMountPages?: boolean
  pauseWhenOffscreen?: boolean
}

type NavButtonProps = {
  direction: 'left' | 'right'
  disabled: boolean
  onClick: () => void
  iconClassName: string
}

const NavButton = ({ direction, disabled, onClick, iconClassName }: NavButtonProps) => (
  <button
    className={cn(
      'flex cursor-pointer items-center justify-center rounded-full border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg p-2 shadow-xs backdrop-blur-[5px] transition-all hover:bg-components-button-secondary-bg-hover',
      disabled && 'cursor-not-allowed opacity-50 hover:bg-components-button-secondary-bg',
    )}
    onClick={onClick}
    disabled={disabled}
    aria-label={`Scroll ${direction}`}
  >
    <span
      aria-hidden
      className={cn('size-4 text-components-button-secondary-text', iconClassName)}
    />
  </button>
)

type CarouselAutoplayToggle = {
  isPaused: boolean
  onToggle: () => void
}

type CarouselControlsProps = {
  showPagination: boolean
  selectedIndex: number
  scrollNext: () => void
  scrollPrev: () => void
  scrollSnaps: number[]
  scrollTo: (index: number) => void
  autoplayToggle?: CarouselAutoplayToggle
}

const CarouselControls = ({
  showPagination,
  selectedIndex,
  scrollNext,
  scrollPrev,
  scrollSnaps,
  scrollTo,
  autoplayToggle,
}: CarouselControlsProps) => {
  const { t } = useTranslation()
  const paginationItems = scrollSnaps.map((snap, index) => ({
    id: `${snap}-${index}`,
    snap,
  }))
  const totalPages = scrollSnaps.length

  if (totalPages <= 1) return null

  return (
    <div className="absolute -top-10 right-0 flex items-center gap-3">
      {showPagination && (
        <div className="flex items-center gap-1">
          {paginationItems.map((item, index) => (
            <button
              key={item.id}
              className={cn(
                'h-1.25 w-1.25 rounded-full transition-all',
                selectedIndex === index
                  ? 'w-4 bg-components-button-primary-bg'
                  : 'bg-components-button-secondary-border hover:bg-components-button-secondary-border-hover',
              )}
              onClick={() => scrollTo(index)}
              aria-label={`Go to page ${index + 1}`}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <NavButton
          direction="left"
          disabled={totalPages <= 1}
          onClick={scrollPrev}
          iconClassName="i-ri-arrow-left-s-line"
        />
        <NavButton
          direction="right"
          disabled={totalPages <= 1}
          onClick={scrollNext}
          iconClassName="i-ri-arrow-right-s-line"
        />
        {autoplayToggle && (
          <button
            type="button"
            className="flex cursor-pointer items-center justify-center rounded-full border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg p-2 shadow-xs backdrop-blur-[5px] transition-all hover:bg-components-button-secondary-bg-hover"
            onClick={autoplayToggle.onToggle}
            aria-label={t(
              ($) =>
                $[
                  autoplayToggle.isPaused
                    ? 'marketplace.home.trendingPlay'
                    : 'marketplace.home.trendingPause'
                ],
              { ns: 'plugin' },
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-4 text-components-button-secondary-text',
                autoplayToggle.isPaused ? 'i-ri-play-line' : 'i-ri-pause-line',
              )}
            />
          </button>
        )}
      </div>
    </div>
  )
}

const normalizePageIndex = (index: number, pageCount: number) =>
  ((index % pageCount) + pageCount) % pageCount

const getPageWindowIds = (pages: CarouselPage[], centerIndex: number) => {
  if (!pages.length) return []

  return [-1, 0, 1].map(
    (offset) => pages[normalizePageIndex(centerIndex + offset, pages.length)]!.id,
  )
}

const Carousel = ({
  pages,
  ariaLabel,
  className,
  showNavigation = true,
  showPagination = true,
  autoPlay = false,
  autoPlayInterval = 5000,
  deferMountPages = false,
  pauseWhenOffscreen = false,
}: CarouselProps) => {
  const carouselRootRef = useRef<HTMLDivElement>(null)
  const [isUserPaused, setIsUserPaused] = useState(false)
  // Tracked independently of pauseWhenOffscreen so every autoplay path honors
  // prefers-reduced-motion, including the eagerly-playing first collection.
  const [isReducedMotion, setIsReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false),
  )
  const autoplay = useMemo(() => {
    if (!autoPlay) return undefined

    return Autoplay({
      delay: autoPlayInterval,
      playOnInit: !pauseWhenOffscreen,
      stopOnInteraction: false,
      stopOnMouseEnter: !pauseWhenOffscreen,
    })
  }, [autoPlay, autoPlayInterval, pauseWhenOffscreen])
  const plugins = useMemo(() => (autoplay ? [autoplay] : []), [autoplay])
  const [carouselRef, api] = useEmblaCarousel(
    { align: 'start', containScroll: 'trimSnaps', loop: true },
    plugins,
  )
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scrollSnaps, setScrollSnaps] = useState<number[]>([])
  const [mountedPageIds, setMountedPageIds] = useState(
    () => new Set(deferMountPages ? getPageWindowIds(pages, 0) : pages.map((page) => page.id)),
  )

  const mountPageWindow = useCallback(
    (centerIndex: number) => {
      if (!deferMountPages || !pages.length) return

      const pageIds = getPageWindowIds(pages, centerIndex)
      setMountedPageIds((currentPageIds) => {
        if (pageIds.every((pageId) => currentPageIds.has(pageId))) return currentPageIds

        return new Set([...currentPageIds, ...pageIds])
      })
    },
    [deferMountPages, pages],
  )

  const scheduleScroll = useCallback((scroll: () => void) => {
    window.requestAnimationFrame(scroll)
  }, [])

  const scrollTo = useCallback(
    (index: number) => {
      mountPageWindow(index)
      scheduleScroll(() => api?.scrollTo(index))
    },
    [api, mountPageWindow, scheduleScroll],
  )
  const scrollPrev = useCallback(() => {
    mountPageWindow(selectedIndex - 1)
    scheduleScroll(() => api?.scrollPrev())
  }, [api, mountPageWindow, scheduleScroll, selectedIndex])
  const scrollNext = useCallback(() => {
    mountPageWindow(selectedIndex + 1)
    scheduleScroll(() => api?.scrollNext())
  }, [api, mountPageWindow, scheduleScroll, selectedIndex])

  useEffect(() => {
    if (!deferMountPages) return

    mountPageWindow(selectedIndex)
  }, [deferMountPages, mountPageWindow, pages, selectedIndex])

  useEffect(() => {
    if (!api) return

    const handleSelect = () => {
      const nextSelectedIndex = api.selectedScrollSnap()
      setSelectedIndex(nextSelectedIndex)
      setScrollSnaps(api.scrollSnapList())
      mountPageWindow(nextSelectedIndex)
    }

    handleSelect()
    api.on('reInit', handleSelect)
    api.on('select', handleSelect)

    return () => {
      api.off('reInit', handleSelect)
      api.off('select', handleSelect)
    }
  }, [api, mountPageWindow])

  useEffect(() => {
    if (!autoplay) return

    const carouselRoot = carouselRootRef.current
    if (!carouselRoot) return

    // Once keyboard or assistive-technology focus enters the carousel
    // (including its controls), rotation stays stopped until the user
    // explicitly resumes it with the play control.
    const handleFocusIn = () => setIsUserPaused(true)

    carouselRoot.addEventListener('focusin', handleFocusIn)
    return () => carouselRoot.removeEventListener('focusin', handleFocusIn)
  }, [autoplay])

  // The viewport-managed effect below tracks reduced motion itself; this
  // effect covers the eager autoplay path (pauseWhenOffscreen=false), which
  // previously ignored the preference entirely.
  useEffect(() => {
    if (!autoPlay || pauseWhenOffscreen) return

    const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!reducedMotionQuery) return

    const syncReducedMotion = () => setIsReducedMotion(reducedMotionQuery.matches)

    syncReducedMotion()
    reducedMotionQuery.addEventListener('change', syncReducedMotion)
    return () => reducedMotionQuery.removeEventListener('change', syncReducedMotion)
  }, [autoPlay, pauseWhenOffscreen])

  useEffect(() => {
    if (!autoplay || !api || pauseWhenOffscreen) return

    if (isUserPaused || isReducedMotion) autoplay.stop()
    else autoplay.play()
  }, [api, autoplay, isReducedMotion, isUserPaused, pauseWhenOffscreen])

  useEffect(() => {
    if (!pauseWhenOffscreen || !autoplay || !api) return

    const carouselRoot = carouselRootRef.current
    if (!carouselRoot) return

    let isInViewport = false
    let isHovered = false
    let isDocumentVisible = document.visibilityState === 'visible'
    const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let isReducedMotion = reducedMotionQuery?.matches ?? false

    const syncAutoplay = () => {
      const hasMultiplePages = api.scrollSnapList().length > 1

      if (
        hasMultiplePages &&
        isInViewport &&
        isDocumentVisible &&
        !isReducedMotion &&
        !isHovered &&
        !isUserPaused
      )
        autoplay.play()
      else autoplay.stop()
    }
    const handleVisibilityChange = () => {
      isDocumentVisible = document.visibilityState === 'visible'
      syncAutoplay()
    }
    const handleReducedMotionChange = () => {
      isReducedMotion = reducedMotionQuery?.matches ?? false
      syncAutoplay()
    }
    const handleMouseEnter = () => {
      isHovered = true
      syncAutoplay()
    }
    const handleMouseLeave = () => {
      isHovered = false
      syncAutoplay()
    }

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(
            ([entry]) => {
              isInViewport = !!entry?.isIntersecting && entry.intersectionRatio >= 0.25
              syncAutoplay()
            },
            {
              root: document.getElementById('marketplace-container'),
              threshold: 0.25,
            },
          )

    if (observer) observer.observe(carouselRoot)
    else isInViewport = true

    document.addEventListener('visibilitychange', handleVisibilityChange)
    reducedMotionQuery?.addEventListener('change', handleReducedMotionChange)
    carouselRoot.addEventListener('mouseenter', handleMouseEnter)
    carouselRoot.addEventListener('mouseleave', handleMouseLeave)
    syncAutoplay()

    return () => {
      observer?.disconnect()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      reducedMotionQuery?.removeEventListener('change', handleReducedMotionChange)
      carouselRoot.removeEventListener('mouseenter', handleMouseEnter)
      carouselRoot.removeEventListener('mouseleave', handleMouseLeave)
      autoplay.stop()
    }
  }, [api, autoplay, isUserPaused, pauseWhenOffscreen])

  return (
    <div
      ref={carouselRootRef}
      className={cn('relative', className)}
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
    >
      {showNavigation && (
        <CarouselControls
          showPagination={showPagination}
          selectedIndex={selectedIndex}
          scrollNext={scrollNext}
          scrollPrev={scrollPrev}
          scrollSnaps={scrollSnaps}
          scrollTo={scrollTo}
          autoplayToggle={
            autoPlay
              ? {
                  isPaused: isUserPaused,
                  onToggle: () => setIsUserPaused((paused) => !paused),
                }
              : undefined
          }
        />
      )}
      <div ref={carouselRef} className="overflow-hidden rounded-[inherit]">
        <div className="flex" style={{ columnGap: '12px' }}>
          {pages.map((page, index) => {
            const isMounted = !deferMountPages || mountedPageIds.has(page.id)
            const isCurrent = index === selectedIndex

            return (
              <div
                key={page.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} / ${pages.length}`}
                // Off-screen pages stay mounted for Embla, but must not be
                // reachable through the tab order or the accessibility tree.
                aria-hidden={!isCurrent}
                inert={!isCurrent}
                className={CAROUSEL_PAGE_CLASS}
                data-carousel-page={page.id}
                data-carousel-page-mounted={isMounted ? 'true' : 'false'}
                style={{ scrollSnapAlign: 'start' }}
              >
                {isMounted ? page.content : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default Carousel

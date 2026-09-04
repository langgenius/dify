'use client'

import type { PluginBanner } from '@dify/contracts/marketplace'
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  TransitionEvent,
} from 'react'
import type { MarketplaceBannerPage } from './banners'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '#i18n'
import { trackEvent } from '@/app/components/base/amplitude'
import { trackMarketplaceSiteEvent } from '@/utils/marketplace-site-track'
import TrendingNavigation from './home-trending-navigation'
import { HomeBannerSlide } from './home-trending-slides'
import styles from './home-trending.module.css'
import { useBannerViewability } from './use-banner-viewability'

type LoopPhase = 'idle' | 'resetting' | 'wrapping'
type GestureAxis = 'horizontal' | 'pending' | 'vertical'

type SwipeGesture = {
  axis: GestureAxis
  pointerId: number
  selectedIndex: number
  startX: number
  startY: number
}

const MOBILE_VIEWPORT_QUERY = '(max-width: 879px)'
const GESTURE_AXIS_THRESHOLD = 8
const MIN_SWIPE_THRESHOLD = 40
const MAX_SWIPE_THRESHOLD = 64

function TrackedBannerSlide({
  banner,
  isActive,
  isDragging,
  isMarketplacePlatform,
  page,
}: {
  banner: PluginBanner
  isActive: boolean
  isDragging: boolean
  isMarketplacePlatform: boolean
  page: MarketplaceBannerPage
}) {
  const slideRef = useRef<HTMLDivElement>(null)

  useBannerViewability(
    slideRef,
    () => {
      const properties = {
        banner_id: banner.id,
        sort: banner.sort,
        page,
        language: banner.language,
        style_type: banner.style_type,
      }
      trackEvent('marketplace_banner_impression', properties)
      trackMarketplaceSiteEvent('marketplace_banner_impression', properties)
    },
    isActive,
  )

  return (
    <div
      ref={slideRef}
      role="group"
      aria-roledescription="slide"
      aria-label={banner.title}
      aria-hidden={!isActive}
      inert={!isActive}
      className={cn(
        'h-full min-w-0 shrink-0 grow-0 basis-full',
        isMarketplacePlatform && styles.slide,
        isMarketplacePlatform && !isActive && !isDragging && styles.slideInactive,
      )}
    >
      <HomeBannerSlide banner={banner} isMarketplacePlatform={isMarketplacePlatform} page={page} />
    </div>
  )
}

function HomeTrending({
  banners,
  isMarketplacePlatform,
  page,
}: {
  banners: PluginBanner[]
  isMarketplacePlatform: boolean
  page: MarketplaceBannerPage
}) {
  const { t } = useTranslation('plugin')
  const carouselRootRef = useRef<HTMLDivElement>(null)
  const swipeGestureRef = useRef<SwipeGesture | null>(null)
  const suppressClickRef = useRef(false)
  const suppressClickTimerRef = useRef<number | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [trackIndex, setTrackIndex] = useState(0)
  const [loopPhase, setLoopPhase] = useState<LoopPhase>('idle')
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isGestureActive, setIsGestureActive] = useState(false)
  const [isRotationPaused, setIsRotationPaused] = useState(false)
  const selectSlide = useCallback((index: number) => {
    setLoopPhase('idle')
    setTrackIndex(index)
    setSelectedIndex(index)
  }, [])
  const lastIndex = Math.max(0, banners.length - 1)
  if (selectedIndex > lastIndex) {
    setLoopPhase('idle')
    setSelectedIndex(lastIndex)
    setTrackIndex(lastIndex)
  }
  const selectNextSlide = useCallback(() => {
    if (selectedIndex < banners.length - 1) {
      const nextIndex = selectedIndex + 1
      setTrackIndex(nextIndex)
      setSelectedIndex(nextIndex)
      return
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTrackIndex(0)
      setSelectedIndex(0)
      return
    }

    // Move forwards to a visual clone of the first slide. Once that
    // transition completes, the track can snap back to the real first slide.
    setLoopPhase('wrapping')
    setTrackIndex(banners.length)
  }, [banners.length, selectedIndex])

  const handleTrackTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (loopPhase !== 'wrapping' || event.target !== event.currentTarget) return

      setLoopPhase('resetting')
      setTrackIndex(0)
      setSelectedIndex(0)
    },
    [loopPhase],
  )

  useEffect(() => {
    if (loopPhase !== 'resetting') return

    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      setLoopPhase('idle')
    }

    const frame = window.requestAnimationFrame(settle)
    const timeout = window.setTimeout(settle, 50)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
  }, [loopPhase])

  useEffect(
    () => () => {
      if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current)
    },
    [],
  )

  const canStartSwipe = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) =>
      isMarketplacePlatform &&
      banners.length > 1 &&
      loopPhase === 'idle' &&
      event.isPrimary &&
      event.pointerType === 'touch' &&
      window.matchMedia(MOBILE_VIEWPORT_QUERY).matches,
    [banners.length, isMarketplacePlatform, loopPhase],
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!canStartSwipe(event)) return

      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current)
        suppressClickTimerRef.current = null
      }
      suppressClickRef.current = false
      swipeGestureRef.current = {
        axis: 'pending',
        pointerId: event.pointerId,
        selectedIndex,
        startX: event.clientX,
        startY: event.clientY,
      }
      setIsGestureActive(true)
    },
    [canStartSwipe, selectedIndex],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = swipeGestureRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return

      const deltaX = event.clientX - gesture.startX
      const deltaY = event.clientY - gesture.startY

      if (gesture.axis === 'pending') {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < GESTURE_AXIS_THRESHOLD) return

        if (Math.abs(deltaY) > Math.abs(deltaX)) {
          gesture.axis = 'vertical'
          setIsGestureActive(false)
          return
        }

        gesture.axis = 'horizontal'
        setIsDragging(true)
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Touch pointers are implicitly captured; explicit capture is only a
          // safeguard for browsers that retarget during a horizontal drag.
        }
      }

      if (gesture.axis !== 'horizontal') return

      const viewportWidth = event.currentTarget.getBoundingClientRect().width
      const boundedOffset = Math.max(-viewportWidth, Math.min(viewportWidth, deltaX))
      const isPastStart = gesture.selectedIndex === 0 && boundedOffset > 0
      const isPastEnd = gesture.selectedIndex === banners.length - 1 && boundedOffset < 0
      setDragOffset(isPastStart || isPastEnd ? boundedOffset * 0.35 : boundedOffset)
    },
    [banners.length],
  )

  const finishSwipe = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, wasCanceled = false) => {
      const gesture = swipeGestureRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return

      const deltaX = event.clientX - gesture.startX
      const wasHorizontal = gesture.axis === 'horizontal'
      swipeGestureRef.current = null
      setDragOffset(0)
      setIsDragging(false)
      setIsGestureActive(false)

      if (event.currentTarget.hasPointerCapture?.(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId)

      if (!wasHorizontal) return

      // Once the gesture locks to the horizontal axis, suppress the browser's
      // trailing click even if the finger returns near its starting point.
      suppressClickRef.current = true
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
        suppressClickTimerRef.current = null
      }, 0)

      if (wasCanceled) return

      const swipeThreshold = Math.min(
        MAX_SWIPE_THRESHOLD,
        Math.max(MIN_SWIPE_THRESHOLD, event.currentTarget.getBoundingClientRect().width * 0.12),
      )
      if (Math.abs(deltaX) < swipeThreshold) return

      if (deltaX < 0 && gesture.selectedIndex < banners.length - 1)
        selectSlide(gesture.selectedIndex + 1)
      else if (deltaX > 0 && gesture.selectedIndex > 0) selectSlide(gesture.selectedIndex - 1)
    },
    [banners.length, selectSlide],
  )

  const handleClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return

    event.preventDefault()
    event.stopPropagation()
    suppressClickRef.current = false
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current)
      suppressClickTimerRef.current = null
    }
  }, [])

  if (banners.length === 0) return null

  return (
    <section
      aria-label={t(($) => $['marketplace.home.trendingTitle'])}
      className={cn(
        'shrink-0 bg-background-default pb-6',
        isMarketplacePlatform ? 'px-4 min-[1232px]:px-0' : 'px-4 md:px-9',
        isMarketplacePlatform && styles.section,
      )}
    >
      <div
        className={cn(
          styles.wrapper,
          'mx-auto w-full',
          isMarketplacePlatform ? 'max-w-[1200px]' : 'max-w-[1188px]',
        )}
      >
        <div
          // The pause boundary covers the whole carousel region, so hovering
          // or focusing the navigation controls also stops the rotation.
          ref={carouselRootRef}
          role="region"
          aria-roledescription="carousel"
          aria-label={t(($) => $['marketplace.home.trendingTitle'])}
          className={cn(
            'relative h-[200px] w-full rounded-2xl',
            isMarketplacePlatform && styles.carouselRoot,
          )}
          data-home-trending-carousel-root
        >
          <div
            className={cn(
              'h-full overflow-hidden rounded-2xl',
              isMarketplacePlatform && styles.slideViewport,
            )}
            onClickCapture={handleClickCapture}
            onPointerCancel={(event) => finishSwipe(event, true)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishSwipe}
          >
            <div
              // Keep automatic rotation silent for screen readers; announce
              // the current slide only once rotation is paused or user-driven.
              aria-live={isRotationPaused ? 'polite' : 'off'}
              className={cn(styles.contentTrack, 'flex h-full')}
              data-carousel-track
              data-carousel-loop-phase={loopPhase}
              onTransitionEnd={handleTrackTransitionEnd}
              style={{
                transform:
                  dragOffset === 0
                    ? `translate3d(-${trackIndex * 100}%, 0, 0)`
                    : `translate3d(calc(-${trackIndex * 100}% + ${dragOffset}px), 0, 0)`,
                transition: loopPhase === 'resetting' || isDragging ? 'none' : undefined,
              }}
            >
              {banners.map((banner, index) => (
                <TrackedBannerSlide
                  key={banner.id}
                  banner={banner}
                  isActive={index === selectedIndex}
                  isDragging={isDragging}
                  isMarketplacePlatform={isMarketplacePlatform}
                  page={page}
                />
              ))}
              {loopPhase !== 'idle' && banners[0] && (
                <div
                  aria-hidden
                  inert
                  data-carousel-loop-clone
                  className={cn(
                    'h-full min-w-0 shrink-0 grow-0 basis-full',
                    isMarketplacePlatform && styles.slide,
                  )}
                >
                  <HomeBannerSlide
                    banner={banners[0]}
                    isMarketplacePlatform={isMarketplacePlatform}
                    page={page}
                  />
                </div>
              )}
            </div>
          </div>
          {/* A single banner has nothing to rotate through, so skip the
              pagination/autoplay controls entirely. */}
          {banners.length > 1 && (
            <TrendingNavigation
              banners={banners}
              selectedIndex={selectedIndex}
              carouselRootRef={carouselRootRef}
              pauseWhenOffscreen={!isMarketplacePlatform}
              onSelect={selectSlide}
              onNext={selectNextSlide}
              onPausedChange={setIsRotationPaused}
              interactionPaused={isGestureActive}
            />
          )}
        </div>
      </div>
    </section>
  )
}

export default HomeTrending

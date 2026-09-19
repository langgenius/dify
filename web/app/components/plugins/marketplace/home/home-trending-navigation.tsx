'use client'

import type { PluginBanner } from '@dify/contracts/marketplace'
import type { RefObject } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '#i18n'
import { MARKETPLACE_CONTAINER_ID } from '../constants'
import styles from './home-trending.module.css'

const AUTOPLAY_DELAY = 5000
const PAGINATION_DOT_SIZE = 6
const PAGINATION_ACTIVE_WIDTH = 40
const PAGINATION_GAP = 8
const PAGINATION_STEP = PAGINATION_DOT_SIZE + PAGINATION_GAP
const PAGINATION_ACTIVE_SHIFT = PAGINATION_ACTIVE_WIDTH - PAGINATION_DOT_SIZE

const getPaginationItemOffset = (index: number, selectedIndex: number) =>
  index * PAGINATION_STEP + (index > selectedIndex ? PAGINATION_ACTIVE_SHIFT : 0)

type AutoplayPauseReason =
  | 'focus'
  | 'hover'
  | 'interaction'
  | 'reduced-motion'
  | 'user'
  | 'viewport'
  | 'visibility'

function TrendingNavigation({
  banners,
  selectedIndex,
  carouselRootRef,
  interactionPaused,
  pauseWhenOffscreen,
  onSelect,
  onNext,
  onPausedChange,
}: {
  banners: PluginBanner[]
  selectedIndex: number
  carouselRootRef: RefObject<HTMLDivElement | null>
  interactionPaused: boolean
  pauseWhenOffscreen: boolean
  onSelect: (index: number) => void
  onNext: () => void
  onPausedChange?: (paused: boolean) => void
}) {
  const { t } = useTranslation('plugin')
  const progressRef = useRef<HTMLSpanElement>(null)
  const progressAnimationRef = useRef<Animation | null>(null)
  const pauseReasonsRef = useRef(
    new Set<AutoplayPauseReason>(pauseWhenOffscreen ? ['viewport'] : []),
  )
  const [isUserPaused, setIsUserPaused] = useState(false)
  const [isReducedMotionPaused, setIsReducedMotionPaused] = useState(false)
  const isExplicitlyPaused = isUserPaused || isReducedMotionPaused
  const paginationWidth =
    PAGINATION_ACTIVE_WIDTH + Math.max(0, banners.length - 1) * PAGINATION_STEP

  const setPauseReason = useCallback(
    (reason: AutoplayPauseReason, shouldPause: boolean) => {
      if (shouldPause) pauseReasonsRef.current.add(reason)
      else pauseReasonsRef.current.delete(reason)

      const isPaused = pauseReasonsRef.current.size > 0
      onPausedChange?.(isPaused)

      const progressAnimation = progressAnimationRef.current
      if (!progressAnimation) return

      if (isPaused) progressAnimation.pause()
      else progressAnimation.play()
    },
    [onPausedChange],
  )

  useEffect(() => {
    setPauseReason('interaction', interactionPaused)
  }, [interactionPaused, setPauseReason])

  useEffect(() => {
    const progressElement = progressRef.current
    if (!progressElement?.animate) return

    const progressAnimation = progressElement.animate(
      [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      {
        duration: AUTOPLAY_DELAY,
        easing: 'linear',
        fill: 'forwards',
      },
    )
    progressAnimationRef.current = progressAnimation

    if (pauseReasonsRef.current.size > 0) progressAnimation.pause()
    progressAnimation.onfinish = onNext
    // cancel() rejects `finished` with AbortError; keep that from becoming unhandled.
    void progressAnimation.finished.catch(() => {})

    return () => {
      progressAnimation.onfinish = null
      progressAnimation.cancel()
      if (progressAnimationRef.current === progressAnimation) progressAnimationRef.current = null
    }
  }, [onNext, selectedIndex])

  useEffect(() => {
    const carouselRoot = carouselRootRef.current
    if (!carouselRoot) return

    const handleMouseEnter = () => setPauseReason('hover', true)
    const handleMouseLeave = () => setPauseReason('hover', false)
    const handleFocusIn = () => setPauseReason('focus', true)
    const handleFocusOut = (event: FocusEvent) => {
      if (carouselRoot.contains(event.relatedTarget as Node | null)) return
      setPauseReason('focus', false)
    }
    const handleVisibilityChange = () =>
      setPauseReason('visibility', document.visibilityState === 'hidden')

    carouselRoot.addEventListener('mouseenter', handleMouseEnter)
    carouselRoot.addEventListener('mouseleave', handleMouseLeave)
    carouselRoot.addEventListener('focusin', handleFocusIn)
    carouselRoot.addEventListener('focusout', handleFocusOut)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    handleVisibilityChange()

    return () => {
      carouselRoot.removeEventListener('mouseenter', handleMouseEnter)
      carouselRoot.removeEventListener('mouseleave', handleMouseLeave)
      carouselRoot.removeEventListener('focusin', handleFocusIn)
      carouselRoot.removeEventListener('focusout', handleFocusOut)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [carouselRootRef, setPauseReason])

  useEffect(() => {
    if (!pauseWhenOffscreen) {
      setPauseReason('viewport', false)
      return
    }

    const carouselRoot = carouselRootRef.current
    if (!carouselRoot) return

    if (typeof IntersectionObserver === 'undefined') {
      setPauseReason('viewport', false)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isVisible = !!entry?.isIntersecting && entry.intersectionRatio >= 0.25
        setPauseReason('viewport', !isVisible)
      },
      {
        root: document.getElementById(MARKETPLACE_CONTAINER_ID),
        threshold: 0.25,
      },
    )

    observer.observe(carouselRoot)

    return () => observer.disconnect()
  }, [carouselRootRef, pauseWhenOffscreen, setPauseReason])

  useEffect(() => {
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncReducedMotion = () => {
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- This state mirrors an external media query.
      setIsReducedMotionPaused(reducedMotionQuery.matches)
      setPauseReason('reduced-motion', reducedMotionQuery.matches)
    }

    syncReducedMotion()
    reducedMotionQuery.addEventListener('change', syncReducedMotion)

    return () => reducedMotionQuery.removeEventListener('change', syncReducedMotion)
  }, [setPauseReason])

  const clearImplicitPauseReasons = () => {
    // Pointer activation leaves hover and/or focus on the control, which
    // would otherwise keep rotation paused until the next mouseleave/focusout.
    setPauseReason('focus', false)
    setPauseReason('hover', false)
  }

  const toggleAutoplay = () => {
    if (isExplicitlyPaused) {
      setIsUserPaused(false)
      setIsReducedMotionPaused(false)
      setPauseReason('user', false)
      setPauseReason('reduced-motion', false)
      // An explicit Play overrides the implicit reasons; they re-engage on
      // the next mouseenter/focusin.
      clearImplicitPauseReasons()
      return
    }

    setIsUserPaused(true)
    setPauseReason('user', true)
  }

  return (
    <div
      role="group"
      aria-label={t(($) => $['marketplace.home.trendingPaginationLabel'])}
      className={cn(
        styles.navigation,
        'absolute right-0 z-10 flex h-[22px] items-center gap-2 px-5 py-2',
      )}
    >
      <div className="relative h-1.5 shrink-0" style={{ width: paginationWidth }}>
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 z-1 flex h-1.5 w-10 items-center overflow-hidden rounded-full bg-state-base-handle transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none"
          style={{
            transform: `translate3d(${selectedIndex * PAGINATION_STEP}px, 0, 0)`,
          }}
        >
          <span
            key={selectedIndex}
            ref={progressRef}
            data-carousel-progress
            className="h-full w-full rounded-full bg-text-accent"
            style={{ transform: 'scaleX(0)', transformOrigin: 'left center' }}
          />
        </span>
        {banners.map((banner, index) => {
          const isCurrent = index === selectedIndex

          return (
            <button
              key={banner.id}
              type="button"
              aria-label={banner.title}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={(event) => {
                if (!isCurrent) onSelect(index)
                // Keyboard selection keeps the focus pause so rotation does
                // not advance under the user. Pointer selection should keep
                // timing immediately without waiting for blur.
                if (event.detail === 0) return
                clearImplicitPauseReasons()
              }}
              className={cn(
                'absolute top-0 left-0 z-2 h-1.5 overflow-hidden rounded-full outline-hidden transition-[transform,width,background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] after:absolute after:-inset-2 hover:bg-state-base-handle-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid motion-reduce:transition-none',
                isCurrent ? 'bg-transparent' : 'bg-state-base-handle',
              )}
              style={{
                width: isCurrent ? PAGINATION_ACTIVE_WIDTH : PAGINATION_DOT_SIZE,
                transform: `translate3d(${getPaginationItemOffset(index, selectedIndex)}px, 0, 0)`,
              }}
            />
          )
        })}
      </div>
      <div className="min-w-0 flex-1" />
      <button
        type="button"
        aria-label={t(
          ($) =>
            $[
              isExplicitlyPaused
                ? 'marketplace.home.trendingPlay'
                : 'marketplace.home.trendingPause'
            ],
        )}
        onClick={toggleAutoplay}
        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-state-base-active text-text-primary outline-hidden hover:bg-state-base-handle-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        {isExplicitlyPaused ? (
          <span aria-hidden className="i-ri-play-large-fill size-2 opacity-30" />
        ) : (
          <span aria-hidden className="i-ri-pause-large-fill size-2 opacity-30" />
        )}
      </button>
    </div>
  )
}

export default TrendingNavigation

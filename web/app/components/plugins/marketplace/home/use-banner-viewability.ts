import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'

const BANNER_VIEWABILITY_THRESHOLD = 0.5
const BANNER_VIEWABILITY_DWELL_MS = 1000

export function useBannerViewability(
  targetRef: RefObject<Element | null>,
  onImpression: () => void,
  enabled = true,
) {
  const onImpressionRef = useRef(onImpression)
  onImpressionRef.current = onImpression

  useEffect(() => {
    if (!enabled) return

    const target = targetRef.current
    if (!target || typeof IntersectionObserver === 'undefined') return

    let dwellTimer: ReturnType<typeof setTimeout> | undefined
    let didImpress = false

    const clearDwell = () => {
      if (dwellTimer === undefined) return
      clearTimeout(dwellTimer)
      dwellTimer = undefined
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isViewable = (entry?.intersectionRatio ?? 0) >= BANNER_VIEWABILITY_THRESHOLD

        if (!isViewable) {
          didImpress = false
          clearDwell()
          return
        }

        if (didImpress || dwellTimer !== undefined) return

        dwellTimer = setTimeout(() => {
          dwellTimer = undefined
          didImpress = true
          onImpressionRef.current()
        }, BANNER_VIEWABILITY_DWELL_MS)
      },
      { threshold: BANNER_VIEWABILITY_THRESHOLD },
    )

    observer.observe(target)

    return () => {
      clearDwell()
      observer.disconnect()
    }
  }, [enabled, targetRef])
}

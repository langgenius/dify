import { useEffect, useState, useSyncExternalStore } from 'react'

export const STAGE_WIDTH = 1920
export const STAGE_HEIGHT = 1080

function subscribeToResize(onChange: () => void) {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

function getStageScale() {
  return Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT)
}

/** Scale factor that letterboxes the fixed 1920×1080 stage into the viewport. */
export function useStageScale() {
  return useSyncExternalStore(subscribeToResize, getStageScale, () => 1)
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeToReducedMotion(onChange: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function getReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeToReducedMotion, getReducedMotion, () => false)
}

type CountUpOptions = {
  duration?: number
  delay?: number
  decimals?: number
}

/** Counts from 0 to `target` with an ease-out curve; jumps straight to `target` under reduced motion. */
export function useCountUp(
  target: number,
  { duration = 1400, delay = 0, decimals = 0 }: CountUpOptions = {},
) {
  const reducedMotion = usePrefersReducedMotion()
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (reducedMotion) return undefined
    let frame = 0
    const start = performance.now() + delay
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration))
      const eased = progress === 1 ? 1 : 1 - 2 ** (-10 * progress)
      setValue(Number((target * eased).toFixed(decimals)))
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, delay, decimals, reducedMotion])

  return reducedMotion ? target : value
}

const WAKE_EVENTS = ['pointermove', 'pointerdown', 'keydown'] as const

/** True once the presenter has not touched the pointer or keyboard for `timeoutMs`. */
export function useIdle(timeoutMs: number) {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), timeoutMs)
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), timeoutMs)
    }
    for (const event of WAKE_EVENTS) window.addEventListener(event, wake)
    return () => {
      window.clearTimeout(timer)
      for (const event of WAKE_EVENTS) window.removeEventListener(event, wake)
    }
  }, [timeoutMs])

  return idle
}

export type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'dify-showcase-theme'

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Storage can be unavailable (private mode, sandboxed previews); fall through.
  }
  return 'dark'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Remembering the theme is a convenience, not a requirement.
    }
  }, [theme])

  return [theme, setTheme] as const
}

function readHashIndex(count: number) {
  const parsed = Number.parseInt(window.location.hash.replace('#', ''), 10)
  if (Number.isNaN(parsed)) return 0
  return Math.min(Math.max(parsed - 1, 0), count - 1)
}

/** Current slide, kept in the URL hash so a slide can be linked to and survives a reload. */
export function useSlideIndex(count: number) {
  const [index, setIndex] = useState(() => readHashIndex(count))

  useEffect(() => {
    window.history.replaceState(null, '', `#${index + 1}`)
  }, [index])

  return [index, setIndex] as const
}

export function toggleFullscreen() {
  if (document.fullscreenElement) {
    void document.exitFullscreen()
    return
  }
  void document.documentElement.requestFullscreen()
}

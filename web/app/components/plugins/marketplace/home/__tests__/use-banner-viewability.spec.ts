import { act, render } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBannerViewability } from '../use-banner-viewability'

type ObserverRecord = {
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit
}

let observers: ObserverRecord[] = []

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly scrollMargin = ''
  readonly thresholds: readonly number[]
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = () => []

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.root = options?.root ?? null
    this.rootMargin = options?.rootMargin ?? '0px'
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0]
    observers.push({ callback, options })
  }
}

function ViewabilityProbe({
  enabled = true,
  onImpression,
}: {
  enabled?: boolean
  onImpression: () => void
}) {
  const targetRef = useRef<HTMLDivElement>(null)
  useBannerViewability(targetRef, onImpression, enabled)
  return createElement('div', { ref: targetRef, 'data-testid': 'banner-slide' })
}

function triggerIntersection(intersectionRatio: number) {
  const observer = observers.at(-1)
  if (!observer) throw new Error('Expected IntersectionObserver to be registered')

  act(() => {
    observer.callback(
      [
        {
          intersectionRatio,
          isIntersecting: intersectionRatio > 0,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    )
  })
}

describe('useBannerViewability', () => {
  beforeEach(() => {
    observers = []
    vi.useFakeTimers()
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('records one impression after the slide stays at least 50% visible for 1000ms', () => {
    const onImpression = vi.fn()
    render(createElement(ViewabilityProbe, { onImpression }))

    triggerIntersection(0.5)
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(onImpression).toHaveBeenCalledOnce()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onImpression).toHaveBeenCalledOnce()
  })

  it('records a second impression after the slide leaves and becomes viewable again', () => {
    const onImpression = vi.fn()
    render(createElement(ViewabilityProbe, { onImpression }))

    triggerIntersection(0.8)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onImpression).toHaveBeenCalledOnce()

    triggerIntersection(0)
    triggerIntersection(0.6)
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(onImpression).toHaveBeenCalledTimes(2)
  })

  it('does not record an impression when the slide is visible for less than 1s', () => {
    const onImpression = vi.fn()
    render(createElement(ViewabilityProbe, { onImpression }))

    triggerIntersection(0.9)
    act(() => {
      vi.advanceTimersByTime(999)
    })
    triggerIntersection(0)
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(onImpression).not.toHaveBeenCalled()
  })

  it('does not record an impression when the visible ratio stays below 0.5', () => {
    const onImpression = vi.fn()
    render(createElement(ViewabilityProbe, { onImpression }))

    triggerIntersection(0.49)
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(onImpression).not.toHaveBeenCalled()
  })
})

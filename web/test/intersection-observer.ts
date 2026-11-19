import { act } from '@testing-library/react'
import { vi } from 'vite-plus/test'

/** Emit visibility changes for currently observed elements; restore globals after each test. */
export function mockIntersectionObserver() {
  const observers = new Set<Observer>()
  class Observer implements IntersectionObserver {
    readonly root: Element | Document | null
    readonly rootMargin: string
    readonly thresholds: number[]
    readonly scrollMargin = '0px'
    readonly delay = 0
    readonly trackVisibility = false
    readonly targets = new Set<Element>()
    readonly callback: IntersectionObserverCallback
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
      this.callback = callback
      this.root = options.root ?? null
      this.rootMargin = options.rootMargin ?? '0px'
      this.thresholds = [options.threshold ?? 0].flat()
    }
    observe(target: Element) {
      this.targets.add(target)
      observers.add(this)
    }
    unobserve(target: Element) {
      this.targets.delete(target)
      if (!this.targets.size) observers.delete(this)
    }
    disconnect() {
      this.targets.clear()
      observers.delete(this)
    }
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
  vi.stubGlobal('IntersectionObserver', Observer)
  return (isIntersecting = true, options: { target?: Element; intersectionRatio?: number } = {}) =>
    act(() => {
      for (const observer of [...observers]) {
        const targets = [...observer.targets].filter(
          (target) => !options.target || target === options.target,
        )
        if (!targets.length) continue
        observer.callback(
          targets.map((target) => ({
            target,
            time: 0,
            isIntersecting,
            intersectionRatio: options.intersectionRatio ?? (isIntersecting ? 1 : 0),
            rootBounds: null,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRect: new DOMRect(),
          })),
          observer,
        )
      }
    })
}

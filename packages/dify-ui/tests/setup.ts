import { act, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

if (typeof Element !== 'undefined' && !Element.prototype.getAnimations)
  Element.prototype.getAnimations = () => []

if (typeof document !== 'undefined' && !document.getAnimations)
  document.getAnimations = () => []

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {
      return undefined
    }

    unobserve() {
      return undefined
    }

    disconnect() {
      return undefined
    }
  }
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly scrollMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []
    constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) { /* noop */ }
    observe(_target: Element) { /* noop */ }
    unobserve(_target: Element) { /* noop */ }
    disconnect() { /* noop */ }
    takeRecords(): IntersectionObserverEntry[] { return [] }
  }
}

afterEach(async () => {
  await act(async () => {
    cleanup()
  })
})
